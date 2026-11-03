package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.androidDisambiguatedName
import nl.mariokart8.mk8dxtimetrials.ui.androidRepeatedDisplayNames
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxColorTokens
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

internal const val ANDROID_TOURNAMENT_FINISH_POSITIONS = 12

/**
 * Three at once, the same as the Time Trial half of Rank. Past three the bars
 * stop being readable on a phone, and the two halves should not disagree about
 * how many Players a comparison holds.
 */
private const val COMPARE_LIMIT = ANDROID_RANK_COMPARE_LIMIT
private const val COMPETITOR_LIMIT = 5

/** Enough to recognise the right person without turning the card into a list. */
internal const val ANDROID_TOURNAMENT_PICKER_LIMIT = 8

/**
 * The comparison series, the same three the web's chart and legend use for
 * series 1–3 (`ds-chart__bar[data-series]`). Product data, not decoration: the
 * colour in the legend is the colour of that Player's bar and of the edge down
 * their row.
 */
private val Mk8dxColorTokens.compareColors: List<Color>
    get() = listOf(groupChampion, groupTalent, groupWild)

private fun percentage(part: Int, whole: Int): String =
    if (whole == 0) "—" else "${Math.round(part * 100.0 / whole)}%"

private fun decimal(value: Double, digits: Int): String =
    String.format(Locale.US, "%.${digits}f", value)

internal fun androidTournamentAverageFinish(
    entry: AndroidTournamentStandingEntry,
): Double? = if (entry.races == 0) null else entry.finishPositionTotal.toDouble() / entry.races

internal fun androidTournamentAveragePoints(
    entry: AndroidTournamentStandingEntry,
): Double? = if (entry.races == 0) null else entry.points.toDouble() / entry.races

/**
 * Who the comparison opens on: you, then the rivals you follow. The comparison
 * people want first is almost always themselves against the people they already
 * chose to care about.
 */
internal fun androidTournamentDefaultSelection(
    entries: List<AndroidTournamentStandingEntry>,
    viewerPlayerId: String?,
    rivalPlayerIds: Set<String>,
): List<String> {
    val own = entries.firstOrNull { it.playerId == viewerPlayerId }?.playerId
    val chosen = (listOfNotNull(own) + entries
        .filter { it.playerId in rivalPlayerIds && it.playerId != own }
        .map { it.playerId })
        .take(COMPARE_LIMIT)
    return chosen.ifEmpty { entries.take(1).map { it.playerId } }
}

/**
 * Which player the Tournament cards are about. A reference may be a player id
 * or the screen name the standing carries, matched the way the Web matches the
 * `?ranking=tournament&player=` it is handed, so the same link means the same
 * person on both clients.
 *
 * Falling back is deliberate: an unknown name lands on you rather than on
 * nothing, and a signed-out visitor lands on the Player at the top so the
 * section still shows what it is for.
 */
internal fun androidTournamentFocus(
    entries: List<AndroidTournamentStandingEntry>,
    reference: String?,
    viewerPlayerId: String?,
): AndroidTournamentStandingEntry? {
    val wanted = reference?.trim()?.lowercase()?.takeIf(String::isNotEmpty)
    val named = if (wanted == null) null else entries.firstOrNull {
        it.playerId.lowercase() == wanted || it.username.lowercase() == wanted
    }
    return named
        ?: entries.firstOrNull { it.playerId == viewerPlayerId }
        ?: entries.firstOrNull()
}

/**
 * Finding somebody to look at. The standing already carries every Player who
 * has raced a finalized tournament, names included, so the search runs over
 * what is on the device: instant, and it still works with no signal.
 *
 * A name that starts with what was typed comes first, because that is what
 * somebody typing three letters is aiming at.
 */
internal fun androidTournamentPlayerMatches(
    entries: List<AndroidTournamentStandingEntry>,
    query: String,
    limit: Int = ANDROID_TOURNAMENT_PICKER_LIMIT,
): List<AndroidTournamentStandingEntry> {
    val wanted = query.trim().lowercase()
    if (wanted.length < 2) return emptyList()
    val hits = entries.filter {
        it.displayName.lowercase().contains(wanted) || it.username.lowercase().contains(wanted)
    }
    return hits.sortedWith(
        compareByDescending<AndroidTournamentStandingEntry> {
            it.displayName.lowercase().startsWith(wanted) || it.username.lowercase().startsWith(wanted)
        }.thenBy { it.rank },
    ).take(limit)
}

