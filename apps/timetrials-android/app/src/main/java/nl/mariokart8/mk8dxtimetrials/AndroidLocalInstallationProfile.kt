package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import java.util.UUID

private const val profilePreferences = "mk8dx_timetrials_local_profile_v1"
private const val profileKey = "installation_profile_id"
private val profilePattern = Regex(
    "^android\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
)

internal class AndroidLocalInstallationProfile(context: Context) {
    private val preferences = context.getSharedPreferences(
        profilePreferences,
        Context.MODE_PRIVATE,
    )

    fun loadOrCreate(): String {
        val existing = preferences.getString(profileKey, null)
        if (existing != null && existing.matches(profilePattern)) return existing
        val created = "android.${UUID.randomUUID()}"
        check(created.matches(profilePattern))
        check(preferences.edit().putString(profileKey, created).commit())
        return created
    }
}
