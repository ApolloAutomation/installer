const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'devices.json'), 'utf8'));

const manifestFor = (file, version = '1.0.0') => JSON.stringify({
  name: 't', version,
  builds: [{ chipFamily: 'ESP32', parts: [{ path: file, offset: 0 }] }],
});

// Keep the suite hermetic: no live GitHub API calls (60/hour/IP, shared on CI
// runners), manifests or configs unless a test routes its own. Playwright runs
// the most recently registered matching route first, so per-test routes win.
test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.route('https://apolloautomation.github.io/**/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('firmware.bin') }));
  await page.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'esphome:\n  name: stub\n' }));
});

// Serve `body` after `ms` and expose when it was delivered, so stale-write tests
// assert right after the late response lands instead of sleeping past it.
function lateRoute(ms, body, contentType) {
  let delivered;
  const done = new Promise((r) => { delivered = r; });
  const handler = async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ contentType, body });
    delivered();
  };
  return { handler, done };
}
// Let the page finish handling a response that just arrived.
const settle = (page) => page.evaluate(() => new Promise((r) =>
  requestAnimationFrame(() => requestAnimationFrame(r))));

// Pin the WebSerial path either way so tests don't depend on the browser build.
const forceSerial = (page) => page.addInitScript(() => {
  if (!('serial' in navigator)) {
    Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
  }
});
const noSerial = (page) => page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined });
});

test('hub renders a card for every registry device', async ({ page }) => {
  await page.goto('/');
  for (const d of registry.devices) {
    await expect(page.locator(`a.device-card[href="#/${d.id}"] h3`)).toHaveText(d.name);
  }
});

test('theme toggle is revealed once the script wires it up', async ({ page }) => {
  await page.goto('/');
  // CSS hides .theme-btn until theme.js sets an explicit visibility; a regression
  // to `visibility = ''` would fall back to the hidden rule and fail this.
  await expect(page.locator('#theme-toggle')).toBeVisible();
});

