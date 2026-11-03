package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.auth.AndroidHttpsConnectionOpener
import nl.mariokart8.mk8dxtimetrials.auth.AndroidKeystoreNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.AndroidNativeSessionStore
import nl.mariokart8.mk8dxtimetrials.auth.AndroidSlotBoundSessionCanonicalConnectionFactory
import nl.mariokart8.mk8dxtimetrials.auth.androidSessionSlotId
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidCanonicalSubmissionHttpsExecutor
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidExplicitCanonicalOutboxDeliveryCoordinator
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalOutboxRecord
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxAccountAvailability
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxBatchItemOutcome
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxBatchItemResult
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxBatchResult
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxBatchSynchronizationController
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSubmissionHost
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxSynchronizationClock
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOwnedCanonicalSubmissionTransportResolver
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidProducedSubmissionValidator
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidReviewedEvidenceReferenceAllowlist
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidCanonicalSubmissionRequestTransport
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

private const val SHARED_DEVICE_ORIGIN = "https://api.mk8dx-shared-device.test"
private const val PRODUCER_VERSION = "android-shared-device-isolation-test"
private const val LOCAL_PROFILE_ID = "shared-device-local-profile"
private const val BASE_MS = 1_786_910_000_000L
private const val DISTANT_EXPIRY_MS = 1_900_000_000_000L

/**
 * One person's phone is regularly the whole household's phone at a tournament
 * table. This gate runs the real Keystore-backed multi-slot session store, the
 * real on-device outbox, the real owner binding and the real batch delivery to
 * prove that an arbitrary number of accounts stay separated: results are
 * delivered with the credentials of whoever produced them, never with the
 * credentials of whoever happens to be signed in when synchronization runs.
 */
@RunWith(AndroidJUnit4::class)
class SharedDeviceMultiAccountIsolationDeviceTest {
    private val accountA = SharedDeviceAccount("a")
    private val accountB = SharedDeviceAccount("b")
    private val accountC = SharedDeviceAccount("c")
    private val accountD = SharedDeviceAccount("d")
    private val accountE = SharedDeviceAccount("e")

    // Nothing below may assume a household of two, or of three: the store is a
    // list of accounts whose length is the household's business, not the code's.
    private val knownAccounts =
        listOf(accountA, accountB, accountC, accountD, accountE)

    private lateinit var context: Context
    private lateinit var store: AndroidNativeSessionStore
    private lateinit var canonicalRoot: File
    private lateinit var privateEvidenceRoot: File
    private lateinit var outbox: AndroidLocalTimeTrialOutbox

    private var nowMs = BASE_MS
    private val resolvedSlotIds = mutableListOf<String>()
    private val openedConnections = mutableListOf<RecordingSubmissionConnection>()

