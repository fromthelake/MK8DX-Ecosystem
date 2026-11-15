package nl.mariokart8.mk8dxtimetrials.tournament

/**
 * Text that a spreadsheet program must show as text.
 *
 * A Player name like `=1+1` or `@Sander` is a valid name, but Excel, LibreOffice
 * and Google Sheets read a CSV cell that starts with = + - @ (or a tab or
 * carriage return) as a formula. The real name stays as it is on the platform;
 * only a CSV export puts one apostrophe in front, and every import of these CSV
 * files takes exactly that apostrophe off again. The rule and its test vectors
 * live in packages/domain/policies/spreadsheet-text-v1.json, shared with the
 * Web and the Python Tournament tools. The workbook writer needs none
 * of this: it writes text as inline-string cells, never as formulas.
 */
private const val SPREADSHEET_TEXT_PREFIX = "'"
private val PLAIN_NUMBER = Regex("^[+-]?[0-9]+(?:[.,][0-9]+)?$")
private val FORMULA_START = setOf('=', '+', '-', '@', '\uFF1D', '\uFF0B', '\uFF0D', '\uFF20')
private val LEADING_SPACES = setOf(' ', '\u00A0', '\u3000')

/** True when a CSV cell with this text would be read as a formula (or loses its leading apostrophe). */
internal fun androidSpreadsheetTextNeedsPrefix(value: String): Boolean {
    if (value.isEmpty() || PLAIN_NUMBER.matches(value)) return false
    if (value[0].code <= 0x1F) return true
    val afterSpaces = value.dropWhile { it in LEADING_SPACES }
    if (afterSpaces.isNotEmpty() && afterSpaces[0] in FORMULA_START) return true
    return value.startsWith(SPREADSHEET_TEXT_PREFIX) && androidSpreadsheetTextNeedsPrefix(value.substring(1))
}

/** The text as a CSV export writes it. */
internal fun androidCsvLiteralText(value: String): String =
    if (androidSpreadsheetTextNeedsPrefix(value)) SPREADSHEET_TEXT_PREFIX + value else value

/** The text a CSV export wrote, as it was before the export. */
internal fun androidCsvImportedText(value: String): String =
    if (value.startsWith(SPREADSHEET_TEXT_PREFIX) && androidSpreadsheetTextNeedsPrefix(value.substring(1))) {
        value.substring(1)
    } else {
        value
    }

/** One `;` CSV cell: protected against formula reading, then quoted when it holds `;`, `"` or a line break. */
internal fun androidCsvCell(value: String): String {
    val literal = androidCsvLiteralText(value)
    return if (literal.any { it == ';' || it == '"' || it == '\n' || it == '\r' }) {
        "\"" + literal.replace("\"", "\"\"") + "\""
    } else {
        literal
    }
}
