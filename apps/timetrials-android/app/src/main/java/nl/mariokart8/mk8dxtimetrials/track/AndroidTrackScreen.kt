package nl.mariokart8.mk8dxtimetrials.track

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTrackContext
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidEntryStartMode
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArtHero
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * **A02 — Tracks → a track.** The track chooser, and the track in context.
 *
 * MEDIUM spectacle (DESIGN_SYSTEM §5): an art hero strip, the board below it,
 * and **one** A4 — "Post your time · <cc>", which opens the canonical
 * Post-a-Time task. The page carries exactly one EngineSelector, and the class
 * it holds is the class the board shows and the task opens on (§7,
 * ENGINE_CONTEXT_INVENTORY §4).
 *
 * The entry form that used to live on this page is gone: entering a time is a
 * task, not a panel on a board (POST_A_TIME §9). So is the "Manual input /
 * Use camera" choice — the scan is an action inside that task.
 */
@Composable
internal fun AndroidTrackScreen(
    trackId: String?,
    mode: Int?,
    modifier: Modifier = Modifier,
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource? = null,
    signedInPlayerId: String? = null,
    onTrackChosen: (String) -> Unit = {},
    onChangeTrack: () -> Unit = {},
    onModeChanged: (Int) -> Unit = {},
    onPostTime: (trackId: String, mode: Int) -> Unit = { _, _ -> },
    onOpenCombo: ((List<String>) -> Unit)? = null,
    /** A community name on the board opens that Player's page. */
    onOpenPlayer: ((String) -> Unit)? = null,
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val track = remember(trackId) { trackId?.let(Schema9AndroidTrackCatalog::find) }

    if (track == null) {
        AndroidTrackChooser(
            onTrackSelected = { onTrackChosen(it.id) },
            modifier = modifier,
        )
        return
    }

    var selectedMode by remember(trackId, mode) {
        mutableIntStateOf(androidEntryStartMode(mode, preference = null))
    }
    var modeChosen by remember(trackId, mode) { mutableStateOf(false) }
    // EngineContext (R4): a track opened without a class starts on the viewer's
    // single-engine preference, never on a literal 150.
    LaunchedEffect(trackId, mode, ecosystemClient) {
        if (mode == 150 || mode == 200 || ecosystemClient == null) return@LaunchedEffect
        val preference = withContext(workerDispatcher) {
            runCatching { ecosystemClient.timeTrialPreferences()?.modePreference }.getOrNull()
        }
        if (!modeChosen) selectedMode = androidEntryStartMode(null, preference)
    }

    Column(
        modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .testTag("track-screen"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxArtHero(
            // Display type is drawn by the system's own Text, so the track's
            // Dutch name is resolved here rather than printed in English.
            title = androidLocalizedPresentation(track.displayName),
            modifier = Modifier.testTag("track-screen-hero"),
            meta = androidText(
                language,
                "${track.lapCount} laps · ${if (track.index < 48) "Base game" else "Booster Course Pass"}",
                "${track.lapCount} ronden · ${if (track.index < 48) "Basisspel" else "Booster Course Pass"}",
            ),
            art = {
                TrackIdentityArtwork(
                    trackIndex = track.index,
                    mode = selectedMode,
                    contentDescription = androidLocalizedPresentation(track.displayName),
                    // Small art beside the name: a thumbnail in dp, so it
                    // cannot grow over the words at font scale 2.0.
                    modifier = Modifier.width(104.dp),
                    cupTestTag = "track-screen-cup",
                )
            },
        )
        Column(
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxEngineSelector(
                androidText(language, "Engine class", "Klasse"),
                selectedMode,
                { chosen ->
                    selectedMode = chosen
                    modeChosen = true
                    onModeChanged(chosen)
                },
                modifier = Modifier.testTag("track-screen-engine"),
            )
            // The one A4 of this viewport (§4): posting a time is what a track
            // page is for, and it names the class it will open on.
            Mk8dxButton(
                androidText(
                    language,
                    "Post your time · ${selectedMode}cc",
                    "Plaats je tijd · ${selectedMode}cc",
                ),
                { onPostTime(track.id, selectedMode) },
                variant = Mk8dxButtonVariant.Primary,
                size = Mk8dxButtonSize.Lg,
                stopwatch = true,
                tag = "track-screen-post-time",
                modifier = Modifier.fillMaxWidth(),
            )
            Mk8dxButton(
                androidText(language, "Change track", "Ander circuit"),
                onChangeTrack,
                variant = Mk8dxButtonVariant.Secondary,
                tag = "track-screen-change-track",
            )
        }
        AndroidTrackContext(
            track.id,
            selectedMode,
            signedInPlayerId,
            ecosystemClient,
            onOpenCombo = onOpenCombo,
            onOpenPlayer = onOpenPlayer,
        )
    }
}
