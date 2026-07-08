# Apollo Web Installer PR 1 (Core Installer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core central installer — hub grid + per-device mini-wizard flashing real firmware from existing product-repo manifests — deployable to GitHub Pages.

**Architecture:** Static no-build site. A single `index.html` shell routes by URL hash (`#/air-1`) between a hub view and device views, all rendered from `devices.json`. ESP Web Tools is vendored and pointed at manifests the product repos already publish on GitHub Pages (CORS is open). Python scripts handle registry validation (CI) and image fetching (one-time).

**Tech Stack:** Vanilla HTML/CSS/JS (ES modules), ESP Web Tools (vendored, pinned), Python 3 stdlib scripts, Playwright (Node, tests only), GitHub Actions + Pages.

## Global Constraints

- No build step for the site. `python -m http.server` on the repo root must serve a working site.
- ESP Web Tools is vendored in `vendor/esp-web-tools/`, pinned; never CDN-loaded at runtime.
- Routing is hash-based (`#/air-1`) so the site works identically at `apolloautomation.github.io/installer/` (staging, subpath) and `install.apolloautomation.com` (prod, root). Hash URLs satisfy the spec's shareable-URL requirement.
- Brand palette: Apollo blue `#417AAB` (primary/buttons/active), Apollo green `#9ABD32` (success/connected/done). Logos already in `assets/brand/`.
- Error copy is plain language: what went wrong + what to do next. Manifest/registry failure states must link the device's own GitHub Pages installer as the escape hatch.
- Unsupported browser (no WebSerial) is a designed state: manual `.bin` download + ESPHome Web pointer, never a dead button.
- Excluded devices: TEMP_PRO-1 and RLY-1 (unreleased). Never add them.
- Commits: use `git commit -F <ascii temp file>` (PowerShell 5.1 quoting), author email `8107750+bharvey88@users.noreply.github.com`, and end every commit message with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Never add `Co-Authored-By: Claude`.
- Python on this machine is invoked as `python`. Node/npm are used only inside `tests/`.

## File Structure

```
apollo-installer/
├── index.html                  # app shell: header, #app container, module script
├── css/style.css               # all styles (single file; small site)
├── js/app.js                   # hash router; entry point
├── js/registry.js              # loadRegistry(): fetch + validate devices.json
├── js/views/hub.js             # renderHub(): hero, filter pills, device grid
├── js/views/device.js          # renderDevice(): 3-step wizard
├── js/release-notes.js         # fetchReleaseNotes(repo, channel)
├── devices.json                # THE registry — all device knowledge
├── images/                     # committed product photos (fetched from store)
├── assets/brand/               # logos (already committed) + favicon.png
├── vendor/esp-web-tools/       # pinned install-button.js bundle + VERSION file
├── scripts/validate_registry.py# CI: every manifest live, parseable, complete
├── scripts/fetch_images.py     # one-time/refresh: store CDN -> images/
├── .github/workflows/validate.yml  # registry check: PR + nightly; Playwright: PR
├── .github/workflows/pages.yml     # deploy to GitHub Pages on push to main
└── tests/                      # Playwright project (own package.json)
    ├── package.json
    ├── playwright.config.js
    └── installer.spec.js
```

---

### Task 1: Repo scaffolding and app shell

**Files:**
- Create: `.gitignore`, `README.md`, `index.html`, `css/style.css`, `js/app.js`

**Interfaces:**
- Produces: `index.html` with `<div id="app">` and `<script type="module" src="js/app.js">`; CSS custom properties `--blue: #417AAB; --green: #9ABD32` used by all later views.

- [ ] **Step 1: Write `.gitignore`**

```gitignore
tests/node_modules/
tests/test-results/
tests/playwright-report/
__pycache__/
.superpowers/
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Apollo Web Installer

Central browser installer for Apollo devices — https://install.apolloautomation.com

- Hub of every flashable Apollo device → guided 3-step install wizard.
- Static site, no build step. Serve locally: `python -m http.server 8123` then open http://localhost:8123 (localhost is a secure context, so real flashing works in Chrome/Edge).
- All device knowledge lives in `devices.json`. Adding a device = one JSON entry + one image.
- Firmware comes from each product repo's existing GitHub Pages manifests — this repo never builds or hosts firmware.
- Existing per-repo installer pages stay standalone; this site is the promoted front door, they are the fallback.

Design spec: `docs/superpowers/specs/2026-07-08-apollo-web-installer-design.md`
```

