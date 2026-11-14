"""One EasyOCR reader per language set and device in this process.

Every Tournament reader (the recorded engine's track, name and digit readers, Tournament Live's row and
track readers and its warm-up) takes its reader here, so a language set that two of them use is loaded
once. A reader takes 1-2 s and about 100-400 MiB to load; the readers are kept for the process lifetime.

The key is the language tuple (in the caller's order, which EasyOCR keeps) and the device the reader
actually runs on: ``gpu=True`` on a machine without CUDA/MPS loads a CPU reader, the same one a
``gpu=False`` caller gets. A reader is created under its own creation lock, so a slow load never blocks a
caller that wants another reader. ``run_lock`` is the reader's lock for callers that serialize their reads.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Iterable

Factory = Callable[[list[str], bool], Any]

_LOCK = threading.Lock()
_READERS: dict[tuple[tuple[str, ...], str], Any] = {}
_CREATION_LOCKS: dict[tuple[tuple[str, ...], str], threading.Lock] = {}
_RUN_LOCKS: dict[tuple[tuple[str, ...], str], threading.Lock] = {}
_CREATED: list[tuple[tuple[str, ...], str]] = []


def device(gpu: bool) -> str:
    """The device EasyOCR (1.7) picks for ``gpu``: CUDA, else MPS, else the CPU."""
    if not gpu:
        return "cpu"
    try:
        import torch  # type: ignore
    except Exception:
        return "cpu"
    try:
        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(getattr(torch, "backends", None), "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def reader_key(languages: Iterable[str], gpu: bool) -> tuple[tuple[str, ...], str]:
    return tuple(str(language) for language in languages), device(bool(gpu))


def _easyocr_factory(languages: list[str], gpu: bool) -> Any:
    import easyocr  # type: ignore

    return easyocr.Reader(languages, gpu=gpu, verbose=False)


def optimize_reader(reader: Any) -> dict[str, Any]:
    """Compact the recognizer's RNN weights once (``flatten_parameters``) so PyTorch does not do it on every
    call. Runtime layout only: the weights and the readings are unchanged."""
    optimized = 0
    errors: list[str] = []
    seen: set[int] = set()

    def visit(obj: Any, depth: int = 0) -> None:
        nonlocal optimized
        if obj is None or depth > 5 or id(obj) in seen:
            return
        seen.add(id(obj))
        flatten = getattr(obj, "flatten_parameters", None)
        if callable(flatten):
            try:
                flatten()
                optimized += 1
            except Exception as exc:  # pragma: no cover - best-effort runtime tuning
                errors.append(f"{type(obj).__name__}: {exc}")
        modules = getattr(obj, "modules", None)
        if callable(modules):
            try:
                for module in modules():
                    if module is not obj:
                        visit(module, depth + 1)
            except Exception as exc:  # pragma: no cover
                errors.append(f"{type(obj).__name__}.modules: {exc}")
        if depth >= 2:
            return
        for attr in ("recognizer", "detector", "model", "module", "net", "converter"):
            try:
                child = getattr(obj, attr, None)
            except Exception:  # pragma: no cover
                continue
            if child is not None:
                visit(child, depth + 1)

    visit(reader)
    return {"flattened_rnn_modules": optimized, "errors": errors[:10]}


def shared_reader(languages: Iterable[str], *, gpu: bool, factory: Factory | None = None,
                  on_create: Callable[[tuple[str, ...], str], None] | None = None) -> Any:
    """The process's reader for ``languages`` on the device ``gpu`` resolves to; created on first use.

    ``on_create(languages, device)`` runs once, before the reader is created (for runtime reports)."""
    key = reader_key(languages, gpu)
    reader = _READERS.get(key)
    if reader is not None:
        return reader
    with _LOCK:
        creation = _CREATION_LOCKS.setdefault(key, threading.Lock())
    with creation:
        reader = _READERS.get(key)
        if reader is None:
            if on_create is not None:
                on_create(*key)
            reader = (factory or _easyocr_factory)(list(key[0]), bool(gpu))
            optimize_reader(reader)
            with _LOCK:
                _READERS[key] = reader
                _CREATED.append(key)
    return reader


def run_lock(languages: Iterable[str], *, gpu: bool) -> threading.Lock:
    """The lock that serializes reads of one shared reader."""
    key = reader_key(languages, gpu)
    lock = _RUN_LOCKS.get(key)
    if lock is None:
        with _LOCK:
            lock = _RUN_LOCKS.setdefault(key, threading.Lock())
    return lock


def created() -> list[tuple[tuple[str, ...], str]]:
    """Every reader this process created, in order (diagnostics and tests)."""
    with _LOCK:
        return list(_CREATED)


def clear() -> None:
    """Forget every reader (tests)."""
    with _LOCK:
        _READERS.clear()
        _CREATION_LOCKS.clear()
        _RUN_LOCKS.clear()
        _CREATED.clear()
