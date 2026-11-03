package nl.mariokart8.mk8dxtimetrials.posttime

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPart
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidEntryStartMode
import nl.mariokart8.mk8dxtimetrials.manual.AndroidTrustedManualSubmissionContextFactory
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidSubmissionFeedback
import nl.mariokart8.mk8dxtimetrials.outbox.androidSubmissionFailureMessage
import nl.mariokart8.mk8dxtimetrials.rules.RuleError
import nl.mariokart8.mk8dxtimetrials.rules.TimeTrialRules
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLoadoutV1
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackChooser
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.track.TrackAssetArtwork
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArmedAction
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxArmedButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineSelector
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFieldLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxOptionRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSwipeToConfirm
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPickerTile
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSegmentedControl
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSelectField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTimeInput

/**
 * **The** Post-a-Time task on Android (POST_A_TIME_ARCHITECTURE, DESIGN_SYSTEM
 * §14), the twin of the web task shipped in CHECKPOINT_3.
 *
 * One form. There is no "scan or type" choice screen, no second form, no second
 * validator, no second review and no second publish path: a scan is an autofill
 * action *inside* this form and returns into it, marked and editable.
 *
 * The phone's own truths are kept: the save is local first (the outbox), so a
 * publish without a network is a queued publication rather than a failure, and
 * the site's `?feedback=` answer replaces the prediction when the automatic sync
 * has delivered it.
 */
internal enum class AndroidPostTimeStage { EDITING, SENDING, QUEUED, FAILED }

private const val FEEDBACK_POLL_ATTEMPTS = 60
private const val FEEDBACK_POLL_MILLIS = 2_000L

