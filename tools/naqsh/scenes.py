"""Scene construction for the NAQSH film: "The woman who knew no fear".

Real story, verified facts (Feinstein et al., Nature Neuroscience, 2013):
patient S.M. with Urbach-Wiethe disease and bilateral amygdala destruction;
live snakes and spiders, a haunted house, no fear, no rise in heart rate;
one vital-capacity inhalation of 35% CO2 caused a full panic attack in all
three amygdala patients, while only 3 of 12 healthy comparison participants
panicked. Conclusion: fear is not one centre — external threat runs through the
amygdala, internal suffocation signals run through an older path.

Every visual element is timed against the narration's own breathing pauses
(see align.py), so text and drawing land on the spoken line. Beat spans are
passed in as ``B``: list of (t0, t1) fractions of the scene duration.
"""
from __future__ import annotations

import math

import art
import ink
from ink import (
    INK, INK_SOFT, GREY, GREY_LIGHT, RED, PAPER, Stroke, Fill, Dot, Handwritten,
    smooth_through,
)

MX = 1080  # master canvas centre (canvas is 2160x3840)


def beat(B, i, frac=0.0):
    """Absolute time inside beat ``i`` (+ optional fraction of that beat)."""
    t0, t1 = B[min(i, len(B) - 1)]
    return t0 + (t1 - t0) * frac


def span(B, i, dur_frac=0.9):
    t0, t1 = B[min(i, len(B) - 1)]
    return max(0.25, (t1 - t0) * dur_frac)


# ---------------------------------------------------------------- scene 1 ----
def scene1(B, d):
    els = []
    t_hook = beat(B, 0, 0.02)
    els.append(art.text("لم تعرف الخوف", MX, 210, t_hook, font=art.F_HEAD, dur=min(0.7, span(B, 0, 0.4))))
    els.append(art.text("في حياتها", MX, 395, t_hook + min(0.5, span(B, 0, 0.28)), font=art.F_HEAD,
                        dur=min(0.6, span(B, 0, 0.35))))
    hs = 2.25
    t_head = t_hook + min(0.75, span(B, 0, 0.45))
    els += art.head_profile(MX, 1640, hs, t_head, dur=min(1.4, max(0.7, span(B, 0, 0.75))))
    a = art.head_anchors(MX, 1640, hs)
    els += art.eye(*a["eye"], 1.9, t_head + 0.85, dur=0.4)
    els += art.mask(a["mouth"][0] + 40, a["mouth"][1] - 20, 2.0,
                    beat(B, 2, 0.05), dur=max(0.35, span(B, 2, 0.4)))
    els.append(art.text("ثم… كمامة", MX, 2600, beat(B, 2, 0.36), font=art.F_HEAD, color=RED))
    cam = [(0.0, MX, 1850, 1.0), (0.55, MX + 20, 1780, 1.1), (1.0, MX, 1650, 1.2)]
    return els, cam


# ---------------------------------------------------------------- scene 2 ----
def scene2(B, d):
    els = []
    els.append(art.text("مرض نادر", MX, 260, beat(B, 0, 0.04), font=art.F_HEAD))
    els.append(art.text("كلّس اللوزة الدماغية", MX, 440, beat(B, 0, 0.4), font=art.F_HEAD))
    els += art.brain(MX, 1450, 1.4, beat(B, 0, 0.62), dur=span(B, 0, 0.3))
    els += art.amygdala(MX + 40, 1530, 1.9, beat(B, 1, 0.1), dur=span(B, 1, 0.15), color=RED)
    els += art.cracks(MX + 150, 1530, 1.5, beat(B, 1, 0.3), dur=span(B, 1, 0.2))
    els.append(art.text("اللوزة الدماغية", MX, 2000, beat(B, 1, 0.5), font=art.F_SMALL, color=RED))
    els.append(art.text("«مركز الخوف» في الدماغ", MX, 2400, beat(B, 2, 0.05), font=art.F_BODY))
    cam = [(0.0, MX, 1800, 1.0), (0.5, MX + 60, 1750, 1.08), (1.0, MX + 40, 1700, 1.15)]
    return els, cam


