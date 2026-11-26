"""Arabic text shaping and vector-aware drawing primitives for NAQSH STUDIO.

Pillow in this environment has no Raqm/HarfBuzz support, so Arabic words would
render with disconnected letters and wrong letter order. This module shapes text
with HarfBuzz and rasterises glyphs with FreeType, returning both an image layer
and per-glyph outline metadata. The outline metadata makes it possible to animate
a real "hand drawing" reveal: every glyph is drawn along the ink path a pen would
follow, not faded in with opacity.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import freetype
import numpy as np
import uharfbuzz as hb
from PIL import Image

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"
AR_BOLD = FONT_DIR / "NotoNaskhArabic-Bold.ttf"
AR_REG = FONT_DIR / "NotoNaskhArabic-Regular.ttf"
LAT_BOLD = FONT_DIR / "DMSans-Bold.ttf"


class Font:
    """A HarfBuzz + FreeType pair for one typeface at one pixel size."""

    def __init__(self, path: Path | str, size: int):
        self.path = str(path)
        self.size = size
        self._data = Path(path).read_bytes()
        self.hb_font = hb.Font(hb.Face(self._data))
        # Scale HarfBuzz to pixels*64 so advances come back in the same units as
        # FreeType bitmap metrics (we divide by 64 everywhere).
        self.hb_font.scale = (size * 64, size * 64)
        # HarfBuzz wants font units; FreeType handles pixel scaling.
        self.ft = freetype.Face(self.path)
        self.ft.set_char_size(size * 64)
        self.ascender = self.ft.size.ascender / 64
        self.descender = self.ft.size.descender / 64
        self._mask_cache: dict[int, np.ndarray] = {}

    @property
    def line_height(self) -> float:
        return (self.ft.size.height / 64) if self.ft.size.height else self.size * 1.5

    def mask(self, gid: int) -> np.ndarray:
        """Grayscale coverage bitmap for a glyph id (rows of uint8)."""
        cached = self._mask_cache.get(gid)
        if cached is not None:
            return cached
        self.ft.load_glyph(gid, freetype.FT_LOAD_RENDER)
        bmp = self.ft.glyph.bitmap
        if bmp.width == 0 or bmp.rows == 0:
            arr = np.zeros((0, 0), dtype=np.uint8)
        else:
            arr = np.frombuffer(bytes(bmp.buffer), dtype=np.uint8)
            if bmp.pitch != bmp.width:
                arr = arr.reshape(bmp.rows, bmp.pitch)[:, : bmp.width]
            else:
                arr = arr.reshape(bmp.rows, bmp.width)
            arr = arr.copy()
        self._mask_cache[gid] = arr
        return arr


@dataclass
class Glyph:
    gid: int
    x: float          # pen x (relative to text origin, baseline at y=0)
    y: float
    w: float
    h: float
    ox: float         # bitmap left relative to pen
    oy: float         # bitmap top relative to baseline
    advance: float
    font: "Font | None" = None


def _is_ltr_only(text: str) -> bool:
    """True for pure number/percent/symbol strings that must not be mirrored."""
    has_digit = False
    for ch in text:
        if "\u0600" <= ch <= "\u06ff" and not ("\u0660" <= ch <= "\u0669"):
            return False
        if ch.isalnum():
            has_digit = True
    return has_digit


def _is_rtl(text: str) -> bool:
    for ch in text:
        if "\u0600" <= ch <= "\u06ff" or "\u0750" <= ch <= "\u08ff":
            return True
        if ch.isalpha():
            return False
    return False


def _shape_run(font: Font, raw: str, pen: float, letter_spacing: float, direction=None,
               fallback: "Font | None" = None) -> list[Glyph]:
    buf = hb.Buffer()
    buf.add_str(raw if raw else " ")
    buf.guess_segment_properties()
    if direction:
        buf.direction = direction
    hb.shape(font.hb_font, buf)
    is_rtl_run = (direction or "") == "rtl"
    # HarfBuzz emits visual order: leftmost first for LTR, rightmost first for RTL.
    out: list[Glyph] = []
    pending: list[Glyph] = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen += pos.x_offset / 64.0
        if info.codepoint == 0 and fallback is not None and info.cluster < len(raw):
            # Missing glyph in the primary face (dashes, quotes, symbols):
            # shape just this character with the Latin fallback face.
            fb = _shape_run(fallback, raw[info.cluster], 0.0, letter_spacing,
                            direction="ltr", fallback=None)
            for g in fb:
                g.x += pen
            pending.extend(fb)
            pen += sum(g.advance for g in fb) or pos.x_advance / 64.0
            continue
        font.ft.load_glyph(info.codepoint, freetype.FT_LOAD_RENDER)
        bmp = font.ft.glyph.bitmap
        pending.append(
            Glyph(
                gid=info.codepoint,
                x=pen,
                y=-pos.y_offset / 64.0,
                w=float(bmp.width),
                h=float(bmp.rows),
                ox=float(font.ft.glyph.bitmap_left),
                oy=float(font.ft.glyph.bitmap_top),
                advance=(pos.x_advance / 64.0) + letter_spacing,
                font=font,
            )
        )
        pen += pos.x_advance / 64.0 + letter_spacing
    return pending


_ARABIC_LETTERS = set("ابتثجحخدذرزسشصضطظعغفقكلمنهويىءأإآؤئ")


def _classify(ch: str) -> str:
    """Bidi-lite classification: 'r' Arabic letters, 'n' Arabic digits, 'l' Latin/digit, 's' neutral."""
    if "\u0660" <= ch <= "\u0669" or "\u06f0" <= ch <= "\u06f9":
        return "n"
    if "\u0600" <= ch <= "\u06ff" and ch not in "،؛؟٪":
        return "r"
    if "\u0660" <= ch <= "\u0669" or "\u06f0" <= ch <= "\u06f9":
        return "n"
    if ch.isalnum():
        return "l"
    return "s"


def _runs(line: str):
    """Split a line into visual runs: (text, direction, is_rtl)."""
    if not line:
        return [(" ", "ltr", False)]
    classes = [_classify(c) for c in line]
    # Group: Arabic-number and neutral chars stick to their neighbours.
    groups = []
    for ch, cls in zip(line, classes):
        kind = "rtl" if cls == "r" else ("neut" if cls == "s" else "ltr")
        if groups and groups[-1][0] == kind:
            groups[-1][1].append(ch)
        else:
            groups.append([kind, [ch]])
    # Merge neutrals: inside/between RTL -> rtl, otherwise ltr.
    merged = []
    for i, (kind, chars) in enumerate(groups):
        if kind == "neut":
            prev_kind = merged[-1][0] if merged else None
            nxt = next((g[0] for g in groups[i + 1:] if g[0] != "neut"), None)
            kind = "rtl" if prev_kind == "rtl" or nxt == "rtl" else "ltr"
        if merged and merged[-1][0] == kind:
            merged[-1][1].extend(chars)
        else:
            merged.append([kind, list(chars)])
    return [("".join(chars), kind, kind == "rtl") for kind, chars in merged]


def layout(
    font: Font,
    text: str,
    letter_spacing: float = 0.0,
    fallback: "Font | None" = None,
    direction=None,
) -> tuple[list[list[Glyph]], float]:
    """Shape ``text`` into visual-order glyph runs grouped by line.

    Runs are placed with a bidi-lite rule: Arabic letter runs are shaped RTL,
    number/latin runs LTR, and runs are ordered right-to-left when the line has
    Arabic letters. This keeps Arabic-Indic numerals and percentages readable.
    """
    lines: list[list[Glyph]] = []
    max_w = 0.0
    for raw in text.split("\n"):
        runs = _runs(raw)
        base_rtl = any(is_rtl for _, _, is_rtl in runs)
        placed = []           # (x_offset, glyphs)
        widths = []
        for sub, kind, is_rtl in runs:
            glyphs = _shape_run(font, sub, 0.0, letter_spacing, direction=kind, fallback=fallback)
            w = sum(g.advance for g in glyphs)
            widths.append(w)
            placed.append(glyphs)
        total = sum(widths)
        out: list[Glyph] = []
        if base_rtl:
            cursor = total
            for glyphs, w in zip(placed, widths):
                cursor -= w
                for g in glyphs:
                    g.x += cursor
                out.extend(glyphs)
        else:
            cursor = 0.0
            for glyphs, w in zip(placed, widths):
                for g in glyphs:
                    g.x += cursor
                out.extend(glyphs)
                cursor += w
        max_w = max(max_w, total)
        lines.append(out)
    return lines, max_w


def draw_text(
    img: Image.Image,
    xy: tuple[float, float],
    text: str,
    font: Font,
    fill: tuple[int, int, int],
    anchor: str = "la",
    alpha: float = 1.0,
    fallback: "Font | None" = None,
) -> tuple[float, float]:
    """Draw shaped text. Anchors: l/m/r + a(ascender) / m(middle) / b(baseline).

    Returns the (width, height) of the laid-out block.
    """
    lines, width = layout(font, text, fallback=fallback)
    line_h = font.line_height
    n = len(lines)
    x, y = xy
    if anchor[0] == "m":
        x -= width / 2
    elif anchor[0] == "r":
        x -= width
    # Vertical: compute the top of the block.
    if anchor[1] == "a":
        top = y
    elif anchor[1] == "m":
        top = y - (n * line_h) / 2
    else:  # baseline of the last line
        top = y - (n - 1) * line_h - font.ascender

    alpha_img = None
    if alpha < 1.0:
        alpha_img = Image.new("L", img.size, int(255 * max(0.0, alpha)))

    for li, glyphs in enumerate(lines):
        baseline = top + li * line_h + font.ascender
        for g in glyphs:
            gf = g.font or font
            m = gf.mask(g.gid)
            if m.size == 0:
                continue
            mx = int(round(x + g.x + g.ox))
            my = int(round(baseline + g.y - g.oy))
            _blend_mask(img, m, mx, my, fill, alpha_img)
    return width, n * line_h


def _blend_mask(img, mask, mx, my, fill, alpha_img=None):
    h, w = mask.shape
    W, H = img.size
    x0, y0 = max(0, mx), max(0, my)
    x1, y1 = min(W, mx + w), min(H, my + h)
    if x0 >= x1 or y0 >= y1:
        return
    sub = mask[y0 - my : y1 - my, x0 - mx : x1 - mx].astype(np.float32) / 255.0
    if alpha_img is not None:
        a = np.asarray(alpha_img)[y0:y1, x0:x1].astype(np.float32) / 255.0
        sub = sub * a
    region = np.asarray(img.crop((x0, y0, x1, y1))).astype(np.float32)
    colour = np.array(fill, dtype=np.float32)
    blended = region * (1 - sub[..., None]) + colour * sub[..., None]
    img.paste(Image.fromarray(blended.round().astype(np.uint8)), (x0, y0))


# ---------------------------------------------------------------------------
# Cached text plates: render once, reuse across thousands of frames.
# ---------------------------------------------------------------------------

_PLATES: dict[tuple, tuple[np.ndarray, np.ndarray, list[Glyph], float, float]] = {}


def text_plate(
    text: str,
    font: Font,
    fill=(20, 20, 20),
    fallback: "Font | None" = None,
) -> tuple[np.ndarray, np.ndarray, list[Glyph], float, float]:
    """Render one-colour text to (rgb, alpha, glyphs, w, h).

    The alpha channel is accumulated from FreeType coverage masks, and the RGB
    channels are filled with the ink colour, so partial-coverage pixels composite
    correctly (no dark fringes). Glyph x/y are absolute bitmap positions and are
    ordered the way a hand writes: line by line, right to left for Arabic.
    """
    key = (text, font.path, font.size, tuple(fill), fallback.path if fallback else "")
    if key in _PLATES:
        return _PLATES[key]

    lines, width = layout(font, text, fallback=fallback)
    line_h = font.line_height
    pad = int(font.size * 0.55) + 8
    W = int(width + pad * 2) + 6
    H = int(len(lines) * line_h + pad * 2) + 6
    alpha = np.zeros((max(H, 4), max(W, 4)), dtype=np.float32)
    glyphs: list[Glyph] = []
    asc = font.ascender
    for li, gl in enumerate(lines):
        baseline = pad + li * line_h + asc
        for g in sorted(gl, key=lambda g: -g.x):
            gf = g.font or font
            m = gf.mask(g.gid)
            mx = int(round(pad + g.x + g.ox))
            my = int(round(baseline + g.y - g.oy))
            glyphs.append(Glyph(g.gid, mx, my, g.w, g.h, 0, 0, g.advance, gf))
        for g in gl:
            gf = g.font or font
            m = gf.mask(g.gid)
            if m.size == 0:
                continue
            mx = int(round(pad + g.x + g.ox))
            my = int(round(baseline + g.y - g.oy))
            h, w = m.shape
            x0, y0 = max(0, mx), max(0, my)
            x1, y1 = min(alpha.shape[1], mx + w), min(alpha.shape[0], my + h)
            if x0 >= x1 or y0 >= y1:
                continue
            sub = m[y0 - my:y1 - my, x0 - mx:x1 - mx].astype(np.float32) / 255.0
            np.maximum(alpha[y0:y1, x0:x1], sub, out=alpha[y0:y1, x0:x1])

    ys, xs = np.where(alpha > 0.003)
    if len(xs):
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        alpha = alpha[y0:y1, x0:x1]
        for g in glyphs:
            g.x -= x0
            g.y -= y0
    h, w = alpha.shape
    rgb = np.empty((h, w, 3), dtype=np.uint8)
    rgb[..., 0], rgb[..., 1], rgb[..., 2] = fill
    a8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    result = (rgb, a8, glyphs, float(w), float(h))
    _PLATES[key] = result
    return result


class ImageDrawRGB:
    """Tiny shim so _blend_mask can accept an RGBA image."""

    def __init__(self, img):
        self.img = img


def _blend_mask_rgba(img: Image.Image, mask, mx, my, fill):
    h, w = mask.shape
    W, H = img.size
    x0, y0 = max(0, mx), max(0, my)
    x1, y1 = min(W, mx + w), min(H, my + h)
    if x0 >= x1 or y0 >= y1:
        return
    sub = mask[y0 - my : y1 - my, x0 - mx : x1 - mx].astype(np.float32) / 255.0
    region = np.asarray(img.crop((x0, y0, x1, y1))).astype(np.float32)
    colour = np.array(fill, dtype=np.float32)
    rgb = region[..., :3] * (1 - sub[..., None]) + colour * sub[..., None]
    a = region[..., 3] / 255.0
    out_a = (a + sub * (1 - a)) * 255.0
    out = np.dstack([rgb, out_a]).round().astype(np.uint8)
    img.paste(Image.fromarray(out, "RGBA"), (x0, y0))
