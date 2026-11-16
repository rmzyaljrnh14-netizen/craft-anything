# Arabic Whiteboard Animation Studio

`studio.py` is the current production path. It accepts a timed JSON storyboard with vector paths, reveals those strokes frame-by-frame, moves a marker hand along the active path, burns Arabic captions, mixes narration with original synthesized audio, exports MP4, and runs automated quality checks.

## Runtime inputs

- Python venv `.venv-prod/`; install `tools/wa/requirements-studio.txt`
- Licensed local Arabic font at `assets/fonts/NotoNaskhArabic.ttf`
- Narration supplied as WAV (for the demo, `build/vo/character_preview.wav`)

Fonts, voice clips, and generated production media are ignored by Git. The Arena speech tool is the current Arabic narration source; its service is not a Python package.

## Commands (from repository root)

```sh
.venv-prod/bin/python tools/wa/studio.py audit
.venv-prod/bin/python tools/wa/studio.py render-demo
.venv-prod/bin/python tools/wa/studio.py qc preview/whiteboard_studio_demo.mp4
```

The demo storyboard is `tools/wa/projects/whiteboard_studio_demo.json`. Its illustrations are SVG path data authored as strokes, not a raster image or image trace. The current export is 15 seconds, 1920×1080, 30 fps, H.264/AAC. `PyAV` performs stream and frame checks because a standalone `ffprobe` binary is not installed; FFmpeg performs encoding and black-frame scanning.

`render.py`/`assemble.py` remain as the earlier v1 renderer and are retained for reproducibility of the first prototype. For new work use `studio.py`.
