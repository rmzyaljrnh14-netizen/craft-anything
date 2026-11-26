"""Hand-drawn artwork library for the NAQSH whiteboard film.

Every function returns a list of ``ink.Element`` objects placed on the master
canvas, so a scene is just a timeline of strokes. All coordinates are in master
canvas pixels (2160x3840). Line work stays deliberately hand-made: tapered
strokes, slight wobble, and red used only for the moment that matters.
"""
from __future__ import annotations

import math
import random

from ink import (
    INK, INK_SOFT, GREY, GREY_LIGHT, RED, RED_SOFT, PAPER, SS, CW, CH,
    Stroke, Fill, Dot, Handwritten, bezier, qbez, smooth_through, ellipse_pts,
)
from shape import Font, AR_BOLD, AR_REG, LAT_BOLD, text_plate

F_TITLE = Font(AR_BOLD, 190)
F_HEAD = Font(AR_BOLD, 158)
F_BODY = Font(AR_REG, 108)
F_SMALL = Font(AR_REG, 86)
F_TINY = Font(LAT_BOLD, 62)
F_LOGO = Font(AR_BOLD, 330)
F_TAG = Font(AR_REG, 96)
F_BIGRED = Font(AR_BOLD, 140)
LAT = Font(LAT_BOLD, 78)

PLATES: dict[str, tuple] = {}


def plate(text, font=F_HEAD, color=(20, 20, 20), key=None):
    k = key or f"{text}|{font.size}|{color}"
    if k not in PLATES:
        PLATES[k] = text_plate(text, font, color, fallback=LAT)
    return PLATES[k]


def text(text_str, x, y, t, dur=None, font=F_HEAD, color=INK, anchor="ma", opacity=1.0):
    return Handwritten(plate(text_str, font, color if color != INK else (20, 20, 20)),
                       x, y, t0=t, dur=dur, anchor=anchor, opacity=opacity)


# --------------------------------------------------------------- primitives --
def line(pts, t, dur=0.5, w=10, color=INK, smooth=True, alpha=255, taper=(0.5, 0.45)):
    p = smooth_through(pts, 10) if smooth and len(pts) > 2 else pts
    return Stroke(p, width=w, color=color, t0=t, dur=dur, alpha=alpha, taper=taper)


def curve(p0, p1, p2, p3, t, dur=0.5, w=10, color=INK, alpha=255):
    return Stroke(bezier(p0, p1, p2, p3, 70), width=w, color=color, t0=t, dur=dur, alpha=alpha)


def circle(cx, cy, r, t, dur=0.6, w=10, color=INK, ry=None, a0=0.0, a1=2 * math.pi):
    ry = r if ry is None else ry
    pts = ellipse_pts(cx, cy, r, ry, a0, a1, 150)
    return Stroke(pts, width=w, color=color, t0=t, dur=dur, taper=(0.35, 0.35))


def wash(pts, t, dur=0.4, color=(228, 231, 235), alpha=255, blur=0.0, grow=0.08):
    return Fill(pts, color=color, t0=t, dur=dur, alpha=alpha, blur=blur, grow=grow)


def dot(cx, cy, r, t, color=INK, dur=0.18, squash=1.0, alpha=255):
    return Dot(cx, cy, r, color=color, t0=t, dur=dur, squash=squash, alpha=alpha)


def hatch(pts_a, pts_b, t, dur=0.4, n=6, w=6, color=GREY):
    """Short parallel shading ticks between two guide lines."""
    els = []
    for i in range(n):
        f = (i + 0.5) / n
        x = pts_a[0] + (pts_b[0] - pts_a[0]) * f
        y = pts_a[1] + (pts_b[1] - pts_a[1]) * f
        els.append(Stroke([(x, y), (x + 26, y + 34)], width=w, color=color,
                          t0=t + dur * i / n, dur=dur / n * 1.6, taper=(0.3, 0.3), alpha=140))
    return els


