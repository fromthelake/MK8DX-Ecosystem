"""Print the CELL_RUNS of `mk8dx_tournament_extraction.cup_final` from Clean Assets 065_lan_score_frame.png.

    .venv\\Scripts\\python.exe tooling/tournament/cup_final_cells.py "<Clean Assets>/images/hud/templates/065_lan_score_frame.png"

A cell of the 64x36 grid counts when the template's alpha covers at least 97% of it. The class badge (top left,
x < 8 and y < 7 cells) is left out because it differs per class.
"""
from __future__ import annotations

import sys

import cv2
import numpy as np

GRID = (64, 36)


def cell_runs(path: str) -> list[tuple[int, int, int]]:
    template = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    coverage = cv2.resize((template[:, :, 3] > 0).astype(np.float32), GRID, interpolation=cv2.INTER_AREA)
    runs = []
    for y in range(GRID[1]):
        x = 0
        while x < GRID[0]:
            if coverage[y, x] >= 0.97 and not (x < 8 and y < 7):
                start = x
                while x < GRID[0] and coverage[y, x] >= 0.97:
                    x += 1
                runs.append((y, start, x))
            else:
                x += 1
    return runs


if __name__ == "__main__":
    print(cell_runs(sys.argv[1]))
