package nl.mariokart8.mk8dxtimetrials.tournament

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidTournamentTierLabel
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * The Tournaments overview the Web shows, on the phone.
 *
 * The APK dropped a Director straight into the console at Step 0, so the two
 * clients answered different questions under the same tab name: the site asked
 * "which tournament night is this?" and the phone asked "which night am I
 * running?". This is the site's answer, brought across - the public list, the
 * shelf a night belongs on, and what the reader's own card says.
 *
 * The rules here are deliberately the same ones as
 * `apps/timetrials-web/src/tournaments-view.ts` and
 * `tournament-viewer-standing.ts`. Where a rule is subtle the comment says why,
 * because the two implementations have to be changed together.
 */

/** One night in the public list. Unknown keys are ignored by the decoder. */
@Serializable
internal data class AndroidPublicTournamentSummary(
    val tournamentId: String,
    val name: String,
    val editionNumber: Int? = null,
    val eventDate: String? = null,
    val stage: String,
    val startAtMs: Long? = null,
    val timezone: String? = null,
    val finalizedAtMs: Long? = null,
    val participantCount: Int = 0,
    val updatedAtMs: Long = 0,
    val workflowStep: Int? = null,
    val directorDisplayName: String? = null,
    val viewerParticipated: Boolean? = null,
    /**
     * Said only where it is false, and only to whoever may see the row at all:
     * a finished night the community cannot read yet.
     */
    val published: Boolean? = null,
    /** Whether that night counted toward the rating. Travels with published. */
    val affectsRating: Boolean? = null,
    /** True only on a night that was removed; its Director may put it back. */
    val removed: Boolean? = null,
)

@Serializable
internal data class AndroidPublicTournamentListResponse(
    @SerialName("schemaVersion") val schemaVersion: String,
    val tournaments: List<AndroidPublicTournamentSummary> = emptyList(),
)

@Serializable
internal data class AndroidPublicTournamentPlacement(
    val playerId: String,
    val placement: Int,
)

@Serializable
internal data class AndroidPublicTournamentPlacementSnapshot(
    val tournamentId: String,
    val fieldSize: Int,
    val placements: List<AndroidPublicTournamentPlacement> = emptyList(),
)

@Serializable
internal data class AndroidPublicTournamentPlacementsResponse(
    @SerialName("schemaVersion") val schemaVersion: String,
    val tournaments: List<AndroidPublicTournamentPlacementSnapshot> = emptyList(),
)

/** A night's public document: enough of it to answer "where do I sit?". */
@Serializable
internal data class AndroidPublicSeat(
    val playerId: String? = null,
    val displayName: String,
    val seatOrder: Int = 0,
    val stationOwnerPlayerId: String? = null,
    val stationOwnerDisplayName: String,
    val switchType: String,
    val seatNumber: Int,
    val seedRank: Int? = null,
    val character: AndroidPublicCharacter? = null,
)

@Serializable
internal data class AndroidPublicCharacter(
    val key: String? = null,
    val label: String,
    val roster: String? = null,
)

@Serializable
internal data class AndroidPublicStanding(
    val rank: Int,
    val playerId: String? = null,
    val displayName: String,
    val points: Int = 0,
    val races: Int = 0,
    val wins: Int = 0,
    val seedRank: Int? = null,
    val character: AndroidPublicCharacter? = null,
)

@Serializable
internal data class AndroidPublicPlacement(
    val finishPosition: Int,
    val playerId: String? = null,
    val displayName: String,
    val racePoints: Int = 0,
)

@Serializable
internal data class AndroidPublicRace(
    val raceNumber: Int = 0,
    val trackId: String? = null,
    val mode: String? = null,
    val countsTowardStandings: Boolean = true,
    val placements: List<AndroidPublicPlacement> = emptyList(),
)

@Serializable
internal data class AndroidPublicGroup(
    val groupId: String,
    val stage: String,
    val sequence: Int = 1,
    val name: String,
    /** Kampioen, Talent and the rest, when the Director named a tier. */
    val tierKey: String? = null,
    val seating: List<AndroidPublicSeat> = emptyList(),
    val standings: List<AndroidPublicStanding> = emptyList(),
    val races: List<AndroidPublicRace> = emptyList(),
)

