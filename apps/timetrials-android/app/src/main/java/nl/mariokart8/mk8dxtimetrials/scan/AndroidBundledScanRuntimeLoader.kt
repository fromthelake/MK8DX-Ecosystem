package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context

private const val BUNDLED_FACTORY_CLASS =
    "nl.mariokart8.mk8dxtimetrials.scan.OptInBundledResultImageAnalyzerFactory"

/**
 * Loads only the explicitly linked private scanner runtime. A normal public
 * build has no such class and remains payload-free.
 */
internal fun loadBundledResultImageAnalyzerFactory(
    context: Context,
): ContextualResultImageAnalyzerFactory? = try {
    val implementation = Class.forName(BUNDLED_FACTORY_CLASS)
    if (!ContextualResultImageAnalyzerFactory::class.java.isAssignableFrom(implementation)) {
        null
    } else {
        implementation.getDeclaredConstructor(Context::class.java).apply {
            isAccessible = true
        }.newInstance(context.applicationContext) as ContextualResultImageAnalyzerFactory
    }
} catch (_: ReflectiveOperationException) {
    null
} catch (_: LinkageError) {
    null
}
