from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


def torch_cuda_status() -> dict[str, Any]:
    """Return the live OCR CUDA status without requiring callers to import torch."""

    try:
        import torch  # type: ignore
    except Exception as exc:
        return {
            "torch_importable": False,
            "torch_version": "",
            "cuda_available": False,
            "cuda_device_count": 0,
            "cuda_device_name": "",
            "cuda_version": "",
            "error": f"{type(exc).__name__}: {exc}",
        }
    cuda_available = bool(torch.cuda.is_available())
    device_count = int(torch.cuda.device_count()) if cuda_available else int(torch.cuda.device_count())
    return {
        "torch_importable": True,
        "torch_version": str(getattr(torch, "__version__", "")),
        "cuda_available": cuda_available,
        "cuda_device_count": device_count,
        "cuda_device_name": torch.cuda.get_device_name(0) if cuda_available and device_count else "",
        "cuda_version": str(getattr(torch.version, "cuda", "") or ""),
        "error": "",
    }


def easyocr_gpu_requested() -> bool:
    value = os.environ.get("MK8_EASYOCR_GPU")
    if value is not None:
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return True


def write_ocr_runtime_report(context: str, *, gpu_requested: bool, languages: list[str] | tuple[str, ...]) -> dict[str, Any]:
    status = torch_cuda_status()
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "context": context,
        "languages": list(languages),
        "easyocr_gpu_requested": bool(gpu_requested),
        "easyocr_expected_cuda": bool(gpu_requested and status.get("cuda_available")),
        "warning": "",
        **status,
    }
    if gpu_requested and not status.get("cuda_available"):
        payload["warning"] = "OCR_CPU_FALLBACK"
    elif not gpu_requested and status.get("cuda_available"):
        payload["warning"] = "OCR_CUDA_NOT_USED"
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    safe_context = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in context)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / f"ocr_runtime_{safe_context}.json")
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    latest = assert_write_allowed(DIAGNOSTICS_ROOT / "ocr_runtime_latest.json")
    latest.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return payload


def optimize_easyocr_reader(reader: Any) -> dict[str, Any]:
    """Apply safe runtime optimizations to an EasyOCR reader.

    PyTorch can warn that RNN/LSTM weights are not contiguous, which causes it to
    compact weights at every call. EasyOCR does not expose a public hook for this,
    so we walk the reader object and call ``flatten_parameters`` on RNN-like
    modules when the method exists. This changes runtime layout only; it does not
    alter OCR model weights or recognition behavior.
    """

    optimized = 0
    errors: list[str] = []
    seen: set[int] = set()

    def visit(obj: Any, depth: int = 0) -> None:
        nonlocal optimized
        if obj is None or depth > 5:
            return
        obj_id = id(obj)
        if obj_id in seen:
            return
        seen.add(obj_id)

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
                    if id(module) != obj_id:
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


def _warmup_language_sets() -> list[list[str]]:
    """Every distinct EasyOCR language set the live pipeline builds a reader for:
    the row/score reader (``en``) and the track-name reader
    (``MK8_TRACK_EASYOCR_LANGS``, default ``en,nl``)."""

    sets: list[list[str]] = [["en"]]
    try:
        from .baseline_export_metadata import TRACK_EASYOCR_LANGS

        track = list(TRACK_EASYOCR_LANGS)
        if track and track not in sets:
            sets.append(track)
    except Exception:
        pass
    return sets


def _asset_warmup_loaders() -> list[tuple[str, Any]]:
    """Read-only loaders for the static asset bundles the pipeline reads lazily.
    Calling them primes the OS file cache (and any module-level caches) so the
    first race does not pay the disk read."""

    loaders: list[tuple[str, Any]] = []
    try:
        from .baseline_assets import load_imported_game_catalog

        loaders.append(("game_catalog", load_imported_game_catalog))
    except Exception:
        pass
    try:
        from .baseline_row_ocr import load_character_templates

        loaders.append(("character_templates", load_character_templates))
    except Exception:
        pass
    try:
        from .baseline_assets import live_template_paths_in_baseline_order

        def _read_templates() -> None:
            import cv2  # type: ignore

            for path in live_template_paths_in_baseline_order():
                cv2.imread(str(path))

        loaders.append(("scan_templates", _read_templates))
    except Exception:
        pass
    return loaders


def warm_up_ocr_engine(language_sets: list[list[str]] | None = None) -> dict[str, Any]:
    """Pre-build every EasyOCR reader the pipeline uses and pre-load the static
    asset bundles, so the first race/track pays no torch/EasyOCR import,
    CUDA-init, model-load, or asset-read cost on its critical path.

    This is a pure latency warm-up: it imports torch + easyocr, builds a reader
    for each language set (matching the live GPU selection), applies the same
    RNN optimization, runs a tiny dummy inference to prime CUDA kernels, then
    discards the reader; it also reads the catalog/character/scan-template
    assets. It does NOT change OCR behaviour or results — the live pipeline
    still builds and uses its own readers; this only warms shared process/GPU
    state and the OS file cache. Safe on a background thread; never raises.
    """

    started = time.perf_counter()
    warmed_readers: list[list[str]] = []
    assets_loaded: list[str] = []
    gpu = False
    try:
        import easyocr  # type: ignore
        import numpy as _np  # type: ignore
        import torch  # type: ignore

        gpu = bool(torch.cuda.is_available())
        sets = language_sets if language_sets is not None else _warmup_language_sets()
        for langs in sets:
            try:
                write_ocr_runtime_report("engine_warmup", gpu_requested=gpu, languages=langs)
                reader = easyocr.Reader(list(langs), gpu=gpu, verbose=False)
                optimize_easyocr_reader(reader)
                try:  # prime the forward pass; the result is irrelevant
                    reader.readtext(_np.zeros((32, 64, 3), dtype=_np.uint8))
                except Exception:
                    pass
                warmed_readers.append(list(langs))
                del reader
            except Exception:  # pragma: no cover - one reader failing must not abort the rest
                pass
    except Exception as exc:  # pragma: no cover - depends on optional torch/easyocr
        return {
            "ready": False,
            "gpu": False,
            "warmed_readers": warmed_readers,
            "assets_loaded": assets_loaded,
            "elapsed_seconds": round(time.perf_counter() - started, 2),
            "error": f"{type(exc).__name__}: {exc}",
        }

    for name, loader in _asset_warmup_loaders():
        try:
            loader()
            assets_loaded.append(name)
        except Exception:  # pragma: no cover - best-effort asset priming
            pass

    return {
        "ready": bool(warmed_readers),
        "gpu": gpu,
        "warmed_readers": warmed_readers,
        "assets_loaded": assets_loaded,
        "elapsed_seconds": round(time.perf_counter() - started, 2),
        "error": "",
    }
