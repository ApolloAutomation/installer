"""Download product images from devices.json imageSource into images/.

Run from repo root: python scripts/fetch_images.py
Re-run any time to refresh; commits stay the source of truth.
"""
import json
import os
import urllib.parse
import urllib.request

REG = "devices.json"
UA = {"User-Agent": "apollo-installer-image-fetch"}

def main():
    with open(REG, encoding="utf-8") as f:
        reg = json.load(f)
    os.makedirs("images", exist_ok=True)
    for dev in reg["devices"]:
        src = dev.get("imageSource")
        if not src:
            print(f"{dev['id']}: no imageSource, skipped")
            continue
        path = urllib.parse.urlparse(src).path
        ext = os.path.splitext(path)[1].lower() or ".png"
        sep = "&" if "?" in src else "?"
        url = f"{src}{sep}width=800" if "cdn.shopify.com" in src else src
        dest = f"images/{dev['id']}{ext}"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
            out.write(r.read())
        dev["image"] = dest
        print(f"{dev['id']}: {dest} ({os.path.getsize(dest)} bytes)")
    with open(REG, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2)
        f.write("\n")

if __name__ == "__main__":
    main()