@Serializable
internal data class AndroidPublicOverallRow(
    val placement: Int,
    val playerId: String? = null,
    val displayName: String,
)

/**
 * The community's own imported report for a past edition (TN4, TN7-TN12).
 *
 * A night the Director publishes through Step 11 carries its text on the
 * document itself, in `report`. The older editions were imported from the
 * community's own write-ups and their text lives in a static file the site
 * fetches separately, so the phone has to fetch it too or an old edition shows
 * its tables and none of its story.
 */
@Serializable
internal data class AndroidTournamentStoryPlayer(
    val rank: Int? = null,
    val name: String,
    val paragraphs: List<String> = emptyList(),
    val analysis: List<String> = emptyList(),
)

@Serializable
internal data class AndroidTournamentStoryFile(
    val schemaVersion: String = "",
    val stories: List<AndroidTournamentStory> = emptyList(),
)

@Serializable
internal data class AndroidTournamentStory(
    val edition: Int,
    val sourceUrl: String = "",
    val title: String,
    val intro: List<String> = emptyList(),
    val summary: List<String> = emptyList(),
    val topTracks: List<String> = emptyList(),
    val groups: List<AndroidPublicReportNote> = emptyList(),
    val players: List<AndroidTournamentStoryPlayer> = emptyList(),
)

/** `tournament.history-tn12` is edition 12; a night of our own is not one. */
internal fun androidHistoryEditionNumber(tournamentId: String): Int? =
    Regex("""^tournament\.history-tn(\d+)$""").find(tournamentId)?.groupValues?.get(1)?.toIntOrNull()

/** The Director's published report, as the site's document shows it. */
@Serializable
internal data class AndroidPublicReportNote(
    val name: String,
    val paragraphs: List<String> = emptyList(),
)

@Serializable
internal data class AndroidPublicReportVisibility(
    val topTracks: Boolean = true,
    val benchmark: Boolean = true,
    val duel: Boolean = true,
    val distribution: Boolean = true,
    // The Director's switches for the opening paragraphs, the Summary and every group's note
    // (2026-09-28). A report published before them carries none of the three and showed them all.
    val intro: Boolean = true,
    val summary: Boolean = true,
    val groupNotes: Boolean = true,
)

/** The story as the Director left it ticked: an unticked block is not drawn; Player notes stay. */
internal fun androidStoryShown(
    story: AndroidTournamentStory,
    shows: AndroidPublicReportVisibility,
): AndroidTournamentStory = story.copy(
    intro = if (shows.intro) story.intro else emptyList(),
    summary = if (shows.summary) story.summary else emptyList(),
    groups = if (shows.groupNotes) story.groups else emptyList(),
)

@Serializable
internal data class AndroidPublicReport(
    val title: String,
    val intro: List<String> = emptyList(),
    val summary: List<String> = emptyList(),
    val topTracks: List<String> = emptyList(),
    val groups: List<AndroidPublicReportNote> = emptyList(),
    val players: List<AndroidPublicReportNote> = emptyList(),
    val visibility: AndroidPublicReportVisibility = AndroidPublicReportVisibility(),
    val publishedAtMs: Long = 0,
    val revision: Int = 0,
)

@Serializable
internal data class AndroidPublicTournamentEvent(
    val tournamentId: String,
    val name: String,
    val stage: String,
    val editionNumber: Int? = null,
    val eventDate: String? = null,
    val startAtMs: Long? = null,
    val timezone: String? = null,
    val workflowStep: Int? = null,
    val participantCount: Int = 0,
    val groups: List<AndroidPublicGroup> = emptyList(),
    val overall: List<AndroidPublicOverallRow> = emptyList(),
    val report: AndroidPublicReport? = null,
)

/** Whose Switch, which seat, who is beside you, and how it is going. */
internal data class AndroidViewerStanding(
    val tournamentId: String,
    val name: String,
    val eventDate: String?,
    val startAtMs: Long?,
    val timezone: String?,
    val running: Boolean,
    val workflowStep: Int?,
    /**
     * The group as the server stores it ("Kampioen"); show it through
     * [viewerGroupLabel], which gives the tier's name in the reader's language.
     */
    val groupName: String?,
    val seedRank: Int?,
    val stationOwnerPlayerId: String?,
    val stationOwnerDisplayName: String?,
    val switchType: String?,
    val seatNumber: Int?,
    val seatMates: List<AndroidPublicSeat>,
    val points: Int?,
    val races: Int?,
    val groupRank: Int?,
    val groupSize: Int?,
    val placement: Int?,
    val of: Int?,
    val groupTierKey: String? = null,
)

