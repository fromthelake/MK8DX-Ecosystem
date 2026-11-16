package nl.mariokart8.mk8dxtimetrials.lan

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import java.net.URI
import java.security.KeyStore
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** Per installation: whether the onboarding steps were completed. "Later" lasts until the app starts again. */
internal object AndroidLanOnboardingStore {
    private const val preferencesName = "mk8dx_lan_onboarding_v1"
    private val laterThisStart = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun completed(context: Context, origin: String): Boolean =
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).getBoolean("completed:$origin", false)

    fun markCompleted(context: Context, origin: String) {
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).edit()
            .putBoolean("completed:$origin", true).apply()
    }

    fun later(origin: String) { laterThisStart += origin }

    fun isLater(origin: String): Boolean = origin in laterThisStart
}

internal sealed interface AndroidCertificateSaveResult {
    data class Saved(val fileName: String) : AndroidCertificateSaveResult
    data object Failed : AndroidCertificateSaveResult
}

/**
 * Saves the root this app already pinned (DER, as Android's CA installer expects) to Downloads. The same name
 * on the same day replaces the earlier copy instead of adding "root (5).crt".
 */
internal object AndroidLanCertificateSaver {
    const val MIME_TYPE = "application/x-x509-ca-cert"

    fun save(context: Context, root: X509Certificate, fileName: String): AndroidCertificateSaveResult {
        val der = root.encoded
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveMediaStore(context, der, fileName)
            else saveLegacy(context, der, fileName)
            AndroidCertificateSaveResult.Saved(fileName)
        } catch (error: Exception) {
            android.util.Log.w("MK8DXLanTrust", "certificate not saved: ${error.javaClass.simpleName}")
            AndroidCertificateSaveResult.Failed
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private fun saveMediaStore(context: Context, der: ByteArray, fileName: String) {
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        // Only rows this app inserted are visible to it, so this finds our own earlier copy of today.
        val existing = resolver.query(
            collection,
            arrayOf(MediaStore.Downloads._ID),
            "${MediaStore.Downloads.DISPLAY_NAME}=?",
            arrayOf(fileName),
            null,
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }
        val target: Uri = existing?.let { android.content.ContentUris.withAppendedId(collection, it) }
            ?: resolver.insert(collection, ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, MIME_TYPE)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }) ?: error("no download row")
        resolver.openOutputStream(target, "wt")?.use { it.write(der) } ?: error("no output stream")
        resolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
    }

    /** Before Android 10 (no MediaStore Downloads): the app's own download folder, which needs no permission. */
    private fun saveLegacy(context: Context, der: ByteArray, fileName: String) {
        val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("no storage")
        directory.mkdirs()
        java.io.File(directory, fileName).writeBytes(der)
    }
}

/** Opens the most specific certificate screen this phone has, falling back to its security settings. */
internal object AndroidCertificateSettings {
    /**
     * In order: on Pixel and stock Android "More security & privacy" (Encryption & credentials lives there), then
     * the security settings, then Settings. Android's own certificate installer is deliberately not opened: on Android 11 and later
     * it refuses a CA certificate unless Settings itself started it ("Install CA certificates in Settings",
     * seen on the Android 16 emulator, 2026-11-16).
     */
    fun candidates(brand: AndroidPhoneBrand): List<Intent> =
        // Vivo, Samsung, Xiaomi and OnePlus/OPPO routes start in their security settings; on Pixel and stock
        // Android the certificate entry sits one level deeper, under "More security & privacy".
        (if (brand == AndroidPhoneBrand.Pixel || brand == AndroidPhoneBrand.Generic) {
            listOf(Intent("android.settings.PRIVACY_ADVANCED_SETTINGS"))
        } else emptyList()) + listOf(
            Intent(Settings.ACTION_SECURITY_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )

    fun open(context: Context, brand: AndroidPhoneBrand): Boolean {
        for (intent in candidates(brand)) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (_: ActivityNotFoundException) {
            } catch (_: SecurityException) {
            }
        }
        return false
    }
}

/** The production trust check: the phone's CA store ("AndroidCAStore": system + user CAs), a real handshake. */
internal object AndroidSystemTrustProbe {
    fun create(): AndroidSystemTrustCheck = AndroidSystemTrustCheck(
        trustManager = {
            val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
            TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
                .trustManagers.filterIsInstance<X509TrustManager>().first()
        },
        handshake = { origin: URI, trustManager: X509TrustManager ->
            val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
            val connection = URI(origin.scheme, null, origin.host, origin.port, "/", null, null).toURL()
                .openConnection() as HttpsURLConnection
            try {
                connection.sslSocketFactory = context.socketFactory
                connection.connectTimeout = 6_000
                connection.readTimeout = 6_000
                connection.instanceFollowRedirects = false
                connection.requestMethod = "HEAD"
                connection.connect()
            } finally {
                connection.disconnect()
            }
        },
    )
}
