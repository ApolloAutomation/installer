"""Validate devices.json and everything it points at.

Offline checks (always run): each device's shape (required fields, unique
lowercase-kebab id, image file present and named after the id), the firmware,
config and per-variant override maps, and that every manifest URL lives on its
own repo's GitHub Pages site.

Network checks (skipped with --offline): every manifest fetches (200, readable
cross-origin from the installer) and parses, with builds[] and a known
chipFamily; every part path resolves (HEAD 200); configs and wiki pages are
reachable; and each manifest is one the variant's classic installer page offers.
(That can't tell two of a page's builds apart, so two variants swapped with each
other still pass; a variant duplicating another's manifest is caught offline.)
Exit 1 on any failure.

Run: python scripts/validate_registry.py [--offline]
"""
import http.client
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "apollo-installer-registry-check"}
# esp-web-tools fetches manifests and parts cross-origin from the installer, so
# they must allow it. GitHub Pages and raw.githubusercontent.com send "*";
# GitHub release assets send nothing.
ORIGIN = "https://install.apolloautomation.com"
# The chipFamily names the vendored esp-web-tools recognizes.
CHIP_FAMILIES = ("ESP32", "ESP32-C2", "ESP32-C3", "ESP32-C5", "ESP32-C6", "ESP32-C61",
                 "ESP32-H2", "ESP32-P4", "ESP32-S2", "ESP32-S3", "ESP8266")
REQUIRED = ("id", "name", "category", "description", "image", "wiki", "repo")
ID_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# Channel and variant keys are written into HTML attributes and CSS selectors.
UNSAFE_KEY_CHARS = set('"<>&`\\')
MANIFEST_ATTR = re.compile(r"""\bmanifest\s*=\s*["']([^"']+)["']""")
errors = []

