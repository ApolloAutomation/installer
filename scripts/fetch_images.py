"""Download product images from devices.json imageSource into images/.

Run from repo root: python scripts/fetch_images.py [device-id ...]
With ids, only those devices are fetched (e.g. the one you just added);
without, every device is. Re-run any time to refresh; commits stay the source
of truth.

Shopify CDN sources are requested as small progressive-JPEG renditions
(width + format=pjpg), which shrinks the ~700-900KB product PNGs to tens of KB.
The CDN ignores format=webp on this store, so pjpg is the only conversion that
takes effect. When a device's image extension changes (e.g. .png -> .jpg) the
old file is removed so it doesn't linger in the repo and the deploy.

Other sources can't be resized here: save a ~600px JPEG by hand as
images/<id>.jpg and the script keeps it from then on.
"""
import glob
import json
import os
import sys
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

def existing_image(dev, dest):
    """The image to keep for a non-Shopify source, if one is already on disk.

    Checks the registry's current `image` first: a hand-made rendition (h-1 is a
    600px JPEG of a PNG source) has a different extension than `dest`, and
    re-fetching would replace it with the full-size original.
    """
    for path in (dev.get("image"), dest):
        if path and os.path.exists(path):
            return path
    return None

def download(url, dest):
    """Fetch url into dest, replacing it only once a complete image has arrived,
    so a failed or non-image response never truncates the committed file."""
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        ctype = r.headers.get_content_type()
        data = r.read()
    if not ctype.startswith("image/") or not data:
        raise ValueError(f"{url} returned {ctype} ({len(data)} bytes), not an image")
    tmp = dest + ".tmp"
    with open(tmp, "wb") as out:
        out.write(data)
    os.replace(tmp, dest)

def main(argv=None):
    only = set(sys.argv[1:] if argv is None else argv)
    with open(REG, encoding="utf-8") as f:
        reg = json.load(f)
    unknown = only - {dev["id"] for dev in reg["devices"]}
    if unknown:
        sys.exit(f"No such device id(s): {', '.join(sorted(unknown))}")
    os.makedirs("images", exist_ok=True)
    for dev in reg["devices"]:
        if only and dev["id"] not in only:
            continue
        src = dev.get("imageSource")
        if not src:
            print(f"{dev['id']}: no imageSource, skipped")
            continue
        url, ext = rendition_url(src)
        dest = f"images/{dev['id']}{ext}"
        # Non-Shopify sources can't be CDN-downscaled; if we already have the
        # file (it may be hand-resized, like msr-1 or h-1), keep it rather than
        # re-downloading the full-size original and undoing that work.
        if "cdn.shopify.com" not in src:
            kept = existing_image(dev, dest)
            if kept:
                dev["image"] = kept
                print(f"{dev['id']}: kept existing {kept} (non-Shopify source, not re-fetched)")
                continue
        download(url, dest)
        remove_stale(dest)
        dev["image"] = dest
        print(f"{dev['id']}: {dest} ({os.path.getsize(dest)} bytes)")
    with open(REG, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
        f.write("\n")

if __name__ == "__main__":
    main()
