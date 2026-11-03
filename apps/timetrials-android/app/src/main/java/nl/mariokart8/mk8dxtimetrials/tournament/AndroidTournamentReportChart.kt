package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import androidx.compose.foundation.Canvas
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The report's charts, in the shape the community's own exported report uses.
 *
 * The site hand-builds SVG at the source's fixed viewBoxes and writes a small
 * table under the chart while the pointer moves across the races. A phone has
 * no pointer, so the same behaviour is reached by tapping a race or dragging
 * the scrubber; the readout underneath is the same table, with the same rows.
 *
 * The geometry is the site's: an 860x308 box with 56 left, 20 right, 20 top
 * and 42 bottom, so a chart drawn here and the same chart on the site have the
 * same proportions rather than merely the same data.
 */

/** How a readout lays its rows out, exactly as the source's runtime switches. */
internal enum class AndroidChartReadout { PLACE_TRACK, BENCHMARK, DELTA, COMPACT }

internal data class AndroidChartValue(
    /** The series this value belongs to: "Positie", "#1", the opponent's name. */
    val label: String,
    val color: Color,
    val value: Double,
    /** What the readout prints: "3e plek", "+12", "146 punten". */
    val display: String,
    /** Extra lines under the value: the track, a tie, the tracks behind a bar. */
    val lines: List<String> = emptyList(),
)

internal data class AndroidChartPoint(
    val raceNumber: Int,
    /** The x label under the chart, usually the race number. */
    val label: String,
    /** "Race 7" and, beside it, "Kampioen · race 7". */
    val headRace: String,
    val headLabel: String,
    val mode: AndroidChartReadout,
    val values: List<AndroidChartValue>,
)

internal data class AndroidChartSeries(
    val label: String,
    val color: Color,
    val values: List<Double>,
)

/**
 * The chart's own furniture (DESIGN_SYSTEM §15 Chart: one visual language).
 * It used to come in two sets, one for the report's paper and one for the dark
 * screen; there is one appearance now, so it is one set, read from the tokens.
 */
private data class ChartInk(
    val grid: Color,
    val tick: Color,
    val baseline: Color,
    val guide: Color,
    val gold: Color,
    val silver: Color,
    val bronze: Color,
)

@Composable
private fun chartInk(): ChartInk {
    val colors = Mk8dxTheme.colors
    return ChartInk(
        grid = colors.borderSubtle,
        tick = colors.textSecondary,
        baseline = colors.borderStrong,
        guide = colors.actionPrimary,
        gold = colors.rankGold,
        silver = colors.rankSilver,
        bronze = colors.rankBronze,
    )
}

/**
 * A line chart: races along the bottom, one line per series, the guide and the
 * readout following the race the reader picked.
 */
@Composable
internal fun AndroidReportLineChart(
    series: List<AndroidChartSeries>,
    points: List<AndroidChartPoint>,
    yMin: Double,
    yMax: Double,
    yStep: Double,
    xLabel: String,
    dutch: Boolean,
    invert: Boolean = false,
    podium: Boolean = false,
    baseline: Double? = null,
    duel: Pair<String, String>? = null,
    modifier: Modifier = Modifier,
) {
    val count = maxOf(1, series.maxOfOrNull { it.values.size } ?: 0, points.size)
    var selected by remember(points) { mutableIntStateOf(count - 1) }
    val ink = chartInk()
    val ahead = Mk8dxTheme.colors.statusSuccess
    val behind = Mk8dxTheme.colors.statusError

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Canvas(
            chartShell()
                .fillMaxWidth()
                .aspectRatio(860f / 308f)
                .pointerInput(count) {
                    detectTapGestures { offset ->
                        selected = nearestIndex(offset.x, size.width.toFloat(), count)
                    }
                },
        ) {
            drawReportLine(
                series = series,
                points = points,
                yMin = yMin,
                yMax = yMax,
                yStep = yStep,
                invert = invert,
                podium = podium,
                baseline = baseline,
                duel = duel,
                selected = selected,
                count = count,
                ink = ink,
                ahead = ahead,
                behind = behind,
            )
        }
        // The scrubber the source puts under every chart, so a reader can step
        // through the races without hunting for a point with a fingertip.
        if (count > 1) {
            ReportScrubber(
                selected = selected,
                count = count,
                onSelect = { selected = it },
            )
        }
        Text(
            xLabel,
            style = Mk8dxTheme.type.micro,
            color = ink.tick,
            modifier = Modifier.fillMaxWidth(),
        )
        points.getOrNull(selected)?.let { AndroidChartReadoutTable(it, dutch) }
    }
}

