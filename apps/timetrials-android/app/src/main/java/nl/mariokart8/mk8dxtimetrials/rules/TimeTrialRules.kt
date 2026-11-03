package nl.mariokart8.mk8dxtimetrials.rules

/**
 * Canonical Time Trial validation, Kotlin implementation of
 * packages/time-trial-rules/SPEC.md (rules version 1.0.0, submission contract
 * mk8dx.time-trial-submission.v1). The TypeScript implementation is
 * packages/time-trial-rules/src/index.ts; both are held to the same
 * conformance/cases.json by TimeTrialRulesConformanceTest.
 *
 * Pure Kotlin: no Android, no I/O. Not called by any screen yet (design-system
 * Phase 7 wires it into the canonical form). The evaluation order is normative.
 */
object TimeTrialRules {
    const val RULES_VERSION = "1.0.0"
    const val SUBMISSION_CONTRACT = "mk8dx.time-trial-submission.v1"
    const val MAX_TIME_MS = 599_999

    val RULE_IDS: List<String> = listOf(
        "track_required",
        "engine_required",
        "total_required",
        "total_format",
        "total_seconds_range",
        "total_range",
        "lap_details_require_lap_times",
        "lap_count_matches_track",
        "lap_missing",
        "lap_time_format",
        "lap_seconds_range",
        "lap_time_range",
        "lap_sum_equals_total",
        "coin_change_range",
        "coin_balance_range",
        "mushrooms_per_lap_range",
        "mushrooms_race_total",
        "loadout_id_format",
        "loadout_variant_requires_base",
    )

    val LOADOUT_KEYS: List<String> = listOf(
        "characterId",
        "characterVariantId",
        "bodyId",
        "bodyVariantId",
        "tireId",
        "gliderId",
        "gliderVariantId",
    )

    private const val ID_PART = "[a-z0-9]+(?:_[a-z0-9]+)*"
    private const val MESSAGE_KEY_PREFIX = "tt.rules."
    private val TRACK_PATTERN = Regex("^track\\.$ID_PART$")
    private val SIX_DIGITS = Regex("^[0-9]{6}$")
    private val LOADOUT_PATTERNS: Map<String, Regex> = mapOf(
        "characterId" to Regex("^character\\.$ID_PART$"),
        "characterVariantId" to Regex("^character_variant\\.$ID_PART\\.[0-9]{3}_$ID_PART$"),
        "bodyId" to Regex("^body\\.$ID_PART$"),
        "bodyVariantId" to Regex("^body_variant\\.$ID_PART\\.[0-9]{3}_$ID_PART$"),
        "tireId" to Regex("^tire\\.$ID_PART$"),
        "gliderId" to Regex("^glider\\.$ID_PART$"),
        "gliderVariantId" to Regex("^glider_variant\\.$ID_PART\\.[0-9]{3}_$ID_PART$"),
    )
    private val VARIANT_BASES: List<Pair<String, String>> = listOf(
        "characterVariantId" to "characterId",
        "bodyVariantId" to "bodyId",
        "gliderVariantId" to "gliderId",
    )

    sealed interface TimeCheck {
        data class Ok(val ms: Int) : TimeCheck
        data object Format : TimeCheck
        data class Seconds(val seconds: Int) : TimeCheck
        data object Range : TimeCheck
    }

    /** "145912" → 105912 ms. Exactly six ASCII digits M SS mmm. */
    fun checkTimeDigits(digits: String): TimeCheck {
        if (!SIX_DIGITS.matches(digits)) return TimeCheck.Format
        val minutes = digits.substring(0, 1).toInt()
        val seconds = digits.substring(1, 3).toInt()
        val milliseconds = digits.substring(3, 6).toInt()
        if (seconds > 59) return TimeCheck.Seconds(seconds)
        val ms = minutes * 60_000 + seconds * 1_000 + milliseconds
        if (ms < 1 || ms > MAX_TIME_MS) return TimeCheck.Range
        return TimeCheck.Ok(ms)
    }

    /** 35392 → "035392". */
    fun timeMsToDigits(ms: Int): String {
        val minutes = ms / 60_000
        val seconds = (ms % 60_000) / 1_000
        val milliseconds = ms % 1_000
        return "$minutes${seconds.toString().padStart(2, '0')}${milliseconds.toString().padStart(3, '0')}"
    }

    /** 35392 → "0:35.392". */
    fun formatTimeMs(ms: Int): String {
        val digits = timeMsToDigits(ms)
        return "${digits.substring(0, 1)}:${digits.substring(1, 3)}.${digits.substring(3, 6)}"
    }

