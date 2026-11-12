package nl.mariokart8.mk8dxtimetrials.carry

import kotlinx.serialization.Serializable

/**
 * ADR-0225 section 2.2: where a carried time comes from. Additive and optional on `TimeTrialSubmissionV1`;
 * a submission without it is unchanged on the wire.
 */
@Serializable
internal data class AndroidCarriedFromV1(
    val origin: String,
    val communityName: String? = null,
    val originalSubmissionId: String? = null,
    val originalSubmittedAtMs: Long,
)

/** The receiving community's public answer (ADR-0225 2.1). Missing or unknown reads as "off". */
internal enum class AndroidCarriedTimesPolicy(val wire: String) {
    OFF("off"), REVIEW("review"), ALLOWED("allowed");

    companion object {
        fun of(value: String?): AndroidCarriedTimesPolicy = entries.firstOrNull { it.wire == value } ?: OFF
    }
}
