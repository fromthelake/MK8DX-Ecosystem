package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/** Legacy aggregate comparison formatter retained for compatibility tests. */
internal fun androidComebackLines(comeback: AndroidHomeComeback): List<String> {
    val lines = mutableListOf<String>()
    val standing = comeback.timeTrials
    val previousStanding = standing.previousStanding
    if (previousStanding != null && previousStanding != standing.standing && standing.standing > 0) {
        val up = standing.standing < previousStanding
        lines += (if (up) "↑" else "↓") +
            " You moved from #" + previousStanding + " to #" + standing.standing + " in Time Trials 150cc"
    }
    for (rival in comeback.rivals) {
        val previous = rival.previous ?: continue
        val netTracks = rival.tracksAhead - previous.tracksAhead
        if (netTracks != 0) {
            lines += if (netTracks > 0) {
                "⚔ You gained " + netTracks + " track" + (if (netTracks == 1) "" else "s") +
                    " on " + rival.displayName
            } else {
                "⚔ " + rival.displayName + " gained " + (-netTracks) + " track" +
                    (if (netTracks == -1) "" else "s") + " on you"
            }
        }
        val deltaChange = rival.totalDeltaMs - previous.totalDeltaMs
        if (deltaChange != 0L) {
            val ahead = rival.totalDeltaMs >= 0
            val gap = androidAggregateGap(deltaChange)
            lines += if (deltaChange > 0) {
                if (ahead) "⏱ Your advantage over " + rival.displayName + " improved by " + gap
                else "⏱ Your gap to " + rival.displayName + " shrank by " + gap
            } else {
                if (ahead) "⏱ Your advantage over " + rival.displayName + " shrank by " + gap
                else "⏱ Your gap to " + rival.displayName + " grew by " + gap
            }
        }
    }
    return lines
}

/** Under a minute the web reports seconds; above it, a clock time. */
internal fun androidAggregateGap(milliseconds: Long): String {
    val absolute = kotlin.math.abs(milliseconds)
    if (absolute < 60_000) return String.format(Locale.ROOT, "%.3fs", absolute / 1000.0)
    val minutes = absolute / 60_000
    val seconds = (absolute % 60_000) / 1000
    val thousandths = absolute % 1000
    return String.format(Locale.ROOT, "%d:%02d.%03d", minutes, seconds, thousandths)
}

/** The emoji the web's reaction bar uses, so both clients name a reaction alike. */
private val androidReactionEmoji = mapOf(
    "laugh" to "😂", "very_funny" to "🤣", "crying" to "😭",
    "nervous" to "😅", "wow" to "😮", "unbelievable" to "😱",
    "cool" to "😎", "competitive" to "😤", "watching" to "👀",
    "fire" to "🔥", "fast" to "⚡", "rocket" to "🚀",
    "strong" to "💪", "clap" to "👏", "thumbs_up" to "👍",
    "trophy" to "🏆", "gold" to "🥇", "crown" to "👑",
    "target" to "🎯", "heart" to "❤️",
)

internal data class AndroidRecentKeyOutcome(
    val kind: AndroidRecentKeyEventKind,
    val targetName: String? = null,
    val deltaMs: Long? = null,
    val timeMs: Long? = null,
    val beforeRank: Int? = null,
    val afterRank: Int? = null,
    val english: String,
    val dutch: String,
)

internal data class AndroidRecentKeyEvent(
    val atMs: Long,
    val trackId: String,
    val mode: Int,
    val runId: String? = null,
    val primaryOutcome: AndroidRecentKeyOutcome,
    val secondaryOutcomes: List<AndroidRecentKeyOutcome>,
)

internal enum class AndroidRecentKeyEventKind { PASSED, GHOST, RANK, PB, FIRST }

private data class AndroidRecentKeyRun(
    val resultId: String?,
    val timeMs: Long,
    val atMs: Long,
)

private const val ANDROID_KEY_EVENT_WINDOW_MS = 7L * 24 * 60 * 60 * 1000
private const val ANDROID_KEY_EVENT_LIMIT = 15

private fun keyEventGap(milliseconds: Long, dutch: Boolean): String =
    androidAggregateGap(milliseconds).let { if (dutch) it.replace('.', ',') else it }

private fun keyEventPodiumMark(rank: Int): String = when (rank) {
    1 -> "🏆 "
    2 -> "🥈 "
    3 -> "🥉 "
    else -> ""
}

