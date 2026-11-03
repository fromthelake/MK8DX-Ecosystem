package nl.mariokart8.mk8dxtimetrials.tournament

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import nl.mariokart8.mk8dxtimetrials.auth.androidReadableReference
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Calendar
import java.util.Date
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

private fun AndroidTournamentGroup.hasCompleteScores(): Boolean =
    standings.source != "none" &&
        standings.rows.size == members.size &&
        standings.rows.all { it.complete }

private fun AndroidTournamentDocument.hasCompleteScores(stage: String): Boolean {
    val stageGroups = groups.filter { it.stage == stage }
    return stageGroups.isNotEmpty() && stageGroups.all(AndroidTournamentGroup::hasCompleteScores)
}

/** ADR-0221: the friendly reason when only self sign-up creates Players. */
internal fun androidPlayerCreationClosedMessage(language: AndroidProductLanguage): String = androidText(
    language,
    "On this site Players create themselves when they sign up. Ask the person to sign up, then add their Player.",
    "Op deze site maken spelers zichzelf aan bij het aanmelden. Vraag de persoon zich aan te melden en voeg daarna zijn speler toe.",
)

/** ADR-0221: true when the server refused Player creation by the installation setting. */
internal fun androidPlayerCreationRefused(failure: Throwable): Boolean =
    (failure as? AndroidTournamentClientException)?.let {
        it.statusCode == 403 && it.code == PLAYER_CREATION_DIRECTORS_DISABLED
    } == true

internal fun androidTournamentMutationError(failure: Throwable, language: AndroidProductLanguage): String {
    if (androidPlayerCreationRefused(failure)) return androidPlayerCreationClosedMessage(language)
    val typed = failure as? AndroidTournamentClientException
        ?: return androidText(
            language,
            "That change could not be saved. Refresh the Tournament data and check again.",
            "Die wijziging kon niet worden opgeslagen. Vernieuw de toernooigegevens en controleer opnieuw.",
        )
    if (typed.statusCode != 409) {
        return if (typed.statusCode == 403) {
            androidText(
                language,
                "This account may not make this Tournament change.",
                "Dit account mag deze toernooiwijziging niet uitvoeren.",
            )
        } else {
            androidText(
                language,
                "That change could not be saved. Refresh the Tournament data and check again.",
                "Die wijziging kon niet worden opgeslagen. Vernieuw de toernooigegevens en controleer opnieuw.",
            )
        }
    }
    val reason = typed.message.orEmpty().trim().lowercase(Locale.ROOT)
    return when {
        "groups with entered races stay locked" in reason ->
            androidText(
                language,
                "The group layout stays locked because races have already been entered. " +
                    "Those results were not removed. Continue to the score step to review them.",
                "De groepsindeling blijft vergrendeld omdat er al races zijn ingevoerd. " +
                    "Die uitslagen zijn niet verwijderd. Ga verder naar de scorestap om ze te controleren.",
            )
        "tournament changed" in reason || "reload and retry" in reason ->
            androidText(
                language,
                "The tournament changed in the meantime. Refresh the data, check the current step and then try again.",
                "Het toernooi is intussen gewijzigd. Vernieuw de gegevens, controleer de actuele stap en probeer daarna opnieuw.",
            )
        else ->
            androidText(
                language,
                "The server blocked this change because of a Tournament rule: ${typed.message}. " +
                    "Refresh the data and check the current state.",
                "De server heeft deze wijziging door een toernooiregel geblokkeerd: ${typed.message}. " +
                    "Vernieuw de gegevens en controleer de actuele toestand.",
            )
    }
}

/**
 * The Tournaments tab. It lands on the overview the site shows - what is being
 * raced, what is coming, what is being made, what is done - and the console
 * that runs a night is a door on it rather than the tab itself. Before this the
 * phone opened Step 0 directly, so the same tab asked a different question on
 * each client.
 */
@Composable
internal fun AndroidTournamentScreen(
    client: AndroidTournamentClient?,
    signedIn: Boolean,
    viewerPlayerId: String?,
    onSignIn: () -> Unit,
    /** What a shared address asked for, consumed once; see AndroidTournamentRequest. */
    request: AndroidTournamentRequest? = null,
    onRequestHandled: () -> Unit = {},
    /** A track's own rating page hands the reader on to that track's board. */
    onOpenTrack: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var operating by rememberSaveable(client) { mutableStateOf(false) }
    var operateNight by rememberSaveable(client) { mutableStateOf<String?>(null) }
    var openNight by rememberSaveable(client) { mutableStateOf<String?>(null) }
    var statisticsRequest by remember(client) { mutableStateOf<AndroidTournamentRequest?>(null) }
    var canOperate by remember(client, signedIn) { mutableStateOf(false) }
    LaunchedEffect(client, signedIn) {
        canOperate = signedIn && client != null && runCatching {
            withContext(Dispatchers.IO) { client.listDirectors().directors.isNotEmpty() }
        }.getOrDefault(false)
    }
    // A link is an instruction, not state: it opens the night or the panel it
    // named, once, and the tab behaves normally from then on.
    LaunchedEffect(request) {
        val asked = request ?: return@LaunchedEffect
        operating = false
        if (asked.nightId != null) {
            openNight = asked.nightId
            statisticsRequest = null
        } else if (asked.statistics) {
            openNight = null
            statisticsRequest = asked
        }
        onRequestHandled()
    }
    val dutch = LocalAndroidProductLanguage.current == AndroidProductLanguage.DUTCH
    val night = openNight
    // A06 is migrated: the public list, a night and the statistics run inside
    // the design system's own theme, in the appearance the Player chose. The
    // Step 0..10 console below is A07 and keeps its own chrome until Phase 14,
    // which waits for the recorded Director walkthrough (OD-09).
    if (!operating && night != null) {
        Mk8dxDesignTheme(Mk8dxDesignTheme.appearance) {
            AndroidTournamentNightScreen(
                client = client,
                tournamentId = night,
                dutch = dutch,
                onBack = { openNight = null },
                modifier = modifier,
            )
        }
        return
    }
    if (!operating) {
        val context = LocalContext.current
        Mk8dxDesignTheme(Mk8dxDesignTheme.appearance) {
            AndroidTournamentOverview(
                client = client,
                dutch = dutch,
                // Reading is for everyone; editing needs an actual Tournament
                // operator grant, not merely an arbitrary signed-in account.
                signedIn = signedIn,
                canOperate = canOperate,
                viewerPlayerId = viewerPlayerId,
                onOperate = { operateNight = null; operating = true },
                onEditNight = { operateNight = it; operating = true },
                onOpenNight = { openNight = it },
                statisticsRequest = statisticsRequest,
                onOpenTrack = onOpenTrack,
                onShareNight = { event -> androidSharePublicNight(context, event) },
                onSignIn = onSignIn,
                modifier = modifier,
            )
        }
        return
    }
    AndroidTournamentConsole(
        if (signedIn) client else null,
        onSignIn,
        onLeaveConsole = { operating = false; operateNight = null },
        initialTournamentId = operateNight,
        modifier = modifier,
    )
}

/**
 * The Step 0..10 console. Reached from the overview, and addressed directly by
 * the device tests that exercise a step.
 */
