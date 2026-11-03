package nl.mariokart8.mk8dxtimetrials.outbox

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
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
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCanonicalSubmissionHttpsExecutorTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = false
    }

    @Test
    fun rejectsNonOriginOrNonHttpsConfigurationWithoutOpeningAConnection() {
        val invalidOrigins = listOf(
            "",
            "http://api.example.test",
            "https:///missing-host",
            "https://user@api.example.test",
            "https://api.example.test/base",
            "https://api.example.test?query=true",
            "https://api.example.test#fragment",
            "https://api.example.test:0",
            "https://api.example.test:" + "9".repeat(70),
            "https://" + "a".repeat(2_049),
        )
        invalidOrigins.forEach { origin ->
            var calls = 0

            val error = assertThrows(IllegalArgumentException::class.java) {
                AndroidCanonicalSubmissionHttpsExecutor(origin, connectionFactory = {
                    calls += 1
                    FakeHttpsURLConnection(it)
                })
            }

            assertEquals("Invalid canonical submission HTTPS configuration", error.message)
            assertEquals(0, calls)
            if (origin.isNotEmpty()) assertFalse(error.message.orEmpty().contains(origin))
        }
        listOf(0, 60_001).forEach { timeout ->
            assertThrows(IllegalArgumentException::class.java) {
                AndroidCanonicalSubmissionHttpsExecutor(
                    origin = "https://api.example.test",
                    connectionFactory = { FakeHttpsURLConnection(it) },
                    connectTimeoutMs = timeout,
                )
            }
        }
    }

    @Test
    fun rejectsAnyWidenedRequestBeforeOpeningAConnection() {
        val request = request()
        val invalidRequests = listOf(
            request.copy(method = "GET"),
            request.copy(path = "/v1/other"),
            request.copy(headers = request.headers + ("Authorization" to "synthetic")),
            request.copy(body = request.body + " "),
            request.copy(responseMaxBytes = request.responseMaxBytes + 1),
            request.copy(followRedirects = true),
            request.copy(automaticRetryAllowed = true),
            request.copy(body = "x".repeat(LOCAL_OUTBOX_MAX_SUBMISSION_BYTES + 1)),
        )
        invalidRequests.forEach { invalid ->
            var calls = 0
            val executor = AndroidCanonicalSubmissionHttpsExecutor(
                origin = "https://api.example.test",
                connectionFactory = {
                    calls += 1
                    FakeHttpsURLConnection(it)
                },
            )

            val error = assertThrows(IllegalArgumentException::class.java) {
                executor.execute(invalid)
            }

            assertEquals("Invalid canonical submission HTTPS request", error.message)
            assertEquals(0, calls)
            assertFalse(error.message.orEmpty().contains("Authorization"))
        }
    }

    @Test
    fun sendsOneFixedLengthRequestToTheExactTargetAndPreservesFactoryAuthentication() {
        val request = request()
        val responseBody = acknowledgement(submission()).toString().toByteArray()
        lateinit var openedUrl: URL
        lateinit var connection: FakeHttpsURLConnection
        var calls = 0
        val executor = AndroidCanonicalSubmissionHttpsExecutor(
            origin = "https://api.example.test:8443/",
            connectionFactory = { url ->
                calls += 1
                openedUrl = url
                FakeHttpsURLConnection(
                    url = url,
                    responseBody = responseBody,
                ).also {
                    it.setRequestProperty("X-Test-Authentication", "synthetic-proof")
                    connection = it
                }
            },
        )

        val response = executor.execute(request)

        assertEquals(1, calls)
        assertEquals(
            "https://api.example.test:8443/v1/time-trial-submissions?feedback=v2",
            openedUrl.toString(),
        )
        assertEquals("POST", connection.requestMethod)
        assertFalse(connection.instanceFollowRedirects)
        assertTrue(connection.doInput)
        assertTrue(connection.doOutput)
        assertFalse(connection.useCaches)
        assertFalse(connection.allowUserInteraction)
        assertEquals(ANDROID_CANONICAL_HTTPS_DEFAULT_CONNECT_TIMEOUT_MS, connection.connectTimeout)
        assertEquals(ANDROID_CANONICAL_HTTPS_DEFAULT_READ_TIMEOUT_MS, connection.readTimeout)
        assertEquals("application/json", connection.getRequestProperty("Accept"))
        assertEquals("application/json", connection.getRequestProperty("Content-Type"))
        assertEquals("synthetic-proof", connection.getRequestProperty("X-Test-Authentication"))
        assertEquals(request.body.toByteArray().size.toLong(), connection.fixedLength())
        assertArrayEquals(request.body.toByteArray(), connection.writtenBody())
        assertTrue(connection.disconnected)
        assertEquals(201, response.statusCode)
        assertEquals("application/json", response.contentType)
        assertEquals(responseBody.size.toLong(), response.declaredContentLength)
        assertArrayEquals(responseBody, response.body)
    }

    @Test
    fun rejectsAFactoryConnectionForAnyDifferentUrlBeforeWriting() {
        lateinit var connection: FakeHttpsURLConnection
        val executor = AndroidCanonicalSubmissionHttpsExecutor(
            origin = "https://api.example.test",
            connectionFactory = {
                FakeHttpsURLConnection(
                    URL("https://other.example.test/v1/time-trial-submissions"),
                ).also { connection = it }
            },
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            executor.execute(request())
        }

        assertEquals("Invalid canonical submission HTTPS configuration", error.message)
        assertEquals(0, connection.outputRequests)
        assertTrue(connection.disconnected)
    }

    @Test
    fun returnsOnlyNonSuccessStatusAndClosesWithoutReadingItsErrorBody() {
        lateinit var connection: FakeHttpsURLConnection
        val errorBody = TrackingInputStream(
            "private server explanation".toByteArray(),
            failOnRead = true,
        )
        val executor = AndroidCanonicalSubmissionHttpsExecutor(
            origin = "https://api.example.test",
            connectionFactory = { url ->
                FakeHttpsURLConnection(
                    url = url,
                    statusCode = 503,
                    errorBody = errorBody,
                ).also { connection = it }
            },
        )

        val response = executor.execute(request())

        assertEquals(503, response.statusCode)
        assertNull(response.contentType)
        assertNull(response.declaredContentLength)
        assertTrue(response.body.isEmpty())
        assertEquals(0, errorBody.bytesRead)
        assertTrue(errorBody.closed)
        assertEquals(0, connection.inputRequests)
        assertTrue(connection.disconnected)
    }

    @Test
    fun rejectsDeclaredOrStreamedResponseOverflowWithoutAnUnboundedRead() {
        val request = request()
        val declaredBody = TrackingInputStream(byteArrayOf(), failOnRead = true)
        val declaredConnection = FakeHttpsURLConnection(
            url = URL("https://api.example.test$ANDROID_CANONICAL_SUBMISSION_PATH?$ANDROID_CANONICAL_SUBMISSION_FEEDBACK_QUERY"),
            declaredContentLength = ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES + 1L,
            responseInput = declaredBody,
        )
        val declaredExecutor = AndroidCanonicalSubmissionHttpsExecutor(
            origin = "https://api.example.test",
            connectionFactory = { declaredConnection },
        )

        val declaredResponse = declaredExecutor.execute(request)

        assertEquals(0, declaredBody.bytesRead)
        assertEquals(0, declaredConnection.inputRequests)
        assertTrue(declaredResponse.body.isEmpty())
        assertEquals(
            ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES + 1L,
            declaredResponse.declaredContentLength,
        )

        val streamedBody = TrackingInputStream(
            ByteArray(ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES * 3) { 'x'.code.toByte() },
        )
        var calls = 0
        lateinit var streamedConnection: FakeHttpsURLConnection
        val transport = createAndroidCanonicalSubmissionRequestTransport(
            AndroidCanonicalSubmissionHttpsExecutor(
                origin = "https://api.example.test",
                connectionFactory = { url ->
                    calls += 1
                    FakeHttpsURLConnection(
                        url = url,
                        declaredContentLength = -1,
                        responseInput = streamedBody,
                    ).also { streamedConnection = it }
                },
            ),
        )

        val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            transport.submit(submission())
        }

        assertEquals(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID, error.failureCode)
        assertEquals(ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES + 1, streamedBody.bytesRead)
        assertEquals(1, calls)
        assertTrue(streamedBody.closed)
        assertTrue(streamedConnection.disconnected)
    }

    @Test
    fun mapsWriteAndReadFailuresOnceAndDisconnectsWithoutLeakingDetail() {
        listOf("write", "read").forEach { failurePoint ->
            var calls = 0
            lateinit var connection: FakeHttpsURLConnection
            val executor = AndroidCanonicalSubmissionHttpsExecutor(
                origin = "https://api.example.test",
                connectionFactory = { url ->
                    calls += 1
                    FakeHttpsURLConnection(
                        url = url,
                        failOutput = failurePoint == "write",
                        responseInput = TrackingInputStream(
                            acknowledgement(submission()).toString().toByteArray(),
                            failOnRead = failurePoint == "read",
                        ),
                    ).also { connection = it }
                },
            )
            val transport = createAndroidCanonicalSubmissionRequestTransport(executor)

            val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
                transport.submit(submission())
            }

            assertEquals(ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE, error.failureCode)
            assertEquals(1, calls)
            assertTrue(connection.disconnected)
            assertFalse(error.message.orEmpty().contains("private", ignoreCase = true))
        }
    }

    private fun request(): AndroidCanonicalSubmissionRequest {
        lateinit var captured: AndroidCanonicalSubmissionRequest
        val submission = submission()
        createAndroidCanonicalSubmissionRequestTransport { request ->
            captured = request
            val body = acknowledgement(submission).toString().toByteArray()
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = body.size.toLong(),
                body = body,
            )
        }.submit(submission)
        return captured
    }

    private fun submission(): JsonObject {
        val value = createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.ANDROIDHTTPS0001",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    "https-profile",
                ),
                createdAtMs = 1_786_902_000_000,
                producerVersion = "android-https-test",
            ),
            mode = 150,
            timeDigits = "123456",
        )
        return json.parseToJsonElement(
            json.encodeToString(AndroidManualTimeTrialSubmissionV1.serializer(), value),
        ) as JsonObject
    }

    private fun acknowledgement(submission: JsonObject) = buildJsonObject {
        put("submissionId", submission.getValue("submissionId"))
        put("revision", submission.getValue("revision"))
    }
}

