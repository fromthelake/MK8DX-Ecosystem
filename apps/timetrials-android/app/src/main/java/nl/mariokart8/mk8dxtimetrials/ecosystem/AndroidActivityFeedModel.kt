package nl.mariokart8.mk8dxtimetrials.ecosystem

internal enum class AndroidActivityRelevance {
    OVERTAKEN,
    RIVAL,
    THREATENED,
    OWN_PR,
    OWN_RUN,
    OTHER,
}

internal enum class AndroidActivityScopeFilter { ALL, RIVALS, MY_TRACKS }
internal enum class AndroidActivityModeFilter { ALL, CC150, CC200 }

internal data class AndroidActivityFeedItem(
    val story: AndroidActivityStory,
    val relevance: AndroidActivityRelevance,
    val deltaMs: Long?,
    val isReferenceRun: Boolean,
    /**
     * This run measured against the viewer's own best on the same track and
     * engine class: positive when the viewer is faster. Null on the viewer's
     * own rows and where the viewer has no time there. Distinct from
     * [deltaMs], which prefers the overtake notification's own figure.
     */
    val comparisonMs: Long? = null,
    /**
     * The delta printed beside this published result. For another Player while
     * signed in this is measured against the viewer's best; for the viewer's
     * own row, and while signed out, it is the story Player's historical
     * self-delta captured when the result was published.
     */
    val resultDeltaMs: Long? = null,
)

/**
 * The left keyline on an Activity row, with the web's meaning:
 *
 * - [WON] green - your best on this track is faster than this run;
 * - [LOST] red - this run beat your best;
 * - [RECORD] green - a personal best (yours or anyone's), when no comparison
 *   applies;
 * - [NONE] no keyline - a tie, or nothing to compare against.
 *
 * A comparison always wins over the record marker, exactly as
 * `activity-stories.ts` does when it removes `--record` before adding the
 * outcome class.
 */
internal enum class AndroidActivityOutcome { WON, LOST, RECORD, NONE }

internal fun androidActivityOutcome(item: AndroidActivityFeedItem): AndroidActivityOutcome {
    val comparison = item.comparisonMs
    return when {
        comparison != null && comparison > 0 -> AndroidActivityOutcome.WON
        comparison != null && comparison < 0 -> AndroidActivityOutcome.LOST
        item.story.personalBest -> AndroidActivityOutcome.RECORD
        else -> AndroidActivityOutcome.NONE
    }
}

internal data class AndroidActivityFeedSections(
    val action: List<AndroidActivityFeedItem>,
    val rivals: List<AndroidActivityFeedItem>,
    val attention: List<AndroidActivityFeedItem>,
    val ownSessions: List<AndroidActivityFeedItem>,
    val community: List<AndroidActivityFeedItem>,
)

