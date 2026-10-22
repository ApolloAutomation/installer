## What does this change?

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Playwright tests pass locally (`cd tests && npx playwright test`)
- [ ] Any new runtime file/dir is added to the `cp` list in `.github/workflows/pages.yml`
- [ ] No new build step, framework, or runtime CDN dependency
- [ ] If `devices.json` changed: `python scripts/validate_registry.py` passes
- [ ] If a firmware or config URL changed: it is the build the product repo's classic installer flashes, `config` points at the YAML that builds it, and the first (default) variant is the one most people need