/** The surface a chart is drawn on: the system's own control surface. */
@Composable
private fun chartShell(): Modifier = Modifier
    .background(Mk8dxTheme.colors.surfaceControl)
    .border(1.dp, Mk8dxTheme.colors.borderSubtle)
    .padding(Mk8dxSpacing.xs)

/** The distribution's bars, with the same readout underneath. */
@Composable
internal fun AndroidReportBarChart(
    counts: List<Int>,
    color: Color,
    points: List<AndroidChartPoint>,
    xLabel: String,
    dutch: Boolean,
    modifier: Modifier = Modifier,
) {
    val count = maxOf(1, counts.size)
    var selected by remember(points) { mutableIntStateOf(0) }
    val ink = chartInk()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Canvas(
            chartShell()
                .fillMaxWidth()
                .aspectRatio(720f / 280f)
                .pointerInput(count) {
                    detectTapGestures { offset ->
                        val inner = size.width * (1f - (44f + 16f) / 720f)
                        val left = size.width * (44f / 720f)
                        val slot = inner / count
                        selected = (((offset.x - left) / slot).toInt()).coerceIn(0, count - 1)
                    }
                },
        ) {
            drawReportBars(counts, color, selected, ink)
        }
        Text(
            xLabel,
            style = Mk8dxTheme.type.micro,
            color = ink.tick,
            modifier = Modifier.fillMaxWidth(),
        )
        points.getOrNull(selected)?.let { AndroidChartReadoutTable(it, dutch) }
    }
}

/**
 * The scrubber under a chart.
 *
 * The site's is a native range input: a hairline track with a small round
 * thumb, coloured by the Player's accent. Material's slider is built for a
 * touch control and draws a bar four times that weight, which reads as a
 * progress bar rather than a scrubber and takes the chart's own place on the
 * page. This is the site's shape, on a row your thumb can still reach.
 */
@Composable
private fun ReportScrubber(
    selected: Int,
    count: Int,
    onSelect: (Int) -> Unit,
) {
    val accent = Mk8dxTheme.colors.actionPrimary
    val rail = Mk8dxTheme.colors.borderStrong
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(26.dp)
            .pointerInput(count) {
                fun pick(x: Float) {
                    val inset = 9.dp.toPx()
                    val span = (size.width - inset * 2).coerceAtLeast(1f)
                    val ratio = ((x - inset) / span).coerceIn(0f, 1f)
                    onSelect((ratio * (count - 1)).roundToInt().coerceIn(0, count - 1))
                }
                detectTapGestures { pick(it.x) }
            }
            .pointerInput(count) {
                detectHorizontalDragGestures { change, _ ->
                    val inset = 9.dp.toPx()
                    val span = (size.width - inset * 2).coerceAtLeast(1f)
                    val ratio = ((change.position.x - inset) / span).coerceIn(0f, 1f)
                    onSelect((ratio * (count - 1)).roundToInt().coerceIn(0, count - 1))
                }
            },
    ) {
        val inset = 9.dp.toPx()
        val middle = size.height / 2f
        val span = (size.width - inset * 2).coerceAtLeast(1f)
        val at = inset + span * (selected.toFloat() / (count - 1).coerceAtLeast(1))
        drawLine(rail, Offset(inset, middle), Offset(size.width - inset, middle), strokeWidth = 4f)
        drawLine(accent, Offset(inset, middle), Offset(at, middle), strokeWidth = 4f)
        drawCircle(accent, radius = inset, center = Offset(at, middle))
    }
}

/** The nearest race to a tap, as the source's runtime finds it. */
internal fun nearestIndex(x: Float, width: Float, count: Int): Int {
    if (count <= 1) return 0
    val left = width * (56f / 860f)
    val inner = width * (1f - (56f + 20f) / 860f)
    var best = 0
    var bestDistance = Float.MAX_VALUE
    for (index in 0 until count) {
        val candidate = left + (index.toFloat() / (count - 1)) * inner
        val distance = abs(candidate - x)
        if (distance < bestDistance) {
            bestDistance = distance
            best = index
        }
    }
    return best
}

