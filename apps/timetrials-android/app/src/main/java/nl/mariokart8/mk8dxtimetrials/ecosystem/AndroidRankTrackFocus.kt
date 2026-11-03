package nl.mariokart8.mk8dxtimetrials.ecosystem

/**
 * The Home journey and competitive tiles open Ranking already narrowed to the
 * tracks they were about. This is the APK's copy of the web's
 * `rank-track-focus.ts`: the same six values, the same labels and the same
 * matching rules, so a tile leads to the same list on both clients.
 */
internal enum class AndroidRankTrackFocus(
    val apiValue: String,
    val english: String,
    val dutch: String,
) {
    STAFF_LEFT("staff-left", "Staff ghosts left", "Staff ghosts over"),
    NEAR_RECORD("near-record", "Within 1s of #1", "Binnen 1s van #1"),
    CURRENT_RECORDS("current-records", "Current track records", "Huidige circuitrecords"),
    TRACKS_LEFT("tracks-left", "Tracks left to drive", "Circuits nog te rijden"),
    TOP_THREE("top-three", "Top 3 positions", "Top 3-posities"),
    OUTSIDE_TOP_TEN("outside-top-ten", "Outside the top 10", "Buiten de top 10");

    companion object {
        fun parse(value: String?): AndroidRankTrackFocus? =
            entries.firstOrNull { it.apiValue == value }
    }
}

/** What is known about one track for the viewer, in the focus's terms. */
internal data class AndroidRankTrackEvidence(
    val bestRank: Int? = null,
    val bestTimeMs: Long? = null,
    val staffTimeMs: Long? = null,
    val leaderTimeMs: Long? = null,
)

internal fun matchesAndroidRankTrackFocus(
    focus: AndroidRankTrackFocus,
    evidence: AndroidRankTrackEvidence,
): Boolean = when (focus) {
    AndroidRankTrackFocus.STAFF_LEFT ->
        evidence.staffTimeMs != null &&
            (evidence.bestTimeMs == null || evidence.bestTimeMs >= evidence.staffTimeMs)
    AndroidRankTrackFocus.NEAR_RECORD ->
        evidence.bestRank != null && evidence.bestRank > 1 &&
            evidence.bestTimeMs != null && evidence.leaderTimeMs != null &&
            evidence.bestTimeMs >= evidence.leaderTimeMs &&
            evidence.bestTimeMs - evidence.leaderTimeMs <= 1_000
    AndroidRankTrackFocus.CURRENT_RECORDS -> evidence.bestRank == 1
    AndroidRankTrackFocus.TRACKS_LEFT -> evidence.bestTimeMs == null
    AndroidRankTrackFocus.TOP_THREE -> evidence.bestRank != null && evidence.bestRank <= 3
    AndroidRankTrackFocus.OUTSIDE_TOP_TEN -> evidence.bestRank != null && evidence.bestRank > 10
}
