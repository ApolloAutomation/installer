import '../../vendor/esp-web-tools/install-button.js';
import { fetchReleaseNotes } from '../release-notes.js';

// Release data comes from the GitHub API (external input) — escape everything
// interpolated into markup. Registry fields are trusted repo content.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rawToBlob(raw) {
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}` : raw;
}
// The folder a raw config lives in, as a GitHub tree link. Configs !include their
// sibling files (Core.yaml and friends), so a rebuild needs the whole folder.
function rawToTree(raw) {
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)\/[^/]+$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/tree/${m[3]}/${m[4]}` : rawToBlob(raw);
}
function configBasename(url) {
  return (url.split('/').pop() || 'config.yaml').replace(/[^\w.\-]/g, '_');
}
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fileName(url) {
  const last = url.pathname.split('/').pop();
  try { return decodeURIComponent(last); } catch { return last; }
}

// Manifests are read by the release-notes check and by the no-WebSerial file
// list. One request per URL for the page session; a failure is evicted so a
// later render can retry.
const manifests = new Map();
function fetchManifest(url) {
  if (!manifests.has(url)) {
    const p = fetch(url).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    p.catch(() => manifests.delete(url));
    manifests.set(url, p);
  }
  return manifests.get(url);
}

// Release notes describe the flashed build only if the release is tagged with the
// manifest's version or names it (WLED-M1 tags bundles like m1-b8 but its notes
// say "v16.0.1"). Otherwise "What's new" would show some other build's notes.
// URLs are ignored: GitHub's "Full Changelog" compare link names the previous
// version, and 16.0.1 must not match 16.0.10 or 16.0.1-beta.
function releaseMatches(rel, version) {
  if (!version) return true;
  const v = String(version);
  if (rel.tag === v || rel.tag === `v${v}`) return true;
  const e = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\w.])v?${e}(?![.-]?\\w|\\.\\.)`);
  return re.test(`${rel.name}\n${rel.body}`.replace(/https?:\/\/\S+/g, ''));
}

function selectedManifest(device, channel, variant) {
  return device.firmware[channel][variant];
}

function repoFor(device, channel, variant) {
  return (device.repos && device.repos[channel] && device.repos[channel][variant]) || device.repo;
}

function classicInstallerFor(device, channel, variant) {
  const map = device.installers && device.installers[channel];
  return map && variant in map ? map[variant] : device.githubPagesInstaller;
}

// Optional per-variant explanation shown under the variant toggle, same
// `channel -> variant -> text` shape as `repos`/`installers`. Registry content,
// so it is trusted HTML like `description`.
function variantNoteFor(device, channel, variant) {
  const map = device.variantNotes && device.variantNotes[channel];
  return (map && map[variant]) || '';
}

// Firmware ecosystem for a variant. Mirrors `repos`/`installers`: an optional
// per-variant `platforms` map wins, then the device-level `platform`, then
// esphome. A device offering both WLED and ESPHome builds (the M-1 could) marks
// only the variants that differ from its device-level default.
function platformFor(device, channel, variant) {
  const map = device.platforms && device.platforms[channel];
  if (map && variant in map) return map[variant];
  return device.platform || 'esphome';
}

// Step 3 differs by what the firmware does once installed: ESPHome devices are
// adopted through the ESPHome integration and Device Builder, WLED devices through
// the WLED integration and the WLED web UI, and standalone builds (no network at
// all, like the ornaments' stock firmware) have nothing to add.
function stepThreeHtml(device, platform) {
  if (platform === 'standalone') {
    return `
        <h2><span class="num">3</span> You're done</h2>
        <p>This firmware doesn't use Wi-Fi, so there's nothing to add to Home Assistant.
           Unplug the ${device.name} from the computer and restart it: if it has batteries in,
           take one out for a few seconds. After that it works on its own. To use it with
           Home Assistant later, come back and install a Wi-Fi firmware.
           <span class="done-check">✓</span></p>`;
  }
  const heading = '<h2><span class="num">3</span> Add to Home Assistant</h2>';
  if (platform === 'wled') {
    return heading + `
        <p>If you did not set Wi-Fi during install, join the open
           <strong>Apollo ${device.name}</strong> Wi-Fi hotspot the device broadcasts, then open
           <code>4.3.2.1</code> in a browser and pick your network. On 16.0.1 the panel itself
           shows a setup card with that address and a QR code. Once it is on your Wi-Fi, go to
           <strong>Settings → Devices &amp; services</strong> in Home Assistant, where it appears as a
           discovered <strong>WLED</strong> device. Click <strong>Configure</strong>, and you're done.
           <span class="done-check">✓</span></p>
        <details class="customize">
          <summary>Want to customize the firmware?</summary>
          <p>The ${device.name} runs WLED, so effects and settings are customized in WLED itself.
             Open its web UI at the device's IP address, or use the WLED mobile app, to change
             effects, colors, presets and segments. Firmware updates install from that UI under
             <strong>Config → Security &amp; Updates → Manual OTA Update</strong>. Only use an
             update file built for your firmware and board revision; check the setup guide
             before updating.</p>
        </details>`;
  }
  return heading + `
        <p>After installing, the device broadcasts itself on your network.
           In Home Assistant go to <strong>Settings → Devices &amp; services</strong> — it appears as a
           discovered <strong>ESPHome</strong> device. Click <strong>Configure</strong>, and you're done.
           <span class="done-check">✓</span></p>
        <details class="customize">
          <summary>Want to customize the firmware?</summary>
          <p>Apollo firmware ships with <code>dashboard_import</code>, so the device also shows up in the
             <strong>ESPHome Device Builder</strong> (or the ESPHome Device Builder app in Home Assistant) under
             <strong>Discovered</strong>. Click <strong>Take control</strong> to pull its configuration
             into the Device Builder, then edit it and flash updates over the network.</p>
        </details>`;
}

function segHtml(id, label, keys, active, dataAttr) {
  if (keys.length < 2) return '';
  return `
    <div class="group">
      <span class="seg-label" id="${id}-label">${label}</span>
      <span class="seg" id="${id}" role="group" aria-labelledby="${id}-label">
        ${keys.map((k) => `<button data-${dataAttr}="${k}" class="${k === active ? 'active' : ''}" aria-pressed="${k === active}">${k}</button>`).join('')}
      </span>
    </div>`;
}

export function renderDevice(el, device) {
  const channels = Object.keys(device.firmware);
  let channel = channels.includes('stable') ? 'stable' : channels[0];
  let variant = Object.keys(device.firmware[channel])[0];
  let epoch = 0; // bumps on every channel/variant change; async renders bail if it moved
  const hasSerial = !!navigator.serial;

  el.innerHTML = `
    <div class="device-page">
      <a class="back" href="#/">← All devices</a>
      <div class="device-head">
        <img src="${device.image}" alt="">
        <div>
          <h1>${device.name}</h1>
          <p>${device.description}</p>
          <p class="links" id="links-slot"></p>
        </div>
      </div>

      <section class="step">
        <h2><span class="num">1</span> Choose your firmware</h2>
        <div class="picker">
          ${segHtml('channel-seg', 'Channel', channels, channel, 'channel')}
          <div id="variant-slot"></div>
        </div>
        <div id="variant-note-slot"></div>
        ${channels.length < 2 && Object.keys(device.firmware[channel]).length < 2
          ? '<p class="hint single-note">One firmware for this device — nothing to choose here.</p>' : ''}
        <div id="release-slot"></div>
        <div id="config-slot"></div>
      </section>

      <section class="step">
        <h2><span class="num">2</span> Connect &amp; install</h2>
        <div id="install-slot"></div>
      </section>

      <section class="step" id="step-done">
        <div id="step3-slot"></div>
        <p><a href="${device.wiki}">Full ${device.name} setup guide on the wiki →</a></p>
      </section>
    </div>`;

  const variantSlot = el.querySelector('#variant-slot');
  const noteSlot = el.querySelector('#variant-note-slot');
  const installSlot = el.querySelector('#install-slot');
  const linksSlot = el.querySelector('#links-slot');
  const stepThreeSlot = el.querySelector('#step3-slot');

  function renderStepThree() {
    stepThreeSlot.innerHTML = stepThreeHtml(device, platformFor(device, channel, variant));
  }

  function renderLinks() {
    const repo = repoFor(device, channel, variant);
    const classic = classicInstallerFor(device, channel, variant);
    const parts = [
      `<a href="${device.wiki}">Setup guide</a>`,
      `<a href="https://github.com/${repo}">GitHub</a>`,
    ];
    if (classic) parts.push(`<a href="${classic}">Classic installer</a>`);
    linksSlot.innerHTML = parts.join(' · ');
  }

  function renderVariantNote() {
    const note = variantNoteFor(device, channel, variant);
    noteSlot.innerHTML = note ? `<p class="variant-note">${note}</p>` : '';
  }

  function renderVariantSeg() {
    variantSlot.innerHTML = segHtml('variant-seg', 'Variant', Object.keys(device.firmware[channel]), variant, 'variant');
    renderVariantNote();
    const seg = variantSlot.querySelector('#variant-seg');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-variant]');
      if (!b) return;
      if (b.dataset.variant === variant) return; // already selected — nothing to re-render
      variant = b.dataset.variant;
      epoch++;
      seg.querySelectorAll('button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-pressed', String(on));
      });
      renderVariantNote();
      renderInstall();
      renderConfig();
      renderReleaseNotes();
      renderLinks();
      renderStepThree();
    });
  }

  async function renderInstall() {
    const myEpoch = epoch;
    const manifest = selectedManifest(device, channel, variant);
    const repo = repoFor(device, channel, variant);
    const classic = classicInstallerFor(device, channel, variant);
    if (hasSerial) {
      const existing = installSlot.querySelector('esp-web-install-button');
      if (existing) {
        // Reuse the button; only the manifest differs between variants. Rebuilding
        // it would recreate the web component and flash on every variant change.
        existing.setAttribute('manifest', manifest);
      } else {
        installSlot.innerHTML = `
          <esp-web-install-button manifest="${manifest}">
            <button slot="activate" class="install-btn">Connect &amp; Install</button>
          </esp-web-install-button>
          <p class="hint install-hint">
            Plug the device into this computer with a USB data cable, click the button, and pick the serial port.</p>`;
      }
    } else {
      installSlot.innerHTML = `
        <div class="fallback">
          <strong>This browser can't flash over USB.</strong>
          <p>Installing from the browser needs Chrome, Edge, or Firefox on a computer. You can still install manually:</p>
          <ul id="fallback-files"><li>Loading firmware file list…</li></ul>
          <ul>
            <li>Flash it with <a href="https://web.esphome.io">ESPHome Web</a> (open it in Chrome, Edge, or Firefox) or
                <code>esptool write-flash --port &lt;port&gt; &lt;offset&gt; &lt;file&gt;</code>, using the offset
                listed next to each file (only the files for your board's chip, if several are listed).</li>
            ${classic ? `<li>Or use the <a href="${classic}">classic installer page</a> in Chrome, Edge, or Firefox.</li>` : ''}
          </ul>
        </div>`;
      // Pin the list element before the fetch: if the user navigates to another
      // device mid-fetch, the stale write lands on this detached node harmlessly
      // instead of the new device's freshly rendered #fallback-files.
      const filesEl = el.querySelector('#fallback-files');
      try {
        const m = await fetchManifest(manifest);
        if (epoch !== myEpoch) return; // selection changed mid-fetch
        // Part paths are runtime data: resolve them against the manifest, keep
        // only https links, and escape what goes into the markup. A manifest
        // with builds for several chips labels each file with its chip.
        const several = m.builds.length > 1;
        const parts = m.builds
          .flatMap((b) => b.parts.map((p) => ({
            chip: b.chipFamily, url: new URL(p.path, manifest), offset: Number(p.offset) || 0 })))
          .filter((p) => p.url.protocol === 'https:');
        if (!parts.length) throw new Error('no firmware files');
        filesEl.innerHTML = parts.map((p) => `<li>${several ? `${esc(p.chip)}: ` : ''}<a href="${esc(p.url.href)}">${esc(fileName(p.url))}</a>
          at <code>0x${p.offset.toString(16)}</code></li>`).join('');
      } catch {
        if (epoch !== myEpoch) return; // selection changed mid-fetch
        filesEl.innerHTML =
          `<li>Couldn't load the file list — download firmware from the
             <a href="https://github.com/${repo}/releases">latest release</a>.</li>`;
      }
    }
  }

  async function renderReleaseNotes() {
    const slot = el.querySelector('#release-slot');
    const myEpoch = epoch;
    const repo = repoFor(device, channel, variant);
    const manifestUrl = selectedManifest(device, channel, variant);
    // Never leave the previous selection's notes, build number or "Full release"
    // link next to this variant's install button while its own load. Both lookups
    // are memoized, so a revisited variant replaces this before it is painted.
    const key = `${repo}|${channel}|${manifestUrl}`;
    if (slot.dataset.key !== key) {
      slot.dataset.key = key;
      slot.innerHTML = '<div class="release-notes">Loading release notes…</div>';
    }
    const [rel, man] = await Promise.allSettled([
      fetchReleaseNotes(repo, channel),
      fetchManifest(manifestUrl),
    ]);
    if (epoch !== myEpoch) return; // selection changed mid-fetch
    const version = man.status === 'fulfilled' ? man.value.version : null;
    if (rel.status === 'fulfilled' && releaseMatches(rel.value, version)) {
      const r = rel.value;
      const url = /^https:\/\/github\.com\//.test(r.url) ? r.url : `https://github.com/${repo}/releases`;
      slot.innerHTML = `
        <div class="release-notes">
          <details>
            <summary>What's new in ${esc(r.name)}</summary>
            <pre>${esc(r.body)}</pre>
            <a href="${esc(url)}">Full release →</a>
          </details>
        </div>`;
    } else if (rel.status === 'fulfilled') {
      // The repo's latest release is a different build; don't present its notes
      // or assets as this firmware's.
      slot.innerHTML = `
        <div class="release-notes version-only">
          Installs build <strong>${esc(version)}</strong>.
        </div>`;
    } else {
      slot.innerHTML = `
        <div class="release-notes">
          ${version ? `Installs build <strong>${esc(version)}</strong>.` : ''}
          See <a class="fail-link" href="https://github.com/${repo}/releases">recent releases</a>
          for what's new.
        </div>`;
    }
  }

  async function renderConfig() {
    const slot = el.querySelector('#config-slot');
    const url = device.config && device.config[channel] && device.config[channel][variant];
    if (!url) { slot.innerHTML = ''; return; }
    const filename = configBasename(url);
    slot.innerHTML = `
      <details class="config">
        <summary>Build or reflash this firmware yourself</summary>
        <p class="config-hint">The ESPHome config for the <strong>${variant}</strong> variant
          (<code>${filename}</code>). It pulls in other files from the same folder, so build it
          from a copy of the whole folder, not this file alone. The
          <a href="${device.wiki}">${device.name} wiki</a> has the setup steps.</p>
        <pre class="config-yaml"><code>Loading config…</code></pre>
        <div class="config-actions">
          <button class="config-download" disabled>Download .yaml</button>
          <a class="config-github" href="${rawToBlob(url)}" target="_blank" rel="noopener">View on GitHub →</a>
          <a class="config-folder" href="${rawToTree(url)}" target="_blank" rel="noopener">Browse the folder →</a>
        </div>
      </details>`;
    const codeEl = slot.querySelector('.config-yaml code');
    const dlBtn = slot.querySelector('.config-download');
    const myEpoch = epoch;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (epoch !== myEpoch) return; // selection changed mid-fetch
      codeEl.textContent = text; // textContent escapes the runtime-fetched YAML
      dlBtn.disabled = false;
      dlBtn.addEventListener('click', () => downloadText(text, filename));
    } catch {
      if (epoch !== myEpoch) return;
      codeEl.textContent = 'Could not load the config here — use "View on GitHub".';
    }
  }

  const chanSeg = el.querySelector('#channel-seg');
  if (chanSeg) chanSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-channel]');
    if (!b) return;
    if (b.dataset.channel === channel) return; // already selected — keep the chosen variant
    channel = b.dataset.channel;
    variant = Object.keys(device.firmware[channel])[0];
    epoch++;
    chanSeg.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    renderVariantSeg();
    renderInstall();
    renderReleaseNotes();
    renderConfig();
    renderLinks();
    renderStepThree();
  });

  renderVariantSeg();
  renderInstall();
  renderReleaseNotes();
  renderConfig();
  renderLinks();
  renderStepThree();
}
