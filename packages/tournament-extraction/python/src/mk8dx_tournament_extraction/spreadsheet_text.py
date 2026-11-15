"""Text that a spreadsheet program must show as text.

A Player name or OCR text like ``=1+1`` or ``@Sander`` is valid text, but Excel,
LibreOffice and Google Sheets read a CSV cell that starts with ``= + - @`` (or a
tab or carriage return) as a formula, and openpyxl stores such a string as a
formula cell. The real text stays as it is in the results; only the export
boundary changes:

* CSV: one apostrophe in front of a value that needs it (:func:`csv_literal_text`).
  Every reader of these CSV files takes exactly that apostrophe off again
  (:func:`csv_imported_text`, :func:`csv_imported_rows`), so a protected name is
  never read back as a new name.
* XLSX: text is written as string cells (:func:`literal_text_cells`), numbers stay
  number cells, and no apostrophe is added.

The rule and its test vectors live in
``packages/domain/policies/spreadsheet-text-v1.json`` and are shared with the
Web and the Android app. This module imports no third-party package.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

PREFIX = "'"
_PLAIN_NUMBER = re.compile(r"[+-]?[0-9]+(?:[.,][0-9]+)?\Z")
_FORMULA_START = frozenset("=+-@\uFF1D\uFF0B\uFF0D\uFF20")
_LEADING_SPACES = " \u00A0\u3000"


def spreadsheet_text_needs_prefix(value: str) -> bool:
    """True when a CSV cell with this text would be read as a formula (or loses its leading apostrophe)."""
    if value == "" or _PLAIN_NUMBER.match(value):
        return False
    if ord(value[0]) <= 0x1F:
        return True
    after_spaces = value.lstrip(_LEADING_SPACES)
    if after_spaces and after_spaces[0] in _FORMULA_START:
        return True
    return value.startswith(PREFIX) and spreadsheet_text_needs_prefix(value[1:])


def csv_literal_text(value: Any) -> Any:
    """The value as a CSV export writes it; anything that is not a string is returned unchanged."""
    if isinstance(value, str) and spreadsheet_text_needs_prefix(value):
        return PREFIX + value
    return value


def csv_imported_text(value: Any) -> Any:
    """The value a CSV export wrote, as it was before the export."""
    if isinstance(value, str) and value.startswith(PREFIX) and spreadsheet_text_needs_prefix(value[1:]):
        return value[1:]
    return value


def csv_literal_row(row: Any) -> Any:
    """A ``csv.writer`` list row or a ``csv.DictWriter`` dict row with every text cell protected."""
    if isinstance(row, Mapping):
        return {key: csv_literal_text(value) for key, value in row.items()}
    return [csv_literal_text(value) for value in row]


def csv_imported_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """``csv.DictReader`` rows with the export's protection taken off every value."""
    return [{key: csv_imported_text(value) for key, value in row.items()} for row in rows]


def csv_literal_frame(frame: Any) -> Any:
    """A copy of a pandas DataFrame whose text cells are protected for ``to_csv``; number columns stay numbers."""
    from pandas.api import types  # noqa: WPS433  (only the DataFrame writers need pandas)

    protected = frame.copy()
    for column in protected.columns:
        series = protected[column]
        # object columns (pandas 2) and the str/string dtypes (pandas 3) hold text;
        # number, boolean and date columns are left exactly as they are.
        if types.is_object_dtype(series.dtype) or types.is_string_dtype(series.dtype):
            protected[column] = series.map(csv_literal_text).astype(series.dtype)
    return protected


class LiteralCsvWriter:
    """A ``csv.writer``/``csv.DictWriter`` wrapper that protects every row it writes."""

    def __init__(self, writer: Any) -> None:
        self._writer = writer

    def writeheader(self) -> Any:
        return self._writer.writeheader()

    def writerow(self, row: Any) -> Any:
        return self._writer.writerow(csv_literal_row(row))

    def writerows(self, rows: Iterable[Any]) -> None:
        for row in rows:
            self.writerow(row)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._writer, name)


def set_text_cell(cell: Any, value: Any) -> None:
    """Set an openpyxl cell; a string is always a string cell, never a formula."""
    cell.value = value
    if isinstance(value, str) and cell.data_type == "f":
        cell.data_type = "s"


def literal_text_cells(worksheet: Any) -> int:
    """Turn every formula cell openpyxl made from a string into a string cell; returns how many.

    The Tournament writers never write a real formula, so every ``f`` cell in their
    sheets is text that happened to start with ``=``.
    """
    changed = 0
    for row in worksheet.iter_rows():
        for cell in row:
            if cell.data_type == "f" and isinstance(cell.value, str):
                cell.data_type = "s"
                changed += 1
    return changed
