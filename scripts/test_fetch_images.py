"""Offline unit tests for fetch_images.py (stdlib unittest, no deps).

Run: python scripts/test_fetch_images.py
Covers the CDN rendition URL building, stale-file cleanup, the download and
main() against a temporary registry, without touching the network.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

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


class FakeResponse(io.BytesIO):
    def __init__(self, body, ctype):
        super().__init__(body)
        self.headers = mock.Mock(get_content_type=lambda: ctype)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class InTempRepo(unittest.TestCase):
    def setUp(self):
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        os.makedirs("images")

    def tearDown(self):
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def write_registry(self, devices):
        with open("devices.json", "w", encoding="utf-8") as f:
            json.dump({"devices": devices}, f)

    def run_main(self, argv=(), urlopen=None):
        urlopen = urlopen or mock.Mock(side_effect=AssertionError("fetched unexpectedly"))
        with mock.patch.object(fi.urllib.request, "urlopen", urlopen), \
                contextlib.redirect_stdout(io.StringIO()):
            fi.main(list(argv))
        with open("devices.json", encoding="utf-8") as f:
            return {d["id"]: d for d in json.load(f)["devices"]}


class Main(InTempRepo):
    H1 = {"id": "h-1", "name": "H-1", "image": "images/h-1.jpg",
          "imageSource": "https://wiki.apolloautomation.com/assets/h-1-usa.png"}

    def test_keeps_hand_made_rendition_of_non_shopify_png(self):
        # images/h-1.jpg is a 600px JPEG of a PNG source. A re-run must not
        # download the full-size PNG and delete the JPEG.
        with open("images/h-1.jpg", "wb") as f:
            f.write(b"jpeg")
        self.write_registry([self.H1])
        devs = self.run_main()
        self.assertTrue(os.path.exists("images/h-1.jpg"))
        self.assertFalse(os.path.exists("images/h-1.png"))
        self.assertEqual(devs["h-1"]["image"], "images/h-1.jpg")

    def test_only_fetches_the_named_devices(self):
        shop = {"id": "air-1", "image": "images/air-1.jpg", "imageSource": SHOPIFY}
        self.write_registry([dict(shop), dict(shop, id="msr-2", image="images/msr-2.jpg")])
        urlopen = mock.Mock(return_value=FakeResponse(b"jpeg", "image/jpeg"))
        self.run_main(["air-1"], urlopen)
        self.assertEqual(urlopen.call_count, 1)
        self.assertTrue(os.path.exists("images/air-1.jpg"))
        self.assertFalse(os.path.exists("images/msr-2.jpg"))

    def test_unknown_id_exits(self):
        self.write_registry([self.H1])
        with self.assertRaises(SystemExit):
            self.run_main(["nope"])

    def test_keeps_non_ascii_text_readable(self):
        self.write_registry([dict(self.H1, description="Ornament — 2024")])
        open("images/h-1.jpg", "wb").close()
        self.run_main()
        with open("devices.json", encoding="utf-8") as f:
            self.assertIn("Ornament — 2024", f.read())


class Download(InTempRepo):
    def test_non_image_response_leaves_committed_file_alone(self):
        with open("images/air-1.jpg", "wb") as f:
            f.write(b"committed")
        resp = FakeResponse(b"<html>error</html>", "text/html")
        with mock.patch.object(fi.urllib.request, "urlopen", return_value=resp):
            with self.assertRaises(ValueError):
                fi.download("https://x/a.jpg", "images/air-1.jpg")
        with open("images/air-1.jpg", "rb") as f:
            self.assertEqual(f.read(), b"committed")

    def test_failed_read_leaves_committed_file_alone(self):
        with open("images/air-1.jpg", "wb") as f:
            f.write(b"committed")
        resp = FakeResponse(b"", "image/jpeg")
        resp.read = mock.Mock(side_effect=TimeoutError("read timed out"))
        with mock.patch.object(fi.urllib.request, "urlopen", return_value=resp):
            with self.assertRaises(TimeoutError):
                fi.download("https://x/a.jpg", "images/air-1.jpg")
        with open("images/air-1.jpg", "rb") as f:
            self.assertEqual(f.read(), b"committed")


if __name__ == "__main__":
    unittest.main()
