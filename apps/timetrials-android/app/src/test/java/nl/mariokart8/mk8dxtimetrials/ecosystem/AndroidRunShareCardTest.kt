package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidRunShareCardTest {
    private val result = AndroidPublicTimeTrialResult(
        resultId = "user_submission.time.A1",
        playerId = "player.ben",
        playerUsername = "ben",
        playerDisplayName = "Ben",
        trackId = "track.mario_kart_stadium",
        mode = 200,
        totalTimeMs = 95_432,
        laps = listOf(
            AndroidActivityLap(2, 31_500, coinsCollected = 7, mushroomsUsed = 1),
            AndroidActivityLap(1, 31_000, coinsCollected = 3, mushroomsUsed = 1),
        ),
        sourceKind = "android_scan",
    )

    @Test
    fun `the card carries the track, cup, class, setup, laps and the link to its Details`() {
        val model = androidRunShareModelOf(
            result, 2, listOf("private-product/img/c/mario.png" to "Mario", null), "https://example.invalid",
        )
        assertEquals("Mario Kart Stadium", model.trackName)
        assertEquals("private-product/img/track/0.png", model.trackAsset)
        assertEquals("private-product/img/cup/0.png", model.cupAsset)
        assertTrue(model.cupName.isNotEmpty())
        assertEquals(listOf("private-product/img/c/mario.png" to "Mario"), model.parts)
        // Laps in order, coins as the gain per lap (the result stores the balance).
        assertEquals(listOf(1, 2), model.laps.map { it.lapNumber })
        assertEquals(listOf(3, 4), model.laps.map { it.coins })
        assertEquals(
            "https://example.invalid/?lb=0&mode=200&run=user_submission.time.A1",
            model.url,
        )
        assertEquals("Ben · Mario Kart Stadium 200cc · 1:35.432 (#2)\n${model.url}", androidRunShareText(model))
        assertEquals("mk8dx-mario-kart-stadium-200cc-ben.png", androidRunShareFileName(model))
    }

    @Test
    fun `a shared run is named by an 8-character code and found once on the board`() {
        assertEquals("41c260da", androidRunCode("user_submission.time.firebase_41c260dac25d3a3b3f0d90e1"))
        assertEquals("d5b96452", androidRunCode("user_submission.time.LIVETRIALd5b96452115dcbb2ff9dec7f6ddf7882"))
        assertEquals("a85ae472", androidRunCode("user_submission.time.a85ae472-de8c-4a9a-a329-3937d732693e"))
        assertEquals(
            "https://example.invalid/?lb=8&mode=150&run=41c260da",
            androidRunShareUrl("https://example.invalid", "track.sunshine_airport", 150,
                "user_submission.time.firebase_41c260dac25d3a3b3f0d90e1"),
        )
        val board = listOf("user_submission.time.firebase_41c260dac25d3a3b3f0d90e1",
            "user_submission.time.a85ae472-de8c-4a9a-a329-3937d732693e")
        assertEquals(board[0], androidFindRun(board, "41c260da"))
        assertEquals(board[0], androidFindRun(board, "firebase_41c260dac25d3a3b3f0d90e1"))
        assertEquals(board[1], androidFindRun(board, board[1]))
        assertNull(androidFindRun(board, "ffffffff"))
        assertNull(androidFindRun(board + "user_submission.time.41c260da-0000", "41c260da"))
    }

    @Test
    fun `a shared run opens once, and only on its own track`() {
        AndroidRunFocus.request("track.mario_kart_stadium", "r1")
        assertNull(AndroidRunFocus.pendingFor("track.water_park"))
        assertEquals("r1", AndroidRunFocus.pendingFor("track.mario_kart_stadium"))
        AndroidRunFocus.opened()
        assertNull(AndroidRunFocus.pendingFor("track.mario_kart_stadium"))
    }
}
