package nl.mariokart8.mk8dxtimetrials.lan

import android.content.Context
import android.util.Base64
import java.io.ByteArrayInputStream
import java.net.URL
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/** The one confirmed LAN installation: its exact origin and the root it was paired with. */
internal data class AndroidLanPairing(val origin: String, val spkiSha256: String, val root: X509Certificate)

/**
 * Kept apart from the hosted profile; removing it never touches accounts or waiting runs.
 *
 * ADR-0225: one pairing per origin, so a phone that knows two A2 installations keeps each one's own root and
 * switching between them needs no new pairing. The single pairing of earlier builds (keys origin/spki/root) is
 * read as the first entry and stays where it is.
 */
internal object AndroidLanPairingStore {
    private const val preferencesName = "mk8dx_lan_pairing_v1"
    private const val pairingPrefix = "pairing:"
    private const val lastKey = "last_origin"

    @Volatile private var cached: Map<String, Pair<AndroidLanPairing, SSLSocketFactory>>? = null

    private fun all(context: Context): Map<String, Pair<AndroidLanPairing, SSLSocketFactory>> {
        cached?.let { return it }
        val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        val found = linkedMapOf<String, Pair<AndroidLanPairing, SSLSocketFactory>>()
        fun read(origin: String?, spki: String?, encoded: String?) {
            if (origin == null || spki == null || encoded == null || origin in found) return
            val der = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull() ?: return
            val root = runCatching {
                CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
            }.getOrNull() ?: return
            if (AndroidLanRoot.spkiSha256(root) != spki) return
            found[origin] = AndroidLanPairing(origin, spki, root) to AndroidLanRoot.socketFactory(root)
        }
        read(preferences.getString("origin", null), preferences.getString("spki", null), preferences.getString("root", null))
        preferences.all.keys.filter { it.startsWith(pairingPrefix) }.sorted().forEach { key ->
            val value = preferences.getString(key, null)?.split('|') ?: return@forEach
            if (value.size == 2) read(key.removePrefix(pairingPrefix), value[0], value[1])
        }
        cached = found
        return found
    }

    /** The pairing made last, which the first-start screen shows. */
    fun load(context: Context): AndroidLanPairing? {
        val pairings = all(context)
        val last = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).getString(lastKey, null)
        return (last?.let { pairings[it] } ?: pairings.values.lastOrNull())?.first
    }

    fun loadFor(context: Context, origin: String): AndroidLanPairing? = all(context)[origin]?.first

    fun save(context: Context, origin: String, spkiSha256: String, root: X509Certificate): Boolean {
        val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        val editor = preferences.edit()
            .putString(pairingPrefix + origin, spkiSha256 + "|" + Base64.encodeToString(root.encoded, Base64.NO_WRAP))
            .putString(lastKey, origin)
        // A new root for the origin of the old single pairing replaces that one too.
        if (preferences.getString("origin", null) == origin) editor.remove("origin").remove("spki").remove("root")
        val ok = editor.commit()
        cached = null
        return ok
    }

    /** Forgets the pairing the first-start screen shows (the one made last). */
    fun forget(context: Context) {
        load(context)?.let { forget(context, it.origin) }
    }

    fun forget(context: Context, origin: String) {
        val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        val editor = preferences.edit().remove(pairingPrefix + origin)
        if (preferences.getString("origin", null) == origin) editor.remove("origin").remove("spki").remove("root")
        if (preferences.getString(lastKey, null) == origin) editor.remove(lastKey)
        editor.commit()
        cached = null
    }

    fun socketFactoryFor(context: Context, origin: String): SSLSocketFactory? = all(context)[origin]?.second
}

/**
 * Every HTTPS connection the app opens goes through here (ADR-0223 decision 8). A URL on the
 * paired LAN origin trusts only that installation's root; every other URL keeps system trust.
 */
internal object AndroidOriginTrust {
    fun originOf(url: URL): String =
        "${url.protocol}://${url.host}" + if (url.port == -1 || url.port == url.defaultPort) "" else ":${url.port}"

    fun open(context: Context, url: URL): HttpsURLConnection {
        val connection = url.openConnection() as HttpsURLConnection
        AndroidLanPairingStore.socketFactoryFor(context.applicationContext, originOf(url))
            ?.let { connection.sslSocketFactory = it }
        return connection
    }
}
