package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The canonical draft on Android: the behaviours the retired manual entry and
 * scan review owned, now decided in one model and validated by one module.
 *
 * Each D-decision of `packages/time-trial-rules/SPEC.md` §7 that this phase
 * resolves has a case here, so "today's accepted behaviour is preserved" is a
 * test rather than a claim.
 */
class AndroidPostTimeDraftTest {
    private val stadium = "track.mario_kart_stadium"

    private fun draft(lapCount: Int = 3): AndroidPostTimeDraft =
        createAndroidPostTimeDraft(stadium, 150, lapCount)

    // ---- D1: the lap rows are the track's own count

    @Test
    fun `the form holds exactly the track's lap rows`() {
        assertEquals(3, draft().laps.size)
        assertEquals(7, createAndroidPostTimeDraft("track.gcn_baby_park", 150, 7).laps.size)
    }

    // ---- D5: the typed digit mask still clamps, a scanned value never does

    @Test
    fun `a typed tens-of-seconds digit above five is clamped exactly as before`() {
        assertEquals("158000", draft().withTotalDigits("178000").totalDigits)
        assertEquals("145912", draft().withTotalDigits("1a45912x").totalDigits)
    }

    @Test
    fun `a scanned misread is reported, never silently changed`() {
        val filled = androidApplyScan(draft(), AndroidScanFill(totalDigits = "178000")).draft
        assertEquals("178000", filled.totalDigits)
        val result = androidValidatePostTime(filled)
        assertFalse(result.valid)
        assertEquals("total_seconds_range", result.errors.first().rule)
        assertEquals(
            "Check the total time — seconds go up to 59.",
            AndroidPostTimeMessages.text(result.errors.first(), AndroidProductLanguage.ENGLISH),
        )
    }

    // ---- D2 / D3: coins are a signed change, stored as the running balance, all laps or none

    @Test
    fun `coins are entered as a change and stored as the running balance on every lap`() {
        val filled = draft()
            .withTotalDigits("130000")
            .withLapDigits(0, "030000").withLapDigits(1, "029500").withLapDigits(2, "030500")
            .withLapCoinChange(0, 4).withLapCoinChange(1, -1).withLapCoinChange(2, 0)
        assertEquals(listOf(4, 3, 3), filled.coinBalances())
        val payload = androidValidatePostTime(filled).payload
        assertEquals(listOf(4, 3, 3), payload?.laps?.map { it.coinsCollected })
    }

    @Test
    fun `no coin entered means no lap carries a balance`() {
        val filled = draft()
            .withTotalDigits("130000")
            .withLapDigits(0, "030000").withLapDigits(1, "029500").withLapDigits(2, "030500")
        assertEquals(listOf(null, null, null), androidValidatePostTime(filled).payload?.laps?.map { it.coinsCollected })
    }

    @Test
    fun `a balance below zero is refused with the lap that would end there`() {
        val filled = draft()
            .withTotalDigits("130000")
            .withLapDigits(0, "030000").withLapDigits(1, "029500").withLapDigits(2, "030500")
            .withLapCoinChange(0, -1)
        val result = androidValidatePostTime(filled)
        assertFalse(result.valid)
        assertEquals("coin_balance_range", result.errors.first().rule)
        assertEquals(
            "Coins can't go below 0 — lap 1 would end at −1.",
            AndroidPostTimeMessages.text(result.errors.first(), AndroidProductLanguage.ENGLISH),
        )
    }

    // ---- D4: a lone sign cannot be typed at all — coins are a stepper

    @Test
    fun `a coin change is an integer or nothing, never a lone sign`() {
        val cleared = draft().withLapCoinChange(0, 4).withLapCoinChange(0, null)
        assertNull(cleared.laps[0].coinChange)
    }

    // ---- mushrooms: 0..3 per lap, at most 3 in the race

    @Test
    fun `four mushrooms in a race are refused`() {
        val filled = draft()
            .withTotalDigits("130000")
            .withLapDigits(0, "030000").withLapDigits(1, "029500").withLapDigits(2, "030500")
            .withLapMushrooms(0, 2).withLapMushrooms(1, 1).withLapMushrooms(2, 1)
        val result = androidValidatePostTime(filled)
        assertEquals("mushrooms_race_total", result.errors.first().rule)
        assertEquals(
            "Only 3 mushrooms in a race — you entered 4.",
            AndroidPostTimeMessages.text(result.errors.first(), AndroidProductLanguage.ENGLISH),
        )
    }