test('category filter shows exactly the cards in that category', async ({ page }) => {
  await page.goto('/');
  // Pick a category deterministically (most-populated, alphabetical tiebreak)
  // instead of depending on devices[0]'s position in the registry.
  const byCat = {};
  for (const d of registry.devices) (byCat[d.category] ||= []).push(d.id);
  const cat = Object.keys(byCat)
    .sort((a, b) => byCat[b].length - byCat[a].length || a.localeCompare(b))[0];
  const expectedIds = byCat[cat].slice().sort();

  await page.locator(`.filters button[data-cat="${cat}"]`).click();
  const visibleIds = (await page.locator('a.device-card:visible')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href'))))
    .map((h) => h.replace('#/', '')).sort();
  // Assert *which* cards show, not just how many.
  expect(visibleIds).toEqual(expectedIds);

  await page.locator('.filters button[data-cat="all"]').click();
  await expect(page.locator('a.device-card:visible')).toHaveCount(registry.devices.length);
});

test('filter pills expose aria-pressed reflecting the active filter', async ({ page }) => {
  await page.goto('/');
  const all = page.locator('.filters button[data-cat="all"]');
  const cat = registry.devices[0].category;
  const pill = page.locator(`.filters button[data-cat="${cat}"]`);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await pill.click();
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
});

test('channel/variant toggles expose aria-pressed reflecting the selection', async ({ page }) => {
  const d = registry.devices.find((x) => x.firmware.beta || Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-channel/variant device in registry');
  await page.goto(`/#/${d.id}`);
  const seg = d.firmware.beta ? 'channel-seg' : 'variant-seg';
  const attr = d.firmware.beta ? 'data-channel' : 'data-variant';
  const keys = d.firmware.beta ? ['stable', 'beta'] : Object.keys(d.firmware.stable);
  const firstBtn = page.locator(`#${seg} button[${attr}="${keys[0]}"]`);
  const secondBtn = page.locator(`#${seg} button[${attr}="${keys[1]}"]`);
  await expect(firstBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(secondBtn).toHaveAttribute('aria-pressed', 'false');
  await secondBtn.click();
  await expect(secondBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(firstBtn).toHaveAttribute('aria-pressed', 'false');
});

test('deep link renders the device wizard', async ({ page }) => {
  const d = registry.devices[0];
  await forceSerial(page);
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.device-head h1')).toHaveText(d.name);
  await expect(page.locator('esp-web-install-button')).toHaveAttribute(
    'manifest', d.firmware.stable[Object.keys(d.firmware.stable)[0]]);
});

test('channel/variant toggles rewire the install button', async ({ page }) => {
  const d = registry.devices.find((x) => x.firmware.beta || Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-channel/variant device in registry');
  await page.goto(`/#/${d.id}`);
  if (d.firmware.beta) {
    await page.locator('#channel-seg button[data-channel="beta"]').click();
    const v = Object.keys(d.firmware.beta)[0];
    await expect(page.locator('esp-web-install-button')).toHaveAttribute('manifest', d.firmware.beta[v]);
  } else {
    const variants = Object.keys(d.firmware.stable);
    await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
    await expect(page.locator('esp-web-install-button')).toHaveAttribute('manifest', d.firmware.stable[variants[1]]);
  }
});

test('changing variant reuses the install button instead of recreating it', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  await forceSerial(page);
  await page.goto(`/#/${d.id}`);

  // Tag the initially-rendered install button so we can tell if it survives.
  await page.evaluate(() => {
    document.querySelector('#install-slot esp-web-install-button').dataset.tag = 'orig';
  });

  const variants = Object.keys(d.firmware.stable);
  const other = variants[1];
  await page.locator(`#variant-seg button[data-variant="${other}"]`).click();

  // Same element must survive (tag intact) with its manifest updated in place.
  await expect(page.locator('#install-slot esp-web-install-button'))
    .toHaveAttribute('data-tag', 'orig');
  await expect(page.locator('#install-slot esp-web-install-button'))
    .toHaveAttribute('manifest', d.firmware.stable[other]);
});

test('manual fallback renders when WebSerial is unavailable', async ({ page }) => {
  await noSerial(page);
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.fallback')).toBeVisible();
  await expect(page.locator('esp-web-install-button')).toHaveCount(0);
  // esptool v5 spells the subcommand `write-flash` and needs an explicit --port.
  const esptool = page.locator('.fallback code', { hasText: 'esptool' });
  await expect(esptool).toContainText('write-flash');
  await expect(esptool).toContainText('--port');
});

test('late manifest fetch for a deselected variant does not overwrite the fallback list', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  const variants = Object.keys(d.firmware.stable);
  await noSerial(page);
  // First variant's manifest responds slowly, after the user has moved on.
  const slow = lateRoute(1500, manifestFor('wifi.bin'), 'application/json');
  await page.route(d.firmware.stable[variants[0]], slow.handler);
  await page.route(d.firmware.stable[variants[1]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('eth.bin') }));
  await page.goto(`/#/${d.id}`);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await slow.done;
  await settle(page);
  await expect(page.locator('#fallback-files a[href$="eth.bin"]')).toHaveCount(1);
  await expect(page.locator('#fallback-files a[href$="wifi.bin"]')).toHaveCount(0);
});

test('late manifest fetch does not leak into another device page after navigation', async ({ page }) => {
  const old = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!old, 'no multi-variant device in registry');
  const next = registry.devices.find((x) => x.id !== old.id);
  await noSerial(page);
  // Old device's manifest responds slowly — after the user has navigated away.
  const slow = lateRoute(1500, manifestFor('old-device.bin'), 'application/json');
  await page.route(old.firmware.stable[Object.keys(old.firmware.stable)[0]], slow.handler);
  await page.route(next.firmware.stable[Object.keys(next.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('new-device.bin') }));
  await page.goto(`/#/${old.id}`);
  await expect(page.locator('.fallback')).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, `#/${next.id}`);
  await expect(page.locator('.device-head h1')).toHaveText(next.name);
  await slow.done;
  await settle(page);
  // The stale response must not overwrite the new device's fallback list.
  await expect(page.locator('#fallback-files a[href$="old-device.bin"]')).toHaveCount(0);
  await expect(page.locator('#fallback-files a[href$="new-device.bin"]')).toHaveCount(1);
});

