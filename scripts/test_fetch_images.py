"""Offline unit tests for fetch_images.py (stdlib unittest, no deps).

Run: python scripts/test_fetch_images.py
Covers the CDN rendition URL building and stale-file cleanup without touching
the network.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_images as fi  # noqa: E402

SHOPIFY = "https://cdn.shopify.com/s/files/1/x/files/A.png?v=123"


class RenditionUrl(unittest.TestCase):
    def test_shopify_png_requests_pjpg_and_saves_jpg(self):
        url, ext = fi.rendition_url(SHOPIFY)
        self.assertIn("format=pjpg", url)
        self.assertIn(f"width={fi.WIDTH}", url)
        # Existing query string means the params must be appended with '&'.
        self.assertIn("?v=123&", url)
        # format=pjpg returns image/jpeg, so the on-disk file is always .jpg.
        self.assertEqual(ext, ".jpg")

    def test_shopify_without_query_uses_question_mark(self):
        url, ext = fi.rendition_url("https://cdn.shopify.com/s/files/1/x/files/A.png")
        self.assertIn("?width=", url)
        self.assertNotIn("??", url)
        self.assertEqual(ext, ".jpg")

    def test_shopify_jpg_source_still_pjpg(self):
        url, ext = fi.rendition_url("https://cdn.shopify.com/s/files/1/x/files/B.jpg?v=9")
        self.assertIn("format=pjpg", url)
        self.assertEqual(ext, ".jpg")

    def test_non_shopify_source_unchanged(self):
        src = "https://wiki.apolloautomation.com/assets/productimage.jpg"
        url, ext = fi.rendition_url(src)
        self.assertEqual(url, src)
        self.assertEqual(ext, ".jpg")

    def test_non_shopify_defaults_to_png_when_no_ext(self):
        url, ext = fi.rendition_url("https://example.com/image")
        self.assertEqual(ext, ".png")


class RemoveStale(unittest.TestCase):
    def test_removes_old_extension_keeps_current(self):
        with tempfile.TemporaryDirectory() as d:
            keep = os.path.join(d, "air-1.jpg")
            stale = os.path.join(d, "air-1.png")
            open(keep, "w").close()
            open(stale, "w").close()
            fi.remove_stale(keep)
            self.assertTrue(os.path.exists(keep))
            self.assertFalse(os.path.exists(stale))

    def test_does_not_touch_other_devices(self):
        with tempfile.TemporaryDirectory() as d:
            keep = os.path.join(d, "air-1.jpg")
            other = os.path.join(d, "air-10.jpg")  # different device id
            open(keep, "w").close()
            open(other, "w").close()
            fi.remove_stale(keep)
            self.assertTrue(os.path.exists(other))

    def test_does_not_touch_same_base_non_image(self):
        with tempfile.TemporaryDirectory() as d:
            keep = os.path.join(d, "air-1.jpg")
            note = os.path.join(d, "air-1.txt")  # same base, not an image
            open(keep, "w").close()
            open(note, "w").close()
            fi.remove_stale(keep)
            self.assertTrue(os.path.exists(note))


if __name__ == "__main__":
    unittest.main()
