# Whiteboard test references and assets

## User storyboard: overthinking before sleep

- `overthinking_panel_00.png` — cropped first panel (0:00–0:10) from the user-provided storyboard; shown briefly as a visual reference.
- `overthinking_art_voice.wav` and `overthinking_title_voice.wav` — Arabic narration segments used in the sample.
- `../overthinking_drawing_sample.mp4` — an 11.5-second, 1920×1080, 30 fps sample. It redraws the worried young man, supporting hand, thought cloud, scribble, and moon as 70 authored SVG pen strokes, then reveals the Arabic title right-to-left. Arabic captions are burned into the picture and also included as an SRT sidecar; narration and a light music bed are mixed into the video. The storyboard image is neither traced nor revealed as the drawing. The writing hand is a still cursor cutout animated along the paths, not live-action footage.

Rebuild after installing `tools/wa/requirements-overthinking-sample.txt` and ensuring `assets/fonts/NotoNaskhArabic.ttf` is present:

```sh
.venv-prod/bin/python tools/wa/overthinking_drawing_sample.py
```

This sample uses only the storyboard's first panel; it is not the full 2:30 storyboard.

## Earlier sprout reference-draw experiment

- `sprout_growth_reference.png` — AI-generated visual reference used in an earlier test.
- `whiteboard_hand_cursor_reference.png` — generated writing-hand cursor used by both tests; it is a still cutout, not live-action footage.
- `../whiteboard_reference_draw_test.mp4` — a 9.5-second, 1920×1080, 30 fps test montage with 81 authored SVG pen strokes.
