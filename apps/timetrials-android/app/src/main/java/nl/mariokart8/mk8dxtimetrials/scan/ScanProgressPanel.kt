package nl.mariokart8.mk8dxtimetrials.scan

import android.graphics.BitmapFactory
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.random.Random
import kotlinx.coroutines.delay
import nl.mariokart8.mk8dxtimetrials.builds.AndroidBuildPartCategory
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.color
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * Rainbow Road, and nothing else in this file is its own colour any more
 * (Phase 17): the panel's surfaces, borders and ink come from the design
 * tokens, and a tile's accent is the builder's one definition of that part
 * category's colour. The six stops below are the track, which is what the
 * scanner's progress bar *is*; no token set has a rainbow.
 */
private val ScanRainbow = listOf(
    Color(0xFFFF4040), Color(0xFFFFA000), Color(0xFFFFDC00),
    Color(0xFF50DC64), Color(0xFF40A0FF), Color(0xFFBE5AFF),
)
private const val CYCLE_INTERVAL_MS = 130L
private const val CYCLE_POOL_SIZE = 10

/**
 * One cycling tile: a category, its border colour, and the artwork it rolls
 * through while the scanner works.
 */
private data class ScanCycleTile(
    val accent: Color,
    val assetPaths: List<String>,
)

/**
 * The pools the tiles roll through, decoded once per panel. Ten per category is
 * enough to read as "the scanner is going through everything it knows" without
 * holding the whole catalogue in memory, and the flags close the row the same
 * way the recognized country closes a result.
 */
@Composable
private fun rememberScanCycleTiles(): List<ScanCycleTile> {
    val random = remember { Random(System.nanoTime()) }
    val flagEdge = Mk8dxTheme.colors.borderStrong
    return remember(random, flagEdge) {
        fun pick(paths: List<String>): List<String> = paths.shuffled(random).take(CYCLE_POOL_SIZE)
        fun partPaths(category: AndroidBuildPartCategory): List<String> =
            pick(AndroidLoadoutCatalog.parts(category).map { it.assetPath })
        listOf(
            ScanCycleTile(AndroidBuildPartCategory.CHARACTER.color(), partPaths(AndroidBuildPartCategory.CHARACTER)),
            ScanCycleTile(AndroidBuildPartCategory.BODY.color(), partPaths(AndroidBuildPartCategory.BODY)),
            ScanCycleTile(AndroidBuildPartCategory.TIRE.color(), partPaths(AndroidBuildPartCategory.TIRE)),
            ScanCycleTile(AndroidBuildPartCategory.GLIDER.color(), partPaths(AndroidBuildPartCategory.GLIDER)),
            ScanCycleTile(
                flagEdge,
                pick(
                    AndroidDutchPresentationCatalog.countries.map {
                        "private-product/img/country/${it.id.substringAfter('.')}.png"
                    },
                ),
            ),
        )
    }
}

@Composable
private fun rememberDecodedAsset(path: String?): ImageBitmap? {
    val context = LocalContext.current
    return remember(path, context) {
        path?.let {
            runCatching { context.assets.open(it).use(BitmapFactory::decodeStream)?.asImageBitmap() }
                .getOrNull()
        }
    }
}

/**
 * The scanner's progress panel: the coloured cycling part tiles with a rolling
 * time, the phase with a percentage that warms from red to green, the per-frame
 * attempt line, and the Rainbow Road bar with a rider on the head of it.
 *
 * The tiles and the time are deliberately decorative — they say "the scanner is
 * working through characters, karts, tires, gliders and flags", not what it has
 * found. Every honest fact is in the phase, the percentage and the attempt line.
 */