# ------------------------------------------------------------------- heads ---
def head_profile(cx, cy, s, t, dur=1.4, faces_left=True, wrap=True, w=11, scarf=True):
    """Readable side-profile portrait (left-facing) with a headscarf."""
    d = -1 if faces_left else 1
    P = lambda x, y: (cx + d * x * s, cy + y * s)
    els = []

    # Skull + scarf (behind the face).
    els.append(Stroke(smooth_through([
        P(-150, -232), P(-92, -286), P(-10, -306), P(76, -288), P(146, -238),
    ], 8), width=w, color=INK, t0=t, dur=dur * 0.4))
    if scarf:
        els.append(Stroke(smooth_through([
            P(146, -238), P(206, -168), P(234, -52), P(236, 84),
            P(228, 212), P(252, 352), P(268, 414),
        ], 8), width=w, color=INK, t0=t + dur * 0.34, dur=dur * 0.4))
        els.append(Stroke(smooth_through([
            P(268, 414), P(196, 386), P(140, 330), P(120, 250), P(126, 168),
        ], 8), width=w * 0.9, color=INK, t0=t + dur * 0.7, dur=dur * 0.3))
        els.append(Stroke(smooth_through([
            P(-150, -232), P(-84, -258), P(-6, -252), P(70, -232), P(132, -196),
        ], 8), width=w * 0.72, color=INK_SOFT, t0=t + dur * 0.86, dur=dur * 0.3, alpha=220))

    # Face profile.
    els.append(Stroke(smooth_through([
        P(-150, -232), P(-178, -196), P(-188, -152), P(-182, -118),
        P(-210, -74), P(-218, -50), P(-190, -38),
        P(-202, -18), P(-196, 4), P(-204, 26),
        P(-190, 62), P(-166, 88), P(-124, 106), P(-72, 116),
    ], 8), width=w, color=INK, t0=t + dur * 0.4, dur=dur * 0.5))
    els.append(Stroke(smooth_through([P(-72, 116), P(-10, 150), P(46, 128)], 6),
                      width=w * 0.85, color=INK, t0=t + dur * 0.88, dur=dur * 0.2))
    els.append(Stroke(smooth_through([P(-40, 150), P(-30, 228), P(-34, 286)], 6),
                      width=w * 0.8, color=INK, t0=t + dur * 1.0, dur=dur * 0.18))
    els.append(Stroke([P(-176, -160), P(-142, -166), P(-108, -156)],
                      width=w * 0.6, color=INK_SOFT, t0=t + dur * 1.06, dur=dur * 0.16))
    return els


def head_anchors(cx, cy, s, faces_left=True):
    """Key points on the profile, in canvas pixels, for placing props precisely."""
    d = -1 if faces_left else 1
    P = lambda x, y: (cx + d * x * s, cy + y * s)
    return {
        "eye": P(-150, -148),
        "brow": P(-158, -186),
        "nose": P(-206, -50),
        "mouth": P(-186, 30),
        "chin": P(-150, 92),
        "jaw": P(-72, 116),
        "scarf_back": P(240, 60),
        "crown": P(-10, -306),
        "neck": P(60, 200),
    }


def eye(cx, cy, s, t, dur=0.5, w=9, iris=True):
    """Profile eye: lid, lower lid, iris, pupil and a small lash."""
    els = [
        Stroke(bezier((cx - 40 * s, cy + 8 * s), (cx - 18 * s, cy - 26 * s),
                      (cx + 16 * s, cy - 26 * s), (cx + 38 * s, cy + 2 * s), 44),
               width=w, color=INK, t0=t, dur=dur * 0.55),
        Stroke(bezier((cx - 38 * s, cy + 8 * s), (cx - 14 * s, cy + 24 * s),
                      (cx + 14 * s, cy + 24 * s), (cx + 36 * s, cy + 4 * s), 44),
               width=w, color=INK, t0=t + dur * 0.45, dur=dur * 0.5),
    ]
    if iris:
        els.append(circle(cx - 2 * s, cy + 1 * s, 13 * s, t + dur * 0.9, dur=dur * 0.4, w=w * 0.7))
        els.append(dot(cx - 2 * s, cy + 1 * s, 8 * s, t + dur * 1.2, color=INK, dur=0.15))
        els.append(Stroke([(cx - 34 * s, cy + 4 * s), (cx - 52 * s, cy + 12 * s)], width=w * 0.7,
                          color=INK, t0=t + dur * 1.25, dur=dur * 0.2))
    return els


