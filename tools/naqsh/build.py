"""End-to-end NAQSH build: audio bed -> frames -> aligned frames -> final MP4.

    .venv-prod/bin/python tools/naqsh/build.py --vo build/naqsh/vo_tight --gap 0.20 --out Naqsh_shorts

Steps
 1. read narration durations from the chosen voice folder
 2. compute marker-SFX cues and reveal beats from the same timeline
 3. render every scene (persistent canvas, camera, marker hand, brush wipes)
 4. duplicate the last frame of each scene across the breath gap so picture and
    voice stay locked
 5. build voice + procedural score + SFX mix, then mux the final H.264/AAC file
"""
from __future__ import annotations

import argparse
import json
import shutil
import wave
from pathlib import Path

import numpy as np

import assemble
import ink
import render


def wav_dur(p: Path) -> float:
    with wave.open(str(p), "rb") as w:
        return w.getnframes() / w.getframerate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vo", default="build/naqsh/vo_tight")
    ap.add_argument("--gap", type=float, default=0.20)
    ap.add_argument("--out", default="Naqsh_shorts")
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    vo = Path(args.vo)
    names = [f"v{i}" for i in range(1, 9)]
    durs = [wav_dur(vo / f"{n}.wav") for n in names]
    gap = args.gap
    render.BUILD = Path("build/naqsh")
    align_dir = render.BUILD / "frames"
    aligned = render.BUILD / "frames_aligned"

    # 1-2: timeline + cues
    starts, cur = [], 0.0
    for d in durs:
        starts.append(cur)
        cur += d + gap

    sfx, reveals = [], []
    for i, (d, st) in enumerate(zip(durs, starts)):
        els, cam = render.scene_keys(i, d, beats=render.scene_beats(i, vo=str(vo)))
        for e in els:
            if isinstance(e, (ink.Stroke, ink.Handwritten)) and e.t0 < d:
                sfx.append(round(st + e.t0, 3))
        reveals.append(round(st + 0.62 * d, 2))
    jsfx = sorted(set(sfx))
    (render.BUILD / "sfx.json").write_text(json.dumps(
        {"names": names, "sfx": jsfx, "reveals": reveals, "starts": starts,
         "durations": durs, "gap": gap}))

    # 3: frames
    if not args.skip_render:
        shutil.rmtree(align_dir, ignore_errors=True)
        align_dir.mkdir(parents=True)
        total = 0
        for i, d in enumerate(durs):
            beats = render.scene_beats(i, vo=str(vo))

            def sink(k, im, base=total):
                im.save(align_dir / f"f{base + k:05d}.png", compress_level=1)

            n = render.render_scene_frames(i, d, sink=sink, beats=beats)
            print(f"scene {i+1}/8: {n} frames", flush=True)
            total += n
    counts = []
    files = sorted(align_dir.glob("f*.png"))
    counts.append(len(files))
    # Scene frame counts from the renderer.
    rendered = [max(2, int(round(d * render.FPS))) for d in durs]

    # 4: align frames to the voice timeline
    shutil.rmtree(aligned, ignore_errors=True)
    aligned.mkdir(parents=True)
    total_audio = sum(durs) + gap * (len(durs) - 1) + 0.9
    total_frames = int(round(total_audio * render.FPS))
    idx = src = 0
    for c, d, st in zip(rendered, durs, starts):
        end = int(round((st + d + gap) * render.FPS))
        end = min(end, total_frames)
        start = int(round(st * render.FPS))
        n = max(1, end - start)
        last = None
        for k in range(n):
            s = src + min(k, c - 1)
            p = align_dir / f"f{s:05d}.png"
            if k < c:
                shutil.copy(p, aligned / f"f{idx:05d}.png")
                last = p
            elif last is not None:
                shutil.copy(last, aligned / f"f{idx:05d}.png")
            idx += 1
        src += c
    while idx < total_frames:
        shutil.copy(align_dir / f"f{src-1:05d}.png", aligned / f"f{idx:05d}.png")
        idx += 1
    print("aligned frames:", idx, "audio tail:", round(total_audio, 2))

    # 5: audio + mux
    total, lens, offsets = assemble.build_audio(names, jsfx, reveals)
    final = assemble.mux(lens, names=args.out)
    print("FINAL", final)


if __name__ == "__main__":
    main()
