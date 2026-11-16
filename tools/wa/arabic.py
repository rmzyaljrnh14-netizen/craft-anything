"""Arabic text preparation and rendering helpers.

Arabic is reshaped with arabic-reshaper and reordered with python-bidi before
Pillow draws it. This module does not claim to render glyphs with HarfBuzz.
"""

from __future__ import annotations

import functools
from pathlib import Path

from bidi.algorithm import get_display
from PIL import ImageFont

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"

ARABIC_FONT = FONT_DIR / "NotoNaskhArabic.ttf"
LATIN_FONT = FONT_DIR / "DMSans-Bold.ttf"
LATIN_REGULAR = FONT_DIR / "DMSans-Regular.ttf"

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


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
    """Join Arabic letters into presentation forms using arabic-reshaper."""
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
