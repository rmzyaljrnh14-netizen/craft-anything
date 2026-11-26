"""Ink engine for NAQSH STUDIO whiteboard films.

Everything here is drawn from scratch: tapered ink strokes with pressure and
hand wobble, progressive reveal along the stroke path, filled ink washes, an
illustrated marker hand that follows the ink, and a keyframed camera that crops a
supersampled master canvas down to 1080x1920.

The master canvas is 2x the delivery size, so every line is supersampled and the
final downscale gives clean anti-aliasing without any external assets.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------- palette ----
PAPER = (253, 252, 250)
INK = (24, 26, 30)
INK_SOFT = (58, 62, 68)
GREY = (150, 155, 161)
GREY_LIGHT = (212, 216, 220)
RED = (193, 39, 45)
RED_SOFT = (232, 148, 140)
SKIN = (242, 200, 167)
SKIN_SHADE = (214, 166, 132)
SLEEVE = (32, 36, 44)
MARKER_RED = (193, 39, 45)

W, H = 1080, 1920          # delivery
SS = 2                     # supersample factor
CW, CH = W * SS, H * SS    # master canvas


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 0.5 - 0.5 * math.cos(math.pi * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------- geometry ------
def bezier(p0, p1, p2, p3, n=60):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def qbez(p0, p1, p2, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**2 * p0[0] + 2 * mt * t * p1[0] + t**2 * p2[0]
        y = mt**2 * p0[1] + 2 * mt * t * p1[1] + t**2 * p2[1]
        out.append((x, y))
    return out


def smooth_through(points: Sequence[tuple[float, float]], n=16):
    """Catmull-Rom spline through the given points."""
    pts = list(points)
    if len(pts) < 3:
        return pts
    out = []
    ext = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for j in range(n):
            t = j / n
            t2, t3 = t * t, t * t * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            out.append((x, y))
    out.append(pts[-1])
    return out


def ellipse_pts(cx, cy, rx, ry, a0=0.0, a1=2 * math.pi, n=120):
    return [
        (cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n))
        for i in range(n + 1)
    ]


def rotate_pts(pts, cx, cy, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    return [((x - cx) * ca - (y - cy) * sa + cx, (x - cx) * sa + (y - cy) * ca + cy) for x, y in pts]


# --------------------------------------------------------------- elements ----
class Element:
    """A timed drawing unit. ``u`` is its own local 0..1 progress."""

    def __init__(self, t0: float = 0.0, dur: float = 1.0):
        self.t0, self.dur = t0, max(0.01, dur)

    def u(self, t: float) -> float:
        if t <= self.t0:
            return 0.0
        return min(1.0, (t - self.t0) / self.dur)

    def active(self, t: float) -> bool:
        return self.t0 <= t <= self.t0 + self.dur + 1e-6

    def tip(self, t: float):
        return None

    def draw(self, canvas, t: float):
        raise NotImplementedError


class Stroke(Element):
    """A tapered ink stroke revealed progressively along its arc length."""

    def __init__(self, pts, width=9.0, color=INK, t0=0.0, dur=1.0,
                 taper=(0.55, 0.5), wobble=1.0, seed=0, alpha=255, jitter=0.0):
        super().__init__(t0, dur)
        pts = list(pts)
        if len(pts) < 2:
            pts = pts + [(pts[0][0] + 0.5, pts[0][1])] if pts else [(0, 0), (1, 0)]
        self.raw = [(float(x), float(y)) for x, y in pts]
        self.width = width * SS
        self.color = color
        self.alpha = alpha
        self.taper = taper
        rng = random.Random(seed or (int(pts[0][0]) * 7919 + int(pts[0][1]) * 104729 + len(pts)))
        wob = []
        for i, (x, y) in enumerate(self.raw):
            if i == 0 or i == len(self.raw) - 1:
                wob.append((x, y))
                continue
            dx = self.raw[i + 1][0] - self.raw[i - 1][0]
            dy = self.raw[i + 1][1] - self.raw[i - 1][1]
            n = math.hypot(dx, dy) or 1
            amp = wobble * SS * 1.2 * math.sin(i * 0.6 + rng.random() * 6) * (0.4 + 0.6 * rng.random())
            wob.append((x - dy / n * amp, y + dx / n * amp))
        self.pts = wob
        self.cum = [0.0]
        for i in range(1, len(self.pts)):
            self.cum.append(self.cum[-1] + math.dist(self.pts[i - 1], self.pts[i]))
        self.length = self.cum[-1] or 1.0
        self._drawn = 0.0
        self._draw = None
        self._canvas = None

    def point_at(self, s: float):
        s = max(0.0, min(self.length, s))
        lo, hi = 0, len(self.cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        seg = self.cum[hi] - self.cum[lo] or 1
        f = (s - self.cum[lo]) / seg
        a, b = self.pts[lo], self.pts[hi]
        return (lerp(a[0], b[0], f), lerp(a[1], b[1], f))

    def tip(self, t):
        return self.point_at(self.length * ease_out(self.u(t)))

    def radius_at(self, frac: float):
        a, b = self.taper
        r = self.width / 2
        if a > 0 and frac < a:
            r *= 0.4 + 0.6 * ease_out(frac / a)
        if b > 0 and frac > 1 - b:
            r *= 0.3 + 0.7 * ease_out((1 - frac) / b)
        return max(0.7 * SS, r)

    def draw(self, canvas, t):
        target = self.length * ease_out(self.u(t))
        if target <= self._drawn + 0.2:
            return
        if self._canvas is not canvas:
            self._canvas = canvas
            self._draw = ImageDraw.Draw(canvas, "RGBA")
        col = tuple(self.color) + (self.alpha,)
        step = max(1.1, self.width * 0.14)
        s = self._drawn
        while s < target:
            frac = s / self.length
            r = self.radius_at(frac)
            x, y = self.point_at(s)
            self._draw.ellipse((x - r, y - r, x + r, y + r), fill=col)
            s += step * 0.62
        self._drawn = target

    def finish(self, canvas):
        self.draw(canvas, self.t0 + self.dur + 1)


class Fill(Element):
    """Filled ink wash that blooms in as its outline completes."""

    def __init__(self, pts, color=(40, 42, 48), t0=0.0, dur=0.45, alpha=255, blur=0.0, grow=0.0):
        super().__init__(t0, dur)
        self.pts = [(float(x), float(y)) for x, y in pts]
        self.color = color
        self.alpha = alpha
        self.blur = blur
        self.grow = grow
        self._done = False
        xs = [p[0] for p in self.pts]
        ys = [p[1] for p in self.pts]
        pad = int(60 * SS + blur * SS * 3)
        self.box = (max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad),
                    int(max(xs)) + pad, int(max(ys)) + pad)

    def draw(self, canvas, t):
        u = self.u(t)
        if u <= 0 or self._done:
            return
        if u < 1.0:
            u = 1.0
        self._done = True
        x0, y0, x1, y1 = self.box
        w, h = max(1, x1 - x0), max(1, y1 - y0)
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        k = ease_out(u)
        s = 1.0 + self.grow * (1 - k)
        pts = [((x - cx) * k * s + cx - x0, (y - cy) * k * s + cy - y0) for x, y in self.pts]
        d.polygon(pts, fill=tuple(self.color) + (int(self.alpha * k),))
        if self.blur:
            layer = layer.filter(ImageFilter.GaussianBlur(self.blur * SS))
        canvas.paste(layer.convert("RGB"), (x0, y0), layer.getchannel("A"))

    def finish(self, canvas):
        self.draw(canvas, self.t0 + self.dur + 1)


class Dot(Element):
    """Ink dot / accent that pops in with a small overshoot."""

    def __init__(self, cx, cy, r, color=INK, t0=0.0, dur=0.2, squash=1.0, alpha=255):
        super().__init__(t0, dur)
        self.cx, self.cy, self.r = cx, cy, r * SS
        self.color, self.squash, self.alpha = color, squash, alpha
        self._done = False

    def tip(self, t):
        return (self.cx, self.cy)

    def draw(self, canvas, t):
        u = self.u(t)
        if u <= 0 or self._done:
            return
        k = ease_out(u) * (1 + 0.22 * math.sin(math.pi * u))
        r = self.r * k
        d = ImageDraw.Draw(canvas, "RGBA")
        d.ellipse((self.cx - r, self.cy - r * self.squash, self.cx + r, self.cy + r * self.squash),
                  fill=tuple(self.color) + (self.alpha,))
        if u >= 1:
            self._done = True

    def finish(self, canvas):
        self.draw(canvas, self.t0 + self.dur + 1)


class Handwritten(Element):
    """Text revealed glyph by glyph, in the order a hand would write it."""

    def __init__(self, plate, x, y, t0=0.0, dur=None, per_glyph=0.0, anchor="la", opacity=1.0, color=None):
        rgb, alpha_map, glyphs, w, h = plate
        if color is not None:
            rgb = np.zeros_like(rgb) + np.array(color, dtype=np.uint8)
        if dur is None:
            dur = max(0.35, len(glyphs) * (per_glyph or 0.032))
        super().__init__(t0, dur)
        self.rgb, self.alpha_map, self.glyphs, self.w, self.h = rgb, alpha_map, glyphs, w, h
        self.x, self.y = x, y
        if anchor[0] == "m":
            self.x -= self.w / 2
        elif anchor[0] == "r":
            self.x -= self.w
        if anchor[1] == "m":
            self.y -= self.h / 2
        elif anchor[1] == "b":
            self.y -= self.h
        self.opacity = opacity
        self._n = 0

    def tip(self, t):
        u = self.u(t)
        i = min(len(self.glyphs) - 1, int(u * len(self.glyphs)))
        g = self.glyphs[max(0, i)]
        return (self.x + g.x + g.w * 0.5, self.y + g.y + g.h * 0.55)

    def draw(self, canvas, t):
        u = self.u(t)
        if u <= 0:
            return
        n = int(round(u * len(self.glyphs)))
        if n <= self._n:
            return
        new = self.glyphs[self._n:min(n, len(self.glyphs))]
        self._n = min(n, len(self.glyphs))
        cw, ch = canvas.size
        ox_base, oy_base = int(round(self.x)), int(round(self.y))
        for g in new:
            gw, gh = int(g.w), int(g.h)
            if gw <= 0 or gh <= 0:
                continue
            px, py = int(round(g.x)), int(round(g.y))       # plate coords
            dx, dy = px + ox_base, py + oy_base             # canvas coords
            # Clip against the canvas.
            sx0, sy0 = max(0, -dx), max(0, -dy)
            sx1 = min(gw, cw - dx)
            sy1 = min(gh, ch - dy)
            if sx0 >= sx1 or sy0 >= sy1:
                continue
            a = self.alpha_map[py + sy0:py + sy1, px + sx0:px + sx1]
            if self.opacity < 1.0:
                a = (a.astype(np.float32) * self.opacity).astype(np.uint8)
            if not a.any():
                continue
            rgb = np.ascontiguousarray(self.rgb[py + sy0:py + sy1, px + sx0:px + sx1])
            canvas.paste(Image.fromarray(rgb, "RGB"), (dx + sx0, dy + sy0),
                         Image.fromarray(np.ascontiguousarray(a), "L"))

    def finish(self, canvas):
        self.draw(canvas, self.t0 + self.dur + 1)


# ---------------------------------------------------------------- hand -------
NIB = (40.0, 34.0)   # nib position inside the hand sprite (sprite pixels)


def _capsule(p0, p1, r, n=14):
    """Rounded capsule polygon between two points."""
    (x0, y0), (x1, y1) = p0, p1
    ang = math.atan2(y1 - y0, x1 - x0)
    pts = []
    for i in range(n + 1):
        a = ang + math.pi / 2 + math.pi * i / n
        pts.append((x1 + r * math.cos(a), y1 + r * math.sin(a)))
    for i in range(n + 1):
        a = ang + 3 * math.pi / 2 - math.pi * i / n
        pts.append((x0 + r * math.cos(a), y0 + r * math.sin(a)))
    return pts


def _rot_capsule(cx, cy, half_len, r, ang):
    dx, dy = math.cos(ang) * half_len, math.sin(ang) * half_len
    return _capsule((cx - dx, cy - dy), (cx + dx, cy + dy), r)


_HAND = None


def hand_sprite(height_px: float) -> tuple[Image.Image, tuple[float, float]]:
    """Illustrated hand gripping a black marker. Nib at ``NIB``.

    Drawn in screen space (marker always descends toward the lower right), so the
    sprite only needs uniform scaling. Returns (RGBA sprite, nib offset).
    """
    global _HAND
    if _HAND is not None:
        sprite, _, h0 = _HAND
        f = height_px / h0
        if abs(f - 1) < 0.004:
            return sprite, _HAND[1]
        sp = sprite.resize((max(1, int(sprite.size[0] * f)), max(1, int(sprite.size[1] * f))), Image.LANCZOS)
        return sp, (_HAND[1][0] * f, _HAND[1][1] * f)

    SW, SH = 620, 700
    img = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # --- marker: shaft from the nib down to the palm, slight perspective ------
    shaft_a = (98, 128)
    shaft_b = (232, 470)
    red_band = _capsule((122, 206), (136, 258), 24)
    nib = [(40, 34), (80, 64), (100, 156), (46, 156)]

    # --- hand: palm, fingers, thumb, wrist ------------------------------------
    palm = _rot_capsule(322, 452, 96, 86, math.radians(28))
    fingers = [
        _rot_capsule(196, 322, 52, 30, math.radians(-62)),
        _rot_capsule(186, 386, 54, 30, math.radians(-58)),
        _rot_capsule(190, 450, 52, 29, math.radians(-52)),
        _rot_capsule(206, 512, 46, 27, math.radians(-46)),
    ]
    thumb = _rot_capsule(300, 352, 74, 34, math.radians(64))
    wrist = [(300, 480), (470, 540), (520, 760), (250, 760)]
    cuff = [(380, 560), (470, 600), (512, 760), (330, 760)]

    # Soft contact shadow.
    shadow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    ds.polygon(palm, fill=(25, 25, 34, 90))
    ds.polygon(wrist, fill=(25, 25, 34, 90))
    for f in fingers:
        ds.polygon(f, fill=(25, 25, 34, 70))
    ds.polygon(thumb, fill=(25, 25, 34, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(shadow, (16, 24))

    # Sleeve first (behind the hand).
    d.polygon(wrist, fill=SLEEVE + (255,))
    d.line(wrist + [wrist[0]], fill=(12, 13, 16, 255), width=6, joint="curve")

    # Thumb behind the fingers, on the left of the shaft.
    d.polygon(thumb, fill=SKIN + (255,), outline=INK + (255,))
    d.line(thumb + [thumb[0]], fill=INK + (255,), width=6, joint="curve")

    # Palm.
    d.polygon(palm, fill=SKIN + (255,))
    # Palm shading.
    shade = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    dsh = ImageDraw.Draw(shade)
    dsh.polygon(_rot_capsule(352, 486, 78, 62, math.radians(28)), fill=SKIN_SHADE + (120,))
    shade = shade.filter(ImageFilter.GaussianBlur(16))
    img.alpha_composite(shade)
    d.line(palm + [palm[0]], fill=INK + (255,), width=6, joint="curve")

    # Fingers curled around the shaft, drawn over it.
    for f in fingers:
        d.polygon(f, fill=SKIN + (255,), outline=INK + (255,))
        d.line(f + [f[0]], fill=INK + (255,), width=6, joint="curve")
    # Knuckle creases.
    for cx, cy in ((250, 372), (244, 436)):
        d.line([(cx - 10, cy), (cx + 10, cy + 8)], fill=(150, 106, 82, 140), width=3)

    # Marker over the grip: shaft, cap line, red band, nib.
    d.polygon(_capsule((100, 150), shaft_b, 26), fill=(38, 41, 49, 255), outline=(11, 12, 15, 255))
    d.polygon(red_band, fill=MARKER_RED + (255,), outline=(122, 22, 28, 255))
    d.polygon(nib, fill=(32, 34, 40, 255), outline=(11, 12, 15, 255))
    d.line([(66, 76), (88, 146)], fill=(96, 100, 112, 255), width=6)
    # High-light along the shaft.
    d.line([(146, 214), (222, 444)], fill=(86, 91, 102, 255), width=4)

    # Cuff highlight.
    d.line([(392, 574), (498, 620)], fill=(228, 231, 236, 255), width=12)

    tip = (NIB[0], NIB[1])
    _HAND = (img, tip, float(SH))
    f = height_px / SH
    sp = img.resize((max(1, int(SW * f)), max(1, int(SH * f))), Image.LANCZOS)
    return sp, (tip[0] * f, tip[1] * f)


def draw_hand(frame: Image.Image, x: float, y: float, height: float, alpha: float = 1.0,
              minimum: bool = False):
    sprite, tip = hand_sprite(height)
    if alpha < 1.0:
        sprite = sprite.copy()
        sprite.putalpha(sprite.getchannel("A").point(lambda v: int(v * alpha)))
    frame.paste(sprite.convert("RGB"), (int(round(x - tip[0])), int(round(y - tip[1]))),
                sprite.getchannel("A"))


# ---------------------------------------------------------------- camera -----
@dataclass
class Camera:
    keys: list = field(default_factory=lambda: [(0.0, CW / 2, CH / 2, 1.0)])

    def at(self, t: float):
        ks = self.keys
        if t <= ks[0][0]:
            return ks[0][1], ks[0][2], ks[0][3]
        for i in range(1, len(ks)):
            if t <= ks[i][0]:
                t0, x0, y0, z0 = ks[i - 1]
                t1, x1, y1, z1 = ks[i]
                f = ease_in_out((t - t0) / max(1e-6, t1 - t0))
                return lerp(x0, x1, f), lerp(y0, y1, f), lerp(z0, z1, f)
        return ks[-1][1], ks[-1][2], ks[-1][3]

    def view(self, t: float):
        cx, cy, z = self.at(t)
        vw, vh = CW / z, CH / z
        x0 = max(0.0, min(CW - vw, cx - vw / 2))
        y0 = max(0.0, min(CH - vh, cy - vh / 2))
        return x0, y0, vw, vh

    def project(self, t: float, pt):
        x0, y0, vw, vh = self.view(t)
        sx = (pt[0] - x0) / vw * W
        sy = (pt[1] - y0) / vh * H
        return sx, sy

    def render(self, canvas: Image.Image, t: float, out_size=None) -> Image.Image:
        x0, y0, vw, vh = self.view(t)
        out_size = out_size or (W, H)
        return canvas.transform(out_size, Image.AFFINE,
                                (vw / out_size[0], 0, x0, 0, vh / out_size[1], y0),
                                resample=Image.BILINEAR)


# ------------------------------------------------------------ paper/grain ----
_PAPER_BASE = None


def paper_background() -> Image.Image:
    """Very light warm paper with a vignette and fine grain (premium, not flat)."""
    global _PAPER_BASE
    if _PAPER_BASE is not None:
        return _PAPER_BASE.copy()
    base = Image.new("RGB", (CW, CH), PAPER)
    arr = np.asarray(base).astype(np.float32)
    # Vignette.
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    nx = (xx - CW / 2) / (CW / 2)
    ny = (yy - CH / 2) / (CH / 2)
    vig = 1.0 - 0.035 * (nx**2 + ny**2)
    arr *= vig[..., None]
    rng = np.random.default_rng(20261126)
    grain = rng.normal(0, 2.1, (CH, CW, 1))
    arr = np.clip(arr + grain, 0, 255)
    _PAPER_BASE = Image.fromarray(arr.astype(np.uint8), "RGB")
    return _PAPER_BASE.copy()


def brush_edge(p: float, x: float) -> float:
    """Ragged brush edge y for sweep progress p at frame x (hand-drawn wobble)."""
    base = p * (H * 1.25) - H * 0.12
    return base + math.sin(x * 0.012) * 34 + math.sin(x * 0.031 + 1.7) * 16


def brush_wipe(frame: Image.Image, p: float, previous: Image.Image | None = None) -> Image.Image:
    """Reveal ``frame`` from the top behind a ragged, uneven brush sweep."""
    if p <= 0:
        return previous.convert("RGB") if previous is not None else frame
    if p >= 1:
        return frame
    mask = Image.new("L", frame.size, 0)
    d = ImageDraw.Draw(mask)
    xs = list(range(-30, W + 72, 12))
    xs[-1] = W + 60
    pts = [(x, brush_edge(p, x)) for x in xs]
    d.polygon([(-30, -80), (W + 60, -80)] + pts[::-1], fill=255)
    # A few dry-brush streaks ahead of the edge.
    for i, x0 in enumerate(range(-40, W + 60, 96)):
        y = brush_edge(p, x0) + 10 + (i % 3) * 12
        d.line([(x0, y), (x0 + 64 + (i % 4) * 12, y + 6)], fill=255, width=7)
    a = mask.filter(ImageFilter.GaussianBlur(3.2))
    out = frame.copy()
    if previous is not None:
        out.paste(previous.convert("RGB"), (0, 0), Image.eval(a, lambda v: 255 - v))
    return out
