"""Offline unit tests for validate_registry.py (stdlib unittest, no deps).

Run: python scripts/test_validate_registry.py
Covers the shape checks, head_ok's exception handling, the classic-installer
comparison and main() against a temporary registry, without touching the network.
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
import validate_registry as vr  # noqa: E402

vr.RETRY_DELAY = 0  # the retry tests below must not sleep


class FakeResponse:
    def __init__(self, body=b"", status=200, headers=None, url="https://example.com/"):
        self.status, self.headers, self._body, self._url = status, headers or {}, body, url

    def read(self):
        return self._body

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code):
    return vr.urllib.error.HTTPError("https://example.com/x", code, "err", {}, None)


class ShapeChecks(unittest.TestCase):
    def test_good_manifest_has_no_errors(self):
        m = {"builds": [{"chipFamily": "ESP32", "parts": [{"path": "a.bin", "offset": 0}]}]}
        self.assertEqual(vr.check_manifest_shape(m, "dev stable/wifi"), [])

    def test_no_builds_errors(self):
        errs = vr.check_manifest_shape({"builds": []}, "dev stable/wifi")
        self.assertTrue(any("builds" in e for e in errs), errs)

    def test_empty_parts_errors(self):
        m = {"builds": [{"chipFamily": "ESP32", "parts": []}]}
        errs = vr.check_manifest_shape(m, "dev stable/wifi")
        self.assertTrue(any("parts" in e for e in errs), errs)

    def test_missing_parts_key_errors(self):
        m = {"builds": [{"chipFamily": "ESP32"}]}
        errs = vr.check_manifest_shape(m, "dev stable/wifi")
        self.assertTrue(any("parts" in e for e in errs), errs)

    def test_part_missing_path_errors_without_crashing(self):
        # A part dict with no "path" key must be reported, not raise KeyError.
        m = {"builds": [{"chipFamily": "ESP32", "parts": [{"offset": 0}]}]}
        errs = vr.check_manifest_shape(m, "dev stable/wifi")
        self.assertTrue(any("path" in e for e in errs), errs)

    def test_part_empty_path_errors(self):
        # An empty or null path must also be reported: the network loop skips
        # falsy paths, so the shape check has to catch them or nothing does.
        for bad in ("", None):
            m = {"builds": [{"chipFamily": "ESP32", "parts": [{"path": bad}]}]}
            errs = vr.check_manifest_shape(m, "dev stable/wifi")
            self.assertTrue(any("path" in e for e in errs), (bad, errs))

    def test_missing_chip_family_errors(self):
        m = {"builds": [{"parts": [{"path": "a.bin"}]}]}
        errs = vr.check_manifest_shape(m, "dev stable/wifi")
        self.assertTrue(any("chipFamily" in e for e in errs), errs)

    def test_unknown_chip_family_errors(self):
        # esp-web-tools matches chipFamily exactly; "ESP32C3" would be "unsupported".
        m = {"builds": [{"chipFamily": "ESP32C3", "parts": [{"path": "a.bin"}]}]}
        errs = vr.check_manifest_shape(m, "dev stable/wifi")
        self.assertTrue(any("unknown chipFamily" in e for e in errs), errs)

    def test_non_object_manifest_errors_without_crashing(self):
        for bad in ([{"chipFamily": "ESP32"}], "x", None):
            errs = vr.check_manifest_shape(bad, "dev stable/wifi")
            self.assertTrue(any("not a JSON object" in e for e in errs), (bad, errs))

    def test_non_object_build_or_part_errors_without_crashing(self):
        self.assertTrue(vr.check_manifest_shape({"builds": ["x"]}, "d"))
        m = {"builds": [{"chipFamily": "ESP32", "parts": ["a.bin"]}]}
        errs = vr.check_manifest_shape(m, "d")
        self.assertTrue(any("path" in e for e in errs), errs)
        self.assertEqual(list(vr.part_paths(m)), [])

    def test_non_string_part_path_errors_and_is_skipped(self):
        # urljoin() would raise on a numeric path in the network loop.
        m = {"builds": [{"chipFamily": "ESP32", "parts": [{"path": 123}, {"path": "a.bin"}]}]}
        errs = vr.check_manifest_shape(m, "d")
        self.assertTrue(any("path" in e for e in errs), errs)
        self.assertEqual(list(vr.part_paths(m)), ["a.bin"])


class HeadOk(unittest.TestCase):
    def test_url_error_returns_false(self):
        with mock.patch.object(vr.urllib.request, "urlopen",
                               side_effect=vr.urllib.error.URLError("boom")):
            self.assertFalse(vr.head_ok("https://example.com/x.bin"))

    def test_read_phase_timeout_returns_false(self):
        # A timeout during the response read raises TimeoutError, which is not a
        # URLError subclass — head_ok must swallow it and report the part missing.
        with mock.patch.object(vr.urllib.request, "urlopen",
                               side_effect=TimeoutError("read timed out")):
            self.assertFalse(vr.head_ok("https://example.com/x.bin"))

    def test_dropped_connection_returns_false(self):
        # urllib does not wrap a server hang-up in URLError.
        for exc in (vr.http.client.RemoteDisconnected("closed"), ConnectionResetError()):
            with mock.patch.object(vr.urllib.request, "urlopen", side_effect=exc):
                self.assertFalse(vr.head_ok("https://example.com/x.bin"), exc)

    def test_transient_failure_is_retried_once(self):
        # One blip (the 2026-10-23 nightly: AIR-1's classic page) must not fail the run.
        ok = FakeResponse(headers={"Access-Control-Allow-Origin": "*"})
        for blip in (vr.urllib.error.URLError("reset"), TimeoutError(), http_error(503)):
            urlopen = mock.Mock(side_effect=[blip, ok])
            with mock.patch.object(vr.urllib.request, "urlopen", urlopen):
                self.assertTrue(vr.head_ok("https://example.com/x.bin"), blip)
            self.assertEqual(urlopen.call_count, 2, blip)

    def test_head_never_reads_a_body(self):
        # On Python 3.12 a redirected HEAD becomes a GET; reading it would pull
        # down a whole firmware image for every part checked.
        ok = FakeResponse()
        ok.read = mock.Mock(side_effect=AssertionError("HEAD read a body"))
        with mock.patch.object(vr.urllib.request, "urlopen", return_value=ok):
            self.assertTrue(vr.head_ok("https://example.com/x.bin"))

    def test_client_error_is_not_retried(self):
        urlopen = mock.Mock(side_effect=http_error(404))
        with mock.patch.object(vr.urllib.request, "urlopen", urlopen):
            self.assertFalse(vr.head_ok("https://example.com/x.bin"))
        self.assertEqual(urlopen.call_count, 1)

    def test_gives_up_after_one_retry(self):
        urlopen = mock.Mock(side_effect=vr.urllib.error.URLError("down"))
        with mock.patch.object(vr.urllib.request, "urlopen", urlopen):
            self.assertFalse(vr.head_ok("https://example.com/x.bin"))
        self.assertEqual(urlopen.call_count, 2)

    def test_classic_page_fetch_is_retried_and_resolves_against_the_final_url(self):
        # Without the trailing slash, Pages redirects to .../AIR-1/; relative
        # manifests must resolve there, not at the site root.
        page = "https://apolloautomation.github.io/AIR-1"
        html = b'<esp-web-install-button manifest="./firmware-factory/manifest.json">'
        urlopen = mock.Mock(side_effect=[TimeoutError(), FakeResponse(html, url=page + "/")])
        vr._classic_pages.clear()
        with mock.patch.object(vr.urllib.request, "urlopen", urlopen):
            self.assertEqual(vr.classic_manifests(page), {page + "/firmware-factory/manifest.json"})
        self.assertEqual(urlopen.call_count, 2)
        vr._classic_pages.clear()

    def test_manifest_fetch_is_retried(self):
        body = b'{"builds": [{"chipFamily": "ESP32", "parts": [{"path": "a.bin"}]}]}'
        cors = {"Access-Control-Allow-Origin": "*"}
        urlopen = mock.Mock(side_effect=[
            vr.urllib.error.URLError("reset"), FakeResponse(body, headers=cors),  # manifest
            FakeResponse(headers=cors),                                            # part HEAD
        ])
        vr.errors.clear()
        with mock.patch.object(vr.urllib.request, "urlopen", urlopen):
            vr.check_manifest("dev", "stable", "v", "https://example.com/m/manifest.json")
        self.assertEqual(vr.errors, [])
        self.assertEqual(urlopen.call_count, 3)

    def test_cors_ok(self):
        self.assertTrue(vr.cors_ok({"Access-Control-Allow-Origin": "*"}))
        self.assertTrue(vr.cors_ok({"Access-Control-Allow-Origin": vr.ORIGIN}))
        self.assertFalse(vr.cors_ok({}))
        self.assertFalse(vr.cors_ok({"Access-Control-Allow-Origin": "https://evil.example"}))


class ConfigShape(unittest.TestCase):
    FW = {"stable": {"WiFi": "https://x/m.json", "Standard": "https://y/m.json"}}

    def test_good_config_has_no_errors(self):
        cfg = {"stable": {"WiFi": "https://raw.githubusercontent.com/o/r/main/a.yaml"}}
        self.assertEqual(vr.check_config_shape(cfg, self.FW, "r-pro-1"), [])

    def test_non_string_url_errors(self):
        cfg = {"stable": {"WiFi": 123}}
        errs = vr.check_config_shape(cfg, self.FW, "r-pro-1")
        self.assertTrue(any("WiFi" in e for e in errs), errs)

    def test_non_https_url_errors(self):
        cfg = {"stable": {"Standard": "http://insecure/a.yaml"}}
        errs = vr.check_config_shape(cfg, self.FW, "x")
        self.assertTrue(any("https" in e for e in errs), errs)

    def test_channel_not_object_errors(self):
        cfg = {"stable": "oops"}
        errs = vr.check_config_shape(cfg, self.FW, "x")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_non_dict_config_errors_without_crashing(self):
        for bad in (None, "oops", []):
            errs = vr.check_config_shape(bad, self.FW, "x")
            self.assertTrue(any("config" in e for e in errs), (bad, errs))

    def test_variant_not_in_firmware_errors(self):
        # A typo would silently drop the "Build or reflash" section for the variant.
        cfg = {"stable": {"Standrd": "https://raw.githubusercontent.com/o/r/main/a.yaml"}}
        errs = vr.check_config_shape(cfg, self.FW, "x")
        self.assertTrue(any("no such firmware variant" in e for e in errs), errs)


class ReposShapeChecks(unittest.TestCase):
    FW = {"stable": {"v16": "https://x/m.json", "v14": "https://y/m.json"}}

    def test_absent_repos_ok(self):
        self.assertEqual(vr.check_repos_shape(None, self.FW, "dev"), [])

    def test_valid_override_ok(self):
        repos = {"stable": {"v16": "Owner/Repo"}}
        self.assertEqual(vr.check_repos_shape(repos, self.FW, "dev"), [])

    def test_repos_not_dict_errors(self):
        errs = vr.check_repos_shape([], self.FW, "dev")
        self.assertTrue(any("repos" in e for e in errs), errs)

    def test_channel_not_dict_errors(self):
        errs = vr.check_repos_shape({"stable": "x"}, self.FW, "dev")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_bad_owner_name_errors(self):
        for bad in ("OwnerRepo", "a/b/c", "own er/repo", "", "/repo", "owner/"):
            errs = vr.check_repos_shape({"stable": {"v16": bad}}, self.FW, "dev")
            self.assertTrue(any("owner/name" in e for e in errs), (bad, errs))

    def test_variant_not_in_firmware_errors(self):
        errs = vr.check_repos_shape({"stable": {"ghost": "Owner/Repo"}}, self.FW, "dev")
        self.assertTrue(any("no such firmware variant" in e for e in errs), errs)


class InstallersShapeChecks(unittest.TestCase):
    FW = {"stable": {"v16": "https://x/m.json", "v14": "https://y/m.json"}}

    def test_absent_ok(self):
        self.assertEqual(vr.check_installers_shape(None, self.FW, "dev"), [])

    def test_null_hide_ok(self):
        self.assertEqual(vr.check_installers_shape({"stable": {"v16": None}}, self.FW, "dev"), [])

    def test_url_override_ok(self):
        ins = {"stable": {"v16": "https://apolloautomation.github.io/WLED-M1/"}}
        self.assertEqual(vr.check_installers_shape(ins, self.FW, "dev"), [])

    def test_not_dict_errors(self):
        errs = vr.check_installers_shape([], self.FW, "dev")
        self.assertTrue(any("installers" in e for e in errs), errs)

    def test_channel_not_dict_errors(self):
        errs = vr.check_installers_shape({"stable": "x"}, self.FW, "dev")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_non_https_non_null_errors(self):
        for bad in ("http://x", "ftp://x", "not-a-url", 5):
            errs = vr.check_installers_shape({"stable": {"v16": bad}}, self.FW, "dev")
            self.assertTrue(any("https URL or null" in e for e in errs), (bad, errs))

    def test_variant_not_in_firmware_errors(self):
        errs = vr.check_installers_shape({"stable": {"ghost": None}}, self.FW, "dev")
        self.assertTrue(any("no such firmware variant" in e for e in errs), errs)


class VariantNotesShapeChecks(unittest.TestCase):
    FW = {"stable": {"Smart (Wi-Fi)": "https://x/m.json", "Basic (No Wi-Fi)": "https://y/m.json"}}

    def test_absent_ok(self):
        self.assertEqual(vr.check_variant_notes_shape(None, self.FW, "dev"), [])

    def test_text_ok(self):
        notes = {"stable": {"Smart (Wi-Fi)": "Joins your Wi-Fi."}}
        self.assertEqual(vr.check_variant_notes_shape(notes, self.FW, "dev"), [])

    def test_not_dict_errors(self):
        errs = vr.check_variant_notes_shape([], self.FW, "dev")
        self.assertTrue(any("variantNotes" in e for e in errs), errs)

    def test_channel_not_dict_errors(self):
        errs = vr.check_variant_notes_shape({"stable": "x"}, self.FW, "dev")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_empty_or_non_string_errors(self):
        for bad in ("", "   ", None, 5):
            errs = vr.check_variant_notes_shape({"stable": {"Smart (Wi-Fi)": bad}}, self.FW, "dev")
            self.assertTrue(any("non-empty string" in e for e in errs), (bad, errs))

    def test_variant_not_in_firmware_errors(self):
        errs = vr.check_variant_notes_shape({"stable": {"ghost": "text"}}, self.FW, "dev")
        self.assertTrue(any("no such firmware variant" in e for e in errs), errs)


class PlatformChecks(unittest.TestCase):
    def test_absent_means_esphome(self):
        self.assertEqual(vr.check_platform(None, "dev"), [])

    def test_known_platforms_ok(self):
        for p in ("esphome", "wled", "standalone"):
            self.assertEqual(vr.check_platform(p, "dev"), [], p)

    def test_unknown_platform_errors(self):
        for bad in ("ESPHome", "tasmota", "", 5):
            errs = vr.check_platform(bad, "dev")
            self.assertTrue(any("platform" in e for e in errs), (bad, errs))


class PlatformsShapeChecks(unittest.TestCase):
    FW = {"stable": {"v16": "https://x/m.json", "v14": "https://y/m.json"}}

    def test_absent_ok(self):
        self.assertEqual(vr.check_platforms_shape(None, self.FW, "dev"), [])

    def test_override_ok(self):
        pf = {"stable": {"v16": "esphome"}}
        self.assertEqual(vr.check_platforms_shape(pf, self.FW, "dev"), [])

    def test_not_dict_errors(self):
        errs = vr.check_platforms_shape([], self.FW, "dev")
        self.assertTrue(any("platforms" in e for e in errs), errs)

    def test_channel_not_dict_errors(self):
        errs = vr.check_platforms_shape({"stable": "x"}, self.FW, "dev")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_unknown_platform_errors(self):
        errs = vr.check_platforms_shape({"stable": {"v16": "tasmota"}}, self.FW, "dev")
        self.assertTrue(any("not one of" in e for e in errs), errs)

    def test_variant_not_in_firmware_errors(self):
        errs = vr.check_platforms_shape({"stable": {"ghost": "wled"}}, self.FW, "dev")
        self.assertTrue(any("no such firmware variant" in e for e in errs), errs)


def device(**over):
    d = {
        "id": "msr-1", "name": "MSR-1", "category": "mmWave presence",
        "description": "Sensor", "image": "images/msr-1.jpg",
        "wiki": "https://wiki.apolloautomation.com/products/msr1/introduction/",
        "repo": "ApolloAutomation/MSR-1",
        "githubPagesInstaller": "https://apolloautomation.github.io/MSR-1/",
        "firmware": {"stable": {
            "Standard": "https://apolloautomation.github.io/MSR-1/firmware-factory/manifest.json"}},
    }
    d.update(over)
    return d


class InTempRepo(unittest.TestCase):
    """Run with cwd in a scratch dir holding images/msr-1.jpg, like the repo root."""

    def setUp(self):
        self._cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        os.makedirs("images")
        open("images/msr-1.jpg", "wb").close()

    def tearDown(self):
        os.chdir(self._cwd)
        self._tmp.cleanup()


class DeviceShape(InTempRepo):
    def test_good_device_ok(self):
        self.assertEqual(vr.check_device_shape(device(), "msr-1"), [])

    def test_missing_required_field_errors(self):
        for key in vr.REQUIRED:
            d = device()
            del d[key]
            errs = vr.check_device_shape(d, "x")
            self.assertTrue(any(repr(key) in e for e in errs), (key, errs))

    def test_id_must_be_lowercase_kebab(self):
        for bad in ("MSR-1", "msr_1", "msr 1", "-msr", "msr--1"):
            errs = vr.check_device_shape(device(id=bad), "x")
            self.assertTrue(any("lowercase-kebab" in e for e in errs), (bad, errs))

    def test_missing_image_file_errors(self):
        errs = vr.check_device_shape(device(image="images/nope.jpg"), "x")
        self.assertTrue(any("does not exist" in e for e in errs), errs)

    def test_image_named_after_id(self):
        open("images/other.jpg", "wb").close()
        errs = vr.check_device_shape(device(image="images/other.jpg"), "x")
        self.assertTrue(any("named after the id" in e for e in errs), errs)

    def test_non_https_urls_error(self):
        for key in ("wiki", "githubPagesInstaller", "imageSource"):
            errs = vr.check_device_shape(device(**{key: "http://x/"}), "x")
            self.assertTrue(any(key in e for e in errs), (key, errs))

    def test_empty_channel_errors(self):
        fw = {"stable": device()["firmware"]["stable"], "beta": {}}
        errs = vr.check_device_shape(device(firmware=fw), "x")
        self.assertTrue(any("beta" in e for e in errs), errs)

    def test_no_stable_channel_errors(self):
        errs = vr.check_device_shape(device(firmware={"beta": {"a": "https://x"}}), "x")
        self.assertTrue(any("no stable channel" in e for e in errs), errs)

    def test_two_variants_on_one_manifest_errors(self):
        # e.g. the Ethernet variant pasted with the WiFi build's URL.
        url = "https://apolloautomation.github.io/MSR-1/firmware-w/manifest.json"
        errs = vr.check_device_shape(device(firmware={"stable": {"WiFi": url, "Ethernet": url}}), "x")
        self.assertTrue(any("same manifest as 'WiFi'" in e for e in errs), errs)

    def test_markup_breaking_variant_key_errors(self):
        url = "https://apolloautomation.github.io/MSR-1/firmware/manifest.json"
        errs = vr.check_device_shape(device(firmware={"stable": {'Say "hi"': url}}), "x")
        self.assertTrue(any("breaks the page markup" in e for e in errs), errs)


class ManifestUrl(unittest.TestCase):
    def test_own_pages_site_ok(self):
        url = "https://apolloautomation.github.io/MSR-1/firmware-factory/manifest.json"
        self.assertEqual(vr.check_manifest_url(url, "ApolloAutomation/MSR-1", "w"), [])

    def test_manifest_copied_from_another_device_errors(self):
        # The copy-paste mistake that would flash H-2 firmware onto an H-3.
        url = "https://apolloautomation.github.io/H-2/firmware/manifest.json"
        errs = vr.check_manifest_url(url, "ApolloAutomation/H-3", "w")
        self.assertTrue(any("Pages site" in e for e in errs), errs)

    def test_release_asset_host_errors(self):
        url = "https://github.com/ApolloAutomation/MSR-2/releases/download/beta-fw/manifest.json"
        self.assertTrue(vr.check_manifest_url(url, "ApolloAutomation/MSR-2", "w"))

    def test_non_https_errors(self):
        url = "http://apolloautomation.github.io/MSR-1/firmware/manifest.json"
        errs = vr.check_manifest_url(url, "ApolloAutomation/MSR-1", "w")
        self.assertTrue(any("https" in e for e in errs), errs)

    def test_repos_override_is_used(self):
        dev = device(id="m-1", repo="ApolloAutomation/WLED-MM-M1",
                     repos={"stable": {"v16": "ApolloAutomation/WLED-M1"}})
        self.assertEqual(vr.repo_for(dev, "stable", "v16"), "ApolloAutomation/WLED-M1")
        self.assertEqual(vr.repo_for(dev, "stable", "v14"), "ApolloAutomation/WLED-MM-M1")


class UniqueIds(unittest.TestCase):
    def test_duplicate_id_errors(self):
        # Merging PR #32 as it stood would have listed TEMP_PRO-1 twice.
        errs = vr.check_unique_ids([device(), device(id="air-1"), device()])
        self.assertEqual(errs, ["msr-1: duplicate id"])


class ClassicInstaller(unittest.TestCase):
    PAGE = "https://apolloautomation.github.io/AIR-1/"
    HTML = """<esp-web-install-button manifest="./firmware-factory/manifest.json">
              <esp-web-install-button manifest='https://other.example/m.json'>"""

    def test_manifests_on_page_resolves_relative_urls(self):
        self.assertEqual(vr.manifests_on_page(self.HTML, self.PAGE), {
            "https://apolloautomation.github.io/AIR-1/firmware-factory/manifest.json",
            "https://other.example/m.json"})

    def test_registry_build_the_page_flashes_ok(self):
        flashed = vr.manifests_on_page(self.HTML, self.PAGE)
        url = self.PAGE + "firmware-factory/manifest.json"
        self.assertEqual(vr.check_classic_agrees("w", url, self.PAGE, flashed), [])

    def test_build_the_page_does_not_flash_errors(self):
        # AIR-1 before PR #33: the registry pointed at firmware/ (no improv) while
        # the classic installer flashed firmware-factory/.
        flashed = vr.manifests_on_page(self.HTML, self.PAGE)
        errs = vr.check_classic_agrees("w", self.PAGE + "firmware/manifest.json", self.PAGE, flashed)
        self.assertTrue(any("doesn't flash" in e for e in errs), errs)

    def test_unreachable_page_errors(self):
        errs = vr.check_classic_agrees("w", self.PAGE + "x.json", self.PAGE, None)
        self.assertTrue(any("unreachable" in e for e in errs), errs)

    def test_installer_override_wins(self):
        dev = device(installers={"stable": {"Standard": None}})
        self.assertIsNone(vr.classic_installer_for(dev, "stable", "Standard"))
        self.assertEqual(vr.classic_installer_for(device(), "stable", "Standard"),
                         device()["githubPagesInstaller"])


class MainOffline(InTempRepo):
    def run_main(self, devices):
        with open("devices.json", "w", encoding="utf-8") as f:
            json.dump({"devices": devices}, f)
        vr.errors.clear()
        with mock.patch.object(vr.urllib.request, "urlopen",
                               side_effect=AssertionError("offline run touched the network")), \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                vr.main(["--offline"])
            except SystemExit as e:
                return e.code
        return 0

    def test_good_registry_passes(self):
        self.assertEqual(self.run_main([device()]), 0)
        self.assertEqual(vr.errors, [])

    def test_null_channel_with_overrides_reports_instead_of_crashing(self):
        fw = dict(device()["firmware"], beta=None)
        cfg = {"beta": {"Standard": "https://raw.githubusercontent.com/o/r/main/a.yaml"}}
        self.assertEqual(self.run_main([device(firmware=fw, config=cfg)]), 1)
        self.assertTrue(any("beta" in e for e in vr.errors), vr.errors)

    def test_duplicate_and_bad_entries_fail(self):
        self.assertEqual(self.run_main([device(), device(), "junk"]), 1)
        self.assertIn("msr-1: duplicate id", vr.errors)
        self.assertTrue(any("devices[2]" in e for e in vr.errors), vr.errors)


if __name__ == "__main__":
    unittest.main()