@Composable
internal fun AndroidTournamentConsole(
    client: AndroidTournamentClient?,
    onSignIn: () -> Unit,
    onLeaveConsole: () -> Unit = {},
    initialTournamentId: String? = null,
    modifier: Modifier = Modifier,
) {
    var loading by remember(client) { mutableStateOf(client != null) }
    var error by remember(client) { mutableStateOf<String?>(null) }
    var tournaments by remember(client) { mutableStateOf<List<AndroidTournamentSummary>>(emptyList()) }
    var document by remember(client) { mutableStateOf<AndroidTournamentDocument?>(null) }
    var incoming by remember(client) { mutableStateOf<List<AndroidIncomingTournamentResult>>(emptyList()) }
    var directors by remember(client) { mutableStateOf<List<AndroidTournamentDirector>>(emptyList()) }
    var canActForOthers by remember(client) { mutableStateOf(false) }
    var directorConfirmed by remember(client) { mutableStateOf(false) }
    var selectedDirector by remember(client) { mutableStateOf<String?>(null) }
    var initialTournamentHandled by remember(client, initialTournamentId) { mutableStateOf(false) }
    var rosterNotice by remember(client) { mutableStateOf<String?>(null) }
    var rosterImport by remember(client) { mutableStateOf<AndroidRosterImport?>(null) }
    var participantAdd by remember(client) { mutableStateOf<AndroidParticipantAdd?>(null) }
    // ADR-0218: the board's "new Player" for a name Players already carry.
    var boardChoice by remember(client) { mutableStateOf<AndroidBoardRosterChoice?>(null) }
    // ADR-0177: a backward step invalidates the later steps server-side, so the
    // operator is asked first, naming what is undone (source Manager parity).
    var pendingRollback by remember(client) { mutableStateOf<Int?>(null) }
    // Removal hides rather than destroys, but it still leaves the lists, the
    // standings and TrueSkill, so the operator confirms it first.
    var pendingRemoval by remember(client) { mutableStateOf(false) }
    // Public aliases per Player, read once per session so a score workbook
    // can resolve an in-game name like "Soudler" to the participant Sadler.
    var playerAliases by remember(client) { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    // ADR-0221: who creates Players, read once with the first night opened. While
    // it cannot be read the defaults apply; the server still refuses a closed route.
    var installationSettings by remember(client) { mutableStateOf(AndroidInstallationSettings.DEFAULTS) }
    var installationSettingsLoaded by remember(client) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val openedTournamentId = document?.summary?.tournamentId
    LaunchedEffect(client, openedTournamentId) {
        val activeClient = client
        if (activeClient != null && openedTournamentId != null && !installationSettingsLoaded) {
            installationSettingsLoaded = true
            runCatching { withContext(Dispatchers.IO) { activeClient.installationSettings() } }
                .onSuccess { installationSettings = it }
        }
    }
    val context = LocalContext.current
    val language = LocalAndroidProductLanguage.current

    fun loadPlayerAliases() {
        val activeClient = client ?: return
        if (playerAliases.isNotEmpty()) return
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { activeClient.listPlayers() } }
                .onSuccess { players ->
                    playerAliases = players
                        .filter { it.aliases.isNotEmpty() }
                        .associate { it.playerId to it.aliases }
                }
        }
    }

    /**
     * The source Manager's Step 3 / Step 7 layout file. Names are resolved
     * through the directory - display names and aliases - before anything is
     * sent, so a layout naming somebody unknown is refused whole rather than
     * applied in part.
     */
    fun startLayoutImport(stage: String, text: String) {
        val activeClient = client ?: return
        val selected = document ?: return
        when (val parsed = androidParseLayoutCsv(text, language)) {
            is AndroidLayoutCsvParse.Failed -> rosterNotice = parsed.message
            is AndroidLayoutCsvParse.Parsed -> {
                rosterNotice = androidText(language, "Checking the layout…", "Indeling controleren…")
                loading = true
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            val directory = activeClient.listPlayers()
                            when (val resolved = androidResolveLayout(parsed.seats, directory, language)) {
                                is AndroidLayoutResolution.Failed -> resolved.message to null
                                is AndroidLayoutResolution.Resolved -> null to activeClient.importGroupLayout(
                                    selected.summary.tournamentId,
                                    selected.summary.revision,
                                    stage,
                                    resolved.groups,
                                )
                            }
                        }
                    }.onSuccess { (failure, updated) ->
                        if (updated != null) {
                            document = updated
                            rosterNotice = androidText(language, "Layout taken over from the file.", "Indeling overgenomen uit het bestand.")
                        } else {
                            rosterNotice = failure
                        }
                    }.onFailure {
                        rosterNotice = androidText(
                            language,
                            "The layout could not be taken over. " +
                                "Check that the groups are still unlocked.",
                            "De indeling kon niet worden overgenomen. " +
                                "Controleer of de groepen nog ontgrendeld zijn.",
                        )
                    }
                    loading = false
                }
            }
        }
    }

    /**
     * Applies the races a Processor workbook carried. Manual totals never reach
     * TrueSkill - only a race result can be published and only a publication is
     * rated - so a night that should count arrives this way.
     */
    fun importWorkbookRaces(
        groupId: String,
        races: List<AndroidResolvedRace>,
        characters: List<AndroidResolvedCharacter>,
    ) {
        val activeClient = client ?: return
        val selected = document ?: return
        if (races.isEmpty()) return
        loading = true
        error = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    // One call for the whole group: the server writes it in a
                    // single transaction, so the group lands whole or not at
                    // all - and a phone on mobile data no longer pays a round
                    // trip per race (owner, 2026-09-16).
                    activeClient.enterRaces(
                        selected.summary.tournamentId,
                        selected.summary.revision,
                        groupId,
                        races,
                        characters,
                    )
                }
            }.onSuccess { updated ->
                document = updated
                rosterNotice = if (characters.isEmpty()) {
                    androidText(
                        language,
                        "${races.size} races taken over from the workbook.",
                        "${races.size} races overgenomen uit de werkmap.",
                    )
                } else {
                    androidText(
                        language,
                        "${races.size} races taken over from the workbook, " +
                            "with ${characters.size} character(s).",
                        "${races.size} races overgenomen uit de werkmap, " +
                            "met ${characters.size} personage(s).",
                    )
                }
            }.onFailure {
                error = androidText(language, "The races could not be taken over.", "De races konden niet worden overgenomen.")
            }
            loading = false
        }
    }

    /**
     * Hands the score workbook back, as the source does at Step 6 and Step 10.
     * It is written from the races the platform holds rather than from a stored
     * copy of whatever file came in, so a night entered by hand exports too.
     */
    fun saveDownload(fileName: String, mimeType: String, bytes: ByteArray): Boolean {
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MK8DX")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = requireNotNull(
                    context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values),
                )
                try {
                    requireNotNull(context.contentResolver.openOutputStream(uri)).use { it.write(bytes) }
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    context.contentResolver.update(uri, values, null, null)
                } catch (failure: Throwable) {
                    context.contentResolver.delete(uri, null, null)
                    throw failure
                }
            } else {
                // App-owned external Downloads needs no broad storage permission
                // on the two legacy API levels still supported by this APK.
                val folder = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS))
                    .resolve("MK8DX").apply { mkdirs() }
                folder.resolve(fileName).writeBytes(bytes)
            }
            Toast.makeText(context, androidText(language, "Saved in Downloads/MK8DX/$fileName", "Opgeslagen in Downloads/MK8DX/$fileName"), Toast.LENGTH_LONG).show()
            true
        }.getOrElse {
            error = androidText(language, "The file could not be saved in Downloads.", "Het bestand kon niet in Downloads worden opgeslagen.")
            false
        }
    }

    fun shareWorkbook(stage: String) {
        val selected = document ?: return
        runCatching {
            val bytes = androidWriteWorkbook(selected, stage)
            val name = androidWorkbookFileName(selected, stage)
            check(saveDownload(name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes))
        }.onFailure { error = androidText(language, "The workbook could not be made.", "De werkmap kon niet worden gemaakt.") }
    }

    fun renderExportCheckpoint(checkpoint: AndroidTournamentExportCheckpoint): Pair<ByteArray, String> {
        val selected = document ?: error("Er is geen toernooi geladen")
        val model = when (checkpoint.mode) {
            AndroidExportMode.LAYOUT -> androidLayoutImageModel(selected, checkpoint.stage, checkpoint.label)
            AndroidExportMode.RESULTS -> androidResultsImageModel(selected, checkpoint.stage, checkpoint.label)
        }
        val minimums = androidExportMinimums(
            if (checkpoint.mode == AndroidExportMode.LAYOUT) "layout" else "results",
            isQualifier = checkpoint.stage != "final",
        )
        val ns1Icon = android.graphics.BitmapFactory.decodeResource(
            context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns1,
        )
        val ns2Icon = android.graphics.BitmapFactory.decodeResource(
            context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns2,
        )
        val bitmap = androidRenderExportImage(model, minimums, ns1Icon, ns2Icon)
        val bytes = androidExportImageBytes(bitmap)
        bitmap.recycle()
        ns1Icon.recycle()
        ns2Icon.recycle()
        return bytes to androidExportFileName(selected, checkpoint.stage, checkpoint.mode)
    }

    fun shareExportCheckpoint(checkpoint: AndroidTournamentExportCheckpoint) {
        val night = document ?: return
        runCatching {
            val (bytes, fileName) = renderExportCheckpoint(checkpoint)
            val folder = java.io.File(context.cacheDir, "mk8dx-result-images").apply { mkdirs() }
            val file = java.io.File(folder, fileName).apply { writeBytes(bytes) }
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, "${context.packageName}.result-image-provider", file,
            )
            context.startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "image/png"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        // The picture is the message; the text beside it only
                        // says which board of which night this is.
                        putExtra(
                            Intent.EXTRA_TEXT,
                            androidExportShareCaption(night, checkpoint.stage, checkpoint.mode),
                        )
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    },
                    androidText(language, "Share image", "Deel afbeelding"),
                ),
            )
        }.onFailure { error = androidText(language, "The picture could not be made.", "De afbeelding kon niet worden gemaakt.") }
    }

    fun downloadExportCheckpoint(checkpoint: AndroidTournamentExportCheckpoint) {
        runCatching {
            val (bytes, fileName) = renderExportCheckpoint(checkpoint)
            check(saveDownload(fileName, "image/png", bytes))
        }.onFailure { error = androidText(language, "The picture could not be saved.", "De afbeelding kon niet worden opgeslagen.") }
    }

    fun loadTournaments() {
        if (client == null) return
        loading = true
        error = null
        val director = selectedDirector
        scope.launch {
            val loaded = withContext(Dispatchers.IO) {
                runCatching {
                    // ADR-0177 decision 6: Step 1 shows only this director's Tournaments.
                    client.list(director)
                }
            }
            loaded.onSuccess { list ->
                tournaments = list
                document = null
                incoming = emptyList()
            }.onFailure { failure ->
                error = if ((failure as? AndroidTournamentClientException)?.statusCode == 403) {
                    androidText(
                        language,
                        "Running Tournament nights is for Directors; you can ask to host on the Tournaments tab. Time Trials remain fully usable.",
                        "Toernooiavonden draaien is voor Directeuren; op het tabblad Toernooien kun je vragen om te hosten. Time Trials blijven volledig bruikbaar.",
                    )
                } else {
                    androidText(
                        language,
                        "Tournament is unavailable right now. Your Time Trials are unaffected.",
                        "Het toernooi is nu niet beschikbaar. Dit heeft geen invloed op je Time Trials.",
                    )
                }
            }
            loading = false
        }
    }

    fun loadInitialTournament(listed: AndroidTournamentDirectorList): Boolean {
        val tournamentId = initialTournamentId ?: return false
        if (initialTournamentHandled || client == null) return false
        initialTournamentHandled = true
        loading = true
        error = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val detail = client.load(tournamentId)
                    val pending = client.incoming(tournamentId)
                    val owner = listed.directors.firstNotNullOfOrNull { director ->
                        val owned = runCatching { client.list(director.userAccountId) }.getOrNull()
                            ?: return@firstNotNullOfOrNull null
                        if (owned.any { it.tournamentId == tournamentId }) director to owned else null
                    }
                    Triple(detail, pending, owner)
                }
            }.onSuccess { (detail, pending, owner) ->
                selectedDirector = owner?.first?.userAccountId
                    ?: listed.directors.singleOrNull()?.userAccountId
                tournaments = owner?.second.orEmpty()
                document = detail
                incoming = pending
                directorConfirmed = true
                loadPlayerAliases()
            }.onFailure { failure ->
                error = if ((failure as? AndroidTournamentClientException)?.statusCode == 403) {
                    androidText(language, "This account may not edit this Tournament.", "Dit account mag dit toernooi niet bewerken.")
                } else {
                    androidText(language, "The chosen Tournament could not be loaded.", "Het gekozen toernooi kon niet worden geladen.")
                }
            }
            loading = false
        }
        return true
    }

    fun loadDirectors() {
        if (client == null) return
        loading = true
        error = null
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { client.listDirectors() } }
                .onSuccess { listed ->
                    directors = listed.directors
                    canActForOthers = listed.canActForOthers
                    if (loadInitialTournament(listed)) return@onSuccess
                    // A director who cannot act for anyone else has exactly one
                    // choice, so Step 0 has nothing to ask: preselect them and go
                    // straight to Step 1. Only an administrator picks a director.
                    if (!listed.canActForOthers) {
                        selectedDirector = listed.directors.firstOrNull()?.userAccountId
                        if (selectedDirector != null && !directorConfirmed) {
                            directorConfirmed = true
                            error = null
                            loading = false
                            loadTournaments()
                            return@onSuccess
                        }
                    }
                    error = null
                }
                .onFailure { failure ->
                    error = if ((failure as? AndroidTournamentClientException)?.statusCode == 403) {
                        androidText(language, "This account cannot operate tournaments.", "Dit account mag geen toernooi bedienen.")
                    } else androidText(
                        language,
                        "The list of Tournament Directors could not be loaded.",
                        "De lijst met toernooi directeuren kon niet worden geladen.",
                    )
                }
            loading = false
        }
    }

    fun createTournament(name: String, eventDate: String, startTime: String) {
        if (client == null) return
        loading = true
        error = null
        val director = selectedDirector
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val summary = client.create(name, eventDate, startTime, director)
                    client.list(director) to client.load(summary.tournamentId)
                }
            }.onSuccess { (list, created) ->
                tournaments = list
                document = created
                incoming = emptyList()
            }.onFailure { error = androidText(language, "The Tournament could not be created.", "Het toernooi kon niet worden gemaakt.") }
            loading = false
        }
    }

    fun mutateTournament(work: () -> AndroidTournamentDocument) {
        if (loading) return
        loading = true
        error = null
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { work() } }
                .onSuccess { updated -> document = updated }
                .onFailure { failure -> error = androidTournamentMutationError(failure, language) }
            loading = false
        }
    }

    // ---- The Step 3/7 board's "Toevoegen" sheet and ✕ buttons. Every action
    // ends in the same two writes the ⇄ move makes: memberships when they
    // change, then the exact layout with its slot order.
    fun applyPlan(activeClient: AndroidTournamentClient, base: AndroidTournamentDocument, stage: String, plan: AndroidSeatMovePlan): AndroidTournamentDocument {
        val revision = if (plan.membershipChanged) {
            activeClient.updateGroups(base.summary.tournamentId, base.summary.revision, stage, plan.memberships).summary.revision
        } else {
            base.summary.revision
        }
        return activeClient.importGroupLayout(base.summary.tournamentId, revision, stage, plan.layout)
    }
    fun seatAfter(activeClient: AndroidTournamentClient, next: AndroidTournamentDocument, stage: String, seat: AndroidSeatTarget?, playerId: String): AndroidTournamentDocument {
        if (seat == null) return next
        val plan = androidSeatMovePlan(next, stage, playerId, seat.groupId, seat.ownerPlayerId, seat.switchType, seat.seatNumber)
        return applyPlan(activeClient, next, stage, plan)
    }
    fun boardAddKnownPlayer(stage: String, seat: AndroidSeatTarget, playerId: String, ns1: Boolean, ns2: Boolean, park: Boolean) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament {
            val next = activeClient.importParticipants(
                selected.summary.tournamentId, selected.summary.revision,
                listOf(AndroidParticipantImportRow(playerId, attendance = "present", hasSwitch1 = ns1, hasSwitch2 = ns2)),
            )
            seatAfter(activeClient, next, stage, if (park) null else seat, playerId)
        }
    }
    fun boardSeatCandidate(choice: AndroidBoardRosterChoice, candidate: AndroidRosterCandidate) {
        boardChoice = null
        boardAddKnownPlayer(choice.stage, choice.seat, candidate.playerId, choice.ns1, choice.ns2, choice.park)
    }
    fun boardCreateAndSeat(
        stage: String, seat: AndroidSeatTarget, name: String, ns1: Boolean, ns2: Boolean, park: Boolean,
        confirmSameName: Boolean,
    ) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament {
            val created = activeClient.createRosterPlayers(
                listOf(AndroidRosterPlayerRequest(1, name, confirmSameName)), selected.summary.tournamentId,
            ).getOrThrow().first()
            val loaded = activeClient.load(selected.summary.tournamentId)
            val next = activeClient.importParticipants(
                loaded.summary.tournamentId, loaded.summary.revision,
                listOf(AndroidParticipantImportRow(created.playerId, attendance = "present", hasSwitch1 = ns1, hasSwitch2 = ns2)),
            )
            seatAfter(activeClient, next, stage, if (park) null else seat, created.playerId)
        }
    }
    /** ADR-0218: a typed name Players already carry shows them first; only "new" creates. */
    fun boardAddNewPlayer(stage: String, seat: AndroidSeatTarget, name: String, ns1: Boolean, ns2: Boolean, park: Boolean) {
        val selected = document ?: return
        val activeClient = client ?: return
        if (loading) return
        loading = true
        error = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    activeClient.rosterCandidates(listOf(name), selected.summary.tournamentId, partial = false).first()
                }
            }.onSuccess { entry ->
                loading = false
                if (entry.candidates.isEmpty() && !installationSettings.directorsMayCreatePlayers) {
                    error = androidPlayerCreationClosedMessage(language)
                } else if (entry.candidates.isEmpty()) {
                    boardCreateAndSeat(stage, seat, name, ns1, ns2, park, confirmSameName = false)
                } else {
                    boardChoice = AndroidBoardRosterChoice(stage, seat, ns1, ns2, park, entry)
                }
            }.onFailure {
                loading = false
                error = androidText(
                    language,
                    "The Players with this name could not be looked up.",
                    "De spelers met deze naam konden niet worden opgezocht.",
                )
            }
        }
    }
    fun boardPlaceStation(stage: String, groupId: String, slotIndex: Int, ownerId: String, switchType: String) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament { applyPlan(activeClient, selected, stage, androidPlaceStationPlan(selected, stage, ownerId, switchType, groupId, slotIndex)) }
    }
    fun boardAddNewStation(stage: String, groupId: String, slotIndex: Int, ownerId: String, switchType: String, park: Boolean) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament {
            val next = activeClient.importParticipants(
                selected.summary.tournamentId, selected.summary.revision,
                listOf(
                    if (switchType == "ns2") AndroidParticipantImportRow(ownerId, hasSwitch2 = true)
                    else AndroidParticipantImportRow(ownerId, hasSwitch1 = true),
                ),
            )
            if (park) next else applyPlan(activeClient, next, stage, androidPlaceStationPlan(next, stage, ownerId, switchType, groupId, slotIndex))
        }
    }
    fun boardRemovePlayer(stage: String, playerId: String, dropSwitches: Boolean) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament {
            val inGroup = selected.groups.any { group -> group.stage == stage && group.members.any { it.playerId == playerId } }
            val after = if (inGroup) applyPlan(activeClient, selected, stage, androidParkPlayerPlan(selected, stage, playerId)) else selected
            activeClient.importParticipants(
                after.summary.tournamentId, after.summary.revision,
                listOf(
                    AndroidParticipantImportRow(
                        playerId, attendance = "absent",
                        hasSwitch1 = if (dropSwitches) false else null,
                        hasSwitch2 = if (dropSwitches) false else null,
                    ),
                ),
            )
        }
    }
    fun boardRemoveStation(stage: String, ownerId: String, switchType: String) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament {
            val key = "$ownerId|$switchType"
            val inGroup = selected.groups.any { group ->
                group.stage == stage && androidGroupSlots(group).any { "${it.stationOwnerPlayerId}|${it.switchType}" == key }
            }
            val after = if (inGroup) applyPlan(activeClient, selected, stage, androidParkStationPlan(selected, stage, ownerId, switchType)) else selected
            activeClient.importParticipants(
                after.summary.tournamentId, after.summary.revision,
                listOf(
                    if (switchType == "ns2") AndroidParticipantImportRow(ownerId, hasSwitch2 = false)
                    else AndroidParticipantImportRow(ownerId, hasSwitch1 = false),
                ),
            )
        }
    }
    fun boardParkStation(stage: String, ownerId: String, switchType: String) {
        val selected = document ?: return
        val activeClient = client ?: return
        mutateTournament { applyPlan(activeClient, selected, stage, androidParkStationPlan(selected, stage, ownerId, switchType)) }
    }

    fun addParticipantByName(name: String) {
        val activeClient = client ?: return
        val selected = document ?: return
        loading = true
        error = null
        rosterNotice = null
        scope.launch {
            // ADR-0218: a typed name never adds anybody by itself. The Players
            // it may mean are shown with their context beside "new Player",
            // and only the Director's tap links one of them to this night.
            runCatching {
                withContext(Dispatchers.IO) {
                    activeClient.rosterCandidates(listOf(name), selected.summary.tournamentId, partial = true).first()
                }
            }.onSuccess { entry ->
                participantAdd = AndroidParticipantAdd.Choose(entry)
            }.onFailure { rosterNotice = androidText(language, "The participant could not be added.", "Deelnemer kon niet worden toegevoegd.") }
            loading = false
        }
    }

    /** ADR-0218: the Director picked this Player for the typed name. */
    fun pickParticipantCandidate(candidate: AndroidRosterCandidate) {
        val activeClient = client ?: return
        val selected = document ?: return
        participantAdd = null
        mutateTournament {
            activeClient.addParticipant(selected.summary.tournamentId, selected.summary.revision, candidate.playerId)
        }
    }

    /** ADR-0218: the Director chose "new Player"; the derived username is shown before anything is created. */
    fun offerParticipantCreation(confirmSameName: Boolean) {
        val choosing = participantAdd as? AndroidParticipantAdd.Choose ?: return
        val name = choosing.entry.name
        val username = androidRosterUsernameFor(name)
        participantAdd = if (username == null) {
            AndroidParticipantAdd.Failed(
                androidText(
                    language,
                    "\"$name\" does not produce a usable username. Use letters and numbers.",
                    "\"$name\" levert geen bruikbare gebruikersnaam op. Gebruik letters en cijfers.",
                ),
            )
        } else {
            AndroidParticipantAdd.Confirm(name, username, confirmSameName)
        }
    }

    fun markSwitchOwnersBulk(count: Int, switchType: String) {
        val activeClient = client ?: return
        val selected = document ?: return
        if (count <= 0) return
        val wantsNs2 = switchType == "ns2"
        mutateTournament {
            var current = selected
            val targets = current.participants
                .filter { it.attendance == ATTENDANCE_PRESENT && if (wantsNs2) !it.hasSwitch2 else !it.hasSwitch1 }
                .sortedBy { it.seedRank ?: Int.MAX_VALUE }
                .take(count)
            if (targets.isEmpty()) return@mutateTournament current
            activeClient.importParticipants(
                current.summary.tournamentId,
                current.summary.revision,
                targets.map { participant ->
                    AndroidParticipantImportRow(
                        playerId = participant.playerId,
                        hasSwitch1 = if (wantsNs2) participant.hasSwitch1 else true,
                        hasSwitch2 = if (wantsNs2) true else participant.hasSwitch2,
                    )
                },
            )
        }
    }

    fun setAttendanceBulk(playerIds: List<String>, attendance: String) {
        val activeClient = client ?: return
        val selected = document ?: return
        if (playerIds.isEmpty()) return
        mutateTournament {
            val rows = playerIds.mapNotNull { playerId ->
                val participant = selected.participants.firstOrNull { it.playerId == playerId }
                    ?: return@mapNotNull null
                if (participant.attendance == attendance) null
                else AndroidParticipantImportRow(playerId = playerId, attendance = attendance)
            }
            if (rows.isEmpty()) selected
            else activeClient.importParticipants(selected.summary.tournamentId, selected.summary.revision, rows)
        }
    }

    /**
     * ADR-0177 decisions 8 and 10 with ADR-0218: the rows of a roster file,
     * each with the Player the Director chose for it, applied in one pass.
     * Rows that already match the roster cost nothing; a file that changes
     * nothing sends no write.
     */
    fun applyRosterChoices(
        rows: List<AndroidRosterCsvRow>,
        chosen: Map<Int, String>,
        createdCount: Int,
        remember: List<Pair<String, String>>,
    ) {
        val activeClient = client
        val selected = document
        if (activeClient == null || selected == null) {
            loading = false
            return
        }
        rosterImport = AndroidRosterImport.Working(androidText(language, "Importing…", "Bezig met importeren…"))
        loading = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val current = activeClient.load(selected.summary.tournamentId)
                    var updated = 0
                    var added = 0
                    val pending = linkedMapOf<String, AndroidParticipantImportRow>()
                    for (row in rows) {
                        val playerId = chosen[row.row] ?: continue
                        if (pending.containsKey(playerId)) continue
                        val participant = current.participants.firstOrNull { it.playerId == playerId }
                        if (participant == null) {
                            added += 1
                        } else if (participant.attendance == row.attendance &&
                            participant.hasSwitch1 == row.hasSwitch1 &&
                            participant.hasSwitch2 == row.hasSwitch2
                        ) {
                            continue
                        }
                        updated += 1
                        pending[playerId] = AndroidParticipantImportRow(
                            playerId = playerId,
                            attendance = row.attendance,
                            hasSwitch1 = row.hasSwitch1,
                            hasSwitch2 = row.hasSwitch2,
                        )
                    }
                    // Every row that differs from the roster travels in one
                    // request; a file that changes nothing sends none.
                    val applied = if (pending.isEmpty()) current
                    else activeClient.importParticipants(
                        current.summary.tournamentId, current.summary.revision, pending.values.toList(),
                    )
                    // A spelling the Director chose a Player for becomes their
                    // own alias; losing it never undoes the import.
                    val remembered = runCatching {
                        activeClient.rememberRosterAliases(current.summary.tournamentId, remember)
                    }.getOrDefault(0)
                    listOf(updated - added, added, remembered) to applied
                }
            }.onSuccess { (counts, updatedDocument) ->
                document = updatedDocument
                rosterImport = AndroidRosterImport.Applied(counts[0], createdCount, counts[1], counts[2])
            }.onFailure {
                rosterImport = AndroidRosterImport.Failed(androidText(language, "The import could not be applied.", "De import kon niet worden toegepast."))
            }
            loading = false
        }
    }

    fun startRosterImport(text: String) {
        val activeClient = client ?: return
        val selected = document ?: return
        when (val parsed = androidParseRosterCsv(text, language)) {
            is AndroidRosterCsvParse.Failed -> rosterImport = AndroidRosterImport.Failed(parsed.message)
            is AndroidRosterCsvParse.Parsed -> {
                rosterImport = AndroidRosterImport.Working(androidText(language, "Checking names…", "Namen controleren…"))
                loading = true
                scope.launch {
                    // ADR-0218: a name in a file is never an identity. Every row
                    // gets the Players its name may mean and waits for the
                    // Director's choice; nothing is written before "apply".
                    runCatching {
                        withContext(Dispatchers.IO) {
                            activeClient.rosterCandidates(
                                parsed.rows.map { it.displayName }, selected.summary.tournamentId, partial = true,
                            )
                        }
                    }.onSuccess { entries ->
                        rosterImport = androidRosterReview(parsed.rows, entries)
                    }.onFailure {
                        rosterImport = AndroidRosterImport.Failed(androidText(language, "The Player list could not be read.", "De spelerslijst kon niet worden gelezen."))
                    }
                    loading = false
                }
            }
        }
    }

    /** ADR-0218: the Director's choice for one import row. */
    fun chooseRosterRow(row: Int, choice: AndroidRosterChoice?) {
        val review = rosterImport as? AndroidRosterImport.Review ?: return
        rosterImport = review.copy(choices = review.choices + (row to choice), secondConfirmation = false)
    }

    fun confirmRosterImport() {
        val activeClient = client ?: return
        val selected = document ?: return
        val review = rosterImport as? AndroidRosterImport.Review ?: return
        if (review.openRows > 0) return
        val picked = review.rows.mapNotNull { row ->
            (review.choices[row.row] as? AndroidRosterChoice.Player)?.let { row.row to it.playerId }
        }
        if (picked.map { it.second }.toSet().size != picked.size) {
            rosterImport = AndroidRosterImport.Failed(
                androidText(
                    language,
                    "The same Player is chosen for two rows. A Player may appear once.",
                    "Dezelfde speler is voor twee regels gekozen. Een speler mag één keer voorkomen.",
                ),
            )
            return
        }
        val creating = review.rows.withIndex().filter { (_, row) -> review.choices[row.row] == AndroidRosterChoice.New }
        if (creating.isNotEmpty() && !review.secondConfirmation) {
            rosterImport = review.copy(secondConfirmation = true)
            return
        }
        val remember = androidRosterAliasesToRemember(review.rows.withIndex().mapNotNull { (index, row) ->
            val choice = review.choices[row.row] as? AndroidRosterChoice.Player ?: return@mapNotNull null
            review.entries.getOrNull(index)?.candidates?.firstOrNull { it.playerId == choice.playerId }
                ?.let { row.displayName to it }
        })
        if (creating.isEmpty()) {
            applyRosterChoices(review.rows, picked.toMap(), createdCount = 0, remember = remember)
            return
        }
        rosterImport = AndroidRosterImport.Working(androidText(language, "Creating new Players…", "Nieuwe spelers aanmaken…"))
        loading = true
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                activeClient.createRosterPlayers(
                    creating.map { (index, row) ->
                        AndroidRosterPlayerRequest(
                            row.row, row.displayName,
                            confirmSameName = review.entries.getOrNull(index)?.sameNameInOwnNights == true,
                        )
                    },
                    selected.summary.tournamentId,
                )
            }
            outcome.onSuccess { created ->
                // The batch answers in the order it was asked, one Player per row.
                val chosen = picked.toMap().toMutableMap()
                creating.forEachIndexed { position, (_, row) ->
                    created.getOrNull(position)?.let { chosen[row.row] = it.playerId }
                }
                applyRosterChoices(review.rows, chosen, created.size, remember)
            }.onFailure { failure ->
                loading = false
                val rejections = (failure as? AndroidTournamentClientException)?.rejections.orEmpty()
                rosterImport = AndroidRosterImport.Failed(
                    if (androidPlayerCreationRefused(failure)) androidPlayerCreationClosedMessage(language)
                    else if (rejections.isEmpty()) androidText(language, "The new Players could not be created.", "De nieuwe spelers konden niet worden aangemaakt.")
                    else androidRosterRejectionMessage(rejections, language),
                )
            }
        }
    }

    /**
     * ADR-0177 decision 11: creates the confirmed Player through the same batch
     * route the CSV import uses, then seats them in this Tournament. A rejection
     * writes nothing and reports why, exactly as the import does.
     */
    fun confirmParticipantAdd() {
        val activeClient = client ?: return
        val selected = document ?: return
        val pending = participantAdd as? AndroidParticipantAdd.Confirm ?: return
        participantAdd = AndroidParticipantAdd.Working(androidText(language, "Creating Player…", "Speler aanmaken…"))
        loading = true
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                activeClient.createRosterPlayers(
                    listOf(AndroidRosterPlayerRequest(1, pending.displayName, pending.confirmSameName)),
                    selected.summary.tournamentId,
                )
            }
            outcome.onSuccess { created ->
                val player = created.firstOrNull()
                if (player == null) {
                    loading = false
                    participantAdd = AndroidParticipantAdd.Failed(androidText(language, "The Player was not created.", "De speler is niet aangemaakt."))
                    return@onSuccess
                }
                runCatching {
                    withContext(Dispatchers.IO) {
                        val current = activeClient.load(selected.summary.tournamentId)
                        activeClient.addParticipant(
                            current.summary.tournamentId, current.summary.revision, player.playerId,
                        )
                    }
                }.onSuccess { updatedDocument ->
                    document = updatedDocument
                    participantAdd = AndroidParticipantAdd.Created(player.displayName, player.username)
                }.onFailure {
                    participantAdd = AndroidParticipantAdd.Failed(
                        androidText(
                            language,
                            "${player.displayName} was created, but could not be added to this Tournament.",
                            "${player.displayName} is aangemaakt, maar kon niet aan dit toernooi worden toegevoegd.",
                        ),
                    )
                }
                loading = false
            }.onFailure { failure ->
                loading = false
                val rejections = (failure as? AndroidTournamentClientException)?.rejections.orEmpty()
                participantAdd = AndroidParticipantAdd.Failed(
                    if (androidPlayerCreationRefused(failure)) androidPlayerCreationClosedMessage(language)
                    else if (rejections.isEmpty()) androidText(language, "The Player could not be created.", "De speler kon niet worden aangemaakt.")
                    else androidRosterRejectionMessage(rejections, language),
                )
            }
        }
    }

    /** Reload the Tournament and its pending Live/Processor evidence. */
    fun refreshIncoming() {
        loading = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val id = requireNotNull(document).summary.tournamentId
                    client!!.load(id) to client.incoming(id)
                }
            }
                .onSuccess { (detail, pending) -> document = detail; incoming = pending; error = null }
                .onFailure { error = androidText(language, "Incoming results could not be refreshed.", "Binnenkomende uitslagen konden niet worden vernieuwd.") }
            loading = false
        }
    }

    /** Delete the loaded draft and return to the chooser, as the workbench does. */
    /**
     * Owner decision 2026-08-28: removing a Tournament hides it rather than
     * destroying it. It leaves every list, the activity window and the results,
     * and comes out of TrueSkill, but the record survives so an administrator
     * can restore it. That is why this is offered for any Tournament of the
     * director's, not only an empty draft.
     */
    fun removeCurrentTournament() {
        val activeClient = client ?: return
        val selected = document?.summary ?: return
        loading = true
        error = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    activeClient.removeTournament(
                        selected.tournamentId,
                        "Verwijderd door de toernooidirecteur in de app",
                    )
                    activeClient.list()
                }
            }.onSuccess { list ->
                tournaments = list
                document = null
                incoming = emptyList()
            }.onFailure {
                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
            }
            loading = false
        }
    }

    LaunchedEffect(client, initialTournamentId) { loadDirectors() }
    // The aliases used to be fetched only when a Tournament was picked from the
    // list. Reaching Step 5 or 9 any other way - resuming, refreshing, coming
    // back after an apply - left the map empty, and the workbook then matched on
    // display names alone: the in-game handle no longer found its Player. They
    // are loaded for whichever Tournament is open.
    LaunchedEffect(client, document?.summary?.tournamentId) {
        if (document?.summary != null) { loadPlayerAliases() }
    }
    val pollLifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(client, document?.summary?.tournamentId, document?.summary?.workflowStep) {
        val selected = document?.summary ?: return@LaunchedEffect
        if (selected.workflowStep != 5 && selected.workflowStep != 9) return@LaunchedEffect
        // The feed is polled because race-day results arrive from another
        // client, but a fixed 5 s loop kept asking while the phone was in the
        // operator's pocket. repeatOnLifecycle stops it when the screen is not
        // resumed and restarts it - with a fresh read - when it comes back, and
        // the interval backs off over quiet polls that any change resets. The
        // Web feed does the same, so the two clients behave alike.
        pollLifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var quietPolls = 0
            while (true) {
                delay(if (quietPolls >= ANDROID_POLL_QUIET_BEFORE_BACK_OFF) ANDROID_POLL_SLOW_MS else ANDROID_POLL_FAST_MS)
                runCatching { withContext(Dispatchers.IO) { client?.incoming(selected.tournamentId).orEmpty() } }
                    .onSuccess { latest ->
                        if (latest == incoming) { quietPolls += 1 } else { quietPolls = 0; incoming = latest }
                    }
            }
        }
    }
    // A07 (Phase 14): the console is drawn inside the design system's own
    // theme, in the appearance the operator chose, so the step palette, the
    // type and the surfaces come from the generated tokens. Presentation only:
    // every step, gate, blocker and confirmation below is exactly as it was,
    // because OD-09 - the recorded Director walkthrough - has not happened.
    Mk8dxDesignTheme(Mk8dxDesignTheme.appearance) {
    // The console is reached from the overview now, so it needs a way back to
    // it. Without one the tab would be a one-way door.
    Column(modifier.background(Mk8dxDesignTheme.colors.surfaceApp)) {
        TextButton(onClick = onLeaveConsole, modifier = Modifier.padding(start = 8.dp, top = 4.dp)) {
            Text(
                androidText("← Tournaments", "← Toernooien"),
                color = TextSoft,
                style = Mk8dxDesignTheme.type.label.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
            )
        }
    when {
        client == null -> TournamentSignIn(onSignIn, modifier)
        !directorConfirmed && loading -> TournamentLoading(modifier)
        !directorConfirmed && error != null -> TournamentError(requireNotNull(error), ::loadDirectors, modifier)
        !directorConfirmed -> TournamentDirectorStep(
            directors = directors,
            canActForOthers = canActForOthers,
            selectedDirector = selectedDirector,
            onDirectorSelected = { selectedDirector = it },
            onContinue = {
                directorConfirmed = true
                loadTournaments()
            },
            modifier = modifier,
        )
        loading && document == null && tournaments.isEmpty() -> TournamentLoading(modifier)
        error != null && document == null && tournaments.isEmpty() -> TournamentError(requireNotNull(error), ::loadTournaments, modifier)
        // Step 9 reuses the same score screen for the final groups.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 9 -> TournamentScoreEntryStep(
            document = requireNotNull(document),
            stage = "final",
            stepNumber = 9,
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 8 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = { pendingRemoval = true },
            playerAliases = playerAliases,
            onImportRaces = ::importWorkbookRaces,
            onExportWorkbook = { shareWorkbook("final") },
            onSaveScores = { groupId, segments, scores ->
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setManualScores(
                        selected.tournamentId, selected.revision, groupId, segments, scores,
                    )
                }
            },
            onTieModeChange = { stage, mode ->
                val selected = requireNotNull(document).summary
                mutateTournament { client.updateTieBreakMode(selected.tournamentId, selected.revision, stage, mode) }
            },
            onTieOrderSave = { groupId, points, playerIds ->
                val selected = requireNotNull(document).summary
                mutateTournament { client.setTieBreakOrder(selected.tournamentId, selected.revision, groupId, points, playerIds) }
            },
            onContinue = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setWorkflowStep(selected.tournamentId, selected.revision, 10, "advance")
                }
            },
            incomingContent = {
                // The ecosystem polls Live/Processor evidence in Step 5 and 9;
                // porting the source score screen must not drop it. The document can
                // already be cleared while this list is recomposing, for example right
                // after a draft is deleted, so this must not require it.
                document?.let { loaded ->
                    incomingItems(loaded, incoming, loading, client) { refreshIncoming() }
                }
            },
            modifier = modifier,
        )

        // Step 10 is the source results export plus this ecosystem's finalization.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 10 -> TournamentResultsExportStep(
            document = requireNotNull(document),
            stage = "final",
            stepNumber = 10,
            onExportWorkbook = { shareWorkbook("final") },
            onExportQualifierWorkbook = { shareWorkbook("qualifier") },
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 9 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = { pendingRemoval = true },
            onShare = { text ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Uitslag",
                            )
                            putExtra(Intent.EXTRA_TEXT, text)
                        },
                        androidText(language, "Share results", "Deel uitslag"),
                    ),
                )
            },
            onContinue = null,
            finalizeContent = {
                document?.let { loaded ->
                    item {
                        TournamentLifecycleControls(loaded, loading, client) { work ->
                            mutateTournament(work)
                        }
                    }
                }
            },
            onShareImage = ::shareExportCheckpoint,
            onDownloadImage = ::downloadExportCheckpoint,
            modifier = modifier,
        )

        // Step 6 is the source Manager's results export.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 6 -> TournamentResultsExportStep(
            document = requireNotNull(document),
            stage = "qualifier",
            stepNumber = 6,
            onExportWorkbook = { shareWorkbook("qualifier") },
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 5 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = { pendingRemoval = true },
            onShare = { text ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Uitslag",
                            )
                            putExtra(Intent.EXTRA_TEXT, text)
                        },
                        androidText(language, "Share results", "Deel uitslag"),
                    ),
                )
            },
            onContinue = {
                val selected = requireNotNull(document).summary
                // generateGroups already moves the Tournament to Step 7.
                mutateTournament {
                    client.generateGroups(selected.tournamentId, selected.revision, "final")
                }
            },
            onShareImage = ::shareExportCheckpoint,
            onDownloadImage = ::downloadExportCheckpoint,
            modifier = modifier,
        )

        // Step 8 reuses the same export for the final layout.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 8 -> TournamentLayoutExportStep(
            document = requireNotNull(document),
            stage = "final",
            stepNumber = 8,
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 7 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = requireNotNull(document).let { loaded ->
                // The workbench guard, kept: a draft may only be deleted before races.
                if (loaded.summary.stage == "finalized" ||
                    loaded.groups.any { it.races.isNotEmpty() }
                ) {
                    null
                } else {
                    {
                        // The proven workbench behaviour, now a removal rather
                        // than a destruction: hide it, then return to the chooser
                        // with a freshly listed set of Tournaments.
                        loading = true
                        error = null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    client.removeTournament(
                                        loaded.summary.tournamentId,
                                        "Verwijderd door de toernooidirecteur in de app",
                                    )
                                    client.list()
                                }
                            }.onSuccess { list ->
                                tournaments = list
                                document = null
                                incoming = emptyList()
                            }.onFailure {
                                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                            }
                            loading = false
                        }
                    }
                }
            },
            onShare = { text ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Eindgroep-indeling",
                            )
                            putExtra(Intent.EXTRA_TEXT, text)
                        },
                        androidText(language, "Share layout", "Deel indeling"),
                    ),
                )
            },
            onContinue = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setWorkflowStep(selected.tournamentId, selected.revision, 9, "advance")
                }
            },
            onShareImage = ::shareExportCheckpoint,
            onDownloadImage = ::downloadExportCheckpoint,
            modifier = modifier,
        )

        // Step 7 reuses the same board for the final groups.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 7 -> TournamentGroupDraftStep(
            document = requireNotNull(document),
            stage = "final",
            stepNumber = 7,
            busy = loading,
            error = error,
            notice = rosterNotice,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 6 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = requireNotNull(document).let { loaded ->
                // The workbench guard, kept: a draft may only be deleted before races.
                if (loaded.summary.stage == "finalized" ||
                    loaded.groups.any { it.races.isNotEmpty() }
                ) {
                    null
                } else {
                    {
                        // The proven workbench behaviour, now a removal rather
                        // than a destruction: hide it, then return to the chooser
                        // with a freshly listed set of Tournaments.
                        loading = true
                        error = null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    client.removeTournament(
                                        loaded.summary.tournamentId,
                                        "Verwijderd door de toernooidirecteur in de app",
                                    )
                                    client.list()
                                }
                            }.onSuccess { list ->
                                tournaments = list
                                document = null
                                incoming = emptyList()
                            }.onFailure {
                                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                            }
                            loading = false
                        }
                    }
                }
            },
            onMovePlayer = { playerId, targetGroupId ->
                val selected = requireNotNull(document)
                mutateTournament {
                    client.updateGroups(
                        selected.summary.tournamentId, selected.summary.revision, "final",
                        tournamentGroupsAfterMove(selected.groups, "final", playerId, targetGroupId),
                    )
                }
            },
            allowFinalGroupOverride = canActForOthers,
            onSwapPlayers = { firstPlayerId, secondPlayerId ->
                val selected = requireNotNull(document)
                mutateTournament {
                    client.updateGroups(
                        selected.summary.tournamentId,
                        selected.summary.revision,
                        "final",
                        tournamentGroupsAfterSwap(
                            selected.groups, "final", firstPlayerId, secondPlayerId,
                        ),
                    )
                }
            },
            onSeatPlayer = { playerId, targetGroupId, ownerId, switchType, seatNumber ->
                val selected = requireNotNull(document)
                val plan = androidSeatMovePlan(
                    selected, "final", playerId, targetGroupId, ownerId, switchType, seatNumber,
                )
                mutateTournament {
                    val revision = if (plan.membershipChanged) {
                        client.updateGroups(
                            selected.summary.tournamentId, selected.summary.revision, "final", plan.memberships,
                        ).summary.revision
                    } else {
                        selected.summary.revision
                    }
                    client.importGroupLayout(selected.summary.tournamentId, revision, "final", plan.layout)
                }
            },
            onConfirmPlacement = {
                val selected = requireNotNull(document).summary
                // lockGroups already moves the Tournament to Step 4; advancing as
                // well would skip the export step entirely.
                mutateTournament {
                    client.lockGroups(selected.tournamentId, selected.revision, "final", true)
                }
            },
            onReopenPlacement = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.lockGroups(selected.tournamentId, selected.revision, "final", false)
                }
            },
            onExportCsv = { csv ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/csv"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Stap 7 indeling",
                            )
                            putExtra(Intent.EXTRA_TEXT, csv)
                        },
                        androidText(language, "Export layout", "Exporteer indeling"),
                    ),
                )
            },
            onImportCsvText = { text -> startLayoutImport("final", text) },
            onAddKnownPlayer = { seat, playerId, ns1, ns2, park -> boardAddKnownPlayer("final", seat, playerId, ns1, ns2, park) },
            onAddNewPlayer = { seat, name, ns1, ns2, park -> boardAddNewPlayer("final", seat, name, ns1, ns2, park) },
            onPlaceStation = { groupId, slotIndex, ownerId, switchType -> boardPlaceStation("final", groupId, slotIndex, ownerId, switchType) },
            onAddNewStation = { groupId, slotIndex, ownerId, switchType, park -> boardAddNewStation("final", groupId, slotIndex, ownerId, switchType, park) },
            onRemovePlayer = { playerId, dropSwitches -> boardRemovePlayer("final", playerId, dropSwitches) },
            onRemoveStation = { ownerId, switchType -> boardRemoveStation("final", ownerId, switchType) },
            onParkStation = { ownerId, switchType -> boardParkStation("final", ownerId, switchType) },
            modifier = modifier,
        )

        // Step 5 is the source Manager's qualifier score entry.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 5 -> TournamentScoreEntryStep(
            document = requireNotNull(document),
            stage = "qualifier",
            stepNumber = 5,
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 4 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = requireNotNull(document).let { loaded ->
                // The workbench guard, kept: a draft may only be deleted before races.
                if (loaded.summary.stage == "finalized" ||
                    loaded.groups.any { it.races.isNotEmpty() }
                ) {
                    null
                } else {
                    {
                        // The proven workbench behaviour, now a removal rather
                        // than a destruction: hide it, then return to the chooser
                        // with a freshly listed set of Tournaments.
                        loading = true
                        error = null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    client.removeTournament(
                                        loaded.summary.tournamentId,
                                        "Verwijderd door de toernooidirecteur in de app",
                                    )
                                    client.list()
                                }
                            }.onSuccess { list ->
                                tournaments = list
                                document = null
                                incoming = emptyList()
                            }.onFailure {
                                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                            }
                            loading = false
                        }
                    }
                }
            },
            playerAliases = playerAliases,
            onImportRaces = ::importWorkbookRaces,
            onExportWorkbook = { shareWorkbook("qualifier") },
            onSaveScores = { groupId, segments, scores ->
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setManualScores(
                        selected.tournamentId, selected.revision, groupId, segments, scores,
                    )
                }
            },
            onTieModeChange = { stage, mode ->
                val selected = requireNotNull(document).summary
                mutateTournament { client.updateTieBreakMode(selected.tournamentId, selected.revision, stage, mode) }
            },
            onTieOrderSave = { groupId, points, playerIds ->
                val selected = requireNotNull(document).summary
                mutateTournament { client.setTieBreakOrder(selected.tournamentId, selected.revision, groupId, points, playerIds) }
            },
            onContinue = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setWorkflowStep(selected.tournamentId, selected.revision, 6, "advance")
                }
            },
            incomingContent = {
                // The ecosystem polls Live/Processor evidence in Step 5 and 9;
                // porting the source score screen must not drop it. The document can
                // already be cleared while this list is recomposing, for example right
                // after a draft is deleted, so this must not require it.
                document?.let { loaded ->
                    incomingItems(loaded, incoming, loading, client) { refreshIncoming() }
                }
            },
            modifier = modifier,
        )

        // Step 4 is the source Manager's qualifier layout export and audit.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 4 -> TournamentLayoutExportStep(
            document = requireNotNull(document),
            stage = "qualifier",
            stepNumber = 4,
            busy = loading,
            error = error,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 3 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = requireNotNull(document).let { loaded ->
                // The workbench guard, kept: a draft may only be deleted before races.
                if (loaded.summary.stage == "finalized" ||
                    loaded.groups.any { it.races.isNotEmpty() }
                ) {
                    null
                } else {
                    {
                        // The proven workbench behaviour, now a removal rather
                        // than a destruction: hide it, then return to the chooser
                        // with a freshly listed set of Tournaments.
                        loading = true
                        error = null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    client.removeTournament(
                                        loaded.summary.tournamentId,
                                        "Verwijderd door de toernooidirecteur in de app",
                                    )
                                    client.list()
                                }
                            }.onSuccess { list ->
                                tournaments = list
                                document = null
                                incoming = emptyList()
                            }.onFailure {
                                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                            }
                            loading = false
                        }
                    }
                }
            },
            onShare = { text ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Kwalificatie-indeling",
                            )
                            putExtra(Intent.EXTRA_TEXT, text)
                        },
                        androidText(language, "Share layout", "Deel indeling"),
                    ),
                )
            },
            onContinue = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.setWorkflowStep(selected.tournamentId, selected.revision, 5, "advance")
                }
            },
            onShareImage = ::shareExportCheckpoint,
            onDownloadImage = ::downloadExportCheckpoint,
            modifier = modifier,
        )

        // Step 3 is the source Manager's qualifier layout board.
        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep == 3 -> TournamentGroupDraftStep(
            document = requireNotNull(document),
            stage = "qualifier",
            stepNumber = 3,
            busy = loading,
            error = error,
            notice = rosterNotice,
            onHome = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onBack = { pendingRollback = 2 },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onLeave = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onDelete = requireNotNull(document).let { loaded ->
                // The workbench guard, kept: a draft may only be deleted before races.
                if (loaded.summary.stage == "finalized" ||
                    loaded.groups.any { it.races.isNotEmpty() }
                ) {
                    null
                } else {
                    {
                        // The proven workbench behaviour, now a removal rather
                        // than a destruction: hide it, then return to the chooser
                        // with a freshly listed set of Tournaments.
                        loading = true
                        error = null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    client.removeTournament(
                                        loaded.summary.tournamentId,
                                        "Verwijderd door de toernooidirecteur in de app",
                                    )
                                    client.list()
                                }
                            }.onSuccess { list ->
                                tournaments = list
                                document = null
                                incoming = emptyList()
                            }.onFailure {
                                error = androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                            }
                            loading = false
                        }
                    }
                }
            },
            onMovePlayer = { playerId, targetGroupId ->
                val selected = requireNotNull(document)
                mutateTournament {
                    client.updateGroups(
                        selected.summary.tournamentId, selected.summary.revision, "qualifier",
                        tournamentGroupsAfterMove(selected.groups, "qualifier", playerId, targetGroupId),
                    )
                }
            },
            onSwapPlayers = { firstPlayerId, secondPlayerId ->
                val selected = requireNotNull(document)
                mutateTournament {
                    client.updateGroups(
                        selected.summary.tournamentId,
                        selected.summary.revision,
                        "qualifier",
                        tournamentGroupsAfterSwap(
                            selected.groups, "qualifier", firstPlayerId, secondPlayerId,
                        ),
                    )
                }
            },
            onSeatPlayer = { playerId, targetGroupId, ownerId, switchType, seatNumber ->
                val selected = requireNotNull(document)
                val plan = androidSeatMovePlan(
                    selected, "qualifier", playerId, targetGroupId, ownerId, switchType, seatNumber,
                )
                mutateTournament {
                    val revision = if (plan.membershipChanged) {
                        client.updateGroups(
                            selected.summary.tournamentId, selected.summary.revision, "qualifier", plan.memberships,
                        ).summary.revision
                    } else {
                        selected.summary.revision
                    }
                    client.importGroupLayout(selected.summary.tournamentId, revision, "qualifier", plan.layout)
                }
            },
            onConfirmPlacement = {
                val selected = requireNotNull(document).summary
                // lockGroups already moves the Tournament to Step 4; advancing as
                // well would skip the export step entirely.
                mutateTournament {
                    client.lockGroups(selected.tournamentId, selected.revision, "qualifier", true)
                }
            },
            onReopenPlacement = {
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.lockGroups(selected.tournamentId, selected.revision, "qualifier", false)
                }
            },
            onExportCsv = { csv ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/csv"
                            putExtra(
                                Intent.EXTRA_SUBJECT,
                                "${requireNotNull(document).summary.name} · Stap 3 indeling",
                            )
                            putExtra(Intent.EXTRA_TEXT, csv)
                        },
                        androidText(language, "Export layout", "Exporteer indeling"),
                    ),
                )
            },
            onImportCsvText = { text -> startLayoutImport("qualifier", text) },
            onAddKnownPlayer = { seat, playerId, ns1, ns2, park -> boardAddKnownPlayer("qualifier", seat, playerId, ns1, ns2, park) },
            onAddNewPlayer = { seat, name, ns1, ns2, park -> boardAddNewPlayer("qualifier", seat, name, ns1, ns2, park) },
            onPlaceStation = { groupId, slotIndex, ownerId, switchType -> boardPlaceStation("qualifier", groupId, slotIndex, ownerId, switchType) },
            onAddNewStation = { groupId, slotIndex, ownerId, switchType, park -> boardAddNewStation("qualifier", groupId, slotIndex, ownerId, switchType, park) },
            onRemovePlayer = { playerId, dropSwitches -> boardRemovePlayer("qualifier", playerId, dropSwitches) },
            onRemoveStation = { ownerId, switchType -> boardRemoveStation("qualifier", ownerId, switchType) },
            onParkStation = { ownerId, switchType -> boardParkStation("qualifier", ownerId, switchType) },
            modifier = modifier,
        )

        document != null &&
            requireNotNull(document).summary.stage != "finalized" &&
            requireNotNull(document).summary.workflowStep <= 2 -> CompositionLocalProvider(
            LocalAndroidInstallationSettings provides installationSettings,
        ) { TournamentParticipantsStep(
            document = requireNotNull(document),
            signupPanel = {
                AndroidTournamentSignupBoardPanel(
                    client,
                    requireNotNull(document).summary.tournamentId,
                    requireNotNull(document).summary.revision,
                )
            },
            busy = loading,
            error = error,
            notice = rosterNotice,
            onBackToStart = {
                document = null
                incoming = emptyList()
                rosterNotice = null
                error = null
            },
            onRefresh = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.load(selected.tournamentId) }
            },
            onSetAttendance = { participant, attendance ->
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.updateParticipant(
                        selected.tournamentId,
                        selected.revision,
                        participant,
                        attendance = attendance,
                    )
                }
            },
            onSetSwitches = { participant, hasSwitch1, hasSwitch2 ->
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.updateParticipant(
                        selected.tournamentId,
                        selected.revision,
                        participant,
                        hasSwitch1 = hasSwitch1,
                        hasSwitch2 = hasSwitch2,
                    )
                }
            },
            onAddParticipant = ::addParticipantByName,
            participantAddState = participantAdd,
            onParticipantAddConfirm = ::confirmParticipantAdd,
            onParticipantAddCancel = { participantAdd = null },
            onParticipantPick = ::pickParticipantCandidate,
            onParticipantCreate = ::offerParticipantCreation,
            onAddRecentParticipants = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.addRecentParticipants(selected.tournamentId, selected.revision) }
            },
            onAddHistoricalParticipants = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.addHistoricalParticipants(selected.tournamentId, selected.revision) }
            },
            onMarkOwnersBulk = ::markSwitchOwnersBulk,
            onSetAttendanceBulk = ::setAttendanceBulk,
            importState = rosterImport,
            onImportCsvText = ::startRosterImport,
            onImportConfirm = ::confirmRosterImport,
            onImportCancel = { rosterImport = null },
            onImportChoose = ::chooseRosterRow,
            onExportCsv = { csv ->
                context.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/csv"
                            putExtra(Intent.EXTRA_SUBJECT, "${requireNotNull(document).summary.name} · Stap 2 deelnemers")
                            putExtra(Intent.EXTRA_TEXT, csv)
                        },
                        androidText(language, "Export participants (CSV)", "Exporteer deelnemers (CSV)"),
                    ),
                )
            },

            // ADR-0177 decision 7: editable only while no groups exist.
            settingsLocked = requireNotNull(document).groups.isNotEmpty(),
            onUpdateSettings = { seedingSource, placementStrategy, ownerSeatingMode, maxParticipants ->
                val selected = requireNotNull(document).summary
                mutateTournament {
                    client.updateSettings(
                        selected.tournamentId, selected.revision,
                        seedingSource, placementStrategy, ownerSeatingMode, maxParticipants,
                    )
                }
            },
            onUpdateVerifiedOnly = { verifiedOnly ->
                val selected = requireNotNull(document).summary
                mutateTournament { client.updateVerifiedOnly(selected.tournamentId, selected.revision, verifiedOnly) }
            },
            onCreateQualifierGroups = {
                val selected = requireNotNull(document).summary
                mutateTournament { client.generateGroups(selected.tournamentId, selected.revision, "qualifier") }
            },
            modifier = modifier,
        ) }
        document != null -> TournamentDocumentScreen(
            document = requireNotNull(document),
            incoming = incoming,
            busy = loading,
            error = error,
            onSelectTournament = { summary ->
                loading = true
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) { client.load(summary.tournamentId) to client.incoming(summary.tournamentId) }
                    }.onSuccess { (detail, pending) -> document = detail; incoming = pending; error = null }
                        .onFailure { error = androidText(language, "Could not load that Tournament.", "Dat toernooi kon niet worden geladen.") }
                    loading = false
                }
            },
            onLeaveTournament = {
                document = null
                incoming = emptyList()
                error = null
            },
            onDeleteTournament = {
                val selected = requireNotNull(document).summary
                loading = true
                error = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            client.deleteDraft(selected.tournamentId, selected.revision)
                            client.list()
                        }
                    }.onSuccess { list ->
                        tournaments = list
                        document = null
                        incoming = emptyList()
                    }.onFailure { failure ->
                        error = if ((failure as? AndroidTournamentClientException)?.statusCode == 409) {
                            androidText(
                                language,
                                "Only a draft without recorded races can be deleted.",
                                "Alleen een concept zonder vastgelegde races kan worden verwijderd.",
                            )
                        } else androidText(language, "The Tournament could not be deleted.", "Het toernooi kon niet worden verwijderd.")
                    }
                    loading = false
                }
            },
            tournaments = tournaments,
            onMutation = { work ->
                loading = true
                error = null
                scope.launch {
                    runCatching { withContext(Dispatchers.IO) { work() } }
                        .onSuccess { updated -> document = updated }
                        .onFailure { failure ->
                            error = if ((failure as? AndroidTournamentClientException)?.statusCode == 409) {
                                androidText(
                                    language,
                                    "The Tournament changed elsewhere. Refresh and try again.",
                                    "Het toernooi is elders gewijzigd. Vernieuw en probeer het opnieuw.",
                                )
                            } else androidText(language, "That change could not be saved.", "Die wijziging kon niet worden opgeslagen.")
                        }
                    loading = false
                }
            },
            onIncomingChanged = ::refreshIncoming,
            client = client,
            onRefresh = ::loadTournaments,
            modifier = modifier,
        )
        else -> TournamentStartStep(
            tournaments = tournaments,
            busy = loading,
            error = error,
            directorDisplayName = directors.firstOrNull { it.userAccountId == selectedDirector }
                ?.displayName.orEmpty(),
            onBackToDirector = { directorConfirmed = false },
            onRefresh = ::loadTournaments,
            onSelectTournament = { summary ->
                loading = true
                error = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            client.load(summary.tournamentId) to client.incoming(summary.tournamentId)
                        }
                    }.onSuccess { (detail, pending) ->
                        document = detail
                        incoming = pending
                        loadPlayerAliases()
                    }.onFailure { error = androidText(language, "Could not load that Tournament.", "Dat toernooi kon niet worden geladen.") }
                    loading = false
                }
            },
            onCreateTournament = ::createTournament,
            modifier = modifier,
        )
    }
    }

    // The backward step itself is performed only after the operator confirms.
    // Reopening a locked layout goes through lockGroups, which moves the step
    // back on its own; every other backward step is a canonical rollback.
    // The backward step itself is performed only after the operator confirms.
    // Reopening a locked layout goes through lockGroups, which moves the step
    // back on its own; every other backward step is a canonical rollback.
    if (pendingRemoval && document != null) {
        TournamentRemoveDialog(
            tournamentName = requireNotNull(document).summary.name,
            onDismiss = { pendingRemoval = false },
            onConfirm = { pendingRemoval = false; removeCurrentTournament() },
        )
    }

    boardChoice?.let { choice ->
        CompositionLocalProvider(LocalAndroidInstallationSettings provides installationSettings) {
            TournamentRosterChoiceDialog(
                entry = choice.entry,
                onPick = { candidate -> boardSeatCandidate(choice, candidate) },
                onCreate = { confirmSameName ->
                    boardChoice = null
                    boardCreateAndSeat(choice.stage, choice.seat, choice.entry.name, choice.ns1, choice.ns2, choice.park, confirmSameName)
                },
                onDismiss = { boardChoice = null },
            )
        }
    }

    val rollbackTarget = pendingRollback
    val rollbackSummary = document?.summary
    val rollbackClient = client
    if (rollbackTarget != null && rollbackSummary != null && rollbackClient != null) {
        TournamentRollbackDialog(
            targetStep = rollbackTarget,
            currentStep = rollbackSummary.workflowStep,
            onDismiss = { pendingRollback = null },
            onConfirm = {
                pendingRollback = null
                rosterNotice = null
                rosterImport = null
                mutateTournament {
                    when (rollbackTarget) {
                        3 -> rollbackClient.lockGroups(
                            rollbackSummary.tournamentId, rollbackSummary.revision, "qualifier", false,
                        )
                        7 -> rollbackClient.lockGroups(
                            rollbackSummary.tournamentId, rollbackSummary.revision, "final", false,
                        )
                        else -> rollbackClient.setWorkflowStep(
                            rollbackSummary.tournamentId, rollbackSummary.revision,
                            rollbackTarget, "rollback",
                        )
                    }
                }
            },
        )
    }
    }
}