private class FakeHttpsURLConnection(
    url: URL,
    private val statusCode: Int = 201,
    responseBody: ByteArray = byteArrayOf(),
    private val declaredContentLength: Long = responseBody.size.toLong(),
    private val responseInput: TrackingInputStream = TrackingInputStream(responseBody),
    private val errorBody: TrackingInputStream? = null,
    private val failOutput: Boolean = false,
) : HttpsURLConnection(url) {
    private val output = ByteArrayOutputStream()
    var disconnected = false
        private set
    var outputRequests = 0
        private set
    var inputRequests = 0
        private set

    override fun connect() = Unit

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false

    override fun getCipherSuite(): String = "TLS_SYNTHETIC"

    override fun getLocalCertificates(): Array<Certificate>? = null

    override fun getServerCertificates(): Array<Certificate> = emptyArray()

    override fun getOutputStream(): OutputStream {
        outputRequests += 1
        if (failOutput) throw IOException("private write detail")
        return output
    }

    override fun getInputStream(): InputStream {
        inputRequests += 1
        return responseInput
    }

    override fun getErrorStream(): InputStream? = errorBody

    override fun getResponseCode(): Int = statusCode

    override fun getContentType(): String = "application/json"

    override fun getContentLengthLong(): Long = declaredContentLength

    fun fixedLength(): Long = when {
        fixedContentLengthLong >= 0 -> fixedContentLengthLong
        else -> fixedContentLength.toLong()
    }

    fun writtenBody(): ByteArray = output.toByteArray()
}

private class TrackingInputStream(
    bytes: ByteArray,
    private val failOnRead: Boolean = false,
) : ByteArrayInputStream(bytes) {
    var bytesRead = 0
        private set
    var closed = false
        private set

    override fun read(): Int {
        if (failOnRead) throw IOException("private read detail")
        val value = super.read()
        if (value >= 0) bytesRead += 1
        return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (failOnRead) throw IOException("private read detail")
        val count = super.read(buffer, offset, length)
        if (count > 0) bytesRead += count
        return count
    }

    override fun close() {
        closed = true
        super.close()
    }
}
