package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxBoardRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxGroupBoard
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxLiveTag
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

/**
 * One night's own page, as the site shows it.
 *
 * A published night is the community's own document and nothing else - the
 * story it was given, the standing of every group, the Top 5 tracks and a
 * section per Player with their five charts. The site drew that on light paper
 * inside the dark product; Phase 11 (W20/W21, A06) removes the paper island on
 * both clients, because the appearance the Player chose is the appearance the
 * whole product answers to. The order, the words and every link are the same;
 * only the surface, the type and the tables come from the system now.
 *
 * This is the HIGH-spectacle route: the night's own art is the hero's backdrop
 * and the group names are display type. Everything under them is data.
 */
@Composable
internal fun AndroidTournamentNightScreen(
    client: AndroidTournamentClient?,
    tournamentId: String,
    dutch: Boolean,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var event by remember(client, tournamentId) { mutableStateOf<AndroidPublicTournamentEvent?>(null) }
    var story by remember(client, tournamentId) { mutableStateOf<AndroidTournamentStory?>(null) }
    var loading by remember(client, tournamentId) { mutableStateOf(true) }
    var failure by remember(client, tournamentId) { mutableStateOf<String?>(null) }
    var liveGroups by remember(client, tournamentId) { mutableStateOf<List<AndroidPublicLiveGroup>>(emptyList()) }

    // A past edition's text lives in the imported stories file, not on the
    // document; only fetch it when this actually is one.
    LaunchedEffect(client, tournamentId) {
        val active = client ?: return@LaunchedEffect
        val edition = androidHistoryEditionNumber(tournamentId) ?: return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) { active.listStories() } }
            .onSuccess { stories -> story = stories.firstOrNull { it.edition == edition } }
    }

    LaunchedEffect(client, tournamentId) {
        val active = client
        if (active == null) {
            loading = false
            return@LaunchedEffect
        }
        runCatching { withContext(Dispatchers.IO) { active.loadPublic(tournamentId) } }
            .onSuccess { event = it; failure = null }
            .onFailure {
                failure = if (dutch) {
                    "Dit toernooi is tijdelijk niet beschikbaar."
                } else {
                    "This tournament is temporarily unavailable."
                }
            }
        loading = false
    }

    LaunchedEffect(client, tournamentId) {
        val active = client ?: return@LaunchedEffect
        while (true) {
            runCatching { withContext(Dispatchers.IO) { active.publicLiveGroups(tournamentId) } }
                .onSuccess { liveGroups = it }
            delay(3_000)
        }
    }

    // Where each section of the document begins, so a name in the standing can
    // jump to it and the bar can say which one is being read. The site does
    // this with a fragment and an IntersectionObserver; a phone has neither,
    // so the offsets are recorded against the scrolling column as it lays out.
    val scroll = rememberScrollState()
    val anchors = remember(tournamentId) { mutableStateMapOf<String, AndroidReportAnchor>() }
    val scope = rememberCoroutineScope()
    var viewport by remember(tournamentId) { mutableStateOf<LayoutCoordinates?>(null) }
    val current = anchors.values
        .filter { it.top <= scroll.value + 160 }
        .maxByOrNull { it.top }
    val colors = Mk8dxTheme.colors

    val open = event
    // A past edition, and a night whose Director has published their report,
    // are the document. Everything else is the night being run.
    val isDocument = open != null &&
        (androidHistoryEditionNumber(tournamentId) != null || open.report != null)
    val told = open?.report?.let { androidStoryFromReport(it) } ?: story

    Column(Modifier.fillMaxWidth().background(colors.surfaceApp)) {
        if (current != null) {
            ReportContextBar(current)
        }
        Column(
            modifier = modifier
                .fillMaxWidth()
                // Measured outside the scroll on purpose: this node is the
                // window the reader looks through, so a section's position
                // against it plus the scroll is where that section really
                // begins. Measured inside, it would travel with the content
                // and every offset would count the scroll twice.
                .onGloballyPositioned { viewport = it }
                .verticalScroll(scroll)
                .padding(Mk8dxSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            val register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit =
                { key, anchor, coords ->
                    val frame = viewport
                    if (frame != null && frame.isAttached && coords.isAttached) {
                        val top = frame.localPositionOf(coords, Offset.Zero).y.toInt() + scroll.value
                        val known = anchors[key]
                        if (known == null || known.top != top) {
                            anchors[key] = anchor.copy(top = top)
                        }
                    }
                }
            val jump: (String) -> Unit = { key ->
                anchors[key]?.let { anchor -> scope.launch { scroll.animateScrollTo(anchor.top) } }
            }

            Mk8dxButton(
                if (dutch) "← Alle toernooien" else "← All tournaments",
                onBack,
                variant = Mk8dxButtonVariant.Quiet,
                size = Mk8dxButtonSize.Sm,
                tag = "night-back",
            )
            when {
                loading -> Mk8dxMetaLine(if (dutch) "Laden…" else "Loading…")
                failure != null -> Mk8dxStatusMessage(requireNotNull(failure), tone = Mk8dxStatusTone.Error)
                open == null -> Mk8dxMetaLine(if (dutch) "Niet gevonden." else "Not found.")
                isDocument -> ReportDocument(
                    event = open,
                    written = told,
                    dutch = dutch,
                    register = register,
                    onOpenPlayer = jump,
                    onBackToStanding = { scope.launch { scroll.animateScrollTo(0) } },
                )
                else -> {
                    // ADR-0222: a night still to come says where the reader stands.
                    if (open.stage != "finalized") {
                        AndroidTournamentSignupCard(client, tournamentId)
                    }
                    RunningNight(event = open, dutch = dutch, liveGroups = liveGroups)
                }
            }
        }
    }
}

