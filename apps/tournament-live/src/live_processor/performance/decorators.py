from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar

from .tracker import PerformanceTracker

F = TypeVar("F", bound=Callable[..., Any])


def tracked(tracker: PerformanceTracker, name: str | None = None) -> Callable[[F], F]:
    def decorator(func: F) -> F:
        function_name = name or f"{func.__module__}.{func.__qualname__}"

        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with tracker.track(function_name):
                return func(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator
