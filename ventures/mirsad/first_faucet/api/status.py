"""On-demand WSGI Vercel Function. Never launches the standalone worker or takes owner input."""

import json
import threading
import time

from watch import Desk, QUOTE_INTERVAL


class Check:
    def __init__(self, desk=None, clock=time.time):
        self.desk = desk if desk is not None else Desk(clock=clock)
        self.lock = threading.Lock()
        self.clock = clock
        self.until = 0
        self.last = None

    def read(self):
        with self.lock:
            now = int(self.clock())
            if self.last is None or now >= self.until:
                self.desk.tick()  # One bounded read. No timer/loop after the request.
                s = self.desk.public()
                now = s["checked_at"]
                self.until = min(
                    s["next_source_check"],
                    now + QUOTE_INTERVAL,
                    (now // 86400 + 1) * 86400,
                )
                self.last = {
                    "schema": 1,
                    "mode": "on-demand",
                    "checked_at": now,
                    "last_source_success": s["last_source_success"],
                    "source_error": s["source_error"],
                    "quote_day": s["quote"]["date"] if s["quote"] else None,
                    "reviewed_day": s["facts"]["reviewed_utc_day"]
                    if s["facts"]
                    else None,
                    "hold": s["hold"],
                    "estimate": s["estimate"],
                    "account_connected": False,
                    "verified_personal_receipts": None,
                }
            return self.last, max(1, self.until - now)


CACHE = Check()


def app(environ, start_response):
    method = environ.get("REQUEST_METHOD")
    if method not in ("GET", "HEAD"):
        start_response(
            "405 Method Not Allowed",
            [("Allow", "GET, HEAD"), ("Cache-Control", "no-store")],
        )
        return [b""]
    if environ.get("QUERY_STRING"):
        start_response("400 Bad Request", [("Cache-Control", "no-store")])
        return [b""]
    data, seconds = CACHE.read()
    body = json.dumps(data, separators=(",", ":"), allow_nan=False).encode()
    start_response(
        "200 OK",
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "public, max-age=0, must-revalidate"),
            ("Vercel-CDN-Cache-Control", f"public, s-maxage={seconds}"),
            ("X-Content-Type-Options", "nosniff"),
        ],
    )
    return [body if method == "GET" else b""]
