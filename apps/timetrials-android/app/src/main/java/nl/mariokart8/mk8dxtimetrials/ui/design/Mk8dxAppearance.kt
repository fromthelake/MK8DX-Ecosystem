package nl.mariokart8.mk8dxtimetrials.ui.design

import android.app.UiModeManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Density
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat

/**
 * Appearance: the Player's choice, its device cache and the rules that turn it
 * into a rendered appearance.
 *
 * ADR-0205 and DESIGN_SYSTEM.md §19: the *choice* is what a signed-in account
 * keeps, never the resolved mode, so a device on System follows its own OS.
 * High contrast is never stored: it follows the OS and wins over the choice.
 * Text size and reduced motion stay device-local (text-size sync is not an
 * approved decision).
 *
 * Everything here that decides something is a pure function, so the rules are
 * tested without a device.
 */

/** The three choices. `system` is the default and means "follow this device". */
enum class Mk8dxAppearanceChoice(val wireValue: String) {
    System("system"),
    Light("light"),
    Dark("dark"),
    ;

    companion object {
        /** Unknown or absent stays null: "never chosen" is a distinct state (ADR-0205 §2). */
        fun ofWire(value: String?): Mk8dxAppearanceChoice? =
            entries.firstOrNull { it.wireValue == value }
    }
}

/** Device-local text size (§19). 100 % is the product default. */
enum class Mk8dxTextSize(val wireValue: String, val scale: Float) {
    Normal("100", 1f),
    Large("115", 1.15f),
    Largest("130", 1.30f),
    ;

    companion object {
        fun ofWire(value: String?): Mk8dxTextSize = entries.firstOrNull { it.wireValue == value } ?: Normal
    }
}

/** Device-local motion preference (§18/§19); System follows the OS animation scale. */
enum class Mk8dxMotionPreference(val wireValue: String) {
    System("system"),
    Reduced("reduced"),
    ;

    companion object {
        fun ofWire(value: String?): Mk8dxMotionPreference = entries.firstOrNull { it.wireValue == value } ?: System
    }
}

/**
 * The local cache ADR-0205 §2 requires: `{choice, updatedAt, synced}`. A null
 * choice means this device has never been told one, which is not the same as
 * having chosen System.
 */
data class Mk8dxAppearanceCache(
    val choice: Mk8dxAppearanceChoice? = null,
    val updatedAtMs: Long = 0L,
    val synced: Boolean = true,
) {
    /** What to render with when nobody has chosen: see [MK8DX_DEFAULT_APPEARANCE_CHOICE]. */
    val effectiveChoice: Mk8dxAppearanceChoice get() = choice ?: MK8DX_DEFAULT_APPEARANCE_CHOICE
}

/**
 * What the app renders for a Player who has never chosen.
 *
 * ADR-0205 §3 makes **System** the product default, and the web has always
 * defaulted to it. Android held Dark through the migration for one reason: the
 * product screens were dark-only, so following a light phone would have given a
 * light shell over a dark product. Phase 17 removed that reason — every screen
 * now draws from the tokens under `Mk8dxTheme(appearance)`, and the legacy
 * palette is gone — so the default is System, which is also what
 * IMPLEMENTATION_PLAN Phase 16/17 scheduled.
 *
 * A null cache choice still means "never chosen", so nothing is uploaded to
 * the account on its own (ADR-0205 §4). Dark remains the flagship appearance
 * and an explicit choice still wins over the phone.
 */
val MK8DX_DEFAULT_APPEARANCE_CHOICE = Mk8dxAppearanceChoice.System

/** What hydration decided: the cache to keep, and a choice to upload if any. */
data class Mk8dxAppearanceHydration(
    val cache: Mk8dxAppearanceCache,
    val upload: Mk8dxAppearanceChoice? = null,
)

/**
 * ADR-0205 §4, exactly:
 *
 * - the account value is canonical;
 * - an **unsynced explicit local change newer than the last hydration** is sent
 *   instead (last explicit change wins);
 * - an account with no value leaves the local choice local: no upload;
 * - otherwise a differing account value replaces the cache, without transition.
 */
fun mk8dxHydrateAppearance(
    cache: Mk8dxAppearanceCache,
    accountChoice: Mk8dxAppearanceChoice?,
    lastHydrationAtMs: Long,
    nowMs: Long,
): Mk8dxAppearanceHydration {
    if (accountChoice != null && cache.choice == accountChoice) {
        // Already the same value: nothing to send, and the cache is now known
        // to agree with the account.
        return Mk8dxAppearanceHydration(cache.copy(synced = true))
    }
    val localIsNewerExplicitChange =
        cache.choice != null && !cache.synced && cache.updatedAtMs > lastHydrationAtMs
    if (localIsNewerExplicitChange) {
        // An explicit change that never landed is retried here (§5), whether or
        // not the account already holds a value.
        return Mk8dxAppearanceHydration(cache, upload = cache.choice)
    }
    if (accountChoice == null) {
        // "If the account value is NULL, the local choice stays local until the
        // user explicitly changes it. No automatic upload."
        return Mk8dxAppearanceHydration(cache)
    }
    return Mk8dxAppearanceHydration(
        Mk8dxAppearanceCache(accountChoice, updatedAtMs = nowMs, synced = true),
    )
}

/**
 * Choice + device state → the appearance that is rendered.
 *
 * High contrast is an OS state, not a choice, and it wins: a Player who asked
 * their phone for high contrast gets it whichever appearance they picked.
 */
