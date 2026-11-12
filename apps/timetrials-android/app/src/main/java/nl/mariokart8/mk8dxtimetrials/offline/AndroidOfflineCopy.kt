package nl.mariokart8.mk8dxtimetrials.offline

import android.content.Context
import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin
import nl.mariokart8.mk8dxtimetrials.BuildConfig
import nl.mariokart8.mk8dxtimetrials.carry.AndroidCarriedFromV1
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedLapCounts
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidManagedTimeTrial
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidRival
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTrackBest

/** One of the signed-in Player's own runs, in full, as the community holds it (ADR-0225 amendment 1). */
@Serializable
internal data class AndroidOfflineRun(
    val submissionId: String,
    val trackId: String,
    val mode: Int,
    val totalTimeMs: Long,
    val laps: List<Long> = emptyList(),
    val lapDetails: List<AndroidManagedLapCounts>? = null,
    val loadout: Map<String, String>? = null,
    val sourceKind: String,
    val createdAtMs: Long,
    val publicationStatus: String,
    val retirementState: String,
    val carriedFrom: AndroidCarriedFromV1? = null,
) {
    val active: Boolean get() = retirementState == "active"

    companion object {
        fun of(result: AndroidManagedTimeTrial) = AndroidOfflineRun(
            submissionId = result.submissionId,
            trackId = result.current.trackId,
            mode = result.current.modeCc,
            totalTimeMs = result.current.totalTimeMs,
            laps = result.current.laps,
            lapDetails = result.current.lapDetails,
            loadout = result.current.loadout,
            sourceKind = result.current.sourceKind,
            createdAtMs = result.current.createdAtMs,
            publicationStatus = result.publicationStatus,
            retirementState = result.retirementState,
            carriedFrom = result.carriedFrom,
        )
    }
}

/** A chosen rival's best time on one track and class. */
@Serializable
internal data class AndroidOfflineRivalBest(
    val playerId: String,
    val trackId: String,
    val mode: Int,
    val totalTimeMs: Long,
    val rank: Int,
)

/**
 * The copy of one community kept on this phone: the signed-in Player's own runs and their rivals' best times.
 * Everybody else's rankings stay online.
 */
@Serializable
internal data class AndroidOfflineCopy(
    val schemaVersion: String = SCHEMA_VERSION,
    val playerId: String,
    val playerUsername: String? = null,
    val playerDisplayName: String? = null,
    val runs: List<AndroidOfflineRun> = emptyList(),
    val rivals: List<AndroidRival> = emptyList(),
    val rivalBests: List<AndroidOfflineRivalBest> = emptyList(),
    val lastUpdatedAtMs: Long,
) {
    /** The Player's best active time per track and class. */
    fun personalBests(): List<AndroidOfflineRun> = runs.filter { it.active }
        .groupBy { it.trackId to it.mode }
        .map { (_, group) -> group.minWith(compareBy<AndroidOfflineRun> { it.totalTimeMs }.thenBy { it.createdAtMs }) }

    fun bestsOf(playerId: String): List<AndroidTrackBest> = if (playerId == this.playerId) {
        personalBests().map { AndroidTrackBest(it.trackId, it.mode, it.totalTimeMs, rank = 1) }
    } else {
        rivalBests.filter { it.playerId == playerId }.map { AndroidTrackBest(it.trackId, it.mode, it.totalTimeMs, it.rank) }
    }

    companion object {
        const val SCHEMA_VERSION = "mk8dx.offline-copy.v1"
    }
}

/** What a refresh reads; the phone's ecosystem client online, a fake in the tests. */
internal interface AndroidOfflineCopySource {
    /** The signed-in Player's own runs (`GET /v1/account/time-trials`). */
    fun ownRuns(): List<AndroidManagedTimeTrial>

    /** The chosen rivals (`GET /v1/account/rivals`). */
    fun rivals(): List<AndroidRival>

    /**
     * The rivals' best times. Today `GET /v1/public/track-bests?players=...` (at most 10 per request); a
     * dedicated `GET /v1/account/rivals/best-times` can replace it behind this interface.
     */
    fun rivalBests(playerIds: List<String>): Map<String, List<AndroidTrackBest>>
}

private val copyJson = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

