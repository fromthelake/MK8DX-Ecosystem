"""Names in the Tournament tools' CSV files stay text in a spreadsheet, and the tools read the real names back.

The vectors are the file Web and Android test against too
(packages/domain/policies/spreadsheet-text-v1.json). The pandas/openpyxl writers
are covered in tests/tournament/test_spreadsheet_text_exports.py.
"""
import csv
import io
import json
from pathlib import Path

from mk8dx_tournament_extraction.spreadsheet_text import (
    LiteralCsvWriter,
    csv_imported_rows,
    csv_imported_text,
    csv_literal_text,
)
from tournament_processor import cli as processor_cli

from rows import confirmed_rows

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "packages/domain/policies/spreadsheet-text-v1.json")
                     .read_text(encoding="utf-8"))
NAMES = ["=1+1", "@Bravo", "+Сергей", "-マリオ", "'t Hoofd", "'=x", "Zoë"]


def test_every_shared_vector_holds_both_ways():
    for case in VECTORS["cases"]:
        assert csv_literal_text(case["value"]) == case["csv"], case
        assert csv_imported_text(case["csv"]) == case["value"], case
    for case in VECTORS["importOnlyCases"]:
        assert csv_imported_text(case["csv"]) == case["value"], case
    # Numbers and empty cells of a row pass through as they are.
    assert csv_literal_text(15) == 15 and csv_literal_text(None) is None


def test_csv_writer_writes_the_shared_document_lines_for_every_delimiter():
    for case in VECTORS["documentCases"]:
        buffer = io.StringIO()
        LiteralCsvWriter(csv.writer(buffer, delimiter=case["delimiter"], lineterminator="\r\n")).writerow(case["cells"])
        assert buffer.getvalue() == case["line"] + "\r\n", case
        read, = csv.reader(io.StringIO(buffer.getvalue()), delimiter=case["delimiter"])
        assert [csv_imported_text(value) for value in read] == case["cells"]


def test_a_protected_results_csv_reaches_the_canonical_json_with_the_real_names(tmp_path):
    rows = []
    for index, name in enumerate(NAMES):
        row = dict(confirmed_rows()[index % 2])
        row.update({"Position": index + 1, "Player": name})
        rows.append(row)
    results_csv = tmp_path / "20260101_000000_Tournament_Results.csv"
    with results_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = LiteralCsvWriter(csv.DictWriter(handle, fieldnames=list(rows[0])))
        writer.writeheader()
        writer.writerows(rows)
    raw = results_csv.read_bytes().decode("utf-8-sig")
    assert ",'=1+1," in raw and ",'@Bravo," in raw and ",'+Сергей," in raw and ",''=x," in raw
    assert ",'t Hoofd," in raw and ",Zoë," in raw and ",=1+1," not in raw
    with results_csv.open(encoding="utf-8-sig", newline="") as handle:
        assert [row["Player"] for row in csv_imported_rows(csv.DictReader(handle))] == NAMES

    output = tmp_path / "canonical.json"
    assert processor_cli.run([str(results_csv), "--output", str(output), "--session-id", "synthetic-session",
                              "--created-at-ms", "1000"]) == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    results = payload if isinstance(payload, list) else payload.get("results", payload.get("races", []))
    observed = [placement["observedPlayerName"] for race in results for placement in race["placements"]]
    assert sorted(observed) == sorted(NAMES)


def test_the_live_csv_export_protects_names(tmp_path, monkeypatch):
    from live_processor import export as live_export

    monkeypatch.setattr(live_export, "assert_write_allowed", lambda path: Path(path))
    target = tmp_path / "live_Final_Standings.csv"
    live_export.write_csv(target, [{"PlayerName": name, "TotalPoints": "12"} for name in NAMES])
    lines = target.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "PlayerName,TotalPoints"
    assert lines[1:3] == ["'=1+1,12", "'@Bravo,12"]
    with target.open(encoding="utf-8", newline="") as handle:
        assert [row["PlayerName"] for row in csv_imported_rows(csv.DictReader(handle))] == NAMES