/** The reader's group as a screen shows it: the tier's own name in their language, never the stored name. */
internal fun viewerGroupLabel(standing: AndroidViewerStanding, dutch: Boolean): String? =
    standing.groupName?.let { androidGroupLabel(it, standing.groupTierKey, dutch) }

/**
 * The reader's own answer for one night, from its public document.
 *
 * The last group they hold a row in wins, so a Player who has moved from the
 * qualifier into a final group is told about the group they are in now. The
 * overall placement is only a result once the night is finalized: "26th of 36"
 * halfway through the qualifiers reads as a verdict on an evening that has not
 * happened.
 */
internal fun viewerStandingIn(
    event: AndroidPublicTournamentEvent,
    viewerPlayerId: String,
): AndroidViewerStanding? {
    val groups = event.groups.sortedWith(
        compareBy({ if (it.stage == "qualifier") 0 else 1 }, { it.sequence }),
    )
    for (group in groups.reversed()) {
        val row = group.standings.firstOrNull { it.playerId == viewerPlayerId } ?: continue
        val seat = group.seating.firstOrNull { it.playerId == viewerPlayerId }
        val mates = if (seat == null) emptyList() else group.seating.filter {
            it.stationOwnerDisplayName == seat.stationOwnerDisplayName &&
                it.switchType == seat.switchType &&
                it.seatNumber != seat.seatNumber
        }.sortedBy { it.seatNumber }
        val placement = if (event.stage == "finalized") {
            event.overall.firstOrNull { it.playerId == viewerPlayerId }?.placement
        } else {
            null
        }
        return AndroidViewerStanding(
            tournamentId = event.tournamentId,
            name = event.name,
            eventDate = event.eventDate,
            startAtMs = event.startAtMs,
            timezone = event.timezone,
            running = tournamentIsBeingRaced(event.stage, event.workflowStep),
            workflowStep = event.workflowStep,
            groupName = group.name,
            groupTierKey = group.tierKey,
            seedRank = seat?.seedRank ?: row.seedRank,
            stationOwnerPlayerId = seat?.stationOwnerPlayerId,
            stationOwnerDisplayName = seat?.stationOwnerDisplayName,
            switchType = seat?.switchType,
            seatNumber = seat?.seatNumber,
            seatMates = mates,
            points = if (row.races == 0) null else row.points,
            races = if (row.races == 0) null else row.races,
            groupRank = if (row.races == 0) null else row.rank,
            groupSize = if (row.races == 0) null else group.standings.size,
            placement = placement,
            of = if (event.overall.isEmpty()) null else event.overall.size,
        )
    }
    return null
}

/**
 * A night the server says the reader is in but whose groups do not exist yet:
 * no standing row holds them, and that is exactly the night a countdown is
 * for. Name and date are all it can honestly say.
 */
internal fun viewerStandingOnTheList(
    event: AndroidPublicTournamentEvent,
): AndroidViewerStanding = AndroidViewerStanding(
    tournamentId = event.tournamentId,
    name = event.name,
    eventDate = event.eventDate,
    startAtMs = event.startAtMs,
    timezone = event.timezone,
    running = false,
    workflowStep = event.workflowStep,
    groupName = null,
    seedRank = null,
    stationOwnerPlayerId = null,
    stationOwnerDisplayName = null,
    switchType = null,
    seatNumber = null,
    seatMates = emptyList(),
    points = null,
    races = null,
    groupRank = null,
    groupSize = null,
    placement = null,
    of = null,
)

/** Which shelf a night belongs on. */
internal enum class AndroidTournamentShelf {
    RUNNING, SOON, DRAFT, STALLED, UNPUBLISHED, REMOVED, FINISHED,
}

/**
 * Whether a night is being raced. The owner's rule: from Step 5, where the
 * first scores are entered. Everything before it - the roster, the groups, the
 * layout and its export - is a night being made, however close it is. The
 * stage is only a fallback, and it turns one step early.
 */
