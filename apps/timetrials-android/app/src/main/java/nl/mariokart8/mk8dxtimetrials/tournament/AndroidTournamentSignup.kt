package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxToggleRow

/**
 * Open sign-up and the player's status line (ADR-0222), the twin of the website's
 * `tournament-signup-section.ts` and `tournament-signup-board-section.ts`.
 *
 * A night still to come tells a signed-in player one line about themselves and what
 * can happen next (sign up with the consoles they bring, change them, withdraw); a
 * night with open sign-up shows the list and the waiting list in order, and the
 * draw's seed after closing. The Director's board shows every sign-up, the waiting
 * list order and a warning when too few consoles are coming.
 */

@Serializable
internal data class AndroidSignupListEntry(
    val position: Int,
    val playerId: String? = null,
    val displayName: String,
)

@Serializable
internal data class AndroidSignupViewer(
    val state: String,
    val playerId: String? = null,
    val hasSwitch1: Boolean,
    val hasSwitch2: Boolean,
    val waitingPosition: Int? = null,
    val canSignUp: Boolean,
    val canWithdraw: Boolean,
    val canChangeConsoles: Boolean,
)

@Serializable
internal data class AndroidTournamentSignupDocument(
    val schemaVersion: String,
    val tournamentId: String,
    val mode: String,
    val selection: String? = null,
    val status: String,
    val closesAtMs: Long? = null,
    val timezone: String? = null,
    val capacity: Int? = null,
    val taken: Int,
    val closedAtMs: Long? = null,
    val drawSeed: String? = null,
    val drawAlgorithm: String? = null,
    val active: List<AndroidSignupListEntry> = emptyList(),
    val waiting: List<AndroidSignupListEntry> = emptyList(),
    val viewer: AndroidSignupViewer,
)

@Serializable
internal data class AndroidSignupBoardEntry(
    val playerId: String,
    val displayName: String,
    val status: String,
    val position: Int? = null,
    val signedUpAtMs: Long,
    val attendance: String? = null,
    val hasSwitch1: Boolean,
    val hasSwitch2: Boolean,
)

@Serializable
internal data class AndroidSignupBoardSettings(
    val mode: String,
    val selection: String? = null,
    val status: String,
    val closesAtMs: Long? = null,
    val capacity: Int? = null,
    val closedAtMs: Long? = null,
    val drawSeed: String? = null,
    val drawAlgorithm: String? = null,
)

@Serializable
internal data class AndroidSignupConsoles(
    val players: Int,
    val coming: Int,
    val needed: Int,
    val warning: Boolean,
)

@Serializable
internal data class AndroidTournamentSignupBoard(
    val schemaVersion: String,
    val tournamentId: String,
    val editable: Boolean,
    val settings: AndroidSignupBoardSettings,
    val entries: List<AndroidSignupBoardEntry> = emptyList(),
    val consoles: AndroidSignupConsoles,
)

private val signupJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