- [ ] **Step 3: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apollo Installer</title>
  <meta name="description" content="Flash your Apollo Automation device from the browser.">
  <link rel="icon" href="assets/brand/favicon.png">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="#/">
      <img src="assets/brand/a-mark.png" alt="" width="28" height="28">
      <span>Apollo Installer</span>
    </a>
    <nav>
      <a href="https://wiki.apolloautomation.com">Wiki</a>
      <a href="https://apolloautomation.com">Shop</a>
      <a href="https://dsc.gg/ApolloAutomation">Discord</a>
    </nav>
  </header>
  <main id="app"><p class="loading">Loading devices…</p></main>
  <footer class="site-footer">
    <p>Firmware installs run entirely in your browser over USB.
       Prefer the classic pages? Every device also has a standalone installer linked from its GitHub repo.</p>
  </footer>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `css/style.css`**

```css
:root {
  --blue: #417AAB;
  --blue-dark: #35638b;
  --green: #9ABD32;
  --ink: #22303c;
  --dim: #5c6b7a;
  --ground: #f5f8fb;
  --panel: #ffffff;
  --line: #dde4ec;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--ground); color: var(--ink);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif; line-height: 1.55;
}
a { color: var(--blue); }
.site-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 24px; background: var(--panel); border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; text-decoration: none; color: var(--blue); font-size: 1.05rem; }
.site-header nav { display: flex; gap: 18px; }
.site-header nav a { color: var(--dim); text-decoration: none; }
main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 64px; }
.site-footer { text-align: center; color: var(--dim); font-size: .85rem; padding: 24px; border-top: 1px solid var(--line); }
.loading { color: var(--dim); }

/* Hub */
.hero h1 { font-size: 1.9rem; margin: 0 0 6px; letter-spacing: -.01em; }
.hero p { color: var(--dim); margin: 0 0 18px; max-width: 60ch; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.filters button {
  border: 1px solid var(--line); background: var(--panel); color: var(--dim);
  border-radius: 999px; padding: 5px 14px; font-size: .85rem; cursor: pointer;
}
.filters button.active { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 600; }
.device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.device-card {
  display: block; background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px; text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s;
}
.device-card:hover { border-color: var(--blue); box-shadow: 0 4px 14px -8px rgba(65,122,171,.5); }
.device-card img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 6px; background: #fff; }
.device-card h3 { margin: 10px 0 2px; font-size: 1rem; }
.device-card p { margin: 0; color: var(--dim); font-size: .82rem; }
.device-card .go { color: var(--blue); font-weight: 600; font-size: .85rem; margin-top: 8px; display: inline-block; }

/* Device wizard */
.device-page .back { display: inline-block; margin-bottom: 16px; text-decoration: none; color: var(--dim); }
.device-head { display: flex; gap: 20px; align-items: center; margin-bottom: 20px; }
.device-head img { width: 110px; height: 110px; object-fit: contain; background: #fff; border: 1px solid var(--line); border-radius: 10px; }
.device-head h1 { margin: 0; font-size: 1.6rem; }
.device-head p { margin: 2px 0 6px; color: var(--dim); }
.device-head .links { font-size: .85rem; }
.step { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
.step h2 { margin: 0 0 10px; font-size: 1.05rem; display: flex; align-items: center; gap: 10px; }
.step h2 .num {
  width: 26px; height: 26px; border-radius: 50%; background: var(--blue); color: #fff;
  display: inline-grid; place-items: center; font-size: .85rem; flex: none;
}
.picker { display: flex; gap: 24px; flex-wrap: wrap; }
.picker .group label { display: block; font-size: .78rem; color: var(--dim); margin-bottom: 5px; text-transform: uppercase; letter-spacing: .04em; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: var(--panel); color: var(--dim); padding: 7px 16px; font-size: .88rem; cursor: pointer; }
.seg button.active { background: var(--blue); color: #fff; font-weight: 600; }
esp-web-install-button button, .install-btn {
  background: var(--blue); color: #fff; border: 0; border-radius: 8px;
  padding: 10px 22px; font-size: .95rem; font-weight: 700; cursor: pointer;
}
.fallback { border-left: 3px solid var(--blue); background: #eef4f9; border-radius: 0 8px 8px 0; padding: 12px 16px; }
.fallback ul { margin: 8px 0 0; padding-left: 20px; }
.release-notes { border-left: 3px solid var(--green); background: #f5f9ec; border-radius: 0 8px 8px 0; padding: 12px 16px; margin-top: 14px; font-size: .88rem; }
.release-notes summary { cursor: pointer; font-weight: 600; }
.release-notes pre { white-space: pre-wrap; font-family: inherit; margin: 8px 0; }
.done-check { color: var(--green); font-weight: 700; }
.error-box { border-left: 3px solid #c0563c; background: #faf0ed; border-radius: 0 8px 8px 0; padding: 12px 16px; }
```

