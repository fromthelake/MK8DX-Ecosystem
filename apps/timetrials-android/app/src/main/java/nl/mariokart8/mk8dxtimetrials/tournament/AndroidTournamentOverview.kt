package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisclosure
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxLiveTag
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

/**
 * The Tournaments overview, as the site shows it.
 *
 * The phone used to open the operator console at Step 0, so the same tab
 * answered a different question on each client: the site asked "what is on?",
 * the phone asked "what am I running?". This is the site's answer. Running a
 * night is still here, one button away, for whoever may.
 *
 * Phase 11 (A06) put it on the design system. The two neons carry the same
 * meanings they did, in the tokens that own those meanings: a night being
 * raced is `live`, a night that is next is `status.warning`. The shelf rules
 * and the clock live in AndroidPublicTournaments.kt and are the same rules the
 * Web uses; the tests beside them pin that.
 */

/**
 * How many finished nights get their placement read, and how long to wait
 * between the documents that carry it. The Web bounds this the same way.
 */
private const val ARCHIVE_PLACEMENT_LIMIT = 8

/** Which meaning a shelf carries, so its rows can borrow the same token. */
internal enum class AndroidShelfTone { Live, Next, Calm, Trouble, Done }

@Composable
internal fun androidShelfColor(tone: AndroidShelfTone): Color = when (tone) {
    AndroidShelfTone.Live -> Mk8dxTheme.colors.live
    AndroidShelfTone.Next -> Mk8dxTheme.colors.statusWarning
    AndroidShelfTone.Calm -> Mk8dxTheme.colors.textSecondary
    AndroidShelfTone.Trouble -> Mk8dxTheme.colors.statusError
    AndroidShelfTone.Done -> Mk8dxTheme.colors.statusSuccess
}

