# Whiteboard test references and assets

## User storyboard: overthinking before sleep

- `overthinking_panel_00.png` — cropped first panel (0:00–0:10) from the user-provided storyboard; shown briefly as the drawing reference.
- `overthinking_voiceover.wav` — Arabic narration generated for this opening sample.
- `../overthinking_drawing_sample.mp4` — an 11.5-second 1080p/30 fps edit. It opens on the supplied panel, then redraws the moon, thought cloud, scribble, and worried character as 49 authored SVG strokes; the large Arabic title is written right-to-left with the moving pen cursor. Arabic narration and a light music bed are mixed in; timed captions are provided separately as SRT. The source panel is not image-traced or revealed as the drawing.

Rebuild this sample after installing `tools/wa/requirements-overthinking-sample.txt` and ensuring `assets/fonts/NotoNaskhArabic.ttf` is available:

```sh
.venv-prod/bin/python tools/wa/overthinking_drawing_sample.py
```

## Earlier sprout reference-draw experiment

- `sprout_growth_reference.png` — AI-generated visual reference used in an earlier test.
- `whiteboard_hand_cursor_reference.png` — generated writing-hand cursor used by both tests; it is a still cutout, not live-action footage.
- `../whiteboard_reference_draw_test.mp4` — a 9.5-second, 1920×1080, 30 fps test montage with 81 authored SVG pen strokes.
