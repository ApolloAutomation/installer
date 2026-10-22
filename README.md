# Apollo Web Installer

Central browser installer for Apollo devices — https://install.apolloautomation.com

- Hub of every flashable Apollo device → guided 3-step install wizard.
- Static site, no build step. Serve locally: `python -m http.server 8123` then open http://localhost:8123 (localhost is a secure context, so real flashing works in Chrome, Edge, or Firefox).
- All device knowledge lives in `devices.json`. Adding a device = one JSON entry + one image.
- Firmware comes from each product repo's existing GitHub Pages manifests — this repo never builds or hosts firmware.
- Existing per-repo installer pages stay standalone; this site is the promoted front door, they are the fallback.

How to add a device and run the checks: `CONTRIBUTING.md`. Original design (historical): `docs/superpowers/specs/2026-07-08-apollo-web-installer-design.md`
