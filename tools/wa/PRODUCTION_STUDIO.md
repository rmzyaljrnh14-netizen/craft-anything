# Whiteboard Production Studio — environment audit and tested pipeline

Audit date: 2026-11-16 (Linux x86_64; Python 3.11.2; Node 22.22.0; npm 10.9.8).

## Environment and tools

### Present and exercised
- **Bundled FFmpeg 9.0.2** (`imageio-ffmpeg`): `libx264`, AAC, libass, `afade`, `amix`, `loudnorm`, `ebur128`, `blackdetect`, `freezedetect`, `xfade`, and `zoompan` are available. Used for the demo encode, subtitle burn-in, audio mix/master, black/freeze scans, and a 1.7-second wipe-transition smoke test; the demo's subtle camera push-in is rendered per-frame in Pillow.
- **svgwrite + svgpathtools**: author SVG paths and reveal each path by arc length on successive frames; the pen hand tracks the currently active path. Used to render `preview/whiteboard_studio_demo.mp4`. No raster illustration, screenshot, image trace, or still-to-video effect is used for the character or chart.
- **Pillow + NumPy**: composition, frame generation, camera push-in, palette handling, original synthetic music and marker SFX. Used in the demo.
- **arabic-reshaper + python-bidi + Noto Naskh Arabic**: Arabic contextual forms and RTL text. Used in headings/captions/subtitles.
- **Arena native Arabic TTS**: generated the spoken demo narration.
- **soundfile + pyloudnorm + PyAV**: WAV handling, voice loudness measurement, stream metadata, frame decoding, silence and motion checks. Used in audio preparation and QC.
- **ImageMagick 6.9.11**, Node/npm, and Rust are present; ImageMagick and Node were audited but not needed for the chosen vector-first render.
- **Arena image generation/search** are exposed but deliberately not used: the requirement is path-drawn animation, not static image assets.

### Not available (not claimed as used)
- No system `ffmpeg` or standalone `ffprobe`. FFmpeg is bundled in the venv; **PyAV** is used for stream metadata/frame inspection instead of claiming FFprobe.
- Blender, DaVinci Resolve, After Effects/aerender, Audacity, SoX, Inkscape/rsvg-convert, Manim, MoviePy, OpenCV, Piper, and Edge TTS are absent from the runtime inventory. No installed local “Skills” directories were found. No dedicated video-generation model/tool is exposed in this session.
- Remotion is discoverable on the npm registry (version 4.0.544 checked), but is not installed: no Chromium/Chrome runtime is present, and a browser render stack is unnecessary for the tested vector-path + FFmpeg workflow. Its package metadata was checked; the package itself was not installed or used.
- The pen hand is a procedural 2D hand illustration, not photographed/live-action footage. The production effect is a real frame-by-frame path reveal with a moving pen tip, not a still image being uncovered.

## Production pipeline and handoffs

1. **Research** — store primary/credible source URLs and a fact ledger; claims in script must map to a source.
2. **Script** — voiceover text split into scenes and breath-friendly narration chunks; create Arabic SRT cues from timed speech.
3. **Storyboard** — JSON stores scene intent, caption timings, stable character IDs, and each authored SVG path with draw start/end, color, width, and description.
4. **Visual/character design** — maintain character IDs and proportions; use a restricted ink palette (charcoal, teal, coral, ochre) and whiteboard-safe zones.
5. **Animation** — SVG geometry is sampled by path length per frame; only the portion behind the pen is visible; a hand follows the pen path. Scene timing is authored against the voiceover. Motion can include camera push-in and scene transitions.
6. **Voiceover/sound** — Arabic TTS WAV, integrated loudness measurement, original synthesized music and marker textures, fade and limiting.
7. **Edit/export** — FFmpeg composition, Arabic subtitles, H.264/AAC, fast-start MP4; transition filters are available and smoke-tested.
8. **QC** — PyAV checks dimensions, fps, codecs, full decode, black/near-empty frames, motion, audio presence/silence, and subtitle timing; FFmpeg black/freeze filters provide independent scans. Human visual review remains required for story/character quality and exact speech-to-drawing meaning.

This is an implemented prototype studio path, not a claim that a full-length production has been run through every stage. The included demo validates the technical path end-to-end.

## Reproduce the tested demo

```sh
.venv-prod/bin/pip install -r tools/wa/requirements-studio.txt
.venv-prod/bin/python tools/wa/studio.py audit
.venv-prod/bin/python tools/wa/studio.py render-demo
.venv-prod/bin/python tools/wa/studio.py qc preview/whiteboard_studio_demo.mp4
.venv-prod/bin/python -m unittest tools.wa.test_studio -v
```

The tested demo is 15 seconds, 1920×1080, 30 fps, H.264/AAC, with four Arabic caption cues and original synthesized audio. Production intermediates/reports are kept in ignored `build/`; the public demo is under `preview/`.
