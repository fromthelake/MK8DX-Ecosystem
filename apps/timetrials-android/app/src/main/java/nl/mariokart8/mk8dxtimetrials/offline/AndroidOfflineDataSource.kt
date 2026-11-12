package nl.mariokart8.mk8dxtimetrials.offline

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidActivityLap
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidActivityLoadout
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidInsightsTimeTrials
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPublicTimeTrialResult
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidInsightsTournaments
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrialRevision
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidOwnRun
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPersonalBest
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidPlayerInsights
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRival
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTrackBest
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone

/** When the screens last fell back to the copy: its lastUpdatedAtMs, or null while the community answers. */
internal class AndroidOfflineState {
    private val mutable = MutableStateFlow<Long?>(null)
    val offlineSince: StateFlow<Long?> = mutable
    fun online() { mutable.value = null }
    fun offline(lastUpdatedAtMs: Long) { mutable.value = lastUpdatedAtMs }
}

internal val LocalAndroidOfflineState = staticCompositionLocalOf<AndroidOfflineState?> { null }

/**
 * The ecosystem client with the community's copy behind the Player's own data (ADR-0225 amendment 1): own runs,
 * personal bests, rivals and rivals' best times are answered from the copy when the community cannot be read.
 * Every other read - rankings, other Players - is passed on unchanged and fails as it did.
 */
internal class AndroidOfflineFallbackDataSource(
    private val online: AndroidTimeTrialsEcosystemDataSource,
    private val copy: () -> AndroidOfflineCopy?,
    private val state: AndroidOfflineState,
) : AndroidTimeTrialsEcosystemDataSource by online {
    private inline fun <T> fallback(read: () -> T, offline: (AndroidOfflineCopy) -> T): T = try {
        read().also { state.online() }
    } catch (error: Exception) {
        val available = copy() ?: throw error
        state.offline(available.lastUpdatedAtMs)
        offline(available)
    }

    override fun managedTimeTrials(): List<AndroidManagedTimeTrial> =
        fallback({ online.managedTimeTrials() }) { it.managedRuns() }

    override fun ownTimeTrialsForCopy(): List<AndroidManagedTimeTrial> = online.ownTimeTrialsForCopy()

    override fun ownRuns(): List<AndroidOwnRun> = fallback({ online.ownRuns() }) { copy ->
        copy.runs.filter { it.active }.sortedByDescending { it.createdAtMs }.take(100)
            .map { AndroidOwnRun(it.trackId, it.mode, it.totalTimeMs, createdAtMs = it.createdAtMs) }
    }

    override fun playerInsights(): AndroidPlayerInsights? = fallback({ online.playerInsights() }) { copy ->
        val active = copy.runs.filter { it.active }
        AndroidPlayerInsights(
            schemaVersion = "mk8dx.player-insights.v1",
            playerId = copy.playerId,
            timeTrials = AndroidInsightsTimeTrials(
                submissionCount = active.size,
                personalBests = copy.personalBests().map { best ->
                    AndroidPersonalBest(best.trackId, best.mode, best.totalTimeMs,
                        attemptCount = active.count { it.trackId == best.trackId && it.mode == best.mode })
                },
            ),
            tournaments = AndroidInsightsTournaments(0, 0, 0, 0, 0, 0),
        )
    }

    override fun rivals(): List<AndroidRival> = fallback({ online.rivals() }) { it.rivals }

    /** The Player's own published results; anybody else's stay online only. */
    override fun playerResults(playerId: String): List<AndroidPublicTimeTrialResult> =
        fallback({ online.playerResults(playerId) }) { copy ->
            if (playerId != copy.playerId) throw IllegalStateException()
            copy.publishedResults()
        }

    override fun trackBestsFor(playerId: String): List<AndroidTrackBest> =
        fallback({ online.trackBestsFor(playerId) }) { copy ->
            if (playerId != copy.playerId && copy.rivals.none { it.playerId == playerId }) throw IllegalStateException()
            copy.bestsOf(playerId)
        }
}

/** The copied runs the community publishes, newest first, in the shape the profile shows. */
internal fun AndroidOfflineCopy.publishedResults(): List<AndroidPublicTimeTrialResult> =
    runs.filter { it.active && it.publicationStatus == "published" }
        .sortedByDescending { it.createdAtMs }
        .map { run ->
            AndroidPublicTimeTrialResult(
                resultId = run.submissionId,
                playerId = playerId,
                playerUsername = playerUsername ?: playerId,
                playerDisplayName = playerDisplayName ?: playerUsername ?: playerId,
                trackId = run.trackId,
                mode = run.mode,
                totalTimeMs = run.totalTimeMs,
                laps = run.laps.mapIndexed { index, timeMs ->
                    val counts = run.lapDetails?.getOrNull(index)
                    AndroidActivityLap(index + 1, timeMs, counts?.coinsCollected, counts?.mushroomsUsed)
                },
                loadout = run.loadout?.let {
                    AndroidActivityLoadout(
                        it["characterId"], it["characterVariantId"], it["bodyId"], it["bodyVariantId"],
                        it["tireId"], it["gliderId"], it["gliderVariantId"],
                    )
                },
                sourceKind = run.sourceKind,
                resultAtMs = run.createdAtMs,
            )
        }

private fun AndroidOfflineCopy.managedRuns(): List<AndroidManagedTimeTrial> = runs.map { run ->
    AndroidManagedTimeTrial(
        submissionId = run.submissionId,
        playerId = playerId,
        playerUsername = playerUsername ?: playerId,
        playerDisplayName = playerDisplayName ?: playerUsername ?: playerId,
        retirementState = run.retirementState,
        publicationStatus = run.publicationStatus,
        publicationReason = "offline_copy",
        current = AndroidManagedTimeTrialRevision(
            revision = 1,
            modeCc = run.mode,
            trackId = run.trackId,
            totalTimeMs = run.totalTimeMs,
            laps = run.laps,
            lapDetails = run.lapDetails,
            loadout = run.loadout,
            sourceKind = run.sourceKind,
            createdAtMs = run.createdAtMs,
        ),
        carriedFrom = run.carriedFrom,
    )
}

/** "Offline - last updated {time}" while a screen shows the copy; nothing while the community answers. */
@Composable
internal fun AndroidOfflineStatusLine(modifier: Modifier = Modifier) {
    val state = LocalAndroidOfflineState.current ?: return
    val since by state.offlineSince.collectAsState()
    val at = since ?: return
    val time = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at))
    Mk8dxStatusMessage(
        androidText("Offline — last updated $time", "Offline — laatst bijgewerkt $time"),
        modifier = modifier.testTag("offline-status"),
        tone = Mk8dxStatusTone.Info,
    )
}
