"""NAQSH STUDIO audio + final assembly.

  * voice: trimmed narration clips joined with natural breathing gaps
  * score: original procedural documentary bed (soft pads, low pulse, reveal
    swells) written from scratch with numpy — no sampled material
  * sfx: marker-on-board texture at every stroke start, soft sub-drop on the
    reveal beats
  * mix: voice first, gentle ducking, limiter, cinema fade

Run after render.py has written build/naqsh/frames.
"""
from __future__ import annotations

import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build" / "naqsh"
OUT = ROOT / "output" / "naqsh"
SR = 48000
FPS = 30


def ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    assert sw == 2, path
    a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if sr != SR:
        # Linear resample; the source is already 48 kHz in this pipeline.
        idx = np.linspace(0, len(a) - 1, int(len(a) * SR / sr))
        a = np.interp(idx, np.arange(len(a)), a).astype(np.float32)
    return a


def trim_silence(a: np.ndarray, thresh=0.006, pad=0.06) -> np.ndarray:
    idx = np.where(np.abs(a) > thresh)[0]
    if len(idx) == 0:
        return a
    start = max(0, idx[0] - int(pad * SR))
    end = min(len(a), idx[-1] + int(pad * SR))
    return a[start:end]


def build_voice(names, gap=0.22):
    clips = [trim_silence(read_wav(BUILD / "vo_final" / f"{n}.wav")) for n in names]
    parts, offsets, cur = [], [], 0
    for i, c in enumerate(clips):
        parts.append(c)
        offsets.append(cur)
        cur += len(c)
        if i < len(clips) - 1:
            g = np.zeros(int(gap * SR), dtype=np.float32)
            parts.append(g)
            cur += len(g)
    voice = np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32)
    # Gentle levelling: aim for a consistent loudness without squashing dynamics.
    rms = np.sqrt(np.mean(voice**2)) + 1e-9
    target = 0.11
    gain = min(4.0, target / rms)
    voice = np.tanh(voice * gain * 1.05) / 1.05
    return voice, offsets, [len(c) / SR for c in clips]


def envelope(a: np.ndarray, ms=60) -> np.ndarray:
    k = max(1, int(SR * ms / 1000))
    ker = np.ones(k, dtype=np.float32) / k
    return np.convolve(np.abs(a), ker, mode="same")


def score(total: float, reveal_times, mood_curve=None) -> np.ndarray:
    n = int(total * SR)
    t = np.arange(n, dtype=np.float32) / SR
    out = np.zeros(n, dtype=np.float32)
    # Chord bed: D minor colour, slow 9s cycles, low level.
    chords = [(146.83, 174.61, 220.00), (130.81, 164.81, 196.00),
              (116.54, 146.83, 174.61), (98.00, 130.81, 164.81)]
    cycle = 9.0
    for i, (a, b, c) in enumerate(chords):
        start = i * cycle
        for k in range(int(math.ceil((total - start) / (cycle * len(chords)))) + 1):
            t0 = start + k * cycle * len(chords)
            if t0 > total:
                break
            seg = slice(int(t0 * SR), min(n, int((t0 + cycle) / SR * SR)))
            tt = t[seg] - t0
            if len(tt) == 0:
                continue
            env = np.minimum(1, tt / 2.2) * np.minimum(1, np.maximum(0, (cycle - tt) / 2.6))
            pad = (np.sin(2 * np.pi * a * tt) + 0.85 * np.sin(2 * np.pi * b * tt)
                   + 0.6 * np.sin(2 * np.pi * c * tt) + 0.22 * np.sin(2 * np.pi * c * 2 * tt))
            out[seg] += (pad * env * 0.014).astype(np.float32)
    # Sub pulse: one soft heartbeat every 4 beats, very low.
    beat = 60 / 72
    for k in range(int(total / beat) + 1):
        t0 = k * beat
        seg = slice(int(t0 * SR), min(n, int((t0 + 0.9) / SR * SR)))
        tt = t[seg] - t0
        if len(tt) == 0:
            continue
        env = np.exp(-tt * 5.5)
        out[seg] += (np.sin(2 * np.pi * 55 * tt) * env * 0.035).astype(np.float32)
    # Reveal swells: filtered noise rising into each reveal, then silence.
    rng = np.random.default_rng(4242)
    for rt in reveal_times:
        seg = slice(max(0, int((rt - 0.9) * SR)), min(n, int((rt + 0.35) / SR * SR)))
        tt = t[seg] - (rt - 0.9)
        if len(tt) == 0:
            continue
        noise = rng.normal(0, 1, len(tt)).astype(np.float32)
        # one-pole lowpass for a soft airy swell
        alpha = 0.06
        sm = np.empty_like(noise)
        acc = 0.0
        for i in range(len(noise)):
            acc += alpha * (noise[i] - acc)
            sm[i] = acc
        env = np.clip(tt / 0.9, 0, 1) ** 2 * np.exp(-np.maximum(0, tt - 0.9) * 6)
        out[seg] += sm * env * 0.5
    return out


