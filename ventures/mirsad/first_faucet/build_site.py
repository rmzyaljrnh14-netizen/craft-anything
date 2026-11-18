"""Produce only the public Vercel assets. Never copy a working tree or a personal notebook record."""

import hashlib
import json
import os
from pathlib import Path
import re
from directory_page import build as directory
from trial_bundle import build as notebook

ROOT = Path(__file__).resolve().parent


def build(out):
    book, _ = notebook()
    catalog, _ = directory()
    revision = os.getenv("VERCEL_GIT_COMMIT_SHA", "")
    release = {
        "schema": 1,
        "source_revision": revision
        if re.fullmatch(r"[0-9a-f]{40}", revision)
        else None,
        "notebook_sha256": hashlib.sha256(book).hexdigest(),
        "directory_sha256": hashlib.sha256(catalog).hexdigest(),
    }
    assets = {
        "release.json": (json.dumps(release, sort_keys=True) + "\n").encode(),
        "index.html": (ROOT / "hosted/index.html").read_bytes(),
        "status.js": (ROOT / "hosted/status.js").read_bytes(),
        "screen.css": (ROOT / "screen.css").read_bytes(),
        "faucets/index.html": catalog,
        "trial/index.html": book,
        "trial/offline.html": book,
    }
    # Fail closed if a non-build file was placed in the served output directory.
    if out.is_symlink() or (
        out.exists()
        and any(
            p.is_symlink()
            or (p.is_file() and p.relative_to(out).as_posix() not in assets)
            for p in out.rglob("*")
        )
    ):
        raise ValueError("Output contains other files; use a clean build directory")
    for name, data in assets.items():
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return tuple(assets)


if __name__ == "__main__":
    print("Static public outputs:", ", ".join(build(ROOT / "dist")))
