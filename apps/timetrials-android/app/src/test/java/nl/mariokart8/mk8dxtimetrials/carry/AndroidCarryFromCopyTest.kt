package nl.mariokart8.mk8dxtimetrials.carry

import java.io.File
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.offline.AndroidOfflineCopy
import nl.mariokart8.mk8dxtimetrials.offline.AndroidOfflineRun
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidCarryFromCopyTest {
    @get:Rule val temporary = TemporaryFolder()
    private val club = "https://club.example"
    private val online = "https://online.example"

    private fun run(id: String, time: Long, track: String = "track.mario_kart_stadium", mode: Int = 150, retired: Boolean = false) =
        AndroidOfflineRun(
            submissionId = "user_submission.time.$id",
            trackId = track, mode = mode, totalTimeMs = time,
            laps = listOf(30_000, 30_000, time - 60_000),
            lapDetails = listOf(AndroidManagedLapCounts(5, 1), AndroidManagedLapCounts(10, 1), AndroidManagedLapCounts(15, 1)),
            loadout = mapOf("characterId" to "character.mario", "characterVariantId" to "x"),
            sourceKind = "web_manual", createdAtMs = 1_000,
            publicationStatus = "published", retirementState = if (retired) "retired" else "active",
        )

    private fun copy(player: String, vararg runs: AndroidOfflineRun) =
        AndroidOfflineCopy(playerId = player, runs = runs.toList(), lastUpdatedAtMs = 1)

    @Test fun `best times take the personal best per track and class`() {
        val source = copy("player.me",
            run("A000001", 100_000), run("A000002", 95_000), run("A000003", 90_000, retired = true),
            run("A000004", 120_000, mode = 200),
            run("A000005", 110_000, track = "track.water_park"),
        )
        val plan = planAndroidBestTimes(source, copy("player.there"))
        assertEquals(
            setOf("user_submission.time.A000002", "user_submission.time.A000004", "user_submission.time.A000005"),
            plan.toCarry.map { it.submissionId }.toSet(),
        )
        assertTrue(plan.skipped.isEmpty())
    }

    @Test fun `a better time in the target is skipped, an equal time is sent`() {
        val source = copy("player.me",
            run("A000001", 95_000),
            run("A000002", 110_000, track = "track.water_park"),
            run("A000003", 120_000, mode = 200),
        )
        val target = copy("player.there",
            run("B000001", 95_000),
            run("B000002", 105_000, track = "track.water_park"),
            run("B000003", 125_000, mode = 200),
        )
        val plan = planAndroidBestTimes(source, target)
        assertEquals(
            listOf("user_submission.time.A000001", "user_submission.time.A000003"),
            plan.toCarry.map { it.submissionId },
        )
        assertEquals(listOf("user_submission.time.A000002"), plan.skipped.map { it.submissionId })
    }

    @Test fun `a copied run becomes a complete carried submission with laps and build`() {
        val from = androidCarriedFromOf(run("A000001", 95_000), club, null)
        assertEquals("user_submission.time.A000001", from.originalSubmissionId)
        val staged = androidStagedFromCopiedRun(run("A000001", 95_000), from, "COPYCARRY01", 5_000)
        assertNull(staged["playerReference"])
        val laps = staged["laps"]!!.jsonArray
        assertEquals(3, laps.size)
        assertEquals("10", laps[1].jsonObject["coinsCollected"]!!.jsonPrimitive.content)
        assertEquals("character.mario", staged["loadout"]!!.jsonObject["characterId"]!!.jsonPrimitive.content)
        assertEquals("1000", staged["timestamps"]!!.jsonObject["occurredAtMs"]!!.jsonPrimitive.content)
        assertEquals(club, staged["carriedFrom"]!!.jsonObject["origin"]!!.jsonPrimitive.content)
        androidCompletedCarriedSubmission(staged, "player.receiver")
    }

    @Test fun `carrying from the copy asks the target first and never queues a run twice`() {
        val queue = AndroidCarriedQueue(File(temporary.root, "queue.json"))
        var ids = 0
        fun carry(policy: AndroidCarriedTimesPolicy, vararg runs: AndroidOfflineRun) = carryAndroidCopiedRuns(
            runs.toList(), club, null, online, { policy }, queue, { emptyList() }, 5_000, { "COPYCARRY${ids++}X" },
        )
        assertEquals(AndroidCopiedCarryOutcome.Refused, carry(AndroidCarriedTimesPolicy.OFF, run("A000001", 95_000)))
        assertEquals(0, queue.size())
        assertEquals(
            AndroidCopiedCarryOutcome.Queued(2, 0, review = true),
            carry(AndroidCarriedTimesPolicy.REVIEW, run("A000001", 95_000), run("A000002", 96_000)),
        )
        assertEquals(
            AndroidCopiedCarryOutcome.Queued(0, 1, review = false),
            carry(AndroidCarriedTimesPolicy.ALLOWED, run("A000001", 95_000)),
        )
        assertEquals(2, queue.size())
        val unreachable = carryAndroidCopiedRuns(listOf(run("A000003", 1)), club, null, online, { error("offline") }, queue, { emptyList() }, 1)
        assertEquals(AndroidCopiedCarryOutcome.Unreachable, unreachable)
    }

    @Test fun `the summary names what goes and what was skipped`() {
        assertEquals(
            "3 times will be sent to online.example when you are signed in there; 2 skipped because online.example already has a better time.",
            androidBestTimesSummary(AndroidProductLanguage.ENGLISH, "online.example", AndroidCopiedCarryOutcome.Queued(3, 0, false), 2),
        )
    }
}
