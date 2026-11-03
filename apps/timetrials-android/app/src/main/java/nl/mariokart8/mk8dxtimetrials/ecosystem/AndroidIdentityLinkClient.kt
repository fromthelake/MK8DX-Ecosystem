package nl.mariokart8.mk8dxtimetrials.ecosystem

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import java.net.URI

/**
 * Who can sign in, and whose history they see.
 *
 * The same administrator surface the website offers, reached over the native
 * bearer channel the phone already holds. It exists on the phone because the
 * owner is not always at a desk when somebody says "I signed in and my times
 * are gone".
 */
@Serializable
internal data class AndroidIdentityLinkAccount(
    val userAccountId: String,
    val email: String? = null,
    val accountStatus: String = "",
    val screenName: String? = null,
    val linkedPlayerId: String? = null,
    val linkedPlayerName: String? = null,
    val playerClaimId: String? = null,
)

@Serializable
internal data class AndroidIdentityLinkPlayer(
    val playerId: String,
    val displayName: String,
    val username: String? = null,
    val timeTrials: Int = 0,
    val tournamentRaces: Int = 0,
    val linkedAccountId: String? = null,
)

@Serializable
private data class AndroidIdentityLinkOverviewResponse(
    val schemaVersion: String = "",
    val accounts: List<AndroidIdentityLinkAccount> = emptyList(),
    val players: List<AndroidIdentityLinkPlayer> = emptyList(),
)

internal data class AndroidIdentityLinkOverview(
    val accounts: List<AndroidIdentityLinkAccount>,
    val players: List<AndroidIdentityLinkPlayer>,
)

internal class AndroidIdentityLinkException(
    val forbidden: Boolean = false,
    val conflict: Boolean = false,
    message: String,
) : Exception(message)

internal class AndroidIdentityLinkClient(
    origin: String,
    private val session: AndroidAuthenticatedNativeSession,
    private val opener: AndroidTournamentConnectionOpener,
) {
    private val origin = URI(origin)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun overview(): AndroidIdentityLinkOverview {
        val body = request("GET", "/v1/native/administrator/identity-links", null)
        val parsed = json.decodeFromString<AndroidIdentityLinkOverviewResponse>(body)
        if (parsed.schemaVersion != "mk8dx.administrator-identity-links.v1") {
            throw AndroidIdentityLinkException(message = "Unexpected answer from the server.")
        }
        return AndroidIdentityLinkOverview(parsed.accounts, parsed.players)
    }

    fun link(userAccountId: String, playerId: String) {
        request(
            "POST", "/v1/native/administrator/identity-links/actions/link",
            "{\"userAccountId\":${quoted(userAccountId)},\"playerId\":${quoted(playerId)}}",
        )
    }

    /**
     * ADR-0219: the Players a typed name may mean, with public context, the
     * ones fitting the two answers first. The same list the website shows a
     * person finding themselves at sign-up.
     */
    fun claimCandidates(query: String, timeTrials: Boolean, tournaments: Boolean): List<AndroidClaimCandidate> {
        val trimmed = query.trim()
        require(trimmed.length in 2..64 && trimmed.none { it.code < 0x20 || it.code == 0x7f }) { "query is invalid" }
        val body = buildJsonObject {
            put("query", trimmed)
            put("timeTrials", timeTrials)
            put("tournaments", tournaments)
        }.toString()
        return parseAndroidClaimCandidates(request("POST", "/v1/native/claim-candidates", body))
    }

    fun unlink(userAccountId: String) {
        request(
            "POST", "/v1/native/administrator/identity-links/actions/unlink",
            "{\"userAccountId\":${quoted(userAccountId)}}",
        )
    }

    /** Identifiers only ever contain letters, digits and separators; anything
     *  else is refused rather than escaped, so no request can be shaped by its
     *  own contents. */
    private fun quoted(value: String): String {
        require(value.matches(Regex("^[A-Za-z0-9._:@+-]{1,141}$"))) { "identifier is invalid" }
        return "\"" + value + "\""
    }

    private fun request(method: String, path: String, body: String?): String {
        val requested = URI(path)
        val target = URI(origin.scheme, null, origin.host, origin.port, requested.path, null, null)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) {
                throw AndroidIdentityLinkException(message = "Endpoint mismatch")
            }
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${session.bearerToken}")
            if (body != null) {
                val encoded = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(encoded.size)
                connection.outputStream.use { it.write(encoded) }
            }
            val status = connection.responseCode
            if (status == 401 || status == 403) {
                throw AndroidIdentityLinkException(
                    forbidden = true,
                    message = "Linking is available to an administrator only.",
                )
            }
            if (status == 409) {
                throw AndroidIdentityLinkException(
                    conflict = true,
                    message = "That Player or that account is already linked. Unlink it first.",
                )
            }
            if (status !in 200..299) {
                throw AndroidIdentityLinkException(message = "The server answered $status.")
            }
            return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
