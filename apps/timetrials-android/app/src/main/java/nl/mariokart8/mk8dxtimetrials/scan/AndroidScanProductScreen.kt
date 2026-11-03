package nl.mariokart8.mk8dxtimetrials.scan

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidEntryStartMode
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackChooser
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * **A03 — the scan.** Camera or gallery, the recognition engine, and nothing
 * else: a recognised result returns into the canonical Post-a-Time task
 * (POST_A_TIME §9, §11; ADR-0206), marked "Scanned" and editable there.
 *
 * The scan-only review screen with its own validation, its own coin meaning and
 * its own save button is **gone**. The engine, its thresholds, its asset
 * resolution and the acquisition surface below it are untouched.
 */
@Composable
internal fun AndroidScanProductScreen(
    contextFactory: AndroidTrustedScanSubmissionContextFactory? = null,
    analyzerFactory: ContextualResultImageAnalyzerFactory? = null,
    modifier: Modifier = Modifier,
    initialTrackId: String? = null,
    initialMode: Int? = null,
    activePlayerLabel: String? = null,
    openTestChooser: Boolean = false,
    /** Reads the viewer's Time Trial preference when no engine was asked for. */
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource? = null,
    /** A recognised result; the canonical task fills the same form with it. */
    onRecognized: (AndroidScanTimeTrialSubmissionV1) -> Unit = {},
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    var selectedTrack by remember(initialTrackId) {
        mutableStateOf(initialTrackId?.let(Schema9AndroidTrackCatalog::find))
    }
    var selectedMode by remember(initialMode) {
        mutableIntStateOf(androidEntryStartMode(initialMode, preference = null))
    }
    // EngineContext (R4): without an engine from the way in, the scanner starts
    // on the viewer's single-engine preference unless a class was picked here.
    var modeChosen by remember(initialMode) { mutableStateOf(false) }
    LaunchedEffect(initialMode, ecosystemClient) {
        if (initialMode == 150 || initialMode == 200 || ecosystemClient == null) return@LaunchedEffect
        val preference = withContext(Dispatchers.IO) {
            runCatching { ecosystemClient.timeTrialPreferences()?.modePreference }.getOrNull()
        }
        if (!modeChosen) selectedMode = androidEntryStartMode(null, preference)
    }
    val applicationContext = LocalContext.current.applicationContext
    val currentTrack by rememberUpdatedState(selectedTrack)
    val currentMode by rememberUpdatedState(selectedMode)
    val productHostFactory = if (contextFactory == null || analyzerFactory == null) {
        null
    } else {
        remember(applicationContext, analyzerFactory, contextFactory) {
            AndroidScanProductHostFactory(
                context = applicationContext,
                analyzerFactory = analyzerFactory,
                contextProvider = { contextFactory.create(requireNotNull(currentTrack), currentMode) },
                submissionHost = null,
            )
        }
    }

    val selected = selectedTrack
    if (selected == null) {
        Column(modifier.fillMaxSize().background(colors.surfaceApp)) {
            AndroidTrackChooser(
                heading = androidText(language, "Which track?", "Welk circuit?"),
                onTrackSelected = { selectedTrack = it },
            )
        }
        return
    }

    var selectedLayout by remember(selected.id) { mutableStateOf<ScanLayoutProfile?>(null) }
    if (productHostFactory != null && selectedLayout == null) {
        if (ScanDebug.recorder != null) {
            // The debug bridge's `layout` answers this question like a Player's tap.
            LaunchedEffect(selected.id) {
                ScanDebug.commands.collect { command ->
                    if (command is ScanDebugCommand.SetLayout) {
                        selectedLayout = command.layout
                        ScanLayoutPreference.write(applicationContext, command.layout)
                    }
                }
            }
        }
        AndroidScanLayoutPicker(
            track = selected,
            mode = selectedMode,
            onChoose = { layout ->
                selectedLayout = layout
                ScanLayoutPreference.write(applicationContext, layout)
            },
            modifier = modifier,
        )
        return
    }

    // Choosing the screen type is the last setup step. Open the camera
    // immediately: its own controls already include Gallery, layout guidance
    // and Close, so a second "TT SCAN" landing card only repeats the choice.
    if (productHostFactory != null && selectedLayout != null) {
        AndroidResultImageAcquisitionComponent(
            hostFactory = productHostFactory,
            onSubmission = onRecognized,
            guideLapCount = selected.lapCount,
            initialLayout = selectedLayout,
            lockLayout = true,
            autoOpenCamera = true,
            onCameraClosed = { selectedLayout = null },
            openTestChooser = openTestChooser,
            modifier = modifier.fillMaxSize(),
        )
        return
    }

    Column(
        modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .padding(vertical = Mk8dxSpacing.md)
            .testTag("scan-product-context"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Column(
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxSectionLabel(androidText(language, "RESULT SCANNER", "RESULTAATSCANNER"))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                ProductAssetImage(
                    path = "private-product/img/track/${selected.index}.png",
                    fallback = (selected.index + 1).toString(),
                    accent = colors.borderStrong,
                    modifier = Modifier.width(96.dp).aspectRatio(16f / 9f),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        selected.displayName,
                        style = type.title,
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.testTag("scan-product-selected-track"),
                    )
                    Mk8dxMetaLine(
                        androidText(language, "${selected.lapCount} laps", "${selected.lapCount} ronden"),
                    )
                }
            }
            Mk8dxEngineSelector(
                androidText(language, "Engine class", "Klasse"),
                selectedMode,
                { chosen -> selectedMode = chosen; modeChosen = true },
                modifier = Modifier.testTag("scan-product-engine"),
            )
            Mk8dxButton(
                androidText(language, "Choose another track", "Ander circuit kiezen"),
                { selectedTrack = null },
                variant = Mk8dxButtonVariant.Secondary,
                tag = "scan-product-change-track",
                modifier = Modifier.fillMaxWidth(),
            )
            activePlayerLabel?.let { player ->
                Mk8dxMetaLine(
                    androidText(language, "Posting as $player", "Je plaatst als $player"),
                    Modifier.testTag("scan-submitting-as"),
                )
            }
        }
        when {
            contextFactory == null -> ScanInfoCard(
                androidText(language, "Sign in before saving", "Meld je aan voordat je opslaat"),
                androidText(
                    language,
                    "Scanning stays local. Sign in so the checked result belongs to the right Player.",
                    "Scannen blijft lokaal. Meld je aan zodat het gecontroleerde resultaat bij de juiste speler hoort.",
                ),
            )
            analyzerFactory == null -> ScanInfoCard(
                androidText(language, "Scanner unavailable", "Scanner niet beschikbaar"),
                androidText(
                    language,
                    "This public build does not contain the owner-private offline recognition package.",
                    "Deze publieke build bevat het privé offline herkenningspakket niet.",
                ),
            )
            else -> Unit
        }
    }
}

