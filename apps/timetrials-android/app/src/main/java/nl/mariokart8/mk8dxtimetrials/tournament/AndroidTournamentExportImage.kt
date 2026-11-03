package nl.mariokart8.mk8dxtimetrials.tournament

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxExportImageTokens
import java.io.ByteArrayOutputStream
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.ceil
import kotlin.math.floor

/**
 * Source-faithful Android port of the Manager's WhatsApp canvas export
 * (`assets/app.js`, `buildWhatsappPreviewModel` and
 * `downloadWhatsappPreviewPng`). Steps 4, 6, 8 and 10 deliberately build four
 * distinct pictures; their titles, columns, badges and row semantics differ.
 */
internal enum class AndroidExportMode { LAYOUT, RESULTS }

internal data class AndroidExportRow(
    val values: List<String>,
    val switchType: String? = null,
    val switchDotColor: Int? = null,
    val rankTierKeys: Map<Int, String> = emptyMap(),
    val positionRank: Int? = null,
    val medal: String = "",
) {
    operator fun get(index: Int): String = values[index]
}

internal data class AndroidExportTable(
    val heading: String,
    val participantCount: Int,
    val averageSkill: Double,
    val spreadPlus: Double,
    val spreadMinus: Double,
    val borderStart: Int,
    val borderEnd: Int,
    val rows: List<AndroidExportRow>,
    val groupTierKey: String? = null,
) {
    val stats: String get() = "Gem. SP: ${formatRankMetric(averageSkill)} · Spreiding: " +
        "+${formatRankMetric(spreadPlus)} / -${formatRankMetric(spreadMinus)}"
}

internal data class AndroidExportImageModel(
    val title: String,
    val subtitle: String,
    val headers: List<String>,
    val groups: List<AndroidExportTable>,
    val mode: AndroidExportMode,
    val isQualifier: Boolean,
)

private val PAGE_COLOR = Mk8dxExportImageTokens.page
private val CARD_COLOR = Mk8dxExportImageTokens.card
private val HEADER_COLOR = Mk8dxExportImageTokens.header
private val GROUP_COLOR = Mk8dxExportImageTokens.group
private val STATS_COLOR = Mk8dxExportImageTokens.stats
private val COLUMN_COLOR = Mk8dxExportImageTokens.column
private val TITLE_COLOR = Mk8dxExportImageTokens.title
private val CELL_COLOR = Mk8dxExportImageTokens.cell
private val SUBTITLE_COLOR = Mk8dxExportImageTokens.subtitle
private val HEADER_TEXT_COLOR = Mk8dxExportImageTokens.headerText
private val LINE_COLOR = Mk8dxExportImageTokens.line
private val PLUS_COLOR = Mk8dxExportImageTokens.plus
private val MINUS_COLOR = Mk8dxExportImageTokens.minus

private const val HEADER_HEIGHT = 80f
private const val GROUP_HEAD_HEIGHT = 32f
private const val STATS_HEIGHT = 26f
private const val COLUMN_HEAD_HEIGHT = 24f
private const val ROW_HEIGHT = 28f
private const val GROUP_GAP = 7f
private const val CELL_PADDING = 10f
private const val MARGIN = 14f
private const val RENDER_SCALE = 2f

/**
 * The narrowest table the picture is drawn around.
 *
 * The columns are measured from the longest text in them, so the picture used
 * to be a different width every night: a final standing with short names came
 * out 328 px wide, a qualifier 410, a seating 404. Shared one after another in
 * a chat, they read as pictures of different things.
 *
 * The widest of the three minimums is the floor, so an export never comes out
 * narrower than a qualifier's - a table under it is centred in the frame
 * rather than shrinking the whole card. One column and one width: the shape
 * the owner asked for, because that is what a phone shows whole.
 *
 * The twin of the site's `TOURNAMENT_EXPORT_MIN_TABLE_WIDTH`; the card on the
 * phone and the picture a Director exports have to be one picture.
 */
internal const val ANDROID_EXPORT_MIN_TABLE_WIDTH = 354f

