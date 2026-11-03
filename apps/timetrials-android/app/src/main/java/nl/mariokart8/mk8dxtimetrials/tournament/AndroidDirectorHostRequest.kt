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
import java.text.DateFormat
import java.util.Date
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
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * "Request to host" on the Tournaments tab (ADR-0220), the twin of the website's
 * `director-host-request-section.ts`.
 *
 * "Director" is the one word for whoever hosts Tournament nights. A signed-in
 * account that is neither administrator nor Director reads how to become one and
 * may ask, with an optional short note; the request lands in the administrators'
 * inbox and they decide on the website. The card then says where the request
 * stands: sent on a date, or declined with the reason and the option to ask again.
 */

@Serializable
internal data class AndroidHostRequest(
    val requestId: String,
    val status: String,
    val note: String? = null,
    val requestedAtMs: Long,
    val decidedAtMs: Long? = null,
    val declineReason: String? = null,
)

@Serializable
internal data class AndroidHostRequestStanding(
    val schemaVersion: String,
    val administrator: Boolean,
    val director: Boolean,
    val request: AndroidHostRequest? = null,
)

internal const val ANDROID_HOST_REQUEST_NOTE_MAXIMUM = 300

private val hostRequestJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

/** The standing document of `/v1/native/director-host-request`, or a contract failure. */
internal fun parseAndroidHostRequestStanding(payload: String): AndroidHostRequestStanding {
    val standing = hostRequestJson.decodeFromString<AndroidHostRequestStanding>(payload)
    if (standing.schemaVersion != "mk8dx.director-host-request.v1") {
        throw AndroidTournamentClientException(message = "Host request contract mismatch")
    }
    return standing
}

/** Administrators and Directors never see the card. */
internal fun AndroidHostRequestStanding.showsCard(): Boolean = !administrator && !director

/** A trimmed note of at most 300 characters; an empty one is no note. */
internal fun androidHostRequestNote(value: String): String? =
    value.trim().takeIf { it.isNotEmpty() }

internal fun androidHostRequestDay(language: AndroidProductLanguage, atMs: Long): String =
    DateFormat.getDateInstance(DateFormat.LONG, language.locale).format(Date(atMs))

/** What the card says about the request already made, or null when there is none to report. */
internal fun androidHostRequestStatusLine(language: AndroidProductLanguage, request: AndroidHostRequest?): String? {
    if (request == null) return null
    return when (request.status) {
        "open" -> {
            val day = androidHostRequestDay(language, request.requestedAtMs)
            androidText(
                language,
                "Request sent on $day. The administrators will answer it.",
                "Verzoek verstuurd op $day. De beheerders beantwoorden het.",
            )
        }
        "declined" -> {
            val reason = request.declineReason
            if (reason == null) {
                val day = androidHostRequestDay(language, request.decidedAtMs ?: request.requestedAtMs)
                androidText(language, "Declined on $day.", "Afgewezen op $day.")
            } else {
                androidText(language, "Declined: $reason", "Afgewezen: $reason")
            }
        }
        else -> null
    }
}

@Composable
internal fun AndroidDirectorHostRequestCard(
    client: AndroidTournamentClient?,
    modifier: Modifier = Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    var standing by remember(client) { mutableStateOf<AndroidHostRequestStanding?>(null) }
    var note by remember(client) { mutableStateOf("") }
    var sending by remember(client) { mutableStateOf(false) }
    var feedback by remember(client) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(client) {
        val active = client ?: return@LaunchedEffect
        standing = runCatching {
            withContext(Dispatchers.IO) { parseAndroidHostRequestStanding(active.hostRequestStandingDocument()) }
        }.getOrNull()
    }

    val current = standing ?: return
    if (!current.showsCard()) return
    val request = current.request

    Mk8dxPanel(
        title = androidText(language, "Host your own Tournament nights", "Zelf toernooiavonden hosten"),
        modifier = modifier,
    ) {
        Text(
            androidText(
                language,
                "Tournament nights are hosted by Directors. A Director creates a night, fills its list, runs the groups and enters the scores. To become one, ask the administrators: they decide and you hear back here and in your notifications.",
                "Toernooiavonden worden gehost door Directeuren. Een Directeur maakt een avond aan, vult de deelnemerslijst, deelt de groepen in en voert de scores in. Wil je er een worden? Vraag het de beheerders: zij beslissen en je hoort het hier en in je meldingen.",
            ),
            style = Mk8dxTheme.type.body,
            color = Mk8dxTheme.colors.textBody,
        )
        androidHostRequestStatusLine(language, request)?.let { line ->
            Mk8dxStatusMessage(
                line,
                tone = if (request?.status == "declined") Mk8dxStatusTone.Warning else Mk8dxStatusTone.Info,
            )
        }
        if (request?.status == "open") {
            request.note?.let { own ->
                Text(
                    androidText(language, "Your note: $own", "Jouw notitie: $own"),
                    style = Mk8dxTheme.type.micro,
                    color = Mk8dxTheme.colors.textSecondary,
                )
            }
            return@Mk8dxPanel
        }
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
            Mk8dxTextField(
                label = androidText(
                    language,
                    "A short note for the administrators (optional)",
                    "Een korte notitie voor de beheerders (optioneel)",
                ),
                value = note,
                onValueChange = { next -> note = next.take(ANDROID_HOST_REQUEST_NOTE_MAXIMUM) },
                hint = androidText(
                    language,
                    "For example where and how often you would host. At most 300 characters.",
                    "Bijvoorbeeld waar en hoe vaak je zou hosten. Hooguit 300 tekens.",
                ),
                singleLine = false,
                tag = "host-request-note",
            )
            Mk8dxButton(
                if (sending) {
                    androidText(language, "Sending…", "Versturen…")
                } else if (request?.status == "declined") {
                    androidText(language, "Ask again", "Opnieuw vragen")
                } else {
                    androidText(language, "Request to host", "Verzoek om te hosten")
                },
                {
                    val active = client ?: return@Mk8dxButton
                    if (sending) return@Mk8dxButton
                    sending = true
                    feedback = null
                    scope.launch {
                        val result = runCatching {
                            withContext(Dispatchers.IO) {
                                parseAndroidHostRequestStanding(active.submitHostRequestDocument(androidHostRequestNote(note)))
                            }
                        }
                        sending = false
                        result.onSuccess { standing = it; note = "" }.onFailure { failure ->
                            feedback = if ((failure as? AndroidTournamentClientException)?.statusCode == 409) {
                                androidText(language, "You already have a request waiting.", "Je hebt al een verzoek dat wacht.")
                            } else {
                                androidText(
                                    language,
                                    "The request could not be sent. Try again later.",
                                    "Het verzoek kon niet worden verstuurd. Probeer het later opnieuw.",
                                )
                            }
                        }
                    }
                },
                variant = Mk8dxButtonVariant.Primary,
                tag = "host-request-send",
            )
            feedback?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Error) }
        }
    }
}