internal fun tournamentIsBeingRaced(stage: String, workflowStep: Int?): Boolean {
    if (stage == "finalized") return false
    return workflowStep?.let { it >= 5 } ?: (stage != "setup")
}

/** How long a night that has started still counts as the one happening now. */
internal const val NIGHT_WINDOW_MS: Long = 86_400_000L

/**
 * Whether this is the night on now: its start is within the last day, or it is
 * being raced and has not been abandoned. A calendar date is the wrong
 * measure - the evening runs past midnight, and whoever opens the app at half
 * past one wants the same card they had at eight.
 */
internal fun tournamentIsTonight(
    summary: AndroidPublicTournamentSummary,
    nowMs: Long = System.currentTimeMillis(),
): Boolean {
    val started = summary.startAtMs
    if (started != null && started <= nowMs - NIGHT_WINDOW_MS) return false
    return if (started != null && started <= nowMs) true
    else tournamentIsBeingRaced(summary.stage, summary.workflowStep)
}

private const val DAY_MS: Long = 86_400_000L

/**
 * A full day past its start, a night that is still open says so in red. An
 * evening runs past midnight and somebody finishes the scoring the next
 * morning; a day later than that, something has gone wrong.
 */
internal const val TOURNAMENT_OVERDUE_MS: Long = DAY_MS

/**
 * Three days past its start it is not "in progress" by any reading: it never
 * finished. It moves to its own shelf rather than standing at the top of the
 * list pretending to be tonight.
 */
internal const val TOURNAMENT_STALLED_MS: Long = 3 * DAY_MS

/** When the night began, from the clock if it has one and the day if not. */
internal fun tournamentStartedMs(summary: AndroidPublicTournamentSummary): Long? {
    summary.startAtMs?.let { return it }
    val date = summary.eventDate ?: return null
    val parts = date.split('-')
    if (parts.size != 3) return null
    val year = parts[0].toIntOrNull() ?: return null
    val month = parts[1].toIntOrNull() ?: return null
    val day = parts[2].toIntOrNull() ?: return null
    val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    calendar.clear()
    calendar.set(year, month - 1, day, 12, 0, 0)
    return calendar.timeInMillis
}

/**
 * How many whole days a night is past its start, once it is a day past it and
 * still not finished. `null` while it is finished, or still in its own day.
 */
internal fun tournamentOverdueDays(
    summary: AndroidPublicTournamentSummary,
    nowMs: Long = System.currentTimeMillis(),
): Int? {
    if (summary.stage == "finalized") return null
    val started = tournamentStartedMs(summary) ?: return null
    if (started > nowMs - TOURNAMENT_OVERDUE_MS) return null
    return ((nowMs - started) / DAY_MS).toInt()
}

internal fun tournamentListShelf(
    summary: AndroidPublicTournamentSummary,
    nowMs: Long = System.currentTimeMillis(),
): AndroidTournamentShelf {
    // A removed night is out of everything - the lists, the results and the
    // rating - and only an administrator is told it is still there at all.
    if (summary.removed == true) return AndroidTournamentShelf.REMOVED
    if (summary.stage == "finalized") {
        // A finished night the community cannot read is not in the archive: it
        // is the Director's own, waiting to be published or left alone.
        return if (summary.published == false) {
            AndroidTournamentShelf.UNPUBLISHED
        } else {
            AndroidTournamentShelf.FINISHED
        }
    }
    val started = tournamentStartedMs(summary)
    // Three days late is not late any more: it is a night nobody closed.
    if (started != null && started <= nowMs - TOURNAMENT_STALLED_MS) return AndroidTournamentShelf.STALLED
    if (tournamentIsBeingRaced(summary.stage, summary.workflowStep)) return AndroidTournamentShelf.RUNNING
    if (summary.startAtMs != null && summary.startAtMs > nowMs) return AndroidTournamentShelf.SOON
    return AndroidTournamentShelf.DRAFT
}

/**
 * Which of a reader's nights is the one to show them. The newest-touched night
 * is the wrong answer: a Director editing next Friday's roster makes it the
 * newest, and the night being raced tonight drops behind it.
 */
