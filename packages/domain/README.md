# Domain contracts

Shared identity and submission contracts live here. API and Web may consume public exports; this package must not import either application or deployment configuration. Change a contract at its canonical definition and verify producer plus reverse consumers with `python tooling/check_boundaries.py`, API/Web typecheck and focused tests. The component registry names the dependent components.

## Spreadsheet exports

[`policies/spreadsheet-text-v1.json`](policies/spreadsheet-text-v1.json) is the one rule every CSV and XLSX export
follows so that a name or other text never becomes a spreadsheet formula. Names stay unchanged in the database and
domain; only the export changes:

- **XLSX**: text is a string cell, a number a number cell, nothing else is added.
- **CSV**: a value that a spreadsheet would read as a formula (it starts with `=`, `+`, `-`, `@`, their full-width
  forms or a control character such as tab or carriage return, also after leading spaces) is written with one
  leading apostrophe `'`. Plain numbers such as `-5` or `12,5` never get one. Delimiter quoting is applied after
  that, as before. Every reader of these CSV files (the Web and Android roster and layout imports, the historical
  import, the Tournament Processor, Live and Analysis) drops exactly that apostrophe again, so a re-imported name is
  not a new name. A real leading apostrophe followed by such a character is written doubled and survives the round
  trip.

The implementations are `apps/timetrials-web/src/spreadsheet-text.ts`,
`apps/timetrials-android/.../tournament/AndroidSpreadsheetText.kt` and
`packages/tournament-extraction/python/src/mk8dx_tournament_extraction/spreadsheet_text.py`; each tests the vectors
in the policy file, and the API's score workbook is tested for string cells.