    @Test
    fun `coins and mushrooms need the lap times, as they always did`() {
        val filled = draft().withTotalDigits("130000").withLapMushrooms(0, 1)
        assertEquals("lap_details_require_lap_times", androidValidatePostTime(filled).errors.first().rule)
    }

    // ---- D6: total only is valid, on every path

    @Test
    fun `a total on its own publishes with no laps at all`() {
        val result = androidValidatePostTime(draft().withTotalDigits("145912"))
        assertTrue(result.valid)
        assertEquals(105_912, result.payload?.totalTimeMs)
        assertEquals(emptyList<Int>(), result.payload?.laps?.map { it.lapNumber })
    }

    @Test
    fun `laps that do not add up name both numbers`() {
        val filled = draft()
            .withTotalDigits("145912")
            .withLapDigits(0, "035392").withLapDigits(1, "035260").withLapDigits(2, "035000")
        val error = androidValidatePostTime(filled).errors.first()
        assertEquals("lap_sum_equals_total", error.rule)
        assertEquals(
            "Your laps add up to 1:45.652, the total is 1:45.912.",
            AndroidPostTimeMessages.text(error, AndroidProductLanguage.ENGLISH),
        )
    }

    // ---- D7: loadout parts come from the catalogue picker

    @Test
    fun `a loadout part is carried into the payload and an unknown id is refused`() {
        val chosen = draft().withTotalDigits("145912").withLoadoutPart("characterId", "character.mario")
        assertEquals("character.mario", androidValidatePostTime(chosen).payload?.loadout?.get("characterId"))
        val broken = draft().withTotalDigits("145912").withLoadoutPart("characterId", "Mario")
        assertEquals("loadout_id_format", androidValidatePostTime(broken).errors.first().rule)
    }

    // ---- the scan fills the same form and never overwrites a typed value

    @Test
    fun `a scan fills empty fields, marks them and leaves a typed value alone`() {
        val typed = draft().withTotalDigits("145912")
        val application = androidApplyScan(
            typed,
            AndroidScanFill(
                totalDigits = "144000",
                laps = listOf("035392", "035260", "035260"),
                loadout = mapOf("characterId" to "character.mario"),
            ),
        )
        assertEquals("145912", application.draft.totalDigits)
        assertEquals(listOf(ANDROID_POST_TIME_TOTAL_FIELD), application.conflicts)
        assertEquals("035392", application.draft.laps[0].timeDigits)
        assertEquals(AndroidFieldOrigin.SCANNED, application.draft.origin[androidLapTimeField(0)])
        assertEquals(AndroidFieldOrigin.SCANNED, application.draft.origin[androidLoadoutField("characterId")])
        assertTrue(application.draft.hasScannedValue())
        assertEquals(listOf("bodyId", "tireId", "gliderId"), application.unreadLoadoutKeys)
    }

    @Test
    fun `a scan that misses the character reports the blank setup field`() {
        val application = androidApplyScan(
            draft(),
            AndroidScanFill(
                totalDigits = "145912",
                loadout = mapOf(
                    "characterId" to null,
                    "bodyId" to "body.mr_scooty",
                    "tireId" to "tire.roller",
                    "gliderId" to "glider.super_glider",
                ),
            ),
        )
        assertEquals(listOf("characterId"), application.unreadLoadoutKeys)
    }

    @Test
    fun `editing a scanned value makes it the Player's own again`() {
        val scanned = androidApplyScan(draft(), AndroidScanFill(laps = listOf("035392", "035260", "035260"))).draft
        val edited = scanned.withLapDigits(0, "035400")
        assertNull(edited.origin[androidLapTimeField(0)])
        assertEquals(AndroidFieldOrigin.SCANNED, edited.origin[androidLapTimeField(1)])
    }

    @Test
    fun `clearing one lap removes all three values and only that laps scan marks`() {
        val scanned = androidApplyScan(
            draft(),
            AndroidScanFill(laps = listOf("030000", "029500", "030500")),
        ).draft.withLapCoinChange(0, 4).withLapMushrooms(0, 2)
        val cleared = scanned.withClearedLap(0)

        assertEquals(AndroidPostTimeLap(), cleared.laps[0])
        assertEquals("029500", cleared.laps[1].timeDigits)
        assertNull(cleared.origin[androidLapTimeField(0)])
        assertEquals(AndroidFieldOrigin.SCANNED, cleared.origin[androidLapTimeField(1)])
    }