def mask(cx, cy, s, t, dur=0.85, w=10, faces_left=True):
    """Surgical mask seen in profile, covering nose and mouth, with two straps."""
    d = -1 if faces_left else 1
    P = lambda x, y: (cx + d * x * s, cy + y * s)
    els = []
    body = smooth_through([
        P(-96, -76), P(-20, -92), P(58, -80), P(96, -34),
        P(92, 34), P(58, 78), P(-24, 92), P(-90, 66), P(-104, -6),
    ], 6) + [P(-96, -76)]
    els.append(Fill(body, color=(236, 238, 242), t0=t + dur * 0.8, dur=0.3, alpha=255, grow=0.1))
    els.append(Stroke(body, width=w, color=INK, t0=t, dur=dur))
    for i, dy in enumerate((-40, 0, 40)):
        els.append(Stroke([P(-92, dy), P(90, dy - 6)], width=w * 0.45, color=INK_SOFT,
                          t0=t + dur * (0.8 + 0.08 * i), dur=dur * 0.26, alpha=185))
    # Straps: one over the ear, one under the jaw.
    els.append(Stroke(smooth_through([P(88, -56), P(150, -34), P(178, 26), P(176, 84)], 6),
                      width=w * 0.6, color=INK, t0=t + dur * 1.02, dur=dur * 0.35))
    els.append(Stroke(smooth_through([P(84, 62), P(142, 92), P(162, 132)], 6),
                      width=w * 0.6, color=INK, t0=t + dur * 1.06, dur=dur * 0.3))
    return els


def brain(cx, cy, s, t, dur=1.6, w=10):
    """Side view brain with cortex folds, cerebellum and brain stem."""
    els = []
    outline = smooth_through([
        (cx - 330 * s, cy + 60 * s),
        (cx - 380 * s, cy - 90 * s),
        (cx - 300 * s, cy - 230 * s),
        (cx - 90 * s, cy - 300 * s),
        (cx + 150 * s, cy - 280 * s),
        (cx + 320 * s, cy - 150 * s),
        (cx + 340 * s, cy + 20 * s),
        (cx + 180 * s, cy + 60 * s),
        (cx + 60 * s, cy + 40 * s),
    ], 8)
    els.append(Stroke(outline, width=w, color=INK, t0=t, dur=dur * 0.55))
    folds = [
        [(cx - 300 * s, cy - 120 * s), (cx - 190 * s, cy - 190 * s), (cx - 60 * s, cy - 120 * s), (cx + 60 * s, cy - 190 * s), (cx + 190 * s, cy - 120 * s), (cx + 300 * s, cy - 150 * s)],
        [(cx - 330 * s, cy - 20 * s), (cx - 220 * s, cy - 60 * s), (cx - 100 * s, cy + 10 * s), (cx + 30 * s, cy - 40 * s), (cx + 150 * s, cy + 20 * s), (cx + 250 * s, cy - 20 * s)],
        [(cx - 240 * s, cy - 260 * s), (cx - 200 * s, cy - 200 * s)],
        [(cx + 40 * s, cy - 270 * s), (cx + 20 * s, cy - 200 * s)],
    ]
    for i, f in enumerate(folds):
        els.append(Stroke(smooth_through(f, 8), width=w * 0.62, color=INK_SOFT, t0=t + dur * (0.5 + 0.12 * i), dur=dur * 0.35))
    # Cerebellum.
    els.append(Stroke(smooth_through([
        (cx + 60 * s, cy + 40 * s), (cx + 150 * s, cy + 80 * s), (cx + 210 * s, cy + 170 * s),
        (cx + 120 * s, cy + 240 * s), (cx - 10 * s, cy + 200 * s), (cx - 40 * s, cy + 110 * s),
    ], 8) + [(cx + 60 * s, cy + 40 * s)], width=w * 0.8, color=INK, t0=t + dur * 0.95, dur=dur * 0.35))
    for i in range(4):
        y = cy + (110 + i * 32) * s
        els.append(Stroke([(cx + 20 * s, y), (cx + 170 * s, y + 12 * s)], width=w * 0.35,
                          color=GREY, t0=t + dur * (1.15 + i * 0.05), dur=0.2))
    # Brain stem.
    els.append(Stroke(smooth_through([(cx - 40 * s, cy + 110 * s), (cx - 20 * s, cy + 210 * s), (cx - 70 * s, cy + 280 * s)], 6),
                      width=w * 0.8, color=INK, t0=t + dur * 1.05, dur=dur * 0.25))
    return els


def amygdala(cx, cy, s, t, dur=0.5, color=INK, w=10, fill=True):
    els = []
    pts = ellipse_pts(cx, cy, 68 * s, 44 * s, -0.5, 2 * math.pi - 0.5, 80)
    els.append(Stroke(pts, width=w, color=color, t0=t, dur=dur, taper=(0.3, 0.3)))
    if fill:
        els.append(Fill(pts, color=color, t0=t + dur * 0.85, dur=0.3, alpha=70 if color == RED else 40, grow=0.1))
    return els


