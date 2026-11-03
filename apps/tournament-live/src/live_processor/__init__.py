"""Live MK8DX video processing package."""

import warnings

# EasyOCR builds its PyTorch DataLoader with pin_memory=True. On a CPU-only
# machine (no CUDA accelerator) that has no effect and PyTorch emits a noisy
# UserWarning on every OCR batch. Silence just that one message; OCR results are
# unaffected. Remove this if you install a CUDA build of torch to use a GPU.
warnings.filterwarnings(
    "ignore",
    message=r".*pin_memory.*argument is set as true but no accelerator is found.*",
    category=UserWarning,
)
warnings.filterwarnings(
    "ignore",
    message=r".*RNN module weights are not part of single contiguous chunk of memory.*",
    category=UserWarning,
)

__all__ = ["__version__"]

__version__ = "0.1.0"
