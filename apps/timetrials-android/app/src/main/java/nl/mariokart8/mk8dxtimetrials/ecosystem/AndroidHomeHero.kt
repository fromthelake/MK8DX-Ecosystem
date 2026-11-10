package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTierChip

/**
 * A01 Home — the hero (DESIGN_SYSTEM §5 HIGH, §4 A4), on the design system.
 *
 * Who you are, where you stand in both competitions, and the one thing to do.
 * Home is the product's only HIGH screen besides a night, so it is the one
 * personal surface allowed a backdrop: the track this Player drove most
 * recently, from the canonical track art, under the hero's own shade so display
 * type keeps its contrast whatever the artwork is (§16).
 *
 * Every value still comes from the bootstrap's `comeback` section, the tier
 * mapping and the Mastery ladder are the same recovered semantics, and each
 * standing still opens the page that explains it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AndroidHomeHero(
    home: AndroidHomeBootstrap,
    onSubmitTime: () -> Unit,
    onOpenRecords: () -> Unit,
    // Each standing opens the page that explains it: the Tournament rating is
    // a fact about a Player, Mastery is a per-track story.
    onOpenTournamentStanding: () -> Unit = {},
    onOpenMastery: () -> Unit = {},
    modifier: Modifier = Modifier,
    // Reported to the shell so the docked global action only appears once this
    // A4 has scrolled away (§11: one A4 per viewport).
    onActionVisibility: (Boolean) -> Unit = {},
) {
    val comeback = home.comeback ?: return
    val colors = Mk8dxTheme.colors
    val language = androidNumberLanguage()
    val modePreference = home.focus?.modePreference ?: "all"
    val tier = homeHeroTournamentTier(comeback.tournament)
    val masteryLabel = AndroidMasteryThresholds.tierLabels
        .getOrNull(AndroidMasteryThresholds.totalTier(150, comeback.timeTrials.totalMs))
    val showTimeTrials = comeback.timeTrials.standing > 0 && modePreference != "200"
    val backdropTrack = androidHomeBackdropTrackIndex(home, comeback.player.playerId)

    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .testTag("home-hero"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxArtHero(
            title = comeback.player.displayName,
            modifier = Modifier.testTag("home-hero-name"),
            meta = androidText("Welcome back", "Welkom terug"),
            backdrop = backdropTrack != null,
            art = backdropTrack?.let { index ->
                { TrackAssetArtwork(index, Modifier.fillMaxSize()) }
            },
            leading = { AndroidPlayerAvatar(comeback.player.avatarId, comeback.player.displayName, 48.dp) },
        )
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = Mk8dxSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            HeroDomain(
                label = androidText("Tournament", "Toernooi"),
                value = comeback.tournament?.let {
                    (if (it.of > 0) {
                        Mk8dxNumeric.formatRank(it.rank, language) + " " +
                            androidText("of", "van") + " " +
                            Mk8dxNumeric.formatCount(it.of.toLong(), language)
                    } else {
                        Mk8dxNumeric.formatRank(it.rank, language)
                    })
                },
                hint = comeback.tournament?.let {
                    androidText("Rating", "Rating") + " " +
                        String.format(Locale.ROOT, "%.2f", it.score)
                },
                badgePrefix = androidText("Tier:", "Klasse:"),
                badgeText = tier?.let { androidTournamentTierLabel(it.key, LocalAndroidProductLanguage.current) ?: it.name },
                badgeColor = tier?.color,
                testTag = "home-hero-tournament",
                onOpen = onOpenTournamentStanding.takeIf { comeback.tournament != null },
            )
            HeroDomain(
                // The headline standing is the 150cc standing; say so (E0 · R5),
                // as the web does, until a 200cc standing exists — and say it
                // with an EngineMark, not only in the words.
                label = androidText("Time Trials", "Time Trials"),
                engine = 150,
                value = if (showTimeTrials) {
                    Mk8dxNumeric.formatRank(comeback.timeTrials.standing, language) + " " +
                        androidText("of", "van") + " " +
                        Mk8dxNumeric.formatCount(comeback.timeTrials.of.toLong(), language)
                } else {
                    null
                },
                hint = if (showTimeTrials) {
                    androidText("Total", "Totaal") + " " + Mk8dxNumeric.formatTime(comeback.timeTrials.totalMs)
                } else {
                    null
                },
                badgePrefix = androidText("Mastery:", "Mastery:"),
                badgeText = if (showTimeTrials) masteryLabel?.let(::androidMasteryLongLabel) else null,
                badgeColor = masteryLabel
                    ?.let { AndroidMasteryThresholds.tierColors[it] }
                    ?.let(::androidParseColor),
                testTag = "home-hero-time-trials",
                onOpen = onOpenMastery.takeIf { showTimeTrials },
            )
        }
        // The one A4 of the page. The shell's own "Post a time" is hidden while
        // this is on screen and docks itself once it is not.
        Mk8dxButton(
            androidText("Post a time", "Tijd plaatsen"),
            onSubmitTime,
            variant = Mk8dxButtonVariant.Primary,
            size = Mk8dxButtonSize.Lg,
            stopwatch = true,
            tag = "home-hero-submit",
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Mk8dxSpacing.md)
                .androidReportVisibility(onActionVisibility),
        )
        Mk8dxButton(
            androidText("My records & stats", "Mijn records & statistieken"),
            onOpenRecords,
            variant = Mk8dxButtonVariant.Quiet,
            tag = "home-hero-records",
            modifier = Modifier.padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.xs),
        )
    }
}

/**
 * Reports whether this element is actually on screen. The shell uses it for the
 * docked global action, which §11 asks to appear only once the route's own A4
 * has scrolled out of view. `boundsInWindow` is the clipped rectangle, so a
 * scrolled-away element measures zero high without anybody computing offsets.
 */