def cracks(cx, cy, s, t, dur=0.5, color=RED, w=7):
    els = []
    for i, ang in enumerate((-2.4, -0.6, 1.1, 2.6)):
        a = ang
        pts = [(cx, cy)]
        x, y = cx, cy
        for k in range(3):
            a += (0.35 if k % 2 == 0 else -0.4)
            x += math.cos(a) * 46 * s
            y += math.sin(a) * 46 * s
            pts.append((x, y))
        els.append(Stroke(pts, width=w, color=color, t0=t + dur * i / 4, dur=dur * 0.5, taper=(0.2, 0.5)))
    return els


# ------------------------------------------------------------------ icons ----
def snake(cx, cy, s, t, dur=1.3, w=10, color=INK):
    """Coiled snake as a bold ink body with head, eye and tongue."""
    els = []
    center = []
    for i in range(56):
        f = i / 55
        x = cx + (f - 0.5) * 560 * s
        y = cy + math.sin(f * math.pi * 2.1 - 0.5) * 86 * s
        center.append((x, y))
    center = smooth_through(center, 4)
    # Body: thick stroke with tapered tail, then a lighter belly line.
    els.append(Stroke(center, width=w * 3.0, color=color, t0=t, dur=dur, taper=(0.35, 0.55)))
    belly = [(x, y + 15 * s) for x, y in center[3:-6]]
    els.append(Stroke(belly, width=w * 0.5, color=PAPER, t0=t + dur * 0.5, dur=dur * 0.5, alpha=170,
                      taper=(0.3, 0.4)))
    head_pts = smooth_through([
        (cx + 262 * s, cy - 4 * s), (cx + 300 * s, cy - 62 * s), (cx + 372 * s, cy - 64 * s),
        (cx + 404 * s, cy - 12 * s), (cx + 372 * s, cy + 42 * s), (cx + 292 * s, cy + 44 * s),
    ], 6)
    els.append(Fill(head_pts, color=color, t0=t + dur * 0.9, dur=0.35, alpha=255, grow=0.12))
    els.append(Stroke(head_pts + [head_pts[0]], width=w * 0.8, color=color,
                      t0=t + dur * 0.82, dur=dur * 0.35))
    els.append(Stroke([(cx + 398 * s, cy + 6 * s), (cx + 452 * s, cy - 4 * s), (cx + 486 * s, cy + 14 * s),
                       (cx + 452 * s, cy + 16 * s)], width=w * 0.55, color=RED,
                      t0=t + dur * 1.15, dur=dur * 0.3, taper=(0.2, 0.5)))
    els.append(dot(cx + 336 * s, cy - 24 * s, 8 * s, t + dur * 1.1, color=PAPER))
    return els


def spider(cx, cy, s, t, dur=1.1, w=9, color=INK):
    els = [circle(cx, cy + 18 * s, 46 * s, t, dur=dur * 0.5, w=w, ry=54 * s),
           circle(cx, cy - 58 * s, 30 * s, t + dur * 0.4, dur=dur * 0.4, w=w)]
    for side in (-1, 1):
        for i, (dx, dy, curl) in enumerate(((70, -40, 30), (96, 10, 44), (88, 60, 40), (58, 104, 30))):
            p0 = (cx + side * 34 * s, cy + (dy - 10) * s)
            p1 = (cx + side * (dx + 30) * s, cy + (dy - 54) * s)
            p2 = (cx + side * (dx + 52) * s, cy + (dy + 44) * s)
            p3 = (cx + side * (dx + curl) * s, cy + (dy + 108) * s)
            els.append(Stroke(bezier(p0, p1, p2, p3, 40), width=w, color=color,
                              t0=t + dur * (0.5 + 0.09 * i), dur=dur * 0.3))
    els.append(dot(cx - 10 * s, cy - 64 * s, 6 * s, t + dur * 0.9, color=RED))
    els.append(dot(cx + 12 * s, cy - 64 * s, 6 * s, t + dur * 0.95, color=RED))
    return els


