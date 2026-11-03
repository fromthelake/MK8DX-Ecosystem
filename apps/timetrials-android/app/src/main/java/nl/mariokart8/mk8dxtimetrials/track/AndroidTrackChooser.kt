package nl.mariokart8.mk8dxtimetrials.track

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * The track chooser on the design system (A02, and the Post-a-Time task's own
 * TrackSelector when a time is posted without a track).
 *
 * The behaviour is the one the product has always had — 24 cups, 96 tracks,
 * search across the English and the Dutch name and the id, a cup's four tracks,
 * and "All cups" back out — drawn with design-system surfaces, type and targets.
 * The result count is announced, which the combobox pattern of POST_A_TIME §6
 * asks for and the legacy grid never did.
 */
@Composable
internal fun AndroidTrackChooser(
    onTrackSelected: (AndroidTrackCatalogEntry) -> Unit,
    modifier: Modifier = Modifier,
    heading: String? = null,
    tracks: List<AndroidTrackCatalogEntry> = Schema9AndroidTrackCatalog.entries,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var query by remember { mutableStateOf("") }
    var selectedCup by remember { mutableStateOf<AndroidCupCatalogEntry?>(null) }
    val filtered = remember(tracks, query) { filterAndroidTrackCatalog(tracks, query) }
    val cups = remember(tracks) {
        Schema9AndroidTrackCatalog.cups.map { cup ->
            cup.copy(tracks = cup.tracks.filter { candidate -> tracks.any { it.id == candidate.id } })
        }.filter { it.tracks.isNotEmpty() }
    }

    Column(
        modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .padding(horizontal = Mk8dxSpacing.md)
            .testTag("track-selection"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            selectedCup?.let { cup ->
                ProductAssetImage(
                    path = "private-product/img/cup/${cup.index}.png",
                    fallback = "C",
                    accent = colors.borderStrong,
                    modifier = Modifier.size(34.dp),
                    contentDescription = cup.displayName,
                )
            }
            Column(Modifier.weight(1f)) {
                Mk8dxDisplayText(
                    // Display type does not go through LocalizedText, so the
                    // cup's own name is translated here rather than printed in
                    // English inside a Dutch page.
                    selectedCup?.displayName?.let { androidLocalizedPresentation(it) }
                        ?: heading
                        ?: androidText(language, "Choose a Cup", "Kies een beker"),
                    type.display6,
                    Modifier.testTag("track-selection-title"),
                )
                Mk8dxMetaLine(
                    when {
                        query.isNotBlank() -> androidText(
                            language,
                            "${filtered.size} tracks",
                            "${filtered.size} circuits",
                        )
                        selectedCup != null -> androidText(language, "Choose your track", "Kies je circuit")
                        else -> androidText(
                            language,
                            "${cups.size} cups · ${tracks.size} tracks",
                            "${cups.size} bekers · ${tracks.size} circuits",
                        )
                    },
                )
            }
            if (selectedCup != null) {
                Mk8dxButton(
                    androidText(language, "All cups", "Alle bekers"),
                    { selectedCup = null },
                    variant = Mk8dxButtonVariant.Secondary,
                    tag = "track-selection-all-cups",
                )
            }
        }
        Mk8dxSearchField(
            androidText(language, "Search tracks", "Zoek circuits"),
            query,
            {
                query = boundedAndroidTrackSearchInput(it)
                if (query.isNotBlank()) selectedCup = null
            },
            Modifier.fillMaxWidth(),
            tag = "track-selection-search",
        )
        Text(
            when {
                query.isNotBlank() -> androidText(language, "${filtered.size} tracks", "${filtered.size} circuits")
                else -> ""
            },
            style = type.micro,
            color = colors.textTertiary,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("track-selection-count"),
        )
        when {
            query.isNotBlank() -> AndroidTrackGrid(filtered, onTrackSelected)
            selectedCup != null -> AndroidTrackGrid(requireNotNull(selectedCup).tracks, onTrackSelected)
            else -> AndroidCupGrid(cups) { selectedCup = it }
        }
    }
}

@Composable
private fun AndroidCupGrid(
    cups: List<AndroidCupCatalogEntry>,
    onCupSelected: (AndroidCupCatalogEntry) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tablet = maxWidth >= 600.dp
        LazyVerticalGrid(
            columns = GridCells.Fixed(if (tablet) 6 else 4),
            modifier = Modifier.fillMaxSize().testTag("cup-selection-grid"),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            items(cups, key = AndroidCupCatalogEntry::index) { cup ->
                Column(
                    Modifier
                        .heightIn(min = Mk8dxSpacing.targetMin)
                        .background(colors.surfaceRaised)
                        .border(1.dp, colors.borderSubtle)
                        .clickable(role = Role.Button) { onCupSelected(cup) }
                        .padding(Mk8dxSpacing.xs)
                        .testTag("cup-selection-${cup.index}"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    ProductAssetImage(
                        path = "private-product/img/cup/${cup.index}.png",
                        fallback = cup.displayName.take(1),
                        accent = colors.borderStrong,
                        modifier = Modifier.size(if (tablet) 64.dp else 52.dp),
                    )
                    Text(
                        cupSelectionLabel(cup.displayName, language),
                        style = type.micro,
                        color = colors.textBody,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun AndroidTrackGrid(
    tracks: List<AndroidTrackCatalogEntry>,
    onTrackSelected: (AndroidTrackCatalogEntry) -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    if (tracks.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                androidText(language, "No tracks found", "Geen circuits gevonden"),
                style = type.body,
                color = colors.textSecondary,
            )
        }
        return
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tablet = maxWidth >= 600.dp
        LazyVerticalGrid(
            columns = GridCells.Fixed(if (tablet) 4 else 2),
            modifier = Modifier.fillMaxSize().testTag("track-selection-list"),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            items(tracks, key = AndroidTrackCatalogEntry::id) { track ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surfaceRaised)
                        .border(1.dp, colors.borderSubtle)
                        .clickable(role = Role.Button) { onTrackSelected(track) }
                        .testTag("track-selection-row-${track.index}"),
                ) {
                    TrackAssetArtwork(
                        trackIndex = track.index,
                        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                    )
                    Column(
                        Modifier.padding(Mk8dxSpacing.sm),
                        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                        ) {
                            ProductAssetImage(
                                path = "private-product/img/cup/${track.index / 4}.png",
                                fallback = "C",
                                accent = colors.borderStrong,
                                modifier = Modifier.size(20.dp),
                                contentDescription = null,
                            )
                            Text(
                                track.displayName,
                                style = type.label.copy(fontWeight = FontWeight.SemiBold),
                                color = colors.textPrimary,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text(
                            androidText(
                                language,
                                "${track.lapCount} laps · ${if (track.index < 48) "Base game" else "Booster Course Pass"}",
                                "${track.lapCount} ronden · ${if (track.index < 48) "Basisspel" else "Booster Course Pass"}",
                            ),
                            style = type.micro,
                            color = colors.textSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