/** The copy of one community, in a file named after its storage namespace (the packaged default keeps none). */
internal class AndroidOfflineCopyStore(private val file: File) {
    private val lock = Any()

    fun read(): AndroidOfflineCopy? = synchronized(lock) {
        runCatching {
            if (!file.isFile) null
            else copyJson.decodeFromString(AndroidOfflineCopy.serializer(), file.readText(Charsets.UTF_8))
                .takeIf { it.schemaVersion == AndroidOfflineCopy.SCHEMA_VERSION }
        }.getOrNull()
    }

    /** The copy, but only when it belongs to [playerId]: another account on the phone never sees it. */
    fun readFor(playerId: String?): AndroidOfflineCopy? = playerId?.let { id -> read()?.takeIf { it.playerId == id } }

    fun write(copy: AndroidOfflineCopy) = synchronized(lock) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.writeText(copyJson.encodeToString(AndroidOfflineCopy.serializer(), copy), Charsets.UTF_8)
        if (!temporary.renameTo(file)) {
            file.delete()
            check(temporary.renameTo(file))
        }
    }

    fun delete() = synchronized(lock) { file.delete() }

    companion object {
        fun fileName(origin: String, packaged: String = BuildConfig.MK8DX_API_ORIGIN): String =
            "time-trial-offline-copy-v1" + AndroidServerOrigin.storageSuffix(origin, packaged) + ".json"

        fun forOrigin(context: Context, origin: String): AndroidOfflineCopyStore =
            AndroidOfflineCopyStore(File(context.filesDir, fileName(origin)))
    }
}

internal sealed interface AndroidOfflineRefresh {
    data class Updated(val copy: AndroidOfflineCopy) : AndroidOfflineRefresh
    /** The community could not be read; the copy that was there stays as it was. */
    data class Kept(val copy: AndroidOfflineCopy?) : AndroidOfflineRefresh
}

/**
 * Reads the community and replaces the copy. Own runs are required: when they cannot be read nothing changes.
 * When only the rivals fail, the rivals of the previous copy (for the same Player) are kept.
 */
internal fun refreshAndroidOfflineCopy(
    store: AndroidOfflineCopyStore,
    source: AndroidOfflineCopySource,
    playerId: String,
    nowMs: Long,
): AndroidOfflineRefresh {
    val previous = store.readFor(playerId)
    val own = try {
        source.ownRuns().filter { it.playerId == playerId }
    } catch (_: Exception) {
        return AndroidOfflineRefresh.Kept(previous)
    }
    val rivalPart = try {
        val rivals = source.rivals()
        val bests = rivals.map { it.playerId }.chunked(10).flatMap { chunk ->
            source.rivalBests(chunk).flatMap { (rivalId, list) ->
                list.filter { rivalId in chunk && (it.mode == 150 || it.mode == 200) }
                    .map { AndroidOfflineRivalBest(rivalId, it.trackId, it.mode, it.totalTimeMs, it.rank) }
            }
        }
        rivals to bests
    } catch (_: Exception) {
        (previous?.rivals ?: emptyList()) to (previous?.rivalBests ?: emptyList())
    }
    val copy = AndroidOfflineCopy(
        playerId = playerId,
        playerUsername = own.firstOrNull()?.playerUsername ?: previous?.playerUsername,
        playerDisplayName = own.firstOrNull()?.playerDisplayName ?: previous?.playerDisplayName,
        runs = own.map(AndroidOfflineRun::of),
        rivals = rivalPart.first,
        rivalBests = rivalPart.second,
        lastUpdatedAtMs = nowMs,
    )
    return try {
        store.write(copy)
        AndroidOfflineRefresh.Updated(copy)
    } catch (_: Exception) {
        AndroidOfflineRefresh.Kept(previous)
    }
}

/** The copy's reads on the phone's ecosystem client. */
internal fun androidOfflineCopySource(
    client: nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidTimeTrialsEcosystemDataSource,
): AndroidOfflineCopySource = object : AndroidOfflineCopySource {
    override fun ownRuns() = client.ownTimeTrialsForCopy()
    override fun rivals() = client.rivals()
    override fun rivalBests(playerIds: List<String>) = client.trackBestsForPlayers(playerIds)
}
