package nl.mariokart8.mk8dxtimetrials.posttime

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import nl.mariokart8.mk8dxtimetrials.rules.LapDraft
import nl.mariokart8.mk8dxtimetrials.rules.RuleError
import nl.mariokart8.mk8dxtimetrials.rules.SubmissionDraft
import nl.mariokart8.mk8dxtimetrials.rules.TimeTrialRules
import nl.mariokart8.mk8dxtimetrials.rules.ValidationContext
import nl.mariokart8.mk8dxtimetrials.rules.ValidationResult

/**
 * The one submission model behind the canonical Post-a-Time task on Android
 * (docs/design-system/POST_A_TIME_ARCHITECTURE.md §3, §7, §8), the Kotlin twin
 * of the web's `post-time-model.ts`.
 *
 * Pure Kotlin: no Android, no I/O, no clock beyond what the caller passes in.
 * Validation is **not** re-implemented here — it is the canonical
 * `nl.mariokart8.mk8dxtimetrials.rules.TimeTrialRules`, held to the shared
 * `packages/time-trial-rules/conformance/cases.json` by its own runner. There
 * is exactly one validator on this path.
 */
enum class AndroidFieldOrigin { TYPED, SCANNED }

const val ANDROID_POST_TIME_TOTAL_FIELD = "totalDigits"

fun androidLapTimeField(index: Int): String = "laps[$index].timeDigits"

fun androidLapCoinField(index: Int): String = "laps[$index].coinChange"

fun androidLapMushroomField(index: Int): String = "laps[$index].mushroomsUsed"

fun androidLoadoutField(key: String): String = "loadout.$key"

/** The four parts the canonical picker offers; variants stay out (SPEC §7 D8). */
val ANDROID_LOADOUT_PART_KEYS: List<String> = listOf("characterId", "bodyId", "tireId", "gliderId")

@Serializable
data class AndroidPostTimeLap(
    val timeDigits: String = "",
    /** The signed coin change during the lap; null = not entered (POST_A_TIME §3, D2). */
    val coinChange: Int? = null,
    val mushroomsUsed: Int? = null,
)

@Serializable
data class AndroidPostTimeScan(
    val source: String = "endscreen",
    val observedPlayerName: String? = null,
    /** "android_scan" or "android_scan_test": a test scan never counts. */
    val sourceKind: String = "android_scan",
)

@Serializable
data class AndroidPostTimeDraft(
    val trackId: String? = null,
    val mode: Int = 150,
    val totalDigits: String = "",
    val laps: List<AndroidPostTimeLap> = emptyList(),
    val loadout: Map<String, String?> = emptyMap(),
    /** field path → origin. A field leaves the map the moment it is edited. */
    val origin: Map<String, AndroidFieldOrigin> = emptyMap(),
    /** Field paths the producer was unsure about; cleared on any user choice. */
    val doubt: List<String> = emptyList(),
    val scan: AndroidPostTimeScan? = null,
) {
    val trackLapCount: Int get() = laps.size
}

fun createAndroidPostTimeDraft(trackId: String?, mode: Int, lapCount: Int): AndroidPostTimeDraft =
    AndroidPostTimeDraft(
        trackId = trackId,
        mode = if (mode == 200) 200 else 150,
        totalDigits = "",
        laps = List(lapCount) { AndroidPostTimeLap() },
        loadout = ANDROID_LOADOUT_PART_KEYS.associateWith { null },
        origin = emptyMap(),
        doubt = emptyList(),
        scan = null,
    )

/**
 * The digit mask the Android manual form has always applied to typed input: a
 * tens-of-seconds digit above 5 is clamped as it is typed, so 178000 becomes
 * 158000 rather than being refused (SPEC §7 D5, `sanitizeManualDigits`).
 * Preserved deliberately. **Scanned** values are not masked: there the rule
 * fires and the misread is shown instead of silently changed.
 */
fun androidMaskTypedDigits(rawValue: String): String {
    val clean = rawValue.filter { it in '0'..'9' }.take(6)
    if (clean.length < 2 || clean[1] <= '5') return clean
    return clean.substring(0, 1) + "5" + clean.substring(2)
}

fun androidScanDigits(rawValue: String): String = rawValue.filter { it in '0'..'9' }.take(6)

/** "145912" → "1:45.912"; an incomplete value keeps its blanks. */
fun androidFormatDraftDigits(digits: String): String {
    val padded = digits.padEnd(6, '_').take(6)
    return "${padded[0]}:${padded.substring(1, 3)}.${padded.substring(3, 6)}"
}

