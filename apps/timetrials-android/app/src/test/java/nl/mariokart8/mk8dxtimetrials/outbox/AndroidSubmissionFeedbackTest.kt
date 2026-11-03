package nl.mariokart8.mk8dxtimetrials.outbox

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidSubmissionFeedbackTest {
    private fun block(body: String): JsonObject = Json.parseToJsonElement(body) as JsonObject

    private val improved = block(
        """
        {"trackId":"track.mario_kart_stadium","modeCc":150,"totalTimeMs":106784,
         "personalBest":{"previousBestMs":107096,"deltaMs":-312,"improved":true},
         "rank":{"after":2,"before":4,"passedCount":3,"rivalsPassed":1,
                 "passed":[{"playerId":"player.evan","username":"evan","displayName":"Evan","bestMs":106900,"rival":true},
                           {"playerId":"player.nova","username":"nova","displayName":"Nova","bestMs":107000,"rival":false}]}}
        """.trimIndent(),
    )

    @Test
    fun saysWhatTheTimeMeantInBothLanguages() {
        val feedback = androidSubmissionFeedbackOrNull(improved)!!
        assertEquals(
            listOf(
                "New personal best: 1:46.784, 0.312s faster than your 1:47.096.",
                "Now #2 on the leaderboard, up from #4.",
                "Passed 3 players, 1 of them rivals: Evan (rival), Nova and 1 more.",
            ),
            feedback.lines(AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            listOf(
                "Nieuw persoonlijk record: 1:46.784, 0.312s sneller dan je 1:47.096.",
                "Nu #2 op het klassement, omhoog van #4.",
                "Ingehaald (3 spelers, 1 rivalen): Evan (rivaal), Nova en nog 1.",
            ),
            feedback.lines(AndroidProductLanguage.DUTCH),
        )
    }

    @Test
    fun aFirstTimeAndASlowerTimeReadDifferently() {
        val first = androidSubmissionFeedbackOrNull(
            block(
                """
                {"trackId":"track.mario_kart_stadium","modeCc":200,"totalTimeMs":94612,
                 "personalBest":{"previousBestMs":null,"deltaMs":null,"improved":true},
                 "rank":{"after":3,"before":null,"passedCount":0,"rivalsPassed":0,"passed":[]}}
                """.trimIndent(),
            ),
        )!!
        assertEquals(
            listOf("First time on this track in 200cc: 1:34.612.", "You enter the leaderboard at #3."),
            first.lines(AndroidProductLanguage.ENGLISH),
        )
        val slower = androidSubmissionFeedbackOrNull(
            block(
                """
                {"trackId":"track.mario_kart_stadium","modeCc":150,"totalTimeMs":107500,
                 "personalBest":{"previousBestMs":107096,"deltaMs":404,"improved":false},
                 "rank":{"after":4,"before":4,"passedCount":0,"rivalsPassed":0,"passed":[]}}
                """.trimIndent(),
            ),
        )!!
        assertEquals(
            listOf("1:47.500, 0.404s behind your best of 1:47.096.", "You stay #4 on the leaderboard."),
            slower.lines(AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun anEqualTimeBecomesTheCurrentEnrichedPersonalBestWithoutPassingAnyone() {
        val equal = androidSubmissionFeedbackOrNull(
            block(
                """
                {"trackId":"track.mario_kart_stadium","modeCc":150,"totalTimeMs":107096,
                 "personalBest":{"previousBestMs":107096,"deltaMs":0,"improved":true},
                 "rank":{"after":4,"before":4,"passedCount":0,"rivalsPassed":0,"passed":[]}}
                """.trimIndent(),
            ),
        )!!
        assertEquals(
            listOf(
                "1:47.096 matches your personal best. This run is now your current PB with its added details.",
                "You stay #4 on the leaderboard.",
            ),
            equal.lines(AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            listOf(
                "1:47.096 evenaart je persoonlijk record. Deze run is nu je actuele PR met de toegevoegde details.",
                "Je blijft #4 op het klassement.",
            ),
            equal.lines(AndroidProductLanguage.DUTCH),
        )
    }

    @Test
    fun rejectsAnythingOffShape() {
        assertNull(androidSubmissionFeedbackOrNull(null))
        assertNull(androidSubmissionFeedbackOrNull(block("""{"trackId":"t"}""")))
        assertNull(androidSubmissionFeedbackOrNull(block(improved.toString().replace("\"after\":2", "\"after\":0"))))
        assertNull(androidSubmissionFeedbackOrNull(block(improved.toString().replace("\"rival\":true", "\"rival\":\"yes\""))))
        assertNull(androidSubmissionFeedbackOrNull(block(improved.toString().replace("\"modeCc\":150", "\"modeCc\":100"))))
    }
}
