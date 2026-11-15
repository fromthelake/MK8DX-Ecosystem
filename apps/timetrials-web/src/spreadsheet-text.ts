// Text that a spreadsheet program must show as text.
//
// A Player name like `=1+1` or `@Sander` is a valid name, but Excel, LibreOffice
// and Google Sheets read a CSV cell that starts with = + - @ (or a tab or
// carriage return) as a formula. The real name stays as it is in the database;
// only a CSV export puts one apostrophe in front, and every import of our CSV
// files takes exactly that apostrophe off again. The rule and its test vectors
// live in packages/domain/policies/spreadsheet-text-v1.json and are shared with
// the Android app and the Python Tournament tools (the API writes no CSV).

const PREFIX = "'";
const PLAIN_NUMBER = /^[+-]?[0-9]+(?:[.,][0-9]+)?$/u;
const LEADING_SPACES = /^[ \u00A0\u3000]*/u;
const FORMULA_START = new Set(["=", "+", "-", "@", "\uFF1D", "\uFF0B", "\uFF0D", "\uFF20"]);

/** True when a CSV cell with this text would be read as a formula (or loses its leading apostrophe). */
export function spreadsheetTextNeedsPrefix(value: string): boolean {
  if (value === "" || PLAIN_NUMBER.test(value)) { return false; }
  const first = value.charCodeAt(0);
  if (first <= 0x1f) { return true; }
  const afterSpaces = value.replace(LEADING_SPACES, "");
  if (afterSpaces !== "" && FORMULA_START.has(afterSpaces[0]!)) { return true; }
  return value.startsWith(PREFIX) && spreadsheetTextNeedsPrefix(value.slice(1));
}

/** The text as a CSV export writes it. */
export function csvLiteralText(value: string): string {
  return spreadsheetTextNeedsPrefix(value) ? `${PREFIX}${value}` : value;
}

/** The text a CSV export wrote, as it was before the export. */
export function csvImportedText(value: string): string {
  return value.startsWith(PREFIX) && spreadsheetTextNeedsPrefix(value.slice(1)) ? value.slice(1) : value;
}
