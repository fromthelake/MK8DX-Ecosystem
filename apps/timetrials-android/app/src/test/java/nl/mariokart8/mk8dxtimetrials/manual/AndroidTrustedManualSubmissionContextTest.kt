package nl.mariokart8.mk8dxtimetrials.manual

import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class AndroidTrustedManualSubmissionContextTest {
    private val track = AndroidTrackCatalogEntry(
        "track.mario_kart_stadium",
        0,
        "Mario Kart Stadium",
        3,
    )

    @Test
    fun createsFreshRevisionOneContextForOneTrustedCentralPlayerAndStableTrack() {
        val ids = ArrayDeque(listOf("manual-context-0001", "manual-context-0002"))
        val factory = AndroidTrustedManualSubmissionContextFactory(
            playerId = "player.owner_01",
            producerVersion = "android-test",
            opaqueIdProvider = { ids.removeFirst() },
            clock = AndroidOutboxClock { 1_786_910_000_000 },
        )

        val first = factory.create(track)
        val second = factory.create(track)

        assertEquals("user_submission.time.manual-context-0001", first.submissionId)
        assertEquals("track.mario_kart_stadium", first.trackId)
        assertEquals(ManualPlayerReferenceV1("player", "player.owner_01"), first.playerReference)
        assertEquals(1, first.revision)
        assertEquals(1_786_910_000_000, first.createdAtMs)
        assertEquals("manual-context-0001", first.localRecordId)
        assertNotEquals(first.submissionId, second.submissionId)
    }

    @Test
    fun rejectsUntrustedIdentitySubmissionAndTrackShapes() {
        listOf("owner", "legacy_firebase_user.owner", "player.Owner", "player.owner/one")
            .forEach { playerId ->
                org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                    AndroidTrustedManualSubmissionContextFactory(playerId, "android-test")
                }
            }
        val factory = AndroidTrustedManualSubmissionContextFactory(
            "player.owner",
            "android-test",
            opaqueIdProvider = { "bad.id" },
        )
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            factory.create(track)
        }
        val validFactory = AndroidTrustedManualSubmissionContextFactory(
            "player.owner",
            "android-test",
            opaqueIdProvider = { "manual-context-0001" },
        )
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            validFactory.create(track.copy(id = "00_MarioKartStadium"))
        }
        listOf("", " ", "android\ninvalid", "a".repeat(65)).forEach { producer ->
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                AndroidTrustedManualSubmissionContextFactory("player.owner", producer)
            }
        }
    }

    @Test
    fun createsOfflineLocalProfileContextWithoutInferringAPlayer() {
        val context = AndroidTrustedManualSubmissionContextFactory(
            playerReference = ManualPlayerReferenceV1(
                "producer_local_profile",
                "android.synthetic-installation",
            ),
            producerVersion = "android-test",
            opaqueIdProvider = { "manual-local-0001" },
            clock = AndroidOutboxClock { 1_786_910_000_000 },
        ).create(track)
        assertEquals(
            ManualPlayerReferenceV1(
                "producer_local_profile",
                "android.synthetic-installation",
            ),
            context.playerReference,
        )
    }
}
