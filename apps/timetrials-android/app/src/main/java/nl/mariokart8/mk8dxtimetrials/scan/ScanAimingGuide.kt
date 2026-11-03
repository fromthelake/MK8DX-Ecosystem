package nl.mariokart8.mk8dxtimetrials.scan

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag

/**
 * Which MK8DX screen the scanner is aimed at.
 *
 * This is not a cosmetic choice. The recognition engine branches on it for the
 * step-01 ROI route, the canonical target box, which relative grid step 21
 * reads, the owner assignment and which icon slots node 27 uses. Everything
 * else — detection model, warp, seven-segment reading, lap-sum repair,
 * matchers, the vote ladder — is shared.
 *
 * [ENDSCREEN] is the Time Trial end screen with the player and ghost cards.
 * [GHOST_DETAIL] is the Select-a-Ghost detail panel: one rider, used when the
 * original end screen of an old record can no longer be brought up.
 */
internal enum class ScanLayoutProfile(
    val engineValue: String,
    val submissionValue: String,
) {
    ENDSCREEN("endscreen", "time_trial_result"),
    GHOST_DETAIL("ghost_detail", "ghost_details"),
}

// Aiming-guide geometry in the engine's 1280x720 landscape source space, taken
// verbatim from the scanner's own overlay so what the user frames is what the
// pipeline expects. Each entry is [left, top, width, height].
private val CARD3 = listOf(
    floatArrayOf(218f, 77f, 844f, 276f),
    floatArrayOf(218f, 368f, 844f, 275f),
)
private val CARD7 = listOf(
    floatArrayOf(276f, 41f, 724f, 313f),
    floatArrayOf(276f, 366f, 724f, 313f),
)
// One panel frame, carrying the panel aspect of the reference screenshots
// (3 laps 1375:1264, 7 laps 691:777) so the user fills the frame with it.
private val GHOSTCARD3 = listOf(floatArrayOf(314f, 60f, 653f, 600f))
private val GHOSTCARD7 = listOf(floatArrayOf(365f, 50f, 551f, 620f))

internal fun scanGuideCards(layout: ScanLayoutProfile, lapCount: Int): List<FloatArray> =
    if (layout == ScanLayoutProfile.GHOST_DETAIL) {
        if (lapCount == 7) GHOSTCARD7 else GHOSTCARD3
    } else {
        if (lapCount == 7) CARD7 else CARD3
    }

/**
 * How much of the portrait read box the guide's cards fill. Upright, the phone
 * used to frame the cards in a flat 16:9 band at two thirds of the screen
 * width, so the times arrived small; the owner asked for the screen to be used
 * (2026-09-17). Measured with a webcam on the emulator: both ghost panels now
 * read upright where the old band lost them, and cards at about 78% of the
 * width read where cards at 87% did not - the card edges then sit too close
 * to the edge of what the engine gets. A Player who fills this guide lands at
 * 80%.
 */
internal const val PORTRAIT_GUIDE_FILL = 0.80f

/**
 * The same for height. The tall ghost panels reach the height first; at 80%
 * the seven-lap panel stayed too narrow to read, at 92% the three-lap panel
 * came too close to the top and bottom. At 86% the web engine read all 15
 * labelled screens with the cards at 95% of the guide.
 */
internal const val PORTRAIT_GUIDE_FILL_HEIGHT = 0.86f

/**
 * Where each guide card is drawn, as [left, top, right, bottom] in the
 * overlay's pixels, plus the scale from the 1280x720 source space.
 *
 * Landscape keeps the engine's own geometry, centred in the largest inscribed
 * 16:9 box. Portrait draws inside the centred 4:3 box across the full width,
 * which is the region [uprightResultCrop] hands the engine, with the cards
 * together filling at most [PORTRAIT_GUIDE_FILL] of its width and
 * [PORTRAIT_GUIDE_FILL_HEIGHT] of its height.
 */
