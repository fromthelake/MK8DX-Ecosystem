package nl.mariokart8.mk8dxtimetrials.offline

import java.net.ConnectException
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidEcosystemClientException
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeBootstrap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRecordBook
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AndroidOfflineProfileTest {
    private val unreachable = ConnectException("Failed to connect to /192.168.1.50:443")

    private fun run(id: String, time: Long, mode: Int = 150, published: Boolean = true, retired: Boolean = false) = AndroidOfflineRun(
        submissionId = "user_submission.time.$id", trackId = "track.mario_kart_stadium", mode = mode, totalTimeMs = time,
        laps = listOf(30_000, 30_000, time - 60_000),
        lapDetails = listOf(AndroidManagedLapCounts(5, 1), AndroidManagedLapCounts(10, 0), AndroidManagedLapCounts(15, 2)),
        loadout = mapOf("characterId" to "character.mario"),
        sourceKind = "android_manual", createdAtMs = time,
        publicationStatus = if (published) "published" else "withheld",
        retirementState = if (retired) "retired" else "active",
    )

    private val copy = AndroidOfflineCopy(
        playerId = "player.kiki", playerUsername = "kiki", playerDisplayName = "Kiki",
        runs = listOf(run("A000001", 100_000), run("A000002", 120_000, mode = 200),
            run("A000003", 90_000, published = false), run("A000004", 80_000, retired = true)),
        lastUpdatedAtMs = 7_000,
    )

    private val offline = object : AndroidTimeTrialsEcosystemDataSource {
        override fun home(): AndroidHomeBootstrap = throw unreachable
        override fun leaderboard(trackId: String, mode: Int): List<AndroidPublicTimeTrialResult> = throw unreachable
        override fun playerResults(playerId: String): List<AndroidPublicTimeTrialResult> = throw unreachable
        override fun recordBook(): AndroidRecordBook? = throw unreachable
    }

    @Test fun `my results come from the copy when the community cannot be reached`() {
        val state = AndroidOfflineState()
        val source = AndroidOfflineFallbackDataSource(offline, { copy }, state)
        val results = source.playerResults("player.kiki")
        assertEquals(listOf(150, 200), results.map { it.mode }.sorted())
        assertEquals(2, results.size)
        assertEquals("Kiki", results.first().playerDisplayName)
        assertEquals(listOf(5, 10, 15), results.first { it.mode == 150 }.laps.map { it.coinsCollected })
        assertEquals("character.mario", results.first { it.mode == 150 }.loadout?.characterId)
        assertEquals(7_000L, state.offlineSince.value)
    }

    @Test fun `another Player's results and the record book stay online only`() {
        val source = AndroidOfflineFallbackDataSource(offline, { copy }, AndroidOfflineState())
        try { source.playerResults("player.other"); fail() } catch (_: IllegalStateException) { }
        try { source.recordBook(); fail() } catch (error: ConnectException) { assertTrue(error.isConnectionFailure()) }
    }

    @Test fun `without a copy the failure is passed on`() {
        val source = AndroidOfflineFallbackDataSource(offline, { null }, AndroidOfflineState())
        try { source.playerResults("player.kiki"); fail() } catch (error: ConnectException) { assertTrue(error.isConnectionFailure()) }
    }

    @Test fun `a connection failure reads as a plain sentence, never the platform text`() {
        assertEquals(
            "No connection to 192.168.1.50. Showing what this phone saved.",
            androidNoConnectionText(AndroidProductLanguage.ENGLISH, "https://192.168.1.50", showingCopy = true),
        )
        assertEquals(
            "Geen verbinding met 192.168.1.50.",
            androidNoConnectionText(AndroidProductLanguage.DUTCH, "https://192.168.1.50", showingCopy = false),
        )
        assertEquals(
            "No connection to 192.168.1.50.",
            androidFailureText(unreachable, AndroidProductLanguage.ENGLISH, "https://192.168.1.50", false, "other"),
        )
        // An answer the community gave is not a connection failure.
        val answered = AndroidEcosystemClientException(503, "Unavailable")
        assertFalse(answered.isConnectionFailure())
        assertEquals("other", androidFailureText(answered, AndroidProductLanguage.ENGLISH, "https://192.168.1.50", false, "other"))
        assertTrue(RuntimeException(java.net.UnknownHostException("x")).isConnectionFailure())
    }
}
