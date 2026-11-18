"""Frozen public index coverage, separation of listed vs reviewed, and no credential intake."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import directory_page as d


class Index(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.cards = {}
        self.card = None
        self.links = []
        self.inputs = []
        self.resources = []
        self.tags = []
        self.policy = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append(tag)
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "li" and a.get("class") == "entry":
            self.card = int(a["data-id"])
            self.cards[self.card] = []
        if tag == "a":
            self.links.append(a)
            if self.card:
                self.cards[self.card].append(a.get("href"))
        elif "href" in a or "src" in a:
            self.resources.append(a)
        if tag == "input":
            self.inputs.append(a)
        if tag == "meta" and a.get("http-equiv") == "Content-Security-Policy":
            self.policy = a["content"]

    def handle_endtag(self, tag):
        if tag == "li":
            self.card = None


class DirectoryTests(unittest.TestCase):
    def test_unique_coverage_and_separate_verified_properties(self):
        items, reviews, meta = d.load()
        self.assertEqual(len(items), 52)
        self.assertEqual(len(reviews), 8)
        self.assertEqual(Counter(r["page"] for r in items.values()), {1: 50, 2: 2})
        self.assertEqual(len(meta["directory_coins"]), 23)
        self.assertEqual(
            {pid for pid, r in reviews.items() if r["mode"] == "native"}, {529, 105011}
        )
        self.assertEqual(
            {pid for pid, r in reviews.items() if r["sign_in"] == "google"},
            {529, 105011, 12202},
        )
        federated = [r for r in reviews.values() if r["sign_in"] == "faucetpay"]
        self.assertEqual(len(federated), 4)
        self.assertTrue(all(r["mode"] == "manual" for r in federated))
        self.assertEqual(
            Counter(r["caution"] for r in federated),
            {"paused": 2, "empty": 1, "none": 1},
        )

    def test_index_contains_links_not_claim_endpoints_and_keeps_unknowns_unknown(self):
        raw, policy = d.build()
        page = Index()
        page.feed(raw.decode())
        entries, reviews, _ = d.load()
        self.assertEqual(set(page.cards), set(entries))
        self.assertEqual(len(page.ids), len(set(page.ids)))
        for pid, urls in page.cards.items():
            expected = (
                [link[1] for link in reviews[pid]["links"]] if pid in reviews else []
            )
            self.assertEqual(urls, [*expected, d.PROFILE + str(pid)])
        for a in page.links:
            url = a["href"]
            if url.startswith("#"):
                self.assertIn(url[1:], page.ids)
            elif url.startswith("https://"):
                self.assertEqual(a.get("target"), "_blank")
                self.assertEqual(
                    set(a.get("rel", "").split()), {"noopener", "noreferrer"}
                )
            else:
                self.assertIn(url, ("/", "/trial/"))
        self.assertEqual(page.policy, policy)
        self.assertIn("connect-src 'none'", policy)
        self.assertIn("form-action 'none'", policy)
        self.assertFalse(page.resources)
        self.assertFalse({"form", "object", "iframe", "embed", "base"} & set(page.tags))
        self.assertEqual([a["type"] for a in page.inputs], ["search"])
        self.assertNotIn("name", page.inputs[0])
        self.assertNotIn("unsafe-inline", policy)
        for filename in ("style.css", "ui.js"):
            code = (d.SRC / filename).read_text(encoding="utf-8")
            self.assertIn(d.digest(code), policy)
        self.assertEqual(raw, d.build()[0])

    def test_no_cross_host_links_or_duplicate_listings_on_refresh(self):
        for url in (
            "https://example.invalid/",
            "http://firefaucet.win/register/",
            "https://firefaucet.win@other.invalid/",
            "https://firefaucet.win/register/?r=ref",
            "https://firefaucet.win//another.host",
            "https://firefaucet.win:443/",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                d.public_source(url, "firefaucet.win", 529)
        with self.assertRaises(ValueError):
            d.public_source(d.OFFSITE_GUIDE, "other.invalid", 529)
        with TemporaryDirectory() as temp:
            root = Path(temp)
            table = (d.SRC / "listings.tsv").read_text(encoding="utf-8")
            (root / "listings.tsv").write_text(
                table + table.splitlines()[1] + "\n", encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                d.load(root)


if __name__ == "__main__":
    unittest.main()