def haunted_house(cx, cy, s, t, dur=1.2, w=10, color=INK):
    els = [
        Stroke([(cx - 130 * s, cy + 150 * s), (cx - 130 * s, cy - 40 * s), (cx, cy - 150 * s),
                (cx + 130 * s, cy - 40 * s), (cx + 130 * s, cy + 150 * s), (cx - 130 * s, cy + 150 * s)],
               width=w, color=color, t0=t, dur=dur * 0.7),
        Stroke([(cx - 190 * s, cy - 26 * s), (cx, cy - 190 * s), (cx + 190 * s, cy - 26 * s)],
               width=w, color=color, t0=t + dur * 0.6, dur=dur * 0.4),
        Stroke([(cx - 60 * s, cy + 150 * s), (cx - 60 * s, cy + 26 * s), (cx + 60 * s, cy + 26 * s),
                (cx + 60 * s, cy + 150 * s)], width=w * 0.8, color=color, t0=t + dur * 0.85, dur=dur * 0.35),
        Stroke([(cx - 90 * s, cy - 10 * s), (cx - 20 * s, cy - 10 * s), (cx - 20 * s, cy - 84 * s),
                (cx - 90 * s, cy - 84 * s), (cx - 90 * s, cy - 10 * s)], width=w * 0.7, color=color,
               t0=t + dur * 1.0, dur=dur * 0.3),
        Stroke([(cx + 26 * s, cy - 10 * s), (cx + 96 * s, cy - 10 * s), (cx + 96 * s, cy - 84 * s),
                (cx + 26 * s, cy - 84 * s), (cx + 26 * s, cy - 10 * s)], width=w * 0.7, color=color,
               t0=t + dur * 1.05, dur=dur * 0.3),
    ]
    els.append(circle(cx + 210 * s, cy - 190 * s, 46 * s, t + dur * 0.9, dur=dur * 0.4, w=w * 0.6, color=GREY))
    return els


def ecg(x0, x1, y, t, dur=0.8, w=8, color=INK, flat=True):
    n = 60
    pts = []
    for i in range(n + 1):
        f = i / n
        xx = x0 + (x1 - x0) * f
        yy = y
        if not flat and 0.42 < f < 0.58:
            k = (f - 0.42) / 0.16
            yy = y - math.sin(k * math.pi) * 120
        pts.append((xx, yy))
    return Stroke(pts, width=w, color=color, t0=t, dur=dur, taper=(0.2, 0.2))


def gas_cylinder(cx, cy, s, t, dur=0.9, w=10, color=INK):
    els = [
        Stroke(smooth_through([(cx - 92 * s, cy - 150 * s), (cx + 92 * s, cy - 150 * s),
                               (cx + 100 * s, cy + 160 * s), (cx - 100 * s, cy + 160 * s),
                               (cx - 92 * s, cy - 150 * s)], 4), width=w, color=color, t0=t, dur=dur),
        Stroke([(cx, cy - 150 * s), (cx, cy - 210 * s)], width=w * 0.8, color=color, t0=t + dur * 0.8, dur=dur * 0.3),
        Stroke([(cx - 34 * s, cy - 210 * s), (cx + 34 * s, cy - 210 * s)], width=w * 0.9, color=color,
               t0=t + dur * 0.9, dur=dur * 0.25),
        Stroke(smooth_through([(cx + 34 * s, cy - 200 * s), (cx + 150 * s, cy - 190 * s), (cx + 210 * s, cy - 120 * s)], 6),
               width=w * 0.7, color=color, t0=t + dur * 1.0, dur=dur * 0.4, alpha=200),
    ]
    els.append(text("٣٥٪", cx, cy + 10 * s, t + dur * 0.8, font=F_BIGRED, color=RED))
    return els


def molecule(cx, cy, s, t, dur=0.6, w=8, color=INK):
    els = [circle(cx, cy, 40 * s, t, dur=dur * 0.6, w=w, color=color),
           circle(cx - 92 * s, cy + 54 * s, 30 * s, t + dur * 0.55, dur=dur * 0.45, w=w * 0.85, color=color),
           circle(cx + 92 * s, cy + 54 * s, 30 * s, t + dur * 0.7, dur=dur * 0.45, w=w * 0.85, color=color),
           Stroke([(cx - 30 * s, cy + 22 * s), (cx - 70 * s, cy + 40 * s)], width=w * 0.6, color=color,
                  t0=t + dur * 0.65, dur=dur * 0.3),
           Stroke([(cx + 30 * s, cy + 22 * s), (cx + 70 * s, cy + 40 * s)], width=w * 0.6, color=color,
                  t0=t + dur * 0.7, dur=dur * 0.3)]
    return els