test('release notes render from the GitHub API', async ({ page }) => {
  const d = registry.devices[0];
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('a.bin', '99.9.9.9') }));
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { name: 'v99.9.9.9', tag_name: '99.9.9.9', body: '- test note line', html_url: 'https://example.com/rel' } }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes summary')).toContainText('v99.9.9.9');
});

test('release notes degrade to a releases link on API failure', async ({ page }) => {
  const d = registry.devices[0];
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes .fail-link')).toHaveAttribute(
    'href', `https://github.com/${d.repo}/releases`);
});

test('release notes ignore an off-allowlist API url and use the safe releases href', async ({ page }) => {
  const d = registry.devices[0];
  // A compromised or unexpected html_url must never become the "Full release" link;
  // anything not on github.com falls back to the device's releases page.
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('a.bin', '1.2.3.4') }));
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { name: 'v1.2.3.4', tag_name: '1.2.3.4', body: '- note', html_url: 'https://evil.example.com/pwn' } }));
  await page.goto(`/#/${d.id}`);
  const full = page.locator('.release-notes a', { hasText: 'Full release' });
  await expect(full).toHaveAttribute('href', `https://github.com/${d.repo}/releases`);
});

test('release notes follow the selected variant repo (per-variant repos override)', async ({ page }) => {
  const d = registry.devices.find((x) => x.repos && x.repos.stable);
  test.skip(!d, 'no device with a per-variant repos override');
  // Works whichever way round the override sits: the default variant may itself be
  // the overridden one, so compare the first variant against the first one that
  // resolves to a different repo.
  const variants = Object.keys(d.firmware.stable);
  const repoOf = (v) => d.repos.stable[v] || d.repo;
  const startVariant = variants[0];
  const otherVariant = variants.find((v) => repoOf(v) !== repoOf(startVariant));
  test.skip(!otherVariant, 'all variants resolve to the same repo');

  // Force the API-failure path so the deterministic .fail-link (built from the
  // resolved repo) is what we assert on.
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);

  // Default variant resolves to its own repo (device-level or override).
  await expect(page.locator('.release-notes .fail-link'))
    .toHaveAttribute('href', `https://github.com/${repoOf(startVariant)}/releases`);

  // Selecting a variant with a different repo must re-render release notes against it.
  await page.locator(`#variant-seg button[data-variant="${otherVariant}"]`).click();
  await expect(page.locator('.release-notes .fail-link'))
    .toHaveAttribute('href', `https://github.com/${repoOf(otherVariant)}/releases`);
});

test('clicking the already-selected variant makes no extra release-notes fetch', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  let apiCalls = 0;
  await page.route('https://api.github.com/**', (route) => {
    apiCalls++;
    route.fulfill({ json: { name: 'v1.0.0.0', body: 'notes', html_url: 'https://github.com/a/b/releases/tag/v1' } });
  });
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes')).toBeVisible(); // initial fetch completed
  const callsAfterLoad = apiCalls;
  const active = Object.keys(d.firmware.stable)[0]; // the default/active variant
  await page.locator(`#variant-seg button[data-variant="${active}"]`).click();
  await page.waitForTimeout(300);
  expect(apiCalls).toBe(callsAfterLoad); // no new fetch on same-variant click
});

