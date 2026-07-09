const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'devices.json'), 'utf8'));

test('hub renders a card for every registry device', async ({ page }) => {
  await page.goto('/');
  for (const d of registry.devices) {
    await expect(page.locator(`a.device-card[href="#/${d.id}"] h3`)).toHaveText(d.name);
  }
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

test('manual fallback renders when WebSerial is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined });
  });
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('.fallback')).toBeVisible();
  await expect(page.locator('esp-web-install-button')).toHaveCount(0);
  // esptool v5 spells the subcommand `write-flash` and needs an explicit --port.
  await expect(page.locator('.fallback code')).toContainText('write-flash');
  await expect(page.locator('.fallback code')).toContainText('--port');
});

test('late manifest fetch for a deselected variant does not overwrite the fallback list', async ({ page }) => {
  const d = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!d, 'no multi-variant device in registry');
  const variants = Object.keys(d.firmware.stable);
  const manifestFor = (file) => JSON.stringify({
    name: 't', version: '1',
    builds: [{ chipFamily: 'ESP32', parts: [{ path: file, offset: 0 }] }],
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined });
  });
  // First variant's manifest responds slowly, after the user has moved on.
  await page.route(d.firmware.stable[variants[0]], async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ contentType: 'application/json', body: manifestFor('wifi.bin') });
  });
  await page.route(d.firmware.stable[variants[1]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('eth.bin') }));
  await page.goto(`/#/${d.id}`);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await page.waitForTimeout(2500);
  await expect(page.locator('#fallback-files a[href$="eth.bin"]')).toHaveCount(1);
  await expect(page.locator('#fallback-files a[href$="wifi.bin"]')).toHaveCount(0);
});

test('late manifest fetch does not leak into another device page after navigation', async ({ page }) => {
  const old = registry.devices.find((x) => Object.keys(x.firmware.stable).length > 1);
  test.skip(!old, 'no multi-variant device in registry');
  const next = registry.devices.find((x) => x.id !== old.id);
  const manifestFor = (file) => JSON.stringify({
    name: 't', version: '1',
    builds: [{ chipFamily: 'ESP32', parts: [{ path: file, offset: 0 }] }],
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined });
  });
  // Old device's manifest responds slowly — after the user has navigated away.
  await page.route(old.firmware.stable[Object.keys(old.firmware.stable)[0]], async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ contentType: 'application/json', body: manifestFor('old-device.bin') });
  });
  await page.route(next.firmware.stable[Object.keys(next.firmware.stable)[0]], (route) =>
    route.fulfill({ contentType: 'application/json', body: manifestFor('new-device.bin') }));
  await page.goto(`/#/${old.id}`);
  await expect(page.locator('.fallback')).toBeVisible();
  await page.evaluate((hash) => { location.hash = hash; }, `#/${next.id}`);
  await expect(page.locator('.device-head h1')).toHaveText(next.name);
  await page.waitForTimeout(2500);
  // The stale response must not overwrite the new device's fallback list.
  await expect(page.locator('#fallback-files a[href$="old-device.bin"]')).toHaveCount(0);
  await expect(page.locator('#fallback-files a[href$="new-device.bin"]')).toHaveCount(1);
});

test('release notes render from the GitHub API', async ({ page }) => {
  const d = registry.devices[0];
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { name: 'v99.9.9.9', body: '- test note line', html_url: 'https://example.com/rel' } }));
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
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { name: 'v1.2.3.4', body: '- note', html_url: 'https://evil.example.com/pwn' } }));
  await page.goto(`/#/${d.id}`);
  const full = page.locator('.release-notes a', { hasText: 'Full release' });
  await expect(full).toHaveAttribute('href', `https://github.com/${d.repo}/releases`);
});

test('step 3 shows the Home Assistant hand-off', async ({ page }) => {
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('#step-done')).toContainText('Home Assistant');
  await expect(page.locator(`#step-done a[href="${d.wiki}"]`)).toBeVisible();
});

test('step 3 explains taking control in the ESPHome Dashboard', async ({ page }) => {
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  const done = page.locator('#step-done');
  await expect(done).toContainText('ESPHome Dashboard');
  await expect(done).toContainText('Take control');
  await expect(done.locator('code')).toContainText('dashboard_import');
});
