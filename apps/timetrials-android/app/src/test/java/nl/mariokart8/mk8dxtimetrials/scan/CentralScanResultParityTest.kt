package nl.mariokart8.mk8dxtimetrials.scan

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import nl.mariokart8.iconmatcher.result.ScanResult
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Java scan result (packages/icon-matcher/java-result) against Python's records
 * (packages/icon-matcher/vectors/scan-result-v1.json, tooling/recognition/scan_result_vectors.py).
 */
class CentralScanResultParityTest {
    private fun vectors(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/icon-matcher/vectors/scan-result-v1.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("scan-result-v1.json not found above ${File("").absolutePath}")
    }

    @Test
    fun javaScanResultEqualsPython() {
        val doc = Json.parseToJsonElement(vectors().readText()).jsonObject
        val cases = doc.getValue("cases").jsonArray
        var differences = 0
        for (case in cases) {
            val c = case.jsonObject
            @Suppress("UNCHECKED_CAST")
            val consensus = plain(c.getValue("consensus")) as Map<String, Any?>
            val lapCount = (c["lapCount"] as? JsonPrimitive)?.intOrNull
            val got = toJson(ScanResult.compose(consensus, lapCount))
            if (!same(got, c.getValue("result"))) {
                differences++
                if (differences <= 5) println("differs ${c.getValue("consensus")}\n got $got\n want ${c.getValue("result")}")
            }
        }
        println("scan result parity cases=${cases.size} differences=$differences")
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

    private fun same(a: JsonElement, b: JsonElement): Boolean = when {
        a is JsonNull || b is JsonNull -> a is JsonNull && b is JsonNull
        a is JsonObject && b is JsonObject -> a.keys == b.keys && a.keys.all { same(a.getValue(it), b.getValue(it)) }
        a is JsonArray && b is JsonArray -> a.size == b.size && a.indices.all { same(a[it], b[it]) }
        a is JsonPrimitive && b is JsonPrimitive -> if (a.isString || b.isString) {
            a.isString && b.isString && a.content == b.content
        } else if (a.booleanOrNull != null || b.booleanOrNull != null) {
            a.booleanOrNull == b.booleanOrNull
        } else {
            a.content.toDouble() == b.content.toDouble()
        }
        else -> false
    }

    private fun str(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)
    private fun num(value: Number?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

    private fun toJson(r: ScanResult): JsonElement = JsonObject(
        linkedMapOf(
            "schema" to JsonPrimitive(ScanResult.SCHEMA),
            "status" to JsonPrimitive(r.status),
            "owner" to JsonPrimitive(r.owner),
            "layout" to JsonPrimitive(r.layout),
            "captureLayout" to JsonPrimitive(r.captureLayout),
            "acceptPath" to str(r.acceptPath),
            "totalTime" to str(r.totalTime),
            "totalMs" to num(r.totalMs),
            "laps" to JsonArray(r.laps.map { JsonObject(mapOf("time" to str(it.time), "ms" to num(it.ms))) }),
            "lapsComplete" to JsonPrimitive(r.lapsComplete),
            "lapSumMatches" to (r.lapSumMatches?.let { JsonPrimitive(it) } ?: JsonNull),
            "parts" to JsonObject(
                r.parts.mapValues { (_, p) ->
                    JsonObject(
                        mapOf(
                            "present" to JsonPrimitive(p.present),
                            "accepted" to JsonPrimitive(p.accepted),
                            "id" to str(p.id),
                            "index" to num(p.index),
                            "score" to num(p.score),
                            "doubt" to JsonPrimitive(p.doubt),
                            "alternatives" to JsonArray(
                                p.alternatives.map {
                                    JsonObject(mapOf("id" to str(it.id), "index" to num(it.index), "name" to str(it.name)))
                                },
                            ),
                        ),
                    )
                },
            ),
            "confidence" to JsonObject(r.confidence.mapValues { JsonPrimitive(it.value) }),
            "doubt" to JsonArray(r.doubt.map { JsonPrimitive(it) }),
            "observedPlayerName" to str(r.observedPlayerName),
        ),
    )
}