@Composable
internal fun AndroidTournamentOverview(
    client: AndroidTournamentClient?,
    dutch: Boolean,
    signedIn: Boolean,
    canOperate: Boolean,
    viewerPlayerId: String?,
    onOperate: () -> Unit,
    onEditNight: (String) -> Unit,
    onOpenNight: (String) -> Unit,
    onShareNight: (AndroidPublicTournamentEvent) -> Unit,
    onSignIn: () -> Unit,
    /** What a shared address asked of the statistics panel, if anything. */
    statisticsRequest: AndroidTournamentRequest? = null,
    /** From a track's own rating on to the time trials driven on it. */
    onOpenTrack: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var standing by remember(client, viewerPlayerId) { mutableStateOf<AndroidViewerStanding?>(null) }
    var standingEvent by remember(client, viewerPlayerId) { mutableStateOf<AndroidPublicTournamentEvent?>(null) }
    /** The document of every night that wears a card, read once each. */
    var cardEvents by remember(client) { mutableStateOf<Map<String, AndroidPublicTournamentEvent>>(emptyMap()) }
    /** "Jij werd 4e van 35", per finished night the reader raced in. */
    var placements by remember(client, viewerPlayerId) { mutableStateOf<Map<String, Pair<Int, Int>>>(emptyMap()) }
    var nights by remember(client) { mutableStateOf<List<AndroidPublicTournamentSummary>>(emptyList()) }
    var loading by remember(client) { mutableStateOf(true) }
    var failure by remember(client) { mutableStateOf<String?>(null) }
    // Two clocks, deliberately.
    //
    // `tick` moves every second and is read *only* inside the countdown's own
    // composable, so a second passing recomposes that one line. Passing it down
    // as a value instead made the whole screen - the ordering, the shelving and
    // every row - rebuild once a second, which hung the app on the emulator.
    //
    // `shelfNow` decides which shelf a night is on and moves every half minute,
    // because that answer changes at a start time, not at a second.
    val tick = remember { mutableStateOf(System.currentTimeMillis()) }
    var shelfNow by remember { mutableStateOf(System.currentTimeMillis()) }
    val colors = Mk8dxTheme.colors

    LaunchedEffect(client) {
        val active = client
        if (active == null) {
            loading = false
            return@LaunchedEffect
        }
        runCatching { withContext(Dispatchers.IO) { active.listPublic() } }
            .onSuccess {
                nights = it
                failure = null
            }
            .onFailure { cause ->
                // The reader is told the same short sentence the site tells
                // them; the reason goes to the log, because a swallowed cause
                // is a morning lost the next time this happens.
                android.util.Log.w("mk8dx-tournaments", "public list failed", cause)
                failure = if (dutch) {
                    "Toernooien zijn tijdelijk niet beschikbaar."
                } else {
                    "Tournaments are temporarily unavailable."
                }
            }
        loading = false
    }

    // The reader's own night, read after the list and never more than one
    // document: the server already said which nights they were at, so the six
    // newest no longer have to be read to guess at it.
    LaunchedEffect(client, viewerPlayerId, nights) {
        val active = client
        val viewer = viewerPlayerId
        if (active == null || viewer == null || nights.isEmpty()) return@LaunchedEffect
        val played = nights.filter { it.viewerParticipated == true }
        val live = orderViewerNights(played.filter { it.stage != "finalized" })
        val candidate = (live.ifEmpty { orderViewerNights(played) }).firstOrNull()
            ?: return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) { active.loadPublic(candidate.tournamentId) } }
            .onSuccess { event ->
                standingEvent = event
                standing = viewerStandingIn(event, viewer) ?: viewerStandingOnTheList(event)
            }
    }

    // A night being raced is the most important row on the list for everybody,
    // signed in or not, so it wears the card - and a card needs the night's own
    // document for its picture and its groups.
    LaunchedEffect(client, nights) {
        val active = client ?: return@LaunchedEffect
        val wanted = nights.filter { tournamentListShelf(it) == AndroidTournamentShelf.RUNNING }
        for (summary in wanted) {
            if (cardEvents.containsKey(summary.tournamentId)) continue
            runCatching { withContext(Dispatchers.IO) { active.loadPublic(summary.tournamentId) } }
                .onSuccess { cardEvents = cardEvents + (summary.tournamentId to it) }
        }
    }

    // What the reader took away from finished nights. The server returns the
    // compact standings together, so the rows no longer fill one by one and
    // this remains one request under the host's per-IP rate limit.
    LaunchedEffect(client, viewerPlayerId, nights) {
        val active = client
        val viewer = viewerPlayerId
        if (active == null || viewer == null) return@LaunchedEffect
        val wanted = orderTournamentList(nights)
            .filter { it.stage == "finalized" && it.viewerParticipated == true }
            .take(ARCHIVE_PLACEMENT_LIMIT)
        if (wanted.isEmpty()) return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) {
            active.loadPublicPlacements(wanted.map { it.tournamentId })
        } }.onSuccess { snapshots ->
            placements = snapshots.mapNotNull { snapshot ->
                val row = snapshot.placements.firstOrNull { it.playerId == viewer }
                    ?: return@mapNotNull null
                snapshot.tournamentId to (row.placement to snapshot.fieldSize)
            }.toMap()
        }
    }

    // The second-hand only has to run while something is counting down.
    val counting = nights.any {
        tournamentListShelf(it, shelfNow) == AndroidTournamentShelf.SOON &&
            it.startAtMs != null && hasStartTime(it.startAtMs, it.timezone)
    }
    LaunchedEffect(counting) {
        while (counting) {
            tick.value = System.currentTimeMillis()
            delay(1000L)
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000L)
            shelfNow = System.currentTimeMillis()
        }
    }

    // A link that is about the statistics lands on them, not at the top of a
    // list the sender was not talking about. The section's own top is measured
    // as it is laid out; the scroll happens once the list under it has stopped
    // growing, which is why it waits for the nights to be there.
    val scroll = rememberScrollState()
    var statisticsTop by remember { mutableStateOf(0) }
    // Where the reader's own line in a track's standing landed on screen, and
    // which track the page has already carried them to.
    var viewerRow by remember { mutableStateOf<Pair<String, Int>?>(null) }
    var carriedTrack by remember { mutableStateOf<String?>(null) }
    // Where the scrolling column itself sits on screen: with it, a row's
    // position becomes a place in the page that does not move while the page
    // scrolls, so the carry cannot aim at a stale spot.
    var containerTop by remember { mutableStateOf(0) }
    LaunchedEffect(statisticsRequest, statisticsTop, nights.size) {
        if (statisticsRequest == null || statisticsTop <= 0) return@LaunchedEffect
        // The reader's own line in a track standing is the better target;
        // once it is there, this must not pull the page back to the panel.
        if (viewerRow != null) return@LaunchedEffect
        delay(250L)
        if (viewerRow != null) return@LaunchedEffect
        runCatching { scroll.animateScrollTo(statisticsTop) }
    }
    // A track's standing opens on the reader's own line, wherever it sits in
    // the table (owner, 2026-09-16). The row reports where it landed on
    // screen; the page adds what is already scrolled away and leaves a screen
    // quarter above it, so the names around it stay visible.
    LaunchedEffect(viewerRow, nights.size) {
        val row = viewerRow ?: return@LaunchedEffect
        if (carriedTrack == row.first) return@LaunchedEffect
        // The nights above the panel push it down as they arrive; carrying
        // the reader before they are there leaves them looking at the list.
        if (nights.isEmpty()) return@LaunchedEffect
        // The row reports again on every scroll, so this restarts until the
        // page stands still - past the scroll that brings the panel itself
        // into view - and only then carries the reader to their own line.
        delay(450L)
        carriedTrack = row.first
        runCatching { scroll.animateScrollTo((row.second - 360).coerceAtLeast(0)) }
    }

    val ordered = remember(nights, shelfNow) { orderTournamentList(nights) }
    fun on(shelf: AndroidTournamentShelf) = ordered.filter { tournamentListShelf(it, shelfNow) == shelf }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surfaceApp)
            .onGloballyPositioned { containerTop = it.positionInRoot().y.toInt() }
            .verticalScroll(scroll)
            .padding(Mk8dxSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxArtHero(
            title = if (dutch) "Toernooien" else "Tournaments",
            meta = if (dutch) {
                "Toernooiavonden, groepen, races en uitslagen."
            } else {
                "Tournament nights, groups, races and results."
            },
        )

        when {
            loading -> Mk8dxMetaLine(if (dutch) "Laden…" else "Loading…")
            failure != null -> Mk8dxStatusMessage(requireNotNull(failure), tone = Mk8dxStatusTone.Error)
            nights.isEmpty() -> Mk8dxMetaLine(if (dutch) "Nog geen toernooien." else "No tournaments yet.")
            else -> Mk8dxMetaLine(overviewCounts(nights, dutch, shelfNow))
        }

        // The one filled thing on this page is a night being raced (§4): both
        // of these open something rather than being the thing to do.
        if (canOperate) {
            Mk8dxButton(
                if (dutch) "Nieuw toernooi maken" else "Create new tournament",
                onOperate,
                variant = Mk8dxButtonVariant.Secondary,
                tag = "tournament-create",
            )
        } else if (!signedIn) {
            Mk8dxButton(
                if (dutch) "Aanmelden" else "Sign in",
                onSignIn,
                variant = Mk8dxButtonVariant.Secondary,
            )
        }

        // The reader's own night wears the card on the shelf where it belongs;
        // there is no card floating above the shelves any more. It said
        // "BINNENKORT" over a shelf headed "BINNENKORT", and left the night
        // being raced as a one-line row.
        val mine = standing?.takeIf { own -> nights.any { it.tournamentId == own.tournamentId } }
        val carded = nights
            .filter { tournamentListShelf(it, shelfNow) == AndroidTournamentShelf.RUNNING }
            .map { it.tournamentId }
            .toMutableSet()
        mine?.let { carded.add(it.tournamentId) }
        val eventFor = { id: String ->
            cardEvents[id] ?: standingEvent?.takeIf { it.tournamentId == id }
        }

        @Composable
        fun shelf(title: String, tone: AndroidShelfTone, shelfKey: AndroidTournamentShelf, edged: Boolean) {
            Shelf(
                title = title,
                rows = on(shelfKey),
                dutch = dutch,
                onOpenNight = onOpenNight,
                onEditNight = if (canOperate) onEditNight else null,
                onShareNight = onShareNight,
                shelfNow = shelfNow,
                tick = tick,
                placements = placements,
                edge = if (edged) androidShelfColor(tone) else null,
                carded = carded,
                standing = mine,
                eventFor = eventFor,
            )
        }

        shelf(if (dutch) "Bezig" else "In progress", AndroidShelfTone.Live, AndroidTournamentShelf.RUNNING, true)
        shelf(if (dutch) "Binnenkort" else "Coming up", AndroidShelfTone.Next, AndroidTournamentShelf.SOON, true)
        // ADR-0222: for the nights coming up, one line about the reader and what
        // happens next (sign up, change consoles, withdraw), as on the night page.
        if (signedIn) {
            on(AndroidTournamentShelf.SOON).take(2).forEach { night ->
                AndroidTournamentSignupCard(client, night.tournamentId, showLists = false, title = night.name)
            }
        }
        shelf(if (dutch) "In aanmaak" else "Being prepared", AndroidShelfTone.Calm, AndroidTournamentShelf.DRAFT, false)
        shelf(if (dutch) "Niet afgerond" else "Not finished", AndroidShelfTone.Trouble, AndroidTournamentShelf.STALLED, true)
        shelf(if (dutch) "Afgerond" else "Finished", AndroidShelfTone.Done, AndroidTournamentShelf.FINISHED, true)
        // A Director's own finished-but-unpublished nights, and - folded away,
        // because the list would otherwise never end - the ones that were
        // removed. Both are told to whoever may see them and to nobody else:
        // the server sends the marks only to them.
        shelf(
            if (dutch) "Niet gepubliceerd" else "Not published",
            AndroidShelfTone.Next, AndroidTournamentShelf.UNPUBLISHED, true,
        )
        val removed = on(AndroidTournamentShelf.REMOVED)
        if (removed.isNotEmpty()) {
            var removedOpen by remember { mutableStateOf(false) }
            Mk8dxDisclosure(
                label = if (dutch) "Verwijderd (${removed.size})" else "Removed (${removed.size})",
                open = removedOpen,
                onToggle = { removedOpen = !removedOpen },
            )
            if (removedOpen) {
                Mk8dxMetaLine(
                    if (dutch) {
                        "Uit de lijsten, de uitslagen en de ranglijst - het dossier blijft bestaan."
                    } else {
                        "Out of the lists, the results and the ranking - the record survives."
                    },
                )
                removed.forEach { night ->
                    NightRow(
                        night, dutch, onOpenNight, null, shelfNow, tick, null,
                        androidShelfColor(AndroidShelfTone.Trouble),
                    )
                }
            }
        }
        // ADR-0220: a signed-in account that is not a Director reads how to
        // become one and may ask; the card hides itself for administrators.
        if (signedIn && !canOperate) {
            AndroidDirectorHostRequestCard(client)
        }
        // Under the finished nights, as on the site.
        AndroidTournamentStatisticsSection(
            client, dutch, statisticsRequest, onOpenTrack, viewerPlayerId,
            onViewerRowPlaced = { track, rootTop ->
                val inPage = rootTop - containerTop + scroll.value
                if (viewerRow != (track to inPage)) { viewerRow = track to inPage }
            },
            modifier = Modifier.onGloballyPositioned { placed ->
                statisticsTop = placed.positionInParent().y.toInt()
            },
        )
    }
}