/**
 * The measured columns, widened to fill the frame when the table falls under
 * the floor.
 *
 * Centring a narrow table in a wide card left it floating in the middle of
 * empty panel; the columns take the room instead, in proportion to what they
 * measured, so the picture is the same width every night and the table still
 * fills it. A table already at or over the floor is left exactly as measured -
 * the floor is a floor, never a cap.
 */
internal fun androidExportStretchedWidths(
    widths: List<Float>,
    minimum: Float = ANDROID_EXPORT_MIN_TABLE_WIDTH,
): List<Float> {
    val total = widths.sum()
    if (widths.isEmpty() || total <= 0f || total >= minimum) { return widths }
    val stretched = widths.map { width -> width + floor((minimum - total) * width / total) }.toMutableList()
    // Rounding leaves a pixel or two over; the widest column absorbs it.
    val widest = stretched.indices.maxByOrNull { stretched[it] } ?: 0
    stretched[widest] = stretched[widest] + (minimum - stretched.sum())
    return stretched
}

private val SeatPalettes = Mk8dxExportImageTokens.seatPalettes

private fun paint(size: Float, weight: Int, color: Int): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = size
    typeface = Typeface.create(Typeface.SANS_SERIF, if (weight >= 700) Typeface.BOLD else Typeface.NORMAL)
    this.color = color
}

private fun tierStyle(key: String?, soft: Boolean = false): Pair<Int, Int> {
    val base = Mk8dxExportImageTokens.tiers[key] ?: Mk8dxExportImageTokens.tiers.getValue("unknown")
    return (if (soft) (base and 0x00FFFFFF) or 0xA6000000.toInt() else base) to Mk8dxExportImageTokens.pillText
}

private fun podiumStyle(rank: Int?): Pair<Int, Int>? = when (rank) {
    1 -> Mk8dxExportImageTokens.podiumGold to Mk8dxExportImageTokens.pillText
    2 -> Mk8dxExportImageTokens.podiumSilver to Mk8dxExportImageTokens.pillText
    3 -> Mk8dxExportImageTokens.podiumBronze to Mk8dxExportImageTokens.pillText
    else -> null
}

private fun ellipsize(text: String, maxWidth: Float, textPaint: Paint): String {
    if (textPaint.measureText(text) <= maxWidth) return text
    var value = text
    while (value.length > 1 && textPaint.measureText("$value…") > maxWidth) value = value.dropLast(1)
    return "$value…"
}

internal fun androidExportColumnWidths(
    model: AndroidExportImageModel,
    minimums: List<Float>,
    measure: (String, Boolean) -> Float,
): List<Float> {
    val widths = MutableList(model.headers.size) { 0f }
    model.headers.forEachIndexed { index, header -> widths[index] = measure(header, true) + CELL_PADDING }
    model.groups.forEach { group ->
        group.rows.forEach { row ->
            row.values.forEachIndexed { index, value ->
                if (index < widths.size) {
                    val iconAllowance = if (model.mode == AndroidExportMode.LAYOUT && index == 0) 22f else 0f
                    widths[index] = maxOf(widths[index], measure(value, false) + CELL_PADDING + iconAllowance)
                }
            }
        }
    }
    return widths.mapIndexed { index, width -> maxOf(minimums.getOrElse(index) { 48f }, ceil(width)) }
}

internal fun androidExportMinimums(mode: String, isQualifier: Boolean): List<Float> = when {
    mode == "layout" -> listOf(84f, 36f, 42f, 72f, 42f, 72f)
    isQualifier -> listOf(72f, 54f, 94f, 82f, 52f)
    else -> listOf(72f, 54f, 94f, 52f)
}