/** A Tournament id that may be placed in a sign-up path as it is. */
internal val ANDROID_SIGNUP_PATH_ID = Regex("^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

/** The document of `/v1/native/tournaments/<id>/signup`, or a contract failure. */
internal fun parseAndroidTournamentSignup(payload: String): AndroidTournamentSignupDocument {
    val document = signupJson.decodeFromString<AndroidTournamentSignupDocument>(payload)
    if (document.schemaVersion != "mk8dx.tournament-signup.v1") {
        throw AndroidTournamentClientException(message = "Sign-up contract mismatch")
    }
    return document
}

/** The Director's board of `/v1/native/tournaments/<id>/signups`, or a contract failure. */
internal fun parseAndroidTournamentSignupBoard(payload: String): AndroidTournamentSignupBoard {
    val board = signupJson.decodeFromString<AndroidTournamentSignupBoard>(payload)
    if (board.schemaVersion != "mk8dx.tournament-signup-board.v1") {
        throw AndroidTournamentClientException(message = "Sign-up board contract mismatch")
    }
    return board
}

private const val SIGNUP_WEEK_MS = 6L * 86_400_000L

/** "Fri 20:00" / "vr 20:00" in the night's own time zone; a date as well when far off. */
internal fun androidSignupMoment(
    language: AndroidProductLanguage,
    atMs: Long,
    timezone: String?,
    nowMs: Long = System.currentTimeMillis(),
): String {
    val pattern = if (kotlin.math.abs(atMs - nowMs) > SIGNUP_WEEK_MS) "EEE d MMM HH:mm" else "EEE HH:mm"
    val format = SimpleDateFormat(pattern, language.locale)
    timezone?.let { zone -> format.timeZone = TimeZone.getTimeZone(zone) }
    return format.format(Date(atMs)).replace(".", "")
}

internal enum class AndroidSignupTone { Info, Success, Warning }

internal data class AndroidSignupLine(val text: String, val tone: AndroidSignupTone)

/** The one line the night says about the reader, the same words as the website. */
internal fun androidSignupStatusLine(
    language: AndroidProductLanguage,
    signup: AndroidTournamentSignupDocument,
    nowMs: Long = System.currentTimeMillis(),
): AndroidSignupLine? {
    val whenText = signup.closesAtMs?.let { androidSignupMoment(language, it, signup.timezone, nowMs) } ?: ""
    val terms = androidText(
        language,
        "Sign-up closes $whenText · ${signup.taken} of ${signup.capacity ?: 0} places",
        "Aanmelden sluit $whenText · ${signup.taken} van ${signup.capacity ?: 0} plaatsen",
    )
    return when (signup.viewer.state) {
        "signed_out", "no_player" -> if (signup.status == "open") AndroidSignupLine(terms, AndroidSignupTone.Info) else null
        "director_roster" -> AndroidSignupLine(
            androidText(language, "The Director puts the list together", "De Directeur stelt de lijst samen"),
            AndroidSignupTone.Info,
        )
        "not_signed_up" -> AndroidSignupLine(terms, AndroidSignupTone.Info)
        "pending" -> AndroidSignupLine(
            androidText(language, "You're signed up · the draw is on $whenText", "Je bent aangemeld · er wordt geloot op $whenText"),
            AndroidSignupTone.Success,
        )
        "selected" -> AndroidSignupLine(androidText(language, "You're in", "Je doet mee"), AndroidSignupTone.Success)
        "waiting" -> {
            val number = signup.viewer.waitingPosition ?: 0
            AndroidSignupLine(
                androidText(language, "Waiting list · number $number", "Wachtlijst · nummer $number"),
                AndroidSignupTone.Warning,
            )
        }
        "withdrawn" -> AndroidSignupLine(androidText(language, "You withdrew", "Je hebt je afgemeld"), AndroidSignupTone.Info)
        "removed" -> AndroidSignupLine(
            androidText(language, "The Director took you off the list", "De Directeur heeft je van de lijst gehaald"),
            AndroidSignupTone.Warning,
        )
        "closed" -> AndroidSignupLine(androidText(language, "Sign-up is closed", "Aanmelden is gesloten"), AndroidSignupTone.Info)
        else -> null
    }
}

/** The Director's warning when too few consoles are coming, or null. */
internal fun androidSignupConsoleWarning(language: AndroidProductLanguage, board: AndroidTournamentSignupBoard): String? {
    if (!board.consoles.warning) return null
    val consoles = board.consoles
    return androidText(
        language,
        "Too few consoles: ${consoles.coming} coming for ${consoles.players} players, ${consoles.needed} needed.",
        "Te weinig consoles: ${consoles.coming} komen er voor ${consoles.players} spelers, ${consoles.needed} nodig.",
    )
}

internal fun androidSignupEntryLabel(language: AndroidProductLanguage, entry: AndroidSignupBoardEntry): String =
    when (entry.status) {
        "selected" -> androidText(language, "On the list", "Op de lijst")
        "pending" -> androidText(language, "Waiting for the draw", "Wacht op de loting")
        "waiting" -> androidText(language, "Waiting list ${entry.position ?: ""}", "Wachtlijst ${entry.position ?: ""}").trim()
        "withdrawn" -> androidText(language, "Withdrew", "Afgemeld")
        "removed" -> androidText(language, "Taken off the list", "Van de lijst gehaald")
        else -> entry.status
    }

private fun AndroidSignupTone.status(): Mk8dxStatusTone = when (this) {
    AndroidSignupTone.Info -> Mk8dxStatusTone.Info
    AndroidSignupTone.Success -> Mk8dxStatusTone.Success
    AndroidSignupTone.Warning -> Mk8dxStatusTone.Warning
}

/**
 * The status line, the sign-up actions and the public lists for one night. Hidden for
 * a finished night, an old edition or when the server cannot answer.
 */
@Composable
internal fun AndroidTournamentSignupCard(
    client: AndroidTournamentClient?,
    tournamentId: String,
    modifier: Modifier = Modifier,
    /** The Tournaments tab shows only the line and the actions; the night page also the lists. */
    showLists: Boolean = true,
    /** The night's name, where the card does not sit on the night's own page. */
    title: String? = null,
    onOpenWelcome: (() -> Unit)? = null,
) {
    val language = LocalAndroidProductLanguage.current
    // Without a caller-provided route, "Link your Player" opens the community's sign-up page in the browser.
    val browser = LocalUriHandler.current
    val origin = nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin.current(LocalContext.current)
    val openWelcome: (() -> Unit)? = onOpenWelcome
        ?: origin?.let { base -> { runCatching { browser.openUri("$base/?welcome=1") } } }
    var signup by remember(client, tournamentId) { mutableStateOf<AndroidTournamentSignupDocument?>(null) }
    var ns1 by remember(client, tournamentId) { mutableStateOf(false) }
    var ns2 by remember(client, tournamentId) { mutableStateOf(false) }
    var busy by remember(client, tournamentId) { mutableStateOf(false) }
    var feedback by remember(client, tournamentId) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(client, tournamentId) {
        val active = client ?: return@LaunchedEffect
        val loaded = runCatching {
            withContext(Dispatchers.IO) { parseAndroidTournamentSignup(active.signupDocument(tournamentId)) }
        }.getOrNull()
        signup = loaded
        loaded?.let { ns1 = it.viewer.hasSwitch1; ns2 = it.viewer.hasSwitch2 }
    }

    val current = signup ?: return
    val line = androidSignupStatusLine(language, current)
    val viewer = current.viewer
    val consolesAsked = viewer.canSignUp || viewer.canChangeConsoles
    val listsShown = showLists && current.mode == "open"
    if (line == null && !consolesAsked && !viewer.canWithdraw && !listsShown) return

    fun act(work: suspend () -> String) {
        if (busy) return
        busy = true
        feedback = null
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { parseAndroidTournamentSignup(work()) } }
            busy = false
            result.onSuccess { next ->
                signup = next
                ns1 = next.viewer.hasSwitch1
                ns2 = next.viewer.hasSwitch2
            }.onFailure { failure ->
                feedback = if ((failure as? AndroidTournamentClientException)?.statusCode == 409) {
                    androidText(language, "Sign-up has closed in the meantime.", "Het aanmelden is inmiddels gesloten.")
                } else {
                    androidText(language, "That did not work. Try again later.", "Dat lukte niet. Probeer het later opnieuw.")
                }
            }
        }
    }

    val heading = if (current.mode == "open") {
        androidText(language, "Sign-up", "Aanmelden")
    } else {
        androidText(language, "Taking part", "Meedoen")
    }
    Mk8dxPanel(
        title = title?.let { "$heading · $it" } ?: heading,
        modifier = modifier,
    ) {
        line?.let { Mk8dxStatusMessage(it.text, tone = it.tone.status()) }
        if (viewer.state == "no_player" && current.status == "open") {
            Text(
                androidText(
                    language,
                    "To sign up you need a verified Player on your account. Link your Player or create one on the website (Settings).",
                    "Om je aan te melden heb je een geverifieerde Player op je account nodig. Koppel je Player of maak er een aan op de website (Instellingen).",
                ),
                style = Mk8dxTheme.type.body,
                color = Mk8dxTheme.colors.textBody,
            )
            openWelcome?.let { open ->
                Mk8dxButton(
                    androidText(language, "Link your Player", "Koppel je Player"),
                    open,
                    variant = Mk8dxButtonVariant.Secondary,
                    tag = "signup-link-player",
                )
            }
        }
        if (consolesAsked) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                Text(
                    androidText(language, "Which consoles do you bring?", "Welke consoles neem je mee?"),
                    style = Mk8dxTheme.type.micro,
                    color = Mk8dxTheme.colors.textSecondary,
                )
                Mk8dxToggleRow(
                    label = androidText(language, "I bring a Switch 1", "Ik neem een Switch 1 mee"),
                    checked = ns1,
                    onCheckedChange = { ns1 = it },
                    onText = androidText(language, "Yes", "Ja"),
                    offText = androidText(language, "No", "Nee"),
                )
                Mk8dxToggleRow(
                    label = androidText(language, "I bring a Switch 2", "Ik neem een Switch 2 mee"),
                    checked = ns2,
                    onCheckedChange = { ns2 = it },
                    onText = androidText(language, "Yes", "Ja"),
                    offText = androidText(language, "No", "Nee"),
                )
                Mk8dxButton(
                    when {
                        busy -> androidText(language, "Saving…", "Opslaan…")
                        !viewer.canSignUp -> androidText(language, "Change consoles", "Consoles wijzigen")
                        viewer.state == "withdrawn" -> androidText(language, "Sign up again", "Opnieuw aanmelden")
                        else -> androidText(language, "Sign up", "Aanmelden")
                    },
                    { client?.let { active -> act { active.signUpDocument(tournamentId, ns1, ns2) } } },
                    variant = if (viewer.canSignUp) Mk8dxButtonVariant.Primary else Mk8dxButtonVariant.Secondary,
                    tag = "signup-save",
                )
            }
        }
        if (viewer.canWithdraw) {
            Mk8dxButton(
                androidText(language, "Withdraw", "Afmelden"),
                { client?.let { active -> act { active.withdrawSignupDocument(tournamentId) } } },
                variant = Mk8dxButtonVariant.Quiet,
                tag = "signup-withdraw",
            )
        }
        feedback?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Error) }
        if (listsShown) {
            Text(
                androidText(language, "On the list (${current.active.size})", "Op de lijst (${current.active.size})"),
                style = Mk8dxTheme.type.body,
                color = Mk8dxTheme.colors.textPrimary,
            )
            Text(
                if (current.active.isEmpty()) {
                    androidText(language, "Nobody yet.", "Nog niemand.")
                } else {
                    current.active.joinToString("\n") { "${it.position}. ${it.displayName}" }
                },
                style = Mk8dxTheme.type.micro,
                color = Mk8dxTheme.colors.textBody,
            )
            if (current.waiting.isNotEmpty() || current.status == "closed") {
                Text(
                    androidText(language, "Waiting list (${current.waiting.size})", "Wachtlijst (${current.waiting.size})"),
                    style = Mk8dxTheme.type.body,
                    color = Mk8dxTheme.colors.textPrimary,
                )
                Text(
                    if (current.waiting.isEmpty()) {
                        androidText(language, "Nobody is waiting.", "Niemand wacht.")
                    } else {
                        current.waiting.joinToString("\n") { "${it.position}. ${it.displayName}" }
                    },
                    style = Mk8dxTheme.type.micro,
                    color = Mk8dxTheme.colors.textBody,
                )
            }
            current.drawSeed?.let { seed ->
                Text(
                    androidText(
                        language,
                        "Drawn with seed $seed (${current.drawAlgorithm ?: ""}).",
                        "Geloot met seed $seed (${current.drawAlgorithm ?: ""}).",
                    ),
                    style = Mk8dxTheme.type.micro,
                    color = Mk8dxTheme.colors.textSecondary,
                )
            }
        }
    }
}