/** "1 toernooi bezig · 1 binnenkort · 1 in aanmaak · 7 afgerond". */
internal fun overviewCounts(
    nights: List<AndroidPublicTournamentSummary>,
    dutch: Boolean,
    nowMs: Long = System.currentTimeMillis(),
): String {
    val shelves = nights.map { tournamentListShelf(it, nowMs) }
    val running = shelves.count { it == AndroidTournamentShelf.RUNNING }
    val soon = shelves.count { it == AndroidTournamentShelf.SOON }
    val draft = shelves.count { it == AndroidTournamentShelf.DRAFT }
    val stalled = shelves.count { it == AndroidTournamentShelf.STALLED }
    val unpublished = shelves.count { it == AndroidTournamentShelf.UNPUBLISHED }
    val removed = shelves.count { it == AndroidTournamentShelf.REMOVED }
    val finished = shelves.count { it == AndroidTournamentShelf.FINISHED }
    val plural = if (running == 1) "" else "s"
    return listOfNotNull(
        when {
            running == 0 -> null
            dutch -> "$running toernooi${if (running == 1) "" else "en"} bezig"
            else -> "$running tournament$plural in progress"
        },
        if (soon == 0) null else if (dutch) "$soon binnenkort" else "$soon coming up",
        if (draft == 0) null else if (dutch) "$draft in aanmaak" else "$draft being prepared",
        if (stalled == 0) null else if (dutch) "$stalled niet afgerond" else "$stalled not finished",
        if (unpublished == 0) null else if (dutch) {
            "$unpublished niet gepubliceerd"
        } else {
            "$unpublished not published"
        },
        if (removed == 0) null else if (dutch) "$removed verwijderd" else "$removed removed",
        if (dutch) "$finished afgerond" else "$finished finished",
    ).joinToString(" · ")
}

