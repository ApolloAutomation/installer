import '../../vendor/esp-web-tools/install-button.js';
import { fetchReleaseNotes } from '../release-notes.js';

// Release data comes from the GitHub API (external input) — escape everything
// interpolated into markup. Registry fields are trusted repo content.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function selectedManifest(device, channel, variant) {
  return device.firmware[channel][variant];
}

function segHtml(id, label, keys, active, dataAttr) {
  if (keys.length < 2) return '';
  return `
    <div class="group">
      <label>${label}</label>
      <span class="seg" id="${id}">
        ${keys.map((k) => `<button data-${dataAttr}="${k}" class="${k === active ? 'active' : ''}">${k}</button>`).join('')}
      </span>
    </div>`;
}

export function renderDevice(el, device) {
  const channels = Object.keys(device.firmware);
  let channel = channels.includes('stable') ? 'stable' : channels[0];
  let variant = Object.keys(device.firmware[channel])[0];
  const hasSerial = !!navigator.serial;

  el.innerHTML = `
    <div class="device-page">
      <a class="back" href="#/">← All devices</a>
      <div class="device-head">
        <img src="${device.image}" alt="${device.name}">
        <div>
          <h1>${device.name}</h1>
          <p>${device.description}</p>
          <p class="links">
            <a href="${device.wiki}">Setup guide</a> ·
            <a href="https://github.com/${device.repo}">GitHub</a> ·
            <a href="${device.githubPagesInstaller}">Classic installer</a>
          </p>
        </div>
      </div>

      <section class="step">
        <h2><span class="num">1</span> Choose your firmware</h2>
        <div class="picker">
          ${segHtml('channel-seg', 'Channel', channels, channel, 'channel')}
          <div id="variant-slot"></div>
        </div>
        <div id="release-slot"></div>
        ${channels.length < 2 && Object.keys(device.firmware[channel]).length < 2
          ? '<p style="color:var(--dim);margin:0;">One firmware for this device — nothing to choose here.</p>' : ''}
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

  function renderVariantSeg() {
    variantSlot.innerHTML = segHtml('variant-seg', 'Variant', Object.keys(device.firmware[channel]), variant, 'variant');
    const seg = variantSlot.querySelector('#variant-seg');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-variant]');
      if (!b) return;
      variant = b.dataset.variant;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      renderInstall();
    });
  }

  async function renderInstall() {
    const manifest = selectedManifest(device, channel, variant);
    if (hasSerial) {
      installSlot.innerHTML = `
        <esp-web-install-button manifest="${manifest}">
          <button slot="activate" class="install-btn">Connect &amp; Install</button>
        </esp-web-install-button>
        <p style="color:var(--dim);font-size:.85rem;margin:10px 0 0;">
          Plug the device into this computer with a USB data cable, click the button, and pick the serial port.</p>`;
    } else {
      installSlot.innerHTML = `
        <div class="fallback">
          <strong>This browser can't flash over USB.</strong>
          <p>Installing from the browser needs Chrome or Edge. You can still install manually:</p>
          <ul id="fallback-files"><li>Loading firmware file list…</li></ul>
          <ul>
            <li>Flash it with <a href="https://web.esphome.io">ESPHome Web</a> (open it in Chrome/Edge) or
                <code>esptool write-flash --port &lt;port&gt; 0x0 &lt;file&gt;</code>.</li>
            <li>Or use the <a href="${device.githubPagesInstaller}">classic installer page</a> in Chrome/Edge.</li>
          </ul>
        </div>`;
      const want = manifest;
      // Pin the list element before the fetch: if the user navigates to another
      // device mid-fetch, the stale write lands on this detached node harmlessly
      // instead of the new device's freshly rendered #fallback-files.
      const filesEl = el.querySelector('#fallback-files');
      try {
        const res = await fetch(manifest);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const m = await res.json();
        if (selectedManifest(device, channel, variant) !== want) return; // stale fetch — selection changed
        const files = m.builds.flatMap((b) => b.parts.map((p) => new URL(p.path, manifest).href));
        filesEl.innerHTML =
          files.map((f) => `<li><a href="${encodeURI(f)}">${f.split('/').pop().replace(/[<>&"']/g, '')}</a></li>`).join('');
      } catch {
        if (selectedManifest(device, channel, variant) !== want) return; // stale fetch — selection changed
        filesEl.innerHTML =
          `<li>Couldn't load the file list — download firmware from the
             <a href="https://github.com/${device.repo}/releases">latest release</a>.</li>`;
      }
    }
  }

  async function renderReleaseNotes() {
    const slot = el.querySelector('#release-slot');
    slot.innerHTML = '';
    const want = channel; // discard the response if the channel changed by resolution time
    try {
      const rel = await fetchReleaseNotes(device.repo, channel);
      if (channel !== want) return; // stale fetch — channel changed
      const url = /^https:\/\/github\.com\//.test(rel.url) ? rel.url : `https://github.com/${device.repo}/releases`;
      slot.innerHTML = `
        <div class="release-notes">
          <details>
            <summary>What's new in ${esc(rel.name)}</summary>
            <pre>${esc(rel.body)}</pre>
            <a href="${esc(url)}">Full release →</a>
          </details>
        </div>`;
    } catch {
      if (channel !== want) return; // stale fetch — channel changed
      slot.innerHTML = `
        <div class="release-notes">
          See <a class="fail-link" href="https://github.com/${device.repo}/releases">recent releases</a>
          for what's new.
        </div>`;
    }
  }

  const chanSeg = el.querySelector('#channel-seg');
  if (chanSeg) chanSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-channel]');
    if (!b) return;
    channel = b.dataset.channel;
    variant = Object.keys(device.firmware[channel])[0];
    chanSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderVariantSeg();
    renderInstall();
    renderReleaseNotes();
  });

  renderVariantSeg();
  renderInstall();
  renderReleaseNotes();
}
