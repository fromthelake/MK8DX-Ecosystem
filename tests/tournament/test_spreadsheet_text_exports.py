"""The recorded and live Tournament workbooks and CSVs keep names as text in a spreadsheet.

openpyxl turns any string that starts with "=" into a formula cell, and a spreadsheet reads a CSV cell that starts
with = + - @ as a formula. The writers must give string cells (numbers stay number cells) and protected CSV cells,
and every reader of those CSVs must get the real names back. Synthetic rows only; no recording or engine data."""
import zipfile
from types import SimpleNamespace

import pytest

pd = pytest.importorskip("pandas")
openpyxl = pytest.importorskip("openpyxl")

from mk8dx_tournament_extraction.engine import ocr_export  # noqa: E402
from mk8dx_tournament_extraction.spreadsheet_text import csv_imported_rows  # noqa: E402

NAMES = ["=1+1", "@SUM(A1:A2)", "+Сергей", "-マリオ", "=HYPERLINK(\"https://example.invalid\",\"x\")", "Zoë", "'t Hoofd"]


def _results() -> "pd.DataFrame":
    count = len(NAMES)
    return pd.DataFrame({
        "Video": ["=Cup"] * count,
        "Race": pd.array([1] * count, dtype="Int64"),
        "Track": ["Baby Park"] * count,
        "Position": pd.array(range(1, count + 1), dtype="Int64"),
        "Player": NAMES,
        "Character": ["Mario"] * count,
        "Race Points": pd.array([15 - index for index in range(count)], dtype="Int64"),
        "Review Reason": ["-check"] + [""] * (count - 1),
    })


def _standings() -> "pd.DataFrame":
    count = len(NAMES)
    return pd.DataFrame({
        "VideoName": ["=Cup"] * count,
        "Position": pd.array(range(1, count + 1), dtype="Int64"),
        "PlayerName": NAMES,
        "TotalPoints": pd.array([15 - index for index in range(count)], dtype="Int64"),
        "Character": ["Mario"] * count,
    })


def _assert_text_cells(path):
    workbook = openpyxl.load_workbook(path)
    seen = 0
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                assert cell.data_type != "f", f"{sheet.title}!{cell.coordinate} became a formula"
                if isinstance(cell.value, str):
                    assert cell.data_type == "s", f"{sheet.title}!{cell.coordinate}"
                    seen += 1
                elif cell.value is not None:
                    assert cell.data_type == "n", f"{sheet.title}!{cell.coordinate} is not a number"
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("xl/worksheets/"):
                assert b"<f>" not in archive.read(name), name
    return workbook, seen


def _assert_protected_csv(path, column):
    text = path.read_bytes().decode("utf-8-sig")
    assert "\n'=1+1," in text or ",'=1+1," in text
    assert ",'@SUM(A1:A2)," in text and ",'+Сергей," in text and ",'-マリオ," in text
    assert ",'t Hoofd," in text and ",Zoë," in text and ",=1+1," not in text
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = csv_imported_rows(__import__("csv").DictReader(handle))
    assert [row[column] for row in rows] == NAMES
    return rows


def test_recorded_workbooks_and_csvs_keep_names_as_text(monkeypatch, tmp_path):
    monkeypatch.setattr(ocr_export, "build_user_export_df", lambda df: _results())
    monkeypatch.setattr(ocr_export, "build_final_standings_df", lambda df: _standings())
    monkeypatch.setattr(ocr_export, "build_debug_export_df", lambda df: _results())
    monkeypatch.setattr(ocr_export, "load_app_config", lambda: SimpleNamespace(write_debug_csv=True))
    frames = tmp_path / "Frames"
    frames.mkdir()

    paths = ocr_export.write_results_workbooks(None, frames)

    workbook, strings = _assert_text_cells(paths["output_excel_path"])
    assert strings >= 3 * len(NAMES)
    results = workbook["Results"]
    assert [results.cell(row=index + 2, column=5).value for index in range(len(NAMES))] == NAMES
    assert results.cell(row=2, column=7).value == 15 and results.cell(row=2, column=7).data_type == "n"
    _assert_text_cells(paths["debug_output_excel_path"])

    rows = _assert_protected_csv(paths["output_csv_path"], "Player")
    assert rows[0]["Race Points"] == "15" and rows[0]["Video"] == "=Cup" and rows[0]["Review Reason"] == "-check"
    raw = paths["output_csv_path"].read_bytes().decode("utf-8-sig")
    assert raw.splitlines()[1].startswith("'=Cup,1,Baby Park,1,'=1+1,Mario,15,'-check")
    _assert_protected_csv(paths["final_standings_csv_path"], "PlayerName")
    _assert_protected_csv(paths["debug_output_csv_path"], "Player")


def test_recorded_post_steps_keep_names_as_text(monkeypatch, tmp_path):
    pytest.importorskip("cv2")
    from mk8dx_tournament_extraction import recorded_characters

    monkeypatch.setattr(ocr_export, "build_user_export_df", lambda df: _results())
    monkeypatch.setattr(ocr_export, "build_final_standings_df", lambda df: _standings())
    monkeypatch.setattr(ocr_export, "load_app_config", lambda: SimpleNamespace(write_debug_csv=False))
    frames = tmp_path / "Frames"
    frames.mkdir()
    paths = ocr_export.write_results_workbooks(None, frames)
    results_csv = paths["output_csv_path"]

    # The character and race-class steps read the CSV, rewrite it and update the workbook.
    fieldnames, rows, bom = recorded_characters._read_csv(results_csv)
    assert [row["Player"] for row in rows] == NAMES
    for row in rows:
        row["Character"] = "=Yoshi"
    recorded_characters._write_csv(results_csv, fieldnames, rows, bom)
    renamed = {("=Cup", "Zoë"): "=Renamed"}
    standings = recorded_characters._update_final_standings(results_csv, rows, renamed)
    assert standings[("=Cup", "=1+1")] == "=Yoshi"
    assert recorded_characters._update_workbook(results_csv, rows, standings, renamed)

    _assert_protected_csv(results_csv, "Player")
    workbook, _ = _assert_text_cells(paths["output_excel_path"])
    final = workbook["Final Standings"]
    assert "=Renamed" in [cell.value for cell in final["C"]]
    assert "'=Yoshi" in results_csv.read_text(encoding="utf-8-sig")


def test_live_workbook_and_csvs_keep_names_as_text(monkeypatch, tmp_path):
    from tournament_live import workbook_export

    monkeypatch.setattr(workbook_export, "live_rows_to_export_df", lambda rows: None)
    monkeypatch.setattr(workbook_export, "build_user_export_df", lambda frame: _results())
    monkeypatch.setattr(workbook_export, "build_final_standings_df", lambda frame: _standings())
    workbook_path = tmp_path / "Current_Tournament_Results.xlsx"
    results_csv = tmp_path / "Current_Tournament_Results.csv"
    final_csv = tmp_path / "Current_Final_Standings.csv"

    workbook_export.write_compatible_workbook(workbook_path, results_csv, final_csv, [])

    _assert_text_cells(workbook_path)
    _assert_protected_csv(results_csv, "Player")
    _assert_protected_csv(final_csv, "PlayerName")
