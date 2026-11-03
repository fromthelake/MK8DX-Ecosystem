from __future__ import annotations

import csv
import json
import time
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from .paths import (
    EXPORT_ROOT,
    assert_write_allowed,
)
from .performance import PerformanceTracker
from .run_context import current_run_id
from .session import LiveSession


def export_session(session: LiveSession, tracker: PerformanceTracker, export_root: Path = EXPORT_ROOT) -> dict[str, Path]:
    export_root = assert_write_allowed(export_root)
    export_root.mkdir(parents=True, exist_ok=True)
    prefix = f"{session.session_id}_live"
    with tracker.track("export.export_session"):
        if not session.scoreboard.final_rows or not session.scoreboard.tournament_rows:
            session.export_status = "failed_empty_or_invalid_live_session_state"
            raise ValueError("Cannot export: live session has no validated scoreboard state")
        final_csv = assert_write_allowed(export_root / f"{prefix}_Final_Standings.csv")
        tournament_csv = assert_write_allowed(export_root / f"{prefix}_Tournament_Results.csv")
        workbook = assert_write_allowed(export_root / f"{prefix}_Tournament_Results.xlsx")
        metadata_json = assert_write_allowed(export_root / f"{prefix}_metadata.json")

        write_csv(final_csv, session.scoreboard.final_rows)
        tournament_rows = session.scoreboard.tournament_rows
        write_csv(tournament_csv, tournament_rows)
        write_minimal_xlsx(
            workbook,
            {
                "Results": tournament_rows,
                "Final Standings": session.scoreboard.final_rows,
            },
        )
        write_export_metadata(metadata_json, session)
        session.export_status = "exported"
        tracker.record_export(
            session_id=session.session_id,
            final_csv=str(final_csv),
            tournament_csv=str(tournament_csv),
            workbook=str(workbook),
            metadata_json=str(metadata_json),
            source="live_session_state",
        )
        return {
            "final_csv": final_csv,
            "tournament_csv": tournament_csv,
            "workbook": workbook,
            "metadata_json": metadata_json,
        }


def write_export_metadata(path: Path, session: LiveSession) -> None:
    path.write_text(
        json.dumps(
            {
                "generated_from": "live_session_state",
                "run_id": current_run_id(),
                "session_id": session.session_id,
                "fixture_videos": session.fixture_videos,
                "detection_candidate_count": session.detection_candidate_count,
                "ocr_success_count": session.ocr_success_count,
                "ocr_failure_count": session.ocr_failure_count,
                "scoreboard_update_count": session.scoreboard.update_count,
                "source_states": session.source_states,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def export_metadata_rows(session: LiveSession) -> list[dict[str, str]]:
    return [
        {"Key": "generated_from", "Value": "live_session_state"},
        {"Key": "run_id", "Value": current_run_id()},
        {"Key": "session_id", "Value": session.session_id},
        {"Key": "fixture_videos", "Value": "; ".join(session.fixture_videos)},
        {"Key": "detection_candidate_count", "Value": str(session.detection_candidate_count)},
        {"Key": "ocr_success_count", "Value": str(session.ocr_success_count)},
        {"Key": "ocr_failure_count", "Value": str(session.ocr_failure_count)},
        {"Key": "scoreboard_update_count", "Value": str(session.scoreboard.update_count)},
        {"Key": "generated_at", "Value": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    ]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path = assert_write_allowed(path)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames or ["empty"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_minimal_xlsx(path: Path, sheets: dict[str, list[dict[str, str]]]) -> None:
    path = assert_write_allowed(path)
    sheet_names = list(sheets)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _content_types(len(sheet_names)))
        archive.writestr("_rels/.rels", _root_rels())
        archive.writestr("xl/workbook.xml", _workbook_xml(sheet_names))
        archive.writestr("xl/_rels/workbook.xml.rels", _workbook_rels(len(sheet_names)))
        archive.writestr("docProps/core.xml", _core_xml())
        archive.writestr("docProps/app.xml", _app_xml(sheet_names))
        for index, rows in enumerate(sheets.values(), start=1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", _sheet_xml(rows))


def _content_types(sheet_count: int) -> str:
    sheets = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/docProps/core.xml" '
        'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        f"{sheets}</Types>"
    )


def _root_rels() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def _workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>'
        for i, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheets}</sheets></workbook>"
    )


def _workbook_rels(sheet_count: int) -> str:
    rels = "".join(
        f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
        for i in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{rels}</Relationships>"
    )


def _core_xml() -> str:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:creator>MK8DX Live Video Processor</dc:creator>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        "</cp:coreProperties>"
    )


def _app_xml(sheet_names: list[str]) -> str:
    names = "".join(f"<vt:lpstr>{escape(name)}</vt:lpstr>" for name in sheet_names)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>MK8DX Live Video Processor</Application>"
        f"<TitlesOfParts><vt:vector size=\"{len(sheet_names)}\" baseType=\"lpstr\">{names}</vt:vector></TitlesOfParts>"
        "</Properties>"
    )


def _sheet_xml(rows: list[dict[str, str]]) -> str:
    headers: list[str] = []
    for row in rows:
        for key in row:
            if key not in headers:
                headers.append(key)
    xml_rows = []
    if headers:
        xml_rows.append(_row_xml(1, headers))
        for idx, row in enumerate(rows, start=2):
            xml_rows.append(_row_xml(idx, [row.get(header, "") for header in headers]))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(xml_rows)}</sheetData></worksheet>"
    )


def _row_xml(index: int, values: list[str]) -> str:
    cells = []
    for offset, value in enumerate(values):
        column = _column_name(offset + 1)
        cells.append(
            f'<c r="{column}{index}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
        )
    return f'<row r="{index}">{"".join(cells)}</row>'


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name