- [ ] **Step 5: Write placeholder `js/app.js`** (router lands in Task 5; this proves the shell loads)

```js
document.getElementById('app').innerHTML = '<p class="loading">App shell OK — router arrives in Task 5.</p>';
```

- [ ] **Step 6: Generate favicon from the circle badge**

Run (PowerShell):
```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile("C:\Users\bharv\development\apollo-installer\assets\brand\apollo-circle.png")
$dst = New-Object System.Drawing.Bitmap 64,64
$g = [System.Drawing.Graphics]::FromImage($dst); $g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($src, 0, 0, 64, 64); $g.Dispose()
$dst.Save("C:\Users\bharv\development\apollo-installer\assets\brand\favicon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose(); $src.Dispose()
```
Expected: `assets/brand/favicon.png` exists, ~64x64.

- [ ] **Step 7: Smoke test the shell**

Run: `python -m http.server 8123` (from repo root), open http://localhost:8123
Expected: header with A-mark + nav, "App shell OK" message, footer. No console errors.

- [ ] **Step 8: Commit**

Message: `feat: app shell, styles, favicon, README`

---

### Task 2: Vendor ESP Web Tools

**Files:**
- Create: `vendor/esp-web-tools/install-button.js`, `vendor/esp-web-tools/VERSION`

**Interfaces:**
- Produces: importing `vendor/esp-web-tools/install-button.js` (module) defines the `<esp-web-install-button manifest="...">` custom element used by `js/views/device.js` in Task 7.

- [ ] **Step 1: Download the pinned bundle**

Run (PowerShell, from repo root):
```powershell
New-Item -ItemType Directory -Force vendor\esp-web-tools | Out-Null
npm pack esp-web-tools@10.1.1 --pack-destination "$env:TEMP"
tar -xzf "$env:TEMP\esp-web-tools-10.1.1.tgz" -C "$env:TEMP"
Copy-Item "$env:TEMP\package\dist\web\install-button.js" vendor\esp-web-tools\install-button.js
Set-Content vendor\esp-web-tools\VERSION "esp-web-tools 10.1.1 (npm dist/web/install-button.js)"
```
If 10.1.1 is not the latest 10.x, use the latest 10.x and record it in VERSION.

- [ ] **Step 2: Verify the bundle is self-contained**

Run: `grep -E "from ['\"]\./" vendor/esp-web-tools/install-button.js | head`
Expected: no relative-path imports. If there ARE relative imports, copy the entire `dist/web/` directory into `vendor/esp-web-tools/` instead and re-check.

- [ ] **Step 3: Browser smoke test**

Temporarily append to `index.html` before `</body>`:
```html
<script type="module">
  import './vendor/esp-web-tools/install-button.js';
  console.log('EWT defined:', !!customElements.get('esp-web-install-button'));
</script>
```
Serve, open console. Expected: `EWT defined: true`. Then REMOVE the temporary script (device view imports it properly later).

- [ ] **Step 4: Commit**

Message: `feat: vendor esp-web-tools 10.1.1 (pinned, no CDN at runtime)`

---

### Task 3: The device registry (devices.json)

**Files:**
- Create: `devices.json`

