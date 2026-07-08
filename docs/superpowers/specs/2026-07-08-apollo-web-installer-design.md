# Apollo Web Installer — Design

Date: 2026-07-08
Status: Approved by Brandon (direction: A+B hybrid — Fleet Grid hub + per-device mini-wizard)

## What we're building

A central web installer for Apollo devices at `install.apolloautomation.com`, in the spirit of install.quinled.info: one hub page listing every device, and a guided per-device install flow that replaces the bare "title + install button" experience — without touching or replacing the existing per-repo installer pages.

New repo (proposed: `ApolloAutomation/installer`), static site, published via GitHub Pages.

## Goals

- One promoted front door for flashing any Apollo device from the browser.
- Guided flow that reduces support questions: firmware choice → connect → "add to Home Assistant" hand-off.
- Zero changes required in product repos. The hub consumes the `/firmware/manifest.json` files each product repo already publishes on GitHub Pages (verified 2026-07-08: consistent paths on MSR-2 and AIR-1; `Access-Control-Allow-Origin: *`).
- Adding a device is a data change (one registry entry + one image), not a code change.

## Non-goals

- Replacing or redirecting the existing per-repo installer pages. **Decision:** they stay standalone and untouched. They are deep-linked from years of Discord/wiki posts, live next to the firmware they flash, and serve as the documented fallback when the hub has a problem. The hub becomes the *promoted* path (wiki, Discord answers, packaging); the repo pages stay the minimal things they are today. Optionally (later, additive): a one-line link on each repo page pointing to the hub's guided flow.
- Changing how product repos build or release firmware.
- Mobile flashing (WebSerial doesn't exist there) — mobile users can browse and get pointed at the manual path.

## Architecture

- **Vanilla HTML/CSS/JS, no build step.** Same simplicity as the current pages. No framework to maintain.
- **ESP Web Tools vendored into the repo** (not CDN-loaded), so the installer never breaks because a CDN hiccuped.
- **`devices.json` registry** — the single source of device knowledge:

```json
{
  "id": "air-1",
  "name": "AIR-1",
  "category": "Air quality",
  "description": "Air quality monitor",
  "image": "images/air-1.png",
  "wiki": "https://wiki.apolloautomation.com/products/AIR-1/",
  "repo": "ApolloAutomation/AIR-1",
  "firmware": {
    "stable": {
      "Standard": "https://apolloautomation.github.io/AIR-1/firmware/manifest.json",
      "Bluetooth Proxy": "https://apolloautomation.github.io/AIR-1/firmware-bt-proxy/manifest.json"
    },
    "beta": { "Standard": "..." }
  }
}
```

Channels and variants are optional per device — devices with a single manifest show no picker. Exact beta/variant URLs get filled in per repo during implementation; if some repos publish beta manifests at inconsistent paths, the registry absorbs that (per-device URLs). Path standardization in product repos is optional cleanup later, not a blocker.

- **Routing:** each device gets a shareable URL (`/air-1/`). Plain per-device pages (or a hash router — decide in implementation; shareable URLs are the requirement).

## Hub page

- Hero: "Flash your Apollo device from the browser" + short how-it-works line + browser-support note (Chrome/Edge).
- Category filter pills (mmWave presence, Air quality, Temperature, Plant, …).
- Device card grid rendered from the registry: image, name, one-line description, Install →.
- **Placeholder art at launch** (styled gradient tiles); real product photos land later by dropping files into `/images/` — no code changes.
- Header links: Wiki, Shop, Discord.

## Device page — the mini-wizard

Three steps on one page:

1. **Choose firmware.** Stable/Beta channel toggle + variant picker (e.g. Standard / Bluetooth Proxy), only rendered when the registry defines them. Stable + first variant preselected. (This generalizes the channel/variant switching already proven on the AIR-1 fork.)
2. **Connect & install.** The ESP Web Tools button wired to the selected manifest. If the browser lacks WebSerial (Firefox/Safari), this step renders the **manual fallback** instead of a dead button: direct `.bin` download link (from the manifest) + instructions pointing at ESPHome Web / esptool.
3. **Done — add to Home Assistant.** ESPHome-discovery hand-off ("Home Assistant will find it — here's what that looks like") + link to the device's wiki setup guide.

Also on the page: link back to all devices, link to the device's GitHub repo, release-notes link.

## Error handling

- Registry or manifest fetch failure → plain-language message with a link to the device's own GitHub Pages installer as the escape hatch (this is why those pages stay standalone).
- Unsupported browser is a designed state (manual fallback), not an error.
- Copy rules: errors say what went wrong and what to do next; no jargon.

## Testing

1. **Local dev with real flashing.** `localhost` is a secure context for WebSerial, so a local static server gives the full flow including real flashes. Brandon drives actual hardware flashing; the site just has to make the Connect button live.
2. **CI registry validation (the highest-value test).** On every PR and nightly: every manifest URL in `devices.json` returns 200, parses as a valid ESP Web Tools manifest, has `chipFamily`, and its referenced firmware files exist. Catches the real failure mode (stale registry) before users do.
3. **Playwright UI suite.** Hub renders all registry devices; filters work; deep links land on the right wizard; channel/variant toggles select the right manifest URL; removing `navigator.serial` in the test context renders the manual fallback.
4. **Staging = plain Pages URL.** `apolloautomation.github.io/installer/` is real HTTPS with real cross-origin manifest fetches — shareable for Discord testing before `install.apolloautomation.com` DNS is pointed at it. Nothing existing is at risk at any point.
5. **Hardware matrix.** One flash per chip family (ESP32-C3 covers most of the lineup), one Stable→Beta switch, one variant switch (AIR-1). Chrome + Edge for installs; Firefox to eyeball the fallback.

## Rollout / PR plan

- **PR 1 — core installer:** registry, hub grid, device mini-wizard, vendored ESP Web Tools, manual fallback, CI registry validation, Playwright suite.
- **Follow-up PRs (one each, ewt-gen-inspired):**
  - YAML view/download per channel/variant (linking configs already in product repos).
  - Inline release notes via the GitHub Releases API (release-drafter bodies are good).
  - "Take control in ESPHome Dashboard" adoption section.
- **Launch steps:** deploy to Pages → Discord/community testing → point `install.apolloautomation.com` DNS → promote from wiki and Discord.

## v1 device registry

Released products only — confirm the final list against live `apolloautomation.github.io/<repo>/` pages during implementation. Expected: MSR-1, MSR-2, MTR-1, AIR-1, TEMP-1, PLT-1, R_PRO-1. Explicitly excluded: TEMP_PRO-1 and RLY-1 (unreleased).

## Decisions log

- A+B hybrid chosen over pure grid (A), full-site wizard (B), and sidebar dashboard (C).
- Per-repo installer pages stay standalone; no redirects (Brandon, 2026-07-08).
- ewt-gen is not used and not a prerequisite — it generates single-device pages like the ones repos already have; four of its page features are adopted as hub features instead (manual fallback in PR 1; YAML viewer, release notes, adoption section as follow-ups).
- Placeholder device art at launch; real photos later as a pure asset swap.