/**
 * What a Ranking opened for somebody else compares. The subject leads, and the
 * people they actually race fill the rest - not the rivals the reader happens
 * to follow, which used to put one person's charts under another's name.
 *
 * Only opponents who are in the standing can be charted, so the rest are
 * dropped rather than selected into an empty row.
 */
internal fun androidTournamentFocusSelection(
    entries: List<AndroidTournamentStandingEntry>,
    subjectPlayerId: String?,
    opponents: List<AndroidTournamentRivalry>,
): List<String> {
    if (subjectPlayerId == null) return emptyList()
    val known = entries.map { it.playerId }.toSet()
    if (subjectPlayerId !in known) return emptyList()
    return (
        listOf(subjectPlayerId) + opponents.map { it.playerId }
            .filter { it in known && it != subjectPlayerId }
        ).take(COMPARE_LIMIT)
}

/**
 * Days of grace before the inactivity rule starts reverting a rating toward
 * the start (ADR-0189). Missing one Tournament is 217 to 315 days, so a year
 * means one missed Tournament costs nothing.
 */
internal const val ANDROID_RATING_GRACE_DAYS = 365L

/**
 * Whether a Player's rating has started reverting. Marking it matters: without
 * the mark a reverted rating reads as somebody who simply got worse. The Web
 * marks the same Players by the same rule.
 */
internal fun androidRatingIsReverting(lastRaceAtMs: Long?, nowMs: Long): Boolean {
    if (lastRaceAtMs == null) return false
    return (nowMs - lastRaceAtMs) / 86_400_000L > ANDROID_RATING_GRACE_DAYS
}

/**
 * A comparison has one main Player - whose record the page shows - and at most
 * two others beside them (owner, 2026-09-17). The main Player always leads, so
 * no path leaves the page comparing two other people with each other.
 */
internal fun androidTournamentAnchoredSelection(
    selected: List<String>,
    subjectPlayerId: String?,
): List<String> =
    (listOfNotNull(subjectPlayerId) + selected.filter { it != subjectPlayerId })
        .distinct()
        .take(COMPARE_LIMIT)

/**
 * The main Player cannot be taken out; a third other replaces the oldest, the
 * same as the site.
 */
internal fun androidTournamentToggleSelection(
    selected: List<String>,
    playerId: String,
    subjectPlayerId: String? = null,
): List<String> {
    if (playerId == subjectPlayerId) {
        return androidTournamentAnchoredSelection(selected, subjectPlayerId)
    }
    val others = selected.filter { it != subjectPlayerId }
    val next = if (playerId in others) {
        others - playerId
    } else {
        (others + playerId).takeLast(COMPARE_LIMIT - if (subjectPlayerId == null) 0 else 1)
    }
    return listOfNotNull(subjectPlayerId) + next
}

/**
 * The rows the comparison cards draw. The main Player alone is their own
 * record. With others beside them every row is that Player's record over only
 * the races all of them finished; until that count is here, nothing is drawn
 * rather than the unfair career figures.
 */
internal fun androidTournamentComparedRows(
    entries: List<AndroidTournamentStandingEntry>,
    selected: List<String>,
    shared: AndroidTournamentSharedRaces?,
): List<AndroidTournamentStandingEntry> {
    val known = selected.mapNotNull { id -> entries.firstOrNull { it.playerId == id } }
    if (known.size <= 1) return known
    if (shared == null) return emptyList()
    return known.map { row ->
        val record = shared.entries.firstOrNull { it.playerId == row.playerId }
        if (record == null) {
            row.copy(
                races = 0, wins = 0, podiums = 0, points = 0, finishPositionTotal = 0,
                finishes = List(ANDROID_TOURNAMENT_FINISH_POSITIONS) { 0 },
            )
        } else {
            row.copy(
                races = record.races, wins = record.wins, podiums = record.podiums,
                points = record.points, finishPositionTotal = record.finishPositionTotal,
                finishes = record.finishes,
            )
        }
    }
}

/** The comparison's key: who is compared, in order; empty for one Player. */
internal fun androidTournamentComparisonKey(
    entries: List<AndroidTournamentStandingEntry>,
    selected: List<String>,
): List<String> {
    val known = selected.filter { id -> entries.any { it.playerId == id } }
    return if (known.size <= 1) emptyList() else known
}

