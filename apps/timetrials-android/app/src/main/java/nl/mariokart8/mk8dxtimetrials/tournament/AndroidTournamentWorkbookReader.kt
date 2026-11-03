package nl.mariokart8.mk8dxtimetrials.tournament

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.zip.ZipInputStream
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * A minimal reader for the score workbooks the Tournament Processor writes,
 * ported from the source Manager's `src/ScoreWorkbookImporter.php`.
 *
 * That importer is deliberately dependency-free: an `.xlsx` is a ZIP of XML, so
 * it reads the shared string table, resolves the sheet a name points at, and
 * walks the rows itself. This does the same with `ZipInputStream` and Android's
 * own pull parser, so the phone gains no library and no native code.
 *
 * Only what the workflow needs is supported: string, inline-string and numeric
 * cells from a named worksheet. Formulas are read as their cached value, which
 * is what the Processor writes.
 */

/** The two sheets the Processor writes, under the source's own names. */
internal const val WORKBOOK_RESULTS_SHEET = "Results"
internal const val WORKBOOK_FINAL_STANDINGS_SHEET = "Final Standings"

/** The source's `REQUIRED_FINAL_STANDINGS_HEADERS`. */
internal val WORKBOOK_FINAL_STANDINGS_HEADERS = listOf(
    "VideoName", "Races", "Position", "PlayerName", "TotalPoints", "Character",
)

/** The source's `REQUIRED_RESULTS_HEADERS`. */
internal val WORKBOOK_RESULTS_HEADERS = listOf(
    "Video", "Race", "Track", "Cup", "Position", "Player", "Character",
    "Race Points", "Total Before Race", "Total After Race",
    "Position After Race", "Needs Review", "Review Reason",
)

internal data class AndroidWorkbookSheet(
    val name: String,
    val headers: List<String>,
    val rows: List<Map<String, String>>,
)

internal sealed interface AndroidWorkbookParse {
    data class Parsed(val sheets: Map<String, AndroidWorkbookSheet>) : AndroidWorkbookParse
    data class Failed(val message: String) : AndroidWorkbookParse
}

/** True when the bytes begin with the ZIP local file header an `.xlsx` starts with. */
internal fun androidLooksLikeWorkbook(bytes: ByteArray): Boolean =
    bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4B.toByte() &&
        (bytes[2] == 0x03.toByte() || bytes[2] == 0x05.toByte() || bytes[2] == 0x07.toByte())

private const val MAXIMUM_ENTRY_BYTES = 32 * 1024 * 1024

private fun readZipEntries(bytes: ByteArray): Map<String, ByteArray> {
    val entries = mutableMapOf<String, ByteArray>()
    ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            if (entry.isDirectory) { continue }
            val name = entry.name
            // Only the parts this reader understands, so a large embedded image
            // is never held in memory.
            val wanted = name == "xl/workbook.xml" ||
                name == "xl/sharedStrings.xml" ||
                name == "xl/_rels/workbook.xml.rels" ||
                name.startsWith("xl/worksheets/")
            if (!wanted) { continue }
            val buffer = zip.readBytes()
            if (buffer.size > MAXIMUM_ENTRY_BYTES) { continue }
            entries[name] = buffer
        }
    }
    return entries
}

private fun parser(bytes: ByteArray): XmlPullParser {
    val instance = Xml.newPullParser()
    instance.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
    instance.setInput(ByteArrayInputStream(bytes), "UTF-8")
    return instance
}

/**
 * The shared string table. Each `<si>` is one string, possibly split across
 * several `<t>` runs, which must be concatenated in order.
 */
private fun sharedStrings(bytes: ByteArray?): List<String> {
    if (bytes == null) { return emptyList() }
    val strings = mutableListOf<String>()
    val current = StringBuilder()
    var inItem = false
    var inText = false
    val reader = parser(bytes)
    var event = reader.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
            XmlPullParser.START_TAG -> when (reader.name) {
                "si" -> { inItem = true; current.setLength(0) }
                "t" -> inText = true
            }
            XmlPullParser.TEXT -> if (inItem && inText) current.append(reader.text)
            XmlPullParser.END_TAG -> when (reader.name) {
                "t" -> inText = false
                "si" -> { strings.add(current.toString()); inItem = false }
            }
        }
        event = reader.next()
    }
    return strings
}

/** Maps a sheet name to the relationship id the workbook part records for it. */
private fun sheetRelationships(workbookXml: ByteArray): Map<String, String> {
    val byName = mutableMapOf<String, String>()
    val reader = parser(workbookXml)
    var event = reader.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        if (event == XmlPullParser.START_TAG && reader.name == "sheet") {
            val name = reader.getAttributeValue(null, "name")
            val relationship = reader.getAttributeValue(null, "r:id")
                ?: reader.getAttributeValue(null, "id")
            if (name != null && relationship != null) { byName[name] = relationship }
        }
        event = reader.next()
    }
    return byName
}

/** Maps a relationship id to the part path it targets. */
private fun relationshipTargets(relationshipsXml: ByteArray?): Map<String, String> {
    if (relationshipsXml == null) { return emptyMap() }
    val byId = mutableMapOf<String, String>()
    val reader = parser(relationshipsXml)
    var event = reader.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        if (event == XmlPullParser.START_TAG && reader.name == "Relationship") {
            val id = reader.getAttributeValue(null, "Id")
            val target = reader.getAttributeValue(null, "Target")
            if (id != null && target != null) { byId[id] = target }
        }
        event = reader.next()
    }
    return byId
}

/** `BC12` addresses column 55; only the letters matter. */
internal fun androidWorkbookColumnIndex(reference: String): Int {
    var index = 0
    for (character in reference) {
        if (!character.isLetter()) { break }
        index = index * 26 + (character.uppercaseChar() - 'A' + 1)
    }
    return if (index <= 0) 0 else index - 1
}

