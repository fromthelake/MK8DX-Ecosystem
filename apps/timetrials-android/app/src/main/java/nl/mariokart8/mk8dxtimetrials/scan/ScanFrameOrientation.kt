package nl.mariokart8.mk8dxtimetrials.scan

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.view.OrientationEventListener
import android.view.Surface
import androidx.exifinterface.media.ExifInterface
import java.io.File

/**
 * The scan follows the phone, not the other way round.
 *
 * The camera stage used to force landscape. Held upright, the phone then
 * showed a landscape stage on a portrait display, and a screen recording of
 * the scan came out rotated. Now the Player rotates the phone and the stage,
 * the guide and the controls follow. Two things must then be true of every
 * captured frame:
 *
 * 1. it is stored the way the Player saw it, whichever way the phone was
 *    held, including reverse landscape; CameraX writes that as an EXIF
 *    orientation, which [decodeUprightResultImage] applies;
 * 2. the recognition engine receives the picture the Player framed inside
 *    the aiming guide. In portrait that is the centred 4:3 box across the
 *    full width of the upright frame, which is exactly where the guide sits
 *    on the preview ([uprightResultCrop], [scanGuideRects]).
 */

/**
 * The [Surface] rotation CameraX should stamp on a capture for a device
 * orientation reported by an [OrientationEventListener] (degrees clockwise
 * from natural portrait), or null while the orientation is unknown.
 *
 * The four sectors are centred on the axes, so a phone tilted a little keeps
 * its rotation instead of flapping between two.
 */
internal fun captureRotationFor(orientationDegrees: Int): Int? = when {
    orientationDegrees == OrientationEventListener.ORIENTATION_UNKNOWN -> null
    orientationDegrees >= 315 || orientationDegrees < 45 -> Surface.ROTATION_0
    orientationDegrees < 135 -> Surface.ROTATION_270
    orientationDegrees < 225 -> Surface.ROTATION_180
    else -> Surface.ROTATION_90
}

/**
 * The region of an upright frame the engine reads, as [left, top, width,
 * height] in pixels. A landscape frame is read whole: the engine finds the
 * cards itself and the guide only helps the Player fill the frame. A
 * portrait frame is cut down to its centred 4:3 box across the full width,
 * the part the aiming guide covers on the preview. It used to be a flat 16:9
 * band, which kept the cards at two thirds of the width; the taller box lets
 * the guide fill nearly the whole width (2026-09-17).
 */
internal fun uprightResultCrop(width: Int, height: Int): IntArray {
    require(width >= 1 && height >= 1)
    if (width >= height) return intArrayOf(0, 0, width, height)
    val bandHeight = maxOf(1, (width * 3L / 4L).toInt())
    return intArrayOf(0, (height - bandHeight) / 2, width, bandHeight)
}

/** The rotation, in degrees clockwise, an EXIF orientation asks for. */
internal fun exifRotationDegrees(orientation: Int): Int = when (orientation) {
    ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90
    ExifInterface.ORIENTATION_ROTATE_180, ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180
    ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270
    else -> 0
}

/**
 * Decodes a result image the way the Player saw it, applying the EXIF
 * orientation a camera stored beside the pixels. Returns null when the file
 * cannot be decoded at all. [inSampleSize] is passed to the decoder for a
 * preview-sized copy.
 */
internal fun decodeUprightResultImage(file: File, inSampleSize: Int = 1): Bitmap? {
    val decoded = BitmapFactory.decodeFile(
        file.absolutePath,
        BitmapFactory.Options().apply { this.inSampleSize = inSampleSize },
    ) ?: return null
    val degrees = try {
        exifRotationDegrees(
            ExifInterface(file.absolutePath).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            ),
        )
    } catch (_: Exception) {
        // A file without readable metadata (a Switch screenshot, a PNG) is
        // already upright.
        0
    }
    if (degrees == 0) return decoded
    return try {
        Bitmap.createBitmap(
            decoded, 0, 0, decoded.width, decoded.height,
            Matrix().apply { postRotate(degrees.toFloat()) }, true,
        ).also { rotated -> if (rotated !== decoded) decoded.recycle() }
    } catch (error: Exception) {
        decoded.recycle()
        throw error
    }
}
