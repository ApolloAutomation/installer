# M-1 firmware options in the installer

The M-1 offers two WLED firmwares in the installer, both served from GitHub Pages:

- WLED 16.0.1 (Rev6 only, default) from ApolloAutomation/WLED-M1:
  - https://apolloautomation.github.io/WLED-M1/manifest.json
- WLED-MM 14.5.1 from ApolloAutomation/WLED-MM-M1. Two hardware revisions:
  - Rev6: https://apolloautomation.github.io/WLED-MM-M1/Rev6_14.5.1/manifest.json
  - Rev4: https://apolloautomation.github.io/WLED-MM-M1/14.5.1/manifest.json

WLED 16.0.1 is the default. It is a single merged full-install image (bootloader, partition
table, otadata, application, and LittleFS factory config) built from ApolloAutomation/WLED-M1.
Its manifest sets new_install_prompt_erase, so esp-web-tools prompts a full erase, which is what
guarantees a factory-fresh 64x64 boot. It is offered for Rev6 only, so Rev4 owners must switch
to the WLED-MM 14.5.1 (Rev4) variant.

The M-1 entry sets `"platform": "wled"`, so step 3 of the wizard gives the WLED onboarding
(open Apollo M-1 hotspot at 4.3.2.1, discovered WLED integration, WLED web UI for effects and
manual OTA) instead
of the ESPHome Dashboard "Take control" flow. The hardware can run ESPHome, we just do not offer
an ESPHome build yet. When we do, add that manifest as another variant and mark it in a
`platforms` map (`"platforms": { "stable": { "<variant>": "esphome" } }`); step 3 then switches
back to the ESPHome instructions whenever that variant is selected, and stays WLED for the rest.

Because the default variant has no classic installer page of its own, the M-1 page now loads with
the "Classic installer" link hidden and the header GitHub link pointing at WLED-M1; both come
back when a 14.5.1 variant is selected.

Customers already on WLED-MM 14.5.1 can OTA to 16.0.1 with the M-1_ota.bin app-only image
(same partition table preserves settings); the installer only serves the first-flash full image.

Hosting: WLED-MM-M1 serves the 14.5.1 manifests from committed files via legacy branch Pages.
WLED-M1 serves the 16.0.1 manifest through an Actions Pages workflow
(.github/workflows/apollo-pages.yml) that publishes manifest.json plus M-1_full_install.bin
from the latest GitHub release, so the 16MB image never enters git history.

## Setup hotspot (verified against the shipped images, not WLED defaults)

Both the 16.0.1 and 14.5.1 Apollo builds broadcast an **open** hotspot, not the stock WLED
`WLED-AP` / `wled1234` pair. The string `wled1234` is absent from `M-1_full_install.bin` and from
`Apollo_M-1_Rev6_14.5.1.bin`, while the sibling default `wledota` is present in both, so `apPass`
is empty. The m1-b8 release notes state it directly: "STEP 1: join the open Apollo M-1 WiFi", and
list "cleaner hotspot name: the setup WiFi is now just Apollo M-1 (no serial-number suffix)" as new
in that build, which is why step 3 says older builds carry a suffix. Setup address is 4.3.2.1.
