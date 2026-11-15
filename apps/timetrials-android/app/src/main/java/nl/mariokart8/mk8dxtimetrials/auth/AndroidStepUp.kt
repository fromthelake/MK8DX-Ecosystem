package nl.mariokart8.mk8dxtimetrials.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClientException
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import java.io.ByteArrayOutputStream
import java.net.URI

/**
 * Fresh e-mail confirmation (step-up) before a dangerous administrator action.
 *
 * Owner decision 2026-11-15: the phone's bearer is the whole account, so the
 * server answers a dangerous action with 403 `step_up_required` until this
 * session has confirmed a new link sent to the account's own address. The app
 * asks the server to send it; the person opens the email (in any browser),
 * presses Confirm on the page it opens, and the app notices by polling and
 * repeats the action once. No token ever passes through the app.
 */
internal const val STEP_UP_HEADER = "x-mk8dx-step-up"
private const val STEP_UP_PATH = "/v1/session/step-up"
private const val STEP_UP_SCHEMA = "mk8dx.step-up.v1"
private const val MAX_STEP_UP_RESPONSE_BYTES = 8_192

internal class AndroidStepUpRequiredException : RuntimeException("A fresh confirmation by email is needed.")

/** Whether a failed request was refused only for want of a fresh confirmation. */
internal fun Throwable.isStepUpRequired(): Boolean =
    this is AndroidStepUpRequiredException ||
        (this is AndroidTournamentClientException && statusCode == 403 && code == "step_up_required")

internal data class AndroidStepUpStatus(val active: Boolean, val pending: Boolean, val windowSeconds: Int)

internal class AndroidStepUpException(
    val kind: Kind,
    val retryAfterSeconds: Int? = null,
    /** For [Kind.MailUnavailable]: until when the link the server created can still be confirmed. */
    val linkExpiresAtMs: Long? = null,
) : RuntimeException("The confirmation email could not be requested.") {
    /** MailUnavailable: the link was created but the e-mail failed; the operator can hand it over. */
    enum class Kind { RateLimited, SignedOut, Unavailable, MailUnavailable }
}

private val stepUpJson = Json { ignoreUnknownKeys = false }

/** Parses the server's status document; anything else is refused. */
internal fun parseAndroidStepUpStatus(body: String): AndroidStepUpStatus {
    val root = runCatching { stepUpJson.parseToJsonElement(body).jsonObject }.getOrNull()
        ?: throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
    val expected = setOf("schemaVersion", "active", "expiresAtMs", "pending", "windowSeconds")
    val active = root["active"]?.jsonPrimitive?.booleanOrNull
    val pending = root["pending"]?.jsonPrimitive?.booleanOrNull
    val window = root["windowSeconds"]?.jsonPrimitive?.longOrNull
    if (root.keys != expected || root["schemaVersion"]?.jsonPrimitive?.content != STEP_UP_SCHEMA ||
        active == null || pending == null || window == null || window !in 1..86_400
    ) {
        throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
    }
    return AndroidStepUpStatus(active, pending, window.toInt())
}

/**
 * The server's 503 answer when it created the link but could not e-mail it
 * (`step_up_mail_unavailable`, with the link's expiry). Exactly that document,
 * or null: any other 503 stays a plain "could not be sent".
 */
