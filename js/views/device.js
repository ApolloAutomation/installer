import '../../vendor/esp-web-tools/install-button.js';

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
        ${channels.length < 2 && Object.keys(device.firmware[channel]).length < 2
          ? '<p style="color:var(--dim);margin:0;">One firmware for this device — nothing to choose here.</p>' : ''}
      </section>

      <section class="step">
        <h2><span class="num">2</span> Connect &amp; install</h2>
        <div id="install-slot"></div>
      </section>

      <section class="step" id="step-done">
        <h2><span class="num">3</span> Add to Home Assistant</h2>
        <p style="color:var(--dim)">Coming in the next task.</p>
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
                <code>esptool write_flash 0x0 &lt;file&gt;</code>.</li>
            <li>Or use the <a href="${device.githubPagesInstaller}">classic installer page</a> in Chrome/Edge.</li>
          </ul>
        </div>`;
      try {
        const res = await fetch(manifest);
        const m = await res.json();
        const files = m.builds.flatMap((b) => b.parts.map((p) => new URL(p.path, manifest).href));
        el.querySelector('#fallback-files').innerHTML =
          files.map((f) => `<li><a href="${encodeURI(f)}">${f.split('/').pop().replace(/[<>&"']/g, '')}</a></li>`).join('');
      } catch {
        el.querySelector('#fallback-files').innerHTML =
          `<li>Couldn't load the file list — download firmware from the
             <a href="https://github.com/${device.repo}/releases">latest release</a>.</li>`;
      }
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
  });

  renderVariantSeg();
  renderInstall();
}