def burst(cx, cy, s, t, dur=0.55, n=12, color=RED, w=9, r0=150, r1=280):
    els = []
    rng = random.Random(11)
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
        rr = r1 * (0.85 + rng.uniform(0, 0.3))
        p0 = (cx + math.cos(a) * r0 * s, cy + math.sin(a) * r0 * s)
        p1 = (cx + math.cos(a) * rr * s, cy + math.sin(a) * rr * s)
        els.append(Stroke([p0, p1], width=w * (1.1 if i % 3 == 0 else 0.7), color=color,
                          t0=t + dur * 0.55 * i / n, dur=dur * 0.35, taper=(0.25, 0.6)))
    return els


def arrow(x0, y0, x1, y1, t, dur=0.45, w=10, color=INK, head=34, bend=0.0):
    mx = (x0 + x1) / 2 + bend
    my = (y0 + y1) / 2 - bend
    p = qbez((x0, y0), (mx, my), (x1, y1), 50)
    ang = math.atan2(y1 - p[-6][1], x1 - p[-6][0])
    a1 = ang + 2.6
    a2 = ang - 2.6
    return [
        Stroke(p, width=w, color=color, t0=t, dur=dur, taper=(0.2, 0.15)),
        Stroke([(x1, y1), (x1 + math.cos(a1) * head, y1 + math.sin(a1) * head)], width=w, color=color,
               t0=t + dur * 0.92, dur=dur * 0.25, taper=(0.2, 0.4)),
        Stroke([(x1, y1), (x1 + math.cos(a2) * head, y1 + math.sin(a2) * head)], width=w, color=color,
               t0=t + dur * 0.95, dur=dur * 0.25, taper=(0.2, 0.4)),
    ]


def figure(cx, cy, s, t, dur=0.7, w=8, color=INK, fill=True):
    """Simple standing human figure (head + shoulders + torso)."""
    els = [circle(cx, cy - 96 * s, 40 * s, t, dur=dur * 0.5, w=w, color=color),
           Stroke(smooth_through([(cx - 74 * s, cy + 40 * s), (cx - 62 * s, cy - 20 * s),
                                  (cx, cy - 44 * s), (cx + 62 * s, cy - 20 * s), (cx + 74 * s, cy + 40 * s)], 6),
                  width=w, color=color, t0=t + dur * 0.45, dur=dur * 0.5)]
    if fill:
        els.append(Fill([(cx - 70 * s, cy + 40 * s), (cx - 58 * s, cy - 14 * s), (cx, cy - 40 * s),
                         (cx + 58 * s, cy - 14 * s), (cx + 70 * s, cy + 40 * s)], color=color,
                        t0=t + dur * 0.9, dur=0.3, alpha=70))
    return els


def underline(x0, x1, y, t, dur=0.35, color=RED, w=8):
    return [Stroke(smooth_through([(x0, y), ((x0 + x1) / 2, y + 4), (x1, y - 2)], 6),
                   width=w, color=color, t0=t, dur=dur, taper=(0.25, 0.5))]


def frame_box(x0, y0, x1, y1, t, dur=0.7, w=7, color=GREY, radius=28):
    """Loose hand-drawn rectangle, four slightly imprecise strokes."""
    els = [
        Stroke([(x0, y0), (x1 - 24, y0 + 3)], width=w, color=color, t0=t, dur=dur * 0.42),
        Stroke([(x1, y0 + 18), (x1 - 2, y1 - 18)], width=w, color=color, t0=t + dur * 0.36, dur=dur * 0.3),
        Stroke([(x1 - 14, y1), (x0 + 20, y1 - 3)], width=w, color=color, t0=t + dur * 0.62, dur=dur * 0.24),
        Stroke([(x0, y1 - 14), (x0 + 2, y0 + 16)], width=w, color=color, t0=t + dur * 0.82, dur=dur * 0.2),
    ]
    return els


def check(cx, cy, s, t, dur=0.35, w=10, color=RED):
    return [Stroke([(cx - 34 * s, cy), (cx - 6 * s, cy + 30 * s), (cx + 42 * s, cy - 36 * s)],
                   width=w, color=color, t0=t, dur=dur)]


def cross(cx, cy, s, t, dur=0.3, w=9, color=GREY):
    return [Stroke([(cx - 26 * s, cy - 26 * s), (cx + 26 * s, cy + 26 * s)], width=w, color=color, t0=t, dur=dur),
            Stroke([(cx + 26 * s, cy - 26 * s), (cx - 26 * s, cy + 26 * s)], width=w, color=color,
                   t0=t + dur * 0.6, dur=dur)]