private fun DrawScope.drawReportLine(
    series: List<AndroidChartSeries>,
    points: List<AndroidChartPoint>,
    yMin: Double,
    yMax: Double,
    yStep: Double,
    invert: Boolean,
    podium: Boolean,
    baseline: Double?,
    duel: Pair<String, String>?,
    selected: Int,
    count: Int,
    ink: ChartInk,
    ahead: Color,
    behind: Color,
) {
    val scale = size.width / 860f
    val left = 56f * scale
    val right = 20f * scale
    val top = 20f * scale
    val bottom = 42f * scale
    val innerWidth = size.width - left - right
    val innerHeight = size.height - top - bottom
    val span = maxOf(1.0, yMax - yMin)

    fun yOf(value: Double): Float {
        val ratio = ((value - yMin) / span).toFloat()
        return if (invert) top + ratio * innerHeight else top + (1f - ratio) * innerHeight
    }

    fun xOf(index: Int): Float =
        if (count <= 1) left + innerWidth / 2f
        else left + (index.toFloat() / (count - 1)) * innerWidth

    var tick = yMin
    while (tick <= yMax + 1e-9) {
        val y = yOf(tick)
        drawLine(ink.grid, Offset(left, y), Offset(size.width - right, y), strokeWidth = 1f)
        drawIntoCanvas { canvas ->
            val paint = android.graphics.Paint().apply {
                color = ink.tick.toArgb()
                textSize = 11f * scale * 1.6f
                textAlign = android.graphics.Paint.Align.RIGHT
                isAntiAlias = true
            }
            canvas.nativeCanvas.drawText(
                (if (tick == tick.toLong().toDouble()) tick.toLong().toString() else tick.toString()),
                left - 8f * scale,
                y + 4f * scale,
                paint,
            )
        }
        tick += yStep
    }
    if (baseline != null) {
        val y = yOf(baseline)
        drawLine(ink.baseline, Offset(left, y), Offset(size.width - right, y), strokeWidth = 2f)
    }

    if (duel != null && series.isNotEmpty()) {
        drawDuel(series.first(), ::xOf, ::yOf, yOf(baseline ?: 0.0), count, ahead, behind)
        // Both names on the chart, on their own side of the rule, so it is
        // plain who leads where without reading the readout first.
        drawIntoCanvas { canvas ->
            val paint = android.graphics.Paint().apply {
                textSize = 13f * scale * 1.6f
                isAntiAlias = true
                isFakeBoldText = true
                color = ink.tick.toArgb()
            }
            canvas.nativeCanvas.drawText(duel.first, left + 6f * scale, top + 16f * scale, paint)
            canvas.nativeCanvas.drawText(
                duel.second,
                left + 6f * scale,
                top + innerHeight - 6f * scale,
                paint,
            )
        }
    } else {
        for (line in series) {
            if (line.values.isEmpty()) continue
            val path = Path()
            line.values.forEachIndexed { index, value ->
                val x = xOf(index)
                val y = yOf(value)
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, line.color, style = Stroke(width = 2.5f * scale * 1.4f))
            line.values.forEachIndexed { index, value ->
                val x = xOf(index)
                val y = yOf(value)
                // §15: the first three places are the rank colours, not the
                // three medal glyphs - the same decision the tables took.
                val rank = if (podium) {
                    when (value.roundToInt()) {
                        1 -> ink.gold
                        2 -> ink.silver
                        3 -> ink.bronze
                        else -> null
                    }
                } else {
                    null
                }
                if (rank != null) {
                    drawCircle(rank, radius = 6.5f * scale * 1.4f, center = Offset(x, y))
                    drawCircle(line.color, radius = 3f * scale * 1.4f, center = Offset(x, y))
                } else {
                    drawCircle(line.color, radius = 4f * scale * 1.4f, center = Offset(x, y))
                }
            }
        }
    }

    // The guide the reader moved, drawn last so it is plain which race is read.
    if (selected in 0 until count) {
        val x = xOf(selected)
        drawLine(ink.guide, Offset(x, top), Offset(x, top + innerHeight), strokeWidth = 2f)
    }
}

/**
 * The duel: one line and the space between it and the zero rule filled by
 * side - green above where this Player leads, red below where the other does.
 */
