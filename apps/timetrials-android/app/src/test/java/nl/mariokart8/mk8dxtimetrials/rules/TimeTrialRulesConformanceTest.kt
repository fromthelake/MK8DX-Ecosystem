package nl.mariokart8.mk8dxtimetrials.rules

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T-CONF Kotlin runner (TESTING_STRATEGY §4.10). Reads the repository's
 * packages/time-trial-rules/conformance/cases.json, the same file the
 * TypeScript and server runners use, and requires identical valid,
 * errors[].field/rule (plus messageKey/params where a case states them) and
 * normalised payload. Deferred cases are skipped and counted.
 */
class TimeTrialRulesConformanceTest {
    private val packageDir: File = generateSequence(File(System.getProperty("user.dir")!!).absoluteFile) { it.parentFile }
        .map { File(it, "packages/time-trial-rules") }
        .firstOrNull { File(it, "conformance/cases.json").isFile }
        ?: error("packages/time-trial-rules/conformance/cases.json not found above ${System.getProperty("user.dir")}")

    private fun read(relative: String): JsonObject =
        Json.parseToJsonElement(File(packageDir, relative).readText()).jsonObject

    @Test
    fun everyRunnableCaseMatchesTheGoldenExpectation() {
        val cases = read("conformance/cases.json").getValue("cases").jsonArray.map { it.jsonObject }
        val active = cases.filter { it["deferred"] == null }
        val deferred = cases.filter { it["deferred"] != null }
        val failures = mutableListOf<String>()
        for (case in active) {
            val id = case.string("id")
            try {
                assertCase(case)
            } catch (failure: AssertionError) {
                failures += "$id: ${failure.message}"
            }
        }
        val byReason = deferred.groupingBy { it.string("deferred") }.eachCount()
        println("time-trial-rules Kotlin conformance: ran ${active.size} cases, ${active.size - failures.size} passed; skipped ${deferred.size} deferred $byReason")
        assertTrue(active.isNotEmpty())
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun ruleIdsAndVersionMatchRulesJson() {
        val rules = read("rules.json")
        val ids = rules.getValue("rules").jsonArray.map { it.jsonObject.string("id") }
        assertEquals(ids, TimeTrialRules.RULE_IDS)
        assertEquals(rules.string("rulesVersion"), TimeTrialRules.RULES_VERSION)
        assertEquals(rules.string("submissionContract"), TimeTrialRules.SUBMISSION_CONTRACT)
    }

    @Test
    fun missingLapSuggestionMatchesTheTypeScriptHelper() {
        assertEquals(MissingLapSuggestion(2, 35392, "035392"), TimeTrialRules.suggestMissingLap("145912", listOf("035300", "", "035220")))
        assertEquals(null, TimeTrialRules.suggestMissingLap("145912", listOf("035300", "", "")))
        assertEquals(null, TimeTrialRules.suggestMissingLap("", listOf("035300", "035220", "")))
        assertEquals(null, TimeTrialRules.suggestMissingLap("145912", listOf("035392", "035300", "035220")))
        assertEquals(null, TimeTrialRules.suggestMissingLap("000100", listOf("000100", "000001", "")))
        assertEquals("1:46.012", TimeTrialRules.formatTimeMs(106_012))
    }

    private fun assertCase(case: JsonObject) {
        val expect = case.getValue("expect").jsonObject
        val result = TimeTrialRules.validateDraft(draftOf(case.getValue("draft").jsonObject), contextOf(case.getValue("context").jsonObject))
        assertEquals("valid", expect.getValue("valid").jsonPrimitive.content.toBooleanStrict(), result.valid)
        val expectedErrors = expect.getValue("errors").jsonArray.map { it.jsonObject }
        assertEquals(
            "errors[].field/rule",
            expectedErrors.map { it.string("field") to it.string("rule") },
            result.errors.map { it.field to it.rule },
        )
        expectedErrors.forEachIndexed { index, expected ->
            val actual = result.errors[index]
            expected["messageKey"]?.let { assertEquals("errors[$index].messageKey", it.jsonPrimitive.content, actual.messageKey) }
            expected["params"]?.let { assertEquals("errors[$index].params", it, paramsJson(actual.params)) }
        }
        assertEquals("normalised payload", expect.getValue("payload"), payloadJson(result.payload))
    }

    private fun contextOf(json: JsonObject) = ValidationContext(
        engine = json.int("engine"),
        trackLapCount = json.getValue("trackLapCount").jsonPrimitive.int,
        connectivity = json.stringOrNull("connectivity"),
    )

    private fun draftOf(json: JsonObject) = SubmissionDraft(
        trackId = json.stringOrNull("trackId"),
        totalDigits = json.stringOrNull("totalDigits"),
        laps = (json["laps"] as? JsonArray).orEmpty().map { element ->
            val lap = element.jsonObject
            LapDraft(lap.stringOrNull("timeDigits"), lap.int("coinChange"), lap.int("mushroomsUsed"))
        },
        loadout = (json["loadout"] as? JsonObject).orEmpty().mapValues { (_, value) ->
            (value as? JsonPrimitive)?.takeIf { it.isString }?.content
        },
        origin = (json["origin"] as? JsonObject).orEmpty().mapValues { (_, value) -> value.jsonPrimitive.content },
        corrected = (json["corrected"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content },
    )

    private fun paramsJson(params: Map<String, Any>): JsonObject = buildJsonObject {
        params.forEach { (key, value) ->
            when (value) {
                is Int -> put(key, value)
                is String -> put(key, value)
                else -> error("unsupported param type for $key")
            }
        }
    }

    private fun payloadJson(payload: ValidatedPayload?): JsonElement = payload?.let {
        buildJsonObject {
            put("mode", it.mode)
            put("trackId", it.trackId)
            put("totalTimeMs", it.totalTimeMs)
            putJsonArray("laps") {
                it.laps.forEach { lap ->
                    add(
                        buildJsonObject {
                            put("lapNumber", lap.lapNumber)
                            put("timeMs", lap.timeMs)
                            lap.coinsCollected?.let { value -> put("coinsCollected", value) }
                            lap.mushroomsUsed?.let { value -> put("mushroomsUsed", value) }
                        },
                    )
                }
            }
            it.loadout?.let { loadout -> putJsonObject("loadout") { loadout.forEach { (key, value) -> put(key, value) } } }
        }
    } ?: JsonNull

    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

    private fun JsonObject.stringOrNull(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
}
