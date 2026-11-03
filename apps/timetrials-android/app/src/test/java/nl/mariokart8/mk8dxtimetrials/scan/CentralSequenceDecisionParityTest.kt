package nl.mariokart8.mk8dxtimetrials.scan

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import nl.mariokart8.iconmatcher.result.SequenceDecision
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Java sequence decision (packages/icon-matcher/java-result) against Python's records
 * (packages/icon-matcher/vectors/sequence-decision-v1.json), including the snapshot's key order.
 */
class CentralSequenceDecisionParityTest {
    private fun vectors(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/icon-matcher/vectors/sequence-decision-v1.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("sequence-decision-v1.json not found above ${File("").absolutePath}")
    }

    @Test
    fun javaSequenceDecisionEqualsPython() {
        val scans = Json.parseToJsonElement(vectors().readText()).jsonObject.getValue("scans").jsonArray
        var differences = 0
        var steps = 0
        for (scan in scans) {
            val decision = SequenceDecision()
            for (rawStep in scan.jsonObject.getValue("steps").jsonArray) {
                steps++
                val step = rawStep.jsonObject
                @Suppress("UNCHECKED_CAST")
                val justLocked = decision.updateTimes(
                    plain(step.getValue("fields")) as Map<String, Any?>,
                    step.getValue("lapSumOk").jsonPrimitive.boolean,
                    step.getValue("lapSumRepairs").jsonPrimitive.int,
                    step.getValue("expectedFields").jsonPrimitive.int,
                )
                @Suppress("UNCHECKED_CAST")
                decision.addIdentity(plain(step.getValue("identity")) as Map<String, Any?>?)
                val after = jsonOf(
                    linkedMapOf(
                        "justLocked" to justLocked,
                        "locked" to decision.locked,
                        "acceptPath" to decision.acceptPath,
                        "lockedFields" to decision.lockedFields,
                        "identitySettled" to decision.identitySettled(),
                    ),
                )
                if (!same(after, step.getValue("after"), ordered = false)) {
                    differences++
                    if (differences <= 5) println("step differs $after ${step.getValue("after")}")
                }
            }
            val got = jsonOf(decision.result())
            if (!same(got, scan.jsonObject.getValue("result"), ordered = true)) {
                differences++
                if (differences <= 5) println("result differs\n got $got\n want ${scan.jsonObject.getValue("result")}")
            }
        }
        val fieldVotes = Json.parseToJsonElement(vectors().readText()).jsonObject["fieldVotes"]?.jsonArray ?: JsonArray(emptyList())
        for (raw in fieldVotes) {
            val c = raw.jsonObject
            val values = c.getValue("values").jsonArray.map { pair ->
                val p = pair.jsonArray
                arrayOf(plain(p[0]), (plain(p[1]) as Number))
            }
            val won = SequenceDecision.fieldVote(
                values.map { arrayOf<Any?>(it[0], it[1]) },
                (plain(c.getValue("minSupport")) as Number).toDouble(),
                (plain(c.getValue("minMargin")) as Number).toDouble(),
            )
            val got = if (won == null) JsonNull else jsonOf(
                linkedMapOf("value" to won.value, "weight" to won.weight, "second" to won.second, "share" to won.share),
            )
            if (!same(got, c.getValue("result"), ordered = false)) {
                differences++
                if (differences <= 5) println("field vote differs $c $got")
            }
        }
        println("sequence decision parity scans=${scans.size} steps=$steps fieldVotes=${fieldVotes.size} differences=$differences")
        assertEquals(0, differences)
    }

    private fun plain(element: JsonElement): Any? = when (element) {
        is JsonNull -> null
        is JsonObject -> LinkedHashMap<String, Any?>().also { map -> element.forEach { (k, v) -> map[k] = plain(v) } }
        is JsonArray -> element.map { plain(it) }
        is JsonPrimitive -> when {
            element.isString -> element.content
            element.booleanOrNull != null -> element.booleanOrNull
            element.content.any { it == '.' || it == 'e' || it == 'E' } -> element.content.toDouble()
            else -> element.content.toLong()
        }
    }

    private fun jsonOf(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(LinkedHashMap<String, JsonElement>().also { m -> value.forEach { (k, v) -> m[k.toString()] = jsonOf(v) } })
        is List<*> -> JsonArray(value.map { jsonOf(it) })
        else -> JsonPrimitive(value.toString())
    }

    private fun same(a: JsonElement, b: JsonElement, ordered: Boolean): Boolean = when {
        a is JsonNull || b is JsonNull -> a is JsonNull && b is JsonNull
        a is JsonObject && b is JsonObject ->
            (if (ordered) a.keys.toList() == b.keys.toList() else a.keys == b.keys) &&
                a.keys.all { same(a.getValue(it), b.getValue(it), ordered) }
        a is JsonArray && b is JsonArray -> a.size == b.size && a.indices.all { same(a[it], b[it], ordered) }
        a is JsonPrimitive && b is JsonPrimitive -> if (a.isString || b.isString) {
            a.isString && b.isString && a.content == b.content
        } else if (a.booleanOrNull != null || b.booleanOrNull != null) {
            a.booleanOrNull == b.booleanOrNull
        } else {
            a.content.toDouble() == b.content.toDouble()
        }
        else -> false
    }
}