@Composable
internal fun TournamentDirectorStep(
    directors: List<AndroidTournamentDirector>,
    canActForOthers: Boolean,
    selectedDirector: String?,
    onDirectorSelected: (String?) -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    var expanded by remember { mutableStateOf(false) }
    val selected = directors.find { it.userAccountId == selectedDirector }
    val selectedLabel = selected?.displayName ?: androidText("Choose director", "Kies directeur")
    val canContinue = selected != null
    val colors = Mk8dxDesignTheme.colors
    val type = Mk8dxDesignTheme.type
    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .testTag("tournament-director-step"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                RaceDirectionRule()
                Text(
                    androidText("MK8DX LAN Tournament Board", "MK8DX LAN Toernooibord"),
                    style = type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                    color = colors.textPrimary,
                    modifier = Modifier.padding(top = 8.dp).semantics { heading() },
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 6.dp),
                ) {
                    Button(
                        onClick = { onDirectorSelected(null) },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.surfaceControl,
                            contentColor = colors.textPrimary,
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .size(48.dp)
                            .testTag("tournament-director-home")
                            .semantics { contentDescription = androidText(language, "Clear director choice", "Directeurkeuze wissen") },
                    ) { Text("\uD83C\uDFE0") }
                    Button(
                        enabled = false,
                        onClick = {},
                        colors = ButtonDefaults.buttonColors(
                            disabledContainerColor = colors.surfaceControl,
                            disabledContentColor = colors.textSecondary,
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .size(48.dp)
                            .testTag("tournament-director-save")
                            .semantics {
                                contentDescription = androidText(language, "Save", "Opslaan")
                                stateDescription = androidText(language, "No Tournament has been loaded yet", "Er is nog geen toernooi geladen")
                            },
                    ) { Text("\uD83D\uDCBE") }
                    Surface(
                        color = colors.surfaceControl,
                        shape = RoundedCornerShape(12.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                        modifier = Modifier.width(156.dp).height(48.dp).testTag("tournament-director-status"),
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 8.dp)) {
                            Text(
                                androidText("No Tournament loaded", "Geen toernooi geladen"),
                                color = colors.textSecondary,
                                style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                            )
                        }
                    }
                }
                Box(Modifier.padding(top = 6.dp)) {
                    StepPhaseMarker(androidText("Step 0 \u00b7 Choose director", "Stap 0 \u00b7 Directeur kiezen"), "tournament-director-phase")
                }
            }
        }
        item {
            Surface(
                color = colors.surfaceRaised,
                shape = RoundedCornerShape(20.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderSubtle),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    Text(
                        androidText("Step 0: Tournament Director", "Stap 0: Toernooi Directeur"),
                        style = type.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Black),
                        color = colors.textPrimary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp, vertical = 8.dp)
                            .semantics { heading() },
                    )
                    Surface(color = colors.surfaceControl, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(horizontal = 14.dp, vertical = 20.dp)) {
                            Text(
                                androidText(
                                    "First choose which Tournament Director works with these tournaments.",
                                    "Kies eerst welke toernooi directeur met deze toernooien werkt.",
                                ),
                                color = colors.textBody,
                                style = type.body.copy(fontSize = 16.sp),
                            )
                            Surface(
                                color = colors.surfaceRaised,
                                shape = RoundedCornerShape(14.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                            ) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        androidText("Step 0: Tournament Director", "Stap 0: Toernooi Directeur"),
                                        style = type.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Black),
                                        color = colors.textPrimary,
                                    )
                                    Text(
                                        if (canActForOthers) androidText("Choose the director you are operating for", "Kies de directeur voor wie je werkt")
                                        else androidText("You are operating as yourself", "Je werkt als jezelf"),
                                        style = type.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
                                        color = colors.textPrimary,
                                    )
                                    Box(Modifier.fillMaxWidth()) {
                                        OutlinedButton(
                                            enabled = directors.isNotEmpty(),
                                            onClick = { expanded = true },
                                            shape = RoundedCornerShape(12.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(
                                                contentColor = colors.textPrimary,
                                                disabledContentColor = colors.textTertiary,
                                            ),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderControl),
                                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                                            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("tournament-director-select"),
                                        ) {
                                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    selectedLabel,
                                                    style = type.body.copy(fontSize = 16.sp),
                                                    modifier = Modifier.weight(1f),
                                                )
                                                Text("\u2304", fontSize = 20.sp, modifier = Modifier.clearAndSetSemantics { })
                                            }
                                        }
                                        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                                            directors.forEach { director ->
                                                DropdownMenuItem(
                                                    text = { Text(director.displayName) },
                                                    onClick = { onDirectorSelected(director.userAccountId); expanded = false },
                                                )
                                            }
                                        }
                                    }
                                    Text(
                                        if (canContinue) {
                                            androidText(
                                                "Active director: $selectedLabel. Step 1 shows only this director's tournaments.",
                                                "Actieve directeur: $selectedLabel. Stap 1 toont alleen toernooien van deze directeur.",
                                            )
                                        } else {
                                            androidText(
                                                "Choose a director first. Step 1 will then show only that director's tournaments.",
                                                "Kies eerst een directeur. Stap 1 toont daarna alleen toernooien van die directeur.",
                                            )
                                        },
                                        color = colors.textSecondary,
                                        style = type.body.copy(fontSize = 16.sp),
                                    )
                                    OutlinedButton(
                                        enabled = canContinue,
                                        onClick = onContinue,
                                        colors = ButtonDefaults.outlinedButtonColors(
                                            contentColor = colors.actionPrimary,
                                            disabledContainerColor = colors.surfaceControl,
                                            disabledContentColor = colors.textTertiary,
                                        ),
                                        border = androidx.compose.foundation.BorderStroke(
                                            1.dp,
                                            if (canContinue) colors.actionPrimary else colors.borderSubtle,
                                        ),
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.fillMaxWidth().height(54.dp).testTag("tournament-director-continue"),
                                    ) {
                                        Text(
                                            androidText("Continue to Step 1", "Verder naar Stap 1"),
                                            style = type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                                        )
                                    }
                                    // ADR-0177 decision 1: the source Manager's PIN existed because that
                                    // page has no accounts. Here authority is the signed-in account.
                                    Text(
                                        androidText(
                                            "Tournament access is linked to your signed-in account, not to a PIN.",
                                            "Toegang tot toernooibediening hangt aan je ingelogde account, niet aan een PIN.",
                                        ),
                                        color = colors.textSecondary,
                                        style = type.bodyS.copy(fontSize = 14.sp),
                                        modifier = Modifier.testTag("tournament-director-access-note"),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Preview(
    name = "Tournament · Stap 0 · telefoon",
    widthDp = 412,
    heightDp = 850,
    showBackground = true,
    backgroundColor = 0xFF09101E,
)
@Composable
internal fun TournamentDirectorStepPreview() {
    Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
        Box(Modifier.background(Mk8dxDesignTheme.colors.surfaceApp)) {
            TournamentDirectorStep(
                directors = listOf(
                    AndroidTournamentDirector("user_account.ben", "Ben", isAdministrator = true),
                    AndroidTournamentDirector("user_account.evan", "Evan"),
                ),
                canActForOthers = true,
                selectedDirector = null,
                onDirectorSelected = {},
                onContinue = {},
                modifier = Modifier,
            )
        }
    }
}

