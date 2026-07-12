# M-1 entry: current state and the WLED 16.0.1 switch

The m-1 entry in devices.json currently points at the manifests that are live today,
served from the WLED-MM-M1 repository GitHub Pages:

- Rev4: https://apolloautomation.github.io/WLED-MM-M1/14.5.1/manifest.json
- Rev6: https://apolloautomation.github.io/WLED-MM-M1/Rev6_14.5.1/manifest.json

The registry validator requires live URLs, so the entry ships in this state first.

## Planned switch (after the 16.0.1 firmware is released)

The M-1 firmware is moving from the WLED-MM fork to upstream WLED 16.0.1, built from
ApolloAutomation/wled (branch apollo/m1, environment apollo_m1). One firmware serves
rev4 and rev6, so the Rev4/Rev6 split collapses to a single Standard variant:

```json
"repo": "ApolloAutomation/wled",
"githubPagesInstaller": "https://apolloautomation.github.io/wled/",
"firmware": {
  "stable": {
    "Standard": "https://apolloautomation.github.io/wled/manifest.json"
  }
}
```

The manifest content is prepared in the firmware repository at
apollo/installer/manifest.json (see that repo, branch apollo/m1):

- chipFamily ESP32-S3
- single part: M-1_full_install.bin at offset 0 (bootloader + partition table +
  otadata + application + LittleFS with the factory configuration)
- new_install_prompt_erase: true. The install flow must run a FULL ERASE: the merged
  image is what guarantees a factory-fresh unit boots as a 64x64 matrix with zero
  configuration. When adding the entry, verify the installer UI preselects or clearly
  requires the erase option for this device.

Hosting for the new manifest and binary is not set up yet (GitHub Pages on the
ApolloAutomation/wled fork, or any static host). Do not switch the URLs until they
are live; scripts/validate_registry.py will catch dead links.

Customers on WLED-MM keep working: OTA from WLED-MM 14.5.1 to the 16.0.1 app-only
image (M-1_ota.bin) preserves settings because both use the same partition table.
