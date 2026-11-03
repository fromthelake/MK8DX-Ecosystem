package nl.mariokart8.mk8dxtimetrials.tournament

import java.text.Collator
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Step 2 roster CSV, matching the source Manager's own file.
 *
 * The source writes `Naam;Status;NS1;NS2` with CRLF line endings and sorts on
 * the Dutch collation, and it detects the delimiter when reading so a file
 * saved by a comma-locale Excel still imports. ADR-0177 decisions 8 to 12 add
 * what happens to names the canonical Player directory does not know yet.
 */

internal data class AndroidRosterCsvRow(
    val row: Int,
    val displayName: String,
    val attendance: String,
    val hasSwitch1: Boolean,
    val hasSwitch2: Boolean,
)

internal sealed interface AndroidRosterCsvParse {
    data class Parsed(val rows: List<AndroidRosterCsvRow>) : AndroidRosterCsvParse
    data class Failed(val message: String) : AndroidRosterCsvParse
}

/** A column name without its case, spaces or accents: `Deelnemer 1` is `deelnemer1`. */
internal fun headerKey(value: String): String =
    java.text.Normalizer.normalize(value.removePrefix("\uFEFF"), java.text.Normalizer.Form.NFKD)
        .lowercase(Locale.ROOT)
        .filter { it in 'a'..'z' || it in '0'..'9' }

private fun detectDelimiter(headerLine: String): Char {
    val tabs = headerLine.count { it == '\t' }
    val semicolons = headerLine.count { it == ';' }
    val commas = headerLine.count { it == ',' }
    return when {
        tabs >= semicolons && tabs >= commas && tabs > 0 -> '\t'
        semicolons >= commas -> ';'
        else -> ','
    }
}

private fun splitCsvLine(line: String, delimiter: Char): List<String> {
    val cells = mutableListOf<String>()
    val current = StringBuilder()
    var inQuotes = false
    var index = 0
    while (index < line.length) {
        val character = line[index]
        if (character == '"') {
            if (inQuotes && index + 1 < line.length && line[index + 1] == '"') {
                current.append('"')
                index += 2
                continue
            }
            inQuotes = !inQuotes
            index += 1
            continue
        }
        if (!inQuotes && character == delimiter) {
            cells.add(current.toString())
            current.setLength(0)
            index += 1
            continue
        }
        current.append(character)
        index += 1
    }
    cells.add(current.toString())
    return cells.map { it.replace("\r", "").trim() }
}

// What a cell may say. The same lists are shown to the operator when a cell
// says something else, so there is one answer to "what is allowed here?".
internal val ANDROID_CSV_PRESENT_WORDS = listOf("Aanwezig", "Present", "A", "ja", "yes", "x", "1")
internal val ANDROID_CSV_WAITING_WORDS = listOf("Wachtlijst", "Waiting", "Reserve", "W")
internal val ANDROID_CSV_ABSENT_WORDS = listOf("Afwezig", "Absent", "nee", "no", "0", "(leeg)")
internal val ANDROID_CSV_TRUE_WORDS = listOf("ja", "j", "yes", "y", "true", "waar", "1", "x")
internal val ANDROID_CSV_FALSE_WORDS = listOf("nee", "n", "no", "false", "onwaar", "0", "(leeg)")
internal val ANDROID_CSV_CONSOLE_WORDS = listOf("NS1", "NS2", "1", "2", "Switch 1", "Switch 2")

private fun csvBooleanOrNull(value: String): Boolean? {
    val text = value.trim().lowercase(Locale.ROOT)
    return when {
        text.isEmpty() -> false
        ANDROID_CSV_TRUE_WORDS.any { it.lowercase(Locale.ROOT) == text } -> true
        ANDROID_CSV_FALSE_WORDS.any { it.lowercase(Locale.ROOT) == text } -> false
        else -> null
    }
}