@Composable
private fun TournamentSignIn(onSignIn: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        // English source, Dutch via the shared catalog — this screen used to
        // hardcode Dutch headlines inside an otherwise-English product.
        Text("STEP 0 · DIRECTOR", color = Mk8dxDesignTheme.colors.modeRaceDirection, fontWeight = FontWeight.Black)
        Text("Sign in as the Tournament director", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
        Text(
            "Sign in as a Director to view attendance, seating, stations, groups, standings and incoming results.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        Button(onClick = onSignIn) { Text("Sign in") }
    }
}

@Composable
private fun TournamentLoading(modifier: Modifier) {
    Column(modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        CircularProgressIndicator(color = Mk8dxDesignTheme.colors.actionPrimary)
        Text("Loading Tournament…", modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun TournamentError(message: String, retry: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Tournament unavailable", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 10.dp))
        Button(onClick = retry) { Text("Retry") }
    }
}

@Composable
internal fun TournamentStartStep(
    tournaments: List<AndroidTournamentSummary>,
    busy: Boolean,
    error: String?,
    directorDisplayName: String,
    onBackToDirector: () -> Unit,
    onRefresh: () -> Unit,
    onSelectTournament: (AndroidTournamentSummary) -> Unit,
    onCreateTournament: (String, String, String) -> Unit,
    modifier: Modifier,
    initialName: String = "",
    initialEventDate: String = "",
    initialStartTime: String = "",
) {
    val language = LocalAndroidProductLanguage.current
    val context = LocalContext.current
    var name by remember(initialName) { mutableStateOf(initialName) }
    var eventDate by remember(initialEventDate) { mutableStateOf(initialEventDate) }
    var startTime by remember(initialStartTime) { mutableStateOf(initialStartTime) }
    var selectedTournamentId by remember(tournaments) { mutableStateOf(tournaments.firstOrNull()?.tournamentId) }
    var tournamentMenuExpanded by remember { mutableStateOf(false) }
    var utilityMenuExpanded by remember { mutableStateOf(false) }
    val selectedTournament = tournaments.firstOrNull { it.tournamentId == selectedTournamentId }
    val selectedTournamentLabel = selectedTournament?.let {
        "${it.name} · $directorDisplayName (v${it.revision})"
    } ?: androidText("No tournaments available", "Geen toernooien beschikbaar")

    // ADR-0177: Step 1 asks for both the date and the start time through their
    // native pickers. An empty field falls back to a stated neutral value
    // instead of the moment the Tournament happened to be created.
    fun openTimePicker() {
        val calendar = Calendar.getInstance()
        Regex("(\\d{2}):(\\d{2})").matchEntire(startTime)?.let { match ->
            calendar.set(Calendar.HOUR_OF_DAY, match.groupValues[1].toInt())
            calendar.set(Calendar.MINUTE, match.groupValues[2].toInt())
        }
        TimePickerDialog(
            context,
            { _, hour, minute -> startTime = String.format(Locale.ROOT, "%02d:%02d", hour, minute) },
            calendar.get(Calendar.HOUR_OF_DAY),
            calendar.get(Calendar.MINUTE),
            true,
        ).show()
    }

    fun openDatePicker() {
        val calendar = Calendar.getInstance()
        Regex("(\\d{4})-(\\d{2})-(\\d{2})").matchEntire(eventDate)?.let { match ->
            calendar.set(
                match.groupValues[1].toInt(),
                match.groupValues[2].toInt() - 1,
                match.groupValues[3].toInt(),
            )
        }
        DatePickerDialog(
            context,
            { _, year, month, day -> eventDate = String.format(Locale.ROOT, "%04d-%02d-%02d", year, month + 1, day) },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH),
        ).show()
    }

    fun createTournament() {
        val now = Calendar.getInstance()
        val effectiveDate = eventDate.ifBlank {
            String.format(
                Locale.ROOT,
                "%04d-%02d-%02d",
                now.get(Calendar.YEAR),
                now.get(Calendar.MONTH) + 1,
                now.get(Calendar.DAY_OF_MONTH),
            )
        }
        onCreateTournament(name.trim(), effectiveDate, startTime.ifBlank { "00:00" })
    }

    val colors = Mk8dxDesignTheme.colors
    val type = Mk8dxDesignTheme.type
    val secondaryAction = ButtonDefaults.buttonColors(
        containerColor = colors.surfaceControl,
        contentColor = colors.textPrimary,
    )
    val hairline = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong)
    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .testTag("tournament-start-step"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                RaceDirectionRule()
                Box(Modifier.fillMaxWidth()) {
                    Text(
                        androidText("MK8DX LAN Tournament Board", "MK8DX LAN Toernooibord"),
                        style = type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                        color = colors.textPrimary,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 8.dp)
                            .semantics { heading() },
                    )
                    Box(Modifier.align(Alignment.TopEnd)) {
                        Button(
                            onClick = { utilityMenuExpanded = true },
                            colors = secondaryAction,
                            border = hairline,
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            shape = RoundedCornerShape(9.dp),
                            modifier = Modifier
                                .size(Mk8dxSpacing.targetMin)
                                .testTag("tournament-start-menu")
                                .semantics { contentDescription = androidText(language, "Tournament menu", "Toernooimenu") },
                        ) { Text("☰", fontSize = 20.sp) }
                        DropdownMenu(expanded = utilityMenuExpanded, onDismissRequest = { utilityMenuExpanded = false }) {
                            DropdownMenuItem(text = { Text(androidText("Refresh", "Vernieuwen")) }, onClick = { utilityMenuExpanded = false; onRefresh() })
                        }
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    Button(
                        onClick = onBackToDirector,
                        colors = secondaryAction,
                        border = hairline,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier
                            .size(Mk8dxSpacing.targetMin)
                            .testTag("tournament-start-home")
                            .semantics { contentDescription = androidText(language, "Back to Step 0", "Terug naar Stap 0") },
                    ) { Text("🏠", fontSize = 14.sp) }
                    Button(
                        onClick = onBackToDirector,
                        colors = secondaryAction,
                        border = hairline,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier.height(Mk8dxSpacing.targetMin).testTag("tournament-start-back"),
                    ) {
                        Text(
                            androidText("← Step 0", "← Stap 0"),
                            style = type.label.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
                        )
                    }
                    Button(
                        enabled = false,
                        onClick = {},
                        colors = ButtonDefaults.buttonColors(
                            disabledContainerColor = colors.surfaceControl,
                            disabledContentColor = colors.textSecondary,
                        ),
                        border = hairline,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                        shape = RoundedCornerShape(9.dp),
                        modifier = Modifier
                            .size(Mk8dxSpacing.targetMin)
                            .testTag("tournament-start-save")
                            .semantics {
                                contentDescription = androidText(language, "Save", "Opslaan")
                                stateDescription = androidText(language, "Everything is already saved", "Alles is al opgeslagen")
                            },
                    ) { Text("💾", fontSize = 14.sp) }
                    Surface(
                        color = Mk8dxDesignTheme.tint(colors, colors.statusSuccess),
                        shape = RoundedCornerShape(9.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.statusSuccess),
                        modifier = Modifier.height(Mk8dxSpacing.targetMin).testTag("tournament-start-status"),
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 10.dp)) {
                            Text(
                                androidText("✓ Saved", "✓ Opgeslagen"),
                                color = colors.statusSuccess,
                                style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                            )
                        }
                    }
                }
                // One operator mode colour for every step marker: Step 0 was
                // gold and Step 1 pink because the source gave each step its own
                // hue. `mode.raceDirection` is that signal now (§6).
                Box(Modifier.padding(top = 6.dp)) {
                    StepPhaseMarker(androidText("Step 1 · Start tournament", "Stap 1 · Toernooi starten"), "tournament-start-phase")
                }
            }
        }
        item {
            Surface(
                color = colors.surfaceRaised,
                shape = RoundedCornerShape(14.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderSubtle),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    Text(
                        androidText("Step 1: Start tournament", "Stap 1: Toernooi starten"),
                        style = type.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Black),
                        color = colors.textPrimary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp, vertical = 8.dp)
                            .semantics { heading() },
                    )
                    Surface(color = colors.surfaceControl, modifier = Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(horizontal = 10.dp, vertical = 18.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                androidText(
                                    "Choose one route: start a new tournament or load an existing tournament for this director.",
                                    "Kies één route om verder te gaan: start een nieuw toernooi of laad een bestaand toernooi van deze directeur.",
                                ),
                                color = colors.textBody,
                                style = type.bodyS.copy(fontSize = 14.sp),
                            )
                            error?.let {
                                Text(it, color = colors.statusError, style = type.bodyS.copy(fontSize = 13.sp))
                            }
                            Surface(
                                color = colors.surfaceRaised,
                                shape = RoundedCornerShape(10.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        androidText("New tournament", "Nieuw toernooi"),
                                        style = type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                                        color = colors.textPrimary,
                                    )
                                    Text(
                                        androidText("Tournament name", "ToernooiNaam"),
                                        color = colors.textSecondary,
                                        style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                                    )
                                    OutlinedTextField(
                                        value = name,
                                        onValueChange = { name = it.take(96) },
                                        singleLine = true,
                                        shape = RoundedCornerShape(10.dp),
                                        textStyle = type.body,
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedTextColor = colors.textPrimary,
                                            unfocusedTextColor = colors.textPrimary,
                                            focusedBorderColor = colors.focusRing,
                                            unfocusedBorderColor = colors.borderControl,
                                            cursorColor = colors.actionPrimary,
                                        ),
                                        modifier = Modifier.fillMaxWidth().testTag("tournament-start-name"),
                                    )
                                    Text(
                                        androidText("Tournament date (optional)", "Toernooidatum (optioneel)"),
                                        color = colors.textSecondary,
                                        style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                                    )
                                    OutlinedButton(
                                        onClick = ::openDatePicker,
                                        shape = RoundedCornerShape(10.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textPrimary),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderControl),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                                        modifier = Modifier.fillMaxWidth().height(48.dp).testTag("tournament-start-date"),
                                    ) {
                                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                eventDate.takeIf { it.isNotBlank() }?.split("-")?.let { "${it[2]}-${it[1]}-${it[0]}" }
                                                    ?: androidText("Today", "Vandaag"),
                                                style = type.data.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
                                                modifier = Modifier.weight(1f),
                                            )
                                            Icon(
                                                imageVector = Icons.Default.DateRange,
                                                contentDescription = androidText("Choose date", "Kies datum"),
                                                // Was Color.Black on a dark field: unreadable.
                                                tint = colors.textPrimary,
                                                modifier = Modifier.size(18.dp),
                                            )
                                        }
                                    }
                                    Text(
                                        androidText("Start time (optional)", "Starttijd (optioneel)"),
                                        color = colors.textSecondary,
                                        style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                                    )
                                    OutlinedButton(
                                        onClick = ::openTimePicker,
                                        shape = RoundedCornerShape(10.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textPrimary),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderControl),
                                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                                        modifier = Modifier.fillMaxWidth().height(48.dp).testTag("tournament-start-time"),
                                    ) {
                                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                startTime.ifBlank { "00:00" },
                                                style = type.data.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
                                                modifier = Modifier.weight(1f),
                                            )
                                            // The core Material icon set has no clock
                                            // glyph; the header already uses emoji.
                                            Text("🕓", fontSize = 14.sp, modifier = Modifier.clearAndSetSemantics { })
                                        }
                                    }
                                    Button(
                                        enabled = !busy && name.trim().isNotEmpty(),
                                        onClick = ::createTournament,
                                        colors = secondaryAction,
                                        border = hairline,
                                        shape = RoundedCornerShape(9.dp),
                                        modifier = Modifier.fillMaxWidth().height(50.dp).testTag("tournament-start-create"),
                                    ) {
                                        Text(
                                            androidText("Start new tournament", "Nieuw toernooi starten"),
                                            style = type.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Black),
                                        )
                                    }
                                }
                            }
                            Surface(
                                color = colors.surfaceRaised,
                                shape = RoundedCornerShape(10.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderStrong),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        androidText("Load existing tournament", "Bestaand toernooi laden"),
                                        style = type.title.copy(fontSize = 16.sp, fontWeight = FontWeight.Black),
                                        color = colors.textPrimary,
                                    )
                                    Text(
                                        androidText("Choose existing tournament", "Kies bestaand toernooi"),
                                        color = colors.textSecondary,
                                        style = type.micro.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
                                    )
                                    Box(Modifier.fillMaxWidth()) {
                                        OutlinedButton(
                                            enabled = tournaments.isNotEmpty(),
                                            onClick = { tournamentMenuExpanded = true },
                                            shape = RoundedCornerShape(10.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(
                                                contentColor = colors.textPrimary,
                                                disabledContentColor = colors.textTertiary,
                                            ),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderControl),
                                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                                            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("tournament-start-select"),
                                        ) {
                                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    selectedTournamentLabel,
                                                    style = type.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f),
                                                )
                                                Text("⌄", fontSize = 18.sp, modifier = Modifier.clearAndSetSemantics { })
                                            }
                                        }
                                        DropdownMenu(expanded = tournamentMenuExpanded, onDismissRequest = { tournamentMenuExpanded = false }) {
                                            tournaments.forEach { tournament ->
                                                DropdownMenuItem(
                                                    text = { Text("${tournament.name} · $directorDisplayName (v${tournament.revision})") },
                                                    onClick = { selectedTournamentId = tournament.tournamentId; tournamentMenuExpanded = false },
                                                )
                                            }
                                        }
                                    }
                                    Button(
                                        enabled = !busy && selectedTournament != null,
                                        onClick = { selectedTournament?.let(onSelectTournament) },
                                        colors = secondaryAction,
                                        border = hairline,
                                        shape = RoundedCornerShape(9.dp),
                                        modifier = Modifier.fillMaxWidth().height(50.dp).testTag("tournament-start-load"),
                                    ) {
                                        Text(
                                            androidText("Load selected tournament", "Laad geselecteerd toernooi"),
                                            style = type.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Black),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Preview(
    name = "Tournament · Stap 1 · telefoon",
    widthDp = 390,
    heightDp = 844,
    showBackground = true,
    backgroundColor = 0xFF09101E,
)
@Composable
internal fun TournamentStartStepPreview() {
    Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
        Box(Modifier.background(Mk8dxDesignTheme.colors.surfaceApp)) {
            TournamentStartStep(
                tournaments = listOf(
                    AndroidTournamentSummary(
                        tournamentId = "tournament.supertest2026",
                        name = "Supertest2026",
                        stage = "draft",
                        workflowStep = 1,
                        revision = 7,
                        participantCount = 0,
                        presentCount = 0,
                        publicResults = false,
                        affectsRating = false,
                        updatedAtMs = 1_787_795_200_000,
                    ),
                ),
                busy = false,
                error = null,
                directorDisplayName = "Ben",
                onBackToDirector = {},
                onRefresh = {},
                onSelectTournament = {},
                onCreateTournament = { _, _, _ -> },
                modifier = Modifier,
                initialName = "TestToernooi",
                initialEventDate = "2026-08-29",
                initialStartTime = "19:30",
            )
        }
    }
}