/** One place the bar can name while the reader scrolls past it. */
internal data class AndroidReportAnchor(
    val title: String,
    val subtitle: String = "",
    val characterAsset: String? = null,
    val top: Int = 0,
)

/** The night's numbers follow the reader's language, like every other table. */
@Composable
private fun numbersFor(dutch: Boolean): Mk8dxNumberLanguage =
    if (dutch) Mk8dxNumberLanguage.NL else Mk8dxNumberLanguage.EN

/**
 * The hero of a night: its name in display type over the art of the track it
 * drove most, with what the night is underneath. HIGH spectacle (§5), and the
 * one place on the page that carries a backdrop.
 */
@Composable
private fun NightHero(
    event: AndroidPublicTournamentEvent,
    dutch: Boolean,
    trailing: (@Composable () -> Unit)? = null,
) {
    val mostDriven = remember(event) { androidNightHeroTrackIndex(event) }
    Mk8dxArtHero(
        title = event.editionNumber?.let { "TN$it · ${event.name}" } ?: event.name,
        meta = nightOverview(event, dutch),
        backdrop = mostDriven != null,
        // The backdrop fills the hero, whatever height its words take.
        art = mostDriven?.let { index ->
            {
                TrackAssetArtwork(
                    trackIndex = index,
                    modifier = Modifier.fillMaxSize(),
                    contentDescription = null,
                )
            }
        },
        content = trailing?.let { { it() } },
    )
}

/** The track a night drove most, as the index its artwork is filed under. */
internal fun androidNightHeroTrackIndex(event: AndroidPublicTournamentEvent): Int? {
    val counted = event.groups
        .flatMap { group -> group.races }
        .mapNotNull { it.trackId }
        .groupingBy { it }
        .eachCount()
    val trackId = counted.maxByOrNull { it.value }?.key ?: return null
    return Schema9AndroidTrackCatalog.find(trackId)?.index
}

/**
 * The bar that says where the reader is, as the site prints it: the Player or
 * the block, their meta line under it, and the character beside the name.
 */
