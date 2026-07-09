# Agent notes

Static site, **no build step** — do not add bundlers, frameworks, or npm deps outside `tests/`.

- Serve: `python -m http.server 8123` from repo root.
- Test: `cd tests && npx playwright test` (fails confusingly if run from repo root). Registry-driven suite.
- Validate registry: `python scripts/validate_registry.py` (network, ~60s).
- `devices.json` is the single source of truth; views, scripts, and tests all read it. Device ids are lowercase-kebab and become URL hashes (`#/air-1`) and image filenames.
- **Deploy gotcha:** `.github/workflows/pages.yml` copies an explicit file list into `_site/`. Any new runtime file or directory must be added there or it 404s in production while working locally.
- `vendor/esp-web-tools/` is a pinned upstream copy — never hand-edit.
- Security stance: registry fields are trusted repo content; runtime-fetched content (GitHub releases, manifest-derived filenames) must go through the existing escaping (`esc()`, `encodeURI`) in `js/views/device.js`.
- Async renders in `js/views/device.js` guard against stale writes (variant/device changed mid-fetch). If you add an async fetch there, follow the same pattern — a wrong-firmware link is this site's worst failure mode.