@Composable
private fun Shelf(
    title: String,
    rows: List<AndroidPublicTournamentSummary>,
    dutch: Boolean,
    onOpenNight: (String) -> Unit,
    onEditNight: ((String) -> Unit)?,
    onShareNight: (AndroidPublicTournamentEvent) -> Unit,
    shelfNow: Long,
    tick: State<Long>,
    placements: Map<String, Pair<Int, Int>>,
    edge: Color?,
    carded: Set<String>,
    standing: AndroidViewerStanding?,
    eventFor: (String) -> AndroidPublicTournamentEvent?,
) {
    if (rows.isEmpty()) return
    Column(
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Mk8dxSectionLabel(title.uppercase())
        rows.forEach { night ->
            if (carded.contains(night.tournamentId)) {
                NightCard(
                    night = night,
                    standing = standing?.takeIf { it.tournamentId == night.tournamentId },
                    event = eventFor(night.tournamentId),
                    dutch = dutch,
                    tick = tick,
                    shelfNow = shelfNow,
                    onOpenNight = onOpenNight,
                    onEditNight = onEditNight,
                    onShareNight = onShareNight,
                )
            } else {
                NightRow(night, dutch, onOpenNight, onEditNight, shelfNow, tick, placements[night.tournamentId], edge)
            }
        }
    }
}

