package nl.mariokart8.mk8dxtimetrials.ui

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Translations for the product languages beyond English and Dutch (roadmap LANGUAGES_15, part B) — the same rule
 * as the website's product-catalog.ts. English is the source and the key: a text is looked up exactly, then
 * against the message templates (English with `{0}`, `{1}` where the code inserts a value), whose captured values
 * fill the translated template. Game names come from Clean Assets per locale inside the same catalog.
 *
 * One catalog per language in the app's assets (`i18n/<code>.json`, built by tooling/i18n/build_web_catalogs.mjs),
 * read once when the language is first needed; a missing catalog leaves the text English.
 */
internal object AndroidProductCatalog {
    private class Template(val pattern: Regex, val translation: String, val placeholders: Int)

    private class Catalog(
        val exact: Map<String, String>,
        /** Exact texts by their upper case: headings the code upper-cases before showing them. */
        val exactUpper: Map<String, String>,
        val byPrefix: Map<String, List<Template>>,
        val leading: List<Template>,
        val gameNames: List<Pair<String, String>>,
    )

    private const val PREFIX_LENGTH = 6
    private val placeholder = Regex("""\{(\d+)\}""")
    private val catalogs = mutableMapOf<String, Catalog?>()
    @Volatile private var assets: ((String) -> String?)? = null

    /** Where catalogs are read from; the app passes its assets, tests a map. */
    fun install(context: Context) {
        val appContext = context.applicationContext
        install { path ->
            runCatching { appContext.assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() } }.getOrNull()
        }
    }

    /** Install from the app's assets unless a reader is already in place (the first language read does this). */
    fun ensureInstalled(context: Context) {
        if (assets == null) install(context)
    }

    fun install(reader: (String) -> String?) {
        synchronized(catalogs) {
            assets = reader
            catalogs.clear()
        }
    }

    private fun catalog(code: String): Catalog? = synchronized(catalogs) {
        catalogs.getOrPut(code) { assets?.invoke("i18n/$code.json")?.let(::compile) }
    }

    private fun compile(text: String): Catalog? = runCatching {
        val document = Json.parseToJsonElement(text).jsonObject
        val messages = document["messages"]?.jsonObject ?: JsonObject(emptyMap())
        val exact = HashMap<String, String>()
        val byPrefix = HashMap<String, MutableList<Template>>()
        val leading = ArrayList<Template>()
        for ((source, value) in messages) {
            val translation = value.jsonPrimitive.content
            if (translation.isEmpty()) continue
            val count = placeholder.findAll(source).count()
            if (count == 0) {
                exact[source] = translation
                continue
            }
            val literals = source.split(placeholder)
            val template = Template(
                Regex("^" + literals.joinToString("([\\s\\S]*?)") { Regex.escape(it) } + "$"),
                translation,
                count,
            )
            val first = literals.first()
            if (first.isEmpty()) leading += template
            else byPrefix.getOrPut(first.take(PREFIX_LENGTH)) { mutableListOf() } += template
        }
        val names = (document["gameNames"]?.jsonObject ?: JsonObject(emptyMap()))
            .map { (english, translated) -> english to translated.jsonPrimitive.content }
            .filter { (english, translated) -> english.isNotEmpty() && translated.isNotEmpty() && english != translated }
            .sortedByDescending { it.first.length }
        val upper = HashMap<String, String>()
        for ((source, translation) in exact) upper.putIfAbsent(source.uppercase(), translation)
        Catalog(exact, upper, byPrefix, leading, names)
    }.getOrNull()

    private fun matchTemplates(catalog: Catalog, code: String, text: String, templates: List<Template>?): String? {
        for (template in templates.orEmpty()) {
            val match = template.pattern.matchEntire(text) ?: continue
            if (match.groupValues.size - 1 != template.placeholders) continue
            if (!keepsDroppedValuesShort(template.translation, match.groupValues.drop(1))) continue
            val values = match.groupValues.drop(1).map { translate(code, it) ?: it }
            return placeholder.replace(template.translation) { found ->
                values.getOrNull(found.groupValues[1].toInt()) ?: found.value
            }
        }
        return null
    }

    /**
     * A translation may leave out a placeholder that only carried an English plural ("{0} player{1}"); such a
     * value must then be a short ending, or the template swallowed text it would lose ("36 players · 2026-09-11").
     */
    private fun keepsDroppedValuesShort(translation: String, values: List<String>): Boolean {
        val used = placeholder.findAll(translation).map { it.groupValues[1].toInt() }.toSet()
        return values.withIndex().all { (index, value) -> index in used || DROPPABLE.matches(value) }
    }

    private val DROPPABLE = Regex("[A-Za-z]{0,3}")

    /** The text of `english` in the language `code`, or null when its catalog has none. */
    fun translate(code: String, english: String): String? {
        if (english.isEmpty()) return null
        val catalog = catalog(code) ?: return null
        catalog.exact[english]?.let { return it }
        for (length in minOf(PREFIX_LENGTH, english.length) downTo 1) {
            matchTemplates(catalog, code, english, catalog.byPrefix[english.take(length)])?.let { return it }
        }
        return matchTemplates(catalog, code, english, catalog.leading)
            ?: catalog.gameNames.firstOrNull { it.first == english }?.second
            ?: upperCased(catalog, code, english)
            ?: segments(code, english)
    }

    /** "FINISHED" from "Finished": a heading the code upper-cased, shown upper-cased in the language. */
    private fun upperCased(catalog: Catalog, code: String, english: String): String? {
        if (english.length < 2 || english != english.uppercase() || english == english.lowercase()) return null
        return catalog.exactUpper[english]?.uppercase(java.util.Locale.forLanguageTag(code))
    }

    /** "Final results · 36 players · 2026-09-11": a line the code joins from parts, translated part by part. */
    private fun segments(code: String, english: String): String? {
        if (!english.contains(SEPARATOR)) return null
        val parts = english.split(SEPARATOR)
        val translated = parts.map { part -> translate(code, part) ?: part }
        return if (translated == parts) null else translated.joinToString(SEPARATOR)
    }

    private const val SEPARATOR = " · "

    /** Every game name inside an English text replaced by the language's own, longest first. */
    fun replaceGameNames(code: String, english: String): String {
        val catalog = catalog(code) ?: return english
        var result = english
        for ((name, translated) in catalog.gameNames) {
            if (result.contains(name)) result = result.replace(name, translated)
        }
        return result
    }
}
