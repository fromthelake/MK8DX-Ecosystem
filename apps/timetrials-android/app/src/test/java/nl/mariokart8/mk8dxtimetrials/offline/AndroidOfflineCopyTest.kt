package nl.mariokart8.mk8dxtimetrials.offline

import java.io.File
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrialRevision
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRival
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidHomeBootstrap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTrackBest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

internal fun managedRun(
    id: String,
    timeMs: Long,
    track: String = "track.mario_kart_stadium",
    mode: Int = 150,
    player: String = "player.me",
    retired: Boolean = false,
    createdAtMs: Long = 1_000,
) = AndroidManagedTimeTrial(
    submissionId = "user_submission.time.$id",
    playerId = player,
    playerUsername = "me",
    playerDisplayName = "Me",
    retirementState = if (retired) "retired" else "active",
    publicationStatus = "published",
    publicationReason = "automatic",
    current = AndroidManagedTimeTrialRevision(
        revision = 1, modeCc = mode, trackId = track, totalTimeMs = timeMs,
        laps = listOf(timeMs / 3, timeMs / 3, timeMs - 2 * (timeMs / 3)),
        loadout = mapOf("characterId" to "character.mario"),
        sourceKind = "android_manual", createdAtMs = createdAtMs,
    ),
)

class AndroidOfflineCopyTest {
    @get:Rule val temporary = TemporaryFolder()

    private class FakeSource(
        var runs: () -> List<AndroidManagedTimeTrial>,
        var rivals: () -> List<AndroidRival> = { listOf(AndroidRival("player.rival", "Rival")) },
    ) : AndroidOfflineCopySource {
        override fun ownRuns(): List<AndroidManagedTimeTrial> = runs()
        override fun rivals(): List<AndroidRival> = rivals.invoke()
        override fun rivalBests(playerIds: List<String>): Map<String, List<AndroidTrackBest>> =
            playerIds.associateWith { listOf(AndroidTrackBest("track.mario_kart_stadium", 150, 99_000, 3)) }
    }

    private fun store() = AndroidOfflineCopyStore(File(temporary.root, "copy-${System.nanoTime()}.json"))

    @Test fun `each community has its own copy file and the packaged default keeps the plain name`() {
        val club = "https://club.example"
        val online = "https://online.example"
        assertEquals("time-trial-offline-copy-v1.json", AndroidOfflineCopyStore.fileName(club, packaged = club))
        assertEquals(
            "time-trial-offline-copy-v1_" + AndroidServerOrigin.namespaceOf(online) + ".json",
            AndroidOfflineCopyStore.fileName(online, packaged = club),
        )
        assertTrue(AndroidOfflineCopyStore.fileName(club, packaged = online) != AndroidOfflineCopyStore.fileName(online, packaged = club))
    }

    @Test fun `a refresh copies own runs in full and the rivals' bests`() {
        val store = store()
        val result = refreshAndroidOfflineCopy(
            store, FakeSource({ listOf(managedRun("RUN0000001", 100_000), managedRun("OTHER00001", 1, player = "player.other")) }),
            "player.me", 5_000,
        )
        assertTrue(result is AndroidOfflineRefresh.Updated)
        val copy = store.read()!!
        assertEquals(listOf("user_submission.time.RUN0000001"), copy.runs.map { it.submissionId })
        assertEquals(3, copy.runs.single().laps.size)
        assertEquals("character.mario", copy.runs.single().loadout?.get("characterId"))
        assertEquals(99_000, copy.bestsOf("player.rival").single().totalTimeMs)
        assertEquals(5_000, copy.lastUpdatedAtMs)
    }

    @Test fun `a failed refresh keeps the old copy`() {
        val store = store()
        val source = FakeSource({ listOf(managedRun("RUN0000001", 100_000)) })
        refreshAndroidOfflineCopy(store, source, "player.me", 5_000)
        source.runs = { error("offline") }
        val result = refreshAndroidOfflineCopy(store, source, "player.me", 9_000)
        assertTrue(result is AndroidOfflineRefresh.Kept)
        assertEquals(5_000, store.read()!!.lastUpdatedAtMs)
        assertEquals(1, store.read()!!.runs.size)
    }

    @Test fun `failing rivals keep the previous rivals but update own runs`() {
        val store = store()
        val source = FakeSource({ listOf(managedRun("RUN0000001", 100_000)) })
        refreshAndroidOfflineCopy(store, source, "player.me", 5_000)
        source.runs = { listOf(managedRun("RUN0000001", 100_000), managedRun("RUN0000002", 95_000)) }
        source.rivals = { error("offline") }
        refreshAndroidOfflineCopy(store, source, "player.me", 6_000)
        val copy = store.read()!!
        assertEquals(2, copy.runs.size)
        assertEquals(listOf("player.rival"), copy.rivals.map { it.playerId })
    }

    @Test fun `another account on the phone never reads the copy`() {
        val store = store()
        refreshAndroidOfflineCopy(store, FakeSource({ listOf(managedRun("RUN0000001", 100_000)) }), "player.me", 5_000)
        assertNull(store.readFor("player.someone"))
        assertNull(store.readFor(null))
    }

    @Test fun `offline reads come from the copy and say since when`() {
        val store = store()
        refreshAndroidOfflineCopy(
            store,
            FakeSource({ listOf(managedRun("RUN0000001", 100_000), managedRun("RUN0000002", 97_000), managedRun("RUN0000003", 90_000, retired = true)) }),
            "player.me", 5_000,
        )
        val offline = object : AndroidTimeTrialsEcosystemDataSource {
            override fun home(): AndroidHomeBootstrap = error("offline")
            override fun leaderboard(trackId: String, mode: Int): List<AndroidPublicTimeTrialResult> = error("offline")
            override fun managedTimeTrials(): List<AndroidManagedTimeTrial> = error("offline")
            override fun rivals(): List<AndroidRival> = error("offline")
            override fun trackBestsFor(playerId: String): List<AndroidTrackBest> = error("offline")
            override fun playerInsights(): nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPlayerInsights? = error("offline")
        }
        val state = AndroidOfflineState()
        val source = AndroidOfflineFallbackDataSource(offline, { store.readFor("player.me") }, state)
        assertEquals(3, source.managedTimeTrials().size)
        assertEquals(5_000L, state.offlineSince.value)
        assertEquals(97_000, source.trackBestsFor("player.me").single().totalTimeMs)
        assertEquals(99_000, source.trackBestsFor("player.rival").single().totalTimeMs)
        assertEquals(97_000, source.playerInsights()!!.timeTrials.personalBests.single().bestTimeMs)
        assertEquals("player.rival", source.rivals().single().playerId)
        // Anybody else's data is not in the copy and fails as before.
        try { source.trackBestsFor("player.stranger"); fail() } catch (_: IllegalStateException) { }
        try { source.home(); fail() } catch (_: IllegalStateException) { }
    }
}