/**
 * The countdown to a start time, in a composable of its own.
 *
 * It is the only thing on the page that reads the second-hand, and reading it
 * here rather than in the row means one chip recomposes every second instead
 * of the row around it.
 */
@Composable
private fun CountdownChip(tick: State<Long>, startAtMs: Long) {
    Mk8dxChip("⏳ " + formatTimeToStart(startAtMs - tick.value), tone = Mk8dxChipTone.Warning)
}

@Composable
private fun NightRow(
    night: AndroidPublicTournamentSummary,
    dutch: Boolean,
    onOpenNight: (String) -> Unit,
    onEditNight: ((String) -> Unit)?,
    shelfNow: Long,
    tick: State<Long>,
    placement: Pair<Int, Int>?,
    edge: Color?,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button) { onOpenNight(night.tournamentId) },
        verticalAlignment = Alignment.Top,
    ) {
        // The left edge is the shelf's meaning, exactly as on the site - and
        // the row's own words say the same thing, so it never carries it alone.
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(64.dp)
                .background(edge ?: Color.Transparent),
        )
        Column(
            modifier = Modifier.weight(1f).padding(Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            // The server says which nights the reader raced in, so an older
            // edition is marked as surely as a recent one. Once its placement
            // has been read the mark becomes the placement.
            if (night.viewerParticipated == true) {
                Mk8dxChip(
                    when {
                        placement != null && dutch -> "Jij werd ${placement.first}e van ${placement.second}"
                        placement != null -> "You finished ${placement.first} of ${placement.second}"
                        night.stage == "finalized" && dutch -> "Jij reed mee"
                        night.stage == "finalized" -> "You raced in this one"
                        dutch -> "Jij doet mee"
                        else -> "You are in this one"
                    },
                    tone = Mk8dxChipTone.Neutral,
                )
            }
            Text(
                night.editionNumber?.let { "TN$it · ${night.name}" } ?: night.name,
                style = Mk8dxTheme.type.title,
                color = colors.textPrimary,
            )
            Mk8dxMetaLine(tournamentRowStatus(night, dutch, shelfNow))
            // A night that is late says so on its row as well.
            tournamentOverdueDays(night, shelfNow)?.let { days ->
                Mk8dxChip(
                    if (dutch) {
                        "Over tijd · $days ${if (days == 1) "dag" else "dagen"}"
                    } else {
                        "Overdue · $days day" + (if (days == 1) "" else "s")
                    },
                    tone = Mk8dxChipTone.Error,
                )
            }
            val start = night.startAtMs
            if (tournamentListShelf(night, shelfNow) == AndroidTournamentShelf.SOON &&
                start != null &&
                hasStartTime(start, night.timezone)
            ) {
                CountdownChip(tick, start)
            }
        }
        if (onEditNight != null && night.removed != true && !night.tournamentId.startsWith("tournament.history-")) {
            Mk8dxButton(
                if (dutch) "Bewerken" else "Edit",
                { onEditNight(night.tournamentId) },
                variant = Mk8dxButtonVariant.Secondary,
                size = Mk8dxButtonSize.Sm,
                modifier = Modifier.padding(top = Mk8dxSpacing.sm, end = Mk8dxSpacing.sm),
            )
        }
    }
}