private fun parseSheet(
    name: String,
    sheetXml: ByteArray,
    strings: List<String>,
): AndroidWorkbookSheet {
    val grid = mutableListOf<MutableList<String>>()
    var row: MutableList<String>? = null
    var columnIndex = 0
    var cellType: String? = null
    var value = StringBuilder()
    var inValue = false

    val reader = parser(sheetXml)
    var event = reader.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
            XmlPullParser.START_TAG -> when (reader.name) {
                "row" -> row = mutableListOf()
                "c" -> {
                    cellType = reader.getAttributeValue(null, "t")
                    val reference = reader.getAttributeValue(null, "r")
                    columnIndex = if (reference == null) {
                        row?.size ?: 0
                    } else {
                        androidWorkbookColumnIndex(reference)
                    }
                    value = StringBuilder()
                }
                // `v` is a stored or cached value; `t` appears inside an inline string.
                "v", "t" -> inValue = true
            }
            XmlPullParser.TEXT -> if (inValue) value.append(reader.text)
            XmlPullParser.END_TAG -> when (reader.name) {
                "v", "t" -> inValue = false
                "c" -> {
                    val raw = value.toString()
                    val resolved = if (cellType == "s") {
                        raw.trim().toIntOrNull()?.let { strings.getOrNull(it) } ?: ""
                    } else {
                        raw
                    }
                    val target = row
                    if (target != null) {
                        while (target.size <= columnIndex) { target.add("") }
                        target[columnIndex] = resolved.trim()
                    }
                }
                "row" -> {
                    row?.let { grid.add(it) }
                    row = null
                }
            }
        }
        event = reader.next()
    }

    if (grid.isEmpty()) {
        return AndroidWorkbookSheet(name, emptyList(), emptyList())
    }
    val headers = grid.first().map { it.trim() }
    val rows = grid.drop(1)
        .filter { cells -> cells.any { it.isNotBlank() } }
        .map { cells ->
            headers.mapIndexed { index, header -> header to (cells.getOrNull(index) ?: "") }
                .filter { it.first.isNotEmpty() }
                .toMap()
        }
    return AndroidWorkbookSheet(name, headers, rows)
}

/** Reads the named sheets from an `.xlsx` byte stream. */
internal fun androidParseWorkbook(
    input: InputStream,
    sheetNames: List<String>,
    language: AndroidProductLanguage,
): AndroidWorkbookParse {
    val bytes = try {
        input.use { it.readBytes() }
    } catch (error: Exception) {
        return AndroidWorkbookParse.Failed(
            androidText(language, "The file could not be read.", "Het bestand kon niet worden gelezen."),
        )
    }
    return androidParseWorkbook(bytes, sheetNames, language)
}

internal fun androidParseWorkbook(
    bytes: ByteArray,
    sheetNames: List<String>,
    language: AndroidProductLanguage,
): AndroidWorkbookParse {
    if (!androidLooksLikeWorkbook(bytes)) {
        return AndroidWorkbookParse.Failed(
            androidText(language, "This is not an Excel workbook (.xlsx).", "Dit is geen Excel-werkmap (.xlsx)."),
        )
    }
    val entries = try {
        readZipEntries(bytes)
    } catch (error: Exception) {
        return AndroidWorkbookParse.Failed(
            androidText(language, "The Excel workbook could not be opened.", "De Excel-werkmap kon niet worden geopend."),
        )
    }
    val workbookXml = entries["xl/workbook.xml"]
        ?: return AndroidWorkbookParse.Failed(
            androidText(
                language,
                "The Excel workbook is missing its workbook definition.",
                "De Excel-werkmap mist zijn werkmapdefinitie.",
            ),
        )

    return try {
        val strings = sharedStrings(entries["xl/sharedStrings.xml"])
        val relationships = sheetRelationships(workbookXml)
        val targets = relationshipTargets(entries["xl/_rels/workbook.xml.rels"])
        val sheets = mutableMapOf<String, AndroidWorkbookSheet>()
        for (sheetName in sheetNames) {
            val relationship = relationships[sheetName]
                ?: return AndroidWorkbookParse.Failed(
                    androidText(
                        language,
                        "The sheet \"$sheetName\" is not in this workbook.",
                        "Het tabblad \"$sheetName\" staat niet in deze werkmap.",
                    ),
                )
            val target = targets[relationship]
                ?: return AndroidWorkbookParse.Failed(
                    androidText(
                        language,
                        "The sheet \"$sheetName\" could not be found.",
                        "Het tabblad \"$sheetName\" kon niet worden gevonden.",
                    ),
                )
            val path = if (target.startsWith("/")) {
                target.removePrefix("/")
            } else {
                "xl/" + target.removePrefix("./")
            }
            val sheetXml = entries[path]
                ?: return AndroidWorkbookParse.Failed(
                    androidText(
                        language,
                        "The sheet \"$sheetName\" is missing from the workbook.",
                        "Het tabblad \"$sheetName\" ontbreekt in de werkmap.",
                    ),
                )
            sheets[sheetName] = parseSheet(sheetName, sheetXml, strings)
        }
        AndroidWorkbookParse.Parsed(sheets)
    } catch (error: Exception) {
        AndroidWorkbookParse.Failed(
            androidText(language, "The Excel workbook could not be read.", "De Excel-werkmap kon niet worden gelezen."),
        )
    }
}

/** Reports the headers the sheet is missing, using the source's own list. */
internal fun androidWorkbookMissingHeaders(
    sheet: AndroidWorkbookSheet,
    required: List<String>,
): List<String> {
    val present = sheet.headers.map { it.trim().lowercase() }.toSet()
    return required.filter { !present.contains(it.trim().lowercase()) }
}
