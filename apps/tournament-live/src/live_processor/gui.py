from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from typing import Any


@dataclass
class GuiSnapshot:
    stream_id: str
    frame_index: int
    timestamp: float
    state: str
    race_count: int
    detection_count: int
    ocr_success_count: int
    ocr_failure_count: int
    scoreboard_update_count: int


class LiveDebugGui:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("MK8DX Live Processor Debug View")
        self.image_label = tk.Label(self.root)
        self.image_label.pack(fill=tk.BOTH, expand=True)
        self.status = tk.StringVar(value="Starting...")
        tk.Label(self.root, textvariable=self.status, anchor="w", justify="left", font=("Consolas", 10)).pack(
            fill=tk.X
        )
        self._photo: tk.PhotoImage | None = None
        self.root.update()

    def update_frame(self, frame: Any, snapshot: GuiSnapshot) -> None:
        self._photo = tk.PhotoImage(data=frame_to_ppm(frame))
        self.image_label.configure(image=self._photo)
        self.status.set(
            "\n".join(
                [
                    f"Stream: {snapshot.stream_id}",
                    f"Frame: {snapshot.frame_index}  Timestamp: {snapshot.timestamp:.2f}s",
                    f"State: {snapshot.state}",
                    f"Races: {snapshot.race_count}  Candidates: {snapshot.detection_count}",
                    f"OCR success/fail: {snapshot.ocr_success_count}/{snapshot.ocr_failure_count}",
                    f"Scoreboard updates: {snapshot.scoreboard_update_count}",
                ]
            )
        )
        self.root.update_idletasks()
        self.root.update()

    def close(self) -> None:
        self.root.destroy()


def frame_to_ppm(frame: Any, max_width: int = 960) -> bytes:
    import cv2  # type: ignore

    height, width = frame.shape[:2]
    if width > max_width:
        scale = max_width / width
        frame = cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    return b"P6\n%d %d\n255\n" % (w, h) + rgb.tobytes()