private fun AndroidPostTimeDraft.edited(field: String): AndroidPostTimeDraft = copy(
    // EDITED (POST_A_TIME §7): the value becomes typed, its mark disappears and
    // its doubt clears.
    origin = origin - field,
    doubt = doubt.filterNot { it == field },
)

fun AndroidPostTimeDraft.withTotalDigits(rawValue: String): AndroidPostTimeDraft =
    copy(totalDigits = androidMaskTypedDigits(rawValue)).edited(ANDROID_POST_TIME_TOTAL_FIELD)

private fun AndroidPostTimeDraft.replaceLap(
    index: Int,
    change: (AndroidPostTimeLap) -> AndroidPostTimeLap,
): AndroidPostTimeDraft =
    copy(laps = laps.mapIndexed { at, lap -> if (at == index) change(lap) else lap })

fun AndroidPostTimeDraft.withLapDigits(index: Int, rawValue: String): AndroidPostTimeDraft =
    replaceLap(index) { it.copy(timeDigits = androidMaskTypedDigits(rawValue)) }
        .edited(androidLapTimeField(index))

fun AndroidPostTimeDraft.withLapCoinChange(index: Int, change: Int?): AndroidPostTimeDraft =
    replaceLap(index) { it.copy(coinChange = change) }.edited(androidLapCoinField(index))

fun AndroidPostTimeDraft.withLapMushrooms(index: Int, used: Int?): AndroidPostTimeDraft =
    replaceLap(index) { it.copy(mushroomsUsed = used) }.edited(androidLapMushroomField(index))

/** Clears one complete lap row, including all scan ownership and doubt marks. */
fun AndroidPostTimeDraft.withClearedLap(index: Int): AndroidPostTimeDraft {
    val prefix = "laps[$index]."
    return replaceLap(index) { AndroidPostTimeLap() }.copy(
        origin = origin.filterKeys { !it.startsWith(prefix) },
        doubt = doubt.filterNot { it.startsWith(prefix) },
    )
}

fun AndroidPostTimeDraft.withLoadoutPart(key: String, value: String?): AndroidPostTimeDraft =
    copy(loadout = loadout + (key to value)).edited(androidLoadoutField(key))

/** Clears every lap row's time, coins and mushrooms — the "or clear all laps" half of the rule. */
fun AndroidPostTimeDraft.withClearedLaps(): AndroidPostTimeDraft = copy(
    laps = laps.map { AndroidPostTimeLap() },
    origin = origin.filterKeys { !it.startsWith("laps[") },
    doubt = doubt.filterNot { it.startsWith("laps[") },
)

/**
 * A mode switch discards and recomputes everything derived from the engine
 * (ENGINE_CONTEXT_INVENTORY §4): the prediction and the armed state. The values
 * the Player typed are theirs and stay.
 */
fun AndroidPostTimeDraft.withMode(mode: Int): AndroidPostTimeDraft =
    if (this.mode == mode) this else copy(mode = if (mode == 200) 200 else 150)

fun AndroidPostTimeDraft.hasMeaningfulData(): Boolean =
    totalDigits.isNotEmpty() ||
        laps.any { it.timeDigits.isNotEmpty() || it.coinChange != null || it.mushroomsUsed != null } ||
        ANDROID_LOADOUT_PART_KEYS.any { loadout[it] != null }

/** The running coin balance after each lap, for the "+4 · balance 4" reading (POST_A_TIME §3). */
fun AndroidPostTimeDraft.coinBalances(): List<Int> {
    var balance = 0
    return laps.map { lap ->
        balance += lap.coinChange ?: 0
        balance
    }
}

// ---------------------------------------------------------------- validation (one module)

fun androidValidatePostTime(draft: AndroidPostTimeDraft): ValidationResult = TimeTrialRules.validateDraft(
    SubmissionDraft(
        trackId = draft.trackId,
        totalDigits = draft.totalDigits,
        laps = draft.laps.map {
            LapDraft(
                timeDigits = it.timeDigits,
                coinChange = it.coinChange,
                mushroomsUsed = it.mushroomsUsed,
            )
        },
        loadout = draft.loadout,
    ),
    ValidationContext(engine = draft.mode, trackLapCount = draft.trackLapCount),
)

/** The first error on a field, so only the offending field is marked (DESIGN_SYSTEM §13). */
fun androidErrorFor(errors: List<RuleError>, field: String): RuleError? =
    errors.firstOrNull { it.field == field }

// ---------------------------------------------------------------- scan autofill

