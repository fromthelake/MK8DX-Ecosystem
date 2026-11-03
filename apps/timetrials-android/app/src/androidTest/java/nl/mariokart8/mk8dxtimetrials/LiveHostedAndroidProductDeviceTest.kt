package nl.mariokart8.mk8dxtimetrials

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticationHttpsExecutor
import nl.mariokart8.mk8dxtimetrials.auth.AndroidDeviceAuthorizationClient
import nl.mariokart8.mk8dxtimetrials.auth.AndroidDeviceTokenPollResult
import nl.mariokart8.mk8dxtimetrials.auth.AndroidHttpsConnectionOpener
import nl.mariokart8.mk8dxtimetrials.auth.AndroidKeystoreNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.AndroidSlotBoundSessionCanonicalConnectionFactory
import nl.mariokart8.mk8dxtimetrials.auth.androidSessionSlotId
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionOpaqueIdProvider
import nl.mariokart8.mk8dxtimetrials.manual.AndroidTrustedManualSubmissionContextFactory
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidCanonicalSubmissionHttpsExecutor
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidExplicitCanonicalOutboxDeliveryCoordinator
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidReviewedEvidenceReferenceAllowlist
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidCanonicalSubmissionRequestTransport
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidProductTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val LIVE_ORIGIN_ARGUMENT = "mk8dxLiveOrigin"
private const val APPROVAL_FILE = "live-product-approval-url.txt"
private const val PRODUCER_VERSION = "timetrials-android-live-product"

@RunWith(AndroidJUnit4::class)
class LiveHostedAndroidProductDeviceTest {
    @Test(timeout = 120_000)
    fun authenticatesStoresAndSynchronizesThroughHostedProduct() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val origin = InstrumentationRegistry.getArguments()
            .getString(LIVE_ORIGIN_ARGUMENT)
            .orEmpty()
        assumeTrue("A live HTTPS origin is required for this hosted gate.", origin.isNotEmpty())
        assertEquals(BuildConfig.MK8DX_API_ORIGIN, origin)

        val context = instrumentation.targetContext
        val approvalFile = File(context.filesDir, APPROVAL_FILE)
        val opener = AndroidHttpsConnectionOpener { url ->
            url.openConnection() as HttpsURLConnection
        }
        val client = AndroidDeviceAuthorizationClient(
            URI(origin),
            AndroidAuthenticationHttpsExecutor(origin, opener),
        )
        val store = AndroidKeystoreNativeSessionStore(context)
        store.list(System.currentTimeMillis()).forEach { store.remove(it.slotId) }

        val authorization = client.requestDeviceAuthorization()
        approvalFile.writeText(authorization.verificationUriComplete.toASCIIString())
        val authorized = awaitAuthorization(client, authorization.deviceCode)
        assertTrue(approvalFile.delete())

        val session = client.establishSession(
            authorized.bearerToken,
            authorized.expiresInSeconds,
        )
        val slotId = androidSessionSlotId(session.playerId)
        store.save(slotId, session)
        store.setActiveSlotId(slotId)
        assertEquals(session, store.load(slotId, System.currentTimeMillis()))

        val outbox = createAndroidProductTimeTrialOutbox(context)
        val createdAtMs = System.currentTimeMillis()
        val submission = createAndroidManualSubmission(
            AndroidTrustedManualSubmissionContextFactory(
                playerId = session.playerId,
                producerVersion = PRODUCER_VERSION,
                opaqueIdProvider = AndroidManualSubmissionOpaqueIdProvider {
                    "ANDROIDLIVEPRODUCT01"
                },
                clock = AndroidOutboxClock { createdAtMs },
            ).create(Schema9AndroidTrackCatalog.entries.first()),
            mode = 150,
            timeDigits = "123456",
        )
        val pending = AndroidOutboxSubmissionHost(
            outbox,
            AndroidOutboxClock { createdAtMs },
            owningSlot = { slotId },
        ).storeManual(submission)
        assertEquals("pending", pending.state.state)
        assertFalse(pending.entry.privateEvidencePresent)

        val synchronized = AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            { owningSlotId ->
                createAndroidCanonicalSubmissionRequestTransport(
                    AndroidCanonicalSubmissionHttpsExecutor(
                        origin,
                        AndroidSlotBoundSessionCanonicalConnectionFactory(
                            owningSlotId,
                            store,
                            opener,
                        ),
                    ),
                )
            },
            AndroidReviewedEvidenceReferenceAllowlist { evidence -> evidence.isEmpty() },
        ).deliver(pending.entry.entryKey, createdAtMs + 1)
        assertEquals("synced", synchronized.state.state)
        assertFalse(synchronized.entry.privateEvidencePresent)
        assertEquals("synced", outbox.read(pending.entry.entryKey).state.state)

        client.revoke(session.bearerToken)
        store.remove(slotId)
        assertNull(store.load(slotId, System.currentTimeMillis()))
    }

    private fun awaitAuthorization(
        client: AndroidDeviceAuthorizationClient,
        deviceCode: String,
    ): AndroidDeviceTokenPollResult.Authorized {
        val deadline = SystemClock.elapsedRealtime() + 90_000
        var delayMs = 1_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(delayMs)
            when (val result = client.poll(deviceCode)) {
                AndroidDeviceTokenPollResult.Pending -> delayMs = 1_000L
                is AndroidDeviceTokenPollResult.SlowDown -> {
                    delayMs = result.retryAfterSeconds * 1_000L
                }
                is AndroidDeviceTokenPollResult.Authorized -> return result
                AndroidDeviceTokenPollResult.Denied -> error("Device authorization was denied.")
                AndroidDeviceTokenPollResult.Expired -> error("Device authorization expired.")
            }
        }
        error("Device authorization did not complete before the hosted test timeout.")
    }
}
