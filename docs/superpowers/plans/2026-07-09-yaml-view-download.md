# YAML View / Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each device page, view and download the ESPHome config (YAML) for the selected firmware variant, so a user can rebuild/reflash and have the device onboard like a factory unit.

**Architecture:** A `config` map in `devices.json` mirrors `firmware` (channel → variant → raw YAML URL). `js/views/device.js` gains a collapsible block in step 1 that follows the variant selection: it fetches the raw YAML live from `raw.githubusercontent.com`, shows it (via `textContent`, which escapes), offers a Blob download with the real filename, and links to the derived GitHub blob URL. The three ad-hoc async staleness guards are unified into one render-epoch counter. The validator gains a reachability + shape check for config URLs.

**Tech Stack:** Vanilla ES modules (no build), Python stdlib validator, Playwright, GitHub raw hosting.

## Global Constraints

- No build step, no framework, no dependency outside `tests/`. (AGENTS.md)
- `devices.json` is the single source of truth; views, scripts, and tests all read it.
- Runtime-fetched content (the YAML) must be escaped before display. Here we set it via
  `element.textContent`, which is inherently safe; registry-derived values (variant key,
  filename, `device.wiki`, `device.name`) are trusted repo content and interpolated as-is,
  matching existing code.
- Live fetch only — **no cache directory**, so `.github/workflows/pages.yml` cp-list is
  **unchanged**. Do not add a new top-level runtime file/dir.
- A wrong-config link is a firmware-safety failure mode: async config renders must guard
  against a selection change mid-fetch (the render-epoch mechanism).
- Commits: author `8107750+bharvey88@users.noreply.github.com`; end messages with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; NEVER `Co-Authored-By: Claude`.
  Use `git commit -F <ascii temp file>` (Windows PowerShell), never `-m` multiline.
- Branch: `feat/3-yaml-view-download` (already created off `main`). PR targets `main`.
- Tests keyed off `devices.json` (data-driven), never hardcoded device ids.

**Config URL map to add (Task 2), all `https://raw.githubusercontent.com/ApolloAutomation/<REPO>/main/Integrations/ESPHome/<FILE>`:**

| device | channel/variant | file |
|--------|-----------------|------|
| msr-1 | stable/Standard | MSR-1_Factory.yaml |
| msr-2 | stable/Standard | MSR-2_Factory.yaml |
| mtr-1 | stable/Standard | MTR-1_Factory.yaml |
| air-1 | stable/Standard | AIR-1_Factory.yaml |
| r-pro-1 | stable/WiFi | R_PRO-1_W.yaml |
| r-pro-1 | stable/Ethernet | R_PRO-1_ETH.yaml |
| cast-1 | stable/WiFi | CAST-1_W.yaml |
| cast-1 | stable/Ethernet | CAST-1_ETH.yaml |
| pump-1 | stable/Standard | PUMP-1.yaml |
| btn-1 | stable/Standard | BTN-1.yaml |
| temp-1 | stable/Standard | TEMP-1_R2.yaml |
| plt-1 | stable/Standard | PLT-1.yaml |

`temp-1`/`plt-1` map to the non-battery configs (confirmed by Brandon: the battery TEMP-1B/PLT-1B
are separate products not in `devices.json`). All 10 devices get a `config`.

---

## Task 1: Validator — config shape + reachability

**Files:**
- Modify: `scripts/validate_registry.py`
- Test: `scripts/test_validate_registry.py`

**Interfaces:**
- Produces: `check_config_shape(config, dev_id) -> list[str]` (pure). `main()` also HEAD-checks
  every `config` URL via the existing `head_ok`.

- [ ] **Step 1: Write failing unit tests**

Add to `scripts/test_validate_registry.py` (new class):

