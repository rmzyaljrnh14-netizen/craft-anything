"""Read-only Final Autoclaim desk; never contacts a faucet, ad network or wallet.

A single worker reviews the local, dated fee/listing snapshot each cycle, and checks a
public daily price release hourly. No package installation, archive extraction, payment,
account access or visitor-triggered jobs. Public status only lives in this process.
"""

import argparse
import base64
from collections import deque
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import hmac
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import re
import signal
import tarfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPRedirectHandler, Request
import zlib

if __package__:
    from .directory_page import build as directory_page
    from .trial_bundle import build as trial_page
else:  # Direct script invocation from the README.
    from directory_page import build as directory_page
    from trial_bundle import build as trial_page

ROOT = Path(__file__).resolve().parent
META = "https://registry.npmjs.org/@fawazahmed0%2fcurrency-api/latest"
PACKAGE = "@fawazahmed0/currency-api"
COINS = ("BCH", "LTC", "DOGE")
MEMBERS = {f"package/v1/currencies/{coin.lower()}.min.json": coin for coin in COINS}
INTERVAL = 30
QUOTE_INTERVAL = 3600
FACT_MAX_DAYS, QUOTE_MAX_DAYS = 7, 2
SOURCE_ERRORS = (
    ValueError,
    LookupError,
    TypeError,
    InvalidOperation,
    OSError,
    HTTPException,
    tarfile.TarError,
    EOFError,
    zlib.error,
    RecursionError,
    OverflowError,
)


def check(ok, message):
    if not ok:
        raise ValueError(message)


def day_at(ts):
    return datetime.fromtimestamp(ts, timezone.utc).date()


def amount(value, *, positive=True):
    check(
        type(value) in (int, str, Decimal)
        and re.fullmatch(r"\d{1,9}(?:\.\d{1,12})?", str(value), re.ASCII),
        "invalid decimal",
    )
    n = Decimal(value)
    check(n > 0 if positive else n >= 0, "invalid sign")
    return n