@Composable
private fun TournamentDocumentScreen(
    document: AndroidTournamentDocument,
    incoming: List<AndroidIncomingTournamentResult>,
    busy: Boolean,
    error: String?,
    tournaments: List<AndroidTournamentSummary>,
    onSelectTournament: (AndroidTournamentSummary) -> Unit,
    onLeaveTournament: () -> Unit,
    onDeleteTournament: () -> Unit,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
    onIncomingChanged: () -> Unit,
    client: AndroidTournamentClient,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier.fillMaxSize().testTag("tournament-mobile")) {
        LazyColumn(
            modifier = Modifier.weight(1f).testTag("tournament-mobile-content"),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                TournamentHeader(document, tournaments, busy, onSelectTournament, onLeaveTournament, onDeleteTournament, onRefresh)
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
                if (busy) Text("Updating…", color = Mk8dxDesignTheme.colors.statusInfo, modifier = Modifier.padding(top = 5.dp))
            }
            item { TournamentWorkflowCard(document, busy, client, onMutation) }
            if (document.summary.stage != "finalized" &&
                document.summary.workflowStep != 5 && document.summary.workflowStep != 9) {
                item { EvidenceRecordsCard(document, busy, client, onIncomingChanged) }
            }
            when {
                document.summary.stage == "finalized" -> standingItems(document)
                // ADR-0177: Step 2 is owned by TournamentParticipantsStep; the
                // superseded roster composables were removed with it.
                document.summary.workflowStep == 3 || document.summary.workflowStep == 7 -> groupItems(document, busy, client, onMutation)
                document.summary.workflowStep == 5 || document.summary.workflowStep == 9 -> {
                    scoreItems(document, incoming, busy, client, onMutation)
                    incomingItems(document, incoming, busy, client, onIncomingChanged)
                }
                document.summary.workflowStep == 10 -> {
                    standingItems(document)
                    item { TournamentLifecycleControls(document, busy, client, onMutation) }
                }
                document.summary.workflowStep == 4 || document.summary.workflowStep == 6 ||
                    document.summary.workflowStep == 8 -> standingItems(document)
                else -> overviewItems(document)
            }
        }
    }
}

