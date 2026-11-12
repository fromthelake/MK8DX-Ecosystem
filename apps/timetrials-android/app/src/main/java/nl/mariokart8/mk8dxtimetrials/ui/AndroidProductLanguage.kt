package nl.mariokart8.mk8dxtimetrials.ui

import android.content.Context
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.Composable

/**
 * The product languages: the game's 15 localisations, the same codes as the website (ADR-0199 link grammar).
 * English and Dutch are the reviewed source languages whose text lives in the code; the other 13 come from the
 * catalogs in the app's assets (AndroidProductCatalog).
 */
internal enum class AndroidProductLanguage(val code: String, val displayName: String, val localeTag: String) {
    ENGLISH("en", "English (UK)", "en-GB"),
    DUTCH("nl", "Nederlands", "nl-NL"),
    ENGLISH_US("en-US", "English (US)", "en-US"),
    FRENCH("fr", "Français", "fr-FR"),
    FRENCH_CANADA("fr-CA", "Français (Canada)", "fr-CA"),
    GERMAN("de", "Deutsch", "de-DE"),
    SPANISH("es", "Español (España)", "es-ES"),
    SPANISH_LATIN_AMERICA("es-419", "Español (Latinoamérica)", "es-419"),
    ITALIAN("it", "Italiano", "it-IT"),
    PORTUGUESE("pt", "Português", "pt-PT"),
    RUSSIAN("ru", "Русский", "ru-RU"),
    JAPANESE("ja", "日本語", "ja-JP"),
    KOREAN("ko", "한국어", "ko-KR"),
    CHINESE_SIMPLIFIED("zh-CN", "简体中文", "zh-CN"),
    CHINESE_TRADITIONAL("zh-TW", "繁體中文", "zh-TW"),
    ;

    /** Whether the text comes from a catalog: every language except UK English and Dutch. */
    val usesCatalog: Boolean get() = this != ENGLISH && this != DUTCH

    /** Dates and numbers in this language ("31 okt", "31 Okt.", "10月31日"). */
    val locale: java.util.Locale get() = java.util.Locale.forLanguageTag(localeTag)

    companion object {
        fun fromCode(code: String?): AndroidProductLanguage? =
            entries.firstOrNull { it.code.equals(code?.trim(), ignoreCase = true) }
    }
}

internal object AndroidProductLanguageStore {
    private const val preferencesName = "mk8dx_product_preferences_v1"
    private const val languageKey = "language"

    fun read(context: Context): AndroidProductLanguage {
        // Notifications are built without an activity, so the first language read puts the catalogs in place.
        AndroidProductCatalog.ensureInstalled(context)
        return AndroidProductLanguage.fromCode(
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
                .getString(languageKey, AndroidProductLanguage.ENGLISH.code),
        ) ?: AndroidProductLanguage.ENGLISH
    }

    /**
     * The first start, before anybody chose a language: speak the phone's language when the app has it
     * (region first, so en-US and fr-CA are found), otherwise UK English. A chosen language always wins.
     */
    fun readForFirstStart(context: Context): AndroidProductLanguage {
        AndroidProductCatalog.ensureInstalled(context)
        val stored = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).getString(languageKey, null)
        if (stored != null) return AndroidProductLanguage.fromCode(stored) ?: AndroidProductLanguage.ENGLISH
        return deviceLanguage(java.util.Locale.getDefault())
    }

    internal fun deviceLanguage(locale: java.util.Locale): AndroidProductLanguage {
        val region = if (locale.country.isNullOrEmpty()) null else "${locale.language}-${locale.country}"
        return listOfNotNull(region, locale.language)
            .firstNotNullOfOrNull { AndroidProductLanguage.fromCode(it) }
            ?: AndroidProductLanguage.ENGLISH
    }

    fun write(context: Context, language: AndroidProductLanguage) {
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .edit().putString(languageKey, language.code).apply()
    }
}

internal val LocalAndroidProductLanguage = compositionLocalOf { AndroidProductLanguage.ENGLISH }

internal fun androidText(
    language: AndroidProductLanguage,
    english: String,
    dutch: String,
): String = when {
    language == AndroidProductLanguage.DUTCH -> dutch
    !language.usesCatalog -> english
    else -> AndroidProductCatalog.translate(language.code, english)
        ?: AndroidProductCatalog.replaceGameNames(language.code, english)
}

@Composable
internal fun androidText(english: String, dutch: String): String =
    androidText(LocalAndroidProductLanguage.current, english, dutch)
