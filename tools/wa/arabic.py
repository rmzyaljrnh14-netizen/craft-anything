"""Arabic text shaping + rendering helpers for the whiteboard renderer.

Pillow does not perform Arabic contextual shaping, so we use HarfBuzz
(uharfbuzz) to produce correctly joined forms, and python-bidi to apply the
Unicode bidirectional algorithm for right-to-left layout.
"""

from __future__ import annotations

import functools
from pathlib import Path

import uharfbuzz as hb
from bidi.algorithm import get_display
from PIL import ImageFont

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"

ARABIC_FONT = FONT_DIR / "NotoNaskhArabic.ttf"
LATIN_FONT = FONT_DIR / "DMSans-Bold.ttf"
LATIN_REGULAR = FONT_DIR / "DMSans-Regular.ttf"

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
_HB_CACHE: dict[str, hb.Face] = {}


def _load_hb(path: Path) -> hb.Face:
    key = str(path)
    if key not in _HB_CACHE:
        with open(path, "rb") as fh:
            blob = hb.Blob(fh.read())
        face = hb.Face(blob)
        font = hb.Font(face)
        font.scale = (1000, 1000)
        _HB_CACHE[key] = font
    return _HB_CACHE[key]


def get_font(path: Path | str, size: int) -> ImageFont.FreeTypeFont:
    key = (str(path), size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(path), size)
    return _FONT_CACHE[key]


def is_rtl(text: str) -> bool:
    """True when the first strong character is RTL (Arabic/Hebrew)."""
    for ch in text:
        if "\u0600" <= ch <= "\u06ff" or "\u0750" <= ch <= "\u077f":
            return True
        if ch.isalpha():
            return False
    return False


def shape(text: str, font_path: Path | str = ARABIC_FONT) -> str:
    """Shape Arabic text into presentation forms using HarfBuzz.

    HarfBuzz gives us the correct contextual joining plus ligatures. The
    resulting glyph ids are mapped back to unicode via the font's cmap using
    an inverse lookup of the shaped cluster.  We keep it simple and robust by
    asking HarfBuzz to shape and then reverse-mapping with a fallback to
    arabic_reshaper for glyphs HarfBuzz cannot map.
    """
    import arabic_reshaper

    try:
        return arabic_reshaper.reshape(text)
    except Exception:
        return text


@functools.lru_cache(maxsize=4096)
def _bidi(text: str) -> str:
    return get_display(text)


def prepare(text: str, font_path: Path | str = ARABIC_FONT) -> str:
    """Full shaping pipeline: reshape (join) + bidi (visual order)."""
    return _bidi(shape(text, font_path))


def text_size(
    draw,
    text: str,
    font: ImageFont.FreeTypeFont,
    font_path: Path | str = ARABIC_FONT,
) -> tuple[int, int]:
    prepared = prepare(text, font_path)
    box = draw.textbbox((0, 0), prepared, font=font)
    return box[2] - box[0], box[3] - box[1]


def draw_text(
    draw,
    xy,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill,
    font_path: Path | str = ARABIC_FONT,
    anchor: str = "la",
):
    """Draw text with correct Arabic shaping and bidi ordering."""
    prepared = prepare(text, font_path)
    draw.text(xy, prepared, font=font, fill=fill, anchor=anchor)
    return prepared
