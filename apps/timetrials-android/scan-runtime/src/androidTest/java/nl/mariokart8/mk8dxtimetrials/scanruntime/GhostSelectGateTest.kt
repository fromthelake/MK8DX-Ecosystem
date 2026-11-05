package nl.mariokart8.mk8dxtimetrials.scanruntime

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mk8dx.mobileocr.OfflineParityNativePipeline
import com.mk8dx.mobileocr.OfflineParityPackagedRunner
import nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The labelled Select-a-Ghost panels (tooling/recognition/central_regression.py
 * gate android-ghost) through the scanner's ghost layout, once with the
 * previous reader and once with the shared field reader. The private panels are
 * pushed to [ROOT] by the gate, never packaged; each decision is logged as one
 * MK8Ghost line, which the gate scores with score_ghost_select.py.
 */
@RunWith(AndroidJUnit4::class)
class GhostSelectGateTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun compact(status: String?, envelope: JSONObject): JSONObject {
        val owners = JSONObject()
        val kartOwners = envelope.optJSONObject("kart_config")?.optJSONObject("owners")
        kartOwners?.keys()?.forEach { owner ->
            val fields = JSONObject()
            val source = kartOwners.getJSONObject(owner)
            for (kind in listOf("character", "kart", "wheel", "glider", "flag")) {
                val slot = source.optJSONObject(kind) ?: continue
                fields.put(kind, JSONObject()
                    .put("id", slot.opt("id") ?: JSONObject.NULL)
                    .put("index", slot.opt("index") ?: JSONObject.NULL)
                    .put("ok", slot.optBoolean("ok", false))
                    .put("score", slot.opt("score") ?: JSONObject.NULL)
                    .put("margin", slot.opt("margin") ?: JSONObject.NULL)
                    .put("ratio", slot.opt("ratio") ?: JSONObject.NULL))
            }
            owners.put(owner, fields)
        }
        // The times too, so a phone-set run is scored on every field the panel shows.
        return JSONObject().put("status", status ?: JSONObject.NULL).put("owners", owners)
            .put("fields", envelope.optJSONObject("fields") ?: JSONObject())
    }

    /** The decision evidence of every field left for review, for offline rule work (MK8GhostEvidence). */
    private fun logReviewEvidence(name: String, envelope: JSONObject) {
        val ghost = envelope.optJSONObject("kart_config")?.optJSONObject("owners")?.optJSONObject("ghost") ?: return
        for (kind in listOf("character", "kart", "wheel", "glider", "flag")) {
            val slot = ghost.optJSONObject(kind) ?: continue
            if (slot.optBoolean("ok", false)) continue
            val evidence = JSONObject()
            for (key in listOf("id", "index", "name", "evidence", "score", "margin", "text", "icon_visual", "shared_field")) {
                if (slot.has(key)) evidence.put(key, slot.get(key))
            }
            Log.i(EVIDENCE_TAG, "name=$name field=$kind $evidence")
        }
    }

    @Test
    fun labelledGhostPanelsThroughTheCentralReader() {
        val index = File(ROOT, "index.json")
        assumeTrue("Select-a-Ghost panels not pushed to $ROOT", index.exists())
        val context = instrumentation.targetContext
        assertNotNull("shared pack not staged: ${SharedFieldReader.unavailableReason()}",
            SharedFieldReader.get(context))
        val runner = OfflineParityPackagedRunner(context)
        val entries = JSONArray(index.readText())
        for (i in 0 until entries.length()) {
            val entry = entries.getJSONObject(i)
            val name = entry.getString("name")
            // The central reader only: the previous reader is gone (2026-10-30).
            val bitmap = checkNotNull(BitmapFactory.decodeFile(File(ROOT, entry.getString("file")).path))
            val started = System.currentTimeMillis()
            val result = runner.runLiveBitmap(bitmap, true, "$name-shared", null, false,
                OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL)
            val ms = System.currentTimeMillis() - started
            bitmap.recycle()
            val envelope = JSONObject(ScanRuntimeFrameEnvelope.encode(result))
            val record = compact(result.status, envelope).put("ms", ms)
            Log.i(TAG, "record arm=shared name=$name $record")
            logReviewEvidence(name, envelope)
        }
        Log.i(TAG, "summary panels=${entries.length()}")
    }

    private companion object {
        const val TAG = "MK8Ghost"
        const val EVIDENCE_TAG = "MK8GhostEvidence"
        const val ROOT = "/data/local/tmp/mk8-ghost-select"
    }
}