test('switching variant never blanks the release-notes box', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { name: 'v1.0.0.0', body: 'notes', html_url: 'https://github.com/a/b/releases/tag/v1' } }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes')).toBeVisible();
  // Record if #release-slot ever becomes empty during the switch.
  await page.evaluate(() => {
    window.__wentEmpty = false;
    const slot = document.getElementById('release-slot');
    new MutationObserver(() => { if (slot.innerHTML.trim() === '') window.__wentEmpty = true; })
      .observe(slot, { childList: true });
  });
  const other = Object.keys(d.firmware.stable)[1];
  await page.locator(`#variant-seg button[data-variant="${other}"]`).click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__wentEmpty)).toBe(false);
});

test('header GitHub link and classic-installer links follow the selected variant', async ({ page }) => {
  const d = registry.devices.find((x) => x.installers && x.installers.stable
    && Object.values(x.installers.stable).some((v) => v === null));
  test.skip(!d, 'no device that hides a classic installer for a variant');
  // The variant that hides its classic installer may be the default one, so assert
  // the link toggling in whichever direction the registry happens to order them.
  const variants = Object.keys(d.firmware.stable);
  const installerOf = (v) => (v in d.installers.stable
    ? d.installers.stable[v] : d.githubPagesInstaller);
  const repoOf = (v) => (d.repos && d.repos.stable && d.repos.stable[v]) || d.repo;
  const startVariant = variants[0];
  const otherVariant = variants.find((v) => !installerOf(v) !== !installerOf(startVariant));
  test.skip(!otherVariant, 'every variant has the same classic-installer visibility');

  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);

  // Default variant: header GitHub and Classic installer reflect that variant.
  await expect(page.locator('.links a', { hasText: 'GitHub' }))
    .toHaveAttribute('href', `https://github.com/${repoOf(startVariant)}`);
  await expect(page.locator('.links a', { hasText: 'Classic installer' }))
    .toHaveCount(installerOf(startVariant) ? 1 : 0);

  // Select the variant on the other side of the null/non-null installer split.
  await page.locator(`#variant-seg button[data-variant="${otherVariant}"]`).click();

  // Header GitHub link follows that variant's repo; installer link flips visibility.
  await expect(page.locator('.links a', { hasText: 'GitHub' }))
    .toHaveAttribute('href', `https://github.com/${repoOf(otherVariant)}`);
  await expect(page.locator('.links a', { hasText: 'Classic installer' }))
    .toHaveCount(installerOf(otherVariant) ? 1 : 0);
});

test('variant note follows the selected variant', async ({ page }) => {
  const d = registry.devices.find((x) => x.variantNotes && x.variantNotes.stable
    && Object.keys(x.variantNotes.stable).length > 1);
  test.skip(!d, 'no device with notes on more than one variant');
  const [first, second] = Object.keys(d.firmware.stable);
  await page.goto(`/#/${d.id}`);
  const note = page.locator('.variant-note');
  await expect(note).toHaveText(d.variantNotes.stable[first]);
  await page.locator(`#variant-seg button[data-variant="${second}"]`).click();
  await expect(note).toHaveText(d.variantNotes.stable[second]);
});

test('step 3 shows the Home Assistant hand-off', async ({ page }) => {
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('#step-done')).toContainText('Home Assistant');
  await expect(page.locator(`#step-done a[href="${d.wiki}"]`)).toBeVisible();
});

test('step 3 explains taking control in the ESPHome Device Builder', async ({ page }) => {
  const d = registry.devices.find((x) => !x.platform || x.platform === 'esphome');
  test.skip(!d, 'no esphome device in registry');
  await page.goto(`/#/${d.id}`);
  const done = page.locator('#step-done');
  await expect(done).toContainText('ESPHome Device Builder');
  await expect(done).toContainText('Take control');
  await expect(done.locator('code')).toContainText('dashboard_import');
});