```python
class ConfigShape(unittest.TestCase):
    def test_good_config_has_no_errors(self):
        cfg = {"stable": {"WiFi": "https://raw.githubusercontent.com/o/r/main/a.yaml"}}
        self.assertEqual(vr.check_config_shape(cfg, "r-pro-1"), [])

    def test_non_string_url_errors(self):
        cfg = {"stable": {"WiFi": 123}}
        errs = vr.check_config_shape(cfg, "r-pro-1")
        self.assertTrue(any("WiFi" in e for e in errs), errs)

    def test_non_https_url_errors(self):
        cfg = {"stable": {"Standard": "http://insecure/a.yaml"}}
        errs = vr.check_config_shape(cfg, "x")
        self.assertTrue(any("https" in e for e in errs), errs)

    def test_channel_not_object_errors(self):
        cfg = {"stable": "oops"}
        errs = vr.check_config_shape(cfg, "x")
        self.assertTrue(any("stable" in e for e in errs), errs)
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python scripts/test_validate_registry.py`
Expected: FAIL — `module 'validate_registry' has no attribute 'check_config_shape'`.

- [ ] **Step 3: Implement `check_config_shape` and wire reachability into `main`**

In `scripts/validate_registry.py`, add after `check_manifest_shape`:

```python
def check_config_shape(config, dev_id):
    """Validate the optional `config` map (channel -> variant -> https URL).

    Returns a list of error strings (empty when sound). Network-free.
    """
    errs = []
    for channel, variants in config.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} config {channel}: not an object")
            continue
        for variant, url in variants.items():
            if not isinstance(url, str) or not url.startswith("https://"):
                errs.append(f"{dev_id} config {channel}/{variant}: not an https URL")
    return errs
```

In `main()`, inside the `for dev in reg["devices"]:` loop, after the firmware loop, add:

```python
        config = dev.get("config", {})
        errors.extend(check_config_shape(config, dev["id"]))
        for channel, variants in config.items():
            if not isinstance(variants, dict):
                continue
            for variant, curl in variants.items():
                if isinstance(curl, str) and not head_ok(curl):
                    errors.append(f"{dev['id']} config {channel}/{variant}: unreachable: {curl}")
```

- [ ] **Step 4: Run unit tests, verify they pass**

Run: `python scripts/test_validate_registry.py`
Expected: PASS (all classes).

- [ ] **Step 5: Commit**

Write message to an ASCII temp file and commit:

```bash
git add scripts/validate_registry.py scripts/test_validate_registry.py
git commit -F <ascii-msg-file>   # subject: "Validate config URLs in the registry"
```

---

## Task 2: Populate `config` in devices.json

**Files:**
- Modify: `devices.json`

**Interfaces:**
- Produces: a `config` object on 8 devices, mirroring their `firmware` channel/variant keys.

- [ ] **Step 1: Add the `config` map to each of the 8 devices**

For each device below, add a sibling `config` key next to `firmware`. Exact values (branch `main`,
path `Integrations/ESPHome/`). Example for `r-pro-1`:

```json
      "firmware": {
        "stable": {
          "WiFi": "https://apolloautomation.github.io/R_PRO-1/firmware-w/manifest.json",
          "Ethernet": "https://apolloautomation.github.io/R_PRO-1/firmware-e/manifest.json"
        }
      },
      "config": {
        "stable": {
          "WiFi": "https://raw.githubusercontent.com/ApolloAutomation/R_PRO-1/main/Integrations/ESPHome/R_PRO-1_W.yaml",
          "Ethernet": "https://raw.githubusercontent.com/ApolloAutomation/R_PRO-1/main/Integrations/ESPHome/R_PRO-1_ETH.yaml"
        }
      },
```

