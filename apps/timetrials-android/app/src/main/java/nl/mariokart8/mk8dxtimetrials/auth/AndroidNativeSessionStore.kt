package nl.mariokart8.mk8dxtimetrials.auth

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import nl.mariokart8.mk8dxtimetrials.AndroidServerOrigin

private const val keyAlias = "mk8dx_timetrials_auth_session_v2"
private const val preferencesName = "mk8dx_timetrials_private_auth_session_v2"
private const val legacyKeyAlias = "mk8dx_timetrials_auth_session_v1"
private const val legacyPreferencesName = "mk8dx_timetrials_private_auth_session_v1"
private const val legacyCiphertextKey = "ciphertext"
private const val legacyIvKey = "iv"
private const val slotIndexKey = "slots"
private const val activeSlotKey = "active"
private const val ciphertextPrefix = "ciphertext."
private const val ivPrefix = "iv."

internal const val ANDROID_SESSION_VAULT_PURPOSE_SESSION = "session"
internal const val ANDROID_SESSION_VAULT_PURPOSE_LABEL = "label"

private const val MAX_REMEMBERED_ACCOUNTS = 16
private val legacyAdditionalData =
    "mk8dx.android.auth-session.v1".toByteArray(Charsets.US_ASCII)
private val storedTokenPattern = Regex("^[A-Za-z0-9_-]{20,255}$")
private val storedPlayerPattern = Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
private val sessionSlotIdPattern = Regex("^slot\\.[0-9a-f]{32}$")
private val vaultPurposePattern = Regex("^[a-z]{1,16}$")

/**
 * One remembered account. Never carries a bearer token: the account list is
 * rendered by ordinary UI code that has no business holding credentials.
 */
internal data class AndroidRememberedAccount(
    val slotId: String,
    val playerId: String,
    val expired: Boolean,
    /** Public display name, when a v2-bootstrap session stored it. */
    val displayName: String? = null,
)

internal interface AndroidNativeSessionStore {
    fun list(nowMs: Long): List<AndroidRememberedAccount>
    fun load(slotId: String, nowMs: Long): AndroidAuthenticatedNativeSession?
    fun save(slotId: String, session: AndroidAuthenticatedNativeSession)
    fun remove(slotId: String)
    fun activeSlotId(): String?
    fun setActiveSlotId(slotId: String?)
}

/**
 * Slot ids are derived from the player id so one Player re-authorizing keeps the
 * slot its already-stored outbox entries were bound to, and so the plaintext
 * slot index never reveals who is signed in on this device.
 */
internal fun androidSessionSlotId(playerId: String): String {
    require(playerId.length <= 135 && playerId.matches(storedPlayerPattern)) {
        "Android session player id is invalid."
    }
    return "slot." + sha256Hex(playerId.toByteArray(Charsets.UTF_8)).take(32)
}

internal fun isAndroidSessionSlotId(value: String): Boolean =
    value.matches(sessionSlotIdPattern)

/** Encrypted per-slot storage. One record per (slot, purpose). */
internal interface AndroidSessionSecretVault {
    fun read(slotId: String, purpose: String): String?
    fun write(slotId: String, purpose: String, plaintext: String)
    fun erase(slotId: String, purpose: String)
}

/** Plaintext slot bookkeeping: opaque slot ids plus the active selection. */
internal interface AndroidSessionSlotDirectory {
    fun slotIds(): List<String>
    fun addSlotId(slotId: String)
    fun removeSlotId(slotId: String)
    fun activeSlotId(): String?
    fun setActiveSlotId(slotId: String?)
}

/** The single-slot v1 record, read once so an upgrade does not sign the user out. */
internal interface AndroidLegacySingleSessionSource {
    fun readLegacySession(): AndroidAuthenticatedNativeSession?
    fun discardLegacySession()
}

internal object AndroidAbsentLegacySingleSessionSource : AndroidLegacySingleSessionSource {
    override fun readLegacySession(): AndroidAuthenticatedNativeSession? = null
    override fun discardLegacySession() = Unit
}

