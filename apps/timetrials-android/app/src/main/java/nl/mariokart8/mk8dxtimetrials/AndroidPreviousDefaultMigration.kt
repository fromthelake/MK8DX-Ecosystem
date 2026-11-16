package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import java.io.File
import java.util.UUID
import nl.mariokart8.mk8dxtimetrials.auth.ANDROID_SESSION_PREFERENCES_NAME
import nl.mariokart8.mk8dxtimetrials.auth.isAndroidSessionSlotId
import nl.mariokart8.mk8dxtimetrials.lan.AndroidLanPairingStore
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY

private const val migrationPreferences = "mk8dx_packaged_default_migration_v1"
private const val packagedOriginKey = "packaged_origin"
private const val maxAccounts = 16
private const val accountDeviceSlot = "slot.00000000000000000000000000000000"
private val outboxEntryName = Regex("^[0-9a-f]{64}$")
private val evidenceName = Regex("^[0-9a-f]{64}\\.json$")

/**
 * The previous APK's packaged default used unsuffixed storage. A different
 * packaged default must not turn those records into another community's data.
 * Copy only when a recorded origin, or the sole non-LAN remembered community,
 * identifies the old default. The source remains untouched for recovery.
 */
internal object AndroidPreviousDefaultMigration {
    fun run(context: Context) {
        runCatching { migrate(context) }
    }

    private fun migrate(context: Context) {
        val app = context.applicationContext
        val packaged = BuildConfig.MK8DX_API_ORIGIN
        val marker = app.getSharedPreferences(migrationPreferences, Context.MODE_PRIVATE)
        val previous = marker.getString(packagedOriginKey, null)
        val legacySession = app.getSharedPreferences(ANDROID_SESSION_PREFERENCES_NAME, Context.MODE_PRIVATE)
        val hasLegacyData = legacySession.contains("slots") ||
            File(app.filesDir, ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY).listFiles()?.isNotEmpty() == true ||
            File(app.noBackupFilesDir, ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY).listFiles()?.isNotEmpty() == true

        if (!hasLegacyData) {
            marker.edit().putString(packagedOriginKey, packaged).commit()
            return
        }
        val communities = AndroidCommunities.list(app).map { it.origin }
        val candidate = previousDefaultCandidate(
            packaged = packaged,
            previous = previous,
            remembered = communities,
            isLan = { AndroidLanPairingStore.loadFor(app, it) != null },
        ) ?: return
        if (candidate == packaged) {
            marker.edit().putString(packagedOriginKey, packaged).commit()
            return
        }
        val suffix = "_" + AndroidServerOrigin.namespaceOf(candidate)
        // A failed copy leaves the old files and the marker as they were. The
        // next start can retry without replacing newer namespaced records.
        runCatching {
            migrateSessionPreferences(
                legacySession,
                app.getSharedPreferences(ANDROID_SESSION_PREFERENCES_NAME + suffix, Context.MODE_PRIVATE),
            )
            copyMissingChildren(
                File(app.filesDir, ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY),
                File(app.filesDir, ANDROID_PRODUCT_CANONICAL_OUTBOX_DIRECTORY + suffix),
                outboxEntryName,
            )
            copyMissingChildren(
                File(app.noBackupFilesDir, ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY),
                File(app.noBackupFilesDir, ANDROID_PRODUCT_PRIVATE_EVIDENCE_DIRECTORY + suffix),
                evidenceName,
            )
            copyMissingFile(app.filesDir, "time-trial-offline-copy-v1.json", suffix)
            check(marker.edit().putString(packagedOriginKey, packaged).commit())
        }
    }
}

internal fun previousDefaultCandidate(
    packaged: String,
    previous: String?,
    remembered: List<String>,
    isLan: (String) -> Boolean,
): String? {
    val valid = remembered.filter { AndroidServerOrigin.validate(it, allowLoopbackPort = true) == it }
    if (previous == packaged) return packaged
    if (previous != null) return previous.takeIf { it in valid }
    if (packaged != "https://example.invalid" && packaged in valid) return packaged
    // Old builds did not record their packaged origin. A single online
    // community is a safe inference even when several LAN installs are listed.
    return valid.filter { it != packaged && !isLan(it) }.singleOrNull()
}

/** Merge opaque encrypted slot pairs; never expose or overwrite a newer credential. */
internal fun legacySessionPreferenceWrites(source: Map<String, *>, target: Map<String, *>): Map<String, String> {
    val oldSlots = (source["slots"] as? String).orEmpty().split(',').filter(::isAndroidSessionSlotId).distinct()
    val newSlots = (target["slots"] as? String).orEmpty().split(',').filter(::isAndroidSessionSlotId).distinct()
    val merged = newSlots.toMutableList()
    val writes = mutableMapOf<String, String>()
    for (slot in oldSlots) {
        if (slot in merged || merged.size >= maxAccounts) continue
        val labelKeys = listOf("ciphertext.label.$slot", "iv.label.$slot")
        if (labelKeys.any { source[it] !is String }) continue
        for (purpose in listOf("session", "label")) {
            val keys = listOf("ciphertext.$purpose.$slot", "iv.$purpose.$slot")
            if (keys.all { source[it] is String }) {
                keys.forEach { writes[it] = source[it] as String }
            }
        }
        merged += slot
    }
    if (merged != newSlots) writes["slots"] = merged.joinToString(",")
    val oldActive = source["active"] as? String
    if (target["active"] == null && oldActive != null && oldActive in merged) writes["active"] = oldActive
    val deviceKeys = listOf("ciphertext.device.$accountDeviceSlot", "iv.device.$accountDeviceSlot")
    if (deviceKeys.all { source[it] is String && target[it] == null }) {
        deviceKeys.forEach { writes[it] = source[it] as String }
    }
    return writes
}

fun migrateSessionPreferences(source: android.content.SharedPreferences, target: android.content.SharedPreferences) {
    val writes = legacySessionPreferenceWrites(source.all, target.all)
    if (writes.isEmpty()) return
    val editor = target.edit()
    writes.forEach { (key, value) -> editor.putString(key, value) }
    check(editor.commit())
}

/** Only complete missing entries become visible; existing destination entries win. */
internal fun copyMissingChildren(source: File, target: File, allowed: Regex) {
    if (!source.isDirectory) return
    check(target.isDirectory || target.mkdirs())
    for (child in source.listFiles() ?: error("Cannot read old outbox")) {
        if (!allowed.matches(child.name)) continue
        copyMissing(child, File(target, child.name))
    }
}

private fun copyMissingFile(root: File, name: String, suffix: String) {
    val source = File(root, name)
    if (!source.isFile) return
    val destination = File(root, name.removeSuffix(".json") + suffix + ".json")
    copyMissing(source, destination)
}

private fun copyMissing(source: File, target: File) {
    if (target.exists()) return
    val staged = File(target.parentFile, ".${target.name}.migration-${UUID.randomUUID()}")
    try {
        if (source.isDirectory) check(source.copyRecursively(staged, overwrite = false))
        else source.copyTo(staged, overwrite = false)
        if (!staged.renameTo(target) && !target.exists()) error("Cannot finish old data copy")
    } finally {
        if (staged.exists()) staged.deleteRecursively()
    }
}