fun mk8dxResolveAppearance(
    choice: Mk8dxAppearanceChoice,
    systemDark: Boolean,
    highContrast: Boolean,
): Mk8dxAppearance = when {
    highContrast -> Mk8dxAppearance.HighContrast
    choice == Mk8dxAppearanceChoice.Dark -> Mk8dxAppearance.Dark
    choice == Mk8dxAppearanceChoice.Light -> Mk8dxAppearance.Light
    systemDark -> Mk8dxAppearance.Dark
    else -> Mk8dxAppearance.Light
}

/** The whole device-local appearance state, as one value. */
data class Mk8dxAppearanceSettings(
    val cache: Mk8dxAppearanceCache = Mk8dxAppearanceCache(),
    val textSize: Mk8dxTextSize = Mk8dxTextSize.Normal,
    val motion: Mk8dxMotionPreference = Mk8dxMotionPreference.System,
    /** When the account was last read, so an offline change can win over it. */
    val hydratedAtMs: Long = 0L,
)

/**
 * The device cache. The web stores `mk8dx.appearance.v1` in localStorage; this
 * is the same document in SharedPreferences, with the same field names.
 */
class Mk8dxAppearanceStore(private val preferences: SharedPreferences) {
    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE),
    )

    fun read(): Mk8dxAppearanceSettings = Mk8dxAppearanceSettings(
        cache = Mk8dxAppearanceCache(
            choice = Mk8dxAppearanceChoice.ofWire(preferences.getString("choice", null)),
            updatedAtMs = preferences.getLong("updatedAt", 0L),
            synced = preferences.getBoolean("synced", true),
        ),
        textSize = Mk8dxTextSize.ofWire(preferences.getString("textSize", null)),
        motion = Mk8dxMotionPreference.ofWire(preferences.getString("motion", null)),
        hydratedAtMs = preferences.getLong("hydratedAt", 0L),
    )

    fun write(settings: Mk8dxAppearanceSettings) {
        preferences.edit()
            .putString("choice", settings.cache.choice?.wireValue)
            .putLong("updatedAt", settings.cache.updatedAtMs)
            .putBoolean("synced", settings.cache.synced)
            .putString("textSize", settings.textSize.wireValue)
            .putString("motion", settings.motion.wireValue)
            .putLong("hydratedAt", settings.hydratedAtMs)
            .apply()
    }

    companion object {
        const val NAME = "mk8dx.appearance.v1"
    }
}

/**
 * The account side of ADR-0205. The route is the web product's account
 * appearance preference; until it is served, [Mk8dxNoAppearanceSync] keeps the
 * choice on the device and the cache simply stays `synced = false`.
 */
interface Mk8dxAppearanceSyncClient {
    /** The account value, or null when the account has never held one. */
    fun readAccountChoice(): Mk8dxAppearanceChoice?

    /** Store the choice on the account. Returns false when it did not land. */
    fun writeAccountChoice(choice: Mk8dxAppearanceChoice): Boolean
}

/** Signed out, or an API that does not serve the field yet. */
object Mk8dxNoAppearanceSync : Mk8dxAppearanceSyncClient {
    override fun readAccountChoice(): Mk8dxAppearanceChoice? = null
    override fun writeAccountChoice(choice: Mk8dxAppearanceChoice): Boolean = false
}

/** True when the OS asks for high contrast (API 34 contrast, else the a11y setting). */
fun mk8dxSystemHighContrast(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 34) {
        val manager = runCatching { context.getSystemService(UiModeManager::class.java) }.getOrNull()
        val contrast = runCatching { manager?.contrast }.getOrNull()
        if (contrast != null && contrast >= 0.5f) return true
    }
    return runCatching {
        Settings.Secure.getInt(context.contentResolver, "high_text_contrast_enabled", 0) == 1
    }.getOrDefault(false)
}

/** True when the OS animation scale is off, which is Android's reduced motion. */
fun mk8dxSystemReducedMotion(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

val LocalMk8dxReducedMotion = staticCompositionLocalOf { false }

/**
 * Provides the resolved appearance, type and device-local preferences to every
 * design-system component in the app.
 *
 * It deliberately does **not** restyle Material: legacy product screens keep
 * their own palette until their migration phase, so nothing reaches Players
 * half-migrated (IMPLEMENTATION_PLAN §3.3).
 */
@Composable
fun Mk8dxAppearanceHost(
    settings: Mk8dxAppearanceSettings,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val systemDark = isSystemInDarkTheme()
    val highContrast = remember(configuration, context) { mk8dxSystemHighContrast(context) }
    val systemReducedMotion = remember(configuration, context) { mk8dxSystemReducedMotion(context) }
    val appearance = mk8dxResolveAppearance(settings.cache.effectiveChoice, systemDark, highContrast)
    // Edge to edge draws the product behind the system bars, so the status and
    // navigation icons have to follow the *product's* appearance rather than
    // the phone's: a dark app on a light phone otherwise gets dark icons on a
    // dark bar, which is no icons at all.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? android.app.Activity)?.window
            if (window != null) {
                val light = appearance == Mk8dxAppearance.Light
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = light
                    isAppearanceLightNavigationBars = light
                }
            }
        }
    }
    val density = LocalDensity.current
    val phone = configuration.screenWidthDp < 600
    CompositionLocalProvider(
        LocalMk8dxColors provides Mk8dxTheme.colorsFor(appearance),
        LocalMk8dxTypography provides Mk8dxTypography.from(phone),
        LocalMk8dxAppearance provides appearance,
        LocalMk8dxReducedMotion provides
            (settings.motion == Mk8dxMotionPreference.Reduced || systemReducedMotion),
        LocalDensity provides Density(density.density, density.fontScale * settings.textSize.scale),
        content = content,
    )
}