/**
 * What a row says about itself, which has to agree with the shelf it is on.
 * The stage alone said "Kwalificaties bezig" over a night sitting under "In
 * aanmaak", because the stage turns a step before the racing does.
 */
internal fun tournamentRowStatus(
    night: AndroidPublicTournamentSummary,
    dutch: Boolean,
    nowMs: Long = System.currentTimeMillis(),
): String {
    val shelf = tournamentListShelf(night, nowMs)
    val start = night.startAtMs
    val head = when {
        shelf == AndroidTournamentShelf.SOON && start != null ->
            formatTournamentStart(start, night.timezone, dutch)
        shelf == AndroidTournamentShelf.SOON || shelf == AndroidTournamentShelf.DRAFT ->
            if (dutch) "Voorbereiden" else "Preparing"
        shelf == AndroidTournamentShelf.FINISHED -> if (dutch) "Einduitslag" else "Final results"
        night.stage == "finals" -> if (dutch) "Finales bezig" else "Finals in progress"
        else -> if (dutch) "Kwalificaties bezig" else "Qualifiers in progress"
    }
    val players = if (dutch) {
        "${night.participantCount} spelers"
    } else {
        "${night.participantCount} player${if (night.participantCount == 1) "" else "s"}"
    }
    val date = if (shelf == AndroidTournamentShelf.SOON && start != null) null else night.eventDate
    return listOfNotNull(head, players, date).joinToString(" · ")
}

/**
 * One night, drawn full: its name, when it is, how far it is and what can be
 * done with it - and, when it is the reader's own, where they sit and how they
 * are doing.
 *
 * This used to be one card above every shelf, and only ever the reader's own
 * night. It put a heading over the list that belonged to a shelf below it, and
 * it left the night actually being raced as a one-line row. The card lives on
 * the shelf where its night belongs now, and every night being raced wears one
 * whether the reader is in it or not. The twin of the site's `nightCard`.
 */
