package nl.mariokart8.mk8dxtimetrials.posttime

/**
 * What the time you are about to publish would do (POST_A_TIME_ARCHITECTURE §5),
 * the Kotlin twin of the web's `post-time-prediction.ts`.
 *
 * A port of the server's pure `computeSubmissionFeedback`
 * (backend/api/src/timetrials/submission-feedback.ts), run on the phone over
 * data the track screen already loaded: the (track, mode) leaderboard and the
 * Player's own best. Equal times share a rank, exactly as on the server, so the
 * prediction and the `?feedback=` answer that replaces it after publication
 * agree.
 *
 * Exactness is stated, never guessed. The public leaderboard is the top 100, so
 * a time that lands outside it is reported as "outside the top 100" rather than
 * with an invented number.
 */
data class AndroidPredictionCompetitor(
    val playerId: String,
    val displayName: String,
    val bestMs: Long,
)

data class AndroidPredictionNeighbour(
    val displayName: String,
    val bestMs: Long,
    /** The effective leaderboard time minus this neighbour's best; negative means the Player is ahead. */
    val gapMs: Long,
    val rival: Boolean,
)

data class AndroidPredictionPassedPlayer(
    val playerId: String,
    val displayName: String,
    val bestMs: Long,
    val rival: Boolean,
)

data class AndroidSubmissionPrediction(
    val totalTimeMs: Long,
    val previousBestMs: Long?,
    val deltaMs: Long?,
    val improved: Boolean,
    /** Null when the time lands outside the loaded board, where no exact rank can be honest. */
    val rankAfter: Int?,
    val rankBefore: Int?,
    val rankExact: Boolean,
    val passed: List<AndroidPredictionPassedPlayer>,
    val passedCount: Int,
    val rivalsPassed: Int,
    /** How many Players the board holds, and whether that is all of them. */
    val fieldCount: Int,
    val fieldComplete: Boolean,
    val ahead: AndroidPredictionNeighbour?,
    val behind: AndroidPredictionNeighbour?,
)

const val ANDROID_PREDICTION_PASSED_LIMIT = 5

/** The public leaderboard the client can see (`/v1/public/time-trial-leaderboard`). */
const val ANDROID_PREDICTION_BOARD_LIMIT = 100

/**
 * The same arithmetic as the server's `computeSubmissionFeedback`, plus the two
 * neighbours and the honesty flag the panel needs. [competitors] excludes the
 * submitting Player.
 */
fun androidPredictSubmission(
    totalTimeMs: Long,
    previousBestMs: Long?,
    competitors: List<AndroidPredictionCompetitor>,
    rivalPlayerIds: Set<String>,
    boardComplete: Boolean,
): AndroidSubmissionPrediction {
    // Equal times replace the current PB as well. In practice this is often
    // the same run submitted again with richer lap or kart-setup evidence.
    val improved = previousBestMs == null || totalTimeMs <= previousBestMs
    val currentBestMs = if (previousBestMs == null) totalTimeMs else minOf(totalTimeMs, previousBestMs)
    fun rankFor(timeMs: Long): Int = 1 + competitors.count { it.bestMs < timeMs }
    val passedAll = if (previousBestMs != null && totalTimeMs < previousBestMs) {
        competitors
            .filter { it.bestMs > totalTimeMs && it.bestMs <= previousBestMs }
            .sortedWith(
                compareByDescending<AndroidPredictionCompetitor> { it.playerId in rivalPlayerIds }
                    .thenBy { it.bestMs },
            )
    } else {
        emptyList()
    }
    val rivalsPassed = passedAll.count { it.playerId in rivalPlayerIds }

    // Inside the loaded board every rank is exact. Beyond its slowest row the
    // true position depends on Players the phone cannot see, so no number is
    // printed.
    val slowest = competitors.fold(0L) { worst, competitor -> maxOf(worst, competitor.bestMs) }
    val exact = boardComplete || competitors.isEmpty() || currentBestMs <= slowest
    val after = if (exact) rankFor(currentBestMs) else null
    val before = when {
        previousBestMs == null -> null
        boardComplete || previousBestMs <= slowest -> rankFor(previousBestMs)
        else -> null
    }

    fun neighbour(competitor: AndroidPredictionCompetitor?): AndroidPredictionNeighbour? =
        competitor?.let {
            AndroidPredictionNeighbour(
                displayName = it.displayName,
                bestMs = it.bestMs,
                gapMs = currentBestMs - it.bestMs,
                rival = it.playerId in rivalPlayerIds,
            )
        }
    val faster = competitors.filter { it.bestMs < currentBestMs }.sortedByDescending { it.bestMs }
    val slower = competitors.filter { it.bestMs >= currentBestMs }.sortedBy { it.bestMs }

    return AndroidSubmissionPrediction(
        totalTimeMs = totalTimeMs,
        previousBestMs = previousBestMs,
        deltaMs = previousBestMs?.let { totalTimeMs - it },
        improved = improved,
        rankAfter = after,
        rankBefore = before,
        rankExact = exact,
        passed = passedAll.take(ANDROID_PREDICTION_PASSED_LIMIT).map {
            AndroidPredictionPassedPlayer(it.playerId, it.displayName, it.bestMs, it.playerId in rivalPlayerIds)
        },
        passedCount = passedAll.size,
        rivalsPassed = rivalsPassed,
        fieldCount = competitors.size + 1,
        fieldComplete = boardComplete,
        ahead = neighbour(faster.firstOrNull()),
        behind = neighbour(slower.firstOrNull()),
    )
}

data class AndroidPredictionBoardRow(
    val playerId: String,
    val displayName: String,
    val totalTimeMs: Long,
)

/**
 * Turns the loaded leaderboard into a prediction for a candidate time. The
 * submitting Player's own row is removed from the field, exactly as the server
 * excludes it.
 */
fun androidPredictFromBoard(
    totalTimeMs: Long,
    rows: List<AndroidPredictionBoardRow>,
    ownPlayerId: String?,
    ownBestMs: Long?,
    rivalPlayerIds: Set<String>,
): AndroidSubmissionPrediction {
    val own = ownPlayerId?.let { id -> rows.firstOrNull { it.playerId == id } }
    val competitors = rows
        .filter { it.playerId != ownPlayerId }
        .map { AndroidPredictionCompetitor(it.playerId, it.displayName, it.totalTimeMs) }
    return androidPredictSubmission(
        totalTimeMs = totalTimeMs,
        previousBestMs = own?.totalTimeMs ?: ownBestMs,
        competitors = competitors,
        rivalPlayerIds = rivalPlayerIds,
        boardComplete = rows.size < ANDROID_PREDICTION_BOARD_LIMIT,
    )
}