def head(url):
    """HEAD url with the installer's Origin; return the headers on a 200, else None.

    Any connection, timeout or protocol failure counts as unreachable rather than
    crashing the run. URLError and a read-phase TimeoutError are both OSErrors;
    a dropped connection can also surface unwrapped (RemoteDisconnected).
    """
    req = urllib.request.Request(url, headers=dict(UA, Origin=ORIGIN), method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.headers if r.status == 200 else None
    except (OSError, http.client.HTTPException):
        return None

def head_ok(url):
    return head(url) is not None

def cors_ok(headers):
    return headers.get("Access-Control-Allow-Origin") in ("*", ORIGIN)

def is_owner_name(repo):
    return (isinstance(repo, str) and repo.count("/") == 1
            and " " not in repo and all(repo.split("/")))

def repo_for(dev, channel, variant):
    repos = dev.get("repos") if isinstance(dev.get("repos"), dict) else {}
    chan = repos.get(channel) if isinstance(repos.get(channel), dict) else {}
    return chan.get(variant) or dev.get("repo")

def classic_installer_for(dev, channel, variant):
    """Mirrors classicInstallerFor() in js/views/device.js."""
    installers = dev.get("installers") if isinstance(dev.get("installers"), dict) else {}
    chan = installers.get(channel)
    if isinstance(chan, dict) and variant in chan:
        return chan[variant]
    return dev.get("githubPagesInstaller")

def check_manifest_shape(manifest, where):
    """Validate manifest structure without touching the network.

    Returns a list of error strings (empty when the shape is sound). A build
    with no parts, or a part with no "path", is a hard error rather than a
    silent pass or a KeyError crash.
    """
    if not isinstance(manifest, dict):
        return [f"{where}: manifest is not a JSON object"]
    errs = []
    builds = manifest.get("builds")
    if not builds or not isinstance(builds, list):
        errs.append(f"{where}: manifest has no builds[]")
        return errs
    for b in builds:
        if not isinstance(b, dict):
            errs.append(f"{where}: build is not an object")
            continue
        if "chipFamily" not in b:
            errs.append(f"{where}: build missing chipFamily")
        elif b["chipFamily"] not in CHIP_FAMILIES:
            errs.append(f"{where}: unknown chipFamily {b['chipFamily']!r} "
                        "(esp-web-tools would report the board as unsupported)")
        parts = b.get("parts")
        if not parts or not isinstance(parts, list):
            errs.append(f"{where}: build has no parts[]")
            continue
        for part in parts:
            if not isinstance(part, dict) or not isinstance(part.get("path"), str) or not part["path"]:
                # Absent, empty, or null path — matches the network loop's skip
                # test so a broken path can never slip past both checks.
                errs.append(f"{where}: firmware part missing 'path'")
    return errs

def part_paths(manifest):
    """Every usable part path in a manifest; malformed entries are skipped here
    because check_manifest_shape already reports them."""
    builds = manifest.get("builds") if isinstance(manifest, dict) else None
    for b in builds if isinstance(builds, list) else []:
        parts = b.get("parts") if isinstance(b, dict) else None
        for part in parts if isinstance(parts, list) else []:
            if isinstance(part, dict) and isinstance(part.get("path"), str) and part["path"]:
                yield part["path"]

def check_manifest_url(murl, repo, where):
    """Network-free: a manifest must be an https URL on its own repo's GitHub
    Pages site (https://<owner>.github.io/<repo>/...).

    `repo` is the variant's resolved repo (the `repos` override, else the
    device's). A URL copy-pasted from another device's entry fails here, before
    it can flash one board's firmware onto another.
    """
    if not isinstance(murl, str) or not murl.startswith("https://"):
        return [f"{where}: manifest is not an https URL"]
    if not is_owner_name(repo):
        return []  # the repo itself is reported by the shape checks
    owner, name = repo.split("/")
    u = urllib.parse.urlparse(murl)
    segments = u.path.split("/")
    if u.netloc.lower() != f"{owner.lower()}.github.io" or len(segments) < 3 or segments[1] != name:
        return [f"{where}: manifest {murl} is not on {repo}'s Pages site "
                f"(https://{owner.lower()}.github.io/{name}/)"]
    return []

def check_device_shape(dev, where):
    """Network-free checks on one device entry. `where` names it in messages.

    Covers required fields, the id format (it becomes the URL hash and the image
    filename), the image file, URL fields, and the firmware map itself.
    """
    if not isinstance(dev, dict):
        return [f"{where}: not an object"]
    errs = []
    for key in REQUIRED:
        if not isinstance(dev.get(key), str) or not dev[key].strip():
            errs.append(f"{where}: missing {key!r}")
    dev_id = dev.get("id")
    if isinstance(dev_id, str) and dev_id and not ID_RE.fullmatch(dev_id):
        errs.append(f"{where}: id must be lowercase-kebab (it becomes the URL hash and image filename)")
    image = dev.get("image")
    if isinstance(image, str) and image:
        if not os.path.isfile(image):
            errs.append(f"{where}: image {image} does not exist")
        elif isinstance(dev_id, str) and os.path.splitext(os.path.basename(image))[0] != dev_id:
            errs.append(f"{where}: image should be named after the id (images/{dev_id}.<ext>)")
    if "repo" in dev and not is_owner_name(dev["repo"]):
        errs.append(f"{where}: repo is not an 'owner/name' string")
    for key in ("wiki", "githubPagesInstaller", "imageSource"):
        url = dev.get(key)
        if url is not None and (not isinstance(url, str) or not url.startswith("https://")):
            errs.append(f"{where}: {key} is not an https URL")
    firmware = dev.get("firmware")
    if not isinstance(firmware, dict) or not firmware.get("stable"):
        errs.append(f"{where}: no stable channel")
    if not isinstance(firmware, dict):
        return errs
    for channel, variants in firmware.items():
        if UNSAFE_KEY_CHARS & set(channel):
            errs.append(f"{where}: channel {channel!r} has a character that breaks the page markup")
        if not isinstance(variants, dict) or not variants:
            errs.append(f"{where} firmware {channel}: not a non-empty object")
            continue
        seen = {}
        for variant, murl in variants.items():
            # Two variants on one manifest is a copy-paste slip: one of them is
            # not flashing what its button says.
            if isinstance(murl, str):
                if murl in seen:
                    errs.append(f"{where} {channel}/{variant}: same manifest as {seen[murl]!r}")
                seen.setdefault(murl, variant)
            if UNSAFE_KEY_CHARS & set(variant):
                errs.append(f"{where}: variant {variant!r} has a character that breaks the page markup")
            errs.extend(check_manifest_url(murl, repo_for(dev, channel, variant),
                                           f"{where} {channel}/{variant}"))
    return errs

def check_unique_ids(devices):
    """A duplicate id sends the second card's #/<id> link to the first entry."""
    seen, errs = set(), []
    for dev in devices:
        dev_id = dev.get("id") if isinstance(dev, dict) else None
        if not isinstance(dev_id, str):
            continue
        if dev_id in seen:
            errs.append(f"{dev_id}: duplicate id")
        seen.add(dev_id)
    return errs

def check_config_shape(config, firmware, dev_id):
    """Validate the optional `config` map (channel -> variant -> https URL).

    Network-free. Every variant key must exist in `firmware[channel]`, like the
    override maps: a mistyped key would silently drop the reflash section.
    Returns a list of error strings (empty when sound).
    """
    errs = []
    if not isinstance(config, dict):
        errs.append(f"{dev_id} config: not an object")
        return errs
    for channel, variants in config.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} config {channel}: not an object")
            continue
        for variant, url in variants.items():
            if not isinstance(url, str) or not url.startswith("https://"):
                errs.append(f"{dev_id} config {channel}/{variant}: not an https URL")
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} config {channel}/{variant}: no such firmware variant")
    return errs