**Interfaces:**
- Produces: `devices.json` shape consumed by `js/registry.js`, both Python scripts, and tests:
  `{ "devices": [ { id, name, category, description, image, imageSource, wiki, repo, githubPagesInstaller, firmware: { <channel>: { <variantLabel>: <manifestUrl> } } } ] }`
  Channels are `"stable"` and optionally `"beta"`. Every device has at least `firmware.stable` with at least one variant (use label `"Standard"` when there is only one).

- [ ] **Step 1: Probe which candidate repos have live manifests**

Run (Git Bash):
```bash
for repo in MSR-1 MSR-2 MTR-1 AIR-1 TEMP-1 PLT-1 R_PRO-1 CAST-1 PUMP-1 LED-1 M-1 PA-1 BTN-1 DEV-1 DEV-2; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://apolloautomation.github.io/${repo}/firmware/manifest.json")
  echo "$repo stable: $code"
done
```
Expected: 200 for the core seven at minimum. Record which candidates 200.

- [ ] **Step 2: Probe for beta/variant manifests on each 200 repo**

Run (Git Bash):
```bash
for repo in MSR-1 MSR-2 MTR-1 AIR-1 TEMP-1 PLT-1 R_PRO-1; do
  for p in firmware-beta/manifest.json beta/manifest.json firmware/beta/manifest.json firmware-bt-proxy/manifest.json; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://apolloautomation.github.io/${repo}/${p}")
    [ "$code" = "200" ] && echo "$repo: $p -> 200"
  done
done
```
Also check each repo's Pages workflow (`.github/workflows/*.yml` in the repo) if probing finds nothing — beta may be published under a path not guessed here. Only include URLs that return 200; devices with no discoverable beta get `stable` only (the registry absorbs inconsistency by design).

- [ ] **Step 3: Write `devices.json`** with one entry per confirmed device. Template (fill `firmware` from probe results; `image` fields get overwritten by Task 4's script):

```json
{
  "devices": [
    {
      "id": "air-1",
      "name": "AIR-1",
      "category": "Air quality",
      "description": "Air quality sensor",
      "image": "images/air-1.png",
      "imageSource": "SET-IN-STEP-4",
      "wiki": "https://wiki.apolloautomation.com/products/AIR-1/",
      "repo": "ApolloAutomation/AIR-1",
      "githubPagesInstaller": "https://apolloautomation.github.io/AIR-1/",
      "firmware": {
        "stable": { "Standard": "https://apolloautomation.github.io/AIR-1/firmware/manifest.json" }
      }
    }
  ]
}
```
Categories: `mmWave presence` (MSR-1, MSR-2, MTR-1, R_PRO-1), `Air quality` (AIR-1), `Temperature` (TEMP-1), `Plant` (PLT-1); pick sensible ones for any extra devices that had live manifests (`Audio` for CAST-1, etc.). Descriptions: short, from store titles.

- [ ] **Step 4: Fill `imageSource` from the store**

Run (Git Bash):
```bash
curl -s "https://apolloautomation.com/products.json?limit=250" | python -c "
import json,sys
d=json.load(sys.stdin)
want={'air-1':'air-1','msr-2':'msr-2','mtr-1':'mtr-1','temp-1':'temp-1','plt-1':'plt-1','r-pro-1':'r_pro-1','cast-1-audio-casting-device':'cast-1'}
for p in d['products']:
    if p['handle'] in want and p['images']:
        print(want[p['handle']], p['images'][0]['src'])"
```
Paste each URL into the matching device's `imageSource`. MSR-1 (not in store): use the product image from the MSR-1 repo or wiki page — find it with `curl -s https://wiki.apolloautomation.com/products/MSR-1/ | grep -o 'src="[^"]*"' | head`, and use that absolute URL.

- [ ] **Step 5: Validate JSON parses**

Run: `python -c "import json; d=json.load(open('devices.json')); print(len(d['devices']), 'devices OK')"`
Expected: `N devices OK` with N ≥ 7.

- [ ] **Step 6: Commit**

Message: `feat: device registry with verified manifest URLs`

---

### Task 4: Product images

**Files:**
- Create: `scripts/fetch_images.py`, `images/*`
- Modify: `devices.json` (image paths rewritten by the script)

**Interfaces:**
- Consumes: `devices.json` `imageSource` fields from Task 3.
- Produces: committed `images/<id>.<ext>` files; `devices.json` `image` fields pointing at them.