private fun DrawScope.drawDuel(
    line: AndroidChartSeries,
    xOf: (Int) -> Float,
    yOf: (Double) -> Float,
    zero: Float,
    count: Int,
    ahead: Color,
    behind: Color,
) {
    if (line.values.isEmpty()) return
    val above = Path()
    val below = Path()
    above.moveTo(xOf(0), zero)
    below.moveTo(xOf(0), zero)
    line.values.forEachIndexed { index, value ->
        val x = xOf(index)
        val y = yOf(value)
        above.lineTo(x, minOf(y, zero))
        below.lineTo(x, maxOf(y, zero))
    }
    above.lineTo(xOf(line.values.size - 1), zero)
    below.lineTo(xOf(line.values.size - 1), zero)
    above.close()
    below.close()
    drawPath(above, ahead.copy(alpha = 0.2f))
    drawPath(below, behind.copy(alpha = 0.2f))
    val path = Path()
    line.values.forEachIndexed { index, value ->
        val x = xOf(index)
        val y = yOf(value)
        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    drawPath(path, line.color, style = Stroke(width = 3f))
}

private fun DrawScope.drawReportBars(
    counts: List<Int>,
    color: Color,
    selected: Int,
    ink: ChartInk,
) {
    val scale = size.width / 720f
    val left = 44f * scale
    val right = 16f * scale
    val top = 20f * scale
    val bottom = 40f * scale
    val innerWidth = size.width - left - right
    val innerHeight = size.height - top - bottom
    val highest = maxOf(1, counts.maxOrNull() ?: 0)
    val slot = innerWidth / maxOf(1, counts.size)
    counts.forEachIndexed { index, value ->
        val height = innerHeight * (value.toFloat() / highest)
        val x = left + index * slot
        drawRect(
            color = if (index == selected) color else color.copy(alpha = 0.55f),
            topLeft = Offset(x + slot * 0.15f, top + innerHeight - height),
            size = androidx.compose.ui.geometry.Size(slot * 0.7f, height),
        )
    }
    drawLine(
        ink.grid,
        Offset(left, top + innerHeight),
        Offset(size.width - right, top + innerHeight),
        strokeWidth = 1f,
    )
}

/**
 * The readout the source writes under a chart: a head naming the race, and one
 * row per value with its key, what it says, and the lines under it.
 */
@Composable
internal fun AndroidChartReadoutTable(point: AndroidChartPoint, dutch: Boolean) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Text(
                point.headRace,
                style = type.label.copy(fontWeight = FontWeight.Bold),
                color = colors.textPrimary,
            )
            Text(point.headLabel, style = type.bodyS, color = colors.textSecondary)
        }
        point.values.forEach { value ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                if (point.mode != AndroidChartReadout.PLACE_TRACK) {
                    Text(
                        value.label,
                        style = type.micro.copy(fontWeight = FontWeight.Bold),
                        color = value.color,
                    )
                }
                when (point.mode) {
                    // A place chart reads "1e plek 🏆 | Wii Boe-Boe-Boerenland":
                    // the place in its own column and the track beside it, as
                    // the source's two-column readout has it. What is left
                    // over - the running total - goes underneath.
                    AndroidChartReadout.PLACE_TRACK -> Column(Modifier.fillMaxWidth()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                            Text(
                                value.display,
                                style = type.data.copy(fontWeight = FontWeight.SemiBold),
                                color = colors.textPrimary,
                                modifier = Modifier.width(86.dp),
                            )
                            value.lines.firstOrNull()?.let {
                                Text(it, style = type.bodyS, color = colors.textSecondary)
                            }
                        }
                        value.lines.drop(1).forEach {
                            Text(it, style = type.bodyS, color = colors.textSecondary)
                        }
                    }
                    // The benchmark reads as one sentence on the right:
                    // "+18 punten · P2 · Matteo (300 vs 282)".
                    AndroidChartReadout.BENCHMARK -> Text(
                        (listOf(value.display) + value.lines).joinToString(" · "),
                        style = type.bodyS.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                    )
                    else -> Column(Modifier.fillMaxWidth()) {
                        Text(
                            value.display,
                            style = type.data.copy(fontWeight = FontWeight.SemiBold),
                            color = colors.textPrimary,
                        )
                        value.lines.forEach {
                            Text(it, style = type.bodyS, color = colors.textSecondary)
                        }
                    }
                }
            }
        }
    }
}

private fun DrawScope.drawIntoCanvas(block: (androidx.compose.ui.graphics.Canvas) -> Unit) {
    this.drawContext.canvas.let(block)
}