def check_repos_shape(repos, firmware, dev_id):
    """Validate the optional `repos` map (channel -> variant -> "owner/name").

    Network-free. `repos` absent (None) is valid. Every variant key must exist
    in `firmware[channel]`, so a mistyped key that would silently fall back to
    the device repo is caught instead. Returns a list of error strings.
    """
    errs = []
    if repos is None:
        return errs
    if not isinstance(repos, dict):
        errs.append(f"{dev_id} repos: not an object")
        return errs
    for channel, variants in repos.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} repos {channel}: not an object")
            continue
        for variant, repo in variants.items():
            if not is_owner_name(repo):
                errs.append(f"{dev_id} repos {channel}/{variant}: not an 'owner/name' string")
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} repos {channel}/{variant}: no such firmware variant")
    return errs

def check_installers_shape(installers, firmware, dev_id):
    """Validate the optional `installers` map (channel -> variant -> https URL or null).

    Network-free. `installers` absent (None) is valid. A variant value of null
    means "this variant has no classic installer, hide the link"; any other
    value must be an https URL. Every variant key must exist in
    `firmware[channel]`. Returns a list of error strings.
    """
    errs = []
    if installers is None:
        return errs
    if not isinstance(installers, dict):
        errs.append(f"{dev_id} installers: not an object")
        return errs
    for channel, variants in installers.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} installers {channel}: not an object")
            continue
        for variant, url in variants.items():
            if url is not None and (not isinstance(url, str) or not url.startswith("https://")):
                errs.append(f"{dev_id} installers {channel}/{variant}: not an https URL or null")
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} installers {channel}/{variant}: no such firmware variant")
    return errs

def check_variant_notes_shape(notes, firmware, dev_id):
    """Validate the optional `variantNotes` map (channel -> variant -> text).

    Network-free. `notes` absent (None) is valid. Every value must be a
    non-empty string and every variant key must exist in `firmware[channel]`.
    Returns a list of error strings.
    """
    errs = []
    if notes is None:
        return errs
    if not isinstance(notes, dict):
        errs.append(f"{dev_id} variantNotes: not an object")
        return errs
    for channel, variants in notes.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} variantNotes {channel}: not an object")
            continue
        for variant, text in variants.items():
            if not isinstance(text, str) or not text.strip():
                errs.append(f"{dev_id} variantNotes {channel}/{variant}: not a non-empty string")
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} variantNotes {channel}/{variant}: no such firmware variant")
    return errs

# What step 3 of the wizard tells the user after flashing: ESPHome adoption, WLED
# setup, or (standalone) nothing to add, for builds with no network at all.
PLATFORMS = ("esphome", "wled", "standalone")

def check_platform(platform, dev_id):
    """Validate the optional `platform` field (firmware ecosystem).

    Network-free. Absent (None) means esphome, which is what step 3 of the
    wizard falls back to. Anything outside PLATFORMS would silently render the
    ESPHome instructions on a device that does not run ESPHome.
    """
    if platform is None or platform in PLATFORMS:
        return []
    return [f"{dev_id} platform: {platform!r} not one of {', '.join(PLATFORMS)}"]

def check_platforms_shape(platforms, firmware, dev_id):
    """Validate the optional per-variant `platforms` map (channel -> variant -> platform).

    Network-free. Mirrors `repos`/`installers`: absent (None) is valid, only
    variants that differ from the device-level `platform` need listing, and every
    variant key must exist in `firmware[channel]`. Returns a list of errors.
    """
    errs = []
    if platforms is None:
        return errs
    if not isinstance(platforms, dict):
        errs.append(f"{dev_id} platforms: not an object")
        return errs
    for channel, variants in platforms.items():
        if not isinstance(variants, dict):
            errs.append(f"{dev_id} platforms {channel}: not an object")
            continue
        for variant, platform in variants.items():
            if platform not in PLATFORMS:
                errs.append(
                    f"{dev_id} platforms {channel}/{variant}: "
                    f"{platform!r} not one of {', '.join(PLATFORMS)}"
                )
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} platforms {channel}/{variant}: no such firmware variant")
    return errs

