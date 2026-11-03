package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCanonicalSubmissionHttpsExecutorDeviceTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = false
    }

    @Test
    fun executesExactAuthenticatedBoundedRequestOnAndroidRuntime() {
        val submission = submission()
        val acknowledgement = buildJsonObject {
            put("submissionId", submission.getValue("submissionId"))
            put("revision", submission.getValue("revision"))
        }
        lateinit var openedUrl: URL
        lateinit var connection: DeviceFakeHttpsURLConnection
        var calls = 0
        val transport = createAndroidCanonicalSubmissionRequestTransport(
            AndroidCanonicalSubmissionHttpsExecutor(
                origin = "https://api.example.test:8443",
                connectionFactory = { url ->
                    calls += 1
                    openedUrl = url
                    DeviceFakeHttpsURLConnection(
                        url,
                        acknowledgement.toString().toByteArray(),
                    ).also {
                        it.setRequestProperty("X-Test-Authentication", "synthetic-device-proof")
                        connection = it
                    }
                },
            ),
        )

        val result = transport.submit(submission)

        assertEquals(acknowledgement, result)
        assertEquals(1, calls)
        assertEquals(
            "https://api.example.test:8443/v1/time-trial-submissions?feedback=v2",
            openedUrl.toString(),
        )
        assertEquals("POST", connection.requestMethod)
        assertFalse(connection.instanceFollowRedirects)
        assertFalse(connection.useCaches)
        assertEquals("application/json", connection.getRequestProperty("Accept"))
        assertEquals("application/json", connection.getRequestProperty("Content-Type"))
        assertEquals(
            "synthetic-device-proof",
            connection.getRequestProperty("X-Test-Authentication"),
        )
        assertEquals(connection.writtenBody().size.toLong(), connection.fixedLength())
        assertEquals(submission, json.parseToJsonElement(connection.writtenBody().decodeToString()))
        assertTrue(connection.disconnected)
    }

    private fun submission(): JsonObject {
        val value = createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.ANDROIDHTTPSDEVICE01",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    "https-device-profile",
                ),
                createdAtMs = 1_786_903_000_000,
                producerVersion = "android-https-device-test",
            ),
            mode = 150,
            timeDigits = "123456",
        )
        return json.parseToJsonElement(
            json.encodeToString(AndroidManualTimeTrialSubmissionV1.serializer(), value),
        ) as JsonObject
    }
}

private class DeviceFakeHttpsURLConnection(
    url: URL,
    private val responseBody: ByteArray,
) : HttpsURLConnection(url) {
    private val output = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun connect() = Unit

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false

    override fun getCipherSuite(): String = "TLS_SYNTHETIC_DEVICE"

    override fun getLocalCertificates(): Array<Certificate>? = null

    override fun getServerCertificates(): Array<Certificate> = emptyArray()

    override fun getOutputStream(): OutputStream = output

    override fun getInputStream(): InputStream = ByteArrayInputStream(responseBody)

    override fun getResponseCode(): Int = 201

    override fun getContentType(): String = "application/json"

    override fun getContentLengthLong(): Long = responseBody.size.toLong()

    fun fixedLength(): Long = when {
        fixedContentLengthLong >= 0 -> fixedContentLengthLong
        else -> fixedContentLength.toLong()
    }

    fun writtenBody(): ByteArray = output.toByteArray()
}
