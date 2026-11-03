package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFactRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxHeroRank
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

/**
 * One Player's own page.
 *
 * The site has had one since the beginning - `/?player=nola` - and the phone
 * had nowhere for a name to lead, so a name in the Tournament standing was a
 * toggle and nothing else. This is the destination: who they are, where they
 * stand, whom they actually race, and their record over the ninety-six tracks.
 *
 * It is deliberately built from what the phone already fetches. The parts of
 * the site's profile that belong to a signed-in viewer's private preferences -
 * following, rivalries, aliases, the Mastery tab - stay on the site, and the
 * page says so with a link rather than pretending they are not there.
 *
 * Phase 6 (A04) put it on the design system: token surfaces, the rank as a hero
 * numeral, the record as stat blocks and facts in tabular Plex Mono.
 */
@Composable
internal fun AndroidPlayerPage(
    client: AndroidTimeTrialsEcosystemDataSource?,
    playerId: String,
    standing: List<AndroidTournamentStandingEntry>,
    language: AndroidProductLanguage,
    onBack: () -> Unit,
    onOpenPlayer: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** The signed-in Player, for "You and <Player>"; null when signed out. */
    viewerPlayerId: String? = null,
) {
    var profile by remember(client, playerId) { mutableStateOf<AndroidProfilePlayer?>(null) }
    var rivalries by remember(client, playerId) {
        mutableStateOf(emptyList<AndroidTournamentRivalry>())
    }
    var tracks by remember(client, playerId) {
        mutableStateOf<AndroidTournamentTrackRecord?>(null)
    }
    var loading by remember(client, playerId) { mutableStateOf(true) }
    var failed by remember(client, playerId) { mutableStateOf(false) }

    LaunchedEffect(client, playerId) {
        val active = client
        if (active == null) {
            loading = false
            failed = true
            return@LaunchedEffect
        }
        withContext(Dispatchers.IO) {
            profile = runCatching { active.playerProfile(playerId) }.getOrNull()
            rivalries = runCatching { active.tournamentRivalries(playerId) }
                .getOrDefault(emptyList())
            tracks = runCatching { active.tournamentTrackRecord(playerId) }.getOrNull()
        }
        failed = profile == null
        loading = false
    }

    val row = standing.firstOrNull { it.playerId == playerId }
    val name = profile?.displayName ?: row?.displayName ?: playerId
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val numbers = if (language == AndroidProductLanguage.DUTCH) {
        Mk8dxNumberLanguage.NL
    } else {
        Mk8dxNumberLanguage.EN
    }

    // No scroll of its own: the Ranking screen this sits inside is already a
    // scrolling column, and a second one inside it measures with an unbounded
    // height and crashes.
    Column(
        modifier.fillMaxWidth().padding(vertical = Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxButton(
            androidText(language, "← Ranking", "← Ranglijst"),
            onBack,
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
            modifier = Modifier.testTag("player-page-back"),
        )
        val username = profile?.username?.value.orEmpty().ifEmpty { row?.username.orEmpty() }
        // Identity art belongs beside the Player's name and is fitted in full;
        // it is not a cropped decorative backdrop.
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            AndroidPlayerAvatar(profile?.avatarId, name, 64.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                Text(
                    name,
                    modifier = Modifier.testTag("player-page-name").semantics { heading() },
                    style = type.display6,
                    color = colors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (username.isNotEmpty()) {
                    Text("@$username", color = colors.textSecondary, style = type.bodyS)
                }
            }
        }
        when {
            loading -> Text(androidText(language, "Loading…", "Laden…"), color = colors.textSecondary, style = type.body)
            failed && row == null -> Text(
                androidText(
                    language,
                    "This Player could not be loaded. Retry later.",
                    "Deze speler kon niet worden geladen. Probeer het later opnieuw.",
                ),
                color = colors.textSecondary,
                style = type.body,
            )
        }

        // "You and <Player>" (owner 2026-09-26): notifications about games and pokes open here.
        if (client != null && viewerPlayerId != null && viewerPlayerId != playerId) {
            AndroidPlayerInteractionsPanel(client, viewerPlayerId, playerId, name)
        }

        if (row != null) {
            Mk8dxPanel(androidText(language, "TOURNAMENT", "TOERNOOI")) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Mk8dxHeroRank(row.rank, numbers, androidText(language, "Standing", "Positie"))
                    androidTournamentTierByRank(row.rank)?.let { tier ->
                        Mk8dxTierChip(androidTournamentTierBadge(tier, LocalAndroidProductLanguage.current), tier.color)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg)) {
                    Mk8dxStatBlock(
                        androidText(language, "Rating", "Rating"),
                        row.score?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—",
                        Modifier.weight(1f),
                        large = true,
                    )
                    Mk8dxStatBlock(
                        androidText(language, "Races", "Races"),
                        row.races.toString(),
                        Modifier.weight(1f),
                        large = true,
                    )
                }
                Mk8dxFactRow(
                    androidText(language, "Tournaments", "Toernooien"),
                    row.tournaments.toString(),
                )
                Mk8dxFactRow(androidText(language, "Wins", "Winst"), row.wins.toString())
                Mk8dxFactRow(androidText(language, "Top 3", "Top 3"), row.podiums.toString())
                Mk8dxFactRow(
                    androidText(language, "Average finish", "Gemiddelde finish"),
                    androidTournamentAverageFinish(row)
                        ?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—",
                )
            }
        }

        if (rivalries.isNotEmpty()) {
            Mk8dxPanel(androidText(language, "TOP 5 COMPETITORS", "TOP 5 CONCURRENTEN")) {
                // Whom this Player actually races, and how those meetings went.
                // Each one opens their own page, the way the site's links do.
                rivalries.take(5).forEach { opponent ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = Mk8dxSpacing.targetMin)
                            .background(colors.surfaceControl)
                            .clickable { onOpenPlayer(opponent.playerId) }
                            .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.xs)
                            .semantics(mergeDescendants = true) { }
                            .testTag("player-page-rival-${opponent.playerId}"),
                    ) {
                        Text(
                            opponent.displayName, color = colors.textPrimary, style = type.title,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            androidText(
                                language,
                                "${opponent.sharedRaces} shared races · " +
                                    "${opponent.ahead} ahead · ${opponent.behind} behind",
                                "${opponent.sharedRaces} gedeelde races · " +
                                    "${opponent.ahead} voor · ${opponent.behind} achter",
                            ),
                            color = colors.textSecondary,
                            style = type.bodyS,
                        )
                    }
                }
            }
        }

        AndroidTournamentTrackSection(
            record = tracks,
            playerName = name,
            language = language,
            loading = loading,
            error = !loading && tracks == null,
        )

        // What is left on the site: following, rivalries, aliases and the
        // Mastery tab are a signed-in viewer's own settings about this Player,
        // and they live where they are managed.
        val context = LocalContext.current
        val reference = username.ifEmpty { playerId }
        Mk8dxButton(
            androidText(language, "Full profile on the site →", "Volledig profiel op de site →"),
            {
                openWebsite(
                    context,
                    "${nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin.current(context)}/?player=${android.net.Uri.encode(reference)}",
                )
            },
            variant = Mk8dxButtonVariant.Secondary,
            size = Mk8dxButtonSize.Sm,
            modifier = Modifier.testTag("player-page-open-site"),
        )
    }
}