internal fun androidRecentKeyEvents(
    home: AndroidHomeBootstrap,
    nowMs: Long,
): List<AndroidRecentKeyEvent> {
    val comeback = home.comeback ?: return emptyList()
    val bestsByPlayer = home.trackBests?.players.orEmpty().associateBy { it.playerId }
    val events = mutableListOf<AndroidRecentKeyEvent>()
    val seen = mutableSetOf<String>()
    fun priority(kind: AndroidRecentKeyEventKind): Int = when (kind) {
        AndroidRecentKeyEventKind.PASSED -> 0
        AndroidRecentKeyEventKind.RANK -> 1
        AndroidRecentKeyEventKind.GHOST -> 2
        AndroidRecentKeyEventKind.PB,
        AndroidRecentKeyEventKind.FIRST,
        -> 3
    }
    fun add(
        story: AndroidActivityStory,
        run: AndroidRecentKeyRun,
        outcomes: List<AndroidRecentKeyOutcome>,
    ) {
        if (outcomes.isEmpty() || run.atMs < nowMs - ANDROID_KEY_EVENT_WINDOW_MS) return
        val key = if (run.resultId == null) {
            "${story.player.playerId}#${story.trackId}#${story.mode}#${run.atMs}#${run.timeMs}"
        } else {
            "${story.player.playerId}#${story.trackId}#${story.mode}#${run.resultId}"
        }
        if (!seen.add(key)) return
        val ordered = outcomes.withIndex()
            .sortedWith(compareBy<IndexedValue<AndroidRecentKeyOutcome>> { priority(it.value.kind) }.thenBy { it.index })
            .map { it.value }
        events += AndroidRecentKeyEvent(
            atMs = run.atMs,
            trackId = story.trackId,
            mode = story.mode,
            runId = run.resultId,
            primaryOutcome = ordered.first(),
            secondaryOutcomes = ordered.drop(1),
        )
    }
    home.stories?.stories.orEmpty()
        .filter {
            it.player.playerId == comeback.player.playerId && it.personalBest &&
                it.latestAtMs >= nowMs - ANDROID_KEY_EVENT_WINDOW_MS
        }
        .sortedByDescending { it.latestAtMs }
        .forEach { story ->
            val track = Schema9AndroidTrackCatalog.find(story.trackId)
            val name = track?.displayName ?: story.trackId
            val dutchName = track?.displayName?.let(AndroidDutchPresentationCatalog::translate) ?: name
            var runningBest: Long? = when {
                story.personalBestDeltaMs != null -> story.bestMs + story.personalBestDeltaMs
                story.playerDeltaMs != null -> story.bestMs - story.playerDeltaMs
                else -> null
            }
            val details = if (story.runDetails.isEmpty()) {
                listOf(AndroidRecentKeyRun(null, story.bestMs, story.latestAtMs))
            } else {
                story.runDetails.sortedWith(compareBy<AndroidActivityRun> { it.atMs }.thenBy { it.resultId })
                    .map { AndroidRecentKeyRun(it.resultId, it.timeMs, it.atMs) }
            }
            val bestRunId = details.minWithOrNull(
                compareBy<AndroidRecentKeyRun> { it.timeMs }
                    .thenBy { it.atMs }
                    .thenBy { it.resultId ?: "" },
            )?.resultId
            details.forEach runLoop@{ detail ->
                val previous = runningBest
                if (previous != null && detail.timeMs > previous) return@runLoop
                val own = detail.timeMs
                val outcomes = mutableListOf<AndroidRecentKeyOutcome>()
                comeback.rivals.forEach rivalLoop@{ rival ->
                    val rivalTime = bestsByPlayer[rival.playerId]?.bests?.firstOrNull {
                        it.trackId == story.trackId && it.mode == story.mode
                    }?.totalTimeMs ?: return@rivalLoop
                    val crossed = (
                        detail.resultId == bestRunId &&
                            story.rank?.passed?.any { it.playerId == rival.playerId } == true
                        ) || (previous != null && previous >= rivalTime && own < rivalTime)
                    if (crossed) {
                        val lead = rivalTime - own
                        outcomes += AndroidRecentKeyOutcome(
                            kind = AndroidRecentKeyEventKind.PASSED,
                            targetName = rival.displayName,
                            deltaMs = own - rivalTime,
                            english = if (lead > 0) "⚔ $name: passed ${rival.displayName} ✓ · lead ${keyEventGap(lead, false)}."
                            else if (lead == 0L) "⚔ $name: passed ${rival.displayName} ✓ · currently tied."
                            else "⚔ $name: passed ${rival.displayName} in this run ✓ · currently ${keyEventGap(-lead, false)} behind.",
                            dutch = if (lead > 0) "⚔ $dutchName: ${rival.displayName} gepasseerd ✓ · voorsprong ${keyEventGap(lead, true)}."
                            else if (lead == 0L) "⚔ $dutchName: ${rival.displayName} gepasseerd ✓ · momenteel gelijk."
                            else "⚔ $dutchName: ${rival.displayName} met deze run gepasseerd ✓ · momenteel ${keyEventGap(-lead, true)} achter.",
                        )
                    }
                }
                val staff = AndroidBenchmarkCatalog.forTrack(story.trackId, story.mode)
                    .firstOrNull { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }?.timeMs
                if (staff != null && own < staff && (previous == null || previous >= staff)) {
                    outcomes += AndroidRecentKeyOutcome(
                        kind = AndroidRecentKeyEventKind.GHOST,
                        deltaMs = own - staff,
                        english = "👻 $name: Nintendo Ghost defeated ✓",
                        dutch = "👻 $dutchName: Nintendo Ghost verslagen ✓",
                    )
                }
                val rank = story.rank
                if (detail.resultId == bestRunId && rank?.before != null && rank.after < rank.before) {
                    outcomes += AndroidRecentKeyOutcome(
                        kind = AndroidRecentKeyEventKind.RANK,
                        beforeRank = rank.before,
                        afterRank = rank.after,
                        english = "🏁 $name: track rank: #${rank.before} → ${keyEventPodiumMark(rank.after)}#${rank.after}.",
                        dutch = "🏁 $dutchName: circuitrang: #${rank.before} → ${keyEventPodiumMark(rank.after)}#${rank.after}.",
                    )
                }
                val gain = previous?.minus(own)
                val time = Mk8dxNumeric.formatTime(own)
                if (gain == null || gain > 0L) {
                    outcomes += AndroidRecentKeyOutcome(
                        kind = if (gain == null) AndroidRecentKeyEventKind.FIRST else AndroidRecentKeyEventKind.PB,
                        deltaMs = gain?.let { -it },
                        timeMs = own,
                        english = if (gain == null) "⏱ $name: first published time, $time."
                        else "⏱ $name: new PB by ${keyEventGap(gain, false)} → $time.",
                        dutch = if (gain == null) "⏱ $dutchName: eerste gepubliceerde tijd, $time."
                        else "⏱ $dutchName: nieuwe PR met ${keyEventGap(gain, true)} → $time.",
                    )
                }
                add(story, detail, outcomes)
                runningBest = previous?.let { minOf(it, own) } ?: own
            }
        }
    return events.sortedWith(
        compareByDescending<AndroidRecentKeyEvent> { it.atMs }
            .thenBy { it.trackId }
            .thenBy { it.mode }
            .thenBy { it.runId ?: "" },
    ).take(ANDROID_KEY_EVENT_LIMIT)
}

