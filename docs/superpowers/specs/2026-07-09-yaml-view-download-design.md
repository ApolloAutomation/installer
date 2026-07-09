# YAML View / Download on Device Pages — Design

Date: 2026-07-09
Status: Approved by Brandon (2026-07-09)
Issue: #3

## What we're building

On each device page, a way to **view and download the ESPHome config (YAML)** for the
selected firmware variant, so a user can rebuild or reflash the device from source and
have it onboard exactly like a factory unit (following the wiki setup steps).

This is the *reflash / rebuild* path, distinct from the *adopt-and-customize* path that
#4 added to step 3 (ESPHome Dashboard "Take control", which uses `dashboard_import`).

## Goals

- Surface the config that reproduces a **properly-onboarding** device (improv-ble present),
  so a reflash matches the wiki.
- Follow the existing variant selection: on R_PRO-1 the WiFi and Ethernet configs are
  different files, and switching the variant switches the config.
- Adding a config is a **data change** (a URL in `devices.json`), not a code change.
- No new deploy surface, no new dependency, no CDN hotlinking of firmware.

## Non-goals

- No local caching of YAML in the repo (no `yaml/` dir). We fetch live from GitHub raw,
  so the config is always current and there is no `pages.yml` cp-list change.
- Not the customize path — that is #4 (dashboard adoption). This section is framed as
  "build/reflash from source", pointing at the wiki.
- No YAML parsing, linting, or editing in the browser. View + download only.

## Which config each variant points at

The config that includes improv-ble (so a reflash onboards like new):

- **`_Factory.yaml` when the repo has one** — older / smaller-flash devices that split the
  improv-ble build out (e.g. `Integrations/ESPHome/MSR-2_Factory.yaml`).
- **the main per-variant `<NAME>.yaml` otherwise** — newer devices that keep improv-ble
  baked in permanently (e.g. R_PRO-1 has only `R_PRO-1_W.yaml` / `R_PRO-1_ETH.yaml`).

The correct file per variant is determined by probing each repo during registry population.
A device or variant with no mapped config simply shows no section (graceful).

## Registry schema

Add a `config` map that **mirrors `firmware`** (channel -> variant -> raw YAML URL). This is
additive: `firmware` values stay plain manifest-URL strings, so existing firmware handling
and tests are untouched.

```json
{
  "id": "r-pro-1",
  "repo": "ApolloAutomation/R_PRO-1",
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
  }
}
```

- Keyed by channel/variant so it aligns 1:1 with `firmware` and follows the same selection.
- `config` (and any channel/variant within it) is optional. Missing => no section for that
  selection.
- Alternative considered and rejected: making each variant an object `{manifest, config}`.
  That is a breaking change to all firmware-string handling and tests for no real benefit.

Rationale for **raw** URLs (`raw.githubusercontent.com`): fetchable cross-origin
(`Access-Control-Allow-Origin: *`, verified 2026-07-09) and directly downloadable as text.
The GitHub blob "View on GitHub" URL is **derived** from the raw URL, so we store one field.

## UI / behavior

Placement: a collapsible block in **step 1** (below the release notes), because it is tied to
the firmware/variant chosen there. It re-renders whenever the channel or variant changes.

When the selected variant has a `config` URL:

- **Summary/heading** framed as reflash/rebuild, e.g. "Build or reflash this firmware
  yourself", with a one-line pointer to the device wiki.
- **View** — on expand, fetch the raw YAML and render it in a `<pre><code>` block. The YAML
  is runtime-fetched content, so it is escaped via the existing `esc()` before insertion
  (per AGENTS.md security stance). Show a small "Loading…" then the content; on fetch failure,
  show a short message plus the GitHub link (graceful, no throw).
- **Download .yaml** — reuse the already-fetched text as a `Blob`, download with the real
  filename derived from the URL path basename (e.g. `R_PRO-1_W.yaml`), sanitized. Using a
  Blob avoids the cross-origin `download`-attribute limitation (a cross-origin `<a download>`
  is ignored by browsers and would navigate instead of downloading).
- **View on GitHub** — the blob URL derived from the raw URL
  (`raw.githubusercontent.com/OWNER/REPO/BRANCH/PATH` -> `github.com/OWNER/REPO/blob/BRANCH/PATH`).

When the selected variant has no config, the block is not rendered at all.

## device.js refactor: one render epoch

Adding a third async render (config fetch) is the moment to replace the three current ad-hoc
staleness guards with a single mechanism, as flagged in the PR #1 review.

- Introduce a per-`renderDevice` integer `epoch`, incremented whenever the channel or variant
  changes (the seg click handlers).
- Each async render (`renderInstall`'s manifest fetch, `renderReleaseNotes`, and the new
  `renderConfig`) captures `const myEpoch = epoch` before awaiting and returns early if
  `epoch !== myEpoch` after the await — i.e. the selection changed mid-fetch.
- This replaces the existing `want` comparisons (`selectedManifest(...) !== want`,
  `channel !== want`) with one consistent guard. The failure mode it protects against — a
  stale fetch overwriting the current selection's firmware/config link — stays covered.

## Deploy & security

- **No new runtime file or directory** (no cache dir). `pages.yml` cp-list is unchanged.
- Displayed YAML is escaped (`esc()`); the download filename is sanitized to a safe basename.
- Blob content is the raw text (not inserted into the DOM), so it needs no escaping.

## Validator

Extend `scripts/validate_registry.py` so that, in addition to firmware manifests, every
`config` URL is HEAD-checked (200). A broken config link then fails CI exactly like a broken
manifest. The pure shape checks (a `config` entry, when present, is a string URL) are covered
by the existing offline unit tests (`scripts/test_validate_registry.py`).

## Tests (data-driven Playwright)

All keyed off `devices.json`, no hardcoded ids:

- A device that has a `config` for its default selection shows the section; a mocked raw fetch
  renders the (escaped) YAML; the Download control and the derived GitHub blob link are present
  and correct.
- Variant switch updates the config: for a device whose variants have different config URLs
  (R_PRO-1), selecting Ethernet shows the Ethernet config, WiFi shows the WiFi config.
- Stale-fetch guard: a slow config fetch for a variant the user has switched away from must not
  overwrite the current variant's section (exercises the new epoch), mirroring the existing
  late-manifest tests.
- A device with no `config` shows no section.

## Registry population

Probe each product repo to map the correct config file per variant (`_Factory.yaml` when
present, else the main per-variant `<NAME>.yaml`), confirm each raw URL is reachable, and add
the `config` entries to `devices.json`. Devices without a discoverable config are left without
the field (no section). The `main` branch is used for the raw URLs unless a repo's default
branch differs.

## Out of scope / later

- Caching configs into the repo (only worth it if raw fetch proves unreliable).
- Showing the imported `Core.yaml` package contents inline (the entry/factory file references
  it; users can follow the package URL). View shows the single selected file.