Full list of `config` values (variant key must exactly match the device's `firmware` variant key):
- `msr-1` stable/Standard → `…/ApolloAutomation/MSR-1/main/Integrations/ESPHome/MSR-1_Factory.yaml`
- `msr-2` stable/Standard → `…/MSR-2/main/Integrations/ESPHome/MSR-2_Factory.yaml`
- `mtr-1` stable/Standard → `…/MTR-1/main/Integrations/ESPHome/MTR-1_Factory.yaml`
- `air-1` stable/Standard → `…/AIR-1/main/Integrations/ESPHome/AIR-1_Factory.yaml`
- `r-pro-1` stable/WiFi → `…/R_PRO-1/main/Integrations/ESPHome/R_PRO-1_W.yaml`; Ethernet → `R_PRO-1_ETH.yaml`
- `cast-1` stable/WiFi → `…/CAST-1/main/Integrations/ESPHome/CAST-1_W.yaml`; Ethernet → `CAST-1_ETH.yaml`
- `pump-1` stable/Standard → `…/PUMP-1/main/Integrations/ESPHome/PUMP-1.yaml`
- `btn-1` stable/Standard → `…/BTN-1/main/Integrations/ESPHome/BTN-1.yaml`
- `temp-1` stable/Standard → `…/TEMP-1/main/Integrations/ESPHome/TEMP-1_R2.yaml`
- `plt-1` stable/Standard → `…/PLT-1/main/Integrations/ESPHome/PLT-1.yaml`

- [ ] **Step 2: Validate (shape + reachability + manifests)**

Run: `python scripts/validate_registry.py`
Expected: `Registry OK: all manifests live and complete.` (also confirms every `config` URL is HTTP 200).
If any config URL 404s, fix the filename/branch for that device and re-run.

- [ ] **Step 3: Commit**

```bash
git add devices.json
git commit -F <ascii-msg-file>   # subject: "Add per-variant config URLs to the registry"
```

---

## Task 3: Render-epoch refactor in device.js

The existing late-manifest Playwright tests are the safety net for this behavior-preserving
refactor: they must stay green after the three ad-hoc guards become one epoch counter.

**Files:**
- Modify: `js/views/device.js`
- Test (existing, must stay green): `tests/installer.spec.js` (the two "late manifest fetch" tests)

**Interfaces:**
- Produces: a `renderDevice`-scoped `let epoch = 0;` incremented on every channel/variant change;
  `renderInstall`/`renderReleaseNotes` capture `const myEpoch = epoch;` and bail on `epoch !== myEpoch`.

- [ ] **Step 1: Add the epoch counter**

In `renderDevice`, next to the `let channel`/`let variant` declarations, add:

```js
  let epoch = 0; // bumps on every channel/variant change; async renders bail if it moved
```

- [ ] **Step 2: Convert `renderInstall`'s guards to epoch**

At the top of `renderInstall`, add `const myEpoch = epoch;` as the first line. Remove the
`const want = manifest;` line. Replace both `if (selectedManifest(device, channel, variant) !== want) return;`
lines with:

```js
        if (epoch !== myEpoch) return; // selection changed mid-fetch
```

- [ ] **Step 3: Convert `renderReleaseNotes`'s guards to epoch**

In `renderReleaseNotes`, replace `const want = channel;` with `const myEpoch = epoch;`, and replace
both `if (channel !== want) return;` lines with:

```js
      if (epoch !== myEpoch) return; // selection changed mid-fetch
```

- [ ] **Step 4: Bump epoch in the two seg click handlers**

In the variant seg handler (inside `renderVariantSeg`), right after `variant = b.dataset.variant;` add `epoch++;`.
In the channel seg handler, right after `variant = Object.keys(device.firmware[channel])[0];` add `epoch++;`.

- [ ] **Step 5: Run the suite, verify still green**

Run: `cd tests && npx playwright test`
Expected: all existing tests PASS (especially the two "late manifest fetch …" tests).

- [ ] **Step 6: Commit**

```bash
git add js/views/device.js
git commit -F <ascii-msg-file>   # subject: "Unify device.js async staleness guards into one render epoch"
```

---

## Task 4: Config block — view, download, GitHub link

**Files:**
- Modify: `js/views/device.js`, `css/style.css`
- Test: `tests/installer.spec.js`

**Interfaces:**
- Consumes: `epoch`, `channel`, `variant`, `device`, `el` (from `renderDevice`); `device.config`.
- Produces: module helpers `rawToBlob(raw)`, `configBasename(url)`, `downloadText(text, filename)`;
  a `renderDevice`-scoped `renderConfig()`; a `#config-slot` in step 1; `.config*` CSS.

- [ ] **Step 1: Write the failing "renders + links" test**

Add to `tests/installer.spec.js`:

```js
function blobFromRaw(raw) {
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  return `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}`;
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd tests && npx playwright test -g "reflash section renders"`
Expected: FAIL — `.config` not found.

- [ ] **Step 3: Add module helpers to device.js**