@Composable
internal fun NightCard(
    night: AndroidPublicTournamentSummary,
    standing: AndroidViewerStanding?,
    event: AndroidPublicTournamentEvent?,
    dutch: Boolean,
    tick: State<Long>,
    shelfNow: Long,
    onOpenNight: (String) -> Unit = {},
    onEditNight: ((String) -> Unit)? = null,
    onShareNight: (AndroidPublicTournamentEvent) -> Unit = {},
) {
    val colors = Mk8dxTheme.colors
    val now = System.currentTimeMillis()
    val start = night.startAtMs
    val ahead = start != null && start > now
    val late = tournamentOverdueDays(night, shelfNow)
    val tone = when {
        late != null -> AndroidShelfTone.Trouble
        ahead -> AndroidShelfTone.Next
        else -> AndroidShelfTone.Live
    }
    val accent = androidShelfColor(tone)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(Mk8dxSpacing.md),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        // The name is the heading; the chips beside it say what this night is
        // to the reader. The shelf above already said which shelf it is on, so
        // the card never repeats that word.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Mk8dxDisplayText(
                night.editionNumber?.let { "TN$it · ${night.name}" } ?: night.name,
                Mk8dxTheme.type.display6,
                Modifier.weight(1f),
            )
            if (ahead && start != null && hasStartTime(start, night.timezone)) {
                CountdownChip(tick, start)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            // A night actually being raced is the one filled thing on this
            // page (§4 A4). The reader's own night wears a card on whichever
            // shelf it sits, so the tag asks the shelf, not the card.
            if (tournamentListShelf(night, shelfNow) == AndroidTournamentShelf.RUNNING) {
                Mk8dxLiveTag(if (dutch) "Bezig" else "Live")
            }
            if (standing != null) {
                Mk8dxChip(
                    if (dutch) "Jouw toernooi" else "Your tournament",
                    tone = if (ahead) Mk8dxChipTone.Warning else Mk8dxChipTone.Info,
                )
            }
            if (late != null) {
                Mk8dxChip(
                    if (dutch) {
                        "Over tijd · $late ${if (late == 1) "dag" else "dagen"}"
                    } else {
                        "Overdue · $late day" + (if (late == 1) "" else "s")
                    },
                    tone = Mk8dxChipTone.Error,
                )
            }
        }
        if (start != null) {
            Text(
                formatTournamentStart(start, night.timezone, dutch),
                style = Mk8dxTheme.type.body,
                color = colors.textBody,
            )
        } else if (night.eventDate != null) {
            Text(night.eventDate, style = Mk8dxTheme.type.body, color = colors.textBody)
        }
        // Who is in it and who runs it: what the row used to say.
        Mk8dxMetaLine(
            listOfNotNull(
                if (dutch) {
                    "${night.participantCount} spelers"
                } else {
                    "${night.participantCount} player" + (if (night.participantCount == 1) "" else "s")
                },
                night.directorDisplayName?.let { if (dutch) "Directeur: $it" else "Director: $it" },
            ).joinToString(" · "),
        )
        if (standing != null) {
            SeatLine(standing, dutch)
            viewerResultLine(standing, dutch)?.let {
                Text(it, style = Mk8dxTheme.type.body, color = colors.textBody)
            }
        }
        val step = night.workflowStep
        if (step != null) {
            Mk8dxMetaLine(
                (if (dutch) "Stap $step van 10 · " else "Step $step of 10 · ") +
                    tournamentStepState(step, dutch),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                (1..10).forEach { number ->
                    StepPip(number = number, current = step, accent = accent)
                }
            }
            val scoring = event?.let { tournamentScoringGroups(it, step) } ?: emptyList()

            if (scoring.isNotEmpty()) {
                val scored = scoring.count { it.second > 0 }
                Text(
                    if (dutch) {
                        "$scored van ${scoring.size} groepen ${if (scored == 1) "heeft" else "hebben"} scores"
                    } else {
                        "$scored of ${scoring.size} groups scored"
                    },
                    style = Mk8dxTheme.type.label.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    scoring.forEach { (name, races) ->
                        Mk8dxChip(
                            when {
                                races > 0 -> "$name: $races race" + (if (races == 1) "" else "s")
                                dutch -> "$name: nog geen races"
                                else -> "$name: no races yet"
                            },
                            tone = if (races > 0) Mk8dxChipTone.Info else Mk8dxChipTone.Neutral,
                        )
                    }
                }
            }
        }
        // The two doors the site puts here: open the night, and paste tonight's
        // picture into the group chat. Sharing names which picture it is, so
        // the button and the drawing cannot disagree.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxButton(
                if (dutch) "Toernooi bekijken" else "View this tournament",
                { onOpenNight(night.tournamentId) },
                variant = Mk8dxButtonVariant.Secondary,
            )
            if (onEditNight != null && night.removed != true && !night.tournamentId.startsWith("tournament.history-")) {
                Mk8dxButton(
                    if (dutch) "Toernooi bewerken" else "Edit this tournament",
                    { onEditNight(night.tournamentId) },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
            val picture = event?.let { androidPublicCurrentCheckpoint(it) }
            if (event != null && picture != null) {
                Mk8dxButton(
                    (if (dutch) "Deel: " else "Share: ") + picture.label,
                    { onShareNight(event) },
                    variant = Mk8dxButtonVariant.Secondary,
                )
            }
        }
    }
}

/** "1 van 3 groepen heeft scores · Groep 1: nog geen races · Groep 3: 8 races". */
internal fun viewerScoringLine(scoring: List<Pair<String, Int>>, dutch: Boolean): String {
    val scored = scoring.count { it.second > 0 }
    val head = if (dutch) {
        val verb = if (scored == 1) "heeft" else "hebben"
        "$scored van ${scoring.size} groepen $verb scores"
    } else {
        "$scored of ${scoring.size} groups scored"
    }
    val chips = scoring.joinToString(" · ") { (name, races) ->
        when {
            races > 0 -> "$name: $races race" + (if (races == 1) "" else "s")
            dutch -> "$name: nog geen races"
            else -> "$name: no races yet"
        }
    }
    return "$head · $chips"
}