    @Before
    fun prepareSharedDevice() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        store = AndroidKeystoreNativeSessionStore(context)
        forgetEveryRememberedAccount()
        nowMs = BASE_MS
        resolvedSlotIds.clear()
        openedConnections.clear()
        val suffix = UUID.randomUUID().toString()
        canonicalRoot = File(context.filesDir, "shared-device-outbox-$suffix")
        privateEvidenceRoot =
            File(context.noBackupFilesDir, "shared-device-evidence-$suffix")
        outbox = AndroidLocalTimeTrialOutbox(
            canonicalRoot,
            privateEvidenceRoot,
            AndroidProducedSubmissionValidator,
        )
    }

    @After
    fun leaveNothingBehind() {
        forgetEveryRememberedAccount()
        canonicalRoot.deleteRecursively()
        privateEvidenceRoot.deleteRecursively()
    }

    @Test
    fun threeAccountsAreRememberedSimultaneouslyWithoutExposingAnyToken() {
        val household = listOf(accountA, accountB, accountC)
        household.forEach { remember(it) }

        val listed = store.list(nowMs)

        assertEquals(3, listed.size)
        assertEquals(
            household.map { it.slotId }.toSet(),
            listed.map { it.slotId }.toSet(),
        )
        assertEquals(
            household.map { it.playerId }.toSet(),
            listed.map { it.playerId }.toSet(),
        )
        assertTrue(listed.none { it.expired })
        household.forEach { account ->
            assertEquals(account.session(), store.load(account.slotId, nowMs))
        }
        // The account list is rendered by ordinary UI code, so it must carry no
        // credential, and no credential may sit in plaintext beside it either.
        val persisted = File(context.applicationInfo.dataDir, "shared_prefs")
            .listFiles()
            .orEmpty()
            .joinToString("\n") { it.readText() }
        household.forEach { account ->
            assertFalse(listed.toString().contains(account.bearerToken))
            assertFalse(persisted.contains(account.bearerToken))
            assertFalse(persisted.contains(account.playerId))
        }
    }

    @Test
    fun sessionStoreRemembersAnArbitraryNumberOfAccounts() {
        knownAccounts.forEach { remember(it) }

        assertEquals(knownAccounts.size, store.list(nowMs).size)
        knownAccounts.forEach { account ->
            assertEquals(account.session(), store.load(account.slotId, nowMs))
        }

        // The list also shrinks by an arbitrary amount: no fixed household size
        // is encoded anywhere in the store.
        val departed = knownAccounts.drop(3)
        departed.forEach { store.remove(it.slotId) }

        assertEquals(
            knownAccounts.take(3).map { it.slotId }.toSet(),
            store.list(nowMs).map { it.slotId }.toSet(),
        )
        departed.forEach { assertNull(store.load(it.slotId, nowMs)) }
        knownAccounts.take(3).forEach { account ->
            assertEquals(account.session(), store.load(account.slotId, nowMs))
        }
    }

    @Test
    fun switchingActiveAccountRepeatedlyLeavesEveryStoredSessionIntact() {
        val household = listOf(accountA, accountB, accountC)
        household.forEach { remember(it) }

        listOf(accountA, accountB, accountC, accountA, accountC, accountB, accountA)
            .forEach { active ->
                store.setActiveSlotId(active.slotId)

                assertEquals(active.slotId, store.activeSlotId())
                assertEquals(3, store.list(nowMs).size)
                // Switching is a selection, never a sign-out of the others.
                household.forEach { account ->
                    assertEquals(account.session(), store.load(account.slotId, nowMs))
                }
            }
    }

    @Test
    fun outboxEntryOwnershipSurvivesEveryLaterAccountSwitch() {
        listOf(accountA, accountB, accountC).forEach { remember(it) }
        signIn(accountA)
        val entry = storeResultAsActiveAccount("OWNERSHIP01")
        val ownerFile = File(canonicalRoot, "${entry.entry.entryKey}/owner.json")
        val ownerBytesWhenCreated = ownerFile.readBytes()

        assertEquals(accountA.slotId, entry.owner?.slotId)
        assertEquals("player", entry.owner?.playerReference?.namespace)
        assertEquals(accountA.playerId, entry.owner?.playerReference?.value)

        listOf(accountB, accountC, accountA, accountC).forEach { active ->
            signIn(active)

            val reread = outbox.read(entry.entry.entryKey)
            assertEquals(accountA.slotId, reread.owner?.slotId)
            assertEquals(accountA.playerId, reread.owner?.playerReference?.value)
            assertEquals(
                accountA.slotId,
                outbox.listIndex().single().owningSlotId,
            )
            // The binding is a written fact, not a re-derived one.
            assertTrue(ownerBytesWhenCreated.contentEquals(ownerFile.readBytes()))
        }
    }

    @Test
    fun batchDeliversEveryEntryWithItsOwnAccountsCredentials() {
        listOf(accountA, accountB, accountC).forEach { remember(it) }
        val entries = mapOf(
            accountA to listOf(
                storedResultOf(accountA, "BATCHA01"),
                storedResultOf(accountA, "BATCHA02"),
            ),
            accountB to listOf(storedResultOf(accountB, "BATCHB01")),
            accountC to listOf(storedResultOf(accountC, "BATCHC01")),
        )
        // Whoever is signed in at synchronization time is irrelevant, so pick
        // someone who owns only one of the four entries.
        signIn(accountB)
        nowMs += 60_000

        val result = synchronizeAll()

        assertEquals(4, result.syncedCount)
        assertEquals(0, result.failedCount)
        assertEquals(0, result.skippedCount)
        // The resolver is asked once per entry, and the answer is that entry's
        // owner: two questions about A, one about B, one about C.
        assertEquals(
            listOf(accountA.slotId, accountA.slotId, accountB.slotId, accountC.slotId)
                .sorted(),
            resolvedSlotIds.sorted(),
        )
        assertEquals(4, openedConnections.size)
        val credentialPerSubmission = openedConnections.associate {
            it.submittedSubmissionId() to it.authorization()
        }
        entries.forEach { (account, records) ->
            records.forEach { record ->
                assertEquals(
                    "Bearer ${account.bearerToken}",
                    credentialPerSubmission[submissionIdOf(record)],
                )
                assertEquals("synced", outbox.read(record.entry.entryKey).state.state)
                assertEquals(
                    account.slotId,
                    result.items.single { it.entryKeyHash == record.entry.entryKey }
                        .owningSlotId,
                )
            }
        }
        assertEquals(4, credentialPerSubmission.size)
    }

    @Test
    fun expiredAccountEntryIsNeverSentAndStaysRetryable() {
        val skipped = deliverWhileOneAccountNeedsReauthentication()

        assertEquals(accountB.slotId, skipped.owningSlotId)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            skipped.failureCode,
        )
        assertEquals("account.reauthentication_required", skipped.failureCode)
        // Nothing was attempted on B's behalf: no transport, not even a question
        // to the resolver, so no other account could have answered it.
        assertFalse(resolvedSlotIds.contains(accountB.slotId))
        assertEquals(2, openedConnections.size)
        assertFalse(
            openedConnections.any {
                it.submittedSubmissionId() == storedSubmissionIdOf(skipped.entryKeyHash)
            },
        )
        val stored = outbox.read(skipped.entryKeyHash)
        assertEquals("pending", stored.state.state)
        assertEquals(0L, stored.state.attemptCount)
        assertEquals(1L, stored.state.stateRevision)
        assertNull(stored.state.failureCode)
        assertEquals(accountB.slotId, stored.owner?.slotId)
        // B stays listed so the phone can offer "sign in again" beside the entry.
        assertTrue(store.list(nowMs).single { it.slotId == accountB.slotId }.expired)
    }

    @Test
    fun reauthenticatedAccountDeliversItsPreviouslySkippedEntry() {
        val skipped = deliverWhileOneAccountNeedsReauthentication()
        val renewedToken = "shared-device-renewed-token-b-01"
        assertNotEquals(accountB.bearerToken, renewedToken)
        remember(accountB, bearerToken = renewedToken)
        nowMs += 60_000

        val second = synchronizeAll()

        assertEquals(1, second.items.size)
        assertEquals(1, second.syncedCount)
        assertEquals(skipped.entryKeyHash, second.items.single().entryKeyHash)
        assertEquals(accountB.slotId, second.items.single().owningSlotId)
        assertEquals("synced", outbox.read(skipped.entryKeyHash).state.state)
        // Delivered as B, with B's fresh credential, on the second pass only.
        assertEquals(3, openedConnections.size)
        assertEquals(
            "Bearer $renewedToken",
            openedConnections.last().authorization(),
        )
        assertEquals(
            storedSubmissionIdOf(skipped.entryKeyHash),
            openedConnections.last().submittedSubmissionId(),
        )
    }

    @Test
    fun removingOneAccountLeavesOtherSessionsAndItsOwnEntryIntact() {
        val abandoned = removeAccountCAfterEveryoneStoredAResult()

        assertEquals(
            listOf(accountA.slotId, accountB.slotId).toSet(),
            store.list(nowMs).map { it.slotId }.toSet(),
        )
        assertEquals(accountA.session(), store.load(accountA.slotId, nowMs))
        assertEquals(accountB.session(), store.load(accountB.slotId, nowMs))
        assertNull(store.load(accountC.slotId, nowMs))

        val stored = outbox.read(abandoned.entry.entryKey)
        assertEquals("pending", stored.state.state)
        assertEquals(accountC.slotId, stored.owner?.slotId)
        assertEquals(accountC.playerId, stored.owner?.playerReference?.value)

        nowMs += 60_000
        val result = synchronizeAll()

        // The remaining accounts deliver their own results; C's result waits for
        // C rather than leaving with somebody else's credentials.
        assertEquals(2, result.syncedCount)
        assertEquals(1, result.skippedCount)
        val skipped = result.items.single {
            it.outcome == AndroidOutboxBatchItemOutcome.SKIPPED
        }
        assertEquals(abandoned.entry.entryKey, skipped.entryKeyHash)
        assertEquals(accountC.slotId, skipped.owningSlotId)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            skipped.failureCode,
        )
        assertFalse(resolvedSlotIds.contains(accountC.slotId))
        assertEquals("pending", outbox.read(abandoned.entry.entryKey).state.state)
        assertEquals(accountC.slotId, outbox.read(abandoned.entry.entryKey).owner?.slotId)
    }

    @Test
    fun readdedAccountDeliversItsOwnPendingEntry() {
        val abandoned = removeAccountCAfterEveryoneStoredAResult()
        nowMs += 60_000
        synchronizeAll()
        val returningToken = "shared-device-returning-token-c-01"
        remember(accountC, bearerToken = returningToken)
        nowMs += 60_000

        val second = synchronizeAll()

        assertEquals(1, second.items.size)
        assertEquals(1, second.syncedCount)
        assertEquals(abandoned.entry.entryKey, second.items.single().entryKeyHash)
        assertEquals(accountC.slotId, second.items.single().owningSlotId)
        assertEquals("synced", outbox.read(abandoned.entry.entryKey).state.state)
        assertEquals(3, openedConnections.size)
        assertEquals("Bearer $returningToken", openedConnections.last().authorization())
        assertEquals(
            submissionIdOf(abandoned),
            openedConnections.last().submittedSubmissionId(),
        )
    }

    @Test
    fun signedOutEntryIsNeverDeliveredAndFailsClosed() {
        remember(accountA)
        // Produced with nobody signed in: there is no account to bill it to.
        store.setActiveSlotId(null)
        val orphan = storeResultAsActiveAccount("SIGNEDOUT01")
        val owned = storedResultOf(accountA, "SIGNEDOUTA01")
        signIn(accountA)
        nowMs += 60_000

        assertNull(orphan.owner?.slotId)
        assertEquals("producer_local_profile", orphan.owner?.playerReference?.namespace)

        val result = synchronizeAll()

        val item = result.items.single { it.entryKeyHash == orphan.entry.entryKey }
        assertEquals(AndroidOutboxBatchItemOutcome.SKIPPED, item.outcome)
        assertNull(item.owningSlotId)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            item.failureCode,
        )
        assertEquals(1, result.syncedCount)
        assertEquals("synced", outbox.read(owned.entry.entryKey).state.state)
        assertEquals("pending", outbox.read(orphan.entry.entryKey).state.state)
        // Signing in afterwards does not adopt the orphan: only A's own result
        // was carried, on A's own credential.
        assertEquals(listOf(accountA.slotId), resolvedSlotIds)
        assertEquals(1, openedConnections.size)
        assertEquals(submissionIdOf(owned), openedConnections.single().submittedSubmissionId())

        // A deliberate single-entry delivery fails closed with the same bounded
        // code instead of borrowing the signed-in account.
        val failed = deliveryCoordinator().deliver(orphan.entry.entryKey, nowMs)

        assertEquals("failed", failed.state.state)
        assertEquals(
            ANDROID_DELIVERY_FAILURE_ACCOUNT_REAUTHENTICATION_REQUIRED,
            failed.state.failureCode,
        )
        assertEquals(1, openedConnections.size)
        assertEquals(listOf(accountA.slotId), resolvedSlotIds)
    }

    /**
     * Everyone stores a result, then B's credential expires on the device while
     * A and C stay usable. Returns B's skipped batch item.
     */
    private fun deliverWhileOneAccountNeedsReauthentication(): AndroidOutboxBatchItemResult {
        listOf(accountA, accountB, accountC).forEach { remember(it) }
        storedResultOf(accountA, "REAUTHA01")
        storedResultOf(accountB, "REAUTHB01")
        storedResultOf(accountC, "REAUTHC01")
        remember(accountB, expiresAtMs = nowMs - 1)
        signIn(accountA)
        nowMs += 60_000

        val result = synchronizeAll()

        assertEquals(2, result.syncedCount)
        assertEquals(0, result.failedCount)
        assertEquals(1, result.skippedCount)
        return result.items.single {
            it.outcome == AndroidOutboxBatchItemOutcome.SKIPPED
        }
    }

    /** Everyone stores a result, then C is removed from the device entirely. */
    private fun removeAccountCAfterEveryoneStoredAResult(): AndroidLocalOutboxRecord {
        listOf(accountA, accountB, accountC).forEach { remember(it) }
        storedResultOf(accountA, "REMOVEDA01")
        storedResultOf(accountB, "REMOVEDB01")
        val ofC = storedResultOf(accountC, "REMOVEDC01")
        store.remove(accountC.slotId)
        signIn(accountA)
        return ofC
    }

    private fun synchronizeAll(): AndroidOutboxBatchResult =
        AndroidOutboxBatchSynchronizationController(
            index = outbox,
            delivery = deliveryCoordinator(),
            // Exactly the product rule: an account is available when its own
            // slot still holds a live session.
            accounts = AndroidOutboxAccountAvailability { owningSlotId, atMs ->
                store.load(owningSlotId, atMs) != null
            },
            clock = AndroidOutboxSynchronizationClock { nowMs },
        ).synchronizeAll()

    private fun deliveryCoordinator() =
        AndroidExplicitCanonicalOutboxDeliveryCoordinator(
            outbox,
            recordingTransportResolver(),
            AndroidReviewedEvidenceReferenceAllowlist { evidence -> evidence.isEmpty() },
        )

    /**
     * Records which slot delivery asks about, and answers with a transport bound
     * to that slot alone. There is deliberately no path from here to the active
     * account.
     */
    private fun recordingTransportResolver() =
        AndroidOwnedCanonicalSubmissionTransportResolver { owningSlotId ->
            resolvedSlotIds += owningSlotId
            createAndroidCanonicalSubmissionRequestTransport(
                AndroidCanonicalSubmissionHttpsExecutor(
                    SHARED_DEVICE_ORIGIN,
                    AndroidSlotBoundSessionCanonicalConnectionFactory(
                        owningSlotId,
                        store,
                        AndroidHttpsConnectionOpener { url ->
                            RecordingSubmissionConnection(url)
                                .also { openedConnections += it }
                        },
                        clock = { nowMs },
                    ),
                ),
            ).takeIf { store.load(owningSlotId, nowMs) != null }
        }

    private fun storedResultOf(
        account: SharedDeviceAccount,
        suffix: String,
    ): AndroidLocalOutboxRecord {
        signIn(account)
        return storeResultAsActiveAccount(suffix)
    }

    /**
     * Stores through the real submission host, whose owner binding reads the
     * live active slot rather than anything this test hands it.
     */
    private fun storeResultAsActiveAccount(suffix: String): AndroidLocalOutboxRecord {
        val active = store.activeSlotId()
        val account = knownAccounts.firstOrNull { it.slotId == active }
        return AndroidOutboxSubmissionHost(
            outbox,
            AndroidOutboxClock { nowMs },
            owningSlot = { store.activeSlotId() },
        ).storeManual(
            createAndroidManualSubmission(
                AndroidManualSubmissionContext(
                    submissionId = submissionIdOf(suffix),
                    revision = 1,
                    trackId = "track.mario_kart_stadium",
                    playerReference = account
                        ?.let { ManualPlayerReferenceV1("player", it.playerId) }
                        ?: ManualPlayerReferenceV1(
                            "producer_local_profile",
                            LOCAL_PROFILE_ID,
                        ),
                    createdAtMs = nowMs,
                    producerVersion = PRODUCER_VERSION,
                ),
                mode = 150,
                timeDigits = "123456",
            ),
        )
    }

    private fun signIn(account: SharedDeviceAccount) {
        store.setActiveSlotId(account.slotId)
        assertEquals(account.slotId, store.activeSlotId())
    }

    private fun remember(
        account: SharedDeviceAccount,
        bearerToken: String = account.bearerToken,
        expiresAtMs: Long = DISTANT_EXPIRY_MS,
    ) {
        store.save(account.slotId, account.session(bearerToken, expiresAtMs))
    }

    private fun forgetEveryRememberedAccount() {
        store.list(0).forEach { store.remove(it.slotId) }
        store.setActiveSlotId(null)
        assertTrue(store.list(0).isEmpty())
    }

    private fun submissionIdOf(suffix: String): String =
        "user_submission.time.SHAREDDEVICE$suffix"

    private fun submissionIdOf(record: AndroidLocalOutboxRecord): String =
        (record.canonicalSubmission.getValue("submissionId") as JsonPrimitive).content

    private fun storedSubmissionIdOf(entryKey: String): String =
        submissionIdOf(outbox.read(entryKey))
}