@Composable
private fun ReportContextBar(anchor: AndroidReportAnchor) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                anchor.title,
                style = Mk8dxTheme.type.label.copy(fontWeight = FontWeight.Bold),
                color = colors.textPrimary,
                textAlign = TextAlign.Center,
            )
            anchor.characterAsset?.let { asset ->
                Spacer(Modifier.width(Mk8dxSpacing.sm))
                nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage(
                    path = asset,
                    fallback = "",
                    accent = colors.textSecondary,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        if (anchor.subtitle.isNotEmpty()) {
            Text(
                anchor.subtitle,
                style = Mk8dxTheme.type.micro,
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The published night.
 *
 * The order is the site's own: the story, the standing of every group as the
 * report's index, the Top 5 driven, and then a section per group with a
 * section per Player inside it.
 */
@Composable
private fun ReportDocument(
    event: AndroidPublicTournamentEvent,
    written: AndroidTournamentStory?,
    dutch: Boolean,
    register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit,
    onOpenPlayer: (String) -> Unit,
    onBackToStanding: () -> Unit,
) {
    val report = androidTournamentReport(event)
    val shows = event.report?.visibility ?: AndroidPublicReportVisibility()
    val story = written?.let { androidStoryShown(it, shows) }
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xl),
    ) {
        NightHero(event, dutch)
        if (story != null && (story.intro.isNotEmpty() || story.summary.isNotEmpty())) {
            StoryCard(story, dutch)
        }
        if (report.groups.isNotEmpty()) {
            StandingsGrid(
                report,
                // Only when the report itself is the finals; a night that
                // never had a final round is its own single row of tables.
                if (report.groups.any { it.stage == "final" }) {
                    event.groups
                        .filter { it.stage == "qualifier" && it.standings.isNotEmpty() }
                        .sortedBy { it.sequence }
                } else {
                    emptyList()
                },
                event.editionNumber,
                dutch,
                register,
                onOpenPlayer,
            )
        }
        val told = story?.topTracks.orEmpty()
        if (shows.topTracks && (report.topTracks.isNotEmpty() || told.isNotEmpty())) {
            val title = if (dutch) "Top 5 gereden banen" else "Top 5 tracks driven"
            Column(
                Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { register(title, AndroidReportAnchor(title), it) },
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Heading(title)
                told.forEach { Paragraph(it) }
                if (report.topTracks.isNotEmpty()) { TopTracks(report.topTracks, dutch) }
            }
        }
        report.groups.forEach { group ->
            GroupSection(
                group = group,
                story = story,
                report = report,
                editionNumber = event.editionNumber,
                shows = shows,
                dutch = dutch,
                register = register,
                onBackToStanding = onBackToStanding,
            )
        }
    }
}

/** The block the export opens with: the night's own heading and its note. */
@Composable
private fun StoryCard(story: AndroidTournamentStory, dutch: Boolean) {
    var expanded by remember(story) { mutableStateOf(false) }
    Mk8dxPanel(title = null) {
        Mk8dxDisplayText(story.title, Mk8dxTheme.type.display6)
        story.intro.firstOrNull()?.let { Paragraph(it) }
        val rest = story.intro.drop(1)
        if (rest.isNotEmpty()) {
            // The site folds a long introduction behind "Lees verder"; so does
            // this, because the phone's column is the narrower of the two.
            Mk8dxButton(
                if (expanded) {
                    if (dutch) "Minder" else "Show less"
                } else {
                    if (dutch) "Lees verder" else "Read on"
                },
                { expanded = !expanded },
                variant = Mk8dxButtonVariant.Quiet,
                size = Mk8dxButtonSize.Sm,
            )
            if (expanded) { rest.forEach { Paragraph(it) } }
        }
        if (story.summary.isNotEmpty()) {
            Heading(if (dutch) "Samenvatting" else "Summary")
            story.summary.forEach { Paragraph(it) }
        }
        if (story.sourceUrl.isNotEmpty()) {
            // Where the write-up came from, and it opens it. The export has no
            // such line: it is the original, and this is a copy of it.
            val browser = LocalUriHandler.current
            Mk8dxButton(
                if (dutch) "Lees het originele verslag" else "Read the original report",
                { runCatching { browser.openUri(story.sourceUrl) } },
                variant = Mk8dxButtonVariant.Quiet,
                size = Mk8dxButtonSize.Sm,
            )
        }
    }
}

/**
 * The standing of every group: rank, name, character and points, the first
 * three on their podium mark, every name a way into that Player's own section.
 * This is the report's index; the site has no chips here and neither has this.
 *
 * Two rows of tables, as the site draws them: the qualifiers above under
 * "Kwalificatie", the finals below under "Eindklassen". A qualifier row carries
 * the colour of the final group that Player went on to, so the night can be
 * read upwards from where someone ended (owner, 2026-09-15/16).
 */
@Composable
private fun StandingsGrid(
    report: AndroidTournamentReport,
    qualifiers: List<AndroidPublicGroup>,
    editionNumber: Int?,
    dutch: Boolean,
    register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit,
    onOpenPlayer: (String) -> Unit,
) {
    // Where each Player ended up, by name: that final group's colour is what
    // paints their qualifier row.
    val destination = report.groups.flatMap { group ->
        group.players.map { it.displayName to group.tierKey }
    }.toMap()
    val numbers = numbersFor(dutch)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md)) {
        if (qualifiers.isNotEmpty()) {
            RowHead(if (dutch) "Kwalificatie" else "Qualifier")
            qualifiers.forEach { group ->
                val label = androidGroupLabel(group.name, group.tierKey, dutch)
                StandingsBoard(
                    label = label,
                    meta = if (dutch) {
                        "${group.standings.size} spelers · kleur: de eindgroep waar ze naartoe gingen"
                    } else {
                        "${group.standings.size} players · colour: the final group they went on to"
                    },
                    accent = null,
                    numbers = numbers,
                    dutch = dutch,
                    register = register,
                    rows = group.standings.sortedBy { it.rank }.map { row ->
                        StandingsRow(
                            rank = row.rank,
                            displayName = row.displayName,
                            character = row.character,
                            points = row.points,
                            wash = destination[row.displayName]
                                ?.let { androidTournamentTierColor(it)?.copy(alpha = 0.18f) },
                        )
                    },
                    editionNumber = editionNumber,
                    onOpenPlayer = onOpenPlayer,
                )
            }
        }
        RowHead(
            when {
                report.groups.any { it.stage == "final" } -> if (dutch) "Eindklassen" else "Final groups"
                else -> if (dutch) "Groepen" else "Groups"
            },
        )
        report.groups.forEach { group ->
            val label = androidGroupLabel(group.name, group.tierKey, dutch)
            StandingsBoard(
                label = label,
                meta = if (dutch) "${group.players.size} spelers" else "${group.players.size} players",
                accent = androidTournamentTierColor(group.tierKey),
                numbers = numbers,
                dutch = dutch,
                register = register,
                rows = group.players.map { player ->
                    StandingsRow(
                        rank = player.groupRank,
                        displayName = player.displayName,
                        character = player.character,
                        points = player.points,
                    )
                },
                editionNumber = editionNumber,
                onOpenPlayer = onOpenPlayer,
            )
        }
    }
}