At module scope in `js/views/device.js` (after `esc`), add:

```js
function rawToBlob(raw) {
  const m = raw.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${m[4]}` : raw;
}
function configBasename(url) {
  return (url.split('/').pop() || 'config.yaml').replace(/[^\w.\-]/g, '_');
}
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Add the `#config-slot` to step 1**

In the `el.innerHTML` template, immediately after `<div id="release-slot"></div>`, add:

```js
        <div id="config-slot"></div>
```

- [ ] **Step 5: Add `renderConfig()` and call it**

Inside `renderDevice` (near `renderReleaseNotes`), add:

```js
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
      codeEl.textContent = 'Could not load the config here — use “View on GitHub”.';
    }
  }
```

Call it in three places: (a) in the initial render block at the bottom, add `renderConfig();` after
`renderReleaseNotes();`; (b) in the variant seg handler, after `renderInstall();` add `renderConfig();`;
(c) in the channel seg handler, after `renderReleaseNotes();` add `renderConfig();`.

- [ ] **Step 6: Add CSS**

Append to `css/style.css`:

```css
/* Firmware config view/download */
.config { border-left: 3px solid var(--blue); background: var(--bg-blue-tint); border-radius: 0 8px 8px 0; padding: 12px 16px; margin-top: 14px; }
.config > summary { cursor: pointer; font-weight: 700; }
.config-hint { margin: 10px 0 8px; color: var(--dim); font-size: .85rem; }
.config-hint code { background: var(--panel); border: 1px solid var(--line); padding: 1px 5px; border-radius: 4px; }
.config-yaml { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow: auto; max-height: 340px; }
.config-yaml code { font-family: ui-monospace, Consolas, monospace; font-size: .8rem; line-height: 1.5; white-space: pre; color: var(--ink); }
.config-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.config-download { background: var(--blue); color: #fff; border: 0; border-radius: 8px; padding: 9px 18px; font-size: .9rem; font-weight: 700; cursor: pointer; }
.config-download:disabled { opacity: .55; cursor: default; }
.config-github { font-size: .86rem; font-weight: 600; }
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `cd tests && npx playwright test -g "reflash section renders"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/views/device.js css/style.css tests/installer.spec.js
git commit -F <ascii-msg-file>   # subject: "Add firmware config view/download to device pages"
```

---

## Task 5: Config tests — variant switch, stale guard, download, no-config

**Files:**
- Test: `tests/installer.spec.js`

- [ ] **Step 1: Add the four tests**

```js
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
```

- [ ] **Step 2: Run the full suite, verify all pass**

Run: `cd tests && npx playwright test`
Expected: all PASS. The multi-variant tests exercise r-pro-1/cast-1. The "no section" test is
data-driven and self-skips now that all 10 devices have a config — it's kept as a guard for any
future config-less device (the `if (!url)` path).

- [ ] **Step 3: Commit**

```bash
git add tests/installer.spec.js
git commit -F <ascii-msg-file>   # subject: "Cover config view/download variant, stale, download, and empty cases"
```

---

## Task 6: Full verification + PR

- [ ] **Step 1: Run everything green**

```bash
python scripts/test_validate_registry.py            # offline unit tests
python scripts/validate_registry.py                 # live: manifests + config URLs reachable
cd tests && npx playwright test                     # full UI suite
```
Expected: all pass.

- [ ] **Step 2: Independent review** — dispatch a code-review subagent over `git diff main` (focus:
  epoch refactor correctness, config fetch escaping, download filename safety, deploy/no-cp-list,
  data-driven tests). Address findings.

- [ ] **Step 3: Push + open PR** targeting `main`, body per template, after showing Brandon the PR body.
  Closes #3.

## Self-review notes

- Spec coverage: schema (T2), which-file rule (T2 map, all 10 devices mapped), UI view/download/GitHub
  (T4), follows-variant (T4 handlers + T5), epoch refactor (T3), deploy/no-cp-list (constraints), validator
  (T1), data-driven tests (T4/T5). Covered.
- Follow-up (out of #3 scope): the battery products TEMP-1B / PLT-1B are not in `devices.json` as
  installable devices — a separate registry-completeness item.