- [ ] **Step 1: Write `scripts/fetch_images.py`**

```python
"""Download product images from devices.json imageSource into images/.

Run from repo root: python scripts/fetch_images.py
Re-run any time to refresh; commits stay the source of truth.
"""
import json
import os
import urllib.parse
import urllib.request

REG = "devices.json"
UA = {"User-Agent": "apollo-installer-image-fetch"}

def main():
    with open(REG, encoding="utf-8") as f:
        reg = json.load(f)
    os.makedirs("images", exist_ok=True)
    for dev in reg["devices"]:
        src = dev.get("imageSource")
        if not src:
            print(f"{dev['id']}: no imageSource, skipped")
            continue
        path = urllib.parse.urlparse(src).path
        ext = os.path.splitext(path)[1].lower() or ".png"
        sep = "&" if "?" in src else "?"
        url = f"{src}{sep}width=800" if "cdn.shopify.com" in src else src
        dest = f"images/{dev['id']}{ext}"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
            out.write(r.read())
        dev["image"] = dest
        print(f"{dev['id']}: {dest} ({os.path.getsize(dest)} bytes)")
    with open(REG, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2)
        f.write("\n")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `python scripts/fetch_images.py`
Expected: one line per device with a byte count > 10000; `images/` populated; `devices.json` image fields updated.

- [ ] **Step 3: Eyeball the images**

Open two of the downloaded files (e.g. `images/air-1.png`) and confirm they're the right products, not error pages.

- [ ] **Step 4: Commit**

Message: `feat: product images fetched from store CDN`

---

### Task 5: Registry loader and hash router

**Files:**
- Create: `js/registry.js`
- Modify: `js/app.js` (replace placeholder)

**Interfaces:**
- Consumes: `devices.json` (Task 3 shape).
- Produces: `loadRegistry() -> Promise<{devices: Device[]}>` (throws `Error` with user-safe message on failure); router calling `renderHub(el, registry)` and `renderDevice(el, device)` — those two functions are implemented in Tasks 6 and 7 with exactly those signatures (`el` is the `#app` element).

- [ ] **Step 1: Write `js/registry.js`**

```js
let cache = null;

export async function loadRegistry() {
  if (cache) return cache;
  const res = await fetch('devices.json');
  if (!res.ok) throw new Error(`Could not load the device list (HTTP ${res.status}).`);
  const reg = await res.json();
  if (!Array.isArray(reg.devices) || reg.devices.length === 0) {
    throw new Error('The device list is empty or malformed.');
  }
  cache = reg;
  return reg;
}
```

- [ ] **Step 2: Write the router in `js/app.js`**

```js
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
```

- [ ] **Step 3: Create stub views so the module graph resolves** (`js/views/hub.js`, `js/views/device.js`)

```js
// js/views/hub.js — real implementation in Task 6
export function renderHub(el, registry) {
  el.innerHTML = `<p class="loading">Hub view: ${registry.devices.length} devices (Task 6).</p>`;
}
```

```js
// js/views/device.js — real implementation in Task 7
export function renderDevice(el, device) {
  el.innerHTML = `<p class="loading">Device view: ${device.name} (Task 7).</p>`;
}
```

- [ ] **Step 4: Smoke test routing**

Serve, open http://localhost:8123 → expect "Hub view: N devices". Open http://localhost:8123/#/air-1 → expect "Device view: AIR-1". Bad hash `#/nope` → hub.

- [ ] **Step 5: Commit**

Message: `feat: registry loader and hash router`

---

### Task 6: Playwright harness + hub view (grid, filters)

**Files:**
- Create: `tests/package.json`, `tests/playwright.config.js`, `tests/installer.spec.js`
- Modify: `js/views/hub.js` (replace stub)

**Interfaces:**
- Consumes: router from Task 5 (`renderHub(el, registry)` signature).
- Produces: hub DOM contract used by tests: each device is an `<a class="device-card" href="#/<id>">` containing an `<h3>` with the device name; filter pills are `.filters button[data-cat]`.

- [ ] **Step 1: Set up Playwright**

Run (from `tests/`):
```bash
npm init -y && npm install --save-dev @playwright/test && npx playwright install chromium
```

