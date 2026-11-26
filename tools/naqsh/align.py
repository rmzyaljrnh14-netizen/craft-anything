"""Beat alignment: cut each narration clip at its own breathing pauses.

The film is timed by the voice, not by guesses. For every scene we detect the
longest silences inside the narration and use them as beat boundaries, then each
visual beat starts exactly when its line is spoken.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

import assemble

SR = assemble.SR


def load(name: str) -> np.ndarray:
    return assemble.read_wav(Path("build/naqsh/vo_final") / f"{name}.wav")


def silences(a: np.ndarray, min_len=0.16, thresh=0.014):
    env = assemble.envelope(a, 40)
    quiet = env < thresh
    runs, start = [], None
    for k, q in enumerate(quiet):
        if q and start is None:
            start = k
        elif not q and start is not None:
            if (k - start) / SR >= min_len:
                runs.append((start / SR, (k - start) / SR))
            start = None
    if start is not None and (len(quiet) - start) / SR >= min_len:
        runs.append((start / SR, (len(quiet) - start) / SR))
    return runs


def beats_for(a: np.ndarray, n_beats: int) -> list[tuple[float, float]]:
    """Split the clip into ``n_beats`` spans, cutting at the longest pauses."""
    dur = len(a) / SR
    if n_beats <= 1:
        return [(0.0, dur)]
    gaps = [g for g in silences(a) if g[0] > 0.25 and g[0] + g[1] < dur - 0.4]
    gaps.sort(key=lambda g: -g[1])
    cuts = sorted(g[0] + g[1] / 2 for g in gaps[: n_beats - 1])
    # Not enough natural pauses: split the longest span at its quietest moment.
    while len(cuts) < n_beats - 1:
        edges = [0.0] + cuts + [dur]
        spans = [(edges[i + 1] - edges[i], i) for i in range(len(edges) - 1)]
        spans.sort(reverse=True)
        _, i = spans[0]
        lo, hi = edges[i], edges[i + 1]
        mid = (lo + hi) / 2
        cuts = sorted(cuts + [mid])
    edges = [0.0] + cuts + [dur]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