internal fun orderViewerNights(
    summaries: List<AndroidPublicTournamentSummary>,
    nowMs: Long = System.currentTimeMillis(),
): List<AndroidPublicTournamentSummary> {
    fun rank(summary: AndroidPublicTournamentSummary): Int = when {
        tournamentIsTonight(summary, nowMs) -> 0
        summary.startAtMs != null && summary.startAtMs > nowMs -> 1
        else -> 2
    }
    return summaries.sortedWith(
        compareBy<AndroidPublicTournamentSummary> { rank(it) }
            .thenBy { if (rank(it) == 1) (it.startAtMs ?: 0L) else -it.updatedAtMs },
    )
}

/**
 * The order the list itself reads in: the night closest to the reader first
 * while it is still to be raced, and newest first once it is over.
 */
internal fun orderTournamentList(
    summaries: List<AndroidPublicTournamentSummary>,
): List<AndroidPublicTournamentSummary> {
    // The Web reads the event date first and only falls back to a timestamp,
    // and the Web is the reference for what the two clients share. Reading
    // startAtMs first here instead put the same two nights in a different
    // order whenever one carried a start time and no date.
    fun whenMs(summary: AndroidPublicTournamentSummary): Long {
        val date = summary.eventDate
        if (date != null) {
            val noon = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT)
            noon.timeZone = TimeZone.getTimeZone("UTC")
            runCatching { noon.parse("$date 12:00") }.getOrNull()?.let { return it.time }
        }
        return summary.finalizedAtMs ?: summary.updatedAtMs
    }
    return summaries.sortedWith(Comparator { left, right ->
        val leftDone = left.stage == "finalized"
        if (leftDone != (right.stage == "finalized")) return@Comparator if (leftDone) 1 else -1
        if (leftDone) whenMs(right).compareTo(whenMs(left)) else whenMs(left).compareTo(whenMs(right))
    })
}

/** Whether the night carries a time of day, rather than only a date. */
internal fun hasStartTime(startAtMs: Long, timezone: String?): Boolean =
    clockOf(startAtMs, timezone) != "00:00"

private fun clockOf(startAtMs: Long, timezone: String?): String {
    val format = SimpleDateFormat("HH:mm", Locale.ROOT)
    format.timeZone = zoneOf(timezone)
    return format.format(Date(startAtMs))
}

private fun zoneOf(timezone: String?): TimeZone =
    if (timezone == null) TimeZone.getDefault() else TimeZone.getTimeZone(timezone)

/**
 * "Vrijdag 11 september 2026 om 20:00", in the night's own time zone - the
 * clock the group chat agrees on, not the phone's. A night saved with only a
 * date lands on midnight and prints the day alone: "om 00:00" would state an
 * agreement nobody made.
 */
internal fun formatTournamentStart(
    startAtMs: Long,
    timezone: String?,
    dutch: Boolean,
): String {
    val locale = if (dutch) Locale.forLanguageTag("nl-NL") else Locale.UK
    val dayFormat = SimpleDateFormat("EEEE d MMMM yyyy", locale)
    dayFormat.timeZone = zoneOf(timezone)
    val day = dayFormat.format(Date(startAtMs))
        .replaceFirstChar { if (it.isLowerCase()) it.titlecase(locale) else it.toString() }
    val clock = clockOf(startAtMs, timezone)
    if (clock == "00:00") return day
    return day + (if (dutch) " om " else " at ") + clock
}

/** The gap as a clock: `1d 09:12:33`, or `09:12:33` inside a day. */
internal fun formatTimeToStart(remainingMs: Long): String {
    val total = (remainingMs.coerceAtLeast(0L) / 1000L)
    val seconds = total % 60
    val minutes = (total / 60) % 60
    val hours = (total / 3600) % 24
    val days = total / 86_400
    val clock = String.format(Locale.ROOT, "%02d:%02d:%02d", hours, minutes, seconds)
    return if (days == 0L) clock else "${days}d $clock"
}

/**
 * The console's own name for each step, Step 0 included, so the overview and
 * the console read the same words for the same step. The Web keeps the same
 * list in `tournament-step-progress.ts`.
 */
