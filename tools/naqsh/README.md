# NAQSH STUDIO — محرك إنتاج الفيديو الوثائقي

`NAQSH STUDIO` pipeline for vertical documentary shorts: Arabic typesetting with
HarfBuzz/FreeType, a procedural whiteboard ink engine, a keyframed camera, an
illustrated marker hand, procedural score, and a final H.264/AAC mux.

## Modules

| File | Role |
|------|------|
| `shape.py` | Arabic shaping (HarfBuzz + FreeType), bidi-lite run ordering, glyph reveal plates |
| `ink.py` | tapered ink strokes, washes, dots, hand-written text, camera, marker hand, brush wipes |
| `art.py` | the drawing library: profile portrait, brain, amygdala, snake, spider, ECG, figures |
| `scenes.py` | the eight scenes, each timed against narration beats |
| `align.py` | detects breathing pauses in each clip and turns them into beats |
| `render.py` | frame renderer (2x master canvas -> 1080x1920) |
| `assemble.py` | voice joining, procedural score, marker SFX, ducking, limiter, mux |
| `build.py` | one command end-to-end build |

## Run

```sh
# narration clips: build/naqsh/vo_tight/v1.wav … v8.wav
.venv-prod/bin/python tools/naqsh/build.py --vo build/naqsh/vo_tight --gap 0.20 --out Naqsh_Shorts_55s
```

Fonts are not committed (`assets/fonts/*.ttf` is ignored); place
`NotoNaskhArabic-Bold.ttf` and `DMSans-Bold.ttf` there. Arabic text renders
correctly only through `shape.py` — Pillow in this environment has no Raqm.
