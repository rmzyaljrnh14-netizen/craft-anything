# Whiteboard reference-draw test assets

- `sprout_growth_reference.png` — AI-generated visual reference used only as a short opening shot and a guide for the original illustration.
- `whiteboard_hand_cursor_reference.png` — AI-generated isolated cursor reference, background-keyed and animated separately as a writing hand.
- `../whiteboard_reference_draw_test.mp4` — a 9.5-second, 1920×1080, 30 fps test montage. It opens on the reference image, dissolves to a whiteboard, and progressively draws 81 independently authored SVG pen strokes; it is not a raster reveal or automatic image trace.

Rebuild the test with the repository's production virtualenv and local Arabic font available:

```sh
.venv-prod/bin/python tools/wa/reference_draw_montage.py
```
