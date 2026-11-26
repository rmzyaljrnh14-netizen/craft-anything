"""NAQSH STUDIO renderer: whiteboard film, 1080x1920, 30 fps.

Design notes
  * The master canvas is 2160x3840 (2x supersample). Each scene keeps ONE
    persistent canvas: ink already drawn stays on it, new strokes are added
    incrementally, so a frame costs a camera crop + hand composite, not a redraw.
  * The camera is keyframed per scene and always crops the master 9:16.
  * The illustrated marker hand follows the live ink tip of whatever is being
    drawn at that instant, and disappears while no element is active.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image

import align
import art
import ink
import scenes as SC
from ink import Camera, CW, CH, W, H, paper_background, draw_hand, ease_out, brush_wipe, brush_edge

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build" / "naqsh"
OUT = ROOT / "output" / "naqsh"
FPS = 30
HAND_H = 760


def ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def wav_duration(path: Path) -> float:
    import wave
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def scene_beats(idx: int, vo: str | None = None) -> list[tuple[float, float]]:
    name = f"v{idx + 1}"
    if vo and Path(vo).exists():
        import wave
        p = Path(vo) / f"{name}.wav"
        with wave.open(str(p), "rb") as w:
            data = assemble_read(p)
        return align.beats_for(data, 3)
    return align.beats_for(align.load(name), 3)


def assemble_read(p: Path):
    import wave
    import numpy as _np
    with wave.open(str(p), "rb") as w:
        n, ch = w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = _np.frombuffer(raw, dtype="<i2").astype(_np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a


def scene_keys(idx: int, dur: float, beats=None):
    beats = beats or scene_beats(idx)
    els, keys = SC.SCENES[idx](beats, dur)
    kf = [(t * dur if t <= 1.0 else t, x, y, z) for t, x, y, z in keys]
    cam = Camera(kf)
    ordered = sorted(els, key=lambda e: e.t0)
    return ordered, cam


def render_scene_frames(idx: int, dur: float, fps=FPS, sink=None, beats=None):
    """Render one scene; ``sink(i, PIL.Image)`` receives each frame."""
    els, cam = scene_keys(idx, dur, beats)
    canvas = paper_background().convert("RGB")
    n = max(2, int(round(dur * fps)))
    # Clamp camera keyframes to the real scene length.
    dur_eff = n / fps
    cam.keys = [((min(t, dur_eff)), x, y, z) for t, x, y, z in cam.keys]
    for i in range(n):
        t = i / fps
        for e in els:
            if t >= e.t0:
                e.draw(canvas, t)
        frame = cam.render(canvas, t)
        tip = None
        for e in els:
            if e.active(t):
                p = e.tip(t)
                if p:
                    tip = p
        if tip:
            sx, sy = cam.project(t, tip)
            alpha = 1.0
            if t < 0.25:
                alpha = ease_out(t / 0.25)
            draw_hand(frame, sx, sy, HAND_H, alpha=alpha)
        if sink:
            sink(i, frame)
    return n


def render_all(durations, out_dir: Path, fps=FPS):
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    t0 = time.time()
    prev_last = None
    WIPE = 7
    for idx, dur in enumerate(durations):
        state = {"last": None}

        def sink(i, im, base=total, first=(idx > 0), prev=prev_last):
            frame = im
            if prev is not None and i < WIPE:
                # Hand-brush wipe: the new board is revealed top-down behind a
                # ragged brush edge, so every board keeps its marker hand.
                p = (i + 1) / (WIPE + 2)
                frame = brush_wipe(im, p, previous=prev)
                # The marker hand travels with the sweeping edge.
                hx = W * (0.25 + 0.5 * p)
                draw_hand(frame, hx, brush_edge(p, hx), HAND_H)
            frame.save(out_dir / f"f{base + i:05d}.png", compress_level=1)
            state["last"] = frame

        n = render_scene_frames(idx, dur, fps, sink)
        prev_last = state["last"]
        print(f"scene {idx + 1}/{len(durations)}: {n} frames, {time.time() - t0:.0f}s elapsed", flush=True)
        total += n
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", type=int, default=None, help="render one scene index (0-based)")
    ap.add_argument("--at", type=float, nargs="*", default=None, help="preview timestamps for --scene")
    args = ap.parse_args()

    dpath = BUILD / "vo_final" / "durations.json"
    durations = json.loads(dpath.read_text()) if dpath.exists() else [8.0] * 8

    if args.scene is not None:
        if args.at:
            els, cam = scene_keys(args.scene, durations[args.scene])
            canvas = paper_background().convert("RGB")
            prev = ROOT / "build" / "naqsh" / "preview"
            prev.mkdir(parents=True, exist_ok=True)
            for ts in args.at:
                for e in els:
                    if e.t0 <= ts <= e.t0 + e.dur:
                        e.draw(canvas, ts)
                fr = cam.render(canvas, ts)
                tip = None
                for e in els:
                    if e.active(ts):
                        p = e.tip(ts)
                        if p:
                            tip = p
                if tip:
                    draw_hand(fr, *cam.project(ts, tip), HAND_H)
                p = prev / f"s{args.scene + 1}_{ts:05.2f}.png"
                fr.save(p)
                print(p)
            return
        dur = durations[args.scene]
        n = render_scene_frames(args.scene, dur)
        print("frames:", n)
        return

    total = render_all(durations, BUILD / "frames")
    print("total frames:", total)


if __name__ == "__main__":
    main()
