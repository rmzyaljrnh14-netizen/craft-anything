"""Build a dated, offline-browsable index. Directory listings alone never become operator links."""

import base64
import csv
from datetime import date
import hashlib
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

SRC = Path(__file__).resolve().parent / "directory"
PROFILE = "https://faucetpay.io/faucet/profile/"
OFFSITE_GUIDE = (
    "https://final-autoclaim.gitbook.io/docs/academy/how-to-launch-the-autoclaim"
)
LOGIN = {
    "google": "يعرض خيار Google",
    "faucetpay": "يعرض دخول FaucetPay",
    "operator": "تسجيل لدى المشغّل",
}
MODE = {"native": "ميزة تلقائية من المشغّل", "manual": "مشاركة شخصية"}
CAUTION = {
    "paused": "المطالبات متوقفة في اللقطة",
    "empty": "احتياطي BTC صفري في اللقطة",
}


def check(ok, why):
    if not ok:
        raise ValueError(why)


def public_source(url, domain, pid):
    p = urlsplit(url)
    check(
        p.scheme == "https"
        and p.netloc == p.hostname
        and not p.query
        and not p.fragment
        and not p.path.startswith("//"),
        "unexpected source URL",
    )
    check(
        p.hostname.removeprefix("www.") == domain.removeprefix("www.")
        or (pid == 105011 and url == OFFSITE_GUIDE),
        "source domain mismatch",
    )
    return url


def load(root=SRC):
    entries = {}
    with (root / "listings.tsv").open(encoding="utf-8", newline="") as fp:
        rows = csv.DictReader(fp, delimiter="\t")
        check(
            rows.fieldnames == ["page", "profile_id", "name", "displayed_domain"],
            "wrong listing columns",
        )
        for row in rows:
            pid = int(row["profile_id"])
            domain = row["displayed_domain"]
            name = row["name"]
            page = int(row["page"])
            check(
                0 < pid <= 99999999
                and pid not in entries
                and page in (1, 2)
                and None not in row,
                "invalid directory row",
            )
            check(
                0 < len(name) <= 64 and all(c.isprintable() for c in name),
                "invalid listing name",
            )
            check(
                len(domain) <= 253
                and re.fullmatch(r"(?:[a-z0-9-]+\.)+[a-z]{2,}", domain),
                "invalid displayed domain",
            )
            entries[pid] = {"id": pid, "page": page, "domain": domain, "name": name}
    meta = json.loads((root / "review.json").read_text(encoding="utf-8"))
    check(
        set(meta) == {"schema", "reviewed_day", "directory_coins", "reviews"}
        and meta["schema"] == 1,
        "schema mismatch",
    )
    date.fromisoformat(meta["reviewed_day"])
    coins = meta["directory_coins"]
    check(
        "BTC" in coins
        and len(coins) == len(set(coins))
        and all(re.fullmatch(r"[A-Z]{2,8}", c) for c in coins),
        "invalid directory coin selector",
    )
    reviewed = {}
    for review in meta["reviews"]:
        check(
            set(review) == {"id", "sign_in", "mode", "caution", "note", "links"},
            "invalid review fields",
        )
        pid = review["id"]
        check(
            pid in entries and pid not in reviewed,
            "review does not identify one listing",
        )
        check(
            review["sign_in"] in LOGIN
            and review["mode"] in MODE
            and review["caution"] in {"none", *CAUTION},
            "unknown review state",
        )
        check(
            0 < len(review["note"]) <= 650 and 1 <= len(review["links"]) <= 4,
            "invalid review text",
        )
        for label, url in review["links"]:
            check(
                isinstance(label, str) and 0 < len(label) <= 70, "invalid source label"
            )
            public_source(url, entries[pid]["domain"], pid)
        reviewed[pid] = review
    return entries, reviewed, meta


def anchor(label, url):
    return f'<a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(label)} ↗</a>'


def card(row, review):
    pid = row["id"]
    name = escape(row["name"])
    profile = anchor("الملف في FaucetPay", PROFILE + str(pid))
    if review:
        signin, mode, caution = (review[k] for k in ("sign_in", "mode", "caution"))
        labels = [
            f'<span class="tag">{text}</span>' for text in (LOGIN[signin], MODE[mode])
        ]
        if caution in CAUTION:
            labels.append(f'<span class="tag hold">{CAUTION[caution]}</span>')
        note = f"<p>{escape(review['note'])}</p>"
        refs = (
            " ".join(anchor(label, url) for label, url in review["links"])
            + " "
            + profile
        )
    else:
        signin = mode = "unknown"
        caution = "none"
        labels = [
            '<span class="tag">قيد في الدليل فقط · طريقة الدخول غير مفحوصة</span>'
        ]
        note = ""
        refs = profile
    return f'''<li class="entry" id="site-{pid}" data-id="{pid}" data-reviewed="{int(review is not None)}" data-signin="{signin}" data-mode="{mode}" data-hold="{int(caution in CAUTION)}">
<div class="rowhead"><h3><bdi class="name">{name}</bdi></h3><button hidden type="button" class="save" aria-pressed="false" aria-label="حفظ {name} في قائمتي">حفظ في قائمتي</button></div>
<small class="domain" dir="ltr">{escape(row["domain"])}</small><div class="tags">{"".join(labels)}</div>{note}<div class="links">{refs}</div></li>'''


def digest(value):
    return (
        "'sha256-"
        + base64.b64encode(hashlib.sha256(value.encode()).digest()).decode("ascii")
        + "'"
    )


def build():
    entries, reviews, meta = load()
    css = (SRC / "style.css").read_text(encoding="utf-8")
    js = (SRC / "ui.js").read_text(encoding="utf-8")
    html = (SRC / "template.html").read_text(encoding="utf-8")
    policy = f"default-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; style-src {digest(css)}; script-src {digest(js)}"
    # Reviewed entries first, then names alphabetically, never sorted by a claimed yield.
    order = [
        *reviews,
        *sorted(
            entries.keys() - reviews.keys(), key=lambda k: entries[k]["name"].casefold()
        ),
    ]
    parts = {
        "POLICY": f'<meta http-equiv="Content-Security-Policy" content="{policy}">',
        "STYLE": f"<style>{css}</style>",
        "SCRIPT": f"<script>{js}</script>",
        "DATE": meta["reviewed_day"],
        "COUNT": str(len(entries)),
        "REVIEWCOUNT": str(len(reviews)),
        "FIRSTCOUNT": str(sum(r["page"] == 1 for r in entries.values())),
        "COINS": "".join(f"<option>{c}</option>" for c in meta["directory_coins"]),
        "CARDS": "\n".join(card(entries[k], reviews.get(k)) for k in order),
    }
    for key, value in parts.items():
        marker = "<!--" + key + "-->"
        check(html.count(marker) == 1, "missing template marker " + key)
        html = html.replace(marker, value)
    return html.encode("utf-8"), policy