@Composable
private fun AndroidScanLayoutPicker(
    track: nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry,
    mode: Int,
    onChoose: (ScanLayoutProfile) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    Column(
        modifier.fillMaxSize().background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .padding(Mk8dxSpacing.md)
            .testTag("scan-layout-picker"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxSectionLabel(androidText(language, "WHAT ARE YOU SHOWING?", "WAT LAAT JE ZIEN?"))
        Mk8dxMetaLine("${track.displayName} · ${mode}cc")
        ScanLayoutChoice(
            icon = "👻",
            title = androidText(language, "Ghost Select screen", "Ghost Select-scherm"),
            summary = androidText(
                language,
                "One ghost with total time, laps and kart setup.",
                "Eén ghost met totaaltijd, ronden en voertuig.",
            ),
            imagePath = "private-product/img/scan/ghost-select.png",
            layout = ScanLayoutProfile.GHOST_DETAIL,
            onChoose = onChoose,
        )
        ScanLayoutChoice(
            icon = "🎴",
            title = androidText(language, "Race End Screen", "Race-eindscherm"),
            summary = androidText(
                language,
                "The end time(s) shown directly after a run.",
                "De eindtijd(en) die direct na een race worden getoond.",
            ),
            imagePath = "private-product/img/scan/race-end.jpg",
            layout = ScanLayoutProfile.ENDSCREEN,
            onChoose = onChoose,
        )
    }
}

@Composable
private fun ScanLayoutChoice(
    icon: String,
    title: String,
    summary: String,
    imagePath: String,
    layout: ScanLayoutProfile,
    onChoose: (ScanLayoutProfile) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier.fillMaxWidth().background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .clickable { onChoose(layout) }
            .padding(Mk8dxSpacing.sm)
            .testTag("scan-layout-choice-${layout.engineValue}"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        ProductAssetImage(
            path = imagePath,
            fallback = icon,
            accent = colors.actionPrimary,
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            contentDescription = null,
            contentScale = ContentScale.Crop,
        )
        Text("$icon  $title", style = Mk8dxTheme.type.title, color = colors.textPrimary)
        Text(summary, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
    }
}

@Composable
private fun ScanInfoCard(title: String, body: String) {
    Mk8dxPanel(title, Modifier.padding(horizontal = Mk8dxSpacing.md)) {
        Text(body, style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
    }
}

/** The friendly name of a recognised part, as the canonical picker writes it. */
internal fun scanLoadoutDisplayName(baseId: String?, variantId: String? = null): String {
    AndroidLoadoutCatalog.find(baseId)?.let { return it.name }
    val value = baseId ?: variantId ?: return "Not read"
    return value.substringAfter('.').replace('_', ' ')
        .split(' ')
        .joinToString(" ") { word -> word.replaceFirstChar(Char::uppercase) }
}