@Composable
internal fun AndroidComebackStrip(
    home: AndroidHomeBootstrap,
    onOpenTrack: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val comeback = home.comeback ?: return
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val language = LocalAndroidProductLanguage.current
    val nowMs = remember(home) { System.currentTimeMillis() }
    val events = remember(home, nowMs) { androidRecentKeyEvents(home, nowMs) }
    val reactions = comeback.reactions
    var showAll by remember(home) { mutableStateOf(false) }
    val shown = if (showAll) events else events.take(5)
    Mk8dxPanel(
        androidText("Recent key events", "Recente belangrijke gebeurtenissen").uppercase(),
        modifier = modifier.testTag("home-away"),
    ) {
        if (shown.isEmpty()) {
            Text(
                androidText(
                    "No key events in the last 7 days.",
                    "Geen belangrijke gebeurtenissen in de afgelopen 7 dagen.",
                ),
                style = type.bodyS,
                color = colors.textSecondary,
            )
        }
        shown.forEach { event ->
            val track = Schema9AndroidTrackCatalog.find(event.trackId)
            Column(
                Modifier.fillMaxWidth()
                    .clickable { onOpenTrack(event.trackId) }
                    .padding(vertical = Mk8dxSpacing.xs),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    track?.let {
                        ProductAssetImage(
                            path = "private-product/img/cup/${it.index / 4}.png",
                            fallback = "C",
                            accent = colors.borderStrong,
                            modifier = Modifier.size(24.dp),
                            contentDescription = null,
                        )
                    }
                    Text(
                        track?.displayName ?: event.trackId,
                        modifier = Modifier.weight(1f),
                        style = type.bodyS.copy(fontWeight = FontWeight.Bold),
                        color = colors.textPrimary,
                    )
                    Mk8dxChip(androidText(language, "PB", "PR"), tone = Mk8dxChipTone.Success)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text("•", style = type.bodyS, color = colors.textTertiary)
                    Text(
                        androidRecentKeyOutcomeDetail(event.primaryOutcome, language),
                        modifier = Modifier.weight(1f),
                        style = type.bodyS,
                        color = colors.textBody,
                    )
                }
                if (event.secondaryOutcomes.isNotEmpty()) {
                    Column(
                        modifier = Modifier.padding(start = Mk8dxSpacing.sm),
                        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
                    ) {
                        event.secondaryOutcomes.forEach { outcome ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                                verticalAlignment = Alignment.Top,
                            ) {
                                Text("•", style = type.micro, color = colors.textTertiary)
                                Text(
                                    androidRecentKeyOutcomeDetail(outcome, language),
                                    modifier = Modifier.weight(1f),
                                    style = type.micro,
                                    color = colors.textTertiary,
                                )
                            }
                        }
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Mk8dxEngineMark(event.mode)
                    Text(
                        androidRelativeTime(event.atMs, nowMs, language),
                        style = type.micro,
                        color = colors.textTertiary,
                    )
                }
            }
        }
        if (events.size > 5) {
            Mk8dxButton(
                if (showAll) androidText("Show less", "Toon minder")
                else androidText("See all ${events.size}", "Bekijk alle ${events.size}"),
                { showAll = !showAll },
                variant = Mk8dxButtonVariant.Quiet,
                tag = "home-key-events-all",
            )
        }
        reactions?.let {
            val emoji = it.kinds.mapNotNull(androidReactionEmoji::get).joinToString(" ")
            Text(
                emoji + " " + it.count + " reaction" + (if (it.count == 1) "" else "s") +
                    " on " + it.resultCount + " of your Time Trials",
                style = type.bodyS,
                color = colors.textBody,
            )
        }
    }
}

