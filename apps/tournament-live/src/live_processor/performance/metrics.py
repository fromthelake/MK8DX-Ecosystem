from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100.0) * (len(ordered) - 1))))
    return ordered[index]


@dataclass
class FunctionStats:
    name: str
    call_count: int = 0
    exception_count: int = 0
    total_wall_time: float = 0.0
    timings: list[float] = field(default_factory=list)

    def record(self, duration: float, exception: bool = False) -> None:
        self.call_count += 1
        self.total_wall_time += duration
        self.timings.append(duration)
        if exception:
            self.exception_count += 1

    @property
    def average_wall_time(self) -> float:
        return self.total_wall_time / self.call_count if self.call_count else 0.0

    def as_dict(self) -> dict[str, float | int | str]:
        values = self.timings
        return {
            "function": self.name,
            "call_count": self.call_count,
            "exception_count": self.exception_count,
            "total_wall_time": self.total_wall_time,
            "average_wall_time": self.average_wall_time,
            "minimum_wall_time": min(values) if values else 0.0,
            "maximum_wall_time": max(values) if values else 0.0,
            "p50_wall_time": median(values) if values else 0.0,
            "p95_wall_time": percentile(values, 95),
            "p99_wall_time": percentile(values, 99),
        }