# ---------------------------------------------------------------- scene 3 ----
def scene3(B, d):
    els = []
    els.append(art.text("ثعابين… عناكب", MX, 300, beat(B, 0, 0.02), font=art.F_HEAD,
                        dur=max(0.4, span(B, 0, 0.3))))
    els += art.snake(MX, 700, 1.3, beat(B, 0, 0.3), dur=max(0.5, span(B, 0, 0.3)))
    els += art.spider(MX - 450, 1290, 1.6, beat(B, 0, 0.62), dur=max(0.4, span(B, 0, 0.25)))
    els += art.haunted_house(MX + 470, 1270, 1.7, beat(B, 0, 0.82), dur=max(0.4, span(B, 0, 0.25)))
    els.append(art.ecg(MX - 620, MX + 620, 1720, beat(B, 1, 0.12), dur=span(B, 1, 0.4), flat=True, w=9))
    els.append(art.text("نبضها لم يتغيّر", MX, 1950, beat(B, 1, 0.5), font=art.F_HEAD))
    els += art.underline(MX - 520, MX + 520, 2140, beat(B, 2, 0.1), color=GREY, w=7)
    els.append(art.text("لا خوف", MX, 2300, beat(B, 2, 0.3), font=art.F_SMALL, color=GREY))
    cam = [(0.0, MX, 1750, 1.0), (0.45, MX, 1700, 1.05), (1.0, MX, 1800, 1.1)]
    return els, cam


# ---------------------------------------------------------------- scene 4 ----
def scene4(B, d):
    els = []
    els.append(art.text("ثم… نفَس واحد", MX, 260, beat(B, 0, 0.04), font=art.F_HEAD))
    els += art.gas_cylinder(MX - 320, 1180, 1.75, beat(B, 1, 0.15), dur=span(B, 1, 0.6))
    els += art.molecule(MX + 470, 1330, 1.5, beat(B, 1, 0.55), dur=span(B, 1, 0.4))
    els.append(art.text("ثاني أكسيد الكربون", MX, 1830, beat(B, 2, 0.06), font=art.F_SMALL))
    els.append(art.text("نفَس واحد", MX, 2200, beat(B, 2, 0.4), font=art.F_HEAD, color=RED))
    els.append(art.text("من غاز ٣٥٪", MX, 2420, beat(B, 2, 0.62), font=art.F_SMALL, color=INK))
    cam = [(0.0, MX, 1750, 1.0), (0.5, MX - 60, 1700, 1.08), (1.0, MX - 40, 1750, 1.14)]
    return els, cam


# ---------------------------------------------------------------- scene 5 ----
def scene5(B, d):
    els = []
    hs = 2.6
    els += art.head_profile(MX, 1350, hs, beat(B, 0, 0.02), dur=span(B, 0, 0.55))
    a = art.head_anchors(MX, 1350, hs)
    els += art.eye(*a["eye"], 2.1, beat(B, 0, 0.6), dur=span(B, 0, 0.3))
    els += art.mask(a["mouth"][0] + 30, a["mouth"][1] - 10, 2.2, beat(B, 1, 0.02), dur=span(B, 1, 0.35))
    els += art.burst(a["mouth"][0] - 60, a["mouth"][1] - 40, 2.2, beat(B, 1, 0.45), dur=span(B, 1, 0.5))
    els.append(art.text("لا أستطيع التنفس!", MX, 2520, beat(B, 2, 0.05), font=art.F_HEAD, color=RED,
                        dur=max(0.4, span(B, 2, 0.45))))
    els += art.underline(MX - 590, MX + 590, 2695, beat(B, 2, 0.32), color=RED, w=9)
    els.append(art.text("أول خوف في حياتها", MX, 2860, beat(B, 2, 0.55), font=art.F_SMALL))
    cam = [(0.0, MX, 1700, 1.0), (0.4, MX + 60, 1600, 1.14), (1.0, MX + 40, 1650, 1.2)]
    return els, cam