def read_facts(path, today):
    check(path.is_file(), "no regular research file")
    with path.open("rb") as fp:
        raw = fp.read(4097)
    check(len(raw) <= 4096, "oversize snapshot")
    f = json.loads(raw)
    keys = {
        "schema",
        "profile_id",
        "reviewed_utc_day",
        "site",
        "listed_status",
        "profile_users_paid",
        "profile_week_paid_usd",
        "faucet_to_faucetpay_min_usd",
        "normal_external_limits",
    }
    check(
        isinstance(f, dict)
        and set(f) == keys
        and type(f["schema"]) is int
        and f["schema"] == 1
        and f["profile_id"] == 105011
        and f["site"] == "Final Autoclaim",
        "wrong research record",
    )
    check(
        f["listed_status"] in ("Active", "Inactive", "Unknown")
        and type(f["profile_users_paid"]) is int
        and 0 <= f["profile_users_paid"] <= 1_000_000_000,
        "unexpected listing",
    )
    d = date.fromisoformat(f["reviewed_utc_day"])
    check(d <= today, "future snapshot")
    amount(f["faucet_to_faucetpay_min_usd"])
    amount(f["profile_week_paid_usd"], positive=False)
    limits = f["normal_external_limits"]
    check(isinstance(limits, dict) and set(limits) == set(COINS), "wrong coins")
    for terms in limits.values():
        check(
            isinstance(terms, dict) and set(terms) == {"minimum", "fee"},
            "invalid limit record",
        )
        amount(terms["minimum"])
        amount(terms["fee"], positive=False)
    return {
        **f,
        "age_days": (today - d).days,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get(url, cap):
    # The only callers supply META and a separately constructed fixed-registry tarball URL.
    req = Request(
        url, headers={"User-Agent": "CraftAnything-dev", "Accept-Encoding": "identity"}
    )
    with build_opener(NoRedirect()).open(req, timeout=8) as reply:
        check(reply.status == 200, "unexpected HTTP response")
        data = reply.read(cap + 1)
    check(len(data) <= cap, "oversize data source")
    return data


def fetch_quote(prior, today, reader=get):
    m = json.loads(reader(META, 60_000))
    v = m["version"]
    check(
        m["name"] == PACKAGE
        and type(v) is str
        and re.fullmatch(r"[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}", v),
        "unexpected reference release",
    )
    released = date(*map(int, v.split(".")))
    check(released <= today, "future reference release")
    url = f"https://registry.npmjs.org/{PACKAGE}/-/currency-api-{v}.tgz"
    sri = m["dist"]["integrity"]
    check(
        m["dist"]["tarball"] == url
        and type(sri) is str
        and re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", sri),
        "unexpected reference archive",
    )
    if prior:
        check(released >= date.fromisoformat(prior["date"]), "older source release")
        if prior["version"] == v:
            check(
                hmac.compare_digest(sri, prior["integrity"]),
                "release fingerprint changed",
            )
            return prior, False
    data = reader(url, 4_000_000)
    actual = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    check(hmac.compare_digest(sri, actual), "reference archive integrity mismatch")
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(12_000_001)
    check(len(raw) <= 12_000_000, "expanded archive exceeds limit")
    rates = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        for i, item in enumerate(tar):
            check(i < 1500, "too many data members")
            coin = MEMBERS.get(item.name)
            if not coin:
                continue
            check(
                coin not in rates and item.isreg() and 0 < item.size <= 32_000,
                "unexpected quote member",
            )
            # Only named regular JSON files, in memory. No paths written, no package code executed.
            with tar.extractfile(item) as fp:
                doc = json.loads(fp.read(item.size), parse_float=Decimal)
            check(doc["date"] == released.isoformat(), "quote date mismatch")
            rates[coin] = str(amount(doc[coin.lower()]["usd"]))
    check(set(rates) == set(COINS), "missing quote")
    return {
        "date": released.isoformat(),
        "usd_per_coin": rates,
        "version": v,
        "integrity": sri,
    }, True


def estimate(facts, quote):
    """Compare exactly one hypothetical faucet-minimum credit, not an observed balance.

    Test minimum + fee, conservatively. Fee inclusion varies by provider. The locked terms
    in the real withdrawal dialog take precedence; no predicted claim count or payout.
    """
    low = amount(facts["faucet_to_faucetpay_min_usd"])
    rows = []
    for coin in COINS:
        p = amount(quote["usd_per_coin"][coin])
        terms = facts["normal_external_limits"][coin]
        minimum = amount(terms["minimum"])
        fee = amount(terms["fee"], positive=False)
        rows.append(
            {
                "coin": coin,
                "faucet_floor_in_coin": format(low / p, ".8f"),
                "normal_minimum": str(minimum),
                "normal_fee": str(fee),
                "external_min_equivalent_usd": format(minimum * p, ".6f"),
                "external_fee_equivalent_usd": format(fee * p, ".6f"),
                "external_test_usd": format((minimum + fee) * p, ".6f"),
                "covers_minimum_and_fee": low >= (minimum + fee) * p,
            }
        )
    return {
        "rows": rows,
        "covered": sum(r["covers_minimum_and_fee"] for r in rows),
        "floor_usd": str(low),
    }


def retry_delay(ex, failures, now):
    delay = min(3600, 300 * 2 ** min(4, failures - 1))
    if isinstance(ex, HTTPError):
        hint = (ex.headers or {}).get("Retry-After", "")
        if re.fullmatch(r"\d{1,9}", hint):
            return max(delay, int(hint))
        try:
            return max(delay, int(parsedate_to_datetime(hint).timestamp()) - now)
        except (ValueError, TypeError, OverflowError):
            pass
    return delay


class Desk:
    def __init__(self, path=ROOT / "facts.json", price=fetch_quote, clock=time.time):
        self.path, self.price, self.clock = path, price, clock
        self.lock = threading.Lock()
        self.started = int(clock())
        self.seq = 0
        self.history = deque(maxlen=32)
        self.quote = None
        self.failures = self.attempts = 0
        self.next_external = 0
        self.last_attempt = self.last_success = None
        self.basis = self.snapshot = self.result = None
        self.payload = {
            "ready": False,
            "started": self.started,
            "cycle": 0,
            "events": [],
        }

    def log(self, ts, kind, detail=None):
        if kind == "no_change" and self.history and self.history[0]["kind"] == kind:
            # Keep the meaningful external reads visible between them. Don't mutate a published event.
            last = self.history[0]
            self.history[0] = {**last, "at": ts, "count": last["count"] + 1}
        else:
            self.seq += 1
            self.history.appendleft(
                {"id": self.seq, "at": ts, "kind": kind, "count": 1, "detail": detail}
            )

    def tick(self):
        # Only the worker writes state. HTTP visitors read the last atomically published snapshot.
        ts = int(self.clock())
        today = day_at(ts)
        facts = None
        try:
            facts = read_facts(self.path, today)
        except SOURCE_ERRORS:
            pass
        snap = facts["sha256"] if facts else "unavailable"
        if snap != self.snapshot:
            self.log(ts, "snapshot_read" if facts else "snapshot_invalid")
            self.snapshot = snap
        due = ts >= self.next_external
        if due:
            self.last_attempt = ts
            self.attempts += 1
            try:
                self.quote, downloaded = self.price(self.quote, today)
                self.failures = 0
                self.last_success = int(self.clock())
                self.next_external = self.last_success + QUOTE_INTERVAL
                self.log(
                    self.last_success,
                    "quote_download" if downloaded else "quote_unchanged",
                )
            except SOURCE_ERRORS as ex:
                self.failures += 1
                now = int(self.clock())
                self.next_external = now + retry_delay(ex, self.failures, now)
                self.log(
                    now, "quote_error", ex.code if isinstance(ex, HTTPError) else None
                )
                if isinstance(ex, HTTPError):
                    ex.close()
        done = int(self.clock())
        today = day_at(done)
        if facts:
            facts["age_days"] = (
                today - date.fromisoformat(facts["reviewed_utc_day"])
            ).days
        quote_age = (
            (today - date.fromisoformat(self.quote["date"])).days
            if self.quote
            else None
        )
        if not facts:
            hold = "no_snapshot"
        elif facts["age_days"] > FACT_MAX_DAYS:
            hold = "stale_snapshot"
        elif facts["listed_status"] != "Active":
            hold = "inactive_listing"
        elif not self.quote:
            hold = "no_quote"
        elif not 0 <= quote_age <= QUOTE_MAX_DAYS:
            hold = "stale_quote"
        else:
            hold = None
        basis = (snap, self.quote["integrity"] if self.quote else None, hold)
        if basis != self.basis:
            self.basis = basis
            self.result = None if hold else estimate(facts, self.quote)
            self.log(
                done,
                "hold" if hold else "compared",
                hold if hold else self.result["covered"],
            )
        elif not due:
            self.log(done, "no_change")
        with self.lock:
            self.payload = {
                "ready": True,
                "started": self.started,
                "cycle": self.payload["cycle"] + 1,
                "checked_at": done,
                "next_cycle": done + INTERVAL,
                "next_source_check": self.next_external,
                "source_attempts": self.attempts,
                "last_source_attempt": self.last_attempt,
                "last_source_success": self.last_success,
                "source_error": bool(self.failures),
                "facts": facts,
                "quote": None
                if not self.quote
                else {k: self.quote[k] for k in ("date", "usd_per_coin", "version")},
                "estimate": self.result,
                "hold": hold,
                "events": list(self.history),
                "account_connected": False,
                "verified_personal_receipts": None,
            }

    def public(self):
        with self.lock:
            return {**self.payload, "server_time": int(self.clock())}

    def run(self, stop):
        while not stop.is_set():
            self.tick()
            stop.wait(INTERVAL)


def server(port, desk):
    notebook, notebook_policy = trial_page()
    directory, directory_policy = directory_page()
    notebook_paths = {"/trial", "/trial/", "/trial/offline.html"}
    live_policy = "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'"
    files = {
        "/": ("text/html; charset=utf-8", "index.html"),
        "/screen.css": ("text/css; charset=utf-8", "screen.css"),
        "/screen.js": ("text/javascript; charset=utf-8", "screen.js"),
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def serve(self, body):
            path = self.path.partition("?")[0]
            policy = live_policy
            if path in notebook_paths:
                mime, data, policy = (
                    "text/html; charset=utf-8",
                    notebook,
                    notebook_policy,
                )
            elif path in ("/faucets", "/faucets/"):
                mime, data, policy = (
                    "text/html; charset=utf-8",
                    directory,
                    directory_policy,
                )
            elif path == "/api/status":
                mime = "application/json; charset=utf-8"
                data = json.dumps(desk.public(), separators=(",", ":")).encode()
            elif path in files:
                mime, name = files[path]
                data = (ROOT / name).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", policy)
            if path == "/trial/offline.html":
                self.send_header(
                    "Content-Disposition",
                    'attachment; filename="final-autoclaim-trial.html"',
                )
            self.end_headers()
            if body:
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

    class Server(ThreadingHTTPServer):
        def get_request(self):
            conn, addr = super().get_request()
            conn.settimeout(5)
            return conn, addr

    return Server(("0.0.0.0", port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    stop = threading.Event()
    desk = Desk()
    http = server(args.port, desk)
    http.timeout = 0.5
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    worker = threading.Thread(target=desk.run, args=(stop,), daemon=True)
    worker.start()
    print(
        f"Final Autoclaim read-only desk listening on {http.server_port}. No faucet account or payment access.",
        flush=True,
    )
    try:
        while not stop.is_set():
            http.handle_request()
    finally:
        stop.set()
        http.server_close()
        worker.join(2)


if __name__ == "__main__":
    main()