test('step 3 gives WLED instructions on a WLED device, not ESPHome ones', async ({ page }) => {
  const d = registry.devices.find((x) => x.platform === 'wled');
  test.skip(!d, 'no wled device in registry');
  await page.goto(`/#/${d.id}`);
  const done = page.locator('#step-done');
  await expect(done).toContainText('discovered');
  await expect(done).toContainText('4.3.2.1');
  await expect(done).toContainText('Manual OTA Update');
  // The Apollo builds ship an OPEN hotspot, not the stock WLED-AP/wled1234 pair.
  await expect(done).not.toContainText('wled1234');
  await expect(done).not.toContainText('WLED-AP');
  // The ESPHome adoption path does not exist on a WLED device.
  await expect(done).not.toContainText('ESPHome Device Builder');
  await expect(done).not.toContainText('Take control');
  await expect(done).not.toContainText('dashboard_import');
});

test('step 3 follows a per-variant platform override', async ({ page }) => {
  // No shipping device mixes ecosystems yet, so synthesize one: the M-1 hardware
  // can run ESPHome, and when such a build is offered the registry only needs a
  // `platforms` entry for that variant.
  const src = registry.devices.find((x) => x.platform === 'wled');
  test.skip(!src, 'no wled device in registry');
  const d = JSON.parse(JSON.stringify(src));
  const wledVariant = Object.keys(d.firmware.stable)[0];
  const espVariant = 'ESPHome (test)';
  d.firmware.stable[espVariant] = d.firmware.stable[wledVariant];
  d.platforms = { stable: { [espVariant]: 'esphome' } };

  await page.route('**/devices.json', (route) => route.fulfill({ json: { devices: [d] } }));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);

  const done = page.locator('#step-done');
  await expect(done).toContainText('4.3.2.1');

  await page.locator(`#variant-seg button[data-variant="${espVariant}"]`).click();
  await expect(done).toContainText('ESPHome Device Builder');
  await expect(done).not.toContainText('4.3.2.1');

  // And back, so the override is not a one-way trip.
  await page.locator(`#variant-seg button[data-variant="${wledVariant}"]`).click();
  await expect(done).toContainText('4.3.2.1');
});

function blobFromRaw(raw) {
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  // Mirror the app's rawToBlob fallback: on a non-match, return the raw URL rather
  // than throwing on m[1], so a future off-pattern URL fails as a clean assertion.
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}` : raw;
}
function defaultSel(d) {
  const channels = Object.keys(d.firmware);
  const channel = channels.includes('stable') ? 'stable' : channels[0];
  const variant = Object.keys(d.firmware[channel])[0];
  return { channel, variant, url: d.config && d.config[channel] && d.config[channel][variant] };
}

test('device config: reflash section renders the fetched YAML and derived GitHub link', async ({ page }) => {
  const d = registry.devices.find((x) => x.config && defaultSel(x).url);
  test.skip(!d, 'no device has a config for its default selection');
  const { url } = defaultSel(d);
  await page.route(url, (route) => route.fulfill({ contentType: 'text/plain', body: 'esphome:\n  name: mock-cfg\n' }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.config')).toBeVisible();
  await expect(page.locator('.config-yaml code')).toContainText('mock-cfg');
  await expect(page.locator('.config-github')).toHaveAttribute('href', blobFromRaw(url));
});

test('device config: switching variant swaps the config', async ({ page }) => {
  const d = registry.devices.find((x) => x.config && x.config.stable && Object.keys(x.config.stable).length > 1);
  test.skip(!d, 'no multi-variant config device');
  const variants = Object.keys(d.config.stable);
  for (const v of variants) {
    await page.route(d.config.stable[v], (route) =>
      route.fulfill({ contentType: 'text/plain', body: `esphome:\n  name: cfg-${v}\n` }));
  }
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.config-yaml code')).toContainText(`cfg-${variants[0]}`);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await expect(page.locator('.config-yaml code')).toContainText(`cfg-${variants[1]}`);
});

test('device config: a slow fetch for a deselected variant does not overwrite', async ({ page }) => {
  const d = registry.devices.find((x) => x.config && x.config.stable && Object.keys(x.config.stable).length > 1);
  test.skip(!d, 'no multi-variant config device');
  const variants = Object.keys(d.config.stable);
  const slow = lateRoute(1500, 'esphome:\n  name: cfg-slow-0\n', 'text/plain');
  await page.route(d.config.stable[variants[0]], slow.handler);
  await page.route(d.config.stable[variants[1]], (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'esphome:\n  name: cfg-fast-1\n' }));
  await page.goto(`/#/${d.id}`);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await slow.done;
  await settle(page);
  await expect(page.locator('.config-yaml code')).toContainText('cfg-fast-1');
  await expect(page.locator('.config-yaml code')).not.toContainText('cfg-slow-0');
});