def marker_sfx(total: float, times) -> np.ndarray:
    n = int(total * SR)
    out = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(90210)
    L = int(0.16 * SR)
    base = rng.normal(0, 1, L).astype(np.float32)
    # Paper/marker: band-limited noise with a fast attack and quick decay.
    sm = np.empty_like(base)
    acc = 0.0
    for i in range(L):
        acc += 0.35 * (base[i] - acc)
        sm[i] = acc
    env = np.exp(-np.linspace(0, 5, L)) * np.minimum(1, np.linspace(0, 12, L))
    kernel = (sm * env)
    kernel *= 0.09 / (np.max(np.abs(kernel)) + 1e-9)
    for tm in times:
        p = int(tm * SR)
        if p >= n:
            continue
        seg = kernel[: max(0, min(L, n - p))]
        out[p:p + len(seg)] += seg * rng.uniform(0.55, 1.0)
    return out


def write_stereo(path: Path, mono: np.ndarray, width=0.0):
    a = np.clip(mono, -1.0, 1.0)
    left = a
    right = a
    if width:
        d = int(0.006 * SR)
        right = np.concatenate([np.zeros(d, dtype=np.float32), a[:-d]])
        right = (1 - width) * a + width * right
    stereo = np.column_stack([left, right])
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())


def build_audio(names, sfx_times, reveal_times):
    voice, offsets, lens = build_voice(names)
    total = len(voice) / SR + 0.9
    voice_p = np.zeros(int(total * SR), dtype=np.float32)
    voice_p[: len(voice)] = voice
    # Duck the bed under the voice with a smooth follower.
    envv = envelope(voice_p, 120)
    duck = 1.0 / (1.0 + 6.0 * np.clip(envv / 0.05, 0, 1))
    bed = score(total, reveal_times) * (0.45 + 0.55 * duck)
    fx = marker_sfx(total, sfx_times)
    mix = voice_p * 1.0 + bed * 1.0 + fx * 1.0
    # Fades and soft limiter.
    fade_in = int(0.35 * SR)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(1.4 * SR)
    mix[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.4
    peak = np.max(np.abs(mix)) + 1e-9
    mix *= min(1.0, 0.92 / peak)
    out = OUT / "audio"
    out.mkdir(parents=True, exist_ok=True)
    write_stereo(out / "voice.wav", voice_p, width=0.0)
    write_stereo(out / "bed.wav", bed)
    write_stereo(out / "sfx.wav", fx)
    write_stereo(out / "mix.wav", mix, width=0.12)
    return total, lens, offsets


def mux(durations, names="final", frames_dir=None):
    audio = OUT / "audio" / "mix.wav"
    final = OUT / f"Naqsh_{names}.mp4"
    frames_dir = frames_dir or (BUILD / "frames_aligned")
    cmd = [ffmpeg(), "-y", "-framerate", str(FPS), "-i", str(Path(frames_dir) / "f%05d.png"),
           "-i", str(audio), "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "224k", "-ar", "48000", "-ac", "2",
           "-movflags", "+faststart", "-shortest", str(final)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-4000:])
    return final


if __name__ == "__main__":
    meta = json.loads((BUILD / "sfx.json").read_text())
    total, lens, offsets = build_audio(meta["names"], meta["sfx"], meta["reveals"])
    print("audio total:", round(total, 2), "scene lens:", [round(x, 2) for x in lens])
    print(mux(lens))