/**
 * The Director's view of the night's sign-ups on the Step 2 board: the terms, every
 * sign-up in order with its consoles, and the warning when too few consoles come.
 * Terms and moves by hand are set on the website; the roster below stays editable here.
 */
@Composable
internal fun AndroidTournamentSignupBoardPanel(
    client: AndroidTournamentClient?,
    tournamentId: String,
    revision: Int,
    modifier: Modifier = Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    var board by remember(client, tournamentId) { mutableStateOf<AndroidTournamentSignupBoard?>(null) }
    LaunchedEffect(client, tournamentId, revision) {
        val active = client ?: return@LaunchedEffect
        board = runCatching {
            withContext(Dispatchers.IO) { parseAndroidTournamentSignupBoard(active.signupBoardDocument(tournamentId)) }
        }.getOrNull()
    }
    val current = board ?: return
    val settings = current.settings
    if (settings.mode != "open" && current.entries.isEmpty()) return
    Mk8dxPanel(title = androidText(language, "Sign-up", "Aanmelden"), modifier = modifier) {
        val terms = when {
            settings.mode != "open" -> androidText(language, "The Director puts the list together", "De Directeur stelt de lijst samen")
            settings.status == "closed" -> {
                val closed = settings.closedAtMs?.let {
                    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, language.locale).format(Date(it))
                } ?: ""
                androidText(language, "Closed $closed", "Gesloten $closed").trim()
            }
            else -> {
                val until = settings.closesAtMs?.let { androidSignupMoment(language, it, null) } ?: ""
                val selection = if (settings.selection == "draw") {
                    androidText(language, "a draw at closing", "loting bij sluiten")
                } else {
                    androidText(language, "first come, first served", "wie het eerst komt")
                }
                androidText(
                    language,
                    "Open until $until · maximum ${settings.capacity ?: 0} · $selection",
                    "Open tot $until · maximum ${settings.capacity ?: 0} · $selection",
                )
            }
        }
        Text(terms, style = Mk8dxTheme.type.body, color = Mk8dxTheme.colors.textBody)
        settings.drawSeed?.let { seed ->
            Text(
                androidText(language, "Draw seed $seed", "Lotingsseed $seed"),
                style = Mk8dxTheme.type.micro,
                color = Mk8dxTheme.colors.textSecondary,
            )
        }
        androidSignupConsoleWarning(language, current)?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Warning) }
        if (current.entries.isNotEmpty()) {
            Text(
                current.entries.joinToString("\n") { entry ->
                    val consoles = listOfNotNull(
                        "NS1".takeIf { entry.hasSwitch1 },
                        "NS2".takeIf { entry.hasSwitch2 },
                    ).joinToString(" + ").ifEmpty { androidText(language, "no console", "geen console") }
                    "${entry.displayName} · ${androidSignupEntryLabel(language, entry)} · $consoles"
                },
                style = Mk8dxTheme.type.micro,
                color = Mk8dxTheme.colors.textBody,
            )
        }
        Text(
            androidText(
                language,
                "Change the terms or move people by hand on the website (Step 2 → Sign-up).",
                "Wijzig de voorwaarden of verplaats mensen met de hand op de website (Stap 2 → Aanmelden).",
            ),
            style = Mk8dxTheme.type.micro,
            color = Mk8dxTheme.colors.textSecondary,
        )
    }
}
