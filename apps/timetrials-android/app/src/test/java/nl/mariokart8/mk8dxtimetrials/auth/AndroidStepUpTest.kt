package nl.mariokart8.mk8dxtimetrials.auth

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidIdentityLinkClient
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidIdentityLinkException
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClient
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClientException
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidStepUpTest {
    private val session = AndroidAuthenticatedNativeSession(
        bearerToken = "token-for-step-up-tests",
        expiresAtMs = 1_800_000_000_000,
        playerId = "player.ben",
    )
    private val stepUpBody = """{"statusCode":403,"error":"Forbidden","code":"step_up_required","message":"Confirm this action with a new email link."}"""

    @Test
    fun identityLinkClientReportsAStepUpSeparatelyFromAPlainRefusal() {
        val needsStepUp = AndroidIdentityLinkClient("https://example.invalid", session, AndroidTournamentConnectionOpener { url ->
            StepUpFakeConnection(url, 403, errorBody = stepUpBody, headers = mapOf(STEP_UP_HEADER to "required"))
        })
        val failure = runCatching { needsStepUp.overview() }.exceptionOrNull()
        assertTrue(failure is AndroidStepUpRequiredException)
        assertTrue(failure!!.isStepUpRequired())

        val refused = AndroidIdentityLinkClient("https://example.invalid", session, AndroidTournamentConnectionOpener { url ->
            StepUpFakeConnection(url, 403, errorBody = """{"code":"not_authorized","message":"no"}""")
        })
        val plain = runCatching { refused.overview() }.exceptionOrNull()
        assertTrue(plain is AndroidIdentityLinkException && plain.forbidden)
        assertFalse(plain!!.isStepUpRequired())
    }

    @Test
    fun tournamentRemovalCarriesTheStepUpCode() {
        val client = AndroidTournamentClient("https://example.invalid", session, AndroidTournamentConnectionOpener { url ->
            StepUpFakeConnection(url, 403, errorBody = stepUpBody, headers = mapOf(STEP_UP_HEADER to "required"))
        })
        val failure = assertThrows(AndroidTournamentClientException::class.java) {
            client.removeTournament("tournament.demo", "Removed in a test")
        }
        assertTrue(failure.isStepUpRequired())
        assertFalse(AndroidTournamentClientException(409, "conflict", code = "tournament_conflict").isStepUpRequired())
    }

    @Test
    fun stepUpClientSendsWithTheBearerAndReadsTheStatus() {
        val opened = mutableListOf<StepUpFakeConnection>()
        val client = AndroidStepUpClient("https://example.invalid", session, AndroidTournamentConnectionOpener { url ->
            val next = if (opened.isEmpty()) {
                StepUpFakeConnection(url, 202, """{"schemaVersion":"mk8dx.step-up.v1","status":"sent","linkExpiresAtMs":5,"windowSeconds":600}""")
            } else {
                StepUpFakeConnection(url, 200, """{"schemaVersion":"mk8dx.step-up.v1","active":true,"expiresAtMs":9,"pending":false,"windowSeconds":600}""")
            }
            opened += next
            next
        })
        client.request()
        assertEquals("POST", opened[0].requestMethod)
        assertEquals("https://example.invalid/v1/session/step-up", opened[0].url.toString())
        assertEquals("Bearer ${session.bearerToken}", opened[0].getRequestProperty("Authorization"))
        assertEquals(AndroidStepUpStatus(active = true, pending = false, windowSeconds = 600), client.status())
        assertEquals("GET", opened[1].requestMethod)
    }

    @Test
    fun stepUpClientReportsTheRateLimitAndRefusesUnknownDocuments() {
        val limited = AndroidStepUpClient("https://example.invalid", session, AndroidTournamentConnectionOpener { url ->
            StepUpFakeConnection(url, 429, errorBody = """{"code":"step_up_rate_limited","message":"later"}""", headers = mapOf("Retry-After" to "120"))
        })
        val failure = assertThrows(AndroidStepUpException::class.java) { limited.request() }
        assertEquals(AndroidStepUpException.Kind.RateLimited, failure.kind)
        assertEquals(120, failure.retryAfterSeconds)
        assertThrows(AndroidStepUpException::class.java) {
            parseAndroidStepUpStatus("""{"schemaVersion":"mk8dx.step-up.v1","active":true,"expiresAtMs":9,"pending":false,"windowSeconds":600,"extra":1}""")
        }
    }

    @Test
    fun controllerRepeatsTheActionOnceAfterConfirmationAndNotAfterCancel() = runBlocking {
        val controller = AndroidStepUpController()
        var attempts = 0
        val confirmed = launch {
            val result = controller.guarded {
                attempts += 1
                if (attempts == 1) throw AndroidStepUpRequiredException()
                "done"
            }
            assertEquals("done", result)
        }
        while (controller.prompt == null) yield()
        controller.answer(true)
        confirmed.join()
        assertEquals(2, attempts)

        var cancelledAttempts = 0
        val cancelled = launch {
            val outcome = runCatching {
                controller.guarded<Unit> {
                    cancelledAttempts += 1
                    throw AndroidStepUpRequiredException()
                }
            }
            assertTrue(outcome.exceptionOrNull() is AndroidStepUpRequiredException)
        }
        while (controller.prompt == null) yield()
        controller.answer(false)
        cancelled.join()
        assertEquals(1, cancelledAttempts)

        // Any other failure passes straight through without a dialog.
        val other = runCatching { controller.guarded<Unit> { throw IllegalStateException("offline") } }
        assertTrue(other.exceptionOrNull() is IllegalStateException)
        assertEquals(null, controller.prompt)
    }
}

private class StepUpFakeConnection(
    url: URL,
    private val statusCode: Int,
    responseBody: String = "",
    errorBody: String? = null,
    private val headers: Map<String, String> = emptyMap(),
) : HttpsURLConnection(url) {
    private val response = ByteArrayInputStream(responseBody.toByteArray())
    private val error = errorBody?.let { ByteArrayInputStream(it.toByteArray()) }
    private val output = ByteArrayOutputStream()

    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
    override fun getCipherSuite(): String = "TLS_SYNTHETIC"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
    override fun getResponseCode(): Int = statusCode
    override fun getInputStream(): InputStream = response
    override fun getErrorStream(): InputStream? = error
    override fun getOutputStream(): OutputStream = output
    override fun getHeaderField(name: String?): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}
