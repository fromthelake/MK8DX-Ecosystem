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

/** Kept apart from the hosted profile; removing it never touches accounts or waiting runs. */
internal object AndroidLanPairingStore {
    private const val preferencesName = "mk8dx_lan_pairing_v1"

    @Volatile private var cached: Pair<AndroidLanPairing, SSLSocketFactory>? = null

    fun load(context: Context): AndroidLanPairing? {
        cached?.let { return it.first }
        val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        val origin = preferences.getString("origin", null) ?: return null
        val spki = preferences.getString("spki", null) ?: return null
        val der = preferences.getString("root", null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        val root = runCatching {
            CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
        }.getOrNull() ?: return null
        if (AndroidLanRoot.spkiSha256(root) != spki) return null
        val pairing = AndroidLanPairing(origin, spki, root)
        cached = pairing to AndroidLanRoot.socketFactory(root)
        return pairing
    }

    fun save(context: Context, origin: String, spkiSha256: String, root: X509Certificate): Boolean {
        val ok = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).edit()
            .putString("origin", origin)
            .putString("spki", spkiSha256)
            .putString("root", Base64.encodeToString(root.encoded, Base64.NO_WRAP))
            .commit()
        cached = null
        return ok
    }

    fun forget(context: Context) {
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).edit().clear().commit()
        cached = null
    }

    fun socketFactoryFor(context: Context, origin: String): SSLSocketFactory? {
        val pairing = load(context) ?: return null
        return if (pairing.origin == origin) cached?.second else null
    }
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
