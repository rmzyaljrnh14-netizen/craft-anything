# Arabic whiteboard video tools

This directory contains the procedural Arabic whiteboard video renderer and muxer used for the compound-habits production.

## Runtime inputs

The scripts expect the production workspace at the repository root:

- `.venv-prod/` with Pillow, NumPy, `imageio-ffmpeg`, `arabic-reshaper`, and `python-bidi`
- `assets/fonts/NotoNaskhArabic.ttf` and `assets/fonts/DMSans-Regular.ttf`
- The eight narration WAVs at `build/vo/scene01.wav` through `scene08.wav`
- The Arabic script at `build/script/05_Script.txt`

Fonts, rendered assets, and deliverables are deliberately ignored by Git. Provide the appropriately licensed fonts and locally generated narration before running the pipeline.

## Run

From the repository root:

```sh
.venv-prod/bin/python tools/wa/thumbnail.py
.venv-prod/bin/python tools/wa/render.py build/render/boards.mp4
.venv-prod/bin/python tools/wa/assemble.py
```

`render.py` writes a 10-fps intermediate with progressive whiteboard reveals and an illustrated marker hand. `assemble.py` builds the concatenated voice track, original synthesized music and marker texture, SRT/ASS captions, and the final 1920×1080, 30-fps H.264/AAC MP4. Outputs go under the ignored `build/` and `output/` directories.
