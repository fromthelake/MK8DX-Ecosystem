# Licences of third-party objects in the asset collection

- `Apache-2.0.txt`: the EasyOCR detection and recognition models (`.pth`, group `ocr-models`) and the Tesseract
  language data (`.traineddata`, group `scanner-runtime`) are distributed under the Apache License 2.0 by their
  upstream projects (JaidedAI/EasyOCR, tesseract-ocr/tessdata_fast). The `ocr-models` group holds every model the
  shipped EasyOCR readers load (detection, Latin, English, Cyrillic, Japanese, Korean, simplified and traditional
  Chinese), so OCR never downloads a model.

Game-derived pictures in the collection are covered by [Third-party materials](../../../docs/THIRD_PARTY_MATERIALS.md).