/**
 * A finished night whose report is not published: the site shows exactly two
 * rows of the same tables, the qualifiers above under "Kwalificatie" and the
 * finals below under "Eindklassen", and nothing else. So does this - the same
 * boards as the published document.
 */
@Composable
private fun FinishedNightStandings(
    event: AndroidPublicTournamentEvent,
    dutch: Boolean,
) {
    val groups = event.groups.sortedBy { it.sequence }
    val qualifiers = groups.filter { it.stage == "qualifier" && it.standings.isNotEmpty() }
    val finals = groups.filter { it.stage != "qualifier" && it.standings.isNotEmpty() }
    // Where each Player ended up, by name: that final group's colour is what
    // paints their qualifier row.
    val destination = finals.flatMap { group ->
        group.standings.map { it.displayName to group.tierKey }
    }.toMap()
    val numbers = numbersFor(dutch)
    val rowsOf: (AndroidPublicGroup, Boolean) -> List<StandingsRow> = { group, qualifier ->
        group.standings.sortedBy { it.rank }.map { row ->
            StandingsRow(
                rank = row.rank,
                displayName = row.displayName,
                character = row.character,
                points = row.points,
                wash = if (qualifier) {
                    destination[row.displayName]
                        ?.let { androidTournamentTierColor(it)?.copy(alpha = 0.18f) }
                } else {
                    null
                },
            )
        }
    }
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        if (qualifiers.isNotEmpty()) {
            RowHead(if (dutch) "Kwalificatie" else "Qualifier")
            qualifiers.forEach { group ->
                StandingsBoard(
                    label = androidGroupLabel(group.name, group.tierKey, dutch),
                    meta = if (dutch) {
                        "${group.standings.size} spelers · kleur: de eindgroep waar ze naartoe gingen"
                    } else {
                        "${group.standings.size} players · colour: the final group they went on to"
                    },
                    accent = null,
                    numbers = numbers,
                    dutch = dutch,
                    rows = rowsOf(group, true),
                    editionNumber = event.editionNumber,
                )
            }
        }
        RowHead(
            when {
                qualifiers.isEmpty() -> if (dutch) "Groepen" else "Groups"
                else -> if (dutch) "Eindklassen" else "Final groups"
            },
        )
        finals.forEach { group ->
            StandingsBoard(
                label = androidGroupLabel(group.name, group.tierKey, dutch),
                meta = if (dutch) "${group.standings.size} spelers" else "${group.standings.size} players",
                accent = androidTournamentTierColor(group.tierKey),
                numbers = numbers,
                dutch = dutch,
                rows = rowsOf(group, false),
                editionNumber = event.editionNumber,
            )
        }
    }
}

/** The head above a row of tables, centred as the site centres it. */
@Composable
private fun RowHead(text: String) {
    Mk8dxDisplayText(
        text,
        Mk8dxTheme.type.display6,
        Modifier.fillMaxWidth(),
    )
}

/** One line of a standing, whichever half of the night it belongs to. */
private data class StandingsRow(
    val rank: Int,
    val displayName: String,
    val character: AndroidPublicCharacter?,
    val points: Int,
    val wash: Color? = null,
)

/** One table: the group's name, its meta line, and its rows. */
@Composable
private fun StandingsBoard(
    label: String,
    meta: String,
    accent: Color?,
    numbers: Mk8dxNumberLanguage,
    dutch: Boolean,
    rows: List<StandingsRow>,
    editionNumber: Int?,
    register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit = { _, _, _ -> },
    onOpenPlayer: ((String) -> Unit)? = null,
) {
    Mk8dxGroupBoard(
        title = label,
        meta = meta,
        accent = accent,
        rows = rows.map {
            Mk8dxBoardRow(
                rank = it.rank,
                name = it.displayName,
                value = it.points.toString(),
                wash = it.wash,
            )
        },
        language = numbers,
        // The export keeps these four in English in both languages; the name
        // and the points column follow the reader.
        columns = Triple("#", if (dutch) "Speler" else "Name", if (dutch) "Pnt" else "Pts"),
        modifier = Modifier.onGloballyPositioned { register(label, AndroidReportAnchor(label, meta), it) },
        onRowClick = onOpenPlayer?.let { open -> { row -> open(row.name) } },
        face = { row ->
            CharacterFace(
                editionNumber,
                row.name,
                rows.firstOrNull { it.displayName == row.name }?.character,
                gap = false,
            )
        },
    )
}

