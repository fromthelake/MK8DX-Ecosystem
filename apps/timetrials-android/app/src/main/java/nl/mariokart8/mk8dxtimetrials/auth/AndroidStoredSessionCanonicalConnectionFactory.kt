package nl.mariokart8.mk8dxtimetrials.auth

import java.net.URL
import javax.net.ssl.HttpsURLConnection
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidAuthenticatedHttpsConnectionFactory

/**
 * Authenticates as exactly one remembered account. The slot is fixed at
 * construction so a request can never pick up whichever account happens to be
 * active when it is sent.
 */
internal class AndroidSlotBoundSessionCanonicalConnectionFactory(
    private val slotId: String,
    private val store: AndroidNativeSessionStore,
    private val opener: AndroidHttpsConnectionOpener,
    private val clock: () -> Long = System::currentTimeMillis,
) : AndroidAuthenticatedHttpsConnectionFactory {
    init {
        require(isAndroidSessionSlotId(slotId)) {
            "Android session slot is invalid."
        }
    }

    override fun open(url: URL): HttpsURLConnection {
        val session = store.load(slotId, clock())
            ?: throw AndroidAuthenticationException("Android authentication is required.")
        return opener.open(url).also { connection ->
            connection.setRequestProperty(
                "Authorization",
                "Bearer ${session.bearerToken}",
            )
        }
    }
}