@Composable
internal fun ScanProgressPanel(
    progress: ResultImageAnalysisProgress,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    val tiles = rememberScanCycleTiles()
    var cycleIndex by remember { mutableStateOf(0) }
    var cycleTime by remember { mutableStateOf("0:00.000") }
    val random = remember { Random(System.nanoTime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(CYCLE_INTERVAL_MS)
            cycleIndex += 1
            cycleTime = "%d:%02d.%03d".format(
                random.nextInt(3),
                random.nextInt(60),
                random.nextInt(1000),
            )
        }
    }
    val tileSize = if (compact) 26.dp else 32.dp
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle, RoundedCornerShape(12.dp))
            .padding(if (compact) 10.dp else 14.dp)
            .testTag("scan-progress-panel"),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tiles.forEach { tile ->
                val path = tile.assetPaths.getOrNull(
                    if (tile.assetPaths.isEmpty()) 0 else cycleIndex % tile.assetPaths.size,
                )
                val artwork = rememberDecodedAsset(path)
                Box(
                    Modifier.size(tileSize)
                        .clip(RoundedCornerShape(7.dp))
                        .background(colors.surfaceControl)
                        .border(2.dp, tile.accent, RoundedCornerShape(7.dp))
                        .padding(3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (artwork != null) {
                        Image(
                            bitmap = artwork,
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
            Text(
                cycleTime,
                color = colors.textTertiary,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = if (compact) 13.sp else 15.sp,
                maxLines = 1,
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                progress.phase,
                color = colors.textPrimary,
                fontWeight = FontWeight.Bold,
                fontSize = if (compact) 13.sp else 15.sp,
                maxLines = 1,
                modifier = Modifier.weight(1f).testTag("scan-progress-phase"),
            )
            Text(
                "${(progress.fraction * 100).toInt()}%",
                color = scanPercentInk(progress.fraction),
                fontWeight = FontWeight.Bold,
                fontSize = if (compact) 13.sp else 15.sp,
            )
            Text(" 🏁", fontSize = if (compact) 13.sp else 15.sp)
        }
        Text(
            progress.attemptLine(),
            color = colors.textSecondary,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            maxLines = 1,
            // A minimum, not a fixed height: at 12sp the descenders of "attempt"
            // and "poging" need the full line box, and the row must still hold
            // its place while the line is empty.
            modifier = Modifier.heightIn(min = 18.dp),
        )
        RainbowRoadBar(
            fraction = progress.fraction,
            modifier = Modifier.fillMaxWidth().height(34.dp).padding(top = 4.dp),
        )
    }
}

/** The percentage warms from the scanner's red to its green as work completes. */
private fun scanPercentInk(fraction: Float): Color = Color(
    red = (248 + (74 - 248) * fraction).toInt().coerceIn(0, 255),
    green = (113 + (222 - 113) * fraction).toInt().coerceIn(0, 255),
    blue = (113 + (128 - 113) * fraction).toInt().coerceIn(0, 255),
)

@Composable
private fun ResultImageAnalysisProgress.attemptLine(): String = when {
    attemptCount <= 0 -> ""
    identityOnly -> "$framePercent%"
    else -> {
        val base = "${androidText("attempt", "poging")} $attemptIndex/$attemptCount · $framePercent%"
        if (difficultFrame) "$base — ${androidText("tricky image", "beeld is lastig")}" else base
    }
}

/**
 * The Rainbow Road bar with a rider on the head of it. The rider is one of the
 * character portraits the app already ships, picked per run.
 */
@Composable
private fun RainbowRoadBar(fraction: Float, modifier: Modifier = Modifier) {
    val animated by animateFloatAsState(
        targetValue = fraction,
        animationSpec = tween(durationMillis = 500),
        label = "scan-progress",
    )
    val headPath = remember {
        AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER)
            .map { it.assetPath }
            .randomOrNull()
    }
    val head = rememberDecodedAsset(headPath)
    var barWidthPx by remember { mutableStateOf(0f) }
    val density = LocalDensity.current
    val trackColor = Mk8dxTheme.colors.borderSubtle
    Box(modifier.testTag("scan-rainbow-progress")) {
        Canvas(Modifier.fillMaxSize()) {
            barWidthPx = size.width
            val trackHeight = size.height * .24f
            val radius = CornerRadius(trackHeight / 2f, trackHeight / 2f)
            val top = (size.height - trackHeight) / 2f
            drawRoundRect(
                color = trackColor,
                topLeft = Offset(0f, top),
                size = Size(size.width, trackHeight),
                cornerRadius = radius,
            )
            val filled = (size.width * animated).coerceIn(trackHeight, size.width)
            drawRoundRect(
                brush = Brush.horizontalGradient(ScanRainbow, startX = 0f, endX = size.width),
                topLeft = Offset(0f, top),
                size = Size(filled, trackHeight),
                cornerRadius = radius,
            )
        }
        val headOffset = with(density) {
            val centre = (barWidthPx * animated).coerceIn(0f, barWidthPx)
            val headPx = 34.dp.toPx()
            (centre - headPx / 2f).coerceIn(0f, (barWidthPx - headPx).coerceAtLeast(0f)).toDp()
        }
        if (head != null) {
            Image(
                bitmap = head,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(34.dp).offset(x = headOffset).align(Alignment.CenterStart),
            )
        } else {
            Box(
                Modifier.size(34.dp).offset(x = headOffset).align(Alignment.CenterStart),
                contentAlignment = Alignment.Center,
            ) {
                Text("🏎️", fontSize = 26.sp)
            }
        }
    }
}

/** Width the panel wants when there is room for it, as the scanner sizes it. */
internal val ScanProgressPanelWidth = 368.dp