@Composable
private fun androidRecentKeyOutcomeDetail(
    outcome: AndroidRecentKeyOutcome,
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
) = Mk8dxTheme.colors.let { colors -> buildAnnotatedString {
    fun appendDelta(value: Long) {
        val color = when {
            value < 0 -> colors.deltaFaster
            value > 0 -> colors.deltaSlower
            else -> colors.textTertiary
        }
        pushStyle(SpanStyle(color = color, fontWeight = FontWeight.SemiBold))
        append(Mk8dxNumeric.formatDelta(value))
        pop()
    }
    fun appendAchievementGap(value: Long, faster: Boolean) {
        pushStyle(SpanStyle(
            color = if (faster) colors.deltaFaster else colors.deltaSlower,
            fontWeight = FontWeight.SemiBold,
        ))
        append(keyEventGap(value, language.code == "nl"))
        pop()
    }
    when (outcome.kind) {
        AndroidRecentKeyEventKind.PASSED -> when {
            outcome.deltaMs == 0L -> append(androidText(
                language,
                "Passed ${outcome.targetName ?: "a rival"} ✓ · currently tied.",
                "${outcome.targetName ?: "Rivaal"} gepasseerd ✓ · momenteel gelijk.",
            ))
            outcome.deltaMs != null && outcome.deltaMs < 0 -> {
                append(androidText(language, "Passed ${outcome.targetName ?: "your rival"} ✓ · lead ", "${outcome.targetName ?: "Rivaal"} gepasseerd ✓ · voorsprong "))
                appendAchievementGap(outcome.deltaMs, faster = true)
                append(".")
            }
            else -> {
                append(androidText(language, "Passed ${outcome.targetName ?: "a rival"} in this run ✓ · currently ", "${outcome.targetName ?: "Rivaal"} met deze run gepasseerd ✓ · momenteel "))
                outcome.deltaMs?.let { appendAchievementGap(it, faster = false) }
                append(androidText(language, " behind.", " achter."))
            }
        }
        AndroidRecentKeyEventKind.GHOST -> append(androidText(
            language,
            "Nintendo Ghost defeated ✓",
            "Nintendo Ghost verslagen ✓",
        ))
        AndroidRecentKeyEventKind.RANK -> append(androidText(
            language,
            "Track rank: #${outcome.beforeRank ?: "?"} → ${outcome.afterRank?.let(::keyEventPodiumMark) ?: ""}#${outcome.afterRank ?: "?"}.",
            "Circuitrang: #${outcome.beforeRank ?: "?"} → ${outcome.afterRank?.let(::keyEventPodiumMark) ?: ""}#${outcome.afterRank ?: "?"}.",
        ))
        AndroidRecentKeyEventKind.PB -> {
            append(androidText(language, "PB improvement: ", "PR-verbetering: "))
            outcome.deltaMs?.let(::appendDelta)
            outcome.timeMs?.let { append(" → ${Mk8dxNumeric.formatTime(it)}") }
            append(".")
        }
        AndroidRecentKeyEventKind.FIRST -> append(androidText(
            language,
            "First published time${outcome.timeMs?.let { ": ${Mk8dxNumeric.formatTime(it)}" } ?: ""}.",
            "Eerste gepubliceerde tijd${outcome.timeMs?.let { ": ${Mk8dxNumeric.formatTime(it)}" } ?: ""}.",
        ))
    }
} }
