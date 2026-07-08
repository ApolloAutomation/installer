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
    except urllib.error.URLError:
        return False

def check_manifest(dev_id, channel, variant, murl):
    where = f"{dev_id} {channel}/{variant}"
    try:
        req = urllib.request.Request(murl, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            manifest = json.load(r)
    except Exception as e:
        errors.append(f"{where}: manifest fetch/parse failed: {e}")
        return
    builds = manifest.get("builds")
    if not builds:
        errors.append(f"{where}: manifest has no builds[]")
        return
    for b in builds:
        if "chipFamily" not in b:
            errors.append(f"{where}: build missing chipFamily")
        for part in b.get("parts", []):
            purl = urllib.parse.urljoin(murl, part["path"])
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
    if errors:
        print(f"FAILED — {len(errors)} problem(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    print("Registry OK: all manifests live and complete.")

if __name__ == "__main__":
    main()
