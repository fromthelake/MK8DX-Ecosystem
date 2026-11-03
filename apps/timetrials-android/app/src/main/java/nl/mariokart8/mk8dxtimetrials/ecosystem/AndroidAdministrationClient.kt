package nl.mariokart8.mk8dxtimetrials.ecosystem

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import java.net.URI

/**
 * The administrator's numbers, over the native bearer channel: how many
 * people are registered, how many were around lately, what is waiting. The
 * same document the website's Administration › Overview shows.
 */
@Serializable
internal data class AndroidAdministrationWindow(
    val signedIn: Int = 0,
    val submitted: Int = 0,
)

@Serializable
internal data class AndroidAdministrationRegistered(
    val signInIdentities: Int = 0,
    val accounts: Int = 0,
    val players: Int = 0,
    val linkedPlayers: Int = 0,
    val administrators: Int = 0,
)

@Serializable
internal data class AndroidAdministrationActive(
    val last24h: AndroidAdministrationWindow = AndroidAdministrationWindow(),
    val last7d: AndroidAdministrationWindow = AndroidAdministrationWindow(),
    val last30d: AndroidAdministrationWindow = AndroidAdministrationWindow(),
)

@Serializable
internal data class AndroidAdministrationPending(
    val playerClaims: Int = 0,
)

@Serializable
internal data class AndroidAdministrationOverview(
    val schemaVersion: String = "",
    val generatedAtMs: Long = 0,
    val registered: AndroidAdministrationRegistered = AndroidAdministrationRegistered(),
    val active: AndroidAdministrationActive = AndroidAdministrationActive(),
    val pending: AndroidAdministrationPending = AndroidAdministrationPending(),
)

internal class AndroidAdministrationException(
    val forbidden: Boolean = false,
    message: String,
) : Exception(message)

internal class AndroidAdministrationClient(
    origin: String,
    private val session: AndroidAuthenticatedNativeSession,
    private val opener: AndroidTournamentConnectionOpener,
) {
    private val origin = URI(origin)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun overview(): AndroidAdministrationOverview {
        val body = request("/v1/native/administrator/overview")
        val parsed = json.decodeFromString<AndroidAdministrationOverview>(body)
        if (parsed.schemaVersion != "mk8dx.administrator-overview.v1") {
            throw AndroidAdministrationException(message = "Unexpected answer from the server.")
        }
        return parsed
    }

    private fun request(path: String): String {
        val requested = URI(path)
        val target = URI(origin.scheme, null, origin.host, origin.port, requested.path, null, null)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) {
                throw AndroidAdministrationException(message = "Endpoint mismatch")
            }
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${session.bearerToken}")
            val status = connection.responseCode
            if (status == 401 || status == 403) {
                throw AndroidAdministrationException(
                    forbidden = true,
                    message = "Administration is available to an administrator only.",
                )
            }
            if (status !in 200..299) {
                throw AndroidAdministrationException(message = "The server answered $status.")
            }
            return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