internal fun parseAndroidStepUpMailUnavailable(body: String): Long? {
    val root = runCatching { stepUpJson.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
    if (root.keys != setOf("code", "message", "linkExpiresAtMs")) return null
    val code = root["code"]?.let { runCatching { it.jsonPrimitive }.getOrNull() }
    val message = root["message"]?.let { runCatching { it.jsonPrimitive }.getOrNull() }
    val until = root["linkExpiresAtMs"]?.let { runCatching { it.jsonPrimitive }.getOrNull() }
    if (code == null || !code.isString || code.content != "step_up_mail_unavailable") return null
    if (message == null || !message.isString) return null
    if (until == null || until.isString) return null
    val expiresAtMs = until.longOrNull ?: return null
    return expiresAtMs.takeIf { it > 0 }
}

internal class AndroidStepUpClient(
    origin: String,
    private val session: AndroidAuthenticatedNativeSession,
    private val opener: AndroidTournamentConnectionOpener,
) {
    private val origin = URI(origin)

    /** Asks the server to email a new confirmation link for this app session. */
    fun request() {
        val (status, body, retryAfter) = call("POST", "{}")
        val mailFailedLinkExpiresAtMs = if (status == 503) parseAndroidStepUpMailUnavailable(body) else null
        when {
            status == 202 -> Unit
            mailFailedLinkExpiresAtMs != null -> throw AndroidStepUpException(
                AndroidStepUpException.Kind.MailUnavailable,
                linkExpiresAtMs = mailFailedLinkExpiresAtMs,
            )
            status == 429 -> throw AndroidStepUpException(AndroidStepUpException.Kind.RateLimited, retryAfter)
            status == 401 -> throw AndroidStepUpException(AndroidStepUpException.Kind.SignedOut)
            else -> throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
        }
    }

    fun status(): AndroidStepUpStatus {
        val (status, body, _) = call("GET", null)
        if (status == 401) throw AndroidStepUpException(AndroidStepUpException.Kind.SignedOut)
        if (status != 200) throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
        return parseAndroidStepUpStatus(body)
    }

    private fun call(method: String, body: String?): Triple<Int, String, Int?> {
        val target = URI(origin.scheme, null, origin.host, origin.port, STEP_UP_PATH, null, null)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${session.bearerToken}")
            if (body != null) {
                val encoded = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(encoded.size)
                connection.outputStream.use { it.write(encoded) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(2_048)
                while (output.size() <= MAX_STEP_UP_RESPONSE_BYTES) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
                if (output.size() > MAX_STEP_UP_RESPONSE_BYTES) throw AndroidStepUpException(AndroidStepUpException.Kind.Unavailable)
                output.toString(Charsets.UTF_8.name())
            }.orEmpty()
            val retryAfter = connection.getHeaderField("Retry-After")?.toIntOrNull()?.takeIf { it > 0 }
            return Triple(status, text, retryAfter)
        } finally {
            connection.disconnect()
        }
    }
}

/**
 * Runs an action and, when the server asks for a fresh confirmation, shows the
 * dialog once and repeats the action once after the session is confirmed.
 * Cancelling rethrows the original refusal, so the caller's message stays true.
 */
internal class AndroidStepUpController {
    var prompt by mutableStateOf<CompletableDeferred<Boolean>?>(null)
        private set

    suspend fun <T> guarded(block: suspend () -> T): T {
        try {
            return block()
        } catch (failure: Throwable) {
            if (!failure.isStepUpRequired()) throw failure
            val decision = CompletableDeferred<Boolean>()
            prompt = decision
            val confirmed = try { decision.await() } finally { if (prompt === decision) prompt = null }
            if (!confirmed) throw failure
            return block()
        }
    }

    fun answer(confirmed: Boolean) {
        prompt?.complete(confirmed)
    }
}

/** The dialog for [AndroidStepUpController]; place it once in the screen that uses the controller. */
@Composable
internal fun AndroidStepUpDialog(
    controller: AndroidStepUpController,
    client: () -> AndroidStepUpClient?,
    pollIntervalMs: Long = 3_000,
) {
    val prompt = controller.prompt ?: return
    val scope = rememberCoroutineScope()
    var sent by remember(prompt) { mutableStateOf(false) }
    var sending by remember(prompt) { mutableStateOf(false) }
    var message by remember(prompt) { mutableStateOf<Pair<Mk8dxStatusTone, String>?>(null) }
    val texts = AndroidStepUpTexts(
        intro = androidText(
            "This action needs a fresh confirmation. We send a one-time link to your account's email address. " +
                "Open it, on this device or another one, and press Confirm. Then this action continues by itself.",
            "Voor deze actie is een nieuwe bevestiging nodig. We sturen een eenmalige link naar het e-mailadres van " +
                "je account. Open die, op dit apparaat of een ander, en druk op Bevestigen. Daarna gaat deze actie vanzelf verder.",
        ),
        waiting = androidText(
            "Check your inbox and open the link. This window waits for your confirmation.",
            "Kijk in je inbox en open de link. Dit venster wacht op je bevestiging.",
        ),
        rateLimited = androidText(
            "Too many links were requested. Wait a few minutes and try again.",
            "Er zijn te veel links aangevraagd. Wacht een paar minuten en probeer het opnieuw.",
        ),
        signedOut = androidText("You are signed out. Sign in again first.", "Je bent afgemeld. Meld je eerst opnieuw aan."),
        failed = androidText("The link could not be sent. Please retry.", "De link kon niet worden verstuurd. Probeer het opnieuw."),
        // The web's wording (step-up-dialog.ts), so every catalog already has it.
        mailUnavailable = androidText(
            "The confirmation link was created, but the email could not be sent. Ask the server operator to run python tooling/install.py step-up-link on the server and give you the link. Open it and this window continues.",
            "De bevestigingslink is aangemaakt, maar de e-mail kon niet worden verstuurd. Vraag de serverbeheerder om op de server python tooling/install.py step-up-link uit te voeren en je de link te geven. Open die en dit venster gaat verder.",
        ),
        expired = androidText(
            "The link has expired. Send a new one to continue.",
            "De link is verlopen. Stuur een nieuwe om verder te gaan.",
        ),
    )

    // Until when the waiting below lasts: ten minutes after a sent mail, or the
    // created link's own expiry when only the e-mail failed.
    var waitUntilMs by remember(prompt) { mutableStateOf<Long?>(null) }

    // Waits for the confirmation made in the browser; ends when the dialog does.
    LaunchedEffect(prompt, sent, waitUntilMs) {
        if (!sent && waitUntilMs == null) return@LaunchedEffect
        val stepUp = client() ?: return@LaunchedEffect
        val deadline = waitUntilMs ?: (System.currentTimeMillis() + 10 * 60_000L)
        while (!prompt.isCompleted) {
            delay(pollIntervalMs)
            val status = runCatching { withContext(Dispatchers.IO) { stepUp.status() } }.getOrNull() ?: continue
            if (status.active) {
                controller.answer(true)
                return@LaunchedEffect
            }
            if (!status.pending && System.currentTimeMillis() > deadline) {
                sent = false
                waitUntilMs = null
                message = Mk8dxStatusTone.Warning to texts.expired
                return@LaunchedEffect
            }
        }
    }

    val colors = Mk8dxTheme.colors
    Mk8dxDialog(
        title = androidText("Confirm with a new email link", "Bevestig met een nieuwe e-maillink"),
        closeLabel = androidText("Cancel", "Annuleren"),
        onDismiss = { controller.answer(false) },
        modifier = Modifier.testTag("step-up-dialog"),
    ) {
        Text(texts.intro, style = Mk8dxTheme.type.body, color = colors.textPrimary)
        message?.let { (tone, text) -> Mk8dxStatusMessage(text, tone = tone) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            Mk8dxButton(
                androidText("Cancel", "Annuleren"),
                onClick = { controller.answer(false) },
                variant = Mk8dxButtonVariant.Secondary,
            )
            Mk8dxButton(
                androidText("Send the link", "Stuur de link"),
                onClick = {
                    val stepUp = client() ?: return@Mk8dxButton
                    sending = true
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { stepUp.request() } }
                            .onSuccess {
                                waitUntilMs = null
                                sent = true
                                message = Mk8dxStatusTone.Info to texts.waiting
                            }
                            .onFailure { failure ->
                                val stepUpFailure = failure as? AndroidStepUpException
                                val kind = stepUpFailure?.kind
                                val linkExpiresAtMs = stepUpFailure?.linkExpiresAtMs
                                if (kind == AndroidStepUpException.Kind.MailUnavailable && linkExpiresAtMs != null) {
                                    // The link exists; only the e-mail failed. The operator hands it over,
                                    // and this window keeps waiting for the confirmation. Like the web,
                                    // the button stays available for a new attempt.
                                    waitUntilMs = linkExpiresAtMs
                                    message = Mk8dxStatusTone.Error to texts.mailUnavailable
                                    return@onFailure
                                }
                                message = Mk8dxStatusTone.Error to when (kind) {
                                    AndroidStepUpException.Kind.RateLimited -> texts.rateLimited
                                    AndroidStepUpException.Kind.SignedOut -> texts.signedOut
                                    else -> texts.failed
                                }
                            }
                        sending = false
                    }
                },
                variant = Mk8dxButtonVariant.Primary,
                disabledReason = when {
                    sent -> androidText("The link was sent.", "De link is verstuurd.")
                    sending -> androidText("Sending…", "Versturen…")
                    else -> null
                },
                modifier = Modifier.testTag("step-up-send"),
            )
        }
    }
}

private data class AndroidStepUpTexts(
    val intro: String,
    val waiting: String,
    val rateLimited: String,
    val signedOut: String,
    val failed: String,
    val mailUnavailable: String,
    val expired: String,
)
