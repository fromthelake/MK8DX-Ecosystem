package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * One community this phone has been set up for (ADR-0225 section 1). [name] is what the person sees: the host,
 * or the community's own name once the app knows one.
 */
@Serializable
internal data class AndroidCommunity(
    val origin: String,
    val name: String,
    val lastUsedAtMs: Long,
)

/** Where the list is kept; SharedPreferences on the phone, a plain variable in the tests. */
internal interface AndroidCommunityListStorage {
    fun read(): String?
    fun write(value: String): Boolean
}

internal sealed interface AndroidCommunityRemoval {
    data object Removed : AndroidCommunityRemoval
    /** The active community is never removed: there would be nothing left to talk to. */
    data object RefusedActive : AndroidCommunityRemoval
    /** Unsent runs would become unreachable; the person switches there and sends them first. */
    data class RefusedUnsent(val unsent: Int) : AndroidCommunityRemoval
    data object Unknown : AndroidCommunityRemoval
}

private val communityJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
private val communityListSerializer = ListSerializer(AndroidCommunity.serializer())

/**
 * The remembered communities. Every community keeps its own sessions, unsent runs and (for A2) pinned root in
 * its own storage namespace, so remembering, switching and forgetting an entry here never touches that data.
 */
internal class AndroidCommunityList(
    private val storage: AndroidCommunityListStorage,
    private val validate: (String) -> String? = { AndroidServerOrigin.validate(it, allowLoopbackPort = true) },
) {
    /**
     * Newest use first. An install from before the list existed has only its active origin: it becomes the only
     * entry here, without a step for the person (ADR-0225 1.3).
     */
    fun all(active: String?, nowMs: Long): List<AndroidCommunity> {
        val stored = decode()
        if (active != null && validate(active) != null && stored.none { it.origin == active }) {
            val migrated = stored + AndroidCommunity(active, displayNameOf(active), nowMs)
            write(migrated)
            return sorted(migrated)
        }
        return sorted(stored)
    }

    /** Adds [origin] when it is new, and marks it as just used. */
    fun markUsed(origin: String, nowMs: Long): List<AndroidCommunity> {
        val valid = validate(origin) ?: return sorted(decode())
        val stored = decode()
        val updated = if (stored.any { it.origin == valid }) {
            stored.map { if (it.origin == valid) it.copy(lastUsedAtMs = nowMs) else it }
        } else {
            stored + AndroidCommunity(valid, displayNameOf(valid), nowMs)
        }
        write(updated)
        return sorted(updated)
    }

    /** Remembers the community's own name, once the app learns one. */
    fun rename(origin: String, name: String) {
        val trimmed = name.trim().take(80)
        if (trimmed.isEmpty()) return
        val stored = decode()
        if (stored.none { it.origin == origin && it.name != trimmed }) return
        write(stored.map { if (it.origin == origin) it.copy(name = trimmed) else it })
    }

    /**
     * What the community itself calls itself, read from its public settings: [name] when it has one, the host
     * when it has none (null, blank, older server). A later read with another name replaces it.
     */
    fun applyServerName(origin: String, name: String?) {
        val shown = name?.trim()?.take(60)?.takeIf { it.isNotEmpty() } ?: displayNameOf(origin)
        val stored = decode()
        if (stored.none { it.origin == origin && it.name != shown }) return
        write(stored.map { if (it.origin == origin) it.copy(name = shown) else it })
    }

    fun remove(origin: String, active: String?, unsent: Int): AndroidCommunityRemoval {
        val stored = decode()
        return when {
            stored.none { it.origin == origin } -> AndroidCommunityRemoval.Unknown
            origin == active -> AndroidCommunityRemoval.RefusedActive
            unsent > 0 -> AndroidCommunityRemoval.RefusedUnsent(unsent)
            else -> {
                write(stored.filterNot { it.origin == origin })
                AndroidCommunityRemoval.Removed
            }
        }
    }

    private fun decode(): List<AndroidCommunity> = storage.read()?.let { text ->
        runCatching { communityJson.decodeFromString(communityListSerializer, text) }.getOrNull()
    }.orEmpty().filter { validate(it.origin) == it.origin }.distinctBy { it.origin }

    private fun write(list: List<AndroidCommunity>) {
        storage.write(communityJson.encodeToString(communityListSerializer, list))
    }

    private fun sorted(list: List<AndroidCommunity>) = list.sortedByDescending { it.lastUsedAtMs }

    companion object {
        fun displayNameOf(origin: String): String = runCatching {
            val uri = URI(origin)
            uri.host + if (uri.port == -1) "" else ":${uri.port}"
        }.getOrNull() ?: origin
    }
}

/** The phone's list, in its own preferences file: one key, one JSON array. */
internal object AndroidCommunities {
    private const val preferencesName = "mk8dx_communities_v1"
    private const val key = "communities"

    private fun store(context: Context) = AndroidCommunityList(
        object : AndroidCommunityListStorage {
            private val preferences = context.applicationContext
                .getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            override fun read(): String? = preferences.getString(key, null)
            override fun write(value: String): Boolean = preferences.edit().putString(key, value).commit()
        },
    )

    fun list(context: Context): List<AndroidCommunity> =
        store(context).all(AndroidServerOrigin.current(context), System.currentTimeMillis())

    fun markUsed(context: Context, origin: String) {
        store(context).markUsed(origin, System.currentTimeMillis())
    }

    /** Stores the name a community's public settings give (or its host when they give none). */
    fun applyServerName(context: Context, origin: String, name: String?) {
        runCatching { store(context).applyServerName(origin, name) }
    }

    /**
     * Reads [origin]'s public settings with that community's own trust and stores its name. Network work: call
     * it off the main thread. Returns the settings, or null when the community could not be read.
     */
    fun refreshName(context: Context, origin: String): nl.mariokart8.mk8dxtimetrials.tournament.AndroidInstallationSettings? =
        runCatching {
            nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClient(
                origin,
                null,
                nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener { url ->
                    nl.mariokart8.mk8dxtimetrials.lan.AndroidOriginTrust.open(context, url)
                },
            ).installationSettings()
        }.getOrNull()?.also { applyServerName(context, origin, it.communityName) }

    fun remove(context: Context, origin: String, unsent: Int): AndroidCommunityRemoval =
        store(context).remove(origin, AndroidServerOrigin.current(context), unsent)
}