private fun csvAttendance(value: String): String? {
    val text = value.trim().lowercase(Locale.ROOT)
    return when {
        text.isEmpty() -> ATTENDANCE_ABSENT
        ANDROID_CSV_PRESENT_WORDS.any { it.lowercase(Locale.ROOT) == text } -> ATTENDANCE_PRESENT
        ANDROID_CSV_WAITING_WORDS.any { it.lowercase(Locale.ROOT) == text } -> ATTENDANCE_WAITING
        ANDROID_CSV_ABSENT_WORDS.any { it.lowercase(Locale.ROOT) == text } -> ATTENDANCE_ABSENT
        else -> null
    }
}

/** "Regel 7, kolom Status: …" - where it went wrong and what that column takes. */
internal fun androidCsvIssue(
    row: Int,
    column: String,
    value: String,
    problem: String,
    allowed: List<String> = emptyList(),
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): String {
    val quoted = if (value.isBlank()) "" else "\"$value\": "
    val takes = if (allowed.isEmpty()) "" else androidText(
        language,
        " Allowed: ${allowed.joinToString(", ")}.",
        " Toegestaan: ${allowed.joinToString(", ")}.",
    )
    val where = androidText(language, "Row $row, column $column", "Regel $row, kolom $column")
    return "$where: $quoted$problem$takes"
}