internal class AndroidSlottedNativeSessionStore(
    private val directory: AndroidSessionSlotDirectory,
    private val vault: AndroidSessionSecretVault,
    legacy: AndroidLegacySingleSessionSource = AndroidAbsentLegacySingleSessionSource,
) : AndroidNativeSessionStore {
    init {
        migrateLegacySlot(legacy)
    }

    override fun list(nowMs: Long): List<AndroidRememberedAccount> {
        require(nowMs >= 0)
        return directory.slotIds().mapNotNull { slotId ->
            val label = rememberedLabel(slotId) ?: return@mapNotNull null
            AndroidRememberedAccount(
                slotId = slotId,
                playerId = label.first,
                expired = load(slotId, nowMs) == null,
                displayName = label.second,
            )
        }
    }

    override fun load(slotId: String, nowMs: Long): AndroidAuthenticatedNativeSession? {
        require(nowMs >= 0)
        if (!isAndroidSessionSlotId(slotId)) return null
        val plaintext = readVault(slotId, ANDROID_SESSION_VAULT_PURPOSE_SESSION) ?: return null
        val fields = plaintext.split('\n')
        // Three fields is the pre-identity record written by older builds;
        // five carries the v2 public identity. Anything else is corrupt.
        if (fields.size != 3 && fields.size != 5) return forgetSessionSecret(slotId)
        val expiresAtMs = fields[1].toLongOrNull() ?: return forgetSessionSecret(slotId)
        val session = AndroidAuthenticatedNativeSession(
            fields[0],
            expiresAtMs,
            fields[2],
            username = fields.getOrNull(3)?.takeIf { it.isNotEmpty() },
            displayName = fields.getOrNull(4)?.takeIf { it.isNotEmpty() },
        )
        if (
            !valid(session) ||
            androidSessionSlotIdOrNull(session.playerId) != slotId ||
            expiresAtMs <= nowMs
        ) {
            return forgetSessionSecret(slotId)
        }
        return session
    }

    override fun save(slotId: String, session: AndroidAuthenticatedNativeSession) {
        require(valid(session))
        require(slotId == androidSessionSlotId(session.playerId)) {
            "Android session slot does not belong to this player."
        }
        require(
            directory.slotIds().let { it.size < MAX_REMEMBERED_ACCOUNTS || slotId in it },
        ) {
            "Android remembered account limit was reached."
        }
        vault.write(
            slotId,
            ANDROID_SESSION_VAULT_PURPOSE_SESSION,
            listOf(
                session.bearerToken,
                session.expiresAtMs.toString(),
                session.playerId,
                session.username ?: "",
                session.displayName ?: "",
            ).joinToString("\n"),
        )
        // The label outlives the credential so an expired account can still be
        // listed as "sign in again", by name, next to the entries it owns.
        vault.write(
            slotId,
            ANDROID_SESSION_VAULT_PURPOSE_LABEL,
            listOfNotNull(session.playerId, session.displayName).joinToString("\n"),
        )
        directory.addSlotId(slotId)
    }

    override fun remove(slotId: String) {
        if (!isAndroidSessionSlotId(slotId)) return
        eraseVault(slotId, ANDROID_SESSION_VAULT_PURPOSE_SESSION)
        eraseVault(slotId, ANDROID_SESSION_VAULT_PURPOSE_LABEL)
        directory.removeSlotId(slotId)
        if (directory.activeSlotId() == slotId) directory.setActiveSlotId(null)
    }

    override fun activeSlotId(): String? = directory.activeSlotId()
        ?.takeIf { isAndroidSessionSlotId(it) && it in directory.slotIds() }

    override fun setActiveSlotId(slotId: String?) {
        if (slotId == null) {
            directory.setActiveSlotId(null)
            return
        }
        if (!isAndroidSessionSlotId(slotId) || slotId !in directory.slotIds()) return
        directory.setActiveSlotId(slotId)
    }

    private fun rememberedPlayerId(slotId: String): String? =
        rememberedLabel(slotId)?.first

    /** Pre-identity labels are just the player id; v2 labels add the name. */
    private fun rememberedLabel(slotId: String): Pair<String, String?>? {
        val lines = readVault(slotId, ANDROID_SESSION_VAULT_PURPOSE_LABEL)
            ?.split('\n')
            ?: return null
        if (lines.isEmpty() || lines.size > 2) return null
        val playerId = lines[0]
        if (androidSessionSlotIdOrNull(playerId) != slotId) return null
        val displayName = lines.getOrNull(1)
            ?.takeIf { it.isNotEmpty() && validDisplayName(it) }
        return playerId to displayName
    }

    private fun forgetSessionSecret(slotId: String): AndroidAuthenticatedNativeSession? {
        // Only this slot's credential is dropped. A shared phone must not lose
        // the other account's session because one of them expired.
        eraseVault(slotId, ANDROID_SESSION_VAULT_PURPOSE_SESSION)
        return null
    }

    private fun readVault(slotId: String, purpose: String): String? = try {
        vault.read(slotId, purpose)
    } catch (_: Exception) {
        null
    }

    private fun eraseVault(slotId: String, purpose: String) {
        try {
            vault.erase(slotId, purpose)
        } catch (_: Exception) {
            // Best effort: an unreadable record is already unusable.
        }
    }

    private fun migrateLegacySlot(legacy: AndroidLegacySingleSessionSource) {
        try {
            val session = legacy.readLegacySession()
            if (session != null && valid(session)) {
                val slotId = androidSessionSlotId(session.playerId)
                if (rememberedPlayerId(slotId) == null) {
                    save(slotId, session)
                    if (activeSlotId() == null) setActiveSlotId(slotId)
                }
            }
            legacy.discardLegacySession()
        } catch (_: Exception) {
            // Migration is best effort: a broken v1 record must never make the
            // multi-account store unusable.
        }
    }
}