def check_manifest(dev_id, channel, variant, murl):
    where = f"{dev_id} {channel}/{variant}"
    try:
        req = urllib.request.Request(murl, headers=dict(UA, Origin=ORIGIN))
        with urllib.request.urlopen(req, timeout=30) as r:
            readable = cors_ok(r.headers)
            manifest = json.load(r)
    except Exception as e:
        errors.append(f"{where}: manifest fetch/parse failed: {e}")
        return
    if not readable:
        errors.append(f"{where}: manifest has no Access-Control-Allow-Origin for {ORIGIN}, "
                      "so the browser can't load it")
    errors.extend(check_manifest_shape(manifest, where))
    for path in part_paths(manifest):
        purl = urllib.parse.urljoin(murl, path)
        headers = head(purl)
        if headers is None:
            errors.append(f"{where}: firmware part missing: {purl}")
        elif not cors_ok(headers):
            errors.append(f"{where}: firmware part not readable cross-origin: {purl}")

def manifests_on_page(html, base):
    """The manifest URLs an installer page flashes: every manifest= attribute
    (esp-web-install-button), resolved against the page URL."""
    return {urllib.parse.urljoin(base, m) for m in MANIFEST_ATTR.findall(html)}

_classic_pages = {}

def classic_manifests(page):
    """Fetch a classic installer page once; None when it can't be reached."""
    if page not in _classic_pages:
        try:
            req = urllib.request.Request(page, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode("utf-8", "replace")
                _classic_pages[page] = manifests_on_page(html, r.geturl())
        except (OSError, http.client.HTTPException, ValueError):
            _classic_pages[page] = None
    return _classic_pages[page]

def check_classic_agrees(where, murl, page, flashed):
    """Each product repo's own classic installer is the reference for which builds
    a first install should flash (e.g. the improv-enabled firmware-factory/ when
    a repo has one). A registry manifest the page doesn't offer is either a
    mapping mistake or a sign the two have drifted apart. This is a membership
    test, so it can't catch two of the page's builds swapped between variants."""
    if flashed is None:
        return [f"{where}: classic installer unreachable: {page}"]
    if murl not in flashed:
        offered = ", ".join(sorted(flashed)) or "none"
        return [f"{where}: classic installer {page} doesn't flash {murl} (it offers: {offered})"]
    return []

def main(argv=None):
    offline = "--offline" in (sys.argv[1:] if argv is None else argv)
    with open("devices.json", encoding="utf-8") as f:
        reg = json.load(f)
    devices = reg.get("devices") if isinstance(reg, dict) else None
    if not isinstance(devices, list) or not devices:
        errors.append("devices.json: no devices[]")
        devices = []
    errors.extend(check_unique_ids(devices))
    for i, dev in enumerate(devices):
        dev_id = dev.get("id") if isinstance(dev, dict) and isinstance(dev.get("id"), str) else f"devices[{i}]"
        errors.extend(check_device_shape(dev, dev_id))
        if not isinstance(dev, dict):
            continue
        # Malformed channels are reported by check_device_shape; leave them out
        # here so the per-variant checks below can't trip over them.
        firmware = dev.get("firmware") if isinstance(dev.get("firmware"), dict) else {}
        firmware = {c: v for c, v in firmware.items() if isinstance(v, dict)}
        config = dev.get("config", {})
        errors.extend(check_config_shape(config, firmware, dev_id))
        errors.extend(check_repos_shape(dev.get("repos"), firmware, dev_id))
        errors.extend(check_variant_notes_shape(dev.get("variantNotes"), firmware, dev_id))
        errors.extend(check_installers_shape(dev.get("installers"), firmware, dev_id))
        errors.extend(check_platform(dev.get("platform"), dev_id))
        errors.extend(check_platforms_shape(dev.get("platforms"), firmware, dev_id))
        if offline:
            continue
        for channel, variants in firmware.items():
            if not isinstance(variants, dict):
                continue
            for variant, murl in variants.items():
                if not isinstance(murl, str):
                    continue
                check_manifest(dev_id, channel, variant, murl)
                page = classic_installer_for(dev, channel, variant)
                if isinstance(page, str):
                    errors.extend(check_classic_agrees(f"{dev_id} {channel}/{variant}", murl,
                                                       page, classic_manifests(page)))
        if isinstance(config, dict):
            for channel, variants in config.items():
                if not isinstance(variants, dict):
                    continue
                for variant, curl in variants.items():
                    if isinstance(curl, str) and not head_ok(curl):
                        errors.append(f"{dev_id} config {channel}/{variant}: unreachable: {curl}")
        wiki = dev.get("wiki")
        if isinstance(wiki, str) and not head_ok(wiki):
            errors.append(f"{dev_id} wiki unreachable: {wiki}")
    if errors:
        print(f"FAILED — {len(errors)} problem(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    if offline:
        print("Registry OK (offline checks only).")
    else:
        print("Registry OK: all manifests live and complete.")

if __name__ == "__main__":
    main()