internal fun buildAndroidActivityFeed(
    stories: List<AndroidActivityStory>,
    ownBests: Map<String, Long>,
    viewerPlayerId: String?,
    scopeFilter: AndroidActivityScopeFilter = AndroidActivityScopeFilter.ALL,
    modeFilter: AndroidActivityModeFilter = AndroidActivityModeFilter.ALL,
    rivalPlayerIds: Set<String> = emptySet(),
    nowMs: Long = System.currentTimeMillis(),
): AndroidActivityFeedSections {
    val visible = stories.asSequence().filter { story ->
        val matchesMode = when (modeFilter) {
            AndroidActivityModeFilter.ALL -> true
            AndroidActivityModeFilter.CC150 -> story.mode == 150
            AndroidActivityModeFilter.CC200 -> story.mode == 200
        }
        val matchesScope = when (scopeFilter) {
            AndroidActivityScopeFilter.ALL -> true
            AndroidActivityScopeFilter.RIVALS -> story.player.playerId in rivalPlayerIds
            AndroidActivityScopeFilter.MY_TRACKS -> ownBests.containsKey("${story.trackId}#${story.mode}")
        }
        matchesMode && matchesScope
    }.map { story ->
        val own = viewerPlayerId != null && story.player.playerId == viewerPlayerId
        val ownBest = ownBests["${story.trackId}#${story.mode}"]
        val delta = story.viewerOvertake?.deltaMs ?: ownBest?.let { story.bestMs - it }
        val comparison = if (own) null else ownBest?.let { story.bestMs - it }
        val selfDelta = story.playerDeltaMs ?: story.personalBestDeltaMs?.let { -it }
        val resultDelta = if (viewerPlayerId != null && !own && comparison != null) {
            comparison
        } else {
            selfDelta
        }
        val recent = story.latestAtMs <= nowMs && nowMs - story.latestAtMs <= ACTIVITY_RELEVANCE_WINDOW_MS
        val relevance = when {
            viewerPlayerId == null -> AndroidActivityRelevance.OTHER
            story.viewerOvertake != null -> AndroidActivityRelevance.OVERTAKEN
            own && story.personalBest -> AndroidActivityRelevance.OWN_PR
            own -> AndroidActivityRelevance.OWN_RUN
            story.player.playerId in rivalPlayerIds && recent -> AndroidActivityRelevance.RIVAL
            story.personalBest && recent && delta != null && delta in 1L..1_000L -> AndroidActivityRelevance.THREATENED
            else -> AndroidActivityRelevance.OTHER
        }
        AndroidActivityFeedItem(
            story = story,
            relevance = relevance,
            deltaMs = delta,
            isReferenceRun = own && ownBest != null && story.bestMs == ownBest,
            comparisonMs = comparison,
            resultDeltaMs = resultDelta,
        )
    }.toList()

    if (viewerPlayerId == null) {
        return AndroidActivityFeedSections(
            action = emptyList(),
            rivals = emptyList(),
            attention = emptyList(),
            ownSessions = emptyList(),
            community = visible.sortedByDescending { it.story.latestAtMs },
        )
    }

    val action = visible.filter { it.relevance == AndroidActivityRelevance.OVERTAKEN }
        .sortedWith(compareBy<AndroidActivityFeedItem> { kotlin.math.abs(it.deltaMs ?: Long.MAX_VALUE) }
            .thenByDescending { it.story.latestAtMs })
        .take(3)
    val actionIds = action.mapTo(mutableSetOf()) { storyKey(it.story) }
    val rivals = visible.filter { it.relevance == AndroidActivityRelevance.RIVAL }
        .sortedByDescending { it.story.latestAtMs }
    val attention = visible.filter {
        it.relevance in setOf(AndroidActivityRelevance.OVERTAKEN, AndroidActivityRelevance.THREATENED) &&
            storyKey(it.story) !in actionIds
    }.sortedWith(compareBy<AndroidActivityFeedItem> {
        if (it.relevance == AndroidActivityRelevance.OVERTAKEN) 0 else 1
    }.thenBy { kotlin.math.abs(it.deltaMs ?: Long.MAX_VALUE) }
        .thenByDescending { it.story.latestAtMs })
    // Sessions read as a diary: newest first, always. A personal best keeps
    // its badge but no longer pins an old story above newer sessions (owner
    // report 2026-08-30: a days-old 200cc PB sat on top with no visible
    // reason).
    val own = visible.filter {
        it.relevance == AndroidActivityRelevance.OWN_PR || it.relevance == AndroidActivityRelevance.OWN_RUN
    }.sortedByDescending { it.story.latestAtMs }
    val reserved = (action + rivals + attention + own).mapTo(mutableSetOf()) { storyKey(it.story) }
    val community = visible.filter { storyKey(it.story) !in reserved }
        .sortedByDescending { it.story.latestAtMs }
    return AndroidActivityFeedSections(action, rivals, attention, own, community)
}

internal const val ACTIVITY_RELEVANCE_WINDOW_MS = 7L * 24L * 60L * 60L * 1_000L
private const val ACTIVITY_HOME_LIMIT = 10
private const val RIVAL_HOME_LIMIT = 3
private const val ATTENTION_HOME_LIMIT = 2
private const val OWN_SESSION_HOME_LIMIT = 2

internal fun limitAndroidActivityFeed(
    sections: AndroidActivityFeedSections,
    totalLimit: Int = ACTIVITY_HOME_LIMIT,
): AndroidActivityFeedSections {
    var remaining = totalLimit.coerceAtLeast(0)
    fun take(items: List<AndroidActivityFeedItem>, maximum: Int): List<AndroidActivityFeedItem> =
        items.take(minOf(maximum, remaining)).also { remaining -= it.size }

    val action = take(sections.action, 3)
    val firstPerRival = mutableListOf<AndroidActivityFeedItem>()
    val rivalRemainder = mutableListOf<AndroidActivityFeedItem>()
    val seenRivals = mutableSetOf<String>()
    sections.rivals.forEach { item ->
        if (seenRivals.add(item.story.player.playerId)) firstPerRival += item else rivalRemainder += item
    }
    val rivals = (firstPerRival + rivalRemainder).take(minOf(RIVAL_HOME_LIMIT, remaining))
    remaining -= rivals.size
    val attention = take(sections.attention, ATTENTION_HOME_LIMIT)
    val own = take(sections.ownSessions, OWN_SESSION_HOME_LIMIT)
    val community = sections.community.take(remaining)
    return AndroidActivityFeedSections(action, rivals, attention, own, community)
}

private fun storyKey(story: AndroidActivityStory): String =
    "${story.player.playerId}#${story.trackId}#${story.mode}#${story.latestAtMs}"