internal fun Modifier.androidReportVisibility(onVisibility: (Boolean) -> Unit): Modifier =
    onGloballyPositioned { coordinates ->
        onVisibility(coordinates.isAttached && coordinates.boundsInWindow().height > 1f)
    }

/** The separators and thousands the Player's language prints. */
@Composable
internal fun androidNumberLanguage(): Mk8dxNumberLanguage =
    if (LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH) {
        Mk8dxNumberLanguage.NL
    } else {
        Mk8dxNumberLanguage.EN
    }

/**
 * The track behind the hero: the one this Player drove most recently, else the
 * first track their focus names. Stadium is introductory artwork for a Player
 * with no times yet; it does not select their first run. All art comes from the
 * canonical catalogue (§16).
 */
internal fun androidHomeBackdropTrackIndex(home: AndroidHomeBootstrap, playerId: String): Int? {
    val ownStory = home.stories?.stories
        ?.filter { it.player.playerId == playerId }
        ?.maxByOrNull { it.latestAtMs }
    val trackId = ownStory?.trackId
        ?: home.focus?.rows?.firstOrNull()?.trackId
        ?: "track.mario_kart_stadium"
    return Schema9AndroidTrackCatalog.find(trackId)?.index
}

/** The Player's chosen character, the same mark the web shows. */
@Composable
internal fun AndroidPlayerAvatar(
    avatarId: String?,
    displayName: String,
    size: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val part = avatarId?.let { id ->
        AndroidLoadoutVariants
            .characterParts(AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER))
            .firstOrNull { it.id == id }
    }
    if (part == null) {
        Box(
            modifier
                .size(size)
                .background(Mk8dxTheme.tint(colors, colors.personalAccent)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                displayName.take(1).uppercase(),
                style = Mk8dxTheme.type.title,
                color = colors.textPrimary,
            )
        }
    } else {
        ProductAssetImage(
            part.assetPath,
            displayName.take(1),
            colors.personalAccent,
            modifier.size(size),
            contentDescription = displayName,
        )
    }
}

/**
 * One standing: its name, the place as data, the fact under it, and the ladder
 * chip that names the class in words beside its colour.
 */
@Composable
private fun HeroDomain(
    label: String,
    value: String?,
    hint: String?,
    badgePrefix: String,
    badgeText: String?,
    badgeColor: Color?,
    testTag: String,
    engine: Int? = null,
    onOpen: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        modifier
            .widthIn(min = 140.dp)
            .heightIn(min = Mk8dxSpacing.targetMin)
            .then(
                if (onOpen == null) Modifier
                else Modifier.clickable(role = Role.Button, onClick = onOpen),
            )
            .testTag(testTag),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = type.micro, color = colors.textSecondary)
            if (engine != null) Mk8dxEngineMark(engine, size = Mk8dxEngineMarkSize.Md)
        }
        Text(
            value ?: "—",
            style = type.dataL,
            color = colors.textPrimary,
            softWrap = false,
            maxLines = 1,
        )
        if (hint != null) {
            Text(hint, style = type.dataS, color = colors.textSecondary, maxLines = 1, softWrap = false)
        }
        if (badgeText != null) {
            FlowRowBadge(badgePrefix, badgeText, badgeColor ?: colors.textSecondary)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowBadge(prefix: String, label: String, color: Color) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(
            prefix,
            style = Mk8dxTheme.type.bodyS,
            color = Mk8dxTheme.colors.textSecondary,
            modifier = Modifier.align(Alignment.CenterVertically),
        )
        Mk8dxTierChip(label, color)
    }
}

/** "Adv B" is the compact ladder label; the hero spells it out as the web does. */
internal fun androidMasteryLongLabel(label: String): String {
    val expanded = mapOf(
        "Myth" to "Mythic", "Titan" to "Titan", "Hero" to "Hero",
        "Exp" to "Expert", "Adv" to "Advanced", "Int" to "Intermediate",
        "Beg" to "Beginner",
    )
    val parts = label.split(' ')
    val head = parts.firstOrNull() ?: label
    val tail = parts.drop(1).joinToString(" ")
    val long = expanded[head] ?: head
    return if (tail.isEmpty()) long else "$long $tail"
}

internal fun androidParseColor(hex: String): Color? = runCatching {
    Color(android.graphics.Color.parseColor(hex))
}.getOrNull()

/** No tier before a first rated race: list order alone earns none (as on the web). */
internal fun homeHeroTournamentTier(standing: AndroidTournamentStanding?) =
    standing?.takeIf { it.played != false }?.let { androidTournamentTierByRank(it.rank) }