/**
 * The Tournament half of Rank.
 *
 * Time Trials answers "how fast are you" against a clock. This answers "how do
 * you do against people": the skill the rating gives you, how often you win a
 * race, where your finishes land, and who you keep running into on a race
 * night. Same cards and the same Race Control palette as the Web.
 */
@Composable
internal fun AndroidTournamentStandingSection(
    entries: List<AndroidTournamentStandingEntry>,
    opponents: List<AndroidTournamentRivalry>,
    selectedPlayerIds: List<String>,
    viewerPlayerId: String?,
    /**
     * The player the skill, competitor and track cards are about. Null means
     * the viewer, which is what a person opening their own Ranking gets.
     */
    focusPlayerId: String? = null,
    rivalPlayerIds: Set<String>,
    language: AndroidProductLanguage,
    loading: Boolean,
    error: String?,
    onTogglePlayer: (String) -> Unit,
    /**
     * The comparison's records over the races every compared Player finished,
     * for [sharedFor]; null while it is on its way.
     */
    sharedRaces: AndroidTournamentSharedRaces? = null,
    sharedFor: List<String> = emptyList(),
    sharedFailed: Boolean = false,
    /**
     * Look at somebody else's tournament record. Null means "back to me".
     * The screen owns this because the rivalries and the track record have to
     * be fetched again for whoever is chosen.
     */
    onFocusPlayer: (String?) -> Unit = {},
    /** Open that Player's own page, the way a name on the site is a link. */
    onOpenPlayer: (String) -> Unit = {},
    /**
     * Rendered straight after the player's own skill card. The track record
     * belongs there rather than at the bottom - on the Web it sits in the same
     * place, and below the 61-row standing table nobody would ever scroll to
     * it.
     */
    afterOwnCard: @Composable () -> Unit = {},
) {
    if (error != null) {
        Text(error, modifier = Modifier.testTag("tournament-standing-error"))
        return
    }
    if (loading && entries.isEmpty()) {
        Text(
            androidText(language, "Loading the Tournament standing…", "Toernooistand laden…"),
            modifier = Modifier.testTag("tournament-standing-loading"),
        )
        return
    }
    if (entries.isEmpty()) {
        Text(androidText(
            language,
            "No finalized tournament has been raced yet.",
            "Er is nog geen toernooi afgerond.",
        ))
        return
    }
    Text(
        androidText(
            language,
            "${entries.size} Players, counted over every race in a finalized tournament.",
            "${entries.size} spelers, geteld over elke race in een afgerond toernooi.",
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
    )

    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val series = colors.compareColors
    val subjectId = focusPlayerId ?: viewerPlayerId
    val ownSubject = subjectId == viewerPlayerId

    var pickerQuery by rememberSaveable { mutableStateOf("") }
    Mk8dxPanel(androidText(language, "WHOSE RECORD", "WIENS RECORD")) {
        val subject = entries.firstOrNull { it.playerId == subjectId }
        Text(
            if (ownSubject || subject == null) {
                androidText(
                    language,
                    "You are looking at your own tournament record. Search a name to look at somebody else's.",
                    "Je kijkt naar je eigen toernooirecord. Zoek een naam om naar iemand anders te kijken.",
                )
            } else {
                androidText(
                    language,
                    "You are looking at ${subject.displayName}. The skill, competitors and tracks below are theirs.",
                    "Je kijkt naar ${subject.displayName}. Het niveau, de concurrenten en de banen hieronder zijn van hen.",
                )
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = pickerQuery,
            onValueChange = { pickerQuery = it },
            singleLine = true,
            label = {
                Text(androidText(language, "Search a Player", "Zoek een speler"))
            },
            modifier = Modifier.fillMaxWidth().testTag("tournament-focus-search"),
        )
        val matches = androidTournamentPlayerMatches(entries, pickerQuery)
        if (pickerQuery.trim().length >= 2 && matches.isEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                androidText(
                    language,
                    "Nobody by that name has raced a finalized tournament.",
                    "Niemand met die naam heeft een afgerond toernooi gereden.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        matches.forEach { match ->
            TextButton(
                onClick = {
                    onFocusPlayer(match.playerId)
                    pickerQuery = ""
                },
                modifier = Modifier.fillMaxWidth()
                    .testTag("tournament-focus-pick-${match.playerId}"),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(match.displayName, fontWeight = FontWeight.Bold)
                    Text(
                        androidText(
                            language,
                            "#${match.rank} · ${match.races} races",
                            "#${match.rank} · ${match.races} races",
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        if (!ownSubject && viewerPlayerId != null) {
            AssistChip(
                onClick = { onFocusPlayer(null) },
                label = { Text(androidText(language, "Back to me", "Terug naar mij")) },
                modifier = Modifier.testTag("tournament-focus-reset"),
            )
        }
    }
    Spacer(Modifier.height(12.dp))
    entries.firstOrNull { it.playerId == subjectId }?.let { own ->
        Mk8dxPanel(
            if (ownSubject) {
                androidText(language, "YOUR TOURNAMENT SKILL", "JOUW TOERNOOINIVEAU")
            } else {
                androidText(
                    language,
                    "${own.displayName.uppercase()} — TOURNAMENT SKILL",
                    "${own.displayName.uppercase()} — TOERNOOINIVEAU",
                )
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "#${own.rank}",
                    color = colors.textPrimary,
                    style = type.dataL,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    androidText(language, "of ${entries.size}", "van ${entries.size}"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                androidTournamentTierByRank(own.rank)?.let { tier ->
                    Spacer(Modifier.width(8.dp))
                    TournamentTierChip(tier)
                }
            }
            Spacer(Modifier.height(10.dp))
            val finish = androidTournamentAverageFinish(own)
            val points = androidTournamentAveragePoints(own)
            listOf(
                androidText(language, "Rating", "Rating") to
                    (own.score?.let { decimal(it, 2) }
                        ?: androidText(language, "Not rated yet", "Nog geen rating")),
                androidText(language, "Tournaments", "Toernooien") to own.tournaments.toString(),
                androidText(language, "Races", "Races") to own.races.toString(),
                androidText(language, "Wins", "Overwinningen") to
                    "${own.wins} · ${percentage(own.wins, own.races)}",
                androidText(language, "Top 3", "Top 3") to
                    "${own.podiums} · ${percentage(own.podiums, own.races)}",
                androidText(language, "Average finish", "Gem. finish") to
                    (finish?.let { decimal(it, 2) } ?: "—"),
                androidText(language, "Points per race", "Punten per race") to
                    (points?.let { decimal(it, 1) } ?: "—"),
            ).forEach { (label, value) ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        label,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(value, fontWeight = FontWeight.Bold)
                }
            }
            // The rest of what this Player has done. The APK has no public
            // profile screen of its own, so it opens the same page the Web
            // shows - which is what the account screen's own profile button
            // already does.
            val context = LocalContext.current
            val reference = own.username.ifEmpty { own.playerId }
            TextButton(
                onClick = {
                    openWebsite(
                        context,
                        "${nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin.current(context)}/?player=${Uri.encode(reference)}",
                    )
                },
                modifier = Modifier.testTag("tournament-open-profile"),
            ) {
                Text(
                    if (ownSubject) {
                        androidText(language, "Your full profile →", "Je volledige profiel →")
                    } else {
                        androidText(
                            language,
                            "${own.displayName}'s full profile →",
                            "Volledig profiel van ${own.displayName} →",
                        )
                    },
                )
            }
        }
    }

    afterOwnCard()

    if (opponents.isNotEmpty()) {
        val subjectName = entries.firstOrNull { it.playerId == subjectId }?.displayName
        Mk8dxPanel(
            if (ownSubject) {
                androidText(language, "YOUR TOP 5 COMPETITORS", "JOUW TOP 5 CONCURRENTEN")
            } else {
                androidText(language, "TOP 5 COMPETITORS", "TOP 5 CONCURRENTEN")
            },
        ) {
            Text(
                if (ownSubject || subjectName == null) {
                    androidText(
                        language,
                        "The Players you have shared the most races with, and how those races went.",
                        "De spelers met wie je de meeste races deelde, en hoe die races liepen.",
                    )
                } else {
                    androidText(
                        language,
                        "The Players $subjectName has shared the most races with, and how those races went.",
                        "De spelers met wie $subjectName de meeste races deelde, en hoe die races liepen.",
                    )
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(4.dp))
            // The three numbers on a row are otherwise unlabelled, and there
            // is no hover on a phone to explain them.
            Text(
                if (ownSubject || subjectName == null) {
                    androidText(
                        language,
                        "Races finished ahead-behind, then how many races were shared. The last number is race points per shared race: -1.7 means you score 1.7 fewer than that opponent, on average.",
                        "Races voor-achter geëindigd, daarna hoeveel races gedeeld zijn. Het laatste getal is racepunten per gedeelde race: -1,7 betekent dat jij er gemiddeld 1,7 minder scoort dan die tegenstander.",
                    )
                } else {
                    androidText(
                        language,
                        "Races finished ahead-behind, then how many races were shared. The last number is race points per shared race: -1.7 means $subjectName scores 1.7 fewer than that opponent, on average.",
                        "Races voor-achter geëindigd, daarna hoeveel races gedeeld zijn. Het laatste getal is racepunten per gedeelde race: -1,7 betekent dat $subjectName er gemiddeld 1,7 minder scoort dan die tegenstander.",
                    )
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(8.dp))
            opponents.take(COMPETITOR_LIMIT).forEach { opponent ->
                // The Web links these names; here the row itself is the link,
                // so the person you keep racing is one tap away.
                Column(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = entries.any { it.playerId == opponent.playerId }) {
                            onFocusPlayer(opponent.playerId)
                        }
                        .padding(vertical = 4.dp)
                        .testTag("tournament-competitor-${opponent.playerId}"),
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(opponent.displayName, fontWeight = FontWeight.Bold)
                        Text("${opponent.ahead}–${opponent.behind}", fontWeight = FontWeight.Black)
                    }
                    Spacer(Modifier.height(3.dp))
                    // One bar: how much of the decided racing you came out in front of.
                    val decided = opponent.ahead + opponent.behind
                    val share = if (decided == 0) .5f else opponent.ahead.toFloat() / decided
                    Row(
                        Modifier.fillMaxWidth().height(5.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        if (share > 0f) {
                            Box(
                                Modifier.weight(share).fillMaxWidth().height(5.dp)
                                    .background(colors.deltaFaster),
                            )
                        }
                        if (share < 1f) {
                            Box(Modifier.weight(1f - share).fillMaxWidth().height(5.dp))
                        }
                    }
                    Spacer(Modifier.height(3.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            androidText(
                                language,
                                "${opponent.sharedRaces} races",
                                "${opponent.sharedRaces} races",
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            (if (opponent.averagePointsDelta >= 0) "+" else "") +
                                decimal(opponent.averagePointsDelta, 1),
                            color = if (opponent.averagePointsDelta >= 0) {
                                colors.deltaFaster
                            } else {
                                colors.deltaSlower
                            },
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }

    val compared = androidTournamentAnchoredSelection(
        selectedPlayerIds.filter { id -> entries.any { it.playerId == id } },
        subjectId?.takeIf { id -> entries.any { it.playerId == id } },
    )
    val comparisonKey = androidTournamentComparisonKey(entries, compared)
    val shared = sharedRaces?.takeIf { sharedFor == comparisonKey && comparisonKey.isNotEmpty() }
    val shown = androidTournamentComparedRows(entries, compared, shared)
    val names = compared.mapNotNull { id -> entries.firstOrNull { it.playerId == id }?.displayName }
    // What every comparison card was counted over, and whether it can draw.
    val scope: Pair<String, Boolean> = when {
        comparisonKey.isEmpty() -> androidText(
            language,
            "Counted over every race in a finalized tournament.",
            "Geteld over elke race in een afgerond toernooi.",
        ) to true
        shared == null && sharedFailed -> androidText(
            language,
            "The shared races could not be counted. Retry later.",
            "De gezamenlijke races konden niet worden geteld. Probeer het later opnieuw.",
        ) to false
        shared == null -> androidText(
            language, "Counting the races these Players share…", "De gezamenlijke races tellen…",
        ) to false
        else -> {
            val joinedEn = names.dropLast(1).joinToString(", ") + " and " + names.last()
            val joinedNl = names.dropLast(1).joinToString(", ") + " en " + names.last()
            val count = shared.sharedRaces
            val raceWord = if (count == 1) "race" else "races"
            when {
                count == 0 -> androidText(
                    language,
                    "$joinedEn have never finished a race together, so there is nothing fair to compare.",
                    "$joinedNl hebben nooit samen een race gereden, dus er valt niets eerlijk te vergelijken.",
                ) to false
                names.size == 2 -> androidText(
                    language,
                    "Counted over only the $count $raceWord $joinedEn both finished.",
                    "Alleen geteld over de $count $raceWord die $joinedNl allebei reden.",
                ) to true
                else -> androidText(
                    language,
                    "Counted over only the $count $raceWord $joinedEn all finished.",
                    "Alleen geteld over de $count $raceWord die $joinedNl alle drie reden.",
                ) to true
            }
        }
    }
    val drawable = scope.second && shown.isNotEmpty()
    @Composable
    fun ScopeNote() {
        Text(
            scope.first,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp).testTag("tournament-compare-scope"),
        )
    }
    if (compared.isNotEmpty()) {
        Mk8dxPanel(
            if (ownSubject) {
                androidText(language, "WHERE YOUR FINISHES LAND", "WAAR JE FINISHES LANDEN")
            } else {
                androidText(language, "WHERE THE FINISHES LAND", "WAAR DE FINISHES LANDEN")
            },
        ) {
            Text(
                androidText(
                    language,
                    "How often each finishing position happened.",
                    "Hoe vaak elke finishpositie voorkwam.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            ScopeNote()
            if (!drawable) return@Mk8dxPanel
            Spacer(Modifier.height(8.dp))
            val highest = maxOf(1, shown.maxOf { row -> row.finishes.maxOrNull() ?: 0 })
            Row(
                Modifier.fillMaxWidth().height(96.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                (1..ANDROID_TOURNAMENT_FINISH_POSITIONS).forEach { position ->
                    Column(
                        Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Row(
                            Modifier.fillMaxWidth().height(78.dp),
                            horizontalArrangement = Arrangement.spacedBy(1.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            shown.forEachIndexed { index, row ->
                                val count = row.finishes.getOrElse(position - 1) { 0 }
                                val fraction = (count.toFloat() / highest).coerceIn(0f, 1f)
                                Column(
                                    Modifier.weight(1f),
                                    verticalArrangement = Arrangement.Bottom,
                                ) {
                                    if (fraction < 1f) Spacer(Modifier.weight(1f - fraction))
                                    Box(
                                        Modifier.fillMaxWidth()
                                            .weight(maxOf(fraction, .02f))
                                            .background(series[index % series.size]),
                                    )
                                }
                            }
                        }
                        Text(
                            position.toString(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 9.sp,
                        )
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                shown.forEachIndexed { index, row ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.width(10.dp).height(10.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(series[index % series.size]),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(row.displayName, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }

    if (compared.isNotEmpty()) {
        Mk8dxPanel(
            if (ownSubject) {
                androidText(language, "HOW YOUR RACES END", "HOE JE RACES EINDIGEN")
            } else {
                androidText(language, "HOW THE RACES END", "HOE DE RACES EINDIGEN")
            },
        ) {
            Text(
                androidText(
                    language,
                    "Every race split into a win, the rest of the podium, and everything else.",
                    "Elke race verdeeld over winst, de rest van het podium, en al het andere.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            ScopeNote()
            if (!drawable) return@Mk8dxPanel
            Spacer(Modifier.height(8.dp))
            // The site names the three parts of the bar; without the legend a
            // reader has to guess which colour is which.
            Row(
                Modifier.fillMaxWidth().padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                listOf(
                    colors.rankGold to androidText(language, "wins", "winst"),
                    colors.rankSilver to androidText(language, "2nd/3rd", "2e/3e"),
                    colors.surfaceSelected to androidText(language, "rest", "rest"),
                ).forEach { (colour, label) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(colour),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            label,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            shown.forEach { row ->
                val wins = row.wins
                val otherPodium = maxOf(0, row.podiums - row.wins)
                val rest = maxOf(0, row.races - row.podiums)
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        row.displayName,
                        modifier = Modifier.width(72.dp),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                    Row(
                        Modifier.weight(1f).height(12.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        listOf(
                            wins to colors.rankGold,
                            otherPodium to colors.rankSilver,
                            rest to colors.surfaceSelected,
                        ).forEach { (count, colour) ->
                            if (count > 0 && row.races > 0) {
                                Box(
                                    Modifier.weight(count.toFloat() / row.races)
                                        .fillMaxWidth().height(12.dp).background(colour),
                                )
                            }
                        }
                    }
                    Text(
                        "${percentage(wins, row.races)} · ${percentage(row.podiums, row.races)}",
                        modifier = Modifier.width(78.dp).padding(start = 6.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                    )
                }
            }
        }

        Mk8dxPanel(androidText(language, "POINTS PER RACE", "PUNTEN PER RACE")) {
            val totalRaces = entries.sumOf { it.races }
            val totalPoints = entries.sumOf { it.points }
            val communityAverage =
                if (totalRaces == 0) 0.0 else totalPoints.toDouble() / totalRaces
            val highest = maxOf(
                communityAverage,
                shown.maxOfOrNull { androidTournamentAveragePoints(it) ?: 0.0 } ?: 0.0,
                1.0,
            )
            Text(
                androidText(
                    language,
                    "The line is the community average, ${decimal(communityAverage, 1)} per race.",
                    "De lijn is het communitygemiddelde, ${decimal(communityAverage, 1)} per race.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            ScopeNote()
            if (!drawable) return@Mk8dxPanel
            Spacer(Modifier.height(8.dp))
            shown.forEachIndexed { index, row ->
                val value = androidTournamentAveragePoints(row) ?: 0.0
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        row.displayName,
                        modifier = Modifier.width(72.dp),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                    Box(
                        Modifier.weight(1f).height(12.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Row(Modifier.fillMaxWidth().height(12.dp)) {
                            val share = (value / highest).coerceIn(0.0, 1.0).toFloat()
                            if (share > 0f) {
                                Box(
                                    Modifier.weight(share).fillMaxWidth().height(12.dp)
                                        .background(series[index % series.size]),
                                )
                            }
                            if (share < 1f) Box(Modifier.weight(1f - share))
                        }
                        // The community average, as a line to read yourself against.
                        Row(Modifier.fillMaxWidth().height(12.dp)) {
                            val mark = (communityAverage / highest).coerceIn(0.0, 1.0).toFloat()
                            if (mark > 0f) Box(Modifier.weight(mark))
                            Box(
                                Modifier.width(2.dp).height(12.dp)
                                    .background(MaterialTheme.colorScheme.onSurfaceVariant),
                            )
                            if (mark < 1f) Box(Modifier.weight(1f - mark))
                        }
                    }
                    Text(
                        decimal(value, 1),
                        modifier = Modifier.width(44.dp).padding(start = 6.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                    )
                }
            }
        }
    }

    Mk8dxPanel(androidText(language, "TOURNAMENT STANDING", "TOERNOOISTAND")) {
        val nowMs = System.currentTimeMillis()
        Text(
            androidText(
                language,
                "Tap + to compare up to two Players with the main Player (●).",
                "Tik op + om maximaal twee spelers met de hoofdspeler (●) te vergelijken.",
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        val columns = rememberScrollState()
        Column(Modifier.fillMaxWidth().horizontalScroll(columns)) {
            Row(Modifier.padding(bottom = 4.dp)) {
                TournamentCell("#", 28.dp, header = true)
                TournamentCell(androidText(language, "Player", "Speler"), 220.dp, header = true, start = true)
                TournamentCell(androidText(language, "Rating", "Rating"), 60.dp, header = true)
                TournamentCell(androidText(language, "Tour.", "Toern."), 46.dp, header = true)
                TournamentCell(androidText(language, "Races", "Races"), 50.dp, header = true)
                TournamentCell(androidText(language, "Wins", "Winst"), 46.dp, header = true)
                TournamentCell(androidText(language, "Top 3", "Top 3"), 48.dp, header = true)
                TournamentCell(androidText(language, "Avg", "Gem."), 48.dp, header = true)
            }
            // ADR-0218: two Players may share a name; the standing then shows whose is whose.
            val repeatedNames = androidRepeatedDisplayNames(entries.map { it.playerId to it.displayName })
            entries.forEach { entry ->
                val selected = entry.playerId in compared
                val main = entry.playerId == compared.firstOrNull()
                val shownName = androidDisambiguatedName(entry.displayName, entry.username, repeatedNames)
                // The site marks three things on a row and the phone marked
                // one: your own row is the design system's YouRow (personal
                // wash), a row in the comparison carries that comparison's own
                // series colour down its edge, and a rival you follow is marked
                // informationally.
                val compareColour = compared.indexOf(entry.playerId)
                    .takeIf { it >= 0 }
                    ?.let { series[it % series.size] }
                val edge = compareColour
                    ?: colors.statusInfo.takeIf { entry.playerId in rivalPlayerIds }
                Row(
                    Modifier.fillMaxWidth()
                        .background(
                            when {
                                entry.playerId == viewerPlayerId -> colors.personalWash
                                else -> Color.Transparent
                            },
                        )
                        .drawBehind {
                            if (edge != null) {
                                drawRect(edge, size = Size(2.dp.toPx(), size.height))
                            }
                        }
                        .padding(vertical = 3.dp)
                        .testTag("tournament-standing-row-${entry.playerId}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TournamentCell(entry.rank.toString(), 28.dp)
                    // The site gives a row two separate things: a + that adds
                    // the Player to the comparison, and their name, which is a
                    // link to their own page. The phone had only the toggle, so
                    // a name led nowhere. It prints the rank tier beside every
                    // name too, not only beside your own - which band a Player
                    // sits in is what the standing is for. A phone's column is
                    // too narrow to hold all three on one line, so the tier sits
                    // under the name.
                    Row(
                        Modifier.width(220.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // The main Player is what the others are compared
                        // with; their mark is fixed, not a toggle.
                        FilterChip(
                            selected = selected,
                            enabled = !main,
                            onClick = { onTogglePlayer(entry.playerId) },
                            label = {
                                Text(
                                    when {
                                        main -> "●"
                                        selected -> "−"
                                        else -> "+"
                                    },
                                    fontSize = 12.sp,
                                    // The ● is the main Player of the
                                    // comparison, so it carries series 1's
                                    // colour — the same one their bars have.
                                    color = if (main) series.first() else Color.Unspecified,
                                )
                            },
                            modifier = Modifier
                                .testTag("tournament-standing-pick-${entry.playerId}"),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            // The Web marks the same Players the same way.
                            if (androidRatingIsReverting(entry.lastRaceAtMs, nowMs)) {
                                "$shownName*"
                            } else {
                                shownName
                            },
                            fontSize = 11.sp,
                            maxLines = 1,
                            fontWeight = FontWeight.SemiBold,
                            // A link, marked the way the web marks one: an
                            // underline, so colour is never the only cue.
                            color = colors.textPrimary,
                            textDecoration = TextDecoration.Underline,
                            modifier = Modifier
                                .weight(1f, fill = false)
                                .clickable { onOpenPlayer(entry.playerId) }
                                .testTag("tournament-standing-open-${entry.playerId}"),
                        )
                        androidTournamentTierByRank(entry.rank)?.let { tier ->
                            Spacer(Modifier.width(6.dp))
                            TournamentTierChip(tier)
                        }
                    }
                    TournamentCell(entry.score?.let { decimal(it, 2) } ?: "—", 60.dp)
                    TournamentCell(entry.tournaments.toString(), 46.dp)
                    TournamentCell(entry.races.toString(), 50.dp)
                    TournamentCell(entry.wins.toString(), 46.dp)
                    TournamentCell(entry.podiums.toString(), 48.dp)
                    TournamentCell(
                        androidTournamentAverageFinish(entry)?.let { decimal(it, 2) } ?: "—",
                        48.dp,
                    )
                }
            }
        }
        if (entries.any { androidRatingIsReverting(it.lastRaceAtMs, nowMs) }) {
            Spacer(Modifier.height(6.dp))
            Text(
                androidText(
                    language,
                    "* has not raced in over a year. A rating reverts toward the start from there, and reaches it after three years away.",
                    "* heeft ruim een jaar niet gereden. Een rating keert vanaf dan terug naar de start, en is daar na drie jaar afwezigheid.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (rivalPlayerIds.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(
                androidText(
                    language,
                    "Your rivals open the comparison by default.",
                    "Je rivalen staan standaard in de vergelijking.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun TournamentCell(
    text: String,
    width: androidx.compose.ui.unit.Dp,
    header: Boolean = false,
    start: Boolean = false,
) {
    Text(
        text,
        modifier = Modifier.width(width).padding(horizontal = 3.dp),
        color = if (header) MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified,
        fontSize = if (header) 10.sp else 12.sp,
        fontWeight = if (header) FontWeight.Bold else FontWeight.Normal,
        maxLines = 1,
        textAlign = if (start) androidx.compose.ui.text.style.TextAlign.Start
        else androidx.compose.ui.text.style.TextAlign.End,
    )
}

/**
 * The site draws the tier as a chip in its own colour
 * (`.tournament-standing__tier`), not as bare text - which is what tells a
 * reader it is a label and not another number in the row. The ladder's colour
 * is product data; the design system's chip guarantees the label on it stays
 * readable in every appearance.
 */
@Composable
private fun TournamentTierChip(tier: AndroidTournamentTier) {
    Mk8dxTierChip(androidTournamentTierBadge(tier, LocalAndroidProductLanguage.current), tier.color, dense = true)
}
