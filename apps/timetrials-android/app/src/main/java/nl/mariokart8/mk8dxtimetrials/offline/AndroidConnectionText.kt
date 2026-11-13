package nl.mariokart8.mk8dxtimetrials.offline

import java.io.IOException
import java.net.URI
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Whether [error] means the community could not be reached at all (no network, refused, timed out, TLS), as
 * opposed to an answer it gave. Such errors carry the platform's own wording ("Failed to connect to
 * /host:443"), which is never shown to a person.
 */
internal fun Throwable.isConnectionFailure(): Boolean =
    generateSequence(this) { it.cause }.take(8).any { it is IOException }

/** The host a person recognises from the community's origin. */
internal fun androidCommunityHost(origin: String): String =
    runCatching { URI(origin).host }.getOrNull()?.takeIf { it.isNotBlank() } ?: origin

/**
 * "No connection to {host}." and, when this phone has a copy to show, "Showing what this phone saved."
 */
internal fun androidNoConnectionText(language: AndroidProductLanguage, origin: String, showingCopy: Boolean): String {
    val host = androidCommunityHost(origin)
    return if (showingCopy) {
        androidText(language, "No connection to $host. Showing what this phone saved.",
            "Geen verbinding met $host. Je ziet wat deze telefoon heeft bewaard.")
    } else {
        androidText(language, "No connection to $host.", "Geen verbinding met $host.")
    }
}

/** The text for a failed read: the plain connection sentence, or [otherwise] for an answer the community gave. */
internal fun androidFailureText(
    error: Throwable,
    language: AndroidProductLanguage,
    origin: String,
    showingCopy: Boolean,
    otherwise: String,
): String = if (error.isConnectionFailure()) androidNoConnectionText(language, origin, showingCopy) else otherwise
