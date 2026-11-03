package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrialRevision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Manage in the form of Post a Time (ADR-0211); twins of the Web's time-trial-management tests. */
class AndroidPostTimeEditTest {
    private val published = AndroidManagedTimeTrial(
        submissionId = "user_submission.time.RESULT01", playerId = "player.ben", playerUsername = "ben",
        playerDisplayName = "Ben", retirementState = "active", publicationStatus = "published",
        publicationReason = "accepted",
        current = AndroidManagedTimeTrialRevision(
            revision = 1, modeCc = 150, trackId = "track.mario_kart_stadium", totalTimeMs = 105_912,
            laps = listOf(35_000, 35_456, 35_456),
            lapDetails = listOf(AndroidManagedLapCounts(8, 1), AndroidManagedLapCounts(9, 1), AndroidManagedLapCounts(10, 1)),
            loadout = mapOf("characterId" to "character.mario", "characterVariantId" to "character_variant.x",
                "bodyId" to "body.standard_kart", "tireId" to "tire.standard", "gliderId" to "glider.super_glider"),
            sourceKind = "android_manual", createdAtMs = 1,
        ),
    )

    @Test
    fun theFormIsFilledFromThePublishedResultWithCoinBalancesAsChanges() {
        val draft = androidEditDraftOf(published, 3)
        assertEquals("145912", draft.totalDigits)
        assertEquals(listOf("035000", "035456", "035456"), draft.laps.map { it.timeDigits })
        assertEquals(listOf(8, 1, 1), draft.laps.map { it.coinChange })
        assertEquals(listOf(1, 1, 1), draft.laps.map { it.mushroomsUsed })
        assertEquals("character.mario", draft.loadout["characterId"])
    }

    @Test
    fun onlyWhatChangedIsSent() {
        val original = androidEditDraftOf(published, 3)
        assertNull(androidCorrectionOf(original, original, androidValidatePostTime(original).payload!!, "incorrect_time"))

        // A new total and laps: the counts and the kart setup keep what they recorded.
        val retimed = original.withTotalDigits("145900").withLapDigits(2, "035444")
        val timeOnly = androidCorrectionOf(original, retimed, androidValidatePostTime(retimed).payload!!, "incorrect_time")!!
        assertEquals(105_900L, timeOnly.totalTimeMs)
        assertEquals(listOf(35_000L, 35_456L, 35_444L), timeOnly.laps)
        assertNull(timeOnly.lapDetails)
        assertNull(timeOnly.loadout)

        // A coin fixed: the laps' counts travel as balances, as a submission's do.
        val coins = original.withLapCoinChange(2, 0)
        val counts = androidCorrectionOf(original, coins, androidValidatePostTime(coins).payload!!, "incorrect_time", "  typo  ")!!
        assertEquals(listOf(8, 9, 9), counts.lapDetails?.map { it.coinsCollected })
        assertEquals("typo", counts.note)
        assertNull(counts.loadout)

        val setup = original.withLoadoutPart("tireId", "tire.roller")
        assertEquals("tire.roller", androidCorrectionOf(original, setup, androidValidatePostTime(setup).payload!!, "other")?.loadout?.get("tireId"))
    }

    @Test
    fun onlyAYouTubeLinkIsAVideo() {
        listOf(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s", "youtu.be/dQw4w9WgXcQ",
            "https://m.youtube.com/shorts/dQw4w9WgXcQ", "http://youtube.com/embed/dQw4w9WgXcQ",
        ).forEach { assertEquals(it, "dQw4w9WgXcQ", androidYouTubeVideoId(it)) }
        listOf("https://vimeo.com/123", "https://youtube.com/watch?v=short", "not a link", "https://user@youtu.be/dQw4w9WgXcQ")
            .forEach { assertNull(it, androidYouTubeVideoId(it)) }
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", androidYouTubeWatchUrl("youtu.be/dQw4w9WgXcQ"))
        assertNull(androidVideoLinkProblem("", dutch = false))
        assertEquals("Paste a link to the YouTube video, for example https://youtu.be/…", androidVideoLinkProblem("x", dutch = false))
    }
}