# ---------------------------------------------------------------- scene 6 ----
def scene6(B, d):
    els = []
    els.append(art.text("نتيجة الدراسة", MX, 260, beat(B, 0, 0.04), font=art.F_HEAD))
    els.append(art.text("عام ٢٠١٣", MX, 430, beat(B, 0, 0.3), font=art.F_SMALL, color=GREY))
    bx1, bx2 = MX - 470, MX + 470
    els += art.frame_box(bx1 - 250, 620, bx1 + 250, 1620, beat(B, 0, 0.55), dur=span(B, 0, 0.4), color=GREY_LIGHT)
    els += art.frame_box(bx2 - 250, 620, bx2 + 250, 1620, beat(B, 0, 0.7), dur=span(B, 0, 0.35), color=GREY_LIGHT)
    els.append(art.text("المرضى", bx1, 730, beat(B, 0, 0.8), font=art.F_SMALL))
    els.append(art.text("الأصحاء", bx2, 730, beat(B, 0, 0.9), font=art.F_SMALL))
    # Patients: three of three panic.
    for i in range(3):
        els += art.figure(bx1 - 160 + i * 160, 1330 - i * 8, 1.05, beat(B, 1, 0.04 + 0.1 * i), dur=span(B, 1, 0.16))
    # Comparison: all twelve participants, three of them panic.
    for i in range(12):
        col, row = i % 3, i // 3
        filled = i < 3
        els += art.figure(bx2 - 160 + col * 160, 1120 + row * 210, 0.72,
                          beat(B, 1, 0.42 + 0.035 * i), dur=span(B, 1, 0.1),
                          color=RED if filled else GREY, fill=filled, w=6)
    els.append(art.text("٣ من ٣", bx1, 1780, beat(B, 1, 0.62), font=art.F_HEAD, color=RED))
    els.append(art.text("٣ من ١٢", bx2, 1780, beat(B, 1, 0.8), font=art.F_HEAD, color=RED))
    els += art.underline(bx1 - 200, bx1 + 200, 1940, beat(B, 1, 0.9), color=RED)
    els.append(art.text("نوبة هلع", MX, 2120, beat(B, 2, 0.06), font=art.F_SMALL))
    els.append(art.text("نسبة الهلع عند المرضى أعلى", MX, 2380, beat(B, 2, 0.4), font=art.F_BODY))
    cam = [(0.0, MX, 1750, 1.0), (0.5, MX, 1780, 1.04), (1.0, MX, 1820, 1.1)]
    return els, cam


# ---------------------------------------------------------------- scene 7 ----
def scene7(B, d):
    els = []
    els.append(art.text("مساران للخوف", MX, 260, beat(B, 0, 0.04), font=art.F_HEAD))
    els += art.brain(MX, 2500, 1.2, beat(B, 1, 0.2), dur=span(B, 1, 0.26))
    els += art.amygdala(MX - 20, 2520, 1.5, beat(B, 1, 0.55), dur=span(B, 1, 0.1), color=RED)
    els.append(art.text("اللوزة", MX + 500, 2600, beat(B, 1, 0.68), font=art.F_SMALL, color=RED))
    els.append(Stroke([(MX + 300, 2570), (MX + 160, 2540)], width=6, color=RED,
                      t0=beat(B, 1, 0.78), dur=0.25, taper=(0.2, 0.4)))
    els += art.figure(MX - 470, 900, 1.15, beat(B, 0, 0.15), dur=span(B, 0, 0.3))
    els.append(art.text("خطر الخارج", MX - 470, 1160, beat(B, 0, 0.45), font=art.F_SMALL))
    els += art.arrow(MX - 470, 1250, MX - 160, 2420, beat(B, 0, 0.65), dur=span(B, 0, 0.35), bend=90)
    els += art.molecule(MX + 470, 900, 1.15, beat(B, 1, 0.75), dur=span(B, 1, 0.2), color=RED)
    els.append(art.text("إشارة من الداخل", MX + 470, 1160, beat(B, 2, 0.06), font=art.F_SMALL, color=RED))
    els += art.arrow(MX + 500, 1250, MX + 380, 2920, beat(B, 2, 0.3), dur=span(B, 2, 0.35), bend=-60, color=RED)
    els.append(art.text("مسار أقدم في الجذع", MX + 180, 2940, beat(B, 2, 0.72), font=art.F_SMALL, color=RED))
    cam = [(0.0, MX, 1850, 1.0), (0.45, MX, 2000, 1.02), (1.0, MX, 2050, 1.06)]
    return els, cam


# ---------------------------------------------------------------- scene 8 ----
def scene8(B, d):
    els = []
    els.append(art.text("فمن الذي", MX, 300, beat(B, 0, 0.06), font=art.F_HEAD, color=RED))
    els.append(art.text("يخيفنا حقًّا؟", MX, 560, beat(B, 0, 0.4), font=art.F_HEAD, color=RED))
    els += art.underline(MX - 450, MX + 450, 800, beat(B, 0, 0.8), color=RED, w=9)
    els.append(art.text("نقش", MX, 1600, beat(B, 1, 0.05), font=art.F_LOGO, dur=span(B, 1, 0.5)))
    els.append(art.text("المعرفة تُرسم", MX, 1980, beat(B, 1, 0.62), font=art.F_TAG, color=INK_SOFT))
    els.append(Stroke(smooth_through([(MX - 330, 2080), (MX, 2074), (MX + 330, 2080)], 6),
                      width=7, color=RED, t0=beat(B, 1, 0.82), dur=span(B, 1, 0.18), taper=(0.25, 0.5)))
    cam = [(0.0, MX, 1450, 1.0), (0.45, MX, 1500, 1.02), (1.0, MX, 1500, 1.04)]
    return els, cam


SCENES = [scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8]