@Composable
internal fun AndroidPostTimeTask(
    trackId: String?,
    mode: Int?,
    contextFactory: AndroidTrustedManualSubmissionContextFactory?,
    submissionHost: AndroidOutboxSubmissionHost?,
    modifier: Modifier = Modifier,
    ecosystemClient: AndroidTimeTrialsEcosystemDataSource? = null,
    signedInPlayerId: String? = null,
    signedInPlayerLabel: String? = null,
    onTrackChosen: (String) -> Unit = {},
    onChangeTrack: () -> Unit = {},
    onModeChanged: (Int) -> Unit = {},
    onScan: ((trackId: String, mode: Int) -> Unit)? = null,
    pendingScan: AndroidScanTimeTrialSubmissionV1? = null,
    onScanConsumed: () -> Unit = {},
    onComplete: () -> Unit = {},
    onSavedResults: () -> Unit = {},
    workerDispatcher: CoroutineDispatcher = Dispatchers.IO,
    draftStorage: AndroidPostTimeDraftStorage? = null,
    /**
     * Manage (ADR-0211): the same form, filled from a published result. The track and engine
     * class stay fixed, nothing is scanned, predicted or kept as a draft, and saving sends a
     * correction of only what changed.
     */
    manage: AndroidPostTimeEdit? = null,
) {
    val language = LocalAndroidProductLanguage.current
    val numberLanguage = if (language.code == "nl") Mk8dxNumberLanguage.NL else Mk8dxNumberLanguage.EN
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val context = LocalContext.current
    val track = remember(trackId) { trackId?.let(Schema9AndroidTrackCatalog::find) }
    val scope = rememberCoroutineScope()

    if (track == null) {
        // TrackSelector (POST_A_TIME §6): the task's own focused choice, not the
        // Tracks page. Choosing one continues straight into the form.
        Column(modifier.fillMaxSize().background(colors.surfaceApp).testTag("post-time-track-selector")) {
            AndroidTrackChooser(
                heading = androidText(language, "Which track?", "Welk circuit?"),
                onTrackSelected = { onTrackChosen(it.id) },
            )
        }
        return
    }

    val storage = draftStorage ?: rememberAndroidPostTimeDraftStorage(context)
    val draftOwner = signedInPlayerId ?: "local"
    var selectedMode by remember(trackId, mode) {
        mutableIntStateOf(androidEntryStartMode(mode, preference = null))
    }
    var modeChosen by remember(trackId, mode) { mutableStateOf(false) }
    // EngineContext (R4): a track opened without an engine starts on the
    // viewer's single-engine preference, as the web's task does.
    LaunchedEffect(trackId, mode, ecosystemClient) {
        if (mode == 150 || mode == 200 || ecosystemClient == null) return@LaunchedEffect
        val preference = withContext(workerDispatcher) {
            runCatching { ecosystemClient.timeTrialPreferences()?.modePreference }.getOrNull()
        }
        if (!modeChosen) selectedMode = androidEntryStartMode(null, preference)
    }

    val original = remember(trackId, manage) { manage?.let { androidEditDraftOf(it.result, track.lapCount) } }
    var draft by remember(trackId, manage) {
        mutableStateOf(original ?: createAndroidPostTimeDraft(track.id, selectedMode, track.lapCount))
    }
    var restoredDraft by remember(trackId) { mutableStateOf(false) }
    var stage by remember(trackId) { mutableStateOf(AndroidPostTimeStage.EDITING) }
    var savedEntryKey by remember(trackId) { mutableStateOf<String?>(null) }
    var syncState by remember(trackId) { mutableStateOf<String?>(null) }
    var syncFailure by remember(trackId) { mutableStateOf<String?>(null) }
    var publishedFeedback by remember(trackId) { mutableStateOf<AndroidSubmissionFeedback?>(null) }
    var scanned by remember(trackId) { mutableStateOf<AndroidScanTimeTrialSubmissionV1?>(null) }
    var scanConflicts by remember(trackId) { mutableStateOf<List<String>>(emptyList()) }
    var scanUnreadLoadout by remember(trackId) { mutableStateOf<List<String>>(emptyList()) }
    var scanLapCount by remember(trackId) { mutableStateOf<Int?>(null) }
    var pickerPart by remember { mutableStateOf<AndroidBuildPartCategory?>(null) }
    val armed = remember(trackId) { Mk8dxArmedAction() }
    var armedShown by remember(trackId) { mutableStateOf(false) }
    // A field is marked only once the Player has been there, so an untouched
    // blank lap row is not shouted at (DESIGN_SYSTEM §13).
    var touched by remember(trackId) { mutableStateOf(emptySet<String>()) }

    // The draft keeps the mode the selector shows, and a mode switch discards
    // everything derived from the engine, including the armed state (§4).
    LaunchedEffect(selectedMode) {
        if (draft.mode != selectedMode) {
            draft = draft.withMode(selectedMode)
            armed.disarm()
            armedShown = false
        }
    }

    // A kept draft comes back with a notice (POST_A_TIME §8).
    LaunchedEffect(trackId, draftOwner, selectedMode) {
        if (manage != null || draft.hasMeaningfulData()) return@LaunchedEffect
        val kept = androidLoadDraft(storage, draftOwner, track.id, selectedMode, track.lapCount)
        if (kept != null) {
            draft = kept
            // Coming back from the scanner is not "you left this behind": the
            // Player never left the task, and the scan is about to land on it.
            restoredDraft = pendingScan == null
        }
    }

    // A returning scan fills this same form. It never silently replaces a value
    // the Player typed: those fields are reported instead.
    LaunchedEffect(pendingScan) {
        val submission = pendingScan ?: return@LaunchedEffect
        val application = androidApplyScan(draft, androidScanFillFor(submission))
        draft = application.draft
        scanConflicts = application.conflicts
        scanUnreadLoadout = application.unreadLoadoutKeys
        scanLapCount = application.producerLapCount
        scanned = submission
        restoredDraft = false
        stage = AndroidPostTimeStage.EDITING
        armed.disarm()
        armedShown = false
        onScanConsumed()
    }

    // The board behind the prediction: the same (track, mode) leaderboard the
    // track screen loads, and the viewer's rivals where a session names them.
    var board by remember(trackId, selectedMode, ecosystemClient) {
        mutableStateOf<List<AndroidPredictionBoardRow>?>(null)
    }
    var rivalIds by remember(ecosystemClient, signedInPlayerId) { mutableStateOf(emptySet<String>()) }
    LaunchedEffect(trackId, selectedMode, ecosystemClient) {
        board = null
        val client = ecosystemClient ?: return@LaunchedEffect
        val rows = withContext(workerDispatcher) {
            runCatching { client.leaderboard(track.id, selectedMode) }.getOrNull()
        } ?: return@LaunchedEffect
        board = rows.map { AndroidPredictionBoardRow(it.playerId, it.playerDisplayName, it.totalTimeMs) }
        if (signedInPlayerId != null) {
            rivalIds = withContext(workerDispatcher) {
                runCatching { client.rivals().map { it.playerId }.toSet() }.getOrDefault(emptySet())
            }
        }
    }

    // The site's answer, once the automatic sync has delivered the publication.
    LaunchedEffect(savedEntryKey) {
        val entryKey = savedEntryKey ?: return@LaunchedEffect
        publishedFeedback = null
        syncState = "pending"
        repeat(FEEDBACK_POLL_ATTEMPTS) {
            val feedback = withContext(workerDispatcher) { submissionHost?.publishedFeedback(entryKey) }
            val state = withContext(workerDispatcher) { submissionHost?.synchronizationState(entryKey) }
            syncState = state
            if (feedback != null) {
                publishedFeedback = feedback
                return@LaunchedEffect
            }
            if (state == "failed") {
                syncFailure = withContext(workerDispatcher) { submissionHost?.failureCode(entryKey) }
                return@LaunchedEffect
            }
            if (state == "synced") return@LaunchedEffect
            delay(FEEDBACK_POLL_MILLIS)
        }
    }

    val edit: (String, AndroidPostTimeDraft) -> Unit = { field, next ->
        draft = next
        touched = touched + field
        restoredDraft = false
        armed.disarm()
        armedShown = false
        // Any edit returns the panel to predicting, and the kept draft follows.
        if (stage == AndroidPostTimeStage.QUEUED) {
            stage = AndroidPostTimeStage.EDITING
            savedEntryKey = null
            syncState = null
            publishedFeedback = null
        }
        if (manage == null) androidSaveDraft(storage, draftOwner, next, System.currentTimeMillis())
    }

    val validation = androidValidatePostTime(draft)
    val errors = validation.errors
    val payload = validation.payload
    val balances = draft.coinBalances()

    val publish: () -> Unit = publish@{
        val valid = payload ?: return@publish
        val factory = contextFactory ?: return@publish
        val host = submissionHost ?: return@publish
        if (stage == AndroidPostTimeStage.SENDING) return@publish
        stage = AndroidPostTimeStage.SENDING
        scope.launch {
            val stored = withContext(workerDispatcher) {
                runCatching {
                    val source = scanned
                    if (source == null) {
                        host.storeManual(androidManualSubmissionFor(factory.create(track), valid))
                    } else {
                        host.storeScan(androidScanSubmissionFor(source, valid))
                    }
                }.getOrNull()
            }
            if (stored == null) {
                // FAILED / RETRYABLE: the draft is kept and Publish is usable again.
                stage = AndroidPostTimeStage.FAILED
            } else {
                savedEntryKey = stored.entry.entryKey
                stage = AndroidPostTimeStage.QUEUED
                androidClearDraft(storage)
            }
        }
    }

    if (stage == AndroidPostTimeStage.QUEUED) {
        // A local outbox save is durable, but it is not a publication. Do not
        // whisk the Player back to a stale Home while the site has not accepted
        // the result yet. Once the server acknowledgement is present, keep the
        // success visible briefly and then finish the task as requested.
        LaunchedEffect(stage, syncState) {
            if (syncState == "synced") {
                delay(2_000L)
                onComplete()
            }
        }
        Column(
            modifier
                .fillMaxSize()
                .background(colors.surfaceApp)
                .verticalScroll(rememberScrollState())
                .padding(Mk8dxSpacing.md)
                .testTag("post-time-confirmed"),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Mk8dxPanel(
                when (syncState) {
                    "synced" -> androidText(language, "TIME POSTED", "TIJD GEPLAATST")
                    "failed" -> androidText(language, "SYNC NEEDS ATTENTION", "SYNCHRONISATIE VRAAGT AANDACHT")
                    else -> androidText(language, "SAVED ON THIS PHONE", "OP DEZE TELEFOON OPGESLAGEN")
                },
                Modifier.fillMaxWidth(),
            ) {
                Mk8dxStatusMessage(
                    when (syncState) {
                        "synced" -> androidText(
                            language, "Your time is published.", "Je tijd is gepubliceerd.",
                        )
                        "failed" -> androidSubmissionFailureMessage(syncFailure, language.code) ?: androidText(
                            language,
                            "The website has not accepted this result. It is still safe on this phone; open Saved results to see why and retry.",
                            "De website heeft dit resultaat nog niet geaccepteerd. Het staat veilig op deze telefoon; open Opgeslagen resultaten om de reden te zien en opnieuw te proberen.",
                        )
                        else -> androidText(
                            language,
                            "Your time is safe on this phone. Waiting for the website to accept it…",
                            "Je tijd staat veilig op deze telefoon. Wachten tot de website hem accepteert…",
                        )
                    },
                    Modifier.testTag("post-time-status"),
                    when (syncState) {
                        "synced" -> Mk8dxStatusTone.Success
                        "failed" -> Mk8dxStatusTone.Error
                        else -> Mk8dxStatusTone.Info
                    },
                )
                publishedFeedback?.lines(language)?.forEachIndexed { index, line ->
                    Text(
                        line,
                        style = type.body,
                        color = colors.textBody,
                        modifier = Modifier.testTag("post-time-feedback-$index"),
                    )
                }
                if (syncState == "synced") {
                    Text(
                        androidText(language, "Taking you back to Home…", "Je gaat terug naar Home…"),
                        style = type.body,
                        color = colors.textSecondary,
                    )
                } else {
                    Mk8dxButton(
                        androidText(language, "Open saved results", "Opgeslagen resultaten openen"),
                        onSavedResults,
                        variant = Mk8dxButtonVariant.Primary,
                        size = Mk8dxButtonSize.Lg,
                        tag = "post-time-saved-results",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Mk8dxButton(
                    androidText(language, "Go to Home", "Naar Home"),
                    onComplete,
                    variant = if (syncState == "synced") {
                        Mk8dxButtonVariant.Primary
                    } else {
                        Mk8dxButtonVariant.Secondary
                    },
                    size = Mk8dxButtonSize.Lg,
                    tag = "post-time-home",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        return
    }

    Column(
        modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .padding(vertical = Mk8dxSpacing.md)
            .testTag("post-time-task"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        // ---- what is being posted, and for which engine
        Column(
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                Box(Modifier.width(88.dp).height(56.dp)) {
                    TrackAssetArtwork(
                        trackIndex = track.index,
                        modifier = Modifier.matchParentSize(),
                        contentDescription = track.displayName,
                    )
                    ProductAssetImage(
                        path = "private-product/img/cup/${track.index / 4}.png",
                        fallback = "C",
                        accent = colors.borderStrong,
                        modifier = Modifier.align(Alignment.TopStart).padding(3.dp).size(22.dp),
                        contentDescription = null,
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        track.displayName,
                        style = type.title,
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.testTag("post-time-track"),
                    )
                    Mk8dxMetaLine(
                        androidText(
                            language,
                            "${track.lapCount} laps",
                            "${track.lapCount} ronden",
                        ),
                    )
                }
                if (manage == null) {
                    Mk8dxButton(
                        androidText(language, "Change", "Wijzig"),
                        onChangeTrack,
                        variant = Mk8dxButtonVariant.Quiet,
                        tag = "post-time-change-track",
                    )
                } else {
                    Mk8dxEngineMark(selectedMode, size = Mk8dxEngineMarkSize.Md)
                }
            }
            if (manage != null) {
                Mk8dxStatusMessage(
                    androidText(
                        language,
                        "Fix this result: change what was wrong. A different track or engine class is a different result: withdraw this one and post again.",
                        "Dit resultaat verbeteren: pas aan wat niet klopte. Een ander circuit of een andere klasse is een ander resultaat: trek dit in en plaats opnieuw.",
                    ),
                    Modifier.testTag("post-time-manage-intro"),
                    Mk8dxStatusTone.Info,
                )
            } else Mk8dxEngineSelector(
                androidText(language, "Engine class", "Klasse"),
                selectedMode,
                { chosen ->
                    selectedMode = chosen
                    modeChosen = true
                    onModeChanged(chosen)
                },
                modifier = Modifier.testTag("post-time-engine"),
            )
            signedInPlayerLabel?.let {
                Mk8dxMetaLine(androidText(language, "Posting as $it", "Je plaatst als $it"))
            }
            if (restoredDraft) {
                Mk8dxStatusMessage(
                    androidText(language, "Your unfinished time is back.", "Je onafgemaakte tijd staat er weer."),
                    Modifier.testTag("post-time-restored"),
                    Mk8dxStatusTone.Info,
                )
            }
            scanned?.let { submission ->
                Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    Mk8dxChip(
                        androidText(language, "Filled from your screenshot", "Ingevuld vanaf je schermafbeelding"),
                        Modifier.testTag("post-time-scan-filled"),
                        Mk8dxChipTone.Info,
                    )
                    if (submission.source.kind == "android_scan_test") {
                        Mk8dxChip(
                            androidText(language, "Test result", "Testresultaat"),
                            Modifier.testTag("post-time-scan-test"),
                            Mk8dxChipTone.Warning,
                        )
                    }
                }
            }
            scanLapCount?.let { produced ->
                Mk8dxStatusMessage(
                    androidText(
                        language,
                        "That result has $produced laps and this track has ${track.lapCount}, so its lap times were left out. Check the track, or type the laps yourself.",
                        "Dat resultaat heeft $produced ronden en dit circuit ${track.lapCount}, dus de rondetijden zijn niet ingevuld. Controleer het circuit, of vul de ronden zelf in.",
                    ),
                    Modifier.testTag("post-time-scan-lap-count"),
                    Mk8dxStatusTone.Warning,
                )
            }
            if (scanConflicts.isNotEmpty()) {
                Mk8dxStatusMessage(
                    androidText(
                        language,
                        "Your own values were kept: the scan did not replace what you typed.",
                        "Je eigen waarden zijn bewaard: de scan heeft niet vervangen wat je typte.",
                    ),
                    Modifier.testTag("post-time-scan-conflicts"),
                    Mk8dxStatusTone.Warning,
                )
            }
            if (scanUnreadLoadout.isNotEmpty()) {
                val labels = scanUnreadLoadout.map { key ->
                    when (key) {
                        "characterId" -> androidText(language, "character", "personage")
                        "bodyId" -> androidText(language, "body", "voertuig")
                        "tireId" -> androidText(language, "tires", "banden")
                        else -> androidText(language, "glider", "vlieger")
                    }
                }.joinToString(", ")
                Mk8dxStatusMessage(
                    androidText(
                        language,
                        "The scan could not read: $labels. Check these optional kart setup fields before publishing.",
                        "De scan kon niet lezen: $labels. Controleer deze optionele voertuigvelden voor je publiceert.",
                    ),
                    Modifier.testTag("post-time-scan-unread-loadout"),
                    Mk8dxStatusTone.Warning,
                )
            }
        }

        if (armedShown && payload != null) {
            AndroidPostTimePublishSummary(
                track = track,
                draft = draft,
                scannedLoadout = scanned?.loadout,
                onBack = {
                    armed.disarm()
                    armedShown = false
                },
            )
        } else {
        // Put the scanner before the first manual field. It is the quickest
        // way to start this task and should be visible before a Player begins
        // typing the same values by hand.
        if (onScan != null && manage == null) {
            Mk8dxButton(
                if (scanned == null) {
                    androidText(language, "Scan result — we'll fill in what we can", "Resultaat scannen — we vullen in wat kan")
                } else {
                    androidText(language, "Scan again", "Opnieuw scannen")
                },
                { onScan(track.id, selectedMode) },
                variant = Mk8dxButtonVariant.Global,
                size = Mk8dxButtonSize.Lg,
                camera = true,
                tag = "post-time-scan",
                modifier = Modifier.fillMaxWidth().padding(horizontal = Mk8dxSpacing.md),
            )
        }

        // ---- the total time
        Column(
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            Mk8dxFieldLabel(androidText(language, "Total time", "Totaaltijd"))
            Mk8dxTimeInput(
                androidText(language, "Total time", "Totaaltijd"),
                draft.totalDigits,
                { value -> edit(ANDROID_POST_TIME_TOTAL_FIELD, draft.withTotalDigits(value)) },
                Modifier.testTag("post-time-total"),
                invalid = androidErrorFor(errors, ANDROID_POST_TIME_TOTAL_FIELD) != null &&
                    ANDROID_POST_TIME_TOTAL_FIELD in touched,
                doubt = ANDROID_POST_TIME_TOTAL_FIELD in draft.doubt,
            )
            AndroidFieldSource(draft, ANDROID_POST_TIME_TOTAL_FIELD, touched)
            AndroidFieldMessage(errors, ANDROID_POST_TIME_TOTAL_FIELD, ANDROID_POST_TIME_TOTAL_FIELD in touched)
        }

        // ---- the kart setup (SetupSummary + SetupPicker), beside the total
        // as on the result screen, before the optional lap details
        Mk8dxPanel(
            androidText(language, "KART SETUP", "VOERTUIG"),
            Modifier.padding(horizontal = Mk8dxSpacing.md),
        ) {
            Mk8dxMetaLine(androidText(language, "Optional", "Optioneel"))
            AndroidBuildPartCategory.entries.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    row.forEach { category ->
                        val key = category.draftKey()
                        val part = AndroidLoadoutCatalog.find(draft.loadout[key])
                        val visual = part?.let { androidPostTimePartVisual(it, draft.loadout, scanned?.loadout) }
                        Column(Modifier.weight(1f)) {
                            Mk8dxSelectField(
                                category.partLabel(language),
                                visual?.name ?: androidText(language, "Not recorded", "Niet vastgelegd"),
                                { pickerPart = category },
                                Modifier.testTag("post-time-setup-${category.name.lowercase()}"),
                                leading = part?.let {
                                    {
                                        ProductAssetImage(
                                            path = visual?.assetPath ?: it.assetPath,
                                            fallback = it.name.take(1),
                                            accent = colors.borderStrong,
                                            modifier = Modifier.size(28.dp),
                                            contentDescription = null,
                                        )
                                    }
                                },
                            )
                            AndroidFieldSource(draft, androidLoadoutField(key), touched)
                        }
                    }
                }
            }
        }

        // ---- the race: one row per lap (RaceDetails, POST_A_TIME §6)
        Mk8dxPanel(
            androidText(language, "THE RACE", "DE RACE"),
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            trailing = {
                if (draft.laps.any { it.timeDigits.isNotEmpty() || it.coinChange != null || it.mushroomsUsed != null }) {
                    Mk8dxButton(
                        androidText(language, "Clear laps", "Ronden wissen"),
                        { edit("laps", draft.withClearedLaps()) },
                        variant = Mk8dxButtonVariant.Quiet,
                        tag = "post-time-clear-laps",
                    )
                }
            },
        ) {
            Mk8dxMetaLine(
                androidText(
                    language,
                    "Optional — fill in every lap, or none of them.",
                    "Optioneel — vul elke ronde in, of geen enkele.",
                ),
            )
            draft.laps.forEachIndexed { index, lap ->
                AndroidPostTimeLapRow(
                    index = index,
                    lap = lap,
                    balance = balances.getOrElse(index) { 0 },
                    draft = draft,
                    errors = errors,
                    touched = touched,
                    trackId = track.id,
                    onDigits = { value -> edit(androidLapTimeField(index), draft.withLapDigits(index, value)) },
                    onCoinChange = { value -> edit(androidLapCoinField(index), draft.withLapCoinChange(index, value)) },
                    onMushrooms = { value -> edit(androidLapMushroomField(index), draft.withLapMushrooms(index, value)) },
                    onClear = { edit("laps[$index]", draft.withClearedLap(index)) },
                )
            }
            androidErrorFor(errors, "laps")?.let {
                Text(
                    AndroidPostTimeMessages.text(it, language),
                    style = type.bodyS,
                    color = colors.statusError,
                    modifier = Modifier.testTag("post-time-laps-error"),
                )
            }
        }

        // ---- what this time would do, and the publication
        if (manage == null) AndroidPostTimePredictionPanel(
            draft = draft,
            errors = errors,
            // The panel predicts from the total as soon as the total itself is a
            // time, not only once every rule passes: a lap that does not add up
            // is an outstanding check, not a reason to stop saying what the time
            // would do (POST_A_TIME §7 INVALID).
            totalTimeMs = (TimeTrialRules.checkTimeDigits(draft.totalDigits) as? TimeTrialRules.TimeCheck.Ok)
                ?.ms?.toLong(),
            board = board,
            ownPlayerId = signedInPlayerId,
            rivalIds = rivalIds,
            stage = stage,
            syncState = syncState,
            feedback = publishedFeedback,
            numberLanguage = numberLanguage,
        )
        }

        Column(
            Modifier.padding(horizontal = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            when {
                manage != null -> AndroidPostTimeManageFooter(
                    manage = manage,
                    correction = { reason, note ->
                        payload?.let { valid -> original?.let { androidCorrectionOf(it, draft, valid, reason, note) } }
                    },
                    formValid = payload != null,
                    workerDispatcher = workerDispatcher,
                )
                contextFactory == null || submissionHost == null -> Mk8dxButton(
                    androidText(language, "Publish · ${selectedMode}cc", "Publiceren · ${selectedMode}cc"),
                    {},
                    variant = Mk8dxButtonVariant.Primary,
                    size = Mk8dxButtonSize.Lg,
                    stopwatch = true,
                    engine = selectedMode,
                    disabledReason = androidText(
                        language,
                        "This build cannot save a result.",
                        "Deze build kan geen resultaat opslaan.",
                    ),
                    tag = "post-time-publish",
                    modifier = Modifier.fillMaxWidth(),
                )
                stage == AndroidPostTimeStage.SENDING -> Mk8dxButton(
                    androidText(language, "Publish · ${selectedMode}cc", "Publiceren · ${selectedMode}cc"),
                    {},
                    variant = Mk8dxButtonVariant.Primary,
                    size = Mk8dxButtonSize.Lg,
                    engine = selectedMode,
                    loadingLabel = androidText(language, "Saving your time…", "Je tijd wordt opgeslagen…"),
                    tag = "post-time-publish",
                    modifier = Modifier.fillMaxWidth(),
                )
                stage == AndroidPostTimeStage.QUEUED -> Mk8dxButton(
                    androidText(language, "Post another time", "Nog een tijd plaatsen"),
                    {
                        draft = createAndroidPostTimeDraft(track.id, selectedMode, track.lapCount)
                        scanned = null
                        scanConflicts = emptyList()
                        scanUnreadLoadout = emptyList()
                        scanLapCount = null
                        savedEntryKey = null
                        syncState = null
                        publishedFeedback = null
                        stage = AndroidPostTimeStage.EDITING
                        androidClearDraft(storage)
                    },
                    variant = Mk8dxButtonVariant.Primary,
                    size = Mk8dxButtonSize.Lg,
                    stopwatch = true,
                    tag = "post-time-another",
                    modifier = Modifier.fillMaxWidth(),
                )
                payload == null -> Mk8dxButton(
                    androidText(language, "Publish · ${selectedMode}cc", "Publiceren · ${selectedMode}cc"),
                    {},
                    variant = Mk8dxButtonVariant.Primary,
                    size = Mk8dxButtonSize.Lg,
                    stopwatch = true,
                    engine = selectedMode,
                    disabledReason = androidPublishBlockedReason(errors, language),
                    tag = "post-time-publish",
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> Mk8dxArmedButton(
                    label = androidText(language, "Publish · ${selectedMode}cc", "Publiceren · ${selectedMode}cc"),
                    armedLabel = androidText(language, "Confirm and publish · ${selectedMode}cc", "Bevestig en publiceer · ${selectedMode}cc"),
                    nextStep = androidText(
                        language,
                        "Review the summary, then confirm · nothing is published yet",
                        "Controleer de samenvatting en bevestig · er is nog niets gepubliceerd",
                    ),
                    onConfirm = publish,
                    action = armed,
                    engine = selectedMode,
                    controlledArmed = armedShown,
                    onArmedChange = { armedShown = it },
                    tag = "post-time-publish",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (stage == AndroidPostTimeStage.FAILED) {
                Mk8dxStatusMessage(
                    androidText(
                        language,
                        "Saving failed — try again. Your time is still here.",
                        "Opslaan is mislukt — probeer opnieuw. Je tijd staat er nog.",
                    ),
                    Modifier.testTag("post-time-failed"),
                    Mk8dxStatusTone.Error,
                )
            }
        }
    }

    pickerPart?.let { category ->
        AndroidPostTimeSetupPicker(
            category = category,
            selectedId = draft.loadout[category.draftKey()],
            onSelect = { id ->
                edit(androidLoadoutField(category.draftKey()), draft.withLoadoutPart(category.draftKey(), id))
                pickerPart = null
            },
            onDismiss = { pickerPart = null },
        )
    }
}

// ------------------------------------------------------------------ Manage: save a correction

@Composable
private fun AndroidPostTimeManageFooter(
    manage: AndroidPostTimeEdit,
    /** The correction for this reason and note, or null when nothing about the result changed. */
    correction: (String, String?) -> nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialCorrection?,
    formValid: Boolean,
    workerDispatcher: CoroutineDispatcher,
) {
    val language = LocalAndroidProductLanguage.current
    val dutch = language.code == "nl"
    val scope = rememberCoroutineScope()
    val savedVideo = manage.result.videoUrl.orEmpty()
    var video by remember(manage) { mutableStateOf(savedVideo) }
    var reason by remember(manage) { mutableStateOf(ANDROID_TIME_TRIAL_REASON_CODES.first()) }
    var note by remember(manage) { mutableStateOf("") }
    var busy by remember(manage) { mutableStateOf(false) }
    var problem by remember(manage) { mutableStateOf<String?>(null) }
    val videoProblem = androidVideoLinkProblem(video, dutch)
    val videoChanged = video.trim() != savedVideo && androidYouTubeWatchUrl(video) != savedVideo.ifEmpty { null }
    val pending = correction(reason, note)

    Mk8dxTextField(
        androidText(language, "Video (YouTube)", "Video (YouTube)"),
        video,
        { video = it; problem = null },
        placeholder = "https://youtu.be/…",
        hint = videoProblem ?: androidText(
            language, "Optional. Leave it empty to remove the video.", "Optioneel. Laat leeg om de video te verwijderen.",
        ),
        keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri,
        invalid = videoProblem != null,
        tag = "post-time-manage-video",
    )
    if (pending != null) {
        Mk8dxFieldLabel(androidText(language, "Why is it changing?", "Waarom verandert het?"))
        ANDROID_TIME_TRIAL_REASON_CODES.forEach { code ->
            Mk8dxOptionRow(
                label = androidReasonLabel(code, dutch),
                selected = reason == code,
                onClick = { reason = code },
                modifier = Modifier.testTag("post-time-manage-reason-$code"),
            )
        }
        Mk8dxTextField(
            androidText(language, "Note (optional)", "Toelichting (optioneel)"),
            note,
            { note = it.take(256) },
            tag = "post-time-manage-note",
        )
    }
    problem?.let {
        Mk8dxStatusMessage(it, Modifier.testTag("post-time-manage-problem"), Mk8dxStatusTone.Error)
    }
    val blocked = when {
        !formValid -> androidText(language, "Check the marked fields first.", "Controleer eerst de gemarkeerde velden.")
        videoProblem != null -> videoProblem
        pending == null && !videoChanged -> androidText(language, "Nothing has changed yet.", "Er is nog niets veranderd.")
        else -> null
    }
    Mk8dxButton(
        androidText(language, "Save changes", "Wijzigingen opslaan"),
        {
            busy = true
            problem = null
            scope.launch {
                val failure = withContext(workerDispatcher) {
                    pending?.let { manage.saveCorrection(it) }
                        ?: if (videoChanged) manage.saveVideo(androidYouTubeWatchUrl(video)) else null
                }
                busy = false
                if (failure == null) manage.onClose(true) else problem = failure
            }
        },
        variant = Mk8dxButtonVariant.Primary,
        size = Mk8dxButtonSize.Lg,
        disabledReason = blocked,
        loadingLabel = if (busy) androidText(language, "Saving…", "Opslaan…") else null,
        tag = "post-time-manage-save",
        modifier = Modifier.fillMaxWidth(),
    )
    Mk8dxButton(
        androidText(language, "Cancel", "Annuleren"),
        { manage.onClose(false) },
        variant = Mk8dxButtonVariant.Secondary,
        size = Mk8dxButtonSize.Lg,
        tag = "post-time-manage-cancel",
        modifier = Modifier.fillMaxWidth(),
    )
    manage.withdraw?.let { withdraw ->
        var asking by remember(manage) { mutableStateOf(false) }
        Mk8dxButton(
            androidText(language, "Withdraw result", "Resultaat intrekken"),
            { asking = true },
            variant = Mk8dxButtonVariant.Quiet,
            tag = "post-time-manage-withdraw",
        )
        if (asking) {
            AndroidWithdrawDialog(
                withdraw = withdraw,
                workerDispatcher = workerDispatcher,
                onDismiss = { asking = false },
                onWithdrawn = { asking = false; manage.onClose(true) },
            )
        }
    }
}

/** Withdraw, with its reason, confirmed by sliding the handle all the way (owner 2026-09-29). */
@Composable
private fun AndroidWithdrawDialog(
    withdraw: suspend (String) -> String?,
    workerDispatcher: CoroutineDispatcher,
    onDismiss: () -> Unit,
    onWithdrawn: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val dutch = language.code == "nl"
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf(ANDROID_WITHDRAW_REASON_CODES.first()) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    Mk8dxDialog(
        androidText(language, "Withdraw this result?", "Dit resultaat intrekken?"),
        androidText(language, "Cancel", "Annuleren"),
        onDismiss,
        modifier = Modifier.testTag("post-time-withdraw-dialog"),
    ) {
        Text(
            androidText(
                language,
                "It leaves the standings and your records. You can restore it later from My results.",
                "Het verdwijnt uit de standen en je records. Je kunt het later herstellen via Mijn resultaten.",
            ),
            style = Mk8dxTheme.type.body,
            color = Mk8dxTheme.colors.textBody,
        )
        ANDROID_WITHDRAW_REASON_CODES.forEach { code ->
            Mk8dxOptionRow(
                label = androidWithdrawReasonLabel(code, dutch),
                selected = reason == code,
                onClick = { reason = code },
                modifier = Modifier.testTag("post-time-withdraw-reason-$code"),
            )
        }
        problem?.let { Mk8dxStatusMessage(it, Modifier.testTag("post-time-withdraw-problem"), Mk8dxStatusTone.Error) }
        Mk8dxSwipeToConfirm(
            if (busy) androidText(language, "Withdrawing…", "Intrekken…")
            else androidText(language, "Slide to withdraw", "Schuif om in te trekken"),
            onConfirmed = {
                busy = true
                problem = null
                scope.launch {
                    val failure = withContext(workerDispatcher) { withdraw(reason) }
                    busy = false
                    if (failure == null) onWithdrawn() else problem = failure
                }
            },
            enabled = !busy,
            tag = "post-time-withdraw-swipe",
        )
    }
}

// ------------------------------------------------------------------ the parts of the form

internal data class AndroidPostTimePartVisual(
    val name: String,
    val assetPath: String,
)

/**
 * The picker offers base parts only (SPEC §7 D8), but a scanned colour variant
 * stays in the submission while its base part is unchanged; the form then
 * shows that variant, and a matched body or glider follows its colour.
 */
internal fun androidPostTimePartVisual(
    part: AndroidBuildPart,
    loadout: Map<String, String?>,
    scanned: ScanLoadoutV1?,
): AndroidPostTimePartVisual {
    val characterId = loadout["characterId"]
    val scannedCharacter = scanned?.characterVariantId
        ?.takeIf { characterId != null && characterId == scanned.characterId }
    val exact = when {
        part.id.startsWith("character.") -> scannedCharacter?.takeIf { part.id == characterId }
        part.id.startsWith("body.") -> scanned?.bodyVariantId?.takeIf { part.id == scanned.bodyId }
        part.id.startsWith("glider.") -> scanned?.gliderVariantId?.takeIf { part.id == scanned.gliderId }
        else -> null
    }
    val variant = exact?.let { AndroidLoadoutVariants.byId(it) }
        ?: (scannedCharacter ?: characterId)?.let { AndroidLoadoutVariants.matched(part.id, it) }
    return AndroidPostTimePartVisual(
        name = variant?.let { "${part.name} · ${it.name}" } ?: part.name,
        assetPath = variant?.assetPath ?: part.assetPath,
    )
}

@Composable
private fun AndroidPostTimePublishSummary(
    track: AndroidTrackCatalogEntry,
    draft: AndroidPostTimeDraft,
    scannedLoadout: ScanLoadoutV1?,
    onBack: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(
        androidText(language, "REVIEW — NOT POSTED", "CONTROLEREN — NOG NIET GEPLAATST"),
        Modifier.padding(horizontal = Mk8dxSpacing.md).testTag("post-time-confirmation"),
    ) {
        Mk8dxStatusMessage(
            androidText(
                language,
                "Check this summary, then press Confirm and publish below. Nothing has been saved or published yet.",
                "Controleer deze samenvatting en druk daarna hieronder op Bevestig en publiceer. Er is nog niets opgeslagen of gepubliceerd.",
            ),
            Modifier.testTag("post-time-not-submitted"),
            Mk8dxStatusTone.Warning,
        )
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Box(Modifier.width(88.dp).height(56.dp)) {
                TrackAssetArtwork(
                    trackIndex = track.index,
                    modifier = Modifier.matchParentSize(),
                    contentDescription = track.displayName,
                )
                ProductAssetImage(
                    path = "private-product/img/cup/${track.index / 4}.png",
                    fallback = "C",
                    accent = colors.borderStrong,
                    modifier = Modifier.align(Alignment.TopStart).padding(3.dp).size(22.dp),
                    contentDescription = null,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                Mk8dxSectionLabel(androidText(language, "TRACK", "CIRCUIT"))
                Text(track.displayName, style = type.title, color = colors.textPrimary)
            }
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Mk8dxSectionLabel(androidText(language, "TOTAL TIME", "TOTAALTIJD"))
                Text(
                    androidFormatDraftDigits(draft.totalDigits),
                    style = type.dataXl,
                    color = colors.textPrimary,
                    modifier = Modifier.testTag("post-time-confirm-total"),
                )
            }
            Mk8dxEngineMark(draft.mode, size = Mk8dxEngineMarkSize.Lg)
        }

        Mk8dxSectionLabel(androidText(language, "KART SETUP", "KARTOPSTELLING"))
        AndroidBuildPartCategory.entries.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                row.forEach { category ->
                    val part = AndroidLoadoutCatalog.find(draft.loadout[category.draftKey()])
                    val visual = part?.let { androidPostTimePartVisual(it, draft.loadout, scannedLoadout) }
                    Row(
                        Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                    ) {
                        if (part != null && visual != null) {
                            ProductAssetImage(
                                path = visual.assetPath,
                                fallback = part.name.take(1),
                                accent = colors.borderStrong,
                                modifier = Modifier.size(32.dp),
                                contentDescription = null,
                            )
                        }
                        Column(Modifier.weight(1f)) {
                            Text(category.partLabel(language), style = type.label, color = colors.textSecondary)
                            Text(
                                visual?.name ?: androidText(language, "Not recorded", "Niet vastgelegd"),
                                style = type.bodyS,
                                color = colors.textPrimary,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }

        Mk8dxSectionLabel(androidText(language, "RACE DETAILS", "RONDEDETAILS"))
        if (draft.laps.any { it.timeDigits.isNotEmpty() }) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                draft.laps.forEachIndexed { index, lap ->
                    val coin = lap.coinChange?.let(::androidSignedCoins) ?: "—"
                    val mushrooms = lap.mushroomsUsed?.toString() ?: "—"
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = Mk8dxSpacing.xxs),
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            androidText(language, "Lap ${index + 1}", "Ronde ${index + 1}"),
                            style = type.label,
                            color = colors.textPrimary,
                            modifier = Modifier.width(58.dp),
                        )
                        Text(
                            if (lap.timeDigits.isEmpty()) "—" else androidFormatDraftDigits(lap.timeDigits),
                            style = type.data,
                            color = colors.textPrimary,
                            modifier = Modifier.width(74.dp),
                        )
                        Text(
                            androidText(
                                language,
                                "Coins $coin · Mushrooms $mushrooms",
                                "Munten $coin · Paddenstoelen $mushrooms",
                            ),
                            style = type.label,
                            color = colors.textSecondary,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        } else {
            Mk8dxMetaLine(
                androidText(
                    language,
                    "Lap times, coins and mushrooms not recorded.",
                    "Rondetijden, munten en paddenstoelen niet vastgelegd.",
                ),
            )
        }
        Mk8dxStatusMessage(
            androidText(
                language,
                "Ready to publish — not posted yet.",
                "Klaar om te publiceren — nog niet geplaatst.",
            ),
            tone = Mk8dxStatusTone.Warning,
        )
        Mk8dxButton(
            androidText(language, "Back to adjust", "Terug om aan te passen"),
            onBack,
            variant = Mk8dxButtonVariant.Secondary,
            tag = "post-time-confirm-back",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AndroidPostTimeLapRow(
    index: Int,
    lap: AndroidPostTimeLap,
    balance: Int,
    draft: AndroidPostTimeDraft,
    errors: List<RuleError>,
    touched: Set<String>,
    trackId: String,
    onDigits: (String) -> Unit,
    onCoinChange: (Int?) -> Unit,
    onMushrooms: (Int?) -> Unit,
    onClear: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val lapNumber = index + 1
    val timeField = androidLapTimeField(index)
    Column(
        Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxFieldLabel(
                androidText(language, "Lap $lapNumber", "Ronde $lapNumber"),
                Modifier.weight(1f),
            )
            if (lap.timeDigits.isNotEmpty() || lap.coinChange != null || lap.mushroomsUsed != null) {
                Mk8dxButton(
                    androidText(language, "Clear", "Wissen"),
                    onClear,
                    variant = Mk8dxButtonVariant.Quiet,
                    size = Mk8dxButtonSize.Sm,
                    tag = "post-time-clear-lap-$lapNumber",
                )
            }
        }
        Mk8dxTimeInput(
            androidText(language, "Lap $lapNumber", "Ronde $lapNumber"),
            lap.timeDigits,
            onDigits,
            Modifier.testTag("post-time-lap-$lapNumber"),
            invalid = androidErrorFor(errors, timeField) != null && timeField in touched,
            doubt = timeField in draft.doubt,
            compact = true,
        )
        AndroidFieldSource(draft, timeField, touched)
        AndroidFieldMessage(errors, timeField, timeField in touched)
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            Column {
                val currency = androidCurrencyAsset(trackId)
                AndroidMetricFieldLabel(
                    androidCoinLabel(trackId, language),
                    currency.first,
                    currency.second,
                    "post-time-currency-icon-$lapNumber",
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                    Mk8dxButton(
                        Mk8dxNumeric.TRUE_MINUS,
                        { onCoinChange(((lap.coinChange ?: 0) - 1).coerceAtLeast(-10)) },
                        variant = Mk8dxButtonVariant.Secondary,
                        size = Mk8dxButtonSize.Sm,
                        tag = "post-time-coins-$lapNumber-down",
                        modifier = Modifier.widthIn(min = 52.dp),
                    )
                    Text(
                        if (lap.coinChange == null) {
                            androidText(language, "not recorded", "niet vastgelegd")
                        } else {
                            androidText(
                                language,
                                "${androidSignedCoins(lap.coinChange)} · balance ${androidCoinBalance(balance)}",
                                "${androidSignedCoins(lap.coinChange)} · saldo ${androidCoinBalance(balance)}",
                            )
                        },
                        style = type.dataS,
                        color = if (lap.coinChange == null) colors.textTertiary else colors.textBody,
                        softWrap = false,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.widthIn(min = 108.dp).testTag("post-time-coins-$lapNumber"),
                    )
                    Mk8dxButton(
                        "+",
                        { onCoinChange(((lap.coinChange ?: 0) + 1).coerceAtMost(10)) },
                        variant = Mk8dxButtonVariant.Secondary,
                        size = Mk8dxButtonSize.Sm,
                        tag = "post-time-coins-$lapNumber-up",
                        modifier = Modifier.widthIn(min = 52.dp),
                    )
                }
                AndroidFieldSource(draft, androidLapCoinField(index), touched)
                AndroidFieldMessage(errors, androidLapCoinField(index), androidLapCoinField(index) in touched)
            }
            Column {
                AndroidMetricFieldLabel(
                    androidText(language, "Mushrooms used", "Paddenstoelen"),
                    "private-product/img/item/mushroom.png",
                    androidText(language, "Mushroom", "Paddenstoel"),
                    "post-time-mushroom-icon-$lapNumber",
                )
                Mk8dxSegmentedControl(
                    androidText(language, "Mushrooms used, lap $lapNumber", "Paddenstoelen, ronde $lapNumber"),
                    listOf<Pair<Int?, String>>(
                        null to androidText(language, "–", "–"),
                        0 to "0",
                        1 to "1",
                        2 to "2",
                        3 to "3",
                    ),
                    lap.mushroomsUsed,
                    onMushrooms,
                    Modifier.testTag("post-time-mushrooms-$lapNumber"),
                )
                AndroidFieldSource(draft, androidLapMushroomField(index), touched)
            }
        }
    }
}

/** ScannedFieldIndicator (§6): what filled this value, and "Edited" once it is touched. */
@Composable
private fun AndroidFieldSource(draft: AndroidPostTimeDraft, field: String, touched: Set<String>) {
    val language = LocalAndroidProductLanguage.current
    val scannedField = draft.origin[field] == AndroidFieldOrigin.SCANNED
    val editedScan = draft.scan != null && field in touched
    if (!scannedField && !editedScan) return
    val label = if (scannedField) {
        androidText(language, "Scanned", "Gescand")
    } else {
        androidText(language, "Edited", "Aangepast")
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Mk8dxChip(
            label,
            Modifier.testTag("post-time-source-$field"),
            if (scannedField) Mk8dxChipTone.Info else Mk8dxChipTone.Neutral,
        )
        if (field in draft.doubt) {
            Mk8dxChip(
                androidText(language, "Check this one", "Controleer deze"),
                Modifier.testTag("post-time-doubt-$field"),
                Mk8dxChipTone.Warning,
            )
        }
    }
}

@Composable
private fun AndroidFieldMessage(errors: List<RuleError>, field: String, show: Boolean) {
    if (!show) return
    val error = androidErrorFor(errors, field) ?: return
    val language = LocalAndroidProductLanguage.current
    Text(
        AndroidPostTimeMessages.text(error, language),
        style = Mk8dxTheme.type.bodyS,
        color = Mk8dxTheme.colors.statusError,
        modifier = Modifier.testTag("post-time-error-$field"),
    )
}

@Composable
private fun AndroidPostTimeSetupPicker(
    category: AndroidBuildPartCategory,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    var query by remember(category) { mutableStateOf("") }
    val parts = remember(category, query) {
        AndroidLoadoutCatalog.parts(category).filter {
            query.isBlank() || it.name.lowercase().contains(query.trim().lowercase())
        }
    }
    Mk8dxDialog(
        category.partLabel(language),
        androidText(language, "Close", "Sluiten"),
        onDismiss,
        Modifier.testTag("post-time-setup-picker"),
    ) {
        Mk8dxSearchField(
            androidText(language, "Search parts", "Zoek onderdelen"),
            query,
            { query = it },
            Modifier.fillMaxWidth(),
            tag = "post-time-setup-search",
        )
        Mk8dxButton(
            androidText(language, "Not recorded", "Niet vastgelegd"),
            { onSelect(null) },
            variant = Mk8dxButtonVariant.Secondary,
            tag = "post-time-setup-clear",
        )
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 380.dp),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            items(parts, key = AndroidBuildPart::id) { part ->
                Mk8dxPickerTile(
                    part.name,
                    selectedId == part.id,
                    { onSelect(part.id) },
                    Modifier.testTag("post-time-setup-option-${part.id}"),
                ) {
                    ProductAssetImage(
                        path = part.assetPath,
                        fallback = part.name.take(1),
                        accent = Mk8dxTheme.colors.borderStrong,
                        modifier = Modifier.size(54.dp),
                        contentDescription = null,
                    )
                }
            }
        }
    }
}

@Composable
private fun AndroidPostTimePredictionPanel(
    draft: AndroidPostTimeDraft,
    errors: List<RuleError>,
    totalTimeMs: Long?,
    board: List<AndroidPredictionBoardRow>?,
    ownPlayerId: String?,
    rivalIds: Set<String>,
    stage: AndroidPostTimeStage,
    syncState: String?,
    feedback: AndroidSubmissionFeedback?,
    numberLanguage: Mk8dxNumberLanguage,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(
        androidText(language, "WHAT THIS TIME DOES", "WAT DEZE TIJD DOET"),
        Modifier.padding(horizontal = Mk8dxSpacing.md).testTag("post-time-prediction"),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Text(
                totalTimeMs?.let(Mk8dxNumeric::formatTime) ?: androidFormatDraftDigits(draft.totalDigits),
                style = type.dataXl,
                color = colors.textPrimary,
                softWrap = false,
                maxLines = 1,
                modifier = Modifier.testTag("post-time-prediction-time"),
            )
            Mk8dxEngineMark(draft.mode, size = Mk8dxEngineMarkSize.Md)
        }
        Column(
            Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            if (stage == AndroidPostTimeStage.QUEUED) {
                // SAVED / QUEUED: the phone's own answer, replaced by the site's
                // when the automatic sync has delivered it.
                val queuedLine = when (syncState) {
                    "synced" -> androidText(language, "✓ Published to the site.", "✓ Gepubliceerd op de site.")
                    "failed" -> androidText(
                        language,
                        "Saved on this phone. The site has not accepted it yet; Saved results can retry.",
                        "Opgeslagen op deze telefoon. De site heeft het nog niet geaccepteerd; Opgeslagen resultaten kan het opnieuw proberen.",
                    )
                    else -> androidText(
                        language,
                        "Saved on this phone · it will be published when you're online.",
                        "Opgeslagen op deze telefoon · het wordt gepubliceerd zodra je online bent.",
                    )
                }
                Text(
                    queuedLine,
                    style = type.body,
                    color = colors.textPrimary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.testTag("post-time-status"),
                )
                feedback?.lines(language)?.forEachIndexed { index, line ->
                    Text(
                        line,
                        style = type.body,
                        color = colors.textBody,
                        modifier = Modifier.testTag("post-time-feedback-$index"),
                    )
                }
                return@Column
            }
            if (totalTimeMs == null) {
                Text(
                    androidText(
                        language,
                        "Type your total time — or scan it.",
                        "Vul je totaaltijd in — of scan hem.",
                    ),
                    style = type.body,
                    color = colors.textSecondary,
                )
            } else {
                val prediction = board?.let {
                    androidPredictFromBoard(totalTimeMs, it, ownPlayerId, null, rivalIds)
                }
                Text(
                    androidPersonalBestLine(prediction, language),
                    style = type.body,
                    color = colors.textBody,
                    modifier = Modifier.testTag("post-time-personal-best"),
                )
                Text(
                    androidPositionLine(prediction, board != null, numberLanguage, language),
                    style = type.body,
                    color = colors.textBody,
                    modifier = Modifier.testTag("post-time-position"),
                )
                prediction?.ahead?.let {
                    Text(
                        androidNeighbourLine(it, prediction.keepsExistingBest(), language),
                        style = type.bodyS,
                        color = colors.textSecondary,
                        modifier = Modifier.testTag("post-time-ahead"),
                    )
                }
                prediction?.behind?.let {
                    Text(
                        androidNeighbourLine(it, prediction.keepsExistingBest(), language),
                        style = type.bodyS,
                        color = colors.textSecondary,
                        modifier = Modifier.testTag("post-time-behind"),
                    )
                }
            }
            Mk8dxSectionLabel(androidText(language, "CHECKS", "CONTROLES"))
            if (errors.isEmpty()) {
                Text(
                    androidText(language, "Everything checks out.", "Alles klopt."),
                    style = type.bodyS,
                    color = colors.statusSuccess,
                    modifier = Modifier.testTag("post-time-checks-ok"),
                )
            } else {
                Column(Modifier.testTag("post-time-checks"), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs)) {
                    errors.take(4).forEach { error ->
                        Text(
                            AndroidPostTimeMessages.text(error, language),
                            style = type.bodyS,
                            color = colors.statusWarning,
                        )
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ small pure helpers

internal fun androidSignedCoins(change: Int): String =
    if (change < 0) "${Mk8dxNumeric.TRUE_MINUS}${-change}" else "+$change"

internal fun androidUnsignedDelta(value: Long): String =
    Mk8dxNumeric.formatDelta(kotlin.math.abs(value)).trimStart('+', '-', Mk8dxNumeric.TRUE_MINUS.first())

/** A balance carries no sign, and a negative one carries the true minus (§10). */
internal fun androidCoinBalance(balance: Int): String =
    if (balance < 0) "${Mk8dxNumeric.TRUE_MINUS}${-balance}" else "$balance"

@Composable
private fun androidCoinLabel(trackId: String, language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage): String =
    when (trackId) {
        // The game calls them something else on two tracks, and the product
        // always has; the rule and the stored field are the same.
        "track.hyrule_circuit" -> androidText(language, "Rupees", "Rupees")
        "track.animal_crossing" -> androidText(language, "Bells", "Bellen")
        "track.yoshis_island" -> androidText(language, "Shines", "Shines")
        else -> androidText(language, "Coins", "Munten")
    }

private fun androidCurrencyAsset(trackId: String): Pair<String, String> = when (trackId) {
    "track.yoshis_island" -> "private-product/img/item/shine.png" to "Shine"
    "track.hyrule_circuit" -> "private-product/img/item/rupee.png" to "Rupee"
    "track.animal_crossing" -> "private-product/img/item/bell.png" to "Bell"
    else -> "private-product/img/item/coin.png" to "Coin"
}

@Composable
private fun AndroidMetricFieldLabel(label: String, assetPath: String, description: String, tag: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        ProductAssetImage(
            path = assetPath,
            fallback = description.take(1),
            accent = Mk8dxTheme.colors.textSecondary,
            modifier = Modifier.size(20.dp).testTag(tag),
            contentDescription = null,
        )
        Mk8dxFieldLabel(label)
    }
}

private fun AndroidBuildPartCategory.draftKey(): String = when (this) {
    AndroidBuildPartCategory.CHARACTER -> "characterId"
    AndroidBuildPartCategory.BODY -> "bodyId"
    AndroidBuildPartCategory.TIRE -> "tireId"
    AndroidBuildPartCategory.GLIDER -> "gliderId"
}

private fun AndroidBuildPartCategory.partLabel(
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
): String = when (this) {
    AndroidBuildPartCategory.CHARACTER -> androidText(language, "Character", "Personage")
    AndroidBuildPartCategory.BODY -> androidText(language, "Body", "Voertuig")
    AndroidBuildPartCategory.TIRE -> androidText(language, "Tyres", "Banden")
    AndroidBuildPartCategory.GLIDER -> androidText(language, "Glider", "Zweefscherm")
}

/**
 * Publish is never silently disabled (§9): the reason is the first outstanding
 * rule, said in the Player's words — and an empty form says what to do first.
 */
internal fun androidPublishBlockedReason(
    errors: List<RuleError>,
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
): String {
    val first = errors.firstOrNull()
        ?: return androidText(language, "Enter a total time first.", "Vul eerst een totaaltijd in.")
    if (first.rule == "total_required") {
        return androidText(language, "Enter a total time first.", "Vul eerst een totaaltijd in.")
    }
    return AndroidPostTimeMessages.text(first, language)
}

internal fun androidPersonalBestLine(
    prediction: AndroidSubmissionPrediction?,
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
): String {
    val previous = prediction?.previousBestMs
    val delta = prediction?.deltaMs
    return when {
        prediction == null -> androidText(
            language,
            "Loading the leaderboard for the predicted position…",
            "Het klassement wordt geladen voor de verwachte positie…",
        )
        previous == null || delta == null -> androidText(
            language,
            "First time on this track in this class.",
            "Eerste tijd op dit circuit in deze klasse.",
        )
        delta == 0L -> androidText(
            language,
            "Personal best matched — this run becomes your current PB with its added details.",
            "Persoonlijk record geëvenaard — deze run wordt je actuele PR met de toegevoegde details.",
        )
        prediction.improved -> androidText(
            language,
            "Personal best — ${Mk8dxNumeric.formatDelta(delta)} faster than ${Mk8dxNumeric.formatTime(previous)}.",
            "Persoonlijk record — ${Mk8dxNumeric.formatDelta(delta)} sneller dan ${Mk8dxNumeric.formatTime(previous)}.",
        )
        else -> androidText(
            language,
            "This time is ${Mk8dxNumeric.formatDelta(delta)} slower than your ${Mk8dxNumeric.formatTime(previous)} PB.",
            "Deze tijd is ${Mk8dxNumeric.formatDelta(delta)} langzamer dan je PR van ${Mk8dxNumeric.formatTime(previous)}.",
        )
    }
}

internal fun AndroidSubmissionPrediction.keepsExistingBest(): Boolean =
    previousBestMs != null && deltaMs != null && deltaMs > 0

internal fun androidNeighbourLine(
    neighbour: AndroidPredictionNeighbour,
    keepsExistingBest: Boolean,
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
): String {
    val outcome = when {
        neighbour.gapMs > 0 -> androidText(language, "behind", "achter")
        neighbour.gapMs < 0 -> androidText(language, "ahead", "voor")
        else -> androidText(language, "level", "gelijk")
    }
    val delta = Mk8dxNumeric.formatDelta(neighbour.gapMs)
    return if (keepsExistingBest) {
        androidText(
            language,
            "Delta to ${neighbour.displayName} remains $delta · your PB is $outcome.",
            "Delta met ${neighbour.displayName} blijft $delta · je PR ligt $outcome.",
        )
    } else {
        androidText(
            language,
            "Delta to ${neighbour.displayName}: $delta · you would be $outcome.",
            "Delta met ${neighbour.displayName}: $delta · je zou $outcome liggen.",
        )
    }
}

internal fun androidPositionLine(
    prediction: AndroidSubmissionPrediction?,
    boardLoaded: Boolean,
    numberLanguage: Mk8dxNumberLanguage,
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
): String {
    if (prediction == null || !boardLoaded) {
        return androidText(
            language,
            "The predicted position needs the leaderboard.",
            "De verwachte positie heeft het klassement nodig.",
        )
    }
    val after = prediction.rankAfter
        ?: return androidText(language, "Outside the top 100.", "Buiten de top 100.")
    val field = Mk8dxNumeric.formatCount(prediction.fieldCount.toLong(), numberLanguage) +
        if (prediction.fieldComplete) "" else "+"
    val previousBestMs = prediction.previousBestMs
    if (previousBestMs != null && prediction.keepsExistingBest()) {
        return androidText(
            language,
            "Your leaderboard position stays #$after of $field, based on your ${Mk8dxNumeric.formatTime(previousBestMs)} PB.",
            "Je blijft #$after van $field, op basis van je PR van ${Mk8dxNumeric.formatTime(previousBestMs)}.",
        )
    }
    return androidText(
        language,
        "Predicted position $after of $field.",
        "Verwachte positie $after van $field.",
    )
}

/** The kept draft, in the product's own preferences file. */
@Composable
internal fun rememberAndroidPostTimeDraftStorage(context: Context): AndroidPostTimeDraftStorage {
    val applicationContext = context.applicationContext
    return remember(applicationContext) {
        object : AndroidPostTimeDraftStorage {
            private val preferences =
                applicationContext.getSharedPreferences("mk8dx-post-time-draft-v1", Context.MODE_PRIVATE)

            override fun read(): String? = preferences.getString("draft", null)

            override fun write(value: String) {
                preferences.edit().putString("draft", value).apply()
            }

            override fun clear() {
                preferences.edit().remove("draft").apply()
            }
        }
    }
}
