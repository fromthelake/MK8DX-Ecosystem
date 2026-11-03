package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualSubmissionContext
import nl.mariokart8.mk8dxtimetrials.manual.AndroidManualTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualLapV1
import nl.mariokart8.mk8dxtimetrials.manual.ManualLoadoutV1
import nl.mariokart8.mk8dxtimetrials.manual.createAndroidManualSubmission
import nl.mariokart8.mk8dxtimetrials.rules.TimeTrialRules
import nl.mariokart8.mk8dxtimetrials.rules.ValidatedPayload
import nl.mariokart8.mk8dxtimetrials.scan.AndroidScanTimeTrialSubmissionV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLapV1
import nl.mariokart8.mk8dxtimetrials.scan.ScanLoadoutV1

/**
 * The publish payloads of the canonical task.
 *
 * The **contract is not changed here**. A typed time still travels as
 * `android_manual` and a scanned one as `android_scan`, with exactly the
 * envelope, the evidence and the verification block the two producers have
 * always sent — ADR-0204 provenance is Phase 8 and no field is added
 * (POST_A_TIME §3). What the task replaced is the *validation* in front of
 * them: one canonical module now decides what may be published, and this file
 * only maps its validated payload into the preserved envelopes.
 */

/** The `android_manual` envelope, from the canonical validated payload. */
internal fun androidManualSubmissionFor(
    context: AndroidManualSubmissionContext,
    payload: ValidatedPayload,
): AndroidManualTimeTrialSubmissionV1 = createAndroidManualSubmission(
    context = context,
    mode = payload.mode,
    timeDigits = TimeTrialRules.timeMsToDigits(payload.totalTimeMs),
).copy(
    laps = payload.laps.map {
        ManualLapV1(it.lapNumber, it.timeMs.toLong(), it.coinsCollected, it.mushroomsUsed)
    },
    loadout = payload.loadout?.let {
        ManualLoadoutV1(it["characterId"], it["bodyId"], it["tireId"], it["gliderId"])
    },
)

/**
 * The `android_scan` envelope for a scan the Player has checked in the
 * canonical form: the producer's own identity, evidence and confidence stay,
 * and the fields the Player changed are named exactly as the retired review
 * screen named them, with the same `not_checked` /
 * `player_corrected_after_tt_scan` downgrade (ADR-0147, ADR-0167).
 */
internal fun androidScanSubmissionFor(
    initial: AndroidScanTimeTrialSubmissionV1,
    payload: ValidatedPayload,
): AndroidScanTimeTrialSubmissionV1 {
    val laps = payload.laps.map {
        ScanLapV1(it.lapNumber, it.timeMs.toLong(), it.coinsCollected, it.mushroomsUsed)
    }
    val loadout = payload.loadout?.let { parts ->
        ScanLoadoutV1(
            characterId = parts["characterId"],
            characterVariantId = initial.loadout?.characterVariantId
                ?.takeIf { parts["characterId"] != null && parts["characterId"] == initial.loadout?.characterId },
            bodyId = parts["bodyId"],
            bodyVariantId = initial.loadout?.bodyVariantId
                ?.takeIf { parts["bodyId"] != null && parts["bodyId"] == initial.loadout?.bodyId },
            tireId = parts["tireId"],
            gliderId = parts["gliderId"],
            gliderVariantId = initial.loadout?.gliderVariantId
                ?.takeIf { parts["gliderId"] != null && parts["gliderId"] == initial.loadout?.gliderId },
        )
    }
    val correctedFields = buildList {
        if (payload.trackId != initial.trackId) add("track")
        if (payload.mode != initial.mode) add("mode")
        if (payload.totalTimeMs.toLong() != initial.totalTimeMs) add("totalTime")
        if (laps.map(ScanLapV1::timeMs) != initial.laps.map(ScanLapV1::timeMs)) add("laps")
        if (laps.map(ScanLapV1::coinsCollected) != initial.laps.map(ScanLapV1::coinsCollected)) add("coins")
        if (laps.map(ScanLapV1::mushroomsUsed) != initial.laps.map(ScanLapV1::mushroomsUsed)) add("mushrooms")
        if (loadout?.characterId != initial.loadout?.characterId) add("character")
        if (loadout?.characterVariantId != initial.loadout?.characterVariantId) add("characterVariant")
        if (loadout?.bodyId != initial.loadout?.bodyId) add("body")
        if (loadout?.bodyVariantId != initial.loadout?.bodyVariantId) add("bodyVariant")
        if (loadout?.tireId != initial.loadout?.tireId) add("tire")
        if (loadout?.gliderId != initial.loadout?.gliderId) add("glider")
        if (loadout?.gliderVariantId != initial.loadout?.gliderVariantId) add("gliderVariant")
    }
    return initial.copy(
        trackId = payload.trackId,
        mode = payload.mode,
        totalTimeMs = payload.totalTimeMs.toLong(),
        laps = laps,
        loadout = loadout,
        verification = if (correctedFields.isEmpty()) {
            initial.verification
        } else {
            initial.verification.copy(
                status = "not_checked",
                method = "player_corrected_after_tt_scan",
                lapSumMatches = true,
                correctedFields = correctedFields,
            )
        },
    )
}

/** What a recognised result fills into the canonical form (POST_A_TIME §9). */
internal fun androidScanFillFor(submission: AndroidScanTimeTrialSubmissionV1): AndroidScanFill {
    val confidence = submission.verification.fieldConfidence
    val doubtful = buildList {
        val low = { score: Double? -> score != null && score < .75 }
        if (low(confidence?.character) || low(confidence?.characterVariant)) {
            add(androidLoadoutField("characterId"))
        }
        if (low(confidence?.body)) add(androidLoadoutField("bodyId"))
        if (low(confidence?.tire)) add(androidLoadoutField("tireId"))
        if (low(confidence?.glider)) add(androidLoadoutField("gliderId"))
    }
    return AndroidScanFill(
        totalDigits = TimeTrialRules.timeMsToDigits(submission.totalTimeMs.toInt()),
        laps = submission.laps.sortedBy { it.lapNumber }
            .map { TimeTrialRules.timeMsToDigits(it.timeMs.toInt()) },
        lapCoinBalances = submission.laps.sortedBy { it.lapNumber }.map { it.coinsCollected },
        lapMushrooms = submission.laps.sortedBy { it.lapNumber }.map { it.mushroomsUsed },
        loadout = mapOf(
            "characterId" to submission.loadout?.characterId,
            "bodyId" to submission.loadout?.bodyId,
            "tireId" to submission.loadout?.tireId,
            "gliderId" to submission.loadout?.gliderId,
        ),
        observedPlayerName = submission.observedPlayerName,
        source = "endscreen",
        sourceKind = submission.source.kind,
        doubt = doubtful,
    )
}
