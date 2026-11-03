package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.content.Context

/**
 * Whether this build of the app may still be used.
 *
 * The owner turns a build off in the hosted download manifest; the server
 * publishes the numbers and its own verdict at `/v1/public/client-support`,
 * without a session, because a Player whose build has been retired must be
 * able to learn that without signing in first.
 *
 * Two rules that matter more than the feature itself:
 *
 * 1. **Silence never blocks.** No network, an unreadable answer, a server that
 *    is down: the app carries on. Time Trials are local-first and a phone in a
 *    living room with bad wifi is not a phone that should stop working.
 *
 * 2. **A definite verdict is remembered.** Once the server has said this build
 *    is retired, turning off the wifi does not undo it. A later definite
 *    verdict replaces it, so the owner can also let a build back in.
 */
internal data class AndroidClientSupport(
    val currentVersion: String,
    val currentBuild: Int?,
    val minimumSupportedBuild: Int,
    val retiredBuilds: List<Int>,
    val downloadPagePath: String,
    val message: String?,
)

internal fun AndroidClientSupport.retires(versionCode: Int): Boolean {
    require(versionCode >= 1)
    return versionCode < minimumSupportedBuild || retiredBuilds.contains(versionCode)
}

/** What the block screen has to say, once something has decided to say it. */
internal data class AndroidRetiredBuild(
    val installedVersionName: String,
    val installedBuild: Int,
    val currentVersion: String,
    val downloadPagePath: String,
    val message: String?,
)

/**
 * The last definite verdict, so a retired build cannot be un-retired by going
 * offline. Only ever written from an answer the server actually gave.
 */
internal object AndroidClientSupportStore {
    private const val PREFERENCES = "mk8_prefs"
    private const val RETIRED_BUILD = "client_support_retired_build"
    private const val RETIRED_CURRENT = "client_support_current_version"
    private const val RETIRED_MESSAGE = "client_support_message"
    private const val RETIRED_PAGE = "client_support_download_page"
    private const val DEFAULT_PAGE = "/?apps=1"

    fun remembered(context: Context, versionCode: Int): AndroidRetiredBuild? {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        if (preferences.getInt(RETIRED_BUILD, 0) != versionCode) return null
        return AndroidRetiredBuild(
            installedVersionName = "",
            installedBuild = versionCode,
            currentVersion = preferences.getString(RETIRED_CURRENT, null) ?: "",
            downloadPagePath = preferences.getString(RETIRED_PAGE, null) ?: DEFAULT_PAGE,
            message = preferences.getString(RETIRED_MESSAGE, null),
        )
    }

    fun remember(context: Context, versionCode: Int, support: AndroidClientSupport) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .putInt(RETIRED_BUILD, versionCode)
            .putString(RETIRED_CURRENT, support.currentVersion)
            .putString(RETIRED_MESSAGE, support.message)
            .putString(RETIRED_PAGE, support.downloadPagePath)
            .apply()
    }

    fun forget(context: Context) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .remove(RETIRED_BUILD)
            .remove(RETIRED_CURRENT)
            .remove(RETIRED_MESSAGE)
            .remove(RETIRED_PAGE)
            .apply()
    }
}
