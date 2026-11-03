package nl.mariokart8.mk8dxtimetrials.scan

import android.graphics.Rect
import android.util.Size
import androidx.camera.core.CameraInfo
import androidx.camera.core.ImageCapture
import androidx.camera.core.Preview
import androidx.camera.view.PreviewView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the debug bridge needs to put the guide on the analysed picture
 * later: the stage in view pixels, the guide rectangles exactly as
 * [ScanAimingGuideOverlay] draws them, and what CameraX says about the preview
 * and capture streams and the zoom. Nothing here changes the scan.
 */
internal fun scanDebugShot(
    previewView: PreviewView?,
    preview: Preview?,
    capture: ImageCapture,
    cameraInfo: CameraInfo?,
    layout: ScanLayoutProfile,
    lapCount: Int,
    portrait: Boolean,
    zoomRequested: Float,
): JSONObject {
    val width = previewView?.width ?: 0
    val height = previewView?.height ?: 0
    val (rects, scale) = scanGuideRects(layout, lapCount, width.toFloat(), height.toFloat(), portrait)
    return JSONObject()
        .put("captured_at_ms", System.currentTimeMillis())
        .put("layout", layout.engineValue)
        .put("lap_count", lapCount)
        .put("portrait", portrait)
        .put("stage_px", JSONObject().put("width", width).put("height", height))
        .put("preview_scale_type", previewView?.scaleType?.name ?: JSONObject.NULL)
        .put("display_rotation", previewView?.display?.rotation ?: JSONObject.NULL)
        .put(
            "guide",
            JSONObject()
                .put("scale_from_1280x720", scale.toDouble())
                .put("rects_ltrb_px", JSONArray().apply { rects.forEach { put(floats(it)) } }),
        )
        .put("zoom_requested", zoomRequested.toDouble())
        .put("zoom_at_press", scanDebugZoom(cameraInfo))
        .put("sensor_rotation_degrees", cameraInfo?.sensorRotationDegrees ?: JSONObject.NULL)
        .put("capture_target_rotation", capture.targetRotation)
        .put("capture_stream", resolution(capture.resolutionInfo?.resolution, capture.resolutionInfo?.cropRect, capture.resolutionInfo?.rotationDegrees))
        .put("preview_stream", resolution(preview?.resolutionInfo?.resolution, preview?.resolutionInfo?.cropRect, preview?.resolutionInfo?.rotationDegrees))
}

/** The zoom as the camera reports it, not as the button asked for it. */
internal fun scanDebugZoom(cameraInfo: CameraInfo?): Any {
    val zoom = cameraInfo?.zoomState?.value ?: return JSONObject.NULL
    return JSONObject()
        .put("ratio", zoom.zoomRatio.toDouble())
        .put("linear", zoom.linearZoom.toDouble())
        .put("min", zoom.minZoomRatio.toDouble())
        .put("max", zoom.maxZoomRatio.toDouble())
}

private fun resolution(size: Size?, crop: Rect?, rotation: Int?): Any {
    if (size == null) return JSONObject.NULL
    return JSONObject()
        .put("width", size.width)
        .put("height", size.height)
        .put("crop_ltrb", crop?.let { JSONArray().put(it.left).put(it.top).put(it.right).put(it.bottom) } ?: JSONObject.NULL)
        .put("rotation_degrees", rotation ?: JSONObject.NULL)
}

private fun floats(values: FloatArray) = JSONArray().apply { values.forEach { put(it.toDouble()) } }
