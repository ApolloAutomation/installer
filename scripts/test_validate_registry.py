"""Offline unit tests for validate_registry.py (stdlib unittest, no deps).

Run: python scripts/test_validate_registry.py
Covers the manifest-shape checks and head_ok's exception handling without
touching the network.
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_registry as vr  # noqa: E402


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


class ConfigShape(unittest.TestCase):
    def test_good_config_has_no_errors(self):
        cfg = {"stable": {"WiFi": "https://raw.githubusercontent.com/o/r/main/a.yaml"}}
        self.assertEqual(vr.check_config_shape(cfg, "r-pro-1"), [])

    def test_non_string_url_errors(self):
        cfg = {"stable": {"WiFi": 123}}
        errs = vr.check_config_shape(cfg, "r-pro-1")
        self.assertTrue(any("WiFi" in e for e in errs), errs)

    def test_non_https_url_errors(self):
        cfg = {"stable": {"Standard": "http://insecure/a.yaml"}}
        errs = vr.check_config_shape(cfg, "x")
        self.assertTrue(any("https" in e for e in errs), errs)

    def test_channel_not_object_errors(self):
        cfg = {"stable": "oops"}
        errs = vr.check_config_shape(cfg, "x")
        self.assertTrue(any("stable" in e for e in errs), errs)

    def test_non_dict_config_errors_without_crashing(self):
        for bad in (None, "oops", []):
            errs = vr.check_config_shape(bad, "x")
            self.assertTrue(any("config" in e for e in errs), (bad, errs))


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


if __name__ == "__main__":
    unittest.main()
