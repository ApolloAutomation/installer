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

function segHtml(id, label, keys, active, dataAttr) {
  if (keys.length < 2) return '';
  return `
    <div class="group">
      <label>${label}</label>
      <span class="seg" id="${id}">
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
        <img src="${device.image}" alt="${device.name}">
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
        ${channels.length < 2 && Object.keys(device.firmware[channel]).length < 2
          ? '<p style="color:var(--dim);margin:0 0 4px;">One firmware for this device — nothing to choose here.</p>' : ''}
        <div id="release-slot"></div>
        <div id="config-slot"></div>
      </section>

      <section class="step">
        <h2><span class="num">2</span> Connect &amp; install</h2>
        <div id="install-slot"></div>
      </section>

      <section class="step" id="step-done">
        <h2><span class="num">3</span> Add to Home Assistant</h2>
        <p>After installing, the device broadcasts itself on your network.
           In Home Assistant go to <strong>Settings → Devices &amp; services</strong> — it appears as a
           discovered <strong>ESPHome</strong> device. Click <strong>Configure</strong>, and you're done.
           <span class="done-check">✓</span></p>
        <details class="customize">
          <summary>Want to customize the firmware?</summary>
          <p>Apollo firmware ships with <code>dashboard_import</code>, so the device also shows up in the
             <strong>ESPHome Dashboard</strong> (or the ESPHome add-on in Home Assistant) under
             <strong>Discovered</strong>. Click <strong>Take control</strong> to pull its configuration
             into the dashboard, then edit it and flash updates over Wi-Fi.</p>
        </details>
        <p><a href="${device.wiki}">Full ${device.name} setup guide on the wiki →</a></p>
      </section>
    </div>`;

  const variantSlot = el.querySelector('#variant-slot');
  const installSlot = el.querySelector('#install-slot');
  const linksSlot = el.querySelector('#links-slot');

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

  function renderVariantSeg() {
    variantSlot.innerHTML = segHtml('variant-seg', 'Variant', Object.keys(device.firmware[channel]), variant, 'variant');
    const seg = variantSlot.querySelector('#variant-seg');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-variant]');
      if (!b) return;
      variant = b.dataset.variant;
      epoch++;
      seg.querySelectorAll('button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-pressed', String(on));
      });
      renderInstall();
      renderConfig();
      renderReleaseNotes();
      renderLinks();
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
          <p style="color:var(--dim);font-size:.85rem;margin:10px 0 0;">
            Plug the device into this computer with a USB data cable, click the button, and pick the serial port.</p>`;
      }
    } else {
      installSlot.innerHTML = `
        <div class="fallback">
          <strong>This browser can't flash over USB.</strong>
          <p>Installing from the browser needs Chrome, Edge, or Firefox. You can still install manually:</p>
          <ul id="fallback-files"><li>Loading firmware file list…</li></ul>
          <ul>
            <li>Flash it with <a href="https://web.esphome.io">ESPHome Web</a> (open it in Chrome, Edge, or Firefox) or
                <code>esptool write-flash --port &lt;port&gt; 0x0 &lt;file&gt;</code>.</li>
            ${classic ? `<li>Or use the <a href="${classic}">classic installer page</a> in Chrome, Edge, or Firefox.</li>` : ''}
          </ul>
        </div>`;
      // Pin the list element before the fetch: if the user navigates to another
      // device mid-fetch, the stale write lands on this detached node harmlessly
      // instead of the new device's freshly rendered #fallback-files.
      const filesEl = el.querySelector('#fallback-files');
      try {
        const res = await fetch(manifest);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const m = await res.json();
        if (epoch !== myEpoch) return; // selection changed mid-fetch
        const files = m.builds.flatMap((b) => b.parts.map((p) => new URL(p.path, manifest).href));
        filesEl.innerHTML =
          files.map((f) => `<li><a href="${encodeURI(f)}">${f.split('/').pop().replace(/[<>&"']/g, '')}</a></li>`).join('');
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
    slot.innerHTML = '';
    const myEpoch = epoch;
    const repo = repoFor(device, channel, variant);
    try {
      const rel = await fetchReleaseNotes(repo, channel);
      if (epoch !== myEpoch) return; // selection changed mid-fetch
      const url = /^https:\/\/github\.com\//.test(rel.url) ? rel.url : `https://github.com/${repo}/releases`;
      slot.innerHTML = `
        <div class="release-notes">
          <details>
            <summary>What's new in ${esc(rel.name)}</summary>
            <pre>${esc(rel.body)}</pre>
            <a href="${esc(url)}">Full release →</a>
          </details>
        </div>`;
    } catch {
      if (epoch !== myEpoch) return; // selection changed mid-fetch
      slot.innerHTML = `
        <div class="release-notes">
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
          (<code>${filename}</code>). Rebuilding from this keeps the device's onboarding, so the
          <a href="${device.wiki}">${device.name} wiki</a> setup steps still apply.</p>
        <pre class="config-yaml"><code>Loading config…</code></pre>
        <div class="config-actions">
          <button class="config-download" disabled>Download .yaml</button>
          <a class="config-github" href="${rawToBlob(url)}" target="_blank" rel="noopener">View on GitHub →</a>
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
  });

  renderVariantSeg();
  renderInstall();
  renderReleaseNotes();
  renderConfig();
  renderLinks();
}