/**
 * One group of the report: its heading, the tag and the count the export
 * prints beside it, the Director's note, and then every Player in it.
 */
@Composable
private fun GroupSection(
    group: AndroidReportGroup,
    story: AndroidTournamentStory?,
    report: AndroidTournamentReport,
    editionNumber: Int?,
    shows: AndroidPublicReportVisibility,
    dutch: Boolean,
    register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit,
    onBackToStanding: () -> Unit,
) {
    val label = androidGroupLabel(group.name, group.tierKey, dutch)
    val accent = androidTournamentTierColor(group.tierKey)
    Column(
        Modifier
            .fillMaxWidth()
            // The group's own coloured edge down the left, as the site draws it.
            .drawBehind { if (accent != null) drawRect(accent, size = Size(5.dp.toPx(), size.height)) }
            .padding(start = Mk8dxSpacing.md),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxDisplayText(label, Mk8dxTheme.type.display6)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            if (accent != null) Mk8dxTierChip(label, accent) else Mk8dxChip(label)
            Mk8dxMetaLine(
                if (dutch) {
                    "${group.players.size} spelers · ${group.raceCount} races"
                } else {
                    "${group.players.size} players · ${group.raceCount} races"
                },
            )
        }
        val note = story?.groups?.firstOrNull {
            it.name.lowercase().contains(group.name.lowercase())
        }
        note?.paragraphs?.forEach { Paragraph(it) }
        group.players.forEach { player ->
            PlayerSection(
                player = player,
                note = story?.players?.firstOrNull { it.name == player.displayName },
                playerCount = report.playerCount,
                maxPosition = report.maxPosition,
                editionNumber = editionNumber,
                visibility = shows,
                dutch = dutch,
                register = register,
                onBackToStanding = onBackToStanding,
            )
        }
    }
}

/**
 * The night that is still being run: the operator-free view of it. A night
 * being raced is the one filled thing the product shows (§4 A4): the Live tag
 * on its hero.
 */
