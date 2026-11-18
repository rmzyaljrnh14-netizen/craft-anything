"""One self-contained first-receipt notebook. The live and downloadable tools are identical."""

import base64
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT.parent / "showcase" / "final-autoclaim-trial.html"


def build():
    src = ROOT / "trial"
    css, model, ui = [
        (src / name).read_text(encoding="utf-8")
        for name in ("style.css", "model.js", "ui.js")
    ]

    def digest(text):
        return (
            "'sha256-"
            + base64.b64encode(sha256(text.encode()).digest()).decode("ascii")
            + "'"
        )

    policy = (
        "default-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; "
        f"style-src {digest(css)}; script-src {digest(model)} {digest(ui)}"
    )
    page = (src / "index.html").read_text(encoding="utf-8")
    for marker, text in [
        ("POLICY", f'<meta http-equiv="Content-Security-Policy" content="{policy}">'),
        ("STYLE", f"<style>{css}</style>"),
        ("MODEL", f"<script>{model}</script>"),
        ("UI", f"<script>{ui}</script>"),
    ]:
        tag = f"<!--{marker}-->"
        if page.count(tag) != 1:
            raise ValueError(f"missing or duplicate {marker} marker")
        page = page.replace(tag, text)
    return page.encode("utf-8"), policy


if __name__ == "__main__":
    data, _ = build()
    OUTPUT.write_bytes(data)
    print(f"{OUTPUT.name}: {len(data)} bytes, SHA-256 {sha256(data).hexdigest()}")