internal fun tournamentStepName(step: Int, dutch: Boolean): String = when (step) {
    0 -> if (dutch) "Directeur" else "Director"
    1 -> "Start"
    2 -> if (dutch) "Deelnemers & consoles" else "Participants & consoles"
    3 -> if (dutch) "Kwalificatie-indeling" else "Qualifier layout"
    4 -> if (dutch) "Indeling exporteren" else "Layout export"
    5 -> if (dutch) "Kwalificatiescores" else "Qualifier scores"
    6 -> if (dutch) "Uitslag exporteren" else "Result export"
    7 -> if (dutch) "Finale-indeling" else "Final layout"
    8 -> if (dutch) "Finale-indeling exporteren" else "Final layout export"
    9 -> if (dutch) "Finalescores" else "Final scores"
    10 -> if (dutch) "Einduitslag exporteren" else "Final result export"
    else -> ""
}

/** What is done and what is being waited for, in one sentence. */
internal fun tournamentStepState(step: Int, dutch: Boolean): String = when (step) {
    1 -> if (dutch) "Wachten tot het toernooi start" else "Waiting for the tournament to start"
    2 -> if (dutch) "Deelnemers bekend · wachten op de indeling" else "Participants known · waiting for the layout"
    3 -> if (dutch) "Consoles bekend · kwalificatie-indeling wordt gemaakt" else "Consoles known · qualifier layout being made"
    4 -> if (dutch) "Kwalificatie-indeling gereed · wordt gedeeld" else "Qualifier layout ready · being shared"
    5 -> if (dutch) "Kwalificatie-indeling gereed · wachten op scores" else "Qualifier layout ready · waiting for scores"
    6 -> if (dutch) "Kwalificatie-uitslag bekend · wordt gedeeld" else "Qualifier results known · being shared"
    7 -> if (dutch) "Eindgroepen worden gemaakt" else "Final groups being made"
    8 -> if (dutch) "Eindgroep-indeling gereed · wordt gedeeld" else "Final group layout ready · being shared"
    9 -> if (dutch) "Eindgroepen gereed · wachten op scores" else "Final groups ready · waiting for scores"
    10 -> if (dutch) "Alle scores binnen · de uitslag wordt gedeeld" else "All scores in · the result is being shared"
    else -> if (dutch) "Wordt voorbereid" else "Being prepared"
}

/**
 * The groups whose scores the current step waits for. Steps 5 and 9 are the
 * two that wait; every other step has nothing per group to say.
 */
internal fun tournamentScoringGroups(
    event: AndroidPublicTournamentEvent,
    step: Int,
): List<Pair<String, Int>> {
    if (step != 5 && step != 9) return emptyList()
    val stage = if (step == 5) "qualifier" else "final"
    return event.groups.filter { it.stage == stage }.map { it.name to it.races.size }
}

/**
 * The name a group is shown under, the way the site shows it: the tier's own
 * name in the reader's language, and a generated "Groep 3" as "Group 3" in
 * English. Shared by the night page and its report, as on the Web, so the two
 * clients cannot end up calling the same group two different things.
 */
internal fun androidGroupLabel(name: String, tierKey: String?, dutch: Boolean): String =
    androidGroupLabel(name, tierKey, if (dutch) AndroidProductLanguage.DUTCH else AndroidProductLanguage.ENGLISH)

/**
 * The same name in any product language. A group without a tier key is
 * recognised by its stored name: the server stores final groups under the
 * Dutch tier name ("Kampioen"), older documents sometimes under the English.
 */
internal fun androidGroupLabel(name: String, tierKey: String?, language: AndroidProductLanguage): String {
    val tier = if (tierKey != null) {
        TournamentTiers.firstOrNull { it.key == tierKey }
    } else {
        androidGroupTierByName(name)
    }
    if (tier != null) {
        return androidTournamentTierLabel(tier.key, language) ?: tier.name
    }
    val generated = Regex("""^Groep (\d+)$""", RegexOption.IGNORE_CASE).find(name.trim())
    val number = generated?.groupValues?.get(1) ?: return name
    return androidText(language, "Group $number", "Groep $number")
}

private fun androidGroupTierByName(name: String): AndroidTournamentTier? {
    val normalized = name.trim().lowercase(Locale.ROOT)
    if (normalized.isEmpty()) return null
    return TournamentTiers.firstOrNull { tier ->
        tier.name.lowercase(Locale.ROOT) == normalized ||
            androidTournamentTierLabel(tier.key, AndroidProductLanguage.ENGLISH)?.lowercase(Locale.ROOT) == normalized
    }
}