@Composable
private fun RunningNight(event: AndroidPublicTournamentEvent, dutch: Boolean, liveGroups: List<AndroidPublicLiveGroup>) {
    val running = event.stage != "finalized" && event.stage != "setup"
    val numbers = numbersFor(dutch)
    NightHero(event, dutch) {
        if (running) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Mk8dxLiveTag(if (dutch) "Bezig" else "Live")
            }
        }
    }

    val step = event.workflowStep
    if (step != null) {
        Mk8dxMetaLine(
            (if (dutch) "Stap $step van 10 · " else "Step $step of 10 · ") +
                tournamentStepState(step, dutch),
        )
        val scoring = tournamentScoringGroups(event, step)
        if (scoring.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
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

    if (liveGroups.isNotEmpty()) {
        Heading(if (dutch) "Live-tussenstanden" else "Live standings")
        Mk8dxMetaLine(
            if (dutch) {
                "Live gebruikt ingamenamen. Player-profielen worden na Stop en de eindcontrole gekoppeld."
            } else {
                "Live uses in-game names. Player profiles are linked after Stop and the final check."
            },
        )
        liveGroups.forEach { live ->
            val name = event.groups.firstOrNull { it.groupId == live.groupId }?.name ?: live.groupId
            LiveStandingBoard(androidGroupLabel(name, null, dutch), live, dutch, numbers)
        }
    }

    // A finished night is the site's two rows of tables and nothing else; a
    // night still being run keeps the running view, group by group.
    val finished = event.stage == "finalized" &&
        event.groups.any { it.stage != "qualifier" && it.standings.isNotEmpty() }
    if (finished) {
        FinishedNightStandings(event, dutch)
    } else {
        val ordered = event.groups
            .sortedWith(compareBy({ if (it.stage == "qualifier") 0 else 1 }, { it.sequence }))
        val hasQualifiers = ordered.any { it.stage == "qualifier" }
        var headed: String? = null
        ordered.forEach { group ->
            if (group.stage != headed) {
                headed = group.stage
                RowHead(
                    when {
                        group.stage == "qualifier" -> if (dutch) "Kwalificatie" else "Qualifier"
                        hasQualifiers -> if (dutch) "Eindklassen" else "Final groups"
                        else -> if (dutch) "Groepen" else "Groups"
                    },
                )
            }
            if (group.standings.isEmpty()) {
                Mk8dxPanel(title = androidGroupLabel(group.name, group.tierKey, dutch)) {
                    Mk8dxMetaLine(if (dutch) "Nog niemand ingedeeld." else "Nobody placed yet.")
                }
            } else {
                StandingsBoard(
                    label = androidGroupLabel(group.name, group.tierKey, dutch),
                    meta = if (dutch) "${group.standings.size} spelers" else "${group.standings.size} players",
                    accent = androidTournamentTierColor(group.tierKey),
                    numbers = numbers,
                    dutch = dutch,
                    rows = group.standings.sortedBy { it.rank }.map { row ->
                        StandingsRow(
                            rank = row.rank,
                            displayName = row.displayName,
                            character = row.character,
                            points = row.points,
                        )
                    },
                    editionNumber = event.editionNumber,
                )
            }
        }
    }

    // A finished night whose Director has not published yet: the tables are
    // the night, and the site says in as many words what is still to come.
    if (event.stage == "finalized" && event.report == null) {
        Mk8dxStatusMessage(
            if (dutch) {
                "Het verslag van deze avond is nog niet gepubliceerd. Zodra dat " +
                    "gebeurt staan hier het verhaal, de Top 5 banen en per speler " +
                    "een eigen stuk met grafieken."
            } else {
                "The report of this night has not been published yet. Once it is, " +
                    "the story, the Top 5 tracks and a section per Player with their " +
                    "charts appear here."
            },
            tone = Mk8dxStatusTone.Info,
        )
    }

    // The site prints no overall list beside those tables, so this does not
    // either: the two rows of tables are the night.
    if (event.overall.isNotEmpty() && event.stage == "finalized" && event.report != null) {
        Heading(if (dutch) "Eindklassement" else "Overall result")
        Mk8dxGroupBoard(
            title = if (dutch) "Eindklassement" else "Overall result",
            rows = event.overall.map {
                Mk8dxBoardRow(rank = it.placement, name = it.displayName, value = "")
            },
            language = numbers,
            columns = Triple("#", if (dutch) "Speler" else "Player", ""),
        )
    }
}

@Composable
private fun LiveStandingBoard(
    name: String,
    live: AndroidPublicLiveGroup,
    dutch: Boolean,
    numbers: Mk8dxNumberLanguage,
) {
    val state = when (live.status) {
        "live" -> "Live"
        "stopping" -> if (dutch) "Stoppen · laatste upload volgt" else "Stopping · final upload pending"
        else -> if (dutch) "Gestopt · eindcontrole" else "Stopped · final review"
    }
    Mk8dxGroupBoard(
        title = name,
        meta = "$state · ${live.countedRaces}/${live.receivedRaces} " +
            (if (dutch) "races tellen mee" else "races counted"),
        accent = Mk8dxTheme.colors.live,
        rows = live.standings.sortedBy { it.rank }.map { standing ->
            Mk8dxBoardRow(
                rank = standing.rank,
                name = standing.observedPlayerName,
                value = standing.total.toString(),
            )
        },
        language = numbers,
        columns = Triple("#", if (dutch) "Speler" else "Player", "Total"),
        header = { if (live.status == "live") Mk8dxLiveTag("Live") },
    )
    if (live.controlPoints.isNotEmpty()) Mk8dxMetaLine(live.controlPoints.joinToString(" · "))
}

/** "Kwalificaties bezig · 36 spelers · 2026-09-08 · 8 races". */
internal fun nightOverview(event: AndroidPublicTournamentEvent, dutch: Boolean): String {
    val stage = when (event.stage) {
        "setup" -> if (dutch) "Voorbereiden" else "Preparing"
        "qualifiers" -> if (dutch) "Kwalificaties bezig" else "Qualifiers in progress"
        "finals" -> if (dutch) "Finales bezig" else "Finals in progress"
        else -> if (dutch) "Einduitslag" else "Final results"
    }
    val races = event.groups.sumOf { it.races.size }
    return listOfNotNull(
        stage,
        if (dutch) "${event.participantCount} spelers" else "${event.participantCount} players",
        event.eventDate,
        if (races == 0) null else "$races races",
    ).joinToString(" · ")
}

@Composable
private fun Heading(text: String) {
    Mk8dxSectionLabel(text.uppercase())
}

@Composable
private fun Paragraph(text: String) {
    Text(
        text,
        // §12: a report is read, so its body keeps a reading measure rather
        // than running the full width of a tablet.
        modifier = Modifier.widthIn(max = 640.dp),
        style = Mk8dxTheme.type.body,
        color = Mk8dxTheme.colors.textBody,
    )
}

/** The character a Player drove, drawn beside their name as the site draws it. */
@Composable
private fun CharacterFace(
    editionNumber: Int?,
    displayName: String,
    character: AndroidPublicCharacter?,
    gap: Boolean = true,
) {
    val asset = androidReportCharacterAsset(editionNumber, displayName, character) ?: return
    if (gap) { Spacer(Modifier.width(Mk8dxSpacing.sm)) }
    nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage(
        path = asset,
        fallback = character?.label?.take(1) ?: "?",
        accent = Mk8dxTheme.colors.textSecondary,
        contentDescription = character?.label ?: "",
        modifier = Modifier.size(22.dp),
    )
}

/**
 * The Top 5 driven, as the site draws it: the track's own picture behind its
 * row, then the rank, the name and how often it came up.
 */
@Composable
private fun TopTracks(tracks: List<Pair<String, Int>>, dutch: Boolean) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(colors.surfaceControl)
                .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            val head = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold)
            Text("#", style = head, color = colors.textSecondary, modifier = Modifier.width(28.dp))
            Text(
                if (dutch) "Baan" else "Track",
                style = head, color = colors.textSecondary, modifier = Modifier.weight(1f),
            )
            Text(
                if (dutch) "Keer gespeeld" else "Times played",
                style = head, color = colors.textSecondary,
            )
        }
        tracks.forEachIndexed { index, (trackId, count) ->
            val entry = Schema9AndroidTrackCatalog.entries.firstOrNull { it.id == trackId }
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 62.dp)
                    .border(1.dp, colors.borderSubtle),
            ) {
                if (entry != null) {
                    TrackAssetArtwork(
                        trackIndex = entry.index,
                        modifier = Modifier.fillMaxWidth().height(62.dp),
                        contentDescription = entry.displayName,
                    )
                }
                // The picture is a background: the site holds it at about a
                // third and writes over it, so the row's own text stays
                // legible whatever the artwork happens to be.
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(62.dp)
                        .background(colors.surfaceApp.copy(alpha = 0.82f)),
                )
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 62.dp)
                        .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Text(
                        "${index + 1}",
                        style = Mk8dxTheme.type.data,
                        color = colors.textSecondary,
                        modifier = Modifier.width(28.dp),
                    )
                    Text(
                        entry?.displayName ?: trackId.removePrefix("track."),
                        style = Mk8dxTheme.type.body.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "$count",
                        style = Mk8dxTheme.type.dataM,
                        color = colors.textPrimary,
                        softWrap = false, maxLines = 1,
                    )
                }
            }
        }
    }
}