data class AndroidScanFill(
    val totalDigits: String? = null,
    val laps: List<String> = emptyList(),
    /** Absolute end-of-lap coin balances as a producer reads them, or null per lap. */
    val lapCoinBalances: List<Int?> = emptyList(),
    val lapMushrooms: List<Int?> = emptyList(),
    val loadout: Map<String, String?> = emptyMap(),
    val observedPlayerName: String? = null,
    val source: String = "endscreen",
    val sourceKind: String = "android_scan",
    /** Field paths the producer was unsure about. */
    val doubt: List<String> = emptyList(),
)

data class AndroidScanApplication(
    val draft: AndroidPostTimeDraft,
    /** Fields the Player had typed that the scan would have overwritten, and did not. */
    val conflicts: List<String>,
    /** Fields this scan actually filled. */
    val filled: List<String>,
    /** Optional setup fields the scan left blank and the Player still needs to review. */
    val unreadLoadoutKeys: List<String> = emptyList(),
    /**
     * The producer's own lap count when it is not this track's — a result read
     * from another track. Its lap times are then not filled in at all: half a
     * result that cannot add up is worse than none (POST_A_TIME §3, "the track
     * comes from the page context, never from the scanner").
     */
    val producerLapCount: Int? = null,
)

private fun AndroidPostTimeDraft.typedAndFilled(field: String, current: String?): Boolean =
    !current.isNullOrEmpty() && origin[field] != AndroidFieldOrigin.SCANNED

/**
 * A scan fills empty fields and never silently replaces a value the Player
 * typed (POST_A_TIME §7). [replaceTyped] is the answer to the "Replace the
 * values you typed?" question. Scanned digits do **not** go through the typed
 * mask: a misread 1:78.000 stays 1:78.000 and the rule says so, rather than
 * becoming 1:58.000 behind the Player's back (SPEC §7 D5).
 *
 * Coins arrive from a producer as the **balance** at the end of a lap; the
 * canonical entry is the signed change, so they are converted here. The stored
 * value is the balance again after normalisation, so the payload is unchanged.
 */
fun androidApplyScan(
    draft: AndroidPostTimeDraft,
    fill: AndroidScanFill,
    replaceTyped: Boolean = false,
): AndroidScanApplication {
    val conflicts = mutableListOf<String>()
    val filled = mutableListOf<String>()
    val origin = draft.origin.toMutableMap()

    var totalDigits = draft.totalDigits
    val scannedTotal = fill.totalDigits?.let(::androidScanDigits).orEmpty()
    if (scannedTotal.isNotEmpty()) {
        if (draft.typedAndFilled(ANDROID_POST_TIME_TOTAL_FIELD, draft.totalDigits) && !replaceTyped) {
            conflicts += ANDROID_POST_TIME_TOTAL_FIELD
        } else {
            totalDigits = scannedTotal
            origin[ANDROID_POST_TIME_TOTAL_FIELD] = AndroidFieldOrigin.SCANNED
            filled += ANDROID_POST_TIME_TOTAL_FIELD
        }
    }

    // A result from a track with another lap count is not this form's race.
    val scannedLaps = fill.laps.count { androidScanDigits(it).isNotEmpty() }
    val lapCountMismatch = scannedLaps > 0 && scannedLaps != draft.laps.size
    var previousBalance = 0
    val laps = if (lapCountMismatch) draft.laps else draft.laps.mapIndexed { index, lap ->
        var next = lap
        val scanned = fill.laps.getOrNull(index)?.let(::androidScanDigits).orEmpty()
        if (scanned.isNotEmpty()) {
            val field = androidLapTimeField(index)
            if (draft.typedAndFilled(field, lap.timeDigits) && !replaceTyped) {
                conflicts += field
            } else {
                next = next.copy(timeDigits = scanned)
                origin[field] = AndroidFieldOrigin.SCANNED
                filled += field
            }
        }
        val balance = fill.lapCoinBalances.getOrNull(index)
        if (balance != null) {
            val field = androidLapCoinField(index)
            if (lap.coinChange != null && draft.origin[field] != AndroidFieldOrigin.SCANNED && !replaceTyped) {
                conflicts += field
            } else {
                next = next.copy(coinChange = balance - previousBalance)
                origin[field] = AndroidFieldOrigin.SCANNED
                filled += field
            }
            previousBalance = balance
        }
        val mushrooms = fill.lapMushrooms.getOrNull(index)
        if (mushrooms != null) {
            val field = androidLapMushroomField(index)
            if (lap.mushroomsUsed != null && draft.origin[field] != AndroidFieldOrigin.SCANNED && !replaceTyped) {
                conflicts += field
            } else {
                next = next.copy(mushroomsUsed = mushrooms)
                origin[field] = AndroidFieldOrigin.SCANNED
                filled += field
            }
        }
        next
    }

    val loadout = draft.loadout.toMutableMap()
    for (key in ANDROID_LOADOUT_PART_KEYS) {
        val scanned = fill.loadout[key]
        if (scanned.isNullOrEmpty()) continue
        val field = androidLoadoutField(key)
        if (draft.typedAndFilled(field, draft.loadout[key]) && !replaceTyped) {
            conflicts += field
            continue
        }
        loadout[key] = scanned
        origin[field] = AndroidFieldOrigin.SCANNED
        filled += field
    }

    val doubt = (draft.doubt + fill.doubt).distinct().filter { it in filled }
    val unreadLoadoutKeys = ANDROID_LOADOUT_PART_KEYS.filter { key ->
        fill.loadout[key].isNullOrEmpty() && loadout[key].isNullOrEmpty()
    }
    return AndroidScanApplication(
        draft = draft.copy(
            totalDigits = totalDigits,
            laps = laps,
            loadout = loadout,
            origin = origin,
            doubt = doubt,
            scan = AndroidPostTimeScan(
                source = fill.source,
                observedPlayerName = fill.observedPlayerName,
                sourceKind = fill.sourceKind,
            ),
        ),
        conflicts = conflicts,
        filled = filled,
        unreadLoadoutKeys = unreadLoadoutKeys,
        producerLapCount = scannedLaps.takeIf { lapCountMismatch },
    )
}

