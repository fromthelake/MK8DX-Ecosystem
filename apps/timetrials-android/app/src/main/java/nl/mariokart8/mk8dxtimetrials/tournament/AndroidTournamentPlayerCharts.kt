package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.ceil
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * The five charts the site draws for every Player in a published report, with
 * the site's own captions and readouts.
 *
 * 1. Positie na race - the interim standing, 1 at the top, podium marks.
 * 2. Finishpositie - the actual finish, same shape.
 * 3. Top 3 totaalbenchmark - the gap to whoever holds first, second and third.
 * 4. The duel with the place above - one line, filled by side.
 * 5. Positieverdeling - how often each finish came up, and on which tracks.
 *
 * The wording is the site's, translated the same way, because a reader who
 * opens the same report on both should not have to work out that two different
 * sentences mean the same thing.
 */

private fun trackLabel(trackId: String?, dutch: Boolean): String {
    if (trackId == null) return if (dutch) "Baan niet vastgelegd" else "Track not recorded"
    return Schema9AndroidTrackCatalog.entries.firstOrNull { it.id == trackId }?.displayName
        ?: trackId.removePrefix("track.").replace('_', ' ')
}

private fun ordinal(value: Int, dutch: Boolean): String {
    if (dutch) return "${value}e"
    val suffix = when {
        value % 100 in 11..13 -> "th"
        value % 10 == 1 -> "st"
        value % 10 == 2 -> "nd"
        value % 10 == 3 -> "rd"
        else -> "th"
    }
    return "$value$suffix"
}

/**
 * "3e plek". The export prints a medal glyph on the first three; §15 and §17
 * give that job to the rank colours instead, and the chart draws its first
 * three points in them.
 */
private fun place(position: Int, dutch: Boolean): String =
    if (dutch) "${position}e plek" else "${ordinal(position, false)} place"