/** Which group, whose Switch, which seat, and who is beside you. */
internal fun viewerSeatLine(standing: AndroidViewerStanding, dutch: Boolean): String {
    if (standing.groupName == null && standing.stationOwnerDisplayName == null) {
        return if (dutch) {
            "Je staat op de lijst · de Directeur heeft de groepen nog niet gemaakt"
        } else {
            "You are on the list · the Director has not made the groups yet"
        }
    }
    val parts = mutableListOf<String>()
    viewerGroupLabel(standing, dutch)?.let { parts.add(it) }
    val owner = standing.stationOwnerDisplayName
    if (owner != null) {
        val marker = if (standing.switchType == "ns2") "[NS2]" else "[NS1]"
        parts.add(if (dutch) "$marker Switch van $owner" else "$marker " + owner + "’s Switch")
        parts.add(if (dutch) "plek #${standing.seatNumber}" else "seat #${standing.seatNumber}")
    }
    val you = (if (dutch) "jij" else "you") + (standing.seedRank?.let { " #$it" } ?: "")
    val mates = standing.seatMates.joinToString(", ") { mate ->
        mate.displayName + (mate.seedRank?.let { " #$it" } ?: "")
    }
    parts.add(
        if (mates.isEmpty()) you else you + (if (dutch) " naast " else " next to ") + mates,
    )
    return parts.joinToString(" · ")
}

/** How the night is going, once it has started scoring. */
internal fun viewerResultLine(standing: AndroidViewerStanding, dutch: Boolean): String? {
    val placement = standing.placement
    if (placement != null && standing.of != null) {
        return if (dutch) {
            "Jij werd ${placement}e van ${standing.of}"
        } else {
            "You finished $placement of ${standing.of}"
        }
    }
    val points = standing.points ?: return null
    val races = standing.races ?: return null
    val rank = standing.groupRank ?: return null
    val size = standing.groupSize ?: return null
    val group = viewerGroupLabel(standing, dutch) ?: (if (dutch) "je groep" else "your group")
    return if (dutch) {
        "${rank}e van $size in $group · $points punten uit $races races"
    } else {
        "$rank of $size in $group · $points points from $races races"
    }
}

/**
 * One of the ten steps: done, being worked on, or still to come. Circles, as
 * the site draws them, rather than bare glyphs.
 */
@Composable
private fun StepPip(number: Int, current: Int, accent: Color) {
    val colors = Mk8dxTheme.colors
    val done = number < current
    val here = number == current
    Box(
        modifier = Modifier
            .size(22.dp)
            .background(if (here) accent else Color.Transparent, CircleShape)
            .border(
                1.dp,
                when {
                    done -> colors.statusSuccess
                    here -> accent
                    else -> colors.borderStrong
                },
                CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (done) "✓" else number.toString(),
            style = Mk8dxTheme.type.dataS,
            color = when {
                here -> colors.surfaceApp
                done -> colors.statusSuccess
                else -> colors.textSecondary
            },
        )
    }
}

/** The SP-rank chip, in the band colour the WhatsApp picture uses. */
@Composable
private fun SeedChip(seedRank: Int?) {
    val tier = tierForRank(seedRank)
    Mk8dxTierChip(seedRank?.let { "#$it" } ?: "#?", tier.color, dense = true)
}

/**
 * Where the reader sits, as the group chat asks it: which group, whose Switch,
 * which seat, and who is beside them - with everyone carrying the SP-rank
 * colour the picture gives them.
 */
@Composable
private fun SeatLine(standing: AndroidViewerStanding, dutch: Boolean) {
    if (standing.groupName == null && standing.stationOwnerDisplayName == null) {
        Mk8dxMetaLine(viewerSeatLine(standing, dutch))
        return
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        modifier = Modifier
            .heightIn(min = Mk8dxSpacing.targetMinDense)
            .semantics(mergeDescendants = true) { },
    ) {
        viewerGroupLabel(standing, dutch)?.let { Mk8dxMetaLine(it) }
        val owner = standing.stationOwnerDisplayName
        if (owner != null) {
            val marker = if (standing.switchType == "ns2") "[NS2]" else "[NS1]"
            Mk8dxMetaLine(
                if (dutch) "· $marker Switch van $owner" else "· $marker " + owner + "’s Switch",
            )
            Mk8dxMetaLine(if (dutch) "· plek #${standing.seatNumber}" else "· seat #${standing.seatNumber}")
        }
        Mk8dxMetaLine(if (dutch) "· jij" else "· you")
        SeedChip(standing.seedRank)
        if (standing.seatMates.isNotEmpty()) {
            Mk8dxMetaLine(if (dutch) "naast" else "next to")
            standing.seatMates.forEach { mate ->
                Mk8dxMetaLine(mate.displayName)
                SeedChip(mate.seedRank)
            }
        }
    }
}
