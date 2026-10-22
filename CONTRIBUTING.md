# Contributing

## Run it locally

```
python -m http.server 8123
```

from the repo root, then open http://localhost:8123. No build step — there deliberately isn't one. localhost is a secure context, so real USB flashing works in Chrome, Edge, or Firefox.

## Tests

```
cd tests
npm ci
npx playwright test
```

Run from `tests/`, not the repo root. The suite stubs GitHub, manifests and configs, so it runs offline and never spends GitHub API quota.

From the repo root:

```
python scripts/test_validate_registry.py       # validator unit tests (offline)
python scripts/test_fetch_images.py            # image script unit tests (offline)
python scripts/validate_registry.py --offline  # registry shape only, no network
python scripts/validate_registry.py            # plus live manifests, configs, wiki and classic installers (~15s)
```

CI runs all of these on every PR and again on `main` after merge. The deploy re-runs the offline checks, so a malformed registry never reaches production.

## Adding a device

1. **Pick the firmware.** Use the manifest(s) the product repo's own classic installer page flashes. When a repo publishes several builds, that is usually the improv-enabled `firmware-factory/` build, not `firmware/`: without improv the installer can't offer Wi-Fi setup after flashing. The validator fails if the registry points at a build the classic page doesn't offer, but it can't tell which of the page's builds belongs to which variant, so check that by hand.
2. **Add one entry to `devices.json`.** The id is lowercase-kebab; it becomes the URL hash (`#/air-1`) and the image filename. Set `config` to the YAML that builds that same manifest. The first variant listed is the one selected on load, so put support-only or legacy builds after it. For the optional per-variant fields (`variantNotes`, `platform`/`platforms`, `repos`, `installers`) see `AGENTS.md`.
3. **Add the image.** Run `python scripts/fetch_images.py <id>`. Shopify sources are downscaled automatically; for any other source, save a ~600px JPEG as `images/<id>.jpg` yourself and the script keeps it.
4. **Check it.** Run `python scripts/validate_registry.py` and the Playwright suite. The tests are registry-driven and visit every device and variant automatically.

## Rules that will save you a red X

- **New runtime files must be added to the `cp` list in `.github/workflows/pages.yml`** — the deploy stages only listed paths into `_site/`, so a missed path works locally and 404s in production.
- Don't edit `vendor/esp-web-tools/` by hand; it's a pinned upstream copy (see `VERSION`). Version bumps replace the whole directory.
- Registry content (`devices.json`) is trusted; anything fetched at runtime (GitHub API, manifests) must be escaped/sanitized before touching the DOM — see `esc()` in `js/views/device.js`.
- This site never builds or hosts firmware. Firmware changes belong in the product repos.

PRs target `main`. Merging deploys to https://install.apolloautomation.com.