private fun androidTournamentSeatingText(document: AndroidTournamentDocument, stage: String): String = buildString {
    val cableByStation = androidUtpCableByStation(document)
    appendLine("${document.summary.name} · ${if (stage == "qualifier") "Qualifiers" else "Finals"}")
    document.groups.filter { it.stage == stage }.forEach { group ->
        appendLine(); appendLine("*${group.name}*")
        group.members.filter { it.station != null }
            .groupBy { requireNotNull(it.station).ownerPlayerId to requireNotNull(it.station).switchType }
            .values.forEach { members ->
                val station = requireNotNull(members.first().station)
                val cable = androidUtpCableNumber(cableByStation, station.ownerPlayerId, station.switchType)
                appendLine("${cable?.let { "UTP $it · " }.orEmpty()}${station.ownerDisplayName} · ${station.switchType.uppercase()}: ${members.sortedBy { it.station?.seatNumber }.joinToString(" + ") { it.displayName }}")
            }
    }
}

private fun androidTournamentResultsText(document: AndroidTournamentDocument): String = buildString {
    appendLine("${document.summary.name} · results")
    document.groups.forEach { group ->
        appendLine(); appendLine("*${group.name}*")
        group.standings.rows.forEach { row -> appendLine("${row.rank}. ${row.displayName} — ${row.points} pts") }
    }
}

@Composable
private fun TournamentWorkflowCard(
    document: AndroidTournamentDocument,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    val context = LocalContext.current
    var confirmRollback by remember(document.summary.revision) { mutableStateOf(false) }
    val summary = document.summary
    val labels = listOf(
        0 to "Director", 1 to "Start", 2 to "Participants & consoles",
        3 to "Qualifier layout", 4 to "Layout export", 5 to "Qualifier scores",
        6 to "Result export", 7 to "Final layout", 8 to "Final layout export",
        9 to "Final scores", 10 to "Final result export",
    )
    val stage = if (summary.workflowStep >= 7) "final" else "qualifier"
    val exportText = if (summary.workflowStep == 4 || summary.workflowStep == 8) {
        androidTournamentSeatingText(document, stage)
    } else androidTournamentResultsText(document)
    fun share(text: String) {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text)
        }, "Share Tournament checkpoint"))
    }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp), modifier = Modifier.testTag("tournament-workflow")) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("STEP ${summary.workflowStep} OF 10", color = Mk8dxDesignTheme.colors.modeRaceDirection, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black)
            Text(labels.firstOrNull { it.first == summary.workflowStep }?.second ?: "Tournament", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag("tournament-steps"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                labels.forEach { (number, label) ->
                    FilterChip(
                        selected = number == summary.workflowStep,
                        enabled = number <= summary.workflowStep,
                        onClick = {},
                        label = { Text("$number $label") },
                    )
                }
            }
            when (summary.workflowStep) {
                2 -> {
                    val needed = (summary.presentCount + 1) / 2
                    Text("Tap A, W or X for every Player and mark NS1/NS2. ${document.stations.size}/$needed Nintendo Switches ready.")
                    Button(
                        enabled = !busy && summary.presentCount >= 1 && document.stations.size >= needed,
                        onClick = { onMutation { client.generateGroups(summary.tournamentId, summary.revision, "qualifier") } },
                        modifier = Modifier.fillMaxWidth().testTag("tournament-generate-qualifier"),
                    ) { Text("Create qualifier groups") }
                }
                3 -> Button(enabled = !busy && document.groups.any { it.stage == "qualifier" }, onClick = { onMutation { client.lockGroups(summary.tournamentId, summary.revision, "qualifier", true) } }, modifier = Modifier.fillMaxWidth()) { Text("Confirm qualifier layout") }
                4 -> {
                    OutlinedButton(onClick = { share(exportText) }, modifier = Modifier.fillMaxWidth()) { Text("Share qualifier layout") }
                    Button(enabled = !busy, onClick = { onMutation { client.setWorkflowStep(summary.tournamentId, summary.revision, 5, "advance") } }, modifier = Modifier.fillMaxWidth()) { Text("Layout checked · enter scores") }
                }
                5 -> Button(enabled = !busy && document.hasCompleteScores("qualifier"), onClick = { onMutation { client.setWorkflowStep(summary.tournamentId, summary.revision, 6, "advance") } }, modifier = Modifier.fillMaxWidth()) { Text("Confirm all scores") }
                6 -> {
                    OutlinedButton(onClick = { share(exportText) }, modifier = Modifier.fillMaxWidth()) { Text("Share results") }
                    Button(enabled = !busy, onClick = { onMutation { client.generateGroups(summary.tournamentId, summary.revision, "final") } }, modifier = Modifier.fillMaxWidth().testTag("tournament-generate-finals")) { Text("Create final groups") }
                }
                7 -> Button(enabled = !busy && document.groups.any { it.stage == "final" }, onClick = { onMutation { client.lockGroups(summary.tournamentId, summary.revision, "final", true) } }, modifier = Modifier.fillMaxWidth()) { Text("Confirm final layout") }
                8 -> {
                    OutlinedButton(onClick = { share(exportText) }, modifier = Modifier.fillMaxWidth()) { Text("Share final layout") }
                    Button(enabled = !busy, onClick = { onMutation { client.setWorkflowStep(summary.tournamentId, summary.revision, 9, "advance") } }, modifier = Modifier.fillMaxWidth()) { Text("Layout checked · enter final scores") }
                }
                9 -> Button(enabled = !busy && document.hasCompleteScores("final"), onClick = { onMutation { client.setWorkflowStep(summary.tournamentId, summary.revision, 10, "advance") } }, modifier = Modifier.fillMaxWidth().testTag("tournament-confirm-final-scores")) { Text("Confirm final scores") }
                10 -> OutlinedButton(onClick = { share(exportText) }, modifier = Modifier.fillMaxWidth()) { Text("Share final result") }
            }
            if (summary.stage != "finalized" && summary.workflowStep > 2) {
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        if (confirmRollback) onMutation { client.setWorkflowStep(summary.tournamentId, summary.revision, summary.workflowStep - 1, "rollback") }
                        else confirmRollback = true
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (confirmRollback) "Confirm previous step" else "Previous step") }
            }
        }
    }
}

