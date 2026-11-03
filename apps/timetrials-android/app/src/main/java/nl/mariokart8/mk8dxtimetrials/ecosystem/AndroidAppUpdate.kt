package nl.mariokart8.mk8dxtimetrials.ecosystem

private val releaseBuildPattern = Regex("^(.+)-build([1-9][0-9]*)$")

internal data class AndroidAvailableAppUpdate(
    val version: String,
    val releasedOn: String,
    val versionCode: Int,
)

internal fun AndroidAppRelease.availableAfter(currentVersionCode: Int): AndroidAvailableAppUpdate? {
    require(currentVersionCode >= 1)
    val matched = releaseBuildPattern.matchEntire(version) ?: return null
    val versionCode = matched.groupValues[2].toIntOrNull() ?: return null
    if (versionCode <= currentVersionCode) return null
    return AndroidAvailableAppUpdate(
        version = matched.groupValues[1],
        releasedOn = releasedOn,
        versionCode = versionCode,
    )
}