internal fun androidParseRosterCsv(
    text: String,
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): AndroidRosterCsvParse {
    val cleaned = text.removePrefix("\uFEFF")
    val lines = cleaned.split("\n").map { it.replace("\r", "") }.filter { it.isNotBlank() }
    if (cleaned.startsWith("PK") || cleaned.any { it.code in 1..8 }) {
        return AndroidRosterCsvParse.Failed(
            androidText(
                language,
                "This does not look like a CSV file. An Excel workbook (.xlsx) belongs to " +
                    "entering the scores, not to this step.",
                "Dit lijkt geen CSV-bestand. Een Excel-werkmap (.xlsx) hoort bij het " +
                    "invullen van de scores, niet bij deze stap.",
            ),
        )
    }
    if (lines.isEmpty()) return AndroidRosterCsvParse.Failed(androidText(language, "The CSV file is empty.", "Het CSV-bestand is leeg."))
    val delimiter = detectDelimiter(lines.first())
    val headers = splitCsvLine(lines.first(), delimiter).map { headerKey(it) }
    fun column(vararg names: String): Int = names.map(::headerKey).firstNotNullOfOrNull { wanted ->
        headers.indexOf(wanted).takeIf { it >= 0 }
    } ?: -1
    val nameIndex = column("Naam", "Name", "Speler", "Player", "Deelnemer", "Participant")
    val statusIndex = column("Status", "Aanwezigheid", "Attendance")
    val ns1Index = column("NS1", "Switch 1", "Nintendo Switch 1")
    val ns2Index = column("NS2", "Switch 2", "Nintendo Switch 2")
    val missing = buildList {
        if (nameIndex < 0) add(androidText(language, "Naam (or Name, Speler, Player)", "Naam (of Name, Speler, Player)"))
        if (statusIndex < 0) add(androidText(language, "Status (or Aanwezigheid, Attendance)", "Status (of Aanwezigheid, Attendance)"))
        if (ns1Index < 0) add(androidText(language, "NS1 (or Switch 1)", "NS1 (of Switch 1)"))
        if (ns2Index < 0) add(androidText(language, "NS2 (or Switch 2)", "NS2 (of Switch 2)"))
    }
    if (missing.isNotEmpty()) {
        return AndroidRosterCsvParse.Failed(
            androidText(
                language,
                "Row 1: these columns are missing: ${missing.joinToString(", ")}. " +
                    "Columns may be separated by ; , or a tab.",
                "Regel 1: deze kolommen ontbreken: ${missing.joinToString(", ")}. " +
                    "Kolommen mogen gescheiden zijn door ; , of een tab.",
            ),
        )
    }
    val rows = mutableListOf<AndroidRosterCsvRow>()
    lines.drop(1).forEachIndexed { offset, line ->
        val cells = splitCsvLine(line, delimiter)
        val displayName = cells.getOrNull(nameIndex).orEmpty().trim()
        if (displayName.isEmpty()) return@forEachIndexed
        // Row numbers are the ones an operator sees in the spreadsheet.
        val rowNumber = offset + 2
        val statusValue = cells.getOrNull(statusIndex).orEmpty()
        val attendance = csvAttendance(statusValue)
            ?: return AndroidRosterCsvParse.Failed(
                androidCsvIssue(
                    rowNumber, "Status", statusValue,
                    androidText(language, "this is not an attendance.", "dit is geen aanwezigheid."),
                    ANDROID_CSV_PRESENT_WORDS + ANDROID_CSV_WAITING_WORDS + ANDROID_CSV_ABSENT_WORDS,
                    language,
                ),
            )
        val switch1Value = cells.getOrNull(ns1Index).orEmpty()
        val hasSwitch1 = csvBooleanOrNull(switch1Value)
            ?: return AndroidRosterCsvParse.Failed(
                androidCsvIssue(
                    rowNumber, "NS1", switch1Value,
                    androidText(language, "this is not a yes or a no.", "dit is geen ja of nee."),
                    ANDROID_CSV_TRUE_WORDS + ANDROID_CSV_FALSE_WORDS,
                    language,
                ),
            )
        val switch2Value = cells.getOrNull(ns2Index).orEmpty()
        val hasSwitch2 = csvBooleanOrNull(switch2Value)
            ?: return AndroidRosterCsvParse.Failed(
                androidCsvIssue(
                    rowNumber, "NS2", switch2Value,
                    androidText(language, "this is not a yes or a no.", "dit is geen ja of nee."),
                    ANDROID_CSV_TRUE_WORDS + ANDROID_CSV_FALSE_WORDS,
                    language,
                ),
            )
        rows.add(
            AndroidRosterCsvRow(
                row = rowNumber,
                displayName = displayName,
                attendance = attendance,
                hasSwitch1 = hasSwitch1,
                hasSwitch2 = hasSwitch2,
            ),
        )
    }
    if (rows.isEmpty()) return AndroidRosterCsvParse.Failed(
        androidText(language, "The CSV file holds no participants.", "Het CSV-bestand bevat geen deelnemers."),
    )
    val duplicates = rows.groupBy { it.displayName.lowercase(Locale.ROOT) }.filterValues { it.size > 1 }
    if (duplicates.isNotEmpty()) {
        val sharing = duplicates.values.first()
        return AndroidRosterCsvParse.Failed(
            androidCsvIssue(
                sharing.last().row, "Naam", sharing.last().displayName,
                androidText(
                    language,
                    "this name is already on row ${sharing.first().row}.",
                    "deze naam staat al op regel ${sharing.first().row}.",
                ),
                language = language,
            ),
        )
    }
    return AndroidRosterCsvParse.Parsed(rows)
}

/** The source file layout: `Naam;Status;NS1;NS2`, CRLF, Dutch display order. */
internal fun androidRosterCsv(participants: List<AndroidTournamentParticipant>): String {
    val collator = Collator.getInstance(Locale.forLanguageTag("nl-NL"))
    val builder = StringBuilder("\uFEFFNaam;Status;NS1;NS2\r\n")
    participants
        .sortedWith { left, right -> collator.compare(left.displayName, right.displayName) }
        .forEach { participant ->
            val status = when (participant.attendance) {
                ATTENDANCE_PRESENT -> "Aanwezig"
                ATTENDANCE_WAITING -> "Wachtlijst"
                else -> "Afwezig"
            }
            builder.append(csvCell(participant.displayName)).append(';')
            builder.append(status).append(';')
            builder.append(if (participant.hasSwitch1) "ja" else "nee").append(';')
            builder.append(if (participant.hasSwitch2) "ja" else "nee").append("\r\n")
        }
    return builder.toString()
}

private fun csvCell(value: String): String =
    if (value.any { it == ';' || it == '"' || it == '\n' || it == '\r' }) {
        "\"" + value.replace("\"", "\"\"") + "\""
    } else {
        value
    }
