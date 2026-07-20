"""Validate every manifest URL in devices.json.

Checks: manifest fetches (200) and parses; has builds[] with chipFamily;
every part path resolves and exists (HEAD 200). Exit 1 on any failure.
Run: python scripts/validate_registry.py
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "apollo-installer-registry-check"}
errors = []

def head_ok(url):
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError):
        # A read-phase timeout raises TimeoutError, not URLError — treat any
        # connection/timeout failure as "part unreachable" rather than crashing.
        return False

def check_manifest_shape(manifest, where):
    """Validate manifest structure without touching the network.

    Returns a list of error strings (empty when the shape is sound). A build
    with no parts, or a part with no "path", is a hard error rather than a
    silent pass or a KeyError crash.
    """
    errs = []
    builds = manifest.get("builds")
    if not builds:
        errs.append(f"{where}: manifest has no builds[]")
        return errs
    for b in builds:
        if "chipFamily" not in b:
            errs.append(f"{where}: build missing chipFamily")
        parts = b.get("parts")
        if not parts:
            errs.append(f"{where}: build has no parts[]")
            continue
        for part in parts:
            if not part.get("path"):
                # Absent, empty, or null path — matches the network loop's skip
                # test so a broken path can never slip past both checks.
                errs.append(f"{where}: firmware part missing 'path'")
    return errs

def check_config_shape(config, dev_id):
    """Validate the optional `config` map (channel -> variant -> https URL).

    Returns a list of error strings (empty when sound). Network-free.
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
            if (not isinstance(repo, str) or repo.count("/") != 1
                    or " " in repo or not all(repo.split("/"))):
                errs.append(f"{dev_id} repos {channel}/{variant}: not an 'owner/name' string")
            if variant not in firmware.get(channel, {}):
                errs.append(f"{dev_id} repos {channel}/{variant}: no such firmware variant")
    return errs

def check_manifest(dev_id, channel, variant, murl):
    where = f"{dev_id} {channel}/{variant}"
    try:
        req = urllib.request.Request(murl, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            manifest = json.load(r)
    except Exception as e:
        errors.append(f"{where}: manifest fetch/parse failed: {e}")
        return
    errors.extend(check_manifest_shape(manifest, where))
    for b in manifest.get("builds", []):
        for part in b.get("parts", []):
            path = part.get("path")
            if not path:
                continue  # already reported by check_manifest_shape
            purl = urllib.parse.urljoin(murl, path)
            if not head_ok(purl):
                errors.append(f"{where}: firmware part missing: {purl}")

def main():
    with open("devices.json", encoding="utf-8") as f:
        reg = json.load(f)
    for dev in reg["devices"]:
        if not dev.get("firmware", {}).get("stable"):
            errors.append(f"{dev['id']}: no stable channel")
        for channel, variants in dev.get("firmware", {}).items():
            for variant, murl in variants.items():
                check_manifest(dev["id"], channel, variant, murl)
        config = dev.get("config", {})
        errors.extend(check_config_shape(config, dev["id"]))
        errors.extend(check_repos_shape(dev.get("repos"), dev.get("firmware", {}), dev["id"]))
        if not isinstance(config, dict):
            continue
        for channel, variants in config.items():
            if not isinstance(variants, dict):
                continue
            for variant, curl in variants.items():
                if isinstance(curl, str) and not head_ok(curl):
                    errors.append(f"{dev['id']} config {channel}/{variant}: unreachable: {curl}")
    if errors:
        print(f"FAILED — {len(errors)} problem(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    print("Registry OK: all manifests live and complete.")

if __name__ == "__main__":
    main()
