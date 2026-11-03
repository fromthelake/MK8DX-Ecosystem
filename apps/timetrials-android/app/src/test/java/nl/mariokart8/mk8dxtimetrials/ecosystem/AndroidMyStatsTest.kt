package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.util.Calendar
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** My records & stats on the phone: the same model as the Web's ds-mystats (owner 2026-09-26). */
class AndroidMyStatsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private fun result(trackId: String, mode: Int, timeMs: Long, atMs: Long = 1L, loadout: AndroidActivityLoadout? = null) =
        AndroidPublicTimeTrialResult(
            resultId = "user_submission.time.synthetic_01", playerId = "player.ben", playerUsername = "ben",
            playerDisplayName = "Ben", trackId = trackId, mode = mode, totalTimeMs = timeMs, sourceKind = "web_manual",
            resultAtMs = atMs, loadout = loadout,
        )

    @Test
    fun `every track is a card, raced ones with Mastery, rank and the gap to the next level`() {
        val cards = androidMyStatsCards(
            listOf(AndroidPersonalBest("track.snes_mario_circuit_3", 150, 99_481, 8), AndroidPersonalBest("track.snes_mario_circuit_3", 200, 74_607, 3)),
            150,
            listOf(AndroidFocusRow("track.snes_mario_circuit_3", 150, 99_481, 2, 5, 98_958)),
            listOf(result("track.snes_mario_circuit_3", 150, 99_481, atMs = 1_764_000_000_000)),
        )
        assertEquals(96, cards.size)
        val card = cards.single { it.trackId == "track.snes_mario_circuit_3" }
        val best = card.best!!
        assertEquals(99_481L, best.timeMs)
        assertEquals("Exp C", best.label)
        assertEquals("Exp B", best.nextLabel)
        assertEquals(481L, best.nextGapMs)
        assertEquals(2, best.rank)
        assertEquals(5, best.field)
        assertEquals(1_764_000_000_000L, best.setAtMs)
        val (levels, open) = androidMyStatsDistribution(cards)
        assertEquals(listOf("Exp C" to 1), levels)
        assertEquals(95, open)
    }

    @Test
    fun `momentum counts runs per week and the latest personal best`() {
        val now = Calendar.getInstance().apply { set(2026, Calendar.SEPTEMBER, 26, 12, 0) }.timeInMillis
        val day = 86_400_000L
        val flow = androidMyStatsMomentum(listOf(
            AndroidOwnRun("track.big_blue", 150, 90_000, createdAtMs = now - 20 * day),
            AndroidOwnRun("track.big_blue", 150, 89_558, createdAtMs = now - 3 * day),
            AndroidOwnRun("track.big_blue", 200, 70_000, createdAtMs = now - 3 * day),
        ), 150, now)
        assertEquals(12, flow.weekStarts.size)
        assertEquals(2, flow.runsPerWeek.sum())
        assertEquals(1, flow.recentPbs)
        assertEquals("track.big_blue", flow.latestTrackId)
        assertEquals(442L, flow.latestGainMs)
        assertEquals("14/9", androidWeekLabel(Calendar.getInstance().apply { set(2026, Calendar.SEPTEMBER, 14) }.timeInMillis))
    }

    @Test
    fun `the go-to combo takes the character's own body colour`() {
        val loadout = AndroidActivityLoadout(characterId = "character.inkling_boy", bodyId = "body.buggybud", tireId = "tire.azure_roller", gliderId = "glider.cloud_glider")
        val combo = androidFavouriteCombo(listOf(
            result("track.big_blue", 150, 1, loadout = loadout), result("track.big_blue", 150, 2, loadout = loadout),
            result("track.big_blue", 200, 3, loadout = loadout),
        ), 150)!!
        assertEquals(listOf("character", "body", "tires", "glider"), combo.first.map { it.role })
        assertEquals(2, combo.second)
        val body = combo.first.single { it.role == "body" }
        assertTrue(body.name, body.name.contains("Blue"))
        assertTrue(body.assetPath, body.assetPath.contains("buggybud.000_blue"))
        assertNull(androidFavouriteCombo(emptyList(), 150))
    }

    @Test
    fun `sorting by closest to the next level lists raced tracks only`() {
        val cards = androidMyStatsCards(listOf(
            AndroidPersonalBest("track.snes_mario_circuit_3", 150, 99_481, 8),
            AndroidPersonalBest("track.big_blue", 150, 89_558, 3),
        ), 150, emptyList(), emptyList())
        val sorted = androidSortCards(cards, AndroidRecordSort.NEXT)
        assertEquals(2, sorted.size)
        assertTrue(sorted.first().best!!.nextGapMs!! <= sorted.last().best!!.nextGapMs!!)
    }

    @Test
    fun `the bootstrap's World Record times become the Mastery baseline`() {
        val bootstrap = json.decodeFromString<AndroidHomeBootstrap>(buildString {
            append("""{"schemaVersion":"mk8dx.home-bootstrap.v1","authenticated":false,"worldRecordTimes":{"schemaVersion":"mk8dx.world-record-times.v1","records":[""")
            append(nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog.entries.flatMap { track ->
                listOf(150, 200).map { mode -> """{"mode":$mode,"trackId":"${track.id}","totalTimeMs":60000}""" }
            }.joinToString(","))
            append("]}}")
        })
        val times = bootstrap.worldRecordTimes!!.records
        assertEquals(192, times.size)
        try {
        assertTrue(AndroidMasteryThresholds.applyWorldRecordTimes(times.map { Triple(it.mode, it.trackId, it.totalTimeMs) }))
        assertTrue(AndroidMasteryThresholds.usesLiveWorldRecords)
        val track = times.first().trackId
        assertEquals("Deity", AndroidMasteryThresholds.tierLabels[AndroidMasteryThresholds.trackTier(track, 150, 60_500)!!])
        // An incomplete snapshot changes nothing.
        assertEquals(false, AndroidMasteryThresholds.applyWorldRecordTimes(times.take(10).map { Triple(it.mode, it.trackId, it.totalTimeMs) }))
        } finally {
            AndroidMasteryThresholds.resetToPackagedBaseline()
        }
    }

    @Test
    fun `the rating line marks where each tournament starts`() {
        val points = json.decodeFromString<List<AndroidRatingPoint>>("""
            [{"sequence":1,"tournamentNumber":5,"sectionLabel":"Heat 1","raceIndex":1,"finishPosition":3,"score":20.1},
             {"sequence":2,"tournamentNumber":5,"sectionLabel":"Heat 1","raceIndex":2,"finishPosition":1,"score":22.4,"mu":27.0,"sigma":1.5},
             {"sequence":3,"tournamentNumber":6,"sectionLabel":"Final","raceIndex":1,"finishPosition":2,"score":23.0}]
        """.trimIndent())
        assertEquals(listOf(0 to "TN5", 2 to "TN6"), androidRatingTicks(points))
        assertEquals(27.0, points[1].mu!!, 0.0)
    }

    @Test
    fun `the two server documents parse as the server writes them`() {
        val insights = json.decodeFromString<AndroidPlayerInsights>("""
            {"schemaVersion":"mk8dx.player-insights.v1","playerId":"player.ben",
             "timeTrials":{"submissionCount":2,"personalBests":[{"trackId":"track.big_blue","modeCC":150,"bestTimeMs":89558,"attemptCount":2}]},
             "tournaments":{"raceCount":3,"countedRaceCount":2,"wins":1,"podiums":2,"countedPoints":27,"countedFinishPositionTotal":3}}
        """.trimIndent())
        assertEquals(89_558L, insights.timeTrials.personalBests.single().bestTimeMs)
        val run = json.decodeFromString<AndroidOwnRun>(
            """{"submissionId":"user_submission.time.x123456","revision":1,"trackId":"track.big_blue","modeCC":150,"totalTimeMs":89558,"sourceKind":"web","occurredAtMs":null,"createdAtMs":5}""",
        )
        assertEquals(5L, run.atMs)
    }
}