internal class AndroidKeystoreNativeSessionStore private constructor(
    delegate: AndroidNativeSessionStore,
) : AndroidNativeSessionStore by delegate {
    constructor(context: Context) : this(
        AndroidSlottedNativeSessionStore(
            directory = AndroidPreferencesSessionSlotDirectory(preferences(context)),
            vault = AndroidKeystoreSessionSecretVault(preferences(context)),
            legacy = if (AndroidServerOrigin.usesPackagedDefault(context)) AndroidKeystoreLegacySingleSessionSource(context)
                     else AndroidAbsentLegacySingleSessionSource,
        ),
    )
}

private fun preferences(context: Context): SharedPreferences =
    context.getSharedPreferences(
        if (AndroidServerOrigin.usesPackagedDefault(context)) preferencesName
        else preferencesName + "_" + AndroidServerOrigin.namespace(context),
        Context.MODE_PRIVATE,
    )

private class AndroidPreferencesSessionSlotDirectory(
    private val preferences: SharedPreferences,
) : AndroidSessionSlotDirectory {
    override fun slotIds(): List<String> = preferences.getString(slotIndexKey, null)
        ?.split(',')
        ?.filter(::isAndroidSessionSlotId)
        ?.distinct()
        ?: emptyList()

    override fun addSlotId(slotId: String) {
        val current = slotIds()
        if (slotId in current) return
        commit(slotIndexKey, (current + slotId).joinToString(","))
    }

    override fun removeSlotId(slotId: String) {
        val remaining = slotIds().filterNot { it == slotId }
        commit(slotIndexKey, remaining.takeIf { it.isNotEmpty() }?.joinToString(","))
    }

    override fun activeSlotId(): String? =
        preferences.getString(activeSlotKey, null)?.takeIf(::isAndroidSessionSlotId)

    override fun setActiveSlotId(slotId: String?) {
        commit(activeSlotKey, slotId)
    }

    private fun commit(key: String, value: String?) {
        val editor = preferences.edit()
        if (value == null) editor.remove(key) else editor.putString(key, value)
        check(editor.commit())
    }
}

private class AndroidKeystoreSessionSecretVault(
    private val preferences: SharedPreferences,
) : AndroidSessionSecretVault {
    override fun read(slotId: String, purpose: String): String? {
        requireVaultAddress(slotId, purpose)
        val encodedCiphertext = preferences.getString(ciphertextKey(slotId, purpose), null)
            ?: return null
        val encodedIv = preferences.getString(ivKey(slotId, purpose), null)
            ?: return eraseAndNull(slotId, purpose)
        return try {
            val key = existingKey(keyAlias) ?: return eraseAndNull(slotId, purpose)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP)),
            )
            cipher.updateAAD(additionalData(slotId, purpose))
            cipher.doFinal(
                Base64.decode(encodedCiphertext, Base64.NO_WRAP),
            ).toString(Charsets.UTF_8)
        } catch (_: Exception) {
            eraseAndNull(slotId, purpose)
        }
    }

    override fun write(slotId: String, purpose: String, plaintext: String) {
        requireVaultAddress(slotId, purpose)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        cipher.updateAAD(additionalData(slotId, purpose))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        check(
            preferences.edit()
                .putString(
                    ciphertextKey(slotId, purpose),
                    Base64.encodeToString(ciphertext, Base64.NO_WRAP),
                )
                .putString(
                    ivKey(slotId, purpose),
                    Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
                )
                .commit(),
        )
    }

    override fun erase(slotId: String, purpose: String) {
        requireVaultAddress(slotId, purpose)
        preferences.edit()
            .remove(ciphertextKey(slotId, purpose))
            .remove(ivKey(slotId, purpose))
            .commit()
    }

    private fun eraseAndNull(slotId: String, purpose: String): String? {
        erase(slotId, purpose)
        return null
    }
}

