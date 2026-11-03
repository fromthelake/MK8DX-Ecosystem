package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.ManualLapV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLapV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLoadoutV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanPlayerReferenceV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanSourceV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanTimestampsV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanVerificationV1
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The publish payloads. The canonical task replaced the validation in front of
 * the two producers, not the producers: a typed time still travels as the
 * `android_manual` envelope the outbox has always stored, and a scan as the
 * `android_scan` one with its evidence, its confidence and the same corrected
 * field names the retired review screen produced. ADR-0204 provenance stays on
 * that producer envelope even when the Player corrects a recognised value.
 */
class AndroidPostTimeSubmissionTest {
    private val manualContext = AndroidManualSubmissionContext(
        submissionId = "user_submission.time.POSTTIMEPAYLOAD01",
        revision = 1,
        trackId = "track.mario_kart_stadium",
        playerReference = ManualPlayerReferenceV1("player", "player.ben"),
        createdAtMs = 1_800_000_001_000,
        producerVersion = "timetrials-android-v1",
    )

    private val recognised = AndroidScanTimeTrialSubmissionV1(
        submissionId = "user_submission.time.ANDROIDSCANREVIEW1",
        revision = 1,
        mode = 150,
        trackId = "track.mario_kart_stadium",
        totalTimeMs = 90_000,
        laps = listOf(ScanLapV1(1, 30_000), ScanLapV1(2, 29_500), ScanLapV1(3, 30_500)),
        playerReference = ScanPlayerReferenceV1("producer_local_profile", "local-review"),
        source = ScanSourceV1(producerVersion = "review-test"),
        timestamps = ScanTimestampsV1(1_800_000_000_000, 1_800_000_001_000),
        verification = ScanVerificationV1(),
    )

    private fun draft(lapCount: Int = 3) =
        createAndroidPostTimeDraft("track.mario_kart_stadium", 150, lapCount)

    // ---- android_manual

    @Test
    fun `a typed time produces the manual envelope the outbox has always stored`() {
        val valid = androidValidatePostTime(
            draft()
                .withTotalDigits("130000")
                .withLapDigits(0, "030000").withLapDigits(1, "029500").withLapDigits(2, "030500")
                .withLapCoinChange(0, 4).withLapCoinChange(1, -1).withLapCoinChange(2, 0)
                .withLapMushrooms(0, 1).withLapMushrooms(2, 2)
                .withLoadoutPart("characterId", "character.mario")
                .withLoadoutPart("tireId", "tire.roller"),
        ).payload!!
        val submission = androidManualSubmissionFor(manualContext, valid)
        assertEquals("android_manual", submission.source.kind)
        assertEquals(150, submission.mode)
        assertEquals("track.mario_kart_stadium", submission.trackId)
        assertEquals(90_000L, submission.totalTimeMs)
        assertEquals(
            listOf(
                ManualLapV1(1, 30_000, 4, 1),
                ManualLapV1(2, 29_500, 3, null),
                ManualLapV1(3, 30_500, 3, 2),
            ),
            submission.laps,
        )
        assertEquals("character.mario", submission.loadout?.characterId)
        assertEquals("tire.roller", submission.loadout?.tireId)
        assertNull(submission.loadout?.bodyId)
        assertEquals(ManualPlayerReferenceV1("player", "player.ben"), submission.playerReference)
    }

    @Test
    fun `a total-only time carries no laps and no loadout`() {
        val valid = androidValidatePostTime(draft().withTotalDigits("150000")).payload!!
        val submission = androidManualSubmissionFor(manualContext, valid)
        assertEquals(emptyList<ManualLapV1>(), submission.laps)
        assertNull(submission.loadout)
    }

    // ---- android_scan

    @Test
    fun `an unchanged scan keeps the producer's own verification and every field`() {
        val filled = androidApplyScan(
            draft(),
            androidScanFillFor(recognised),
        ).draft
        val valid = androidValidatePostTime(filled).payload!!
        val submission = androidScanSubmissionFor(recognised, valid)
        assertEquals(recognised, submission)
        assertEquals("producer_check_passed", submission.verification.status)
    }

    @Test
    fun `a correction keeps the identity and names the same fields the review named`() {
        val recognisedGhost = recognised.copy(
            source = recognised.source.copy(captureLayout = "ghost_details"),
        )
        val filled = androidApplyScan(draft(), androidScanFillFor(recognisedGhost)).draft
            .withMode(200)
            .withLapMushrooms(0, 1)
            .withLoadoutPart("characterId", "character.luigi")
        val valid = androidValidatePostTime(filled).payload!!
        val submission = androidScanSubmissionFor(recognisedGhost, valid)
        assertEquals(200, submission.mode)
        assertEquals(recognisedGhost.playerReference, submission.playerReference)
        assertEquals(recognisedGhost.timestamps, submission.timestamps)
        assertEquals("ghost_details", submission.source.captureLayout)
        assertEquals("not_checked", submission.verification.status)
        assertEquals("player_corrected_after_tt_scan", submission.verification.method)
        assertEquals(
            listOf("mode", "mushrooms", "character"),
            submission.verification.correctedFields,
        )
    }

    @Test
    fun `a recognised colour variant survives while its base part is untouched`() {
        val withVariant = recognised.copy(
            loadout = ScanLoadoutV1(
                characterId = "character.yoshi",
                characterVariantId = "character_variant.yoshi.023_pink",
                tireId = "tire.roller",
            ),
        )
        val kept = androidScanSubmissionFor(
            withVariant,
            androidValidatePostTime(
                androidApplyScan(draft(), androidScanFillFor(withVariant)).draft,
            ).payload!!,
        )
        assertEquals("character_variant.yoshi.023_pink", kept.loadout?.characterVariantId)
        val changed = androidScanSubmissionFor(
            withVariant,
            androidValidatePostTime(
                androidApplyScan(draft(), androidScanFillFor(withVariant)).draft
                    .withLoadoutPart("characterId", "character.luigi"),
            ).payload!!,
        )
        assertNull(changed.loadout?.characterVariantId)
        assertEquals("character.luigi", changed.loadout?.characterId)
        assertEquals(listOf("character", "characterVariant"), changed.verification.correctedFields)
    }

    @Test
    fun `the canonical rules refuse what the scan review used to refuse`() {
        val broken = androidApplyScan(draft(), androidScanFillFor(recognised)).draft
            .withLapDigits(2, "030499")
        assertNull(androidValidatePostTime(broken).payload)
        val mushrooms = androidApplyScan(draft(), androidScanFillFor(recognised)).draft
            .withLapMushrooms(0, 2).withLapMushrooms(1, 1).withLapMushrooms(2, 1)
        assertNull(androidValidatePostTime(mushrooms).payload)
    }

    @Test
    fun `a test scan stays a test scan all the way to the outbox`() {
        val test = recognised.copy(source = ScanSourceV1(kind = "android_scan_test", producerVersion = "review-test"))
        val fill = androidScanFillFor(test)
        assertEquals("android_scan_test", fill.sourceKind)
        val submission = androidScanSubmissionFor(
            test,
            androidValidatePostTime(androidApplyScan(draft(), fill).draft).payload!!,
        )
        assertEquals("android_scan_test", submission.source.kind)
    }
}