@Composable
private fun TournamentHeader(
    document: AndroidTournamentDocument,
    tournaments: List<AndroidTournamentSummary>,
    busy: Boolean,
    onSelect: (AndroidTournamentSummary) -> Unit,
    onLeave: () -> Unit,
    onDelete: () -> Unit,
    onRefresh: () -> Unit,
) {
    val context = LocalContext.current
    var confirmDelete by remember(document.summary.tournamentId, document.summary.revision) { mutableStateOf(false) }
    var showActions by remember(document.summary.tournamentId) { mutableStateOf(false) }
    val canDelete = document.summary.stage != "finalized" && document.groups.none { it.races.isNotEmpty() }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("STEP ${document.summary.workflowStep}/10 · ${document.summary.stage.uppercase()}", color = Mk8dxDesignTheme.colors.modeRaceDirection, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black)
                    Text(document.summary.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${document.summary.presentCount}/${document.summary.participantCount} present · revision ${document.summary.revision}", style = MaterialTheme.typography.bodySmall)
                }
                OutlinedButton(
                    onClick = { showActions = !showActions },
                    modifier = Modifier.testTag("tournament-header-menu"),
                ) { Text(if (showActions) "Close" else "Menu") }
            }
            if (showActions) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onRefresh, modifier = Modifier.weight(1f)) { Text("Refresh") }
                    OutlinedButton(
                        onClick = {
                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, "${document.summary.name}\n${nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin.current(context)}/tournaments/${document.summary.tournamentId}")
                            }, "Share Tournament"))
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("Share") }
                }
                OutlinedButton(
                    enabled = !busy,
                    onClick = onLeave,
                    modifier = Modifier.fillMaxWidth().testTag("tournament-leave"),
                ) { Text("All Tournaments") }
                if (canDelete && !confirmDelete) {
                    OutlinedButton(
                        enabled = !busy,
                        onClick = { confirmDelete = true },
                        modifier = Modifier.fillMaxWidth().testTag("tournament-delete"),
                    ) { Text("Delete draft") }
                } else if (canDelete) {
                    Text("Delete this draft permanently? This is only allowed before races are recorded.", color = MaterialTheme.colorScheme.error)
                    Button(enabled = !busy, onClick = onDelete, modifier = Modifier.fillMaxWidth().testTag("tournament-delete-confirm")) { Text("Confirm delete") }
                    OutlinedButton(enabled = !busy, onClick = { confirmDelete = false }, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
                }
                if (tournaments.size > 1) {
                    Text("Other tournaments", style = MaterialTheme.typography.labelMedium)
                    tournaments.filter { it.tournamentId != document.summary.tournamentId }.take(3).forEach { item ->
                        OutlinedButton(onClick = { onSelect(item) }, modifier = Modifier.fillMaxWidth()) { Text(item.name, maxLines = 1) }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.overviewItems(document: AndroidTournamentDocument) {
    val cableByStation = androidUtpCableByStation(document)
    item {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TournamentMetric("Present", document.summary.presentCount.toString(), Mk8dxDesignTheme.colors.textPrimary, Modifier.weight(1f))
            TournamentMetric("Stations", document.stations.size.toString(), Mk8dxDesignTheme.colors.textPrimary, Modifier.weight(1f))
            TournamentMetric("Races", document.groups.sumOf { it.races.size }.toString(), Mk8dxDesignTheme.colors.textPrimary, Modifier.weight(1f))
        }
    }
    item { SectionTitle("Nintendo Switch stations & cable plan") }
    if (document.stations.isEmpty()) item { EmptyCard("No Nintendo Switch stations assigned") }
    items(document.stations) { station ->
        val cable = androidUtpCableNumber(cableByStation, station.ownerPlayerId, station.switchType)
        TournamentRow(station.ownerDisplayName, "${cable?.let { "UTP $it · " }.orEmpty()}${station.switchType.uppercase()} · station owner · connect to group shown below")
    }
    item { SectionTitle("Progress") }
    items(document.groups) { group ->
        TournamentRow(androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current), "${group.stage} · ${group.members.size} Players · ${group.races.size} races · ${if (group.locked) "locked" else "open"}")
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.groupItems(
    document: AndroidTournamentDocument,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    // Match the source Manager's Step 3/7 presentation: once final groups
    // exist, the final-layout board must start with Kampioen/Talent/Wild
    // instead of making the operator scroll past the locked qualifiers.
    val visibleStage = if (document.summary.workflowStep >= 7) "final" else "qualifier"
    val visibleGroups = document.groups.filter { it.stage == visibleStage }
    item { SectionTitle("Groups, seating & stations") }
    items(visibleGroups, key = AndroidTournamentGroup::groupId) { group ->
        TournamentGroupCard(document, group, busy, client, onMutation)
    }
    if (visibleGroups.isNotEmpty()) {
        item(key = "parking-$visibleStage") {
            TournamentParkingCard(document, visibleStage, busy, client, onMutation)
        }
    }
}

@Composable
private fun TournamentGroupCard(
    document: AndroidTournamentDocument,
    group: AndroidTournamentGroup,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    val stageGroups = document.groups.filter { it.stage == group.stage }
    val editable = stageGroups.all { !it.locked && it.races.isEmpty() && it.standings.source != "manual" }
    var selectedPlayerId by remember(document.summary.revision, group.groupId) { mutableStateOf<String?>(null) }
    val stations = group.members.filter { it.station != null }
        .groupBy { requireNotNull(it.station).ownerPlayerId to requireNotNull(it.station).switchType }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(15.dp),
        modifier = Modifier.testTag("tournament-group-${group.groupId}"),
    ) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(group.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
                    Text("${group.members.size}/12 Players · ${stations.size} Switches", style = MaterialTheme.typography.bodySmall)
                }
                Text(if (group.locked) "LOCKED" else "OPEN", color = if (group.locked) Mk8dxDesignTheme.colors.statusSuccess else Mk8dxDesignTheme.colors.statusWarning, fontWeight = FontWeight.Black)
            }
            if (stations.isEmpty()) Text("No Nintendo Switch assigned yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
            stations.values.forEach { members ->
                val station = requireNotNull(members.first().station)
                Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(11.dp)) {
                    Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("${station.switchType.uppercase()} · ${station.ownerDisplayName}", color = Mk8dxDesignTheme.colors.statusInfo, fontWeight = FontWeight.Black)
                        (1..2).forEach { seatNumber ->
                            val member = members.firstOrNull { it.station?.seatNumber == seatNumber }
                            Surface(
                                color = if (selectedPlayerId == member?.playerId) {
                                Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.actionPrimary)
                            } else {
                                Mk8dxDesignTheme.colors.surfaceControl
                            },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth().height(44.dp).then(
                                    if (member != null && editable) Modifier.clickable { selectedPlayerId = if (selectedPlayerId == member.playerId) null else member.playerId }
                                    else Modifier,
                                ).testTag(member?.let { "tournament-player-${it.playerId}" } ?: "tournament-empty-seat"),
                            ) {
                                Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("$seatNumber", color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Black, modifier = Modifier.padding(end = 8.dp))
                                    Text(member?.displayName ?: "Available", color = if (member == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                                }
                            }
                        }
                    }
                }
            }
            group.members.filter { it.station == null }.forEach { member ->
                Surface(
                    color = if (selectedPlayerId == member.playerId) {
                        Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.actionPrimary)
                    } else {
                        Mk8dxDesignTheme.colors.surfaceRaised
                    },
                    shape = RoundedCornerShape(9.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp).then(
                        if (editable) Modifier.clickable { selectedPlayerId = if (selectedPlayerId == member.playerId) null else member.playerId } else Modifier,
                    ).testTag("tournament-player-${member.playerId}"),
                ) {
                    Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(member.displayName, fontWeight = FontWeight.Bold)
                        Text("NEEDS SEAT", color = Mk8dxDesignTheme.colors.statusWarning, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black)
                    }
                }
            }
            val selected = group.members.firstOrNull { it.playerId == selectedPlayerId }
            if (selected != null && editable) {
                Text("Move ${selected.displayName}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    OutlinedButton(
                        enabled = !busy,
                        onClick = { onMutation { client.updateGroups(document.summary.tournamentId, document.summary.revision, group.stage, tournamentGroupsAfterMove(document.groups, group.stage, selected.playerId, null)) } },
                    ) { Text("Park") }
                    stageGroups.filter { it.groupId != group.groupId && it.members.size < 12 }.forEach { target ->
                        OutlinedButton(
                            enabled = !busy,
                            onClick = { onMutation { client.updateGroups(document.summary.tournamentId, document.summary.revision, group.stage, tournamentGroupsAfterMove(document.groups, group.stage, selected.playerId, target.groupId)) } },
                        ) { Text("→ ${target.name}") }
                    }
                }
            } else if (editable) {
                Text("Tap a Player to move or park them", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun TournamentParkingCard(
    document: AndroidTournamentDocument,
    stage: String,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    val groups = document.groups.filter { it.stage == stage }
    val assigned = groups.flatMap { it.members }.mapTo(mutableSetOf()) { it.playerId }
    val parked = document.participants.filter { it.attendance == "present" && it.playerId !in assigned }
    val editable = groups.all { !it.locked && it.races.isEmpty() && it.standings.source != "manual" }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(15.dp), modifier = Modifier.testTag("tournament-parking-$stage")) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("${stage.replaceFirstChar { it.uppercase() }} Player parking · ${parked.size}", fontWeight = FontWeight.Black)
            Text(
                if (parked.isEmpty()) "Everyone present has a group." else "These present Players are safely kept outside the group layout.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            parked.forEach { participant ->
                Column(Modifier.fillMaxWidth()) {
                    Text(participant.displayName, fontWeight = FontWeight.Bold)
                    if (editable) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            groups.filter { it.members.size < 12 }.forEach { target ->
                                OutlinedButton(
                                    enabled = !busy,
                                    onClick = { onMutation { client.updateGroups(document.summary.tournamentId, document.summary.revision, stage, tournamentGroupsAfterMove(document.groups, stage, participant.playerId, target.groupId)) } },
                                ) { Text("→ ${target.name}") }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.standingItems(document: AndroidTournamentDocument) {
    item { SectionTitle("Tournament standings") }
    if (document.overall.isEmpty()) item { EmptyCard("No standings yet — enter or accept a race") }
    items(document.overall) { row -> TournamentRow("${row.placement}. ${row.displayName}", "${row.points} points · ${androidGroupLabel(row.groupName, null, LocalAndroidProductLanguage.current)} #${row.groupRank}") }
    document.groups.forEach { group ->
        item { Text(androidGroupLabel(group.name, group.tierKey, LocalAndroidProductLanguage.current), color = Mk8dxDesignTheme.colors.textPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp)) }
        items(group.standings.rows) { row -> TournamentRow("${row.rank}. ${row.displayName}", "${row.points} points · ${row.races} races · ${row.wins} wins") }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.incomingItems(
    document: AndroidTournamentDocument,
    incoming: List<AndroidIncomingTournamentResult>,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    val activeStage = if (document.summary.workflowStep == 9) "final" else "qualifier"
    val visible = incoming.filter { it.status == "pending" && (it.suggestedPhase == null || it.suggestedPhase == activeStage) }
    val blockedGroups = visible.groupBy { it.suggestedGroupId }.filterValues { groupResults ->
        groupResults.maxOfOrNull { it.result["scoringSegment"]?.jsonPrimitive?.intOrNull ?: 1 }?.minus(1)?.let { it > 3 } == true
    }.keys
    val stepNumber = if (activeStage == "final") 9 else 5
    val groupKind = if (activeStage == "final") "final group" else "qualifier group"
    item { EvidenceRecordsCard(document, busy, client, onChanged) }
    item { SectionTitle("Step $stepNumber · Tournament Live / Processor incoming results") }
    if (visible.isEmpty()) item {
        EmptyCard(
            "Nothing is waiting yet. In Tournament Live connect to this Tournament and select the correct $groupKind " +
                "for every feed. Connected results appear here automatically and do not count until accepted.",
        )
    }
    visible.groupBy { it.suggestedGroupId }.forEach { (groupId, results) ->
        if (groupId != null) {
            item(key = "confirm-feed-$groupId") {
                IncomingGroupConfirmation(document, groupId, results, groupId in blockedGroups, busy, client, onChanged)
            }
        }
        items(results, key = AndroidIncomingTournamentResult::incomingResultId) { item ->
            IncomingResultCard(document, item, item.suggestedGroupId in blockedGroups, busy, client, onChanged)
        }
    }
}

private fun evidenceGroupSuggestion(
    observedLabel: String,
    groups: List<AndroidTournamentGroup>,
): String? {
    fun normalized(value: String) = value.lowercase(Locale.ROOT)
        .replace("groep", "group").replace("champion", "kampioen")
        .filter(Char::isLetterOrDigit)
    val observed = normalized(observedLabel)
    val exact = groups.filter { normalized(it.name) == observed }
    if (exact.size == 1) return exact.single().groupId
    val number = Regex("(\\d+)$").find(observed)?.groupValues?.get(1)
    val numeric = number?.let { groups.filter { group -> Regex("(\\d+)$").find(normalized(group.name))?.groupValues?.get(1) == it } }.orEmpty()
    return numeric.singleOrNull()?.groupId
}

@Composable
private fun EvidenceRecordsCard(
    document: AndroidTournamentDocument,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    var records by remember(document.summary.tournamentId) { mutableStateOf<List<AndroidTournamentEvidenceRecord>>(emptyList()) }
    var error by remember(document.summary.tournamentId) { mutableStateOf<String?>(null) }
    val recordingsLifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(document.summary.tournamentId) {
        recordingsLifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var quietPolls = 0
            while (true) {
                runCatching { withContext(Dispatchers.IO) { client.evidenceRecords(document.summary.tournamentId) } }
                    .onSuccess { latest ->
                        if (latest == records) { quietPolls += 1 } else { quietPolls = 0; records = latest }
                        error = null
                    }
                    .onFailure { error = "Available recordings could not be loaded." }
                delay(if (quietPolls >= ANDROID_POLL_QUIET_BEFORE_BACK_OFF) ANDROID_POLL_SLOW_MS else ANDROID_POLL_FAST_MS)
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        SectionTitle("Available Tournament Live recordings (${records.size})")
        Text(
            "The capture operator selects this Tournament and a different current group for each sticker-named feed before Start. Race 1 can confirm the public View automatically; scores still wait for your Player and full group review after Stop.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        if (records.isEmpty() && error == null) EmptyCard("No completed recording is available yet.")
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        records.forEach { record ->
            EvidenceRecordCard(document, record, busy, client, onChanged)
        }
    }
}

@Composable
private fun EvidenceRecordCard(
    document: AndroidTournamentDocument,
    record: AndroidTournamentEvidenceRecord,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    val phase = record.live?.mappings?.firstOrNull()?.phase ?: if (document.summary.workflowStep >= 7) "final" else "qualifier"
    val groups = document.groups.filter { it.stage == phase }
    val observedGroups = if (record.groups.isNotEmpty()) record.groups else record.live?.mappings.orEmpty().map {
        AndroidTournamentEvidenceGroup(it.observedGroupLabel, 0, 0)
    }
    var mappings by remember(record.recordId, record.revision, phase) {
        mutableStateOf(observedGroups.associate { observed ->
            observed.observedGroupLabel to (record.live?.mappings?.firstOrNull { it.observedGroupLabel == observed.observedGroupLabel }?.groupId
                ?: evidenceGroupSuggestion(observed.observedGroupLabel, groups) ?: "")
        })
    }
    var linking by remember(record.recordId, record.revision) { mutableStateOf(false) }
    var localError by remember(record.recordId, record.revision) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val timeFormat = remember { java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT) }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(15.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("Tournament Live · ${record.uploadedBy.displayName}", fontWeight = FontWeight.Black)
            Text(
                "Recording ${record.startedAtMs?.let { timeFormat.format(Date(it)) } ?: "start unknown"} – ${record.stoppedAtMs?.let { timeFormat.format(Date(it)) } ?: "stop unknown"} · ${record.resultCount} races",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                if (record.suggestedTournamentId == document.summary.tournamentId) "Uploader suggested this Tournament; you decide."
                else record.suggestedTournamentName?.let { "Uploader suggested $it; you may choose this Tournament instead." }
                    ?: "Uploader did not suggest a Tournament.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            observedGroups.forEach { observed ->
                var expanded by remember(record.recordId, observed.observedGroupLabel) { mutableStateOf(false) }
                val selected = groups.firstOrNull { it.groupId == mappings[observed.observedGroupLabel] }
                Text("${observed.observedGroupLabel} · ${observed.races} races · ${observed.connectionErrors} connection errors", fontWeight = FontWeight.Bold)
                if (observed.topThree.isNotEmpty()) {
                    Text("Top 3: ${observed.topThree.mapIndexed { index, score -> "${index + 1}. ${score.observedPlayer} (${score.points})" }.joinToString(" · ")}", style = MaterialTheme.typography.bodySmall)
                }
                Box {
                    OutlinedButton(onClick = { expanded = true }, enabled = !busy && (record.status != "linked" || record.live != null)) {
                        Text(selected?.name ?: "Choose matching group")
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        groups.forEach { group -> DropdownMenuItem(
                            text = { Text(group.name) },
                            onClick = {
                                mappings = mappings + (observed.observedGroupLabel to group.groupId)
                                expanded = false
                            },
                        ) }
                    }
                }
            }
            if (record.status == "linked") {
                Text("Linked · races remain available. Update these group links after changing the layout.", color = Mk8dxDesignTheme.colors.statusSuccess, fontWeight = FontWeight.Bold)
            }
            when (record.live?.status) {
                "requested" -> Text("Waiting for race names to verify every sticker-to-group link. Nothing is public yet; confirm manually only as a fallback.", color = Mk8dxDesignTheme.colors.statusWarning, fontWeight = FontWeight.Bold)
                "active" -> Text("Live now · public viewers see in-game names and Total. Player linking follows after Stop.", color = Mk8dxDesignTheme.colors.statusSuccess, fontWeight = FontWeight.Bold)
                "stopping" -> Text("Stop received · waiting for the final upload.", color = Mk8dxDesignTheme.colors.statusWarning, fontWeight = FontWeight.Bold)
                "complete" -> Text("Live feed complete · check final totals, then link the observed names to Players.", color = Mk8dxDesignTheme.colors.statusSuccess, fontWeight = FontWeight.Bold)
            }
            if (record.live != null && record.live.status != "invalidated") {
                Button(
                    enabled = !busy && !linking && mappings.size == observedGroups.size && mappings.values.none(String::isBlank) &&
                        mappings.values.toSet().size == mappings.size,
                    onClick = {
                        linking = true
                        scope.launch {
                            runCatching { withContext(Dispatchers.IO) {
                                client.approveLiveAssociation(document.summary.tournamentId, record, mappings, phase)
                            } }.onSuccess { onChanged() }.onFailure { localError = "The live group routing could not be saved." }
                            linking = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (record.live.status == "requested") "Confirm live routing manually" else "Repair live group links") }
            }
            if (record.status != "uploading" && record.status != "blocked") {
                Button(
                    enabled = !busy && !linking && record.complete && mappings.size == observedGroups.size &&
                        mappings.values.none(String::isBlank) && mappings.values.toSet().size == mappings.size,
                    onClick = {
                        linking = true
                        scope.launch {
                            runCatching { withContext(Dispatchers.IO) {
                                client.linkEvidenceRecord(document.summary.tournamentId, record, phase, mappings)
                            } }.onSuccess { onChanged() }.onFailure { localError = "The recording could not be linked." }
                            linking = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (record.status == "linked") "Update reviewed group links" else "Link reviewed recording") }
            }
            localError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun IncomingGroupConfirmation(
    document: AndroidTournamentDocument,
    groupId: String,
    incoming: List<AndroidIncomingTournamentResult>,
    blockedByResetLimit: Boolean,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var acting by remember(incoming) { mutableStateOf(false) }
    var error by remember(incoming) { mutableStateOf<String?>(null) }
    val group = document.groups.firstOrNull { it.groupId == groupId }
    val suggestionsComplete = incoming.all { it.correctedWithExactPlayerSuggestions(document.participants) != null &&
        (it.suggestedRaceNumber ?: it.result["raceNumber"]?.jsonPrimitive?.intOrNull) != null }
    Surface(color = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusInfo), shape = RoundedCornerShape(15.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${group?.name ?: groupId} · provisional feed", fontWeight = FontWeight.Black)
            Text("${incoming.size} race(s). Exact name matches are suggestions only; this confirmation applies the complete group feed once.")
            if (!suggestionsComplete) Text("A Player name is ambiguous or unknown. Map this feed in the web manager.", color = Mk8dxDesignTheme.colors.statusWarning)
            if (blockedByResetLimit) Text("More than 3 connection resets: correct the desktop session; nothing is truncated.", color = Mk8dxDesignTheme.colors.statusError)
            Button(
                enabled = !busy && !acting && suggestionsComplete && !blockedByResetLimit,
                onClick = {
                    acting = true
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { client.acceptIncomingGroup(document, groupId, incoming) } }
                            .onSuccess { onChanged() }
                            .onFailure { error = "The complete group feed could not be confirmed." }
                        acting = false
                    }
                },
                modifier = Modifier.fillMaxWidth().testTag("tournament-confirm-feed-$groupId"),
            ) { Text("Confirm group feed (${incoming.size})") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun IncomingResultCard(
    document: AndroidTournamentDocument,
    incoming: AndroidIncomingTournamentResult,
    blockedByResetLimit: Boolean,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    var acting by remember(incoming) { mutableStateOf(false) }
    var localError by remember(incoming) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val result = incoming.result
    val track = result["trackId"]?.jsonPrimitive?.content ?: "Unknown track"
    val placements = runCatching { result["placements"]?.jsonArray.orEmpty() }.getOrDefault(emptyList())
    val suggestedGroup = incoming.suggestedGroupId?.let { id -> document.groups.firstOrNull { it.groupId == id } }
    val suggestedRace = incoming.suggestedRaceNumber ?: result["raceNumber"]?.jsonPrimitive?.intOrNull
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(15.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(incoming.sourceKind.replace('_', ' ').uppercase(), color = Mk8dxDesignTheme.colors.textSecondary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black)
                Text(incoming.status.uppercase(), color = if (incoming.status == "pending") Mk8dxDesignTheme.colors.statusWarning else Mk8dxDesignTheme.colors.statusSuccess, fontWeight = FontWeight.Bold)
            }
            Text(Schema9AndroidTrackCatalog.find(track)?.displayName ?: track.substringAfterLast('.'), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            placements.forEach { placement ->
                val obj = placement.jsonObject
                val position = obj["finishPosition"]?.jsonPrimitive?.intOrNull ?: 0
                val ref = obj["participantReference"]?.jsonObject?.get("value")?.jsonPrimitive?.content ?: "Unknown Player"
                Text("$position. ${androidReadableReference(ref)}")
            }
            if (incoming.duplicateWarning) Text("Possible duplicate — compare before accepting", color = Mk8dxDesignTheme.colors.statusError)
            if (blockedByResetLimit) Text("Blocked: more than 3 connection resets. Correct the desktop session; no segments were discarded.", color = Mk8dxDesignTheme.colors.statusError)
            Text("Suggested: ${suggestedGroup?.name ?: "choose group on web"}${suggestedRace?.let { " · race $it" } ?: ""}", style = MaterialTheme.typography.bodySmall)
            localError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (incoming.status == "pending") {
                OutlinedButton(
                    enabled = !busy && !acting,
                    onClick = {
                        acting = true
                        scope.launch {
                            runCatching { withContext(Dispatchers.IO) { client.rejectIncoming(incoming.incomingResultId, incoming.revision, "Rejected in MK8DX Android after operator review") } }
                                .onSuccess { onChanged() }.onFailure { localError = "Could not reject this result." }
                            acting = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Reject result") }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.scoreItems(
    document: AndroidTournamentDocument,
    incoming: List<AndroidIncomingTournamentResult>,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    val stage = if (document.summary.workflowStep >= 7) "final" else "qualifier"
    item {
        Surface(color = Mk8dxDesignTheme.tint(Mk8dxDesignTheme.colors, Mk8dxDesignTheme.colors.statusInfo), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("Score entry", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
                Text("Enter the total per Player, or let Tournament Live / Tournament Processor deliver race results. Excel workbooks can be imported in the web app.")
                val pending = incoming.count { it.status == "pending" }
                if (pending > 0) Text("$pending desktop result${if (pending == 1) "" else "s"} waiting under Incoming.", color = Mk8dxDesignTheme.colors.statusWarning, fontWeight = FontWeight.Bold)
            }
        }
    }
    items(document.groups.filter { it.stage == stage && it.races.isEmpty() }, key = { "manual-${it.groupId}" }) { group ->
        ManualScoreEntry(document, group, busy, client, onMutation)
    }
    items(document.groups.filter { it.stage == stage && it.races.isNotEmpty() }, key = { "desktop-${it.groupId}" }) { group ->
        TournamentRow(group.name, "Scores supplied by desktop results · ${group.races.size} races · ${group.standings.rows.joinToString { "${it.displayName} ${it.points}" }}")
    }
}

@Composable
private fun ManualScoreEntry(
    document: AndroidTournamentDocument,
    group: AndroidTournamentGroup,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var connectionErrors by remember(group.groupId, document.summary.revision) { mutableIntStateOf((group.manualScoreSegments - 1).coerceIn(0, 3)) }
    val segments = connectionErrors + 1
    val values = remember(group.groupId, document.summary.revision, segments) {
        mutableStateListOf<String>().apply {
            group.members.forEach { member ->
                val existing = group.manualScores.firstOrNull { it.playerId == member.playerId }
                repeat(segments) { index -> add(existing?.segmentPoints?.getOrNull(index)?.toString().orEmpty()) }
            }
        }
    }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${group.name} scores", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
            Text("Connection errors", style = MaterialTheme.typography.labelMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                (0..3).forEach { count -> FilterChip(selected = connectionErrors == count, onClick = { connectionErrors = count }, label = { Text(count.toString()) }, modifier = Modifier.weight(1f).testTag("tournament-score-errors-${group.groupId}-$count")) }
            }
            group.members.forEachIndexed { memberIndex, member ->
                val total = (0 until segments).sumOf { segment -> values.getOrNull(memberIndex * segments + segment)?.toIntOrNull() ?: 0 }
                Text("${member.displayName} · $total", fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(segments) { segment ->
                        val index = memberIndex * segments + segment
                        OutlinedTextField(
                            value = values[index],
                            onValueChange = { values[index] = it.filter(Char::isDigit).take(5) },
                            label = { Text(if (segments == 1) "Total" else "Part ${segment + 1}") },
                            modifier = Modifier.width(150.dp).testTag("tournament-score-${group.groupId}-${member.playerId}-${segment + 1}"),
                        )
                    }
                }
            }
            val liveOrder = group.members.mapIndexed { index, member ->
                member.displayName to (0 until segments).sumOf { segment -> values.getOrNull(index * segments + segment)?.toIntOrNull() ?: 0 }
            }.sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first.lowercase() })
            if (liveOrder.any { it.second > 0 }) {
                Text("Live standings", style = MaterialTheme.typography.labelMedium)
                Text(liveOrder.mapIndexed { index, row -> "${index + 1}. ${row.first} ${row.second}" }.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            }
            val valid = values.all { it.toIntOrNull() != null }
            Button(
                enabled = !busy && valid && values.isNotEmpty(),
                onClick = {
                    focusManager.clearFocus()
                    keyboardController?.hide()
                    val scores = group.members.mapIndexed { memberIndex, member ->
                        member.playerId to (0 until segments).map { segment -> values[memberIndex * segments + segment].toIntOrNull() }
                    }.toMap()
                    onMutation { client.setManualScores(document.summary.tournamentId, document.summary.revision, group.groupId, segments, scores) }
                },
                modifier = Modifier.fillMaxWidth().testTag("tournament-save-scores-${group.groupId}"),
            ) { Text("Save ${group.name} scores") }
            Text("Manual totals follow the original score sheet. Only confirmed desktop race results can affect TrueSkill.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TournamentLifecycleControls(document: AndroidTournamentDocument, busy: Boolean, client: AndroidTournamentClient, onMutation: (() -> AndroidTournamentDocument) -> Unit) {
    var publicResults by remember(document.summary.tournamentId) { mutableStateOf(document.summary.publicResults) }
    var affectsRating by remember(document.summary.tournamentId) { mutableStateOf(document.summary.affectsRating) }
    var confirmFinalize by remember(document.summary.revision) { mutableStateOf(false) }
    val canFinalize = document.summary.workflowStep == 10
    val scoringStage = "final"
    val hasCompleteResults = document.hasCompleteScores(scoringStage)
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Tournament workflow", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
            if (document.summary.stage != "finalized" && canFinalize) {
                FilterChip(selected = publicResults, onClick = { publicResults = !publicResults }, label = { Text("Public results") }, modifier = Modifier.fillMaxWidth())
                FilterChip(selected = affectsRating, onClick = { affectsRating = !affectsRating }, label = { Text("Affects TrueSkill") }, modifier = Modifier.fillMaxWidth())
                if (!confirmFinalize) OutlinedButton(enabled = !busy && hasCompleteResults, onClick = { confirmFinalize = true }, modifier = Modifier.fillMaxWidth()) { Text("Review finalization") }
                else {
                    Text("Finalization pins the current results. Public visibility and rating inclusion are independent choices.", color = Mk8dxDesignTheme.colors.statusWarning)
                    Button(enabled = !busy, onClick = { onMutation { client.finalize(document.summary.tournamentId, document.summary.revision, publicResults, affectsRating) } }, modifier = Modifier.fillMaxWidth().testTag("tournament-finalize")) { Text("Finalize Tournament") }
                    OutlinedButton(onClick = { confirmFinalize = false }, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
                }
            } else if (document.summary.stage == "finalized") Text("Tournament finalized", color = Mk8dxDesignTheme.colors.statusSuccess, fontWeight = FontWeight.Black)
            else Text("Complete the current guided step first.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun IncidentEntry(
    document: AndroidTournamentDocument,
    busy: Boolean,
    client: AndroidTournamentClient,
    onMutation: (() -> AndroidTournamentDocument) -> Unit,
) {
    var category by remember { mutableStateOf("equipment") }
    var note by remember { mutableStateOf("") }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text("Record incident", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                listOf("equipment", "attendance", "replacement", "scoring", "conduct", "other").forEach { value ->
                    FilterChip(selected = category == value, onClick = { category = value }, label = { Text(value) }, modifier = Modifier.padding(end = 5.dp))
                }
            }
            OutlinedTextField(value = note, onValueChange = { note = it.take(160).replace("|", "") }, label = { Text("What happened?") }, modifier = Modifier.fillMaxWidth())
            Button(
                enabled = !busy && note.isNotBlank(),
                onClick = { val captured = note.trim(); onMutation { client.recordIncident(document.summary.tournamentId, document.summary.revision, category, captured) }; note = "" },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save incident") }
        }
    }
}

@Composable
private fun TournamentMetric(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(14.dp), modifier = modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black, color = color)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable private fun SectionTitle(title: String) = Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
@Composable private fun EmptyCard(text: String) = TournamentRow(text, "Nothing needs your attention")

@Composable
private fun TournamentRow(title: String, subtitle: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/* The Tournament feeds are polled because race-day results arrive from another
   client. Quiet polls back off from 5 s to 20 s and any change resets that,
   matching the Web feed exactly. */
private const val ANDROID_POLL_FAST_MS = 5_000L
private const val ANDROID_POLL_SLOW_MS = 20_000L
private const val ANDROID_POLL_QUIET_BEFORE_BACK_OFF = 6