internal fun androidRenderExportImage(
    model: AndroidExportImageModel,
    minimums: List<Float>,
    ns1Icon: Bitmap? = null,
    ns2Icon: Bitmap? = null,
): Bitmap {
    val headerPaint = paint(10f, 700, SUBTITLE_COLOR)
    val cellPaint = paint(10f, 600, CELL_COLOR)
    val boldCellPaint = paint(10f, 800, CELL_COLOR)
    val widths = androidExportStretchedWidths(
        androidExportColumnWidths(model, minimums) { text, isHeader ->
            (if (isHeader) headerPaint else boldCellPaint).measureText(text)
        },
    )
    val tableWidth = widths.sum()
    val logicalWidth = 56f + tableWidth
    val groupsHeight = model.groups.sumOf { group ->
        (GROUP_HEAD_HEIGHT + STATS_HEIGHT + COLUMN_HEAD_HEIGHT + maxOf(1, group.rows.size) * ROW_HEIGHT + GROUP_GAP).toDouble()
    }.toFloat()
    val logicalHeight = 32f + HEADER_HEIGHT + groupsHeight + 20f
    val bitmap = Bitmap.createBitmap(ceil(logicalWidth * RENDER_SCALE).toInt(), ceil(logicalHeight * RENDER_SCALE).toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(RENDER_SCALE, RENDER_SCALE)
    canvas.drawColor(PAGE_COLOR)

    val x0 = MARGIN
    canvas.drawRoundRect(RectF(x0, 16f, x0 + tableWidth + 40f, logicalHeight - 24f), 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = CARD_COLOR })
    canvas.drawRoundRect(RectF(x0 + 1f, 17f, x0 + tableWidth + 39f, 16f + HEADER_HEIGHT - 2f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = HEADER_COLOR })
    val centre = x0 + 20f + tableWidth / 2f
    canvas.drawText(model.title, centre, 48f, paint(18f, 700, TITLE_COLOR).apply { textAlign = Paint.Align.CENTER })
    canvas.drawText(model.subtitle, centre, 70f, paint(12f, 600, SUBTITLE_COLOR).apply { textAlign = Paint.Align.CENTER })

    var y = 16f + HEADER_HEIGHT + 8f
    val groupNamePaint = paint(13f, 700, Mk8dxExportImageTokens.groupName)
    val badgePaint = paint(10f, 700, Mk8dxExportImageTokens.badgeText)
    val statsPaint = paint(10f, 600, Mk8dxExportImageTokens.statsText)
    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LINE_COLOR; strokeWidth = 1f }
    model.groups.forEach { group ->
        val rowCount = maxOf(1, group.rows.size)
        val groupHeight = GROUP_HEAD_HEIGHT + STATS_HEIGHT + COLUMN_HEAD_HEIGHT + rowCount * ROW_HEIGHT
        val groupLeft = x0 + 20f
        canvas.drawRoundRect(RectF(groupLeft, y, groupLeft + tableWidth, y + groupHeight), 8f, 8f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GROUP_COLOR })
        canvas.drawRect(groupLeft, y, groupLeft + 6f, y + groupHeight, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(groupLeft, y, groupLeft, y + groupHeight, group.borderStart, group.borderEnd, Shader.TileMode.CLAMP)
        })
        if (model.isQualifier) {
            canvas.drawText(group.heading, groupLeft + 12f, y + 23f, groupNamePaint)
        } else {
            val (background, foreground) = tierStyle(group.groupTierKey)
            val labelPaint = paint(10f, 800, foreground)
            val labelWidth = maxOf(74f, labelPaint.measureText(group.heading) + 16f)
            canvas.drawRoundRect(RectF(groupLeft + 12f, y + 7f, groupLeft + 12f + labelWidth, y + 25f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = background })
            canvas.drawText(group.heading, groupLeft + 20f, y + 20f, labelPaint)
        }
        val participantsText = "${group.participantCount} deelnemers"
        val participantWidth = badgePaint.measureText(participantsText) + 12f
        val participantLeft = groupLeft + tableWidth - participantWidth - 8f
        canvas.drawRoundRect(RectF(participantLeft, y + 7f, participantLeft + participantWidth, y + 25f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Mk8dxExportImageTokens.badge })
        canvas.drawText(participantsText, participantLeft + 6f, y + 20f, badgePaint)

        val statsY = y + GROUP_HEAD_HEIGHT
        canvas.drawRect(groupLeft + 8f, statsY, groupLeft + tableWidth - 8f, statsY + STATS_HEIGHT, Paint().apply { color = STATS_COLOR })
        var statsX = groupLeft + 18f
        val prefix = "Gem. SP: ${formatRankMetric(group.averageSkill)} · Spreiding: "
        canvas.drawText(prefix, statsX, statsY + 18f, statsPaint)
        statsX += statsPaint.measureText(prefix)
        val plusPaint = paint(10f, 700, PLUS_COLOR)
        val plusText = "+${formatRankMetric(group.spreadPlus)}"
        canvas.drawText(plusText, statsX, statsY + 18f, plusPaint)
        statsX += plusPaint.measureText(plusText) + 8f
        canvas.drawText("/", statsX, statsY + 18f, statsPaint)
        statsX += statsPaint.measureText("/") + 8f
        canvas.drawText("-${formatRankMetric(group.spreadMinus)}", statsX, statsY + 18f, paint(10f, 700, MINUS_COLOR))

        val columnY = statsY + STATS_HEIGHT
        canvas.drawRect(groupLeft, columnY, groupLeft + tableWidth, columnY + COLUMN_HEAD_HEIGHT, Paint().apply { color = COLUMN_COLOR })
        var columnX = groupLeft
        model.headers.forEachIndexed { index, header ->
            headerPaint.color = HEADER_TEXT_COLOR
            if (model.mode == AndroidExportMode.LAYOUT && index == 1) {
                headerPaint.textAlign = Paint.Align.CENTER
                canvas.drawText(header, columnX + widths[index] / 2f, columnY + 17f, headerPaint)
                headerPaint.textAlign = Paint.Align.LEFT
            } else canvas.drawText(header, columnX + 8f, columnY + 17f, headerPaint)
            columnX += widths[index]
        }
        var rowY = columnY + COLUMN_HEAD_HEIGHT
        val rows = if (group.rows.isNotEmpty()) group.rows else listOf(emptyExportRow(model))
        rows.forEachIndexed { rowIndex, row ->
            if (rowIndex > 0) canvas.drawLine(groupLeft + 8f, rowY, groupLeft + tableWidth, rowY, linePaint)
            if (model.mode == AndroidExportMode.LAYOUT) drawLayoutRow(canvas, row, rowY, groupLeft, widths, cellPaint, boldCellPaint, ns1Icon, ns2Icon)
            else drawResultsRow(canvas, row, rowY, groupLeft, widths, cellPaint, boldCellPaint, model.isQualifier)
            rowY += ROW_HEIGHT
        }
        y += groupHeight + GROUP_GAP
    }
    return bitmap
}

