## What does this change?

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Playwright tests pass locally (`cd tests && npx playwright test`)
- [ ] Any new runtime file/dir is added to the `cp` list in `.github/workflows/pages.yml`
- [ ] No new build step, framework, or runtime CDN dependency
- [ ] If `devices.json` changed: `python scripts/validate_registry.py` passes