test('device config: download uses the real filename', async ({ page }) => {
  const d = registry.devices.find((x) => x.config && defaultSel(x).url);
  test.skip(!d, 'no device has a config for its default selection');
  const { url } = defaultSel(d);
  await page.route(url, (route) => route.fulfill({ contentType: 'text/plain', body: 'esphome:\n' }));
  await page.goto(`/#/${d.id}`);
  await page.locator('.config summary').click(); // expand so the button is visible
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.config-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe(url.split('/').pop());
});

test('device config: no section when the device has no config', async ({ page }) => {
  const d = registry.devices.find((x) => !x.config);
  test.skip(!d, 'every device has a config');
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.config')).toHaveCount(0);
});

test('single-firmware devices show the "nothing to choose" note above the release/config sections', async ({ page }) => {
  const d = registry.devices.find((x) => {
    const chans = Object.keys(x.firmware);
    return chans.length === 1 && Object.keys(x.firmware[chans[0]]).length === 1;
  });
  test.skip(!d, 'no single-firmware device in registry');
  await page.goto(`/#/${d.id}`);
  const step = page.locator('.device-page .step').first();
  await expect(step.getByText('nothing to choose here')).toBeVisible();
  // The note must render up under the picker, above the "What's new" and reflash sections.
  const noteBeforeRelease = await step.evaluate((el) => {
    const note = [...el.querySelectorAll('p')].find((p) => p.textContent.includes('nothing to choose'));
    const rel = el.querySelector('#release-slot');
    return !!(note && rel && (note.compareDocumentPosition(rel) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(noteBeforeRelease).toBe(true);
});

test('every device and variant puts its own manifest on the install button', async ({ page }) => {
  // The site's worst failure mode is a wrong-firmware link, so walk the whole
  // registry instead of sampling one device.
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await forceSerial(page);
  await page.goto('/');
  for (const d of registry.devices) {
    await page.evaluate((hash) => { location.hash = hash; }, `#/${d.id}`);
    await expect(page.locator('.device-head h1')).toHaveText(d.name);
    await expect(page).toHaveTitle(`${d.name} · Apollo Installer`);
    const channels = Object.keys(d.firmware);
    for (const channel of channels) {
      if (channels.length > 1) await page.locator(`#channel-seg button[data-channel="${channel}"]`).click();
      const variants = Object.keys(d.firmware[channel]);
      for (const variant of variants) {
        if (variants.length > 1) await page.locator(`#variant-seg button[data-variant="${variant}"]`).click();
        await expect(page.locator('#install-slot esp-web-install-button'))
          .toHaveAttribute('manifest', d.firmware[channel][variant]);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('every hub card image loads', async ({ page }) => {
  await page.goto('/');
  const imgs = page.locator('a.device-card img');
  await expect(imgs).toHaveCount(registry.devices.length);
  for (const img of await imgs.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  }
});

test('step 3 says there is nothing to add for a standalone (no Wi-Fi) variant', async ({ page }) => {
  const d = registry.devices.find((x) => x.platforms && x.platforms.stable
    && Object.values(x.platforms.stable).includes('standalone'));
  test.skip(!d, 'no standalone variant in registry');
  const standalone = Object.keys(d.platforms.stable).find((v) => d.platforms.stable[v] === 'standalone');
  const networked = Object.keys(d.firmware.stable).find((v) => v !== standalone);
  await page.goto(`/#/${d.id}`);
  const done = page.locator('#step-done');
  await page.locator(`#variant-seg button[data-variant="${standalone}"]`).click();
  await expect(done.locator('h2')).toContainText("You're done");
  await expect(done).toContainText('nothing to add');
  await expect(done).not.toContainText('ESPHome');
  await expect(done).not.toContainText('Devices & services');
  await page.locator(`#variant-seg button[data-variant="${networked}"]`).click();
  await expect(done.locator('h2')).toContainText('Add to Home Assistant');
});

test('a beta channel swaps manifests, keeps the variant on re-click, and shows prerelease notes', async ({ page }) => {
  const src = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!src, 'no multi-variant device in registry');
  // No device ships a beta channel today, so synthesize one.
  const d = JSON.parse(JSON.stringify(src));
  const variants = Object.keys(d.firmware.stable);
  d.firmware.beta = Object.fromEntries(variants.map((v) =>
    [v, d.firmware.stable[v].replace('/manifest.json', '-beta/manifest.json')]));
  await page.route('**/devices.json', (route) => route.fulfill({ json: { devices: [d] } }));
  await page.route('**/*-beta/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('b.bin', '2.1.0-beta') }));
  await page.route(`https://api.github.com/repos/${d.repo}/releases?per_page=15`, (route) => route.fulfill({ json: [
    { name: 'v2.0.0', tag_name: '2.0.0', prerelease: false, body: 'stable', html_url: 'https://github.com/a/b/releases/tag/2.0.0' },
    { name: 'v2.1.0-beta', tag_name: '2.1.0-beta', prerelease: true, body: 'beta', html_url: 'https://github.com/a/b/releases/tag/2.1.0-beta' },
  ] }));
  await forceSerial(page);
  await page.goto(`/#/${d.id}`);
  const btn = page.locator('#install-slot esp-web-install-button');
  await expect(btn).toHaveAttribute('manifest', d.firmware.stable[variants[0]]);

  await page.locator('#channel-seg button[data-channel="beta"]').click();
  await expect(btn).toHaveAttribute('manifest', d.firmware.beta[variants[0]]);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await expect(btn).toHaveAttribute('manifest', d.firmware.beta[variants[1]]);
  await expect(page.locator('.release-notes summary')).toContainText('v2.1.0-beta');

  // Re-clicking the active channel keeps the chosen variant.
  await page.locator('#channel-seg button[data-channel="beta"]').click();
  await expect(btn).toHaveAttribute('manifest', d.firmware.beta[variants[1]]);

  await page.locator('#channel-seg button[data-channel="stable"]').click();
  await expect(btn).toHaveAttribute('manifest', d.firmware.stable[variants[0]]);
  await expect(page.locator('#channel-seg button[data-channel="stable"]')).toHaveAttribute('aria-pressed', 'true');
});

test('release notes give way to the version when the latest release is another build', async ({ page }) => {
  // e.g. WLED-MM-M1's only release predates the builds its manifests serve.
  const d = registry.devices[0];
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('a.bin', '2.0.0.1') }));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: {
    name: 'Initial release', tag_name: '1.0.0.1', body: 'old', html_url: 'https://github.com/a/b/releases/tag/1.0.0.1' } }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes')).toContainText('Installs build 2.0.0.1');
  await expect(page.locator('.release-notes summary')).toHaveCount(0);
  await expect(page.locator('.release-notes a', { hasText: 'Full release' })).toHaveCount(0);
});

test("an older build doesn't borrow the latest release's notes via its compare link", async ({ page }) => {
  // Every release body ends with a "Full Changelog" link naming the previous version.
  const d = registry.devices[0];
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('a.bin', '26.7.14.1') }));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: {
    name: 'Release 26.10.12.1', tag_name: '26.10.12.1', html_url: 'https://github.com/a/b/releases/tag/26.10.12.1',
    body: '- fixes\n\n**Full Changelog**: https://github.com/a/b/compare/26.7.14.1...26.10.12.1' } }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes.version-only')).toContainText('Installs build 26.7.14.1');
});

test('release notes that name the flashed version still show (bundle-style tags)', async ({ page }) => {
  const d = registry.devices[0];
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('a.bin', '16.0.1') }));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: {
    name: 'Firmware bundle b8', tag_name: 'm1-b8', body: 'v16.0.1 with fixes', html_url: 'https://github.com/a/b/releases/tag/m1-b8' } }));
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.release-notes summary')).toContainText('Firmware bundle b8');
});

