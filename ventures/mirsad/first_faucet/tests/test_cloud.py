"""No network: exercise the actual function cache, projection and provider entry point."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from api import status
from build_site import build
from trial_bundle import build as notebook
from watch import Desk, ROOT


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.now = 1795043583  # fixture on 2026-11-18 UTC
        self.calls = 0
        self.fail = False
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "facts.json"
        f = json.loads((ROOT / "facts.json").read_bytes())
        f["reviewed_utc_day"] = "2026-11-18"
        self.path.write_text(json.dumps(f), encoding="utf-8")

        def price(prev, day):
            self.calls += 1
            if self.fail:
                raise TimeoutError()
            return {
                "version": "2026.11.18",
                "integrity": "test",
                "date": "2026-11-18",
                "usd_per_coin": {"BCH": "200", "LTC": "50", "DOGE": "0.05"},
            }, prev is None

        def clock():
            return self.now

        self.check = status.Check(Desk(self.path, price, clock), clock)

    def test_no_durable_worker_claims_or_personal_records(self):
        a, ttl = self.check.read()
        self.assertEqual(a["mode"], "on-demand")
        self.assertIsNone(a["verified_personal_receipts"])
        self.assertFalse(a["account_connected"])
        self.assertNotIn("next_cycle", a)
        self.assertNotIn("events", a)
        self.assertEqual(len(a["estimate"]["rows"]), 3)
        self.assertLessEqual(ttl, 3600)
        self.now += 200
        b, ttl2 = self.check.read()
        self.assertEqual(a, b)
        self.assertEqual(ttl2, ttl - 200)
        self.assertEqual(self.calls, 1)
        self.now += 4 * 86400
        c, _ = self.check.read()
        self.assertEqual(c["hold"], "stale_quote")
        self.assertIsNone(c["estimate"])

    def test_failed_read_is_honest_and_throttled(self):
        self.fail = True
        a, ttl = self.check.read()
        self.assertIsNone(a["last_source_success"])
        self.assertTrue(a["source_error"])
        self.assertIsNone(a["estimate"])
        self.assertEqual(ttl, 300)
        self.now += 10
        self.fail = False
        self.assertTrue(self.check.read()[0]["source_error"])
        self.assertEqual(self.calls, 1)
        self.now += 290
        self.assertFalse(self.check.read()[0]["source_error"])
        self.assertEqual(self.calls, 2)

    def test_actual_wsgi_get_head_and_no_input_endpoints(self):
        with patch.object(status, "CACHE", self.check):
            for method, q, want in [
                ("POST", "", "405"),
                ("GET", "id=1", "400"),
                ("GET", "", "200"),
                ("HEAD", "", "200"),
            ]:
                h = []
                body = b"".join(
                    status.app(
                        {"REQUEST_METHOD": method, "QUERY_STRING": q},
                        lambda s, v: h.extend([s, dict(v)]),
                    )
                )
                self.assertTrue(h[0].startswith(want))
                self.assertNotIn("Set-Cookie", h[1])
                if want == "200":
                    self.assertIn("s-maxage=", h[1]["Vercel-CDN-Cache-Control"])
                if method == "GET" and not q:
                    self.assertEqual(json.loads(body)["mode"], "on-demand")
                else:
                    self.assertFalse(body)
            self.assertEqual(self.calls, 1)

    def test_deployment_outputs_only_public_assets_and_portable_notebook(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(
                set(build(out)),
                {
                    "release.json",
                    "index.html",
                    "status.js",
                    "screen.css",
                    "trial/index.html",
                    "trial/offline.html",
                },
            )
            import hashlib

            info = json.loads((out / "release.json").read_bytes())
            self.assertEqual(
                info["notebook_sha256"], hashlib.sha256(notebook()[0]).hexdigest()
            )
            self.assertEqual(
                set(info), {"schema", "source_revision", "notebook_sha256"}
            )
            for name in ("trial/index.html", "trial/offline.html"):
                self.assertEqual((out / name).read_bytes(), notebook()[0])
            (out / "unexpected").touch()
            with self.assertRaises(ValueError):
                build(out)


if __name__ == "__main__":
    unittest.main()
