# Contributing

## Run it locally

```
python -m http.server 8123
```

from the repo root, then open http://localhost:8123. No build step — there deliberately isn't one. localhost is a secure context, so real USB flashing works in Chrome/Edge.

## Tests

```
cd tests
npm ci
npx playwright test
```

Run from `tests/`, not the repo root. PRs run this suite plus the registry validator (`python scripts/validate_registry.py`) in CI.

## Adding a device

One entry in `devices.json` (id must be lowercase-kebab; `firmware.stable` pointing at the product repo's GitHub Pages manifest) + one image in `images/` (`python scripts/fetch_images.py` downloads it from the `imageSource` URL). The tests are registry-driven and cover new devices automatically.

## Rules that will save you a red X

- **New runtime files must be added to the `cp` list in `.github/workflows/pages.yml`** — the deploy stages only listed paths into `_site/`, so a missed path works locally and 404s in production.
- Don't edit `vendor/esp-web-tools/` by hand; it's a pinned upstream copy (see `VERSION`). Version bumps replace the whole directory.
- Registry content (`devices.json`) is trusted; anything fetched at runtime (GitHub API, manifests) must be escaped/sanitized before touching the DOM — see `esc()` in `js/views/device.js`.
- This site never builds or hosts firmware. Firmware changes belong in the product repos.

PRs target `main`. Merging deploys to https://apolloautomation.github.io/installer/.
