package nl.mariokart8.mk8dxtimetrials.scan

import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidTrustedScanSubmissionContextTest {
    private val track = AndroidTrackCatalogEntry(
        "track.mario_kart_stadium",
        0,
        "Mario Kart Stadium",
        3,
    )

    @Test
    fun createsFreshRevisionOneContextForSelectedTrackModeAndTrustedPlayer() {
        val ids = ArrayDeque(listOf("scan-context-0001", "scan-context-0002"))
        val factory = AndroidTrustedScanSubmissionContextFactory(
            playerId = "player.owner_01",
            producerVersion = "android-scan-test",
            opaqueIdProvider = { ids.removeFirst() },
            clock = AndroidOutboxClock { 1_786_917_000_000 },
        )

        val first = factory.create(track, 200)
        val second = factory.create(track, 150)

        assertEquals("user_submission.time.scan-context-0001", first.submissionId)
        assertEquals("track.mario_kart_stadium", first.trackId)
        assertEquals(200, first.mode)
        assertEquals(ScanPlayerReferenceV1("player", "player.owner_01"), first.playerReference)
        assertEquals(1, first.revision)
        assertEquals(1_786_917_000_000, first.createdAtMs)
        assertEquals("scan-context-0001", first.localRecordId)
        assertNotEquals(first.submissionId, second.submissionId)
    }

    @Test
    fun rejectsUntrustedIdentityModeSubmissionAndTrackShapes() {
        listOf("owner", "legacy.owner", "player.Owner", "player.owner/one").forEach { id ->
            assertThrows(IllegalArgumentException::class.java) {
                AndroidTrustedScanSubmissionContextFactory(id, "android-scan-test")
            }
        }
        val badId = AndroidTrustedScanSubmissionContextFactory(
            "player.owner",
            "android-scan-test",
            opaqueIdProvider = { "bad.id" },
        )
        assertThrows(IllegalArgumentException::class.java) { badId.create(track, 150) }
        val valid = AndroidTrustedScanSubmissionContextFactory(
            "player.owner",
            "android-scan-test",
            opaqueIdProvider = { "scan-context-0001" },
        )
        assertThrows(IllegalArgumentException::class.java) { valid.create(track, 100) }
        assertThrows(IllegalArgumentException::class.java) {
            valid.create(track.copy(id = "00_MarioKartStadium"), 150)
        }
        listOf("", " ", "android\ninvalid", "a".repeat(65)).forEach { producer ->
            assertThrows(IllegalArgumentException::class.java) {
                AndroidTrustedScanSubmissionContextFactory("player.owner", producer)
            }
        }
    }

    @Test
    fun createsOfflineLocalProfileScanContextWithoutInferringAPlayer() {
        val context = AndroidTrustedScanSubmissionContextFactory(
            playerReference = ScanPlayerReferenceV1(
                "producer_local_profile",
                "android.synthetic-installation",
            ),
            producerVersion = "android-scan-test",
            opaqueIdProvider = { "scan-local-0001" },
            clock = AndroidOutboxClock { 1_786_917_000_000 },
        ).create(track, 150)
        assertEquals(
            ScanPlayerReferenceV1(
                "producer_local_profile",
                "android.synthetic-installation",
            ),
            context.playerReference,
        )
    }
}