private class SharedDeviceAccount(name: String) {
    val playerId = "player.shared_device_$name"
    val slotId = androidSessionSlotId(playerId)
    val bearerToken = "shared-device-token-$name-0000000001"

    fun session(
        token: String = bearerToken,
        expiresAtMs: Long = DISTANT_EXPIRY_MS,
    ): AndroidAuthenticatedNativeSession =
        AndroidAuthenticatedNativeSession(token, expiresAtMs, playerId)
}

private val recordingJson = Json { ignoreUnknownKeys = false }

/**
 * Stands in for the hosted endpoint and records what actually left the device:
 * the Authorization header the slot-bound connection factory attached, and the
 * submission it was attached to.
 */
private class RecordingSubmissionConnection(url: URL) : HttpsURLConnection(url) {
    private val written = ByteArrayOutputStream()
    private val acknowledgement: ByteArray by lazy {
        val submission = recordingJson
            .parseToJsonElement(written.toByteArray().decodeToString()) as JsonObject
        buildJsonObject {
            put("submissionId", submission.getValue("submissionId"))
            put("revision", submission.getValue("revision"))
        }.toString().toByteArray()
    }

    fun authorization(): String? = getRequestProperty("Authorization")

    fun submittedSubmissionId(): String? = written.toByteArray()
        .takeIf { it.isNotEmpty() }
        ?.let {
            ((recordingJson.parseToJsonElement(it.decodeToString()) as JsonObject)
                .getValue("submissionId") as JsonPrimitive).content
        }

    override fun connect() = Unit

    override fun disconnect() = Unit

    override fun usingProxy(): Boolean = false

    override fun getCipherSuite(): String = "TLS_SHARED_DEVICE_TEST"

    override fun getLocalCertificates(): Array<Certificate>? = null

    override fun getServerCertificates(): Array<Certificate> = emptyArray()

    override fun getOutputStream(): OutputStream = written

    override fun getInputStream(): InputStream = ByteArrayInputStream(acknowledgement)

    override fun getResponseCode(): Int = 201

    override fun getContentType(): String = "application/json"

    override fun getContentLengthLong(): Long = acknowledgement.size.toLong()
}
