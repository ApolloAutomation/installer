"""Download product images from devices.json imageSource into images/.

Run from repo root: python scripts/fetch_images.py
Re-run any time to refresh; commits stay the source of truth.

Shopify CDN sources are requested as small progressive-JPEG renditions
(width + format=pjpg), which shrinks the ~700-900KB product PNGs to tens of KB.
The CDN ignores format=webp on this store, so pjpg is the only conversion that
takes effect. When a device's image extension changes (e.g. .png -> .jpg) the
old file is removed so it doesn't linger in the repo and the deploy.
"""
import glob
import json
import os
import urllib.parse
import urllib.request

REG = "devices.json"
UA = {"User-Agent": "apollo-installer-image-fetch"}
WIDTH = 600  # ~3x the largest rendered size (hub card), plenty for retina
IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")  # only ever remove image files

def rendition_url(src):
    """Return (url, ext) to fetch for an imageSource.

    Shopify CDN sources are downscaled and converted to progressive JPEG, so the
    on-disk file is always .jpg. Other sources are fetched unchanged, keeping the
    extension from their path (defaulting to .png).
    """
    if "cdn.shopify.com" not in src:
        path = urllib.parse.urlparse(src).path
        ext = os.path.splitext(path)[1].lower() or ".png"
        return src, ext
    sep = "&" if "?" in src else "?"
    return f"{src}{sep}width={WIDTH}&format=pjpg", ".jpg"

def remove_stale(dest):
    """Delete any same-id image whose extension differs from the one just saved.

    Only known image extensions are ever removed, so a same-named non-image file
    (e.g. a stray images/<id>.txt) is never touched.
    """
    base = os.path.splitext(dest)[0]  # e.g. images/air-1
    for old in glob.glob(base + ".*"):
        if os.path.splitext(old)[1].lower() not in IMG_EXTS:
            continue
        if os.path.normpath(old) != os.path.normpath(dest):
            os.remove(old)
            print(f"  removed stale {old}")

def main():
    with open(REG, encoding="utf-8") as f:
        reg = json.load(f)
    os.makedirs("images", exist_ok=True)
    for dev in reg["devices"]:
        src = dev.get("imageSource")
        if not src:
            print(f"{dev['id']}: no imageSource, skipped")
            continue
        url, ext = rendition_url(src)
        dest = f"images/{dev['id']}{ext}"
        # Non-Shopify sources can't be CDN-downscaled; if we already have the
        # file (it may be hand-resized, like msr-1), keep it rather than
        # re-downloading the full-size original and undoing that work.
        if "cdn.shopify.com" not in src and os.path.exists(dest):
            dev["image"] = dest
            print(f"{dev['id']}: kept existing {dest} (non-Shopify source, not re-fetched)")
            continue
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
            out.write(r.read())
        remove_stale(dest)
        dev["image"] = dest
        print(f"{dev['id']}: {dest} ({os.path.getsize(dest)} bytes)")
    with open(REG, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2)
        f.write("\n")

if __name__ == "__main__":
    main()