private fun emptyExportRow(model: AndroidExportImageModel): AndroidExportRow = when {
    model.mode == AndroidExportMode.LAYOUT -> AndroidExportRow(listOf("-", "-", "-", "-", "-", "-"), switchType = "ns1")
    model.isQualifier -> AndroidExportRow(listOf("—", "#?", "Geen uitslag", "-", "-"))
    else -> AndroidExportRow(listOf("—", "#?", "Geen uitslag", "-"))
}

private fun drawLayoutRow(canvas: Canvas, row: AndroidExportRow, y: Float, left: Float, widths: List<Float>, cellPaint: Paint, boldPaint: Paint, ns1Icon: Bitmap?, ns2Icon: Bitmap?) {
    val centreY = y + ROW_HEIGHT / 2f
    var x = left
    canvas.drawCircle(x + 11f, centreY, 4f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = row.switchDotColor ?: SeatPalettes[0][1] })
    val icon = if (row.switchType == "ns2") ns2Icon else ns1Icon
    if (icon != null) {
        canvas.drawBitmap(icon, null, RectF(x + 20f, centreY - 6f, x + 32f, centreY + 6f), Paint(Paint.ANTI_ALIAS_FLAG))
        canvas.drawText(ellipsize(row[0], widths[0] - 42f, cellPaint), x + 36f, centreY + 4f, cellPaint)
    } else {
        val marker = if (row.switchType == "ns2") "[NS2]" else "[NS1]"
        canvas.drawText(ellipsize("$marker ${row[0]}", widths[0] - 24f, cellPaint), x + 18f, centreY + 4f, cellPaint)
    }
    x += widths[0]
    boldPaint.textAlign = Paint.Align.CENTER
    canvas.drawText(row[1], x + widths[1] / 2f, centreY + 4f, boldPaint)
    boldPaint.textAlign = Paint.Align.LEFT
    x += widths[1]
    drawTierPill(canvas, row[2], row.rankTierKeys[2], x, y, widths[2], boldPaint)
    x += widths[2]
    canvas.drawText(ellipsize(row[3], widths[3] - 16f, cellPaint), x + 8f, centreY + 4f, cellPaint)
    x += widths[3]
    drawTierPill(canvas, row[4], row.rankTierKeys[4], x, y, widths[4], boldPaint)
    x += widths[4]
    canvas.drawText(ellipsize(row[5], widths[5] - 16f, cellPaint), x + 8f, centreY + 4f, cellPaint)
}

