package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import java.net.URI
import java.security.MessageDigest

/** Only a public HTTPS origin is shared with this client. Server secrets never enter it. */
internal object AndroidServerOrigin {
    private const val preferencesName = "mk8dx_community_origin_v1"

    /** A debug build may also name a port on loopback: the QA mirror's HTTPS front (adb reverse). */
    fun validate(value: String, allowLoopbackPort: Boolean = BuildConfig.DEBUG): String? = try {
        val origin = URI(value.trim())
        val portAllowed = origin.port == -1 ||
            (allowLoopbackPort && origin.host in setOf("127.0.0.1", "localhost") && origin.port in 1..65_535)
        if (origin.scheme != "https" || origin.host.isNullOrBlank() || origin.rawUserInfo != null ||
            origin.rawPath !in setOf("", null) || origin.rawQuery != null || origin.rawFragment != null ||
            !portAllowed || value.trim().endsWith('/')) null else origin.toASCIIString()
    } catch (_: Exception) { null }

    fun current(context: Context): String? {
        val saved = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .getString("origin", null)
        return saved?.let(::validate) ?: BuildConfig.MK8DX_API_ORIGIN.takeUnless { it == "https://example.invalid" }
            ?.let(::validate)
    }

    /**
     * Makes [value] the active community. ADR-0225: it is also remembered in the community list (added when new),
     * so switching back later is one tap. Nothing of the community that was active before is touched.
     */
    fun save(context: Context, value: String): Boolean {
        val origin = validate(value) ?: return false
        // The one that was active until now is remembered too, so an install from before the list existed keeps it.
        AndroidCommunities.list(context)
        val saved = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .edit().putString("origin", origin).commit()
        if (saved) AndroidCommunities.markUsed(context, origin)
        return saved
    }

    /** Keep existing owner sessions and pending runs at their original paths. */
    fun usesPackagedDefault(selected: String?, packaged: String): Boolean {
        val default = packaged.takeUnless { it == "https://example.invalid" }?.let(::validate) ?: return false
        return selected == default
    }

    fun usesPackagedDefault(context: Context): Boolean =
        usesPackagedDefault(current(context), BuildConfig.MK8DX_API_ORIGIN)

    fun namespace(context: Context): String {
        val origin = current(context) ?: return "unconfigured"
        return namespaceOf(origin)
    }

    /** The storage namespace of any origin, active or not (ADR-0225 reads another community's outbox with it). */
    fun namespaceOf(origin: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(origin.toByteArray(Charsets.US_ASCII))
        return bytes.take(12).joinToString("") { "%02x".format(it) }
    }

    /** "" for the packaged default (its storage predates namespaces), otherwise "_" + the namespace. */
    fun storageSuffix(origin: String, packaged: String = BuildConfig.MK8DX_API_ORIGIN): String =
        if (usesPackagedDefault(origin, packaged)) "" else "_" + namespaceOf(origin)
}