Write `tests/playwright.config.js`:
```js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  use: { baseURL: 'http://localhost:8123' },
  webServer: {
    command: 'python -m http.server 8123 --directory ..',
    url: 'http://localhost:8123',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Write failing hub tests** (`tests/installer.spec.js`)

```js
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

test('category filter narrows the grid', async ({ page }) => {
  await page.goto('/');
  const cat = registry.devices[0].category;
  const inCat = registry.devices.filter((d) => d.category === cat).length;
  await page.locator(`.filters button[data-cat="${cat}"]`).click();
  await expect(page.locator('a.device-card')).toHaveCount(inCat);
  await page.locator('.filters button[data-cat="all"]').click();
  await expect(page.locator('a.device-card')).toHaveCount(registry.devices.length);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `tests/`): `npx playwright test`
Expected: FAIL — stub hub has no `.device-card`.

- [ ] **Step 4: Implement `js/views/hub.js`**

```js
export function renderHub(el, registry) {
  const cats = [...new Set(registry.devices.map((d) => d.category))];
  el.innerHTML = `
    <section class="hero">
      <h1>Flash your Apollo device from the browser</h1>
      <p>Plug your device into USB, pick it below, and you'll be up and running in about two minutes.
         Installing needs Chrome or Edge — on other browsers you'll get manual instructions.</p>
    </section>
    <div class="filters">
      <button data-cat="all" class="active">All devices</button>
      ${cats.map((c) => `<button data-cat="${c}">${c}</button>`).join('')}
    </div>
    <div class="device-grid">
      ${registry.devices.map((d) => `
        <a class="device-card" href="#/${d.id}" data-cat="${d.category}">
          <img src="${d.image}" alt="${d.name}" loading="lazy">
          <h3>${d.name}</h3>
          <p>${d.description}</p>
          <span class="go">Install →</span>
        </a>`).join('')}
    </div>`;

  el.querySelector('.filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    el.querySelectorAll('.filters button').forEach((b) => b.classList.toggle('active', b === btn));
    el.querySelectorAll('.device-card').forEach((card) => {
      card.style.display =
        btn.dataset.cat === 'all' || card.dataset.cat === btn.dataset.cat ? '' : 'none';
    });
  });
}
```
Note: Playwright's `toHaveCount` on `a.device-card` counts visible+hidden — hidden via `display:none` are still in DOM. Fix the test locator to visible only: use `page.locator('a.device-card:visible')` in BOTH assertions of the filter test.

- [ ] **Step 5: Run tests to verify they pass**

Run (from `tests/`): `npx playwright test`
Expected: 2 passed.

- [ ] **Step 6: Commit**

Message: `feat: hub view with device grid and category filters, playwright harness`

---

### Task 7: Device view — wizard steps 1 & 2 (picker, install, fallback)

**Files:**
- Modify: `js/views/device.js` (replace stub)
- Test: `tests/installer.spec.js` (append)

**Interfaces:**
- Consumes: `renderDevice(el, device)` signature from Task 5; `<esp-web-install-button>` from Task 2.
- Produces: DOM contract — `#channel-seg button[data-channel]`, `#variant-seg button[data-variant]`, `esp-web-install-button[manifest]`, `.fallback` (only when WebSerial missing). Function `selectedManifest(device, channel, variant) -> string` (module-local). Step 3 container `#step-done` (filled in Task 8).

- [ ] **Step 1: Write failing tests** (append to `tests/installer.spec.js`)

```js
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test`
Expected: the 3 new tests FAIL (stub device view).

- [ ] **Step 3: Implement `js/views/device.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test`
Expected: 5 passed.

- [ ] **Step 5: Manual smoke in a real browser**

Serve, open a device page in Chrome. Expected: Connect & Install opens the serial-port picker (don't flash — Brandon drives hardware). In Firefox (or with DevTools overriding), the fallback block shows real `.bin` links.

- [ ] **Step 6: Commit**

Message: `feat: device wizard — firmware picker, install button, manual fallback`

---

### Task 8: Wizard step 3 + inline release notes

**Files:**
- Create: `js/release-notes.js`
- Modify: `js/views/device.js` (fill `#step-done`, mount release notes under the picker)
- Test: `tests/installer.spec.js` (append)

**Interfaces:**
- Consumes: `#step-done` container and `channel` state from Task 7.
- Produces: `fetchReleaseNotes(repo, channel) -> Promise<{name, body, url}>` (throws on any failure); DOM contract `.release-notes` with `<details>`, `.release-notes .fail-link` on failure.

- [ ] **Step 1: Write failing tests** (append; mock the GitHub API at the network layer)

```js
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

test('step 3 shows the Home Assistant hand-off', async ({ page }) => {
  const d = registry.devices[0];
  await page.goto(`/#/${d.id}`);
  await expect(page.locator('#step-done')).toContainText('Home Assistant');
  await expect(page.locator(`#step-done a[href="${d.wiki}"]`)).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test`
Expected: new tests FAIL.

- [ ] **Step 3: Write `js/release-notes.js`**

```js
export async function fetchReleaseNotes(repo, channel) {
  const url = channel === 'stable'
    ? `https://api.github.com/repos/${repo}/releases/latest`
    : `https://api.github.com/repos/${repo}/releases?per_page=15`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const rel = channel === 'stable' ? data : data.find((r) => r.prerelease);
  if (!rel) throw new Error('no release found for channel');
  return { name: rel.name || rel.tag_name, body: rel.body || '', url: rel.html_url };
}
```

- [ ] **Step 4: Mount release notes and step 3 in `js/views/device.js`**

Add below the picker markup in step 1's `<section>`: `<div id="release-slot"></div>`.
Replace the `#step-done` placeholder content with:

```html
<p>After installing, the device broadcasts itself on your network.
   In Home Assistant go to <strong>Settings → Devices &amp; services</strong> — it appears as a
   discovered <strong>ESPHome</strong> device. Click <strong>Configure</strong>, and you're done.
   <span class="done-check">✓</span></p>
<p><a href="${device.wiki}">Full ${device.name} setup guide on the wiki →</a></p>
```

Add the loader function and call it from `renderInstall()`-adjacent flow (also re-call when `channel` changes):

```js
import { fetchReleaseNotes } from '../release-notes.js';

// Release data comes from the GitHub API (external input) — escape everything
// interpolated into markup. Registry fields are trusted repo content.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function renderReleaseNotes() {
  const slot = el.querySelector('#release-slot');
  slot.innerHTML = '';
  try {
    const rel = await fetchReleaseNotes(device.repo, channel);
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
    slot.innerHTML = `
      <div class="release-notes">
        See <a class="fail-link" href="https://github.com/${device.repo}/releases">recent releases</a>
        for what's new.
      </div>`;
  }
}
```
Call `renderReleaseNotes()` once at the end of `renderDevice` and inside the channel-seg click handler.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test`
Expected: 8 passed.

- [ ] **Step 6: Commit**

Message: `feat: HA hand-off step and inline release notes with graceful degradation`

---

### Task 9: Registry validation script

**Files:**
- Create: `scripts/validate_registry.py`

**Interfaces:**
- Consumes: `devices.json` (Task 3 shape).
- Produces: exit 0 when every manifest is live/parseable/complete and every firmware part URL exists; exit 1 with one line per problem otherwise. CI (Task 10) runs exactly `python scripts/validate_registry.py`.

- [ ] **Step 1: Write `scripts/validate_registry.py`**

```python
"""Validate every manifest URL in devices.json.

Checks: manifest fetches (200) and parses; has builds[] with chipFamily;
every part path resolves and exists (HEAD 200). Exit 1 on any failure.
Run: python scripts/validate_registry.py
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "apollo-installer-registry-check"}
errors = []

def head_ok(url):
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except urllib.error.URLError:
        return False

def check_manifest(dev_id, channel, variant, murl):
    where = f"{dev_id} {channel}/{variant}"
    try:
        req = urllib.request.Request(murl, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            manifest = json.load(r)
    except Exception as e:
        errors.append(f"{where}: manifest fetch/parse failed: {e}")
        return
    builds = manifest.get("builds")
    if not builds:
        errors.append(f"{where}: manifest has no builds[]")
        return
    for b in builds:
        if "chipFamily" not in b:
            errors.append(f"{where}: build missing chipFamily")
        for part in b.get("parts", []):
            purl = urllib.parse.urljoin(murl, part["path"])
            if not head_ok(purl):
                errors.append(f"{where}: firmware part missing: {purl}")

def main():
    with open("devices.json", encoding="utf-8") as f:
        reg = json.load(f)
    for dev in reg["devices"]:
        if not dev.get("firmware", {}).get("stable"):
            errors.append(f"{dev['id']}: no stable channel")
        for channel, variants in dev.get("firmware", {}).items():
            for variant, murl in variants.items():
                check_manifest(dev["id"], channel, variant, murl)
    if errors:
        print(f"FAILED — {len(errors)} problem(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    print("Registry OK: all manifests live and complete.")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run against the real registry**

Run: `python scripts/validate_registry.py`
Expected: `Registry OK: all manifests live and complete.` If any line fails, fix `devices.json` (or the probe result from Task 3) before committing.

- [ ] **Step 3: Prove it catches breakage**

Temporarily change one manifest URL in `devices.json` to `.../firmware/nope.json`, run again.
Expected: `FAILED — 1 problem(s)` and exit code 1 (`echo $LASTEXITCODE` → 1). Revert the change.

- [ ] **Step 4: Commit**

Message: `feat: registry validation script (manifests live, parseable, parts exist)`

---

### Task 10: CI + Pages deploy workflows

**Files:**
- Create: `.github/workflows/validate.yml`, `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `scripts/validate_registry.py` (Task 9), `tests/` Playwright project (Task 6).
- Produces: green checks on PRs; nightly registry check; site deployed to GitHub Pages on push to main.

- [ ] **Step 1: Write `.github/workflows/validate.yml`**

```yaml
name: Validate

on:
  pull_request:
  workflow_dispatch:
  schedule:
    - cron: "17 6 * * *"   # nightly registry check

jobs:
  registry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python scripts/validate_registry.py

  ui-tests:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npx playwright test
```

- [ ] **Step 2: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Sanity-check workflow YAML**

Run: `python -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]; print('YAML OK')"`
(If PyYAML isn't installed: `pip install pyyaml` first, or paste each file into the GitHub workflow editor later.)
Expected: `YAML OK`

- [ ] **Step 4: Commit**

Message: `ci: registry validation (PR + nightly), playwright on PR, pages deploy`

---

### Task 11: Full verification pass

**Files:** none created — verification only.

- [ ] **Step 1: Full test suite**

Run (from `tests/`): `npx playwright test`
Expected: 8 passed.

- [ ] **Step 2: Registry validation**

Run: `python scripts/validate_registry.py`
Expected: `Registry OK`.

- [ ] **Step 3: Manual walkthrough in Chrome**

Serve locally; walk hub → filter → device → channel/beta toggle → release notes expand → back. Confirm images load, no console errors, footer/header links work.

- [ ] **Step 4: Hand to Brandon for a real flash**

localhost + Chrome + a sacrificial device (his part: pick device, Connect & Install, verify it boots and shows in ESPHome/HA). Also one channel switch and one variant switch if the registry ended up with any.

- [ ] **Step 5: Commit any fixes; repo is ready for GitHub**

Create `ApolloAutomation/installer` (or personal fork first per team preference), push main, enable Pages (GitHub Actions source), confirm staging URL works, then Discord testing per the spec's rollout section.

---

## Self-Review Notes

- Spec coverage: hub grid+filters (T6), wizard steps 1–3 (T7, T8), manual fallback (T7), inline release notes with degradation (T8), vendored EWT (T2), registry+images (T3, T4), branding (T1 uses palette + logos), CI validation nightly+PR (T9, T10), Playwright incl. no-WebSerial state (T6–T8), staging-then-DNS rollout (T11). Old pages untouched — nothing in this plan modifies product repos.
- Escape-hatch links present in error box (T5), fallback (T7), and device header "Classic installer" (T7).
- Type consistency: `renderHub(el, registry)` / `renderDevice(el, device)` (T5 stubs = T6/T7 signatures); registry shape defined once (T3) and used by registry.js, both scripts, and tests; DOM contracts (`.device-card`, `#channel-seg`, `.fallback`, `.release-notes`, `#step-done`) match between implementations and tests.
- Known simplification: hash routing chosen over path routing so staging subpath and prod root behave identically (recorded in Global Constraints; satisfies spec's shareable-URL requirement).