private fun drawResultsRow(canvas: Canvas, row: AndroidExportRow, y: Float, left: Float, widths: List<Float>, cellPaint: Paint, boldPaint: Paint, qualifier: Boolean) {
    val centreY = y + ROW_HEIGHT / 2f
    var x = left
    val position = listOf(row.medal, row[0]).filter { it.isNotBlank() }.joinToString(" ")
    podiumStyle(row.positionRank)?.let { (background, foreground) ->
        canvas.drawRoundRect(RectF(x + 6f, y + 5f, x + widths[0] - 6f, y + 23f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = background })
        canvas.drawText(position, x + 12f, centreY + 4f, paint(10f, 800, foreground))
    } ?: canvas.drawText(position, x + 8f, centreY + 4f, boldPaint)
    x += widths[0]
    drawTierPill(canvas, row[1], row.rankTierKeys[1], x, y, widths[1], boldPaint)
    x += widths[1]
    canvas.drawText(ellipsize(row[2], widths[2] - 16f, cellPaint), x + 8f, centreY + 4f, cellPaint)
    x += widths[2]
    if (qualifier) {
        drawTierPill(canvas, row[3], row.rankTierKeys[3], x, y, widths[3], boldPaint, soft = false, alignLeft = true)
        x += widths[3]
        canvas.drawText("${row[4]} pt", x + 8f, centreY + 4f, boldPaint)
    } else canvas.drawText("${row[3]} pt", x + 8f, centreY + 4f, boldPaint)
}

private fun drawTierPill(canvas: Canvas, value: String, tierKey: String?, x: Float, y: Float, width: Float, textPaint: Paint, soft: Boolean = true, alignLeft: Boolean = false) {
    val (background, foreground) = tierStyle(tierKey, soft)
    canvas.drawRoundRect(RectF(x + 6f, y + 5f, x + width - 6f, y + 23f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = background })
    textPaint.color = foreground
    textPaint.textAlign = if (alignLeft) Paint.Align.LEFT else Paint.Align.CENTER
    canvas.drawText(ellipsize(value, width - 16f, textPaint), if (alignLeft) x + 12f else x + width / 2f, y + ROW_HEIGHT / 2f + 4f, textPaint)
    textPaint.color = CELL_COLOR
    textPaint.textAlign = Paint.Align.LEFT
}

internal fun androidExportImageBytes(bitmap: Bitmap): ByteArray {
    val output = ByteArrayOutputStream()
    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
    return output.toByteArray()
}

private fun androidExportPhaseLabel(stage: String, mode: AndroidExportMode): String = when {
    stage == "final" && mode == AndroidExportMode.LAYOUT -> "Eind Groep Indeling"
    stage == "final" -> "Resultaat Eind Groep"
    mode == AndroidExportMode.LAYOUT -> "Kwalificatie Indeling"
    else -> "Resultaat Kwalificatie"
}

private fun dutchEventDate(summary: AndroidTournamentSummary): String? {
    summary.eventDate?.split('-')?.takeIf { it.size == 3 }?.let { parts ->
        val year = parts[0].toIntOrNull()
        val month = parts[1].toIntOrNull()
        val day = parts[2].toIntOrNull()
        val months = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")
        if (year != null && month in 1..12 && day in 1..31) return "$day ${months[month!! - 1]} $year"
    }
    val start = summary.startAtMs ?: return null
    val calendar = Calendar.getInstance(
        TimeZone.getTimeZone(summary.timezone ?: "Europe/Amsterdam"),
        Locale.forLanguageTag("nl-NL"),
    )
    calendar.timeInMillis = start
    val months = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")
    return "${calendar.get(Calendar.DAY_OF_MONTH)} ${months[calendar.get(Calendar.MONTH)]} ${calendar.get(Calendar.YEAR)}"
}

