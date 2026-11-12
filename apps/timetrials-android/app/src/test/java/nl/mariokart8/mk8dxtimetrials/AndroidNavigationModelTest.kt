package nl.mariokart8.mk8dxtimetrials

import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidAutoSave
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrialRevision
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidYouTab
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidMyTimesGroups
import nl.mariokart8.mk8dxtimetrials.ecosystem.androidSettingsAutoSave
import nl.mariokart8.mk8dxtimetrials.ecosystem.asPublicResult
import org.junit.Assert.assertEquals
import org.junit.Test

/** The navigation and Settings redesign of 2026-11-13: routes, the community chip, auto-save, My times. */
class AndroidNavigationModelTest {
    @Test fun `the avatar always opens You, so Settings stays reachable signed out`() {
        assertEquals(AndroidTimeTrialsProductRoute.PROFILE, androidYouRoute(signedIn = true))
        assertEquals(AndroidTimeTrialsProductRoute.PROFILE, androidYouRoute(signedIn = false))
    }

    @Test fun `You has My times, Records and Rivals in that order`() {
        assertEquals(listOf(AndroidYouTab.MY_TIMES, AndroidYouTab.RECORDS, AndroidYouTab.RIVALS), AndroidYouTab.entries.toList())
    }

    @Test fun `the community chip names the community, else its host`() {
        val list = listOf(
            AndroidCommunity("https://club.example", "Club Noord", 2),
            AndroidCommunity("https://online.example", "online.example", 1),
        )
        assertEquals("Club Noord", androidCommunityChipLabel(list, "https://club.example"))
        assertEquals("online.example", androidCommunityChipLabel(list, "https://online.example"))
        assertEquals("192.168.1.50", androidCommunityChipLabel(emptyList(), "https://192.168.1.50"))
        assertEquals("127.0.0.1:65262", androidCommunityChipLabel(list, "https://127.0.0.1:65262"))
    }

    @Test fun `a typed setting saves only what changed, trimmed, and blank clears it`() {
        assertEquals(AndroidAutoSave.Unchanged, androidSettingsAutoSave("Kiki", "Kiki"))
        assertEquals(AndroidAutoSave.Unchanged, androidSettingsAutoSave("  Kiki ", "Kiki"))
        assertEquals(AndroidAutoSave.Unchanged, androidSettingsAutoSave("", null))
        assertEquals(AndroidAutoSave.Save("Kiki K"), androidSettingsAutoSave(" Kiki K ", "Kiki"))
        assertEquals(AndroidAutoSave.Save(null), androidSettingsAutoSave("   ", "Kiki"))
    }

    private fun run(id: String, time: Long, track: String = "track.mario_kart_stadium", mode: Int = 150,
                    player: String = "player.kiki", retired: Boolean = false) = AndroidManagedTimeTrial(
        submissionId = "user_submission.time.$id",
        playerId = player, playerUsername = "kiki", playerDisplayName = "Kiki",
        retirementState = if (retired) "retired" else "active",
        publicationStatus = "published", publicationReason = "automatic",
        current = AndroidManagedTimeTrialRevision(
            revision = 1, modeCc = mode, trackId = track, totalTimeMs = time,
            laps = listOf(30_000, 30_000, time - 60_000),
            lapDetails = listOf(AndroidManagedLapCounts(5, 1), AndroidManagedLapCounts(10, 0), AndroidManagedLapCounts(15, 2)),
            loadout = mapOf("characterId" to "character.mario"),
            sourceKind = "android_manual", createdAtMs = time,
        ),
    )

    @Test fun `My times is one list per track and class with the personal best first`() {
        val groups = androidMyTimesGroups(
            listOf(
                run("A000001", 100_000),
                run("A000002", 95_000),
                run("A000003", 90_000, retired = true),
                run("A000004", 120_000, mode = 200),
                run("A000005", 110_000, track = "track.water_park"),
                run("A000006", 80_000, player = "player.other"),
            ),
            "player.kiki",
        )
        assertEquals(listOf("150|track.mario_kart_stadium", "150|track.water_park", "200|track.mario_kart_stadium"), groups.map { it.key })
        assertEquals(listOf(95_000L, 100_000L), groups.first().runs.map { it.current.totalTimeMs })
        assertEquals("user_submission.time.A000002", groups.first().best.submissionId)
    }

    @Test fun `a run's details keep its laps, coins, mushrooms and build`() {
        val card = run("A000001", 100_000).asPublicResult()
        assertEquals(listOf(5, 10, 15), card.laps.map { it.coinsCollected })
        assertEquals(listOf(1, 0, 2), card.laps.map { it.mushroomsUsed })
        assertEquals("character.mario", card.loadout?.characterId)
        assertEquals(150, card.mode)
    }
}