    /**
     * The value the one missing lap would have, from the total. Only when exactly
     * one lap row is blank, every other lap and the total are valid times, and
     * the remainder is itself a valid time. Never auto-filled.
     */
    fun suggestMissingLap(totalDigits: String?, lapDigits: List<String?>): MissingLapSuggestion? {
        val total = checkTimeDigits(totalDigits.orEmpty()) as? TimeCheck.Ok ?: return null
        val blanks = lapDigits.indices.filter { lapDigits[it].orEmpty().isEmpty() }
        if (blanks.size != 1 || lapDigits.size < 2) return null
        var sum = 0
        for (value in lapDigits) {
            if (value.orEmpty().isEmpty()) continue
            val lap = checkTimeDigits(value.orEmpty()) as? TimeCheck.Ok ?: return null
            sum += lap.ms
        }
        val remainder = total.ms - sum
        if (remainder < 1 || remainder > MAX_TIME_MS) return null
        return MissingLapSuggestion(blanks[0] + 1, remainder, timeMsToDigits(remainder))
    }

    private fun error(
        field: String,
        rule: String,
        params: Map<String, Any> = emptyMap(),
        messageKey: String = MESSAGE_KEY_PREFIX + rule,
    ) = RuleError(field, rule, messageKey, params)

    fun validateDraft(draft: SubmissionDraft, context: ValidationContext): ValidationResult {
        val errors = mutableListOf<RuleError>()

        // 1. Track (context or TrackSelector; never the scanner).
        val trackId = draft.trackId.orEmpty()
        val trackOk = trackId.isNotEmpty() && trackId.length <= 255 && TRACK_PATTERN.matches(trackId)
        if (!trackOk) errors += error("trackId", "track_required")

        // 2. Engine (EngineContext; never the scanner).
        val engine = context.engine
        val engineOk = engine == 150 || engine == 200
        if (!engineOk) errors += error("mode", "engine_required")

        // 3. Total.
        val totalDigits = draft.totalDigits.orEmpty()
        var totalMs: Int? = null
        if (totalDigits.isEmpty()) {
            errors += error("totalDigits", "total_required")
        } else {
            when (val total = checkTimeDigits(totalDigits)) {
                is TimeCheck.Ok -> totalMs = total.ms
                TimeCheck.Format -> errors += error("totalDigits", "total_format")
                is TimeCheck.Seconds -> errors += error("totalDigits", "total_seconds_range", mapOf("seconds" to total.seconds))
                TimeCheck.Range -> errors += error("totalDigits", "total_range")
            }
        }

        // 4. Laps, coins, mushrooms.
        val rows = draft.laps
        val anyTimes = rows.any { it.timeDigits.orEmpty().isNotEmpty() }
        val anyCoins = rows.any { it.coinChange != null }
        val anyDetails = anyCoins || rows.any { it.mushroomsUsed != null }
        val lapTimes = mutableListOf<Int>()
        val balances = mutableListOf<Int>()
        if (!anyTimes) {
            if (anyDetails) errors += error("laps", "lap_details_require_lap_times")
        } else if (rows.size != context.trackLapCount) {
            errors += error(
                "laps",
                "lap_count_matches_track",
                mapOf("expected" to context.trackLapCount, "actual" to rows.size),
            )
        } else {
            // 4a. Lap times, in lap order.
            var lapTimesOk = true
            val suggestion = suggestMissingLap(totalDigits, rows.map { it.timeDigits })
            rows.forEachIndexed { index, row ->
                val lap = index + 1
                val field = "laps[$index].timeDigits"
                val digits = row.timeDigits.orEmpty()
                if (digits.isEmpty()) {
                    lapTimesOk = false
                    errors += if (suggestion != null && suggestion.lap == lap) {
                        error(
                            field,
                            "lap_missing",
                            mapOf(
                                "lap" to lap,
                                "suggestionMs" to suggestion.timeMs,
                                "suggestionDigits" to suggestion.digits,
                            ),
                            "${MESSAGE_KEY_PREFIX}lap_missing_suggested",
                        )
                    } else {
                        error(field, "lap_missing", mapOf("lap" to lap))
                    }
                    return@forEachIndexed
                }
                when (val check = checkTimeDigits(digits)) {
                    is TimeCheck.Ok -> lapTimes += check.ms
                    TimeCheck.Format -> {
                        lapTimesOk = false
                        errors += error(field, "lap_time_format", mapOf("lap" to lap))
                    }
                    is TimeCheck.Seconds -> {
                        lapTimesOk = false
                        errors += error(field, "lap_seconds_range", mapOf("lap" to lap, "seconds" to check.seconds))
                    }
                    TimeCheck.Range -> {
                        lapTimesOk = false
                        errors += error(field, "lap_time_range", mapOf("lap" to lap))
                    }
                }
            }
            // 4b. Lap sum (only when the total and every lap are valid times).
            val total = totalMs
            if (lapTimesOk && total != null) {
                val lapSumMs = lapTimes.sum()
                if (lapSumMs != total) {
                    errors += error("laps", "lap_sum_equals_total", mapOf("lapSumMs" to lapSumMs, "totalMs" to total))
                }
            }
            // 4c. Coins: signed change per lap; balance after every lap.
            if (anyCoins) {
                var changesOk = true
                rows.forEachIndexed { index, row ->
                    val change = row.coinChange
                    if (change != null && change !in -10..10) {
                        changesOk = false
                        errors += error(
                            "laps[$index].coinChange",
                            "coin_change_range",
                            mapOf("lap" to index + 1, "change" to change),
                        )
                    }
                }
                if (changesOk) {
                    var balance = 0
                    for (index in rows.indices) {
                        balance += rows[index].coinChange ?: 0
                        if (balance < 0 || balance > 10) {
                            val key = if (balance < 0) "coin_balance_below_zero" else "coin_balance_above_ten"
                            errors += error(
                                "laps[$index].coinChange",
                                "coin_balance_range",
                                mapOf("lap" to index + 1, "balance" to balance),
                                MESSAGE_KEY_PREFIX + key,
                            )
                            break
                        }
                        balances += balance
                    }
                }
            }
            // 4d. Mushrooms: 0–3 per lap, at most 3 per race.
            var mushroomsOk = true
            var mushroomTotal = 0
            rows.forEachIndexed { index, row ->
                val used = row.mushroomsUsed ?: return@forEachIndexed
                if (used !in 0..3) {
                    mushroomsOk = false
                    errors += error("laps[$index].mushroomsUsed", "mushrooms_per_lap_range", mapOf("lap" to index + 1))
                    return@forEachIndexed
                }
                mushroomTotal += used
            }
            if (mushroomsOk && mushroomTotal > 3) {
                errors += error("laps", "mushrooms_race_total", mapOf("total" to mushroomTotal))
            }
        }

        // 5. Loadout (catalogue ids; a variant needs its base part).
        val loadout = linkedMapOf<String, String>()
        for (key in LOADOUT_KEYS) {
            val value = draft.loadout[key].orEmpty()
            if (value.isEmpty()) continue
            if (value.length > 255 || !LOADOUT_PATTERNS.getValue(key).matches(value)) {
                errors += error("loadout.$key", "loadout_id_format", mapOf("part" to key))
                continue
            }
            loadout[key] = value
        }
        for ((variant, base) in VARIANT_BASES) {
            if (draft.loadout[variant].orEmpty().isNotEmpty() && draft.loadout[base].orEmpty().isEmpty()) {
                errors += error("loadout.$variant", "loadout_variant_requires_base", mapOf("part" to variant))
            }
        }

        if (errors.isNotEmpty()) return ValidationResult(false, errors, null)

        // Normalised payload (SPEC.md "Normalisation").
        val laps = if (anyTimes) {
            rows.mapIndexed { index, row ->
                PayloadLap(
                    lapNumber = index + 1,
                    timeMs = lapTimes[index],
                    coinsCollected = if (anyCoins) balances[index] else null,
                    mushroomsUsed = row.mushroomsUsed,
                )
            }
        } else {
            emptyList()
        }
        return ValidationResult(
            valid = true,
            errors = emptyList(),
            payload = ValidatedPayload(
                mode = engine!!,
                trackId = trackId,
                totalTimeMs = totalMs!!,
                laps = laps,
                loadout = loadout.takeIf { it.isNotEmpty() },
            ),
        )
    }
}