@Composable
internal fun AndroidReportPlayerCharts(
    player: AndroidReportPlayer,
    maxPosition: Int,
    dutch: Boolean,
    visibility: AndroidPublicReportVisibility,
    modifier: Modifier = Modifier,
) {
    if (player.rows.isEmpty()) return
    val accent = androidReportAccent(player.groupRank)
    val raceWord = "Race"
    val groupLabel = androidGroupLabel(player.groupName, player.groupTierKey, dutch)

    fun headRace(index: Int): String =
        "$raceWord ${player.rows.getOrNull(index)?.raceNumber ?: (index + 1)}"

    fun headLabel(index: Int): String =
        "$groupLabel · race ${player.rows.getOrNull(index)?.raceNumber ?: (index + 1)}"

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {

        // 1. Positie na race
        val standingMax = maxOf(maxPosition, player.rows.maxOf { it.positionAfter })
        Figure(
            title = if (dutch) "Positie na race" else "Position after race",
            caption = if (dutch) {
                "Toont na elke race de tussenstandpositie. Lager is beter: 1 staat bovenaan en de lijn volgt de ranking door het toernooi."
            } else {
                "Shows the interim standing position after each race. Lower is better: 1 is at the top and the line tracks ranking through the tournament."
            },
        ) {
            AndroidReportLineChart(
                series = listOf(
                    AndroidChartSeries(player.displayName, accent, player.rows.map { it.positionAfter.toDouble() }),
                ),
                points = player.rows.mapIndexed { index, row ->
                    AndroidChartPoint(
                        raceNumber = row.raceNumber,
                        label = row.raceNumber.toString(),
                        headRace = headRace(index),
                        headLabel = headLabel(index),
                        mode = AndroidChartReadout.PLACE_TRACK,
                        values = listOf(
                            AndroidChartValue(
                                label = player.displayName,
                                color = accent,
                                value = row.positionAfter.toDouble(),
                                display = (if (row.tiedAfter) (if (dutch) "G" else "T") else "") +
                                    place(row.positionAfter, dutch),
                                lines = listOf(
                                    trackLabel(row.trackId, dutch),
                                    if (dutch) "${row.totalAfter} punten" else "${row.totalAfter} points",
                                ),
                            ),
                        ),
                    )
                },
                yMin = 1.0,
                yMax = standingMax.toDouble(),
                yStep = if (standingMax > 12) 2.0 else 1.0,
                invert = true,
                podium = true,
                xLabel = raceWord,
                dutch = dutch,
            )
        }

        // 2. Finishpositie
        Figure(
            title = if (dutch) "Finishpositie" else "Finish position",
            caption = if (dutch) {
                "Toont de daadwerkelijke finishpositie per race. Hiermee zie je ritme, pieken en dips los van puntentotaal."
            } else {
                "Shows the actual finishing position per race, so you can read rhythm, peaks and dips separately from total points."
            },
        ) {
            AndroidReportLineChart(
                series = listOf(
                    AndroidChartSeries(player.displayName, accent, player.rows.map { it.position.toDouble() }),
                ),
                points = player.rows.mapIndexed { index, row ->
                    AndroidChartPoint(
                        raceNumber = row.raceNumber,
                        label = row.raceNumber.toString(),
                        headRace = headRace(index),
                        headLabel = headLabel(index),
                        mode = AndroidChartReadout.PLACE_TRACK,
                        values = listOf(
                            AndroidChartValue(
                                label = player.displayName,
                                color = accent,
                                value = row.position.toDouble(),
                                display = place(row.position, dutch),
                                lines = listOf(
                                    trackLabel(row.trackId, dutch),
                                    if (dutch) "${row.racePoints} punten" else "${row.racePoints} points",
                                ),
                            ),
                        ),
                    )
                },
                yMin = 1.0,
                yMax = maxPosition.toDouble(),
                yStep = if (maxPosition > 12) 2.0 else 1.0,
                invert = true,
                podium = true,
                xLabel = raceWord,
                dutch = dutch,
            )
        }

        // 3. Top 3 totaalbenchmark
        if (visibility.benchmark && player.benchmarkFirst.isNotEmpty()) {
            val labels = listOf(
                if (dutch) "Verschil met 1e" else "Delta vs 1st",
                if (dutch) "Verschil met 2e" else "Delta vs 2nd",
                if (dutch) "Verschil met 3e" else "Delta vs 3rd",
            )
            // The three benchmarks are first, second and third, so they carry
            // the rank colours the whole product uses for them.
            val colours = listOf(
                Mk8dxTheme.colors.rankGold,
                Mk8dxTheme.colors.rankSilver,
                Mk8dxTheme.colors.rankBronze,
            )
            val sets = listOf(player.benchmarkFirst, player.benchmarkSecond, player.benchmarkThird)
            val magnitude = maxOf(5, sets.flatten().maxOfOrNull { abs(it.delta) } ?: 0)
            val step = if (magnitude > 60) 20 else if (magnitude > 30) 10 else 5
            val limit = ceil(magnitude.toDouble() / step) * step
            Figure(
                title = if (dutch) "Top 3 totaalbenchmark" else "Top 3 total benchmark",
                caption = if (dutch) {
                    "Toont het puntenverschil met de actuele nummer 1, 2 en 3 per race. 0 is gelijk; positief betekent dat deze speler voorligt."
                } else {
                    "Shows the points delta versus the current 1st, 2nd and 3rd after each race. 0 is tied; positive means this player is ahead."
                },
            ) {
                AndroidReportLineChart(
                    series = sets.mapIndexed { rank, entries ->
                        AndroidChartSeries(labels[rank], colours[rank], entries.map { it.delta.toDouble() })
                    },
                    points = player.benchmarkFirst.indices.map { index ->
                        AndroidChartPoint(
                            raceNumber = player.rows.getOrNull(index)?.raceNumber ?: (index + 1),
                            label = (player.rows.getOrNull(index)?.raceNumber ?: (index + 1)).toString(),
                            headRace = headRace(index),
                            headLabel = headLabel(index),
                            mode = AndroidChartReadout.BENCHMARK,
                            values = sets.mapIndexed { rank, entries ->
                                val entry = entries.getOrNull(index)
                                val unit = if (dutch) "punten" else "points"
                                AndroidChartValue(
                                    label = labels[rank],
                                    color = colours[rank],
                                    value = (entry?.delta ?: 0).toDouble(),
                                    display = (if ((entry?.delta ?: 0) > 0) "+" else "") +
                                        "${entry?.delta ?: 0} $unit",
                                    lines = listOfNotNull(
                                        entry?.takeIf { it.displayName.isNotEmpty() }?.let {
                                            "P${rank + 1} · ${it.displayName} (${it.playerTotal} vs ${it.benchmarkTotal})"
                                        },
                                    ),
                                )
                            },
                        )
                    },
                    yMin = -limit,
                    yMax = limit,
                    yStep = step.toDouble(),
                    baseline = 0.0,
                    xLabel = raceWord,
                    dutch = dutch,
                )
            }
        }

        // 4. The duel with the place above
        val opponent = player.opponent
        if (visibility.duel && opponent != null && opponent.deltas.isNotEmpty()) {
            val magnitude = maxOf(5, opponent.deltas.maxOfOrNull { abs(it) } ?: 0)
            val step = if (magnitude > 60) 20 else if (magnitude > 30) 10 else 5
            val limit = ceil(magnitude.toDouble() / step) * step
            Figure(
                title = "#${player.groupRank} ${player.displayName} VS " +
                    "#${opponent.groupRank} ${opponent.displayName}",
                caption = if (dutch) {
                    "Toont per gedeelde race het puntverschil tussen twee spelers. Boven de nullijn ligt speler A voor, onder de nullijn speler B."
                } else {
                    "Shows the points gap between two players per shared race. Above the zero line player A leads, below it player B."
                },
            ) {
                AndroidReportLineChart(
                    series = listOf(
                        AndroidChartSeries(player.displayName, accent, opponent.deltas.map { it.toDouble() }),
                    ),
                    points = opponent.deltas.mapIndexed { index, delta ->
                        AndroidChartPoint(
                            raceNumber = player.rows.getOrNull(index)?.raceNumber ?: (index + 1),
                            label = (player.rows.getOrNull(index)?.raceNumber ?: (index + 1)).toString(),
                            headRace = headRace(index),
                            headLabel = headLabel(index),
                            mode = AndroidChartReadout.DELTA,
                            values = listOf(
                                AndroidChartValue(
                                    label = if (dutch) "${player.displayName} voor" else "${player.displayName} ahead",
                                    color = accent,
                                    value = delta.toDouble(),
                                    display = (if (delta > 0) "+" else "") +
                                        (if (dutch) "$delta punten" else "$delta points"),
                                ),
                                AndroidChartValue(
                                    label = if (dutch) "${opponent.displayName} voor" else "${opponent.displayName} ahead",
                                    color = androidReportAccent(opponent.groupRank),
                                    value = (-delta).toDouble(),
                                    display = (if (-delta > 0) "+" else "") +
                                        (if (dutch) "${-delta} punten" else "${-delta} points"),
                                ),
                            ),
                        )
                    },
                    yMin = -limit,
                    yMax = limit,
                    yStep = step.toDouble(),
                    baseline = 0.0,
                    duel = player.displayName to opponent.displayName,
                    xLabel = raceWord,
                    dutch = dutch,
                )
            }
        }

        // 5. Positieverdeling
        if (visibility.distribution) {
            Figure(
                title = if (dutch) "Positieverdeling" else "Position distribution",
                caption = if (dutch) {
                    "Toont hoe vaak elke finishpositie voorkwam. Tik op een balk voor aandeel en de banen waarop die positie is behaald."
                } else {
                    "Shows how often each finishing position occurred. Tap a bar for share and the tracks where that result happened."
                },
            ) {
                AndroidReportBarChart(
                    counts = player.distribution,
                    color = accent,
                    points = player.distribution.mapIndexed { index, count ->
                        val position = index + 1
                        val tracks = player.rows
                            .filter { it.position == position }
                            .groupingBy { trackLabel(it.trackId, dutch) }
                            .eachCount()
                            .entries
                            .sortedByDescending { it.value }
                            .joinToString(" · ") { (name, times) ->
                                if (times > 1) "$name ×$times" else name
                            }
                        AndroidChartPoint(
                            raceNumber = position,
                            label = position.toString(),
                            headRace = if (dutch) "Positie $position" else "Position $position",
                            headLabel = groupLabel,
                            mode = AndroidChartReadout.COMPACT,
                            values = listOfNotNull(
                                AndroidChartValue(
                                    label = if (dutch) "Aandeel" else "Share",
                                    color = accent,
                                    value = count.toDouble(),
                                    display = androidReportPercent(count, player.raceCount, dutch) +
                                        " (${count}x)",
                                ),
                                if (tracks.isEmpty()) null else AndroidChartValue(
                                    label = if (dutch) "Banen" else "Tracks",
                                    color = accent,
                                    value = count.toDouble(),
                                    display = tracks,
                                ),
                            ),
                        )
                    },
                    xLabel = if (dutch) "Finishpositie" else "Finish position",
                    dutch = dutch,
                )
            }
        }
    }
}

/**
 * A chart with its title and the sentence the site keeps behind the small
 * circled "i" beside it. The site puts that sentence in a `title` attribute,
 * which a mouse reveals by resting on it; a phone has nothing to rest, so the
 * bubble is a tap and the sentence opens under the title.
 */
@Composable
private fun Figure(title: String, caption: String, content: @Composable () -> Unit) {
    var explained by remember(title) { mutableStateOf(false) }
    val colors = Mk8dxTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Mk8dxSpacing.targetMin)
                .clickable(role = Role.Button) { explained = !explained }
                .semantics(mergeDescendants = true) { },
        ) {
            Text(
                title,
                style = Mk8dxTheme.type.title,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f, fill = true),
            )
            Text(
                "i",
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .border(1.dp, colors.borderStrong, CircleShape)
                    .size(20.dp)
                    .wrapContentHeight(),
            )
        }
        if (explained) {
            Text(caption, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        }
        content()
    }
}