private class AndroidKeystoreLegacySingleSessionSource(
    private val context: Context,
) : AndroidLegacySingleSessionSource {
    override fun readLegacySession(): AndroidAuthenticatedNativeSession? = try {
        val preferences = legacyPreferences()
        val encodedCiphertext = preferences.getString(legacyCiphertextKey, null)
        val encodedIv = preferences.getString(legacyIvKey, null)
        val key = existingKey(legacyKeyAlias)
        if (encodedCiphertext == null || encodedIv == null || key == null) {
            null
        } else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP)),
            )
            cipher.updateAAD(legacyAdditionalData)
            val fields = cipher.doFinal(
                Base64.decode(encodedCiphertext, Base64.NO_WRAP),
            ).toString(Charsets.UTF_8).split('\n')
            fields.takeIf { it.size == 3 }?.let { parts ->
                parts[1].toLongOrNull()?.let { expiresAtMs ->
                    AndroidAuthenticatedNativeSession(parts[0], expiresAtMs, parts[2])
                }
            }
        }
    } catch (_: Exception) {
        null
    }

    override fun discardLegacySession() {
        try {
            legacyPreferences().edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .deleteEntry(legacyKeyAlias)
        } catch (_: Exception) {
            // Best effort: leftover v1 material is unreachable once v2 is in use.
        }
    }

    private fun legacyPreferences(): SharedPreferences =
        context.getSharedPreferences(legacyPreferencesName, Context.MODE_PRIVATE)
}

private fun requireVaultAddress(slotId: String, purpose: String) {
    require(isAndroidSessionSlotId(slotId) && purpose.matches(vaultPurposePattern))
}

private fun ciphertextKey(slotId: String, purpose: String): String =
    "$ciphertextPrefix$purpose.$slotId"

private fun ivKey(slotId: String, purpose: String): String = "$ivPrefix$purpose.$slotId"

/**
 * The slot and purpose are authenticated so a ciphertext copied between accounts
 * or between record kinds fails to decrypt instead of impersonating the other.
 */
private fun additionalData(slotId: String, purpose: String): ByteArray =
    "mk8dx.android.auth-session.v2\n$purpose\n$slotId".toByteArray(Charsets.US_ASCII)

private fun existingKey(alias: String): SecretKey? {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    return keyStore.getKey(alias, null) as? SecretKey
}

private fun getOrCreateKey(): SecretKey = existingKey(keyAlias) ?: run {
    val generator = KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        "AndroidKeyStore",
    )
    generator.init(
        KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(false)
            .build(),
    )
    generator.generateKey()
}

private fun androidSessionSlotIdOrNull(playerId: String): String? = try {
    androidSessionSlotId(playerId)
} catch (_: Exception) {
    null
}

private val storedUsernamePattern = Regex("^[a-z0-9_-]{3,16}$")

private fun validDisplayName(value: String): Boolean =
    value.length in 1..64 && value.none { it.code < 0x20 || it.code == 0x7f }

private fun valid(session: AndroidAuthenticatedNativeSession): Boolean =
    session.bearerToken.matches(storedTokenPattern) &&
        session.expiresAtMs in 1..253_402_300_799_999L &&
        session.playerId.length <= 135 && session.playerId.matches(storedPlayerPattern) &&
        (session.username == null || session.username.matches(storedUsernamePattern)) &&
        (session.displayName == null || validDisplayName(session.displayName))

private fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { "%02x".format(it) }
