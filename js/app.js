import { loadRegistry } from './registry.js';
import { renderHub } from './views/hub.js';
import { renderDevice } from './views/device.js';

const app = document.getElementById('app');

async function route() {
  let registry;
  try {
    registry = await loadRegistry();
  } catch (err) {
    app.innerHTML = `
      <div class="error-box">
        <p><strong>Something went wrong loading the installer.</strong> ${err.message}</p>
        <p>Try reloading. If it keeps happening, every device also has a standalone installer
           linked from its <a href="https://github.com/orgs/ApolloAutomation/repositories">GitHub repository</a>.</p>
      </div>`;
    return;
  }
  const id = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  const device = registry.devices.find((d) => d.id === id);
  if (device) {
    renderDevice(app, device);
  } else {
    renderHub(app, registry);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
