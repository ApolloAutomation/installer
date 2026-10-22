import { loadRegistry } from './registry.js';
import { renderHub } from './views/hub.js';
import { renderDevice } from './views/device.js';
import { initThemeToggle } from './theme.js';

const app = document.getElementById('app');
const siteTitle = document.title;

function hashId() {
  const raw = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  try { return decodeURIComponent(raw).toLowerCase(); } catch { return raw.toLowerCase(); }
}

async function route(e) {
  let registry;
  try {
    registry = await loadRegistry();
  } catch (err) {
    app.innerHTML = `
      <div class="error-box">
        <p><strong>Something went wrong loading the installer.</strong> <span class="error-detail"></span></p>
        <p>Try reloading. If it keeps happening, every device also has a standalone installer
           linked from its <a href="https://github.com/orgs/ApolloAutomation/repositories">GitHub repository</a>.</p>
      </div>`;
    app.querySelector('.error-detail').textContent = err.message;
    return;
  }
  // Ids are lowercase-kebab; #/AIR-1 and #/air-1/ reach the same page.
  const id = hashId();
  const device = registry.devices.find((d) => d.id === id);
  if (device) {
    renderDevice(app, device);
    document.title = `${device.name} · ${siteTitle}`;
  } else {
    renderHub(app, registry, id);
    document.title = siteTitle;
  }
  window.scrollTo(0, 0);
  // On in-app navigation, move focus to the new page's heading so keyboard and
  // screen-reader users start at what changed instead of a detached link.
  if (e) {
    const h1 = app.querySelector('h1');
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }
}

window.addEventListener('hashchange', route);
route();
initThemeToggle();