/** "20:00" in the night's own timezone, when a start time was recorded. */
private fun dutchEventTime(summary: AndroidTournamentSummary): String? {
    val start = summary.startAtMs ?: return null
    val calendar = Calendar.getInstance(
        TimeZone.getTimeZone(summary.timezone ?: "Europe/Amsterdam"),
        Locale.forLanguageTag("nl-NL"),
    )
    calendar.timeInMillis = start
    return String.format(
        Locale.ROOT, "%02d:%02d",
        calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE),
    )
}

/**
 * The message a shared picture travels with.
 *
 * The picture already carries every name, every seat and every score, drawn
 * to be read. Repeating all of that as text underneath it filled the chat
 * with a wall nobody reads twice, so the message says only what the picture
 * cannot: which tournament, when, and which of the four boards this is.
 *
 * The twin of the site's `tournamentExportShareCaption`. Sharing the roster
 * as text is still its own act, in the format the group chat has read for
 * years - `androidTournamentWhatsAppText`.
 */
internal fun androidExportShareCaption(
    document: AndroidTournamentDocument,
    stage: String,
    mode: AndroidExportMode,
): String {
    val date = dutchEventDate(document.summary)
    val time = dutchEventTime(document.summary)
    val whenText = listOfNotNull(date, time).joinToString(" · ")
    return listOf(document.summary.name, whenText, "🏁 ${androidExportPhaseLabel(stage, mode)}")
        .filter { it.isNotEmpty() }
        .joinToString("\n")
}

private fun exportHeader(document: AndroidTournamentDocument, stage: String, mode: AndroidExportMode): Pair<String, String> {
    val date = dutchEventDate(document.summary)
    return "🏁 ${androidExportPhaseLabel(stage, mode)}" to (document.summary.name + if (date == null) "" else " · $date")
}

private fun exportGroupPalette(index: Int): Pair<Int, Int> = SeatPalettes[index % SeatPalettes.size].let { it.first() to it.last() }

internal fun androidLayoutImageModel(document: AndroidTournamentDocument, stage: String, @Suppress("UNUSED_PARAMETER") legacyTitle: String = ""): AndroidExportImageModel {
    val rankOf = document.participants.associate { it.playerId to it.seedRank }
    val cableByStation = androidUtpCableByStation(document)
    fun rankText(playerId: String?): String = playerId?.let { rankOf[it]?.let { rank -> "#$rank" } ?: "#?" } ?: "-"
    val (title, subtitle) = exportHeader(document, stage, AndroidExportMode.LAYOUT)
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.mapIndexed { groupIndex, group ->
        val consoles = group.members.mapNotNull { it.station }.map { it.ownerPlayerId to it.switchType }.distinct()
        val palette = SeatPalettes[groupIndex % SeatPalettes.size]
        val rows = consoles.mapIndexed { consoleIndex, (ownerId, switchType) ->
            val seats = group.members.filter { it.station?.ownerPlayerId == ownerId && it.station?.switchType == switchType }.sortedBy { it.station?.seatNumber ?: 0 }
            val station = seats.firstOrNull()?.station
            val cable = androidUtpCableNumber(cableByStation, ownerId, switchType)
            val first = seats.firstOrNull { it.station?.seatNumber == 1 }
            val second = seats.firstOrNull { it.station?.seatNumber == 2 }
            AndroidExportRow(
                listOf(station?.ownerDisplayName ?: ownerId, cable?.toString() ?: "-", rankText(first?.playerId), first?.displayName ?: "-", rankText(second?.playerId), second?.displayName ?: "-"),
                switchType.lowercase(Locale.ROOT), palette[consoleIndex % palette.size],
                mapOf(2 to tierForRank(first?.playerId?.let(rankOf::get)).key, 4 to tierForRank(second?.playerId?.let(rankOf::get)).key),
            )
        }
        val stats = androidGroupBoardStats(group, document.participants)
        val (borderStart, borderEnd) = exportGroupPalette(groupIndex)
        AndroidExportTable(group.name, group.members.size, stats.averageSkill, stats.spreadPlus, stats.spreadMinus, borderStart, borderEnd, rows, group.tierKey)
    }
    return AndroidExportImageModel(title, subtitle, listOf("Nintendo Switch", "UTP", "SP Rank", "Deelnemer 1", "SP Rank", "Deelnemer 2"), groups, AndroidExportMode.LAYOUT, stage != "final")
}