/**
 * One Player's own section of the report: the name and the character, the meta
 * line, the stats line, the Director's note - or the generated sentence the
 * site falls back to - and then the five charts, on a panel with that Player's
 * own accent down its left edge.
 */
@Composable
private fun PlayerSection(
    player: AndroidReportPlayer,
    note: AndroidTournamentStoryPlayer?,
    playerCount: Int,
    maxPosition: Int,
    editionNumber: Int?,
    visibility: AndroidPublicReportVisibility,
    dutch: Boolean,
    register: (String, AndroidReportAnchor, LayoutCoordinates) -> Unit = { _, _, _ -> },
    onBackToStanding: () -> Unit = {},
) {
    val colors = Mk8dxTheme.colors
    val accent = androidReportAccent(player.groupRank)
    val meta = playerMetaLine(player, playerCount, dutch)
    val icon = androidReportCharacterAsset(editionNumber, player.displayName, player.character)
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .drawBehind { drawRect(accent, size = Size(6.dp.toPx(), size.height)) }
            .padding(start = Mk8dxSpacing.lg, top = Mk8dxSpacing.md, end = Mk8dxSpacing.md, bottom = Mk8dxSpacing.md)
            .onGloballyPositioned {
                register(player.displayName, AndroidReportAnchor(player.displayName, meta, icon), it)
            },
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Mk8dxDisplayText(player.displayName, Mk8dxTheme.type.display6)
            CharacterFace(editionNumber, player.displayName, player.character)
        }
        Mk8dxMetaLine(meta)
        Text(
            playerStatsLine(player, dutch),
            style = Mk8dxTheme.type.bodyS,
            color = colors.textBody,
        )
        Heading(if (dutch) "Samenvatting" else "Summary")
        val paragraphs = note?.paragraphs.orEmpty()
        if (paragraphs.isEmpty()) {
            Paragraph(generatedSummary(player, dutch))
        } else {
            paragraphs.forEach { Paragraph(it) }
            if (note != null && note.analysis.isNotEmpty()) {
                Heading(if (dutch) "Analyse & Statistieken" else "Analysis & statistics")
                note.analysis.forEach { Paragraph(it) }
            }
        }
        AndroidReportPlayerCharts(player, maxPosition, dutch, visibility)
        // The line the site closes every section with.
        Mk8dxButton(
            if (dutch) "Terug naar eindstand" else "Back to the standing",
            onBackToStanding,
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
        )
    }
}