/** Any field still carrying a producer value. */
fun AndroidPostTimeDraft.hasScannedValue(): Boolean =
    origin.values.any { it == AndroidFieldOrigin.SCANNED }

// ---------------------------------------------------------------- drafts (POST_A_TIME §8)

/** One draft per (player, track, mode), as the frozen architecture keys it. */
fun androidPostTimeDraftKey(playerId: String, trackId: String?, mode: Int): String =
    "$playerId|${trackId ?: "?"}|$mode"

/** Where a kept draft lives; the screen hands in a SharedPreferences-backed one. */
interface AndroidPostTimeDraftStorage {
    fun read(): String?
    fun write(value: String)
    fun clear()
}

private val draftJson = Json { encodeDefaults = true; explicitNulls = false; ignoreUnknownKeys = true }

@Serializable
private data class StoredAndroidPostTimeDraft(
    val key: String,
    val draft: AndroidPostTimeDraft,
    val savedAtMs: Long,
)

fun androidSaveDraft(
    storage: AndroidPostTimeDraftStorage?,
    playerId: String,
    draft: AndroidPostTimeDraft,
    nowMs: Long,
) {
    if (storage == null) return
    runCatching {
        if (!draft.hasMeaningfulData()) {
            storage.clear()
            return
        }
        storage.write(
            draftJson.encodeToString(
                StoredAndroidPostTimeDraft(
                    androidPostTimeDraftKey(playerId, draft.trackId, draft.mode), draft, nowMs,
                ),
            ),
        )
    }
    // A storage area that refuses loses the draft, which is today's behaviour on
    // this path; it must never stop the Player from publishing.
}

fun androidClearDraft(storage: AndroidPostTimeDraftStorage?) {
    runCatching { storage?.clear() }
}

/** Reads back a draft for exactly this (player, track, mode); anything else is ignored. */
fun androidLoadDraft(
    storage: AndroidPostTimeDraftStorage?,
    playerId: String,
    trackId: String?,
    mode: Int,
    lapCount: Int,
): AndroidPostTimeDraft? {
    val raw = runCatching { storage?.read() }.getOrNull() ?: return null
    val stored = runCatching {
        draftJson.decodeFromString(StoredAndroidPostTimeDraft.serializer(), raw)
    }.getOrNull() ?: return null
    if (stored.key != androidPostTimeDraftKey(playerId, trackId, mode)) return null
    val base = createAndroidPostTimeDraft(trackId, mode, lapCount)
    val laps = List(lapCount) { index -> stored.draft.laps.getOrNull(index) ?: AndroidPostTimeLap() }
    val loadout = base.loadout.toMutableMap()
    for (key in ANDROID_LOADOUT_PART_KEYS) {
        val value = stored.draft.loadout[key]
        if (!value.isNullOrEmpty()) loadout[key] = value
    }
    return base.copy(
        totalDigits = androidScanDigits(stored.draft.totalDigits),
        laps = laps,
        loadout = loadout,
        origin = stored.draft.origin,
        doubt = stored.draft.doubt,
        scan = null,
    )
}
