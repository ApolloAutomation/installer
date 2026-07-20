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
  // Force the WebSerial path (headless Chromium lacks navigator.serial) so the
  // esp-web-install-button renders.
  await page.addInitScript(() => {
    if (!('serial' in navigator)) {
      Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
    }
  });
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

test('release notes follow the selected variant repo (per-variant repos override)', async ({ page }) => {
  const d = registry.devices.find((x) => x.repos && x.repos.stable);
  test.skip(!d, 'no device with a per-variant repos override');
  const overrideVariant = Object.keys(d.repos.stable)[0];
  const overrideRepo = d.repos.stable[overrideVariant];
  const defaultVariant = Object.keys(d.firmware.stable)[0];
  test.skip(overrideVariant === defaultVariant, 'override is on the default variant');

  // Force the API-failure path so the deterministic .fail-link (built from the
  // resolved repo) is what we assert on.
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);

  // Default variant resolves to the device-level repo.
  await expect(page.locator('.release-notes .fail-link'))
    .toHaveAttribute('href', `https://github.com/${d.repo}/releases`);

  // Selecting the override variant must re-render release notes against the override repo.
  await page.locator(`#variant-seg button[data-variant="${overrideVariant}"]`).click();
  await expect(page.locator('.release-notes .fail-link'))
    .toHaveAttribute('href', `https://github.com/${overrideRepo}/releases`);
});

test('header GitHub link and classic-installer links follow the selected variant', async ({ page }) => {
  const d = registry.devices.find((x) => x.installers && x.installers.stable
    && Object.values(x.installers.stable).some((v) => v === null));
  test.skip(!d, 'no device that hides a classic installer for a variant');
  const hiddenVariant = Object.keys(d.installers.stable).find((k) => d.installers.stable[k] === null);
  const defaultVariant = Object.keys(d.firmware.stable)[0];
  test.skip(hiddenVariant === defaultVariant, 'hidden installer is on the default variant');
  const overrideRepo = d.repos && d.repos.stable && d.repos.stable[hiddenVariant];

  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 403 }));
  await page.goto(`/#/${d.id}`);

  // Default variant: header GitHub = device repo, Classic installer link present.
  await expect(page.locator('.links a', { hasText: 'GitHub' }))
    .toHaveAttribute('href', `https://github.com/${d.repo}`);
  await expect(page.locator('.links a', { hasText: 'Classic installer' })).toHaveCount(1);

  // Select the variant whose installer is null.
  await page.locator(`#variant-seg button[data-variant="${hiddenVariant}"]`).click();

  // Header GitHub link now points at the override repo (if set); Classic installer link is gone.
  if (overrideRepo) {
    await expect(page.locator('.links a', { hasText: 'GitHub' }))
      .toHaveAttribute('href', `https://github.com/${overrideRepo}`);
  }
  await expect(page.locator('.links a', { hasText: 'Classic installer' })).toHaveCount(0);
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
  await page.route(d.config.stable[variants[0]], async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ contentType: 'text/plain', body: 'esphome:\n  name: cfg-slow-0\n' });
  });
  await page.route(d.config.stable[variants[1]], (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'esphome:\n  name: cfg-fast-1\n' }));
  await page.goto(`/#/${d.id}`);
  await page.locator(`#variant-seg button[data-variant="${variants[1]}"]`).click();
  await page.waitForTimeout(2500);
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