/** "Rank #1 van #35 | Kampioen #1". */
internal fun playerMetaLine(
    player: AndroidReportPlayer,
    playerCount: Int,
    dutch: Boolean,
): String = listOfNotNull(
    player.overallRank?.let {
        if (dutch) "Rank #$it van #$playerCount" else "Rank #$it of #$playerCount"
    },
    "${androidGroupLabel(player.groupName, player.groupTierKey, dutch)} #${player.groupRank}",
).joinToString(" | ")

/** "Overwinningen: 9 (20,5%) | Top 3: 24 (54,5%) | Gem. pos: 4,36". */
internal fun playerStatsLine(player: AndroidReportPlayer, dutch: Boolean): String {
    if (player.raceCount == 0) {
        return if (dutch) "Geen races vastgelegd" else "No races recorded"
    }
    val wins = androidReportPercent(player.winCount, player.raceCount, dutch)
    val top3 = androidReportPercent(player.top3Count, player.raceCount, dutch)
    val average = androidReportNumber(player.avgFinish ?: 0.0, 2, dutch)
    return if (dutch) {
        "Overwinningen: ${player.winCount} ($wins) | Top 3: ${player.top3Count} ($top3) | Gem. pos: $average"
    } else {
        "Wins: ${player.winCount} ($wins) | Top 3: ${player.top3Count} ($top3) | Avg. pos: $average"
    }
}

/** What the site writes when the Director left no note for this Player. */
internal fun generatedSummary(player: AndroidReportPlayer, dutch: Boolean): String {
    val place = if (dutch) "${player.groupRank}e" else "#${player.groupRank}"
    val group = androidGroupLabel(player.groupName, player.groupTierKey, dutch)
    if (player.raceCount == 0) {
        return if (dutch) {
            "${player.displayName} eindigde als $place in $group met ${player.points} punten."
        } else {
            "${player.displayName} finished $place in $group with ${player.points} points."
        }
    }
    return if (dutch) {
        "${player.displayName} eindigde als $place in $group met ${player.points} punten: " +
            "${player.raceCount} races, ${player.winCount} overwinning" +
            (if (player.winCount == 1) "" else "en") +
            " en ${player.top3Count} keer top 3."
    } else {
        "${player.displayName} finished $place in $group with ${player.points} points: " +
            "${player.raceCount} races, ${player.winCount} win" +
            (if (player.winCount == 1) "" else "s") +
            " and ${player.top3Count} top-3 finish" +
            (if (player.top3Count == 1) "" else "es") + "."
    }
}

/**
 * The colour a named tier carries, or null where the group has no tier.
 *
 * The recovered ladder's own values, and the only definition of them: the
 * report used to keep a second, paler set for its paper, and there is no paper
 * any more. They are product data rather than tokens (the same decision the
 * Mastery ladder got in Phase 6), so the label on them goes through
 * `Mk8dxTierChip`, which chooses a readable ink, and the group's name is always
 * written beside the colour - nothing is carried by the hue alone.
 */
internal fun androidTournamentTierColor(tierKey: String?): Color? = when (tierKey) {
    // The site's own accents, the ones that actually win in the stylesheet
    // (owner, 2026-09-16: the tiers must carry the same colour as on the
    // site), including the two an early edition used for its winners' and
    // losers' poules.
    "champion", "winners" -> Color(0xFFF59E0B)
    "talent", "losers" -> Color(0xFF38BDF8)
    "wild" -> Color(0xFFA78BFA)
    "adventure" -> Color(0xFF4ADE80)
    "feest" -> Color(0xFFEC4899)
    else -> null
}

/**
 * A Player's own accent in their section of the report.
 *
 * The hue is the Player's (it is what tells two sections apart); the lightness
 * follows the appearance, because one fixed `hsl(H 46% 38%)` was ink for white
 * paper and disappears on the product's own dark surface.
 */
@Composable
internal fun androidReportAccent(groupRank: Int): Color {
    val hue = androidReportAccentHue(groupRank)
    return if (Mk8dxTheme.appearance == nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance.Light) {
        Color.hsl(hue, 0.46f, 0.38f)
    } else {
        Color.hsl(hue, 0.62f, 0.66f)
    }
}

/** A published report read as the story the document is built from. */
internal fun androidStoryFromReport(report: AndroidPublicReport): AndroidTournamentStory =
    AndroidTournamentStory(
        edition = 0,
        sourceUrl = "",
        title = report.title,
        intro = report.intro,
        summary = report.summary,
        topTracks = report.topTracks,
        groups = report.groups,
        players = report.players.map {
            AndroidTournamentStoryPlayer(name = it.name, paragraphs = it.paragraphs)
        },
    )