    @Test
    fun `a result from a track with another lap count keeps its laps out of this form`() {
        // Found on the device: a 7-lap result scanned on a 3-lap track filled
        // three laps that could never add up to its own total.
        val application = androidApplyScan(
            draft(),
            AndroidScanFill(
                totalDigits = "114723",
                laps = listOf("012068", "012154", "011300", "011200", "011100", "011000", "010900"),
            ),
        )
        assertEquals(7, application.producerLapCount)
        assertEquals(listOf("", "", ""), application.draft.laps.map { it.timeDigits })
        assertEquals("114723", application.draft.totalDigits)
        assertTrue(androidValidatePostTime(application.draft).valid)
    }

    @Test
    fun `a producer's coin balances arrive as the changes the form enters`() {
        val scanned = androidApplyScan(
            draft(),
            AndroidScanFill(
                laps = listOf("030000", "029500", "030500"),
                lapCoinBalances = listOf(4, 3, 10),
            ),
        ).draft
        assertEquals(listOf(4, -1, 7), scanned.laps.map { it.coinChange })
        assertEquals(listOf(4, 3, 10), scanned.coinBalances())
    }

    @Test
    fun `a doubtful field is only flagged while the scan owns it`() {
        val scanned = androidApplyScan(
            draft(),
            AndroidScanFill(
                loadout = mapOf("characterId" to "character.mario"),
                doubt = listOf(androidLoadoutField("characterId"), androidLoadoutField("tireId")),
            ),
        ).draft
        assertEquals(listOf(androidLoadoutField("characterId")), scanned.doubt)
        assertTrue(scanned.withLoadoutPart("characterId", "character.luigi").doubt.isEmpty())
    }

    // ---- a mode switch keeps the values and the draft key

    @Test
    fun `switching engine keeps what was typed`() {
        val typed = draft().withTotalDigits("145912").withMode(200)
        assertEquals(200, typed.mode)
        assertEquals("145912", typed.totalDigits)
    }

    // ---- drafts (POST_A_TIME §8)

    private class MemoryStorage : AndroidPostTimeDraftStorage {
        var value: String? = null
        override fun read(): String? = value
        override fun write(value: String) { this.value = value }
        override fun clear() { value = null }
    }

    @Test
    fun `a draft is kept per player, track and mode and restored for exactly that one`() {
        val storage = MemoryStorage()
        val typed = draft().withTotalDigits("142500").withLapCoinChange(0, 4)
        androidSaveDraft(storage, "player.ben", typed, 1_800_000_000_000)
        assertEquals("142500", androidLoadDraft(storage, "player.ben", stadium, 150, 3)?.totalDigits)
        assertNull(androidLoadDraft(storage, "player.ben", stadium, 200, 3))
        assertNull(androidLoadDraft(storage, "player.floyd", stadium, 150, 3))
        assertNull(androidLoadDraft(storage, "player.ben", "track.water_park", 150, 3))
    }

    @Test
    fun `an empty draft is not kept, and a publication clears it`() {
        val storage = MemoryStorage()
        androidSaveDraft(storage, "player.ben", draft().withTotalDigits("142500"), 1L)
        androidSaveDraft(storage, "player.ben", draft(), 2L)
        assertNull(storage.value)
        androidSaveDraft(storage, "player.ben", draft().withTotalDigits("142500"), 3L)
        androidClearDraft(storage)
        assertNull(storage.value)
    }

    @Test
    fun `a restored draft keeps the scan marks but not the scan session`() {
        val storage = MemoryStorage()
        val scanned = androidApplyScan(draft(), AndroidScanFill(totalDigits = "142500")).draft
        androidSaveDraft(storage, "player.ben", scanned, 1L)
        val restored = androidLoadDraft(storage, "player.ben", stadium, 150, 3)
        assertEquals(AndroidFieldOrigin.SCANNED, restored?.origin?.get(ANDROID_POST_TIME_TOTAL_FIELD))
        assertNull(restored?.scan)
    }

    // ---- Publish is never silently disabled

    @Test
    fun `the publish reason is the first outstanding rule, in the Player's words`() {
        assertEquals(
            "Enter a total time first.",
            androidPublishBlockedReason(
                androidValidatePostTime(draft()).errors, AndroidProductLanguage.ENGLISH,
            ),
        )
        val laps = draft()
            .withTotalDigits("145912")
            .withLapDigits(0, "035392").withLapDigits(1, "035260").withLapDigits(2, "035000")
        assertEquals(
            "Your laps add up to 1:45.652, the total is 1:45.912.",
            androidPublishBlockedReason(androidValidatePostTime(laps).errors, AndroidProductLanguage.ENGLISH),
        )
        assertEquals(
            "Vul eerst een totaaltijd in.",
            androidPublishBlockedReason(
                androidValidatePostTime(draft()).errors, AndroidProductLanguage.DUTCH,
            ),
        )
    }
}