data class LapDraft(
    val timeDigits: String? = null,
    val coinChange: Int? = null,
    val mushroomsUsed: Int? = null,
)

/** The validation-relevant part of SubmissionDraft (POST_A_TIME §3). Loadout keys: [TimeTrialRules.LOADOUT_KEYS]. */
data class SubmissionDraft(
    val trackId: String? = null,
    val totalDigits: String? = null,
    val laps: List<LapDraft> = emptyList(),
    val loadout: Map<String, String?> = emptyMap(),
    /** UI hints; validation ignores them (the same rules for typed and scanned values). */
    val origin: Map<String, String> = emptyMap(),
    val corrected: List<String> = emptyList(),
)

data class ValidationContext(
    val engine: Int?,
    val trackLapCount: Int,
    val connectivity: String? = null,
)

/** params values are Int or String. */
data class RuleError(
    val field: String,
    val rule: String,
    val messageKey: String,
    val params: Map<String, Any>,
)

data class PayloadLap(
    val lapNumber: Int,
    val timeMs: Int,
    val coinsCollected: Int? = null,
    val mushroomsUsed: Int? = null,
)

/** The validation subset of TimeTrialSubmissionV1; the envelope is added by the publisher. */
data class ValidatedPayload(
    val mode: Int,
    val trackId: String,
    val totalTimeMs: Int,
    val laps: List<PayloadLap>,
    val loadout: Map<String, String>? = null,
)

data class ValidationResult(
    val valid: Boolean,
    val errors: List<RuleError>,
    val payload: ValidatedPayload?,
)

data class MissingLapSuggestion(
    val lap: Int,
    val timeMs: Int,
    val digits: String,
)