private fun qualifierDestinations(document: AndroidTournamentDocument): Map<String, Pair<String, String>> {
    val finalGroups = document.groups.filter { it.stage == "final" }.sortedBy { it.sequence }
    if (finalGroups.isNotEmpty()) return finalGroups.flatMapIndexed { index, group ->
        val tier = group.tierKey ?: TournamentTiers.getOrNull(index)?.key ?: "unknown"
        group.members.map { it.playerId to (group.name to tier) }
    }.toMap()
    val qualifiers = document.groups.filter { it.stage == "qualifier" }.sortedBy { it.sequence }
    val tierCount = qualifiers.size.coerceIn(1, TournamentTiers.size)
    val tiers = TournamentTiers.take(tierCount)
    val destinations = mutableMapOf<String, Pair<String, String>>()
    qualifiers.forEach { group ->
        val rows = group.standings.rows.sortedBy { it.rank }
        val base = rows.size / tierCount
        val slots = List(tierCount) { base + if (it < rows.size % tierCount) 1 else 0 }
        var rowIndex = 0
        slots.forEachIndexed { tierIndex, count -> repeat(count) {
            rows.getOrNull(rowIndex++)?.let { row -> destinations[row.playerId] = tiers[tierIndex].name to tiers[tierIndex].key }
        } }
    }
    return destinations
}

internal fun androidResultsImageModel(document: AndroidTournamentDocument, stage: String, @Suppress("UNUSED_PARAMETER") legacyTitle: String = ""): AndroidExportImageModel {
    val isQualifier = stage != "final"
    val participantById = document.participants.associateBy { it.playerId }
    val destinationOf = if (isQualifier) qualifierDestinations(document) else emptyMap()
    val (title, subtitle) = exportHeader(document, stage, AndroidExportMode.RESULTS)
    val groups = document.groups.filter { it.stage == stage }.sortedBy { it.sequence }.mapIndexed { groupIndex, group ->
        val rows = group.standings.rows.sortedBy { it.rank }.mapIndexed { index, standing ->
            val position = index + 1
            val participant = participantById[standing.playerId]
            val rankText = participant?.seedRank?.let { "#$it" } ?: "#?"
            val rankTier = tierForRank(participant?.seedRank).key
            val destination = destinationOf[standing.playerId] ?: ("-" to "unknown")
            AndroidExportRow(
                if (isQualifier) listOf("#$position", rankText, standing.displayName, destination.first, standing.points.toString())
                else listOf("#$position", rankText, standing.displayName, standing.points.toString()),
                rankTierKeys = if (isQualifier) mapOf(1 to rankTier, 3 to destination.second) else mapOf(1 to rankTier),
                positionRank = position,
                medal = if (isQualifier) "" else when (position) { 1 -> "🏆"; 2 -> "🥈"; 3 -> "🥉"; else -> "" },
            )
        }
        val stats = androidGroupBoardStats(group, document.participants)
        val (borderStart, borderEnd) = exportGroupPalette(groupIndex)
        AndroidExportTable(group.name, group.members.size, stats.averageSkill, stats.spreadPlus, stats.spreadMinus, borderStart, borderEnd, rows, group.tierKey ?: TournamentTiers.getOrNull(groupIndex)?.key)
    }
    return AndroidExportImageModel(
        title, subtitle,
        if (isQualifier) listOf("Positie", "SP Rank", "Deelnemer", "Naar Eindgroep", "Score") else listOf("Positie", "SP Rank", "Deelnemer", "Score"),
        groups, AndroidExportMode.RESULTS, isQualifier,
    )
}

internal fun androidExportFileName(document: AndroidTournamentDocument, stage: String, mode: AndroidExportMode): String {
    val tournament = document.summary.name.trim().lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "_").trim('_').ifBlank { "mk8dx_toernooi" }
    val phase = if (stage == "final") "eindgroepen" else "kwalificatie"
    val kind = if (mode == AndroidExportMode.LAYOUT) "indeling" else "uitslag"
    return "${tournament}_${phase}_${kind}.png"
}
