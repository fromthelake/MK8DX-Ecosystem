package nl.mariokart8.mk8dxtimetrials.posttime

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Android half of the submission-prediction parity
 * (POST_A_TIME_ARCHITECTURE §5). It runs **the same case file** the web task
 * and the server's `computeSubmissionFeedback` are run over
 * (`tooling/design-system/fixtures/prediction-cases.json`), so the number the
 * phone shows before publishing and the `?feedback=` answer that replaces it
 * afterwards cannot drift apart.
 */
class AndroidPostTimePredictionTest {
    private val caseFile: File = generateSequence(File(System.getProperty("user.dir")!!).absoluteFile) { it.parentFile }
        .map { File(it, "tooling/design-system/fixtures/prediction-cases.json") }
        .firstOrNull { it.isFile }
        ?: error("tooling/design-system/fixtures/prediction-cases.json not found above ${System.getProperty("user.dir")}")

    @Test
    fun everySharedPredictionCaseMatchesTheServersArithmetic() {
        val cases = Json.parseToJsonElement(caseFile.readText()).jsonObject
            .getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        val failures = mutableListOf<String>()
        for (case in cases) {
            val id = case.getValue("id").jsonPrimitive.content
            val subject = case.getValue("subject").jsonObject
            val competitors = case.getValue("competitors").jsonArray.map { entry ->
                val competitor = entry.jsonObject
                AndroidPredictionCompetitor(
                    playerId = competitor.getValue("playerId").jsonPrimitive.content,
                    displayName = competitor.getValue("displayName").jsonPrimitive.content,
                    bestMs = competitor.getValue("bestMs").jsonPrimitive.int.toLong(),
                )
            }
            val rivals = case.getValue("rivals").jsonArray.map { it.jsonPrimitive.content }.toSet()
            val expect = case.getValue("expect").jsonObject
            val prediction = androidPredictSubmission(
                totalTimeMs = subject.getValue("totalTimeMs").jsonPrimitive.int.toLong(),
                previousBestMs = subject.getValue("previousBestMs").jsonPrimitive.intOrNull?.toLong(),
                competitors = competitors,
                rivalPlayerIds = rivals,
                // The shared cases are a complete field, as the server's is.
                boardComplete = true,
            )
            val observed = listOf(
                "improved" to prediction.improved,
                "deltaMs" to prediction.deltaMs?.toInt(),
                "rankAfter" to prediction.rankAfter,
                "rankBefore" to prediction.rankBefore,
                "passedCount" to prediction.passedCount,
                "rivalsPassed" to prediction.rivalsPassed,
                "passed" to prediction.passed.map { it.playerId },
            )
            for ((key, value) in observed) {
                val wanted: Any? = when (key) {
                    "passed" -> expect.getValue("passed").jsonArray.map { it.jsonPrimitive.content }
                    "improved" -> expect.getValue("improved").jsonPrimitive.content.toBoolean()
                    else -> expect.getValue(key).jsonPrimitive.intOrNull
                }
                if (value != wanted) failures += "$id/$key: expected $wanted, got $value"
            }
        }
        println("submission-prediction parity (Kotlin): ran ${cases.size} shared cases")
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun `a time beyond the loaded board is not given an invented rank`() {
        val competitors = (1..100).map {
            AndroidPredictionCompetitor("player.p$it", "P$it", 100_000L + it * 10)
        }
        val prediction = androidPredictSubmission(
            totalTimeMs = 200_000L,
            previousBestMs = null,
            competitors = competitors,
            rivalPlayerIds = emptySet(),
            boardComplete = false,
        )
        assertNull(prediction.rankAfter)
        assertEquals(
            "Outside the top 100.",
            androidPositionLine(prediction, true, Mk8dxNumberLanguage.EN, AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun `inside a complete board the position and the field are exact`() {
        val rows = listOf(
            AndroidPredictionBoardRow("player.valerio", "Valerio", 104_843),
            AndroidPredictionBoardRow("player.ben", "Ben", 106_784),
            AndroidPredictionBoardRow("player.floyd", "Floyd", 107_865),
        )
        val prediction = androidPredictFromBoard(105_912, rows, "player.ben", null, emptySet())
        assertEquals(2, prediction.rankAfter)
        assertEquals(3, prediction.fieldCount)
        assertTrue(prediction.fieldComplete)
        assertEquals(
            "Predicted position 2 of 3.",
            androidPositionLine(prediction, true, Mk8dxNumberLanguage.EN, AndroidProductLanguage.ENGLISH),
        )
        assertEquals("Valerio", prediction.ahead?.displayName)
        assertEquals(1_069L, prediction.ahead?.gapMs)
        assertEquals("Floyd", prediction.behind?.displayName)
        assertEquals(-1_953L, prediction.behind?.gapMs)
        assertEquals(
            "Personal best — −0.872 faster than 1:46.784.",
            androidPersonalBestLine(prediction, AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun `a slower scan explains that the existing PB keeps its standing`() {
        val prediction = androidPredictSubmission(
            totalTimeMs = 74_723,
            previousBestMs = 67_302,
            competitors = listOf(
                AndroidPredictionCompetitor("player.matteo", "Matteo", 67_124),
                AndroidPredictionCompetitor("player.valerio", "Valerio", 67_321),
            ),
            rivalPlayerIds = emptySet(),
            boardComplete = true,
        )
        assertEquals(
            "Your leaderboard position stays #2 of 3, based on your 1:07.302 PB.",
            androidPositionLine(
                prediction,
                true,
                Mk8dxNumberLanguage.EN,
                AndroidProductLanguage.ENGLISH,
            ),
        )
        assertEquals("0.178", androidUnsignedDelta(prediction.ahead!!.gapMs))
        assertEquals("0.019", androidUnsignedDelta(prediction.behind!!.gapMs))
        assertEquals(
            "This time is +7.421 slower than your 1:07.302 PB.",
            androidPersonalBestLine(prediction, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "Delta to Matteo remains +0.178 · your PB is behind.",
            androidNeighbourLine(prediction.ahead!!, prediction.keepsExistingBest(), AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "Delta to Valerio remains −0.019 · your PB is ahead.",
            androidNeighbourLine(prediction.behind!!, prediction.keepsExistingBest(), AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun `an improved scanned run shows its direct signed delta to the passed player`() {
        val prediction = androidPredictSubmission(
            totalTimeMs = 66_559,
            previousBestMs = 67_302,
            competitors = listOf(
                AndroidPredictionCompetitor("player.matteo", "Matteo", 67_124),
                AndroidPredictionCompetitor("player.valerio", "Valerio", 67_321),
            ),
            rivalPlayerIds = emptySet(),
            boardComplete = true,
        )
        assertEquals(
            "Delta to Matteo: −0.565 · you would be ahead.",
            androidNeighbourLine(prediction.behind!!, prediction.keepsExistingBest(), AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun `the panel says it is waiting rather than guessing while the board loads`() {
        assertEquals(
            "Loading the leaderboard for the predicted position…",
            androidPersonalBestLine(null, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "The predicted position needs the leaderboard.",
            androidPositionLine(null, false, Mk8dxNumberLanguage.EN, AndroidProductLanguage.ENGLISH),
        )
    }
}