test('fallback file list keeps only https parts and shows each offset', async ({ page }) => {
  const d = registry.devices[0];
  await noSerial(page);
  await page.route(d.firmware.stable[Object.keys(d.firmware.stable)[0]], (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: '1', builds: [{ chipFamily: 'ESP32', parts: [
      { path: 'my file.bin', offset: 0 },
      { path: 'javascript:alert(1)', offset: 0 },
      { path: 'boot.bin', offset: 4096 },
    ] }] }),
  }));
  await page.goto(`/#/${d.id}`);
  const links = page.locator('#fallback-files a');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveText('my file.bin');
  await expect(links.first()).toHaveAttribute('href', /\/my%20file\.bin$/);
  await expect(page.locator('#fallback-files')).toContainText('0x1000');
});

test('hash routing: unknown ids show the hub with a notice; case and trailing slash are ignored', async ({ page }) => {
  await page.goto('/#/no-such-device');
  await expect(page.locator('.device-grid')).toBeVisible();
  await expect(page.locator('#hub-notice')).toContainText('no-such-device');
  // The hash is user input and must stay text.
  await page.goto('/#/<b>bold</b>');
  await expect(page.locator('#hub-notice')).toContainText('<b>bold</b>');
  await expect(page.locator('#hub-notice b')).toHaveCount(0);
  const d = registry.devices[0];
  await page.goto(`/#/${d.id.toUpperCase()}/`);
  await expect(page.locator('.device-head h1')).toHaveText(d.name);
  await page.goto('/#/');
  await expect(page.locator('#hub-notice')).toHaveCount(0);
  await expect(page).toHaveTitle('Apollo Installer');
});

