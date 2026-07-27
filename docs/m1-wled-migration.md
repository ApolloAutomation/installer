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

Because the default variant has no classic installer page of its own, the M-1 page now loads with
the "Classic installer" link hidden and the header GitHub link pointing at WLED-M1; both come
back when a 14.5.1 variant is selected.

Customers already on WLED-MM 14.5.1 can OTA to 16.0.1 with the M-1_ota.bin app-only image
(same partition table preserves settings); the installer only serves the first-flash full image.

Hosting: WLED-MM-M1 serves the 14.5.1 manifests from committed files via legacy branch Pages.
WLED-M1 serves the 16.0.1 manifest through an Actions Pages workflow
(.github/workflows/apollo-pages.yml) that publishes manifest.json plus M-1_full_install.bin
from the latest GitHub release, so the 16MB image never enters git history.
