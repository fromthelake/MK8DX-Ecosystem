package nl.mariokart8.mk8dxtimetrials.outbox

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
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCanonicalSubmissionRequestTransportTest {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = false
    }

    @Test
    fun postsOnlyCanonicalJsonToTheFixedRouteAndParsesExactAcknowledgement() {
        val submission = submission()
        val requests = mutableListOf<AndroidCanonicalSubmissionRequest>()
        val transport = createAndroidCanonicalSubmissionRequestTransport { request ->
            requests += request
            response(
                body = acknowledgement(submission),
                contentType = "Application/JSON; charset=utf-8",
            )
        }

        val result = transport.submit(submission)

        assertEquals(acknowledgement(submission), result)
        val request = requests.single()
        assertEquals("POST", request.method)
        assertEquals(ANDROID_CANONICAL_SUBMISSION_PATH, request.path)
        assertEquals(
            mapOf(
                "Accept" to "application/json",
                "Content-Type" to "application/json",
            ),
            request.headers,
        )
        assertEquals(ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES, request.responseMaxBytes)
        assertFalse(request.followRedirects)
        assertFalse(request.automaticRetryAllowed)
        assertEquals(submission, json.parseToJsonElement(request.body))
        assertTrue(request.body.toByteArray(Charsets.UTF_8).size <= LOCAL_OUTBOX_MAX_SUBMISSION_BYTES)
        assertFalse(request.path.contains("://"))
        assertFalse(request.headers.keys.any { it.equals("Authorization", ignoreCase = true) })
        assertFalse(request.headers.keys.any { it.equals("Cookie", ignoreCase = true) })
    }

    @Test
    fun rejectsWidenedCanonicalInputBeforeTheExecutor() {
        var calls = 0
        val transport = createAndroidCanonicalSubmissionRequestTransport {
            calls += 1
            response(acknowledgement(submission()))
        }
        val widened = JsonObject(
            submission() + ("privateEvidence" to json.parseToJsonElement("true")),
        )

        val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            transport.submit(widened)
        }

        assertEquals(ANDROID_DELIVERY_FAILURE_TRANSPORT_FAILED, error.failureCode)
        assertEquals(0, calls)
        assertFalse(error.message.orEmpty().contains("privateEvidence"))
    }

    @Test
    fun namesTheWorldRecordGuardsRefusalAndNothingElseFromA400() {
        fun refusedWith(body: String) = createAndroidCanonicalSubmissionRequestTransport {
            AndroidCanonicalSubmissionResponse(
                statusCode = 400,
                contentType = null,
                declaredContentLength = null,
                body = body.toByteArray(),
            )
        }
        val guard = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            refusedWith(
                """{"code":"time_trial_time_implausible","message":"The proposed time is highly unreasonable, please double check all information."}""",
            ).submit(submission())
        }
        assertEquals(ANDROID_CANONICAL_TRANSPORT_TIME_IMPLAUSIBLE, guard.failureCode)
        assertEquals(
            "The proposed time is highly unreasonable, please double check all information.",
            androidSubmissionFailureMessage(guard.failureCode, "en"),
        )
        assertEquals(
            "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens.",
            androidSubmissionFailureMessage(guard.failureCode, "nl"),
        )
        // Any other refusal stays the general one, and has no sentence of its own.
        listOf("""{"code":"time_trial_invalid_submission"}""", "not json", "").forEach { body ->
            val other = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
                refusedWith(body).submit(submission())
            }
            assertEquals(ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED, other.failureCode)
            assertEquals(null, androidSubmissionFailureMessage(other.failureCode, "en"))
        }
    }

    @Test
    fun namesTheCarriedTimeRefusalsOfAReceivingCommunity() {
        fun refused(status: Int, code: String) = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
            createAndroidCanonicalSubmissionRequestTransport {
                AndroidCanonicalSubmissionResponse(status, null, null, """{"code":"$code"}""".toByteArray())
            }.submit(submission())
        }.failureCode
        assertEquals(ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED, refused(403, "carried_times_disabled"))
        assertEquals(ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF, refused(400, "carried_from_self"))
        assertEquals(ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED, refused(403, "time_trial_submission_forbidden"))
        assertEquals(
            "This community does not accept times from other communities.",
            androidSubmissionFailureMessage(ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED, "en"),
        )
        assertEquals(
            "Deze tijd komt al uit deze community.",
            androidSubmissionFailureMessage(ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF, "nl"),
        )
    }

    @Test
    fun mapsBoundedHttpFailuresWithoutReadingOrLeakingTheirBodies() {
        val cases = listOf(
            401 to ANDROID_CANONICAL_TRANSPORT_NOT_AUTHENTICATED,
            403 to ANDROID_CANONICAL_TRANSPORT_NOT_AUTHORIZED,
            409 to ANDROID_CANONICAL_TRANSPORT_REVISION_CONFLICT,
            400 to ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
            404 to ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
            413 to ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
            415 to ANDROID_CANONICAL_TRANSPORT_SUBMISSION_REJECTED,
            408 to ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
            425 to ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
            429 to ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
            503 to ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE,
            200 to ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID,
            302 to ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID,
        )
        cases.forEach { (status, expectedCode) ->
            val transport = createAndroidCanonicalSubmissionRequestTransport {
                AndroidCanonicalSubmissionResponse(
                    statusCode = status,
                    contentType = "text/plain",
                    declaredContentLength = 24,
                    body = "private server detail".toByteArray(),
                )
            }

            val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
                transport.submit(submission())
            }

            assertEquals(expectedCode, error.failureCode)
            assertFalse(error.message.orEmpty().contains("private server detail"))
        }
    }

    @Test
    fun executorFailureIsOneBoundedUnavailableResultWithoutAutomaticRetry() {
        listOf<() -> Nothing>(
            { error("private network configuration") },
            { throw AndroidCanonicalDeliveryTransportException("private.executor_code") },
        ).forEach { failure ->
            var calls = 0
            val transport = createAndroidCanonicalSubmissionRequestTransport {
                calls += 1
                failure()
            }

            val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
                transport.submit(submission())
            }

            assertEquals(ANDROID_CANONICAL_TRANSPORT_UNAVAILABLE, error.failureCode)
            assertEquals(1, calls)
            assertFalse(error.message.orEmpty().contains("private", ignoreCase = true))
        }
    }

    @Test
    fun rejectsMalformedWidenedMismatchedOrOversizedSuccessResponses() {
        val expected = submission()
        val invalid = listOf(
            response(acknowledgement(expected), contentType = null),
            response(acknowledgement(expected), contentType = "text/plain"),
            response(acknowledgement(expected), contentType = "application/jsonp"),
            response(acknowledgement(expected), contentType = "application/json;"),
            response(acknowledgement(expected), contentType = "application/json\r\n"),
            response(acknowledgement(expected), contentType = "application/json;" + "x".repeat(257)),
            response(
                acknowledgement(expected),
                declaredLength = ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES + 1L,
            ),
            response(acknowledgement(expected), declaredLength = -1),
            response(buildJsonObject {
                put("submissionId", expected.getValue("submissionId"))
                put("revision", expected.getValue("revision"))
                put("privateDetail", true)
            }),
            response(buildJsonObject {
                put("submissionId", "user_submission.time.WRONG0001")
                put("revision", expected.getValue("revision"))
            }),
            response(buildJsonObject {
                put("submissionId", expected.getValue("submissionId"))
                put("revision", "1")
            }),
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = null,
                body = byteArrayOf(0xc3.toByte(), 0x28),
            ),
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = 0,
                body = byteArrayOf(),
            ),
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = null,
                body = "not-json".toByteArray(),
            ),
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = 2,
                body = "[]".toByteArray(),
            ),
            AndroidCanonicalSubmissionResponse(
                statusCode = 201,
                contentType = "application/json",
                declaredContentLength = null,
                body = ByteArray(ANDROID_CANONICAL_SUBMISSION_RESPONSE_MAX_BYTES + 1) { 'x'.code.toByte() },
            ),
        )
        invalid.forEach { response ->
            val transport = createAndroidCanonicalSubmissionRequestTransport { response }

            val error = assertThrows(AndroidCanonicalDeliveryTransportException::class.java) {
                transport.submit(expected)
            }

            assertEquals(ANDROID_DELIVERY_FAILURE_RESPONSE_INVALID, error.failureCode)
            assertFalse(error.message.orEmpty().contains("privateDetail"))
        }
    }

    private fun submission(): JsonObject {
        val value = createAndroidManualSubmission(
            AndroidManualSubmissionContext(
                submissionId = "user_submission.time.ANDROIDREQUEST01",
                revision = 1,
                trackId = "track.mario_kart_stadium",
                playerReference = ManualPlayerReferenceV1(
                    "producer_local_profile",
                    "request-profile",
                ),
                createdAtMs = 1_786_901_000_000,
                producerVersion = "android-request-test",
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

    private fun feedback(rankAfter: Int = 2): JsonObject = json.parseToJsonElement(
        """
        {"trackId":"track.mario_kart_stadium","modeCc":150,"totalTimeMs":106784,
         "personalBest":{"previousBestMs":107096,"deltaMs":-312,"improved":true},
         "rank":{"after":$rankAfter,"before":4,"passedCount":1,"rivalsPassed":1,
                 "passed":[{"playerId":"player.evan","username":"evan","displayName":"Evan","bestMs":106900,"rival":true}]}}
        """.trimIndent(),
    ) as JsonObject

    @Test
    fun carriesAWellFormedFeedbackBlockAndDropsAMalformedOne() {
        val submission = submission()
        val carried = createAndroidCanonicalSubmissionRequestTransport {
            response(body = JsonObject(acknowledgement(submission) + ("feedback" to feedback())))
        }.submit(submission)
        assertEquals(setOf("submissionId", "revision", "feedback"), carried.keys)
        assertEquals(feedback(), carried["feedback"])

        val dropped = createAndroidCanonicalSubmissionRequestTransport {
            response(body = JsonObject(acknowledgement(submission) + ("feedback" to feedback(rankAfter = 0))))
        }.submit(submission)
        assertEquals(acknowledgement(submission), dropped)

        val widened = createAndroidCanonicalSubmissionRequestTransport {
            response(body = JsonObject(acknowledgement(submission) + ("extra" to feedback())))
        }
        assertThrows(AndroidCanonicalDeliveryTransportException::class.java) { widened.submit(submission) }
    }

    private fun response(
        body: JsonObject,
        contentType: String? = "application/json",
        declaredLength: Long? = null,
    ): AndroidCanonicalSubmissionResponse {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        return AndroidCanonicalSubmissionResponse(
            statusCode = 201,
            contentType = contentType,
            declaredContentLength = declaredLength ?: bytes.size.toLong(),
            body = bytes,
        )
    }
}