test('opening a device moves keyboard focus to its heading', async ({ page }) => {
  const d = registry.devices[0];
  await page.goto('/');
  await page.locator(`a.device-card[href="#/${d.id}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.device-head h1')).toBeFocused();
});

test('firmware picker is a labelled group', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  await page.goto(`/#/${d.id}`);
  await expect(page.getByRole('group', { name: 'Variant' })).toBeVisible();
});

test('theme toggle cycles system, dark, light and remembers the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  const btn = page.locator('#theme-toggle');
  const stored = () => page.evaluate(() => localStorage.getItem('theme'));
  await expect(html).not.toHaveAttribute('data-theme', 'dark');
  await expect(btn).toHaveAttribute('aria-label', /System theme/);

  await btn.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await stored()).toBe('dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await btn.click();
  await expect(html).not.toHaveAttribute('data-theme', 'dark');
  expect(await stored()).toBe('light');

  await btn.click();
  expect(await stored()).toBeNull();
  await expect(btn).toHaveAttribute('aria-label', /System theme/);
});

test('every page fits a 360px phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  for (const hash of ['#/', ...registry.devices.map((d) => `#/${d.id}`)]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await expect(page.locator('h1').first()).toBeVisible();
    const [scroll, client] = await page.evaluate(() =>
      [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, hash).toBeLessThanOrEqual(client);
  }
});