internal fun scanGuideRects(
    layout: ScanLayoutProfile,
    lapCount: Int,
    width: Float,
    height: Float,
    portrait: Boolean,
): Pair<List<FloatArray>, Float> {
    val cards = scanGuideCards(layout, lapCount)
    if (!portrait) {
        val guideScale = if (lapCount == 7) .9f else 1f
        val boxWidth = minOf(width, height * 16f / 9f)
        val boxHeight = boxWidth * 9f / 16f
        val boxLeft = (width - boxWidth) / 2f
        val boxTop = (height - boxHeight) / 2f
        val gx = { x: Float -> boxLeft + ((640f + (x - 640f) * guideScale) / 1280f) * boxWidth }
        val gy = { y: Float -> boxTop + ((360f + (y - 360f) * guideScale) / 720f) * boxHeight }
        return cards.map { floatArrayOf(gx(it[0]), gy(it[1]), gx(it[0] + it[2]), gy(it[1] + it[3])) } to
            (boxWidth / 1280f)
    }
    val boxWidth = minOf(width, height * 4f / 3f)
    val boxHeight = boxWidth * 3f / 4f
    val unionLeft = cards.minOf { it[0] }
    val unionTop = cards.minOf { it[1] }
    val unionRight = cards.maxOf { it[0] + it[2] }
    val unionBottom = cards.maxOf { it[1] + it[3] }
    val scale = minOf(
        PORTRAIT_GUIDE_FILL * boxWidth / (unionRight - unionLeft),
        PORTRAIT_GUIDE_FILL_HEIGHT * boxHeight / (unionBottom - unionTop),
    )
    val centreX = (unionLeft + unionRight) / 2f
    val centreY = (unionTop + unionBottom) / 2f
    val gx = { x: Float -> width / 2f + (x - centreX) * scale }
    val gy = { y: Float -> height / 2f + (y - centreY) * scale }
    return cards.map { floatArrayOf(gx(it[0]), gy(it[1]), gx(it[0] + it[2]), gy(it[1] + it[3])) } to scale
}

/**
 * The scanner's aiming guide: eight white L-corners per card, drawn only.
 * [portrait] says whether the camera stage is upright; see [scanGuideRects].
 * The stroke and the corner arms scale with the guide so the corners keep
 * their weight on every phone.
 */
@Composable
internal fun ScanAimingGuideOverlay(
    lapCount: Int,
    layout: ScanLayoutProfile,
    modifier: Modifier = Modifier,
    portrait: Boolean = false,
) {
    Canvas(modifier.testTag("scan-aiming-guide")) {
        val (rects, scale) = scanGuideRects(layout, lapCount, size.width, size.height, portrait)
        val arm = 48f * scale
        val stroke = 12f * scale
        rects.forEach { rect ->
            val left = rect[0]
            val top = rect[1]
            val right = rect[2]
            val bottom = rect[3]
            listOf(
                Offset(left, top) to Offset(left + arm, top),
                Offset(left, top) to Offset(left, top + arm),
                Offset(right, top) to Offset(right - arm, top),
                Offset(right, top) to Offset(right, top + arm),
                Offset(left, bottom) to Offset(left + arm, bottom),
                Offset(left, bottom) to Offset(left, bottom - arm),
                Offset(right, bottom) to Offset(right - arm, bottom),
                Offset(right, bottom) to Offset(right, bottom - arm),
            ).forEach { (start, end) ->
                drawLine(Color.White, start, end, stroke, StrokeCap.Square)
            }
        }
    }
}

/**
 * The chosen scan layout, kept across sessions the way the scanner keeps it.
 * Someone working through a stack of old records stays in the Select-a-Ghost
 * detail panel; someone scanning fresh runs stays on the end screen.
 */
internal object ScanLayoutPreference {
    private const val PREFERENCES = "mk8_prefs"
    private const val KEY = "scan_layout"

    fun read(context: Context): ScanLayoutProfile {
        val stored = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY, null)
        return ScanLayoutProfile.entries.firstOrNull { it.engineValue == stored }
            ?: ScanLayoutProfile.ENDSCREEN
    }

    fun write(context: Context, layout: ScanLayoutProfile) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, layout.engineValue)
            .apply()
    }
}
