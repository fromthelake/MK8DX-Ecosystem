package nl.mariokart8.mk8dxtimetrials.ecosystem

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

// Share a run as a picture (owner 2026-09-29: "add the cup, track, cc image ... character, body,
// tire, glider, mushroom, coins. I think it's better for engagement than plain old boring text").
// The Web draws the same card (apps/timetrials-web/src/run-share-card.ts); change one and change
// the other. The text beside the picture carries the link that opens these Details (ADR-0199 &run=).

internal data class AndroidRunShareLap(val lapNumber: Int, val timeMs: Long, val coins: Int?, val mushrooms: Int?)

internal data class AndroidRunShareModel(
    val trackId: String,
    val trackName: String,
    val cupName: String,
    val cupAsset: String?,
    val trackAsset: String?,
    val mode: Int,
    val playerName: String,
    val rank: Int?,
    val timeMs: Long,
    /** (asset path, name) per kart part. */
    val parts: List<Pair<String, String>>,
    val laps: List<AndroidRunShareLap>,
    val coinAsset: String,
    val mushroomAsset: String,
    val url: String,
)

/** The link a shared run carries: that leaderboard, with that run's Details open. Short where it
 *  can be, as the Web's (ADR-0199): the track's catalog index and the run's 8-character code. */
internal fun androidRunShareUrl(origin: String, trackId: String, mode: Int, resultId: String): String {
    val index = Schema9AndroidTrackCatalog.find(trackId)?.index
    val board = if (index == null) "leaderboard=${linkPart(trackId)}" else "lb=$index"
    val code = androidRunCode(resultId)
    return "$origin/?$board&mode=$mode&run=${linkPart(if (code.length == 8) code else resultId)}"
}

/** The 8-character code of a result id, as the Web's `runCode` (`firebase_41c260da...` -> `41c260da`). */
internal fun androidRunCode(resultId: String): String =
    resultId.removePrefix("user_submission.time.").replace(Regex("^(?i)(?:firebase_|livetrial)"), "")
        .lowercase().replace(Regex("[^a-z0-9]"), "").take(8)

/** The one result a link's `run` names among `resultIds`, or null (none, or more than one). */
internal fun androidFindRun(resultIds: List<String>, run: String): String? {
    resultIds.firstOrNull { it == run || it.removePrefix("user_submission.time.") == run }?.let { return it }
    val code = run.lowercase()
    if (!Regex("[a-z0-9]{6,32}").matches(code)) return null
    return resultIds.filter { androidRunCode(it) == code.take(8) }.singleOrNull()
}

private fun linkPart(value: String): String = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")

internal fun androidRunTime(timeMs: Long): String {
    val minutes = timeMs / 60_000
    val seconds = (timeMs % 60_000) / 1_000
    return String.format(Locale.ROOT, "%d:%02d.%03d", minutes, seconds, timeMs % 1_000)
}

/** The words beside the picture: who, where, which class, the time and place, and the link. */
internal fun androidRunShareText(model: AndroidRunShareModel): String {
    val place = model.rank?.let { " (#$it)" } ?: ""
    return "${model.playerName} · ${model.trackName} ${model.mode}cc · ${androidRunTime(model.timeMs)}$place\n${model.url}"
}

internal fun androidRunShareFileName(model: AndroidRunShareModel): String {
    fun slug(value: String) = value.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "-").trim('-')
    return "mk8dx-${slug(model.trackName)}-${model.mode}cc-${slug(model.playerName)}.png"
}

/** A published result as the card shows it. */
internal fun androidRunShareModelOf(
    result: AndroidPublicTimeTrialResult,
    rank: Int?,
    parts: List<Pair<String, String>?>,
    origin: String,
): AndroidRunShareModel {
    val track = Schema9AndroidTrackCatalog.find(result.trackId)
    val cup = Schema9AndroidTrackCatalog.cups.firstOrNull { cup -> cup.tracks.any { it.id == result.trackId } }
    val laps = result.laps.sortedBy { it.lapNumber }
    val gains = androidLapCoinGains(laps.map { it.coinsCollected })
    return AndroidRunShareModel(
        trackId = result.trackId,
        trackName = track?.displayName ?: result.trackId,
        cupName = cup?.displayName ?: "",
        cupAsset = track?.let { "private-product/img/cup/${it.index / 4}.png" },
        trackAsset = track?.let { "private-product/img/track/${it.index}.png" },
        mode = result.mode,
        playerName = result.playerDisplayName,
        rank = rank,
        timeMs = result.totalTimeMs,
        parts = parts.filterNotNull(),
        laps = laps.mapIndexed { index, lap ->
            AndroidRunShareLap(lap.lapNumber, lap.timeMs, gains.getOrNull(index), lap.mushroomsUsed)
        },
        coinAsset = activityCurrencyAsset(result.trackId).first,
        mushroomAsset = "private-product/img/item/mushroom.png",
        url = androidRunShareUrl(origin, result.trackId, result.mode, result.resultId),
    )
}

// ------------------------------------------------------------ drawing (logical px, drawn at 2x)

private const val WIDTH = 540f
private const val SCALE = 2f
private const val HEADER = 236f
private const val LAP_ROW = 30f
private const val PAGE = 0xFF0E1422.toInt()
private const val CARD = 0xFF161E33.toInt()
private const val LINE = 0xFF2A3552.toInt()
private const val TEXT = 0xFFEEF1FA.toInt()
private const val MUTED = 0xFF9AA3BD.toInt()
private const val E150 = 0xFF2F6FE0.toInt()
private const val E200 = 0xFFD2334A.toInt()
private const val GOLD = 0xFFF5B301.toInt()
private const val SILVER = 0xFFC0C7D4.toInt()
private const val BRONZE = 0xFFCD7F32.toInt()

internal fun androidRunShareHeight(lapCount: Int): Float =
    HEADER + 96f + 132f + (if (lapCount == 0) 0f else 36f + lapCount * LAP_ROW) + 56f

private fun paint(size: Float, bold: Boolean, color: Int, align: Paint.Align = Paint.Align.LEFT, mono: Boolean = false) =
    Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        textAlign = align
        typeface = Typeface.create(if (mono) Typeface.MONOSPACE else Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

private fun fit(value: String, paint: Paint, maxWidth: Float): String {
    if (paint.measureText(value) <= maxWidth) return value
    var cut = value
    while (cut.length > 1 && paint.measureText("$cut…") > maxWidth) cut = cut.dropLast(1)
    return "$cut…"
}

private fun Canvas.image(bitmap: Bitmap?, x: Float, y: Float, width: Float, height: Float, cover: Boolean = false) {
    if (bitmap == null) return
    val scale = if (cover) max(width / bitmap.width, height / bitmap.height) else min(width / bitmap.width, height / bitmap.height)
    val drawWidth = bitmap.width * scale
    val drawHeight = bitmap.height * scale
    save()
    clipRect(x, y, x + width, y + height)
    val left = x + (width - drawWidth) / 2
    val top = y + (height - drawHeight) / 2
    drawBitmap(bitmap, Rect(0, 0, bitmap.width, bitmap.height), RectF(left, top, left + drawWidth, top + drawHeight),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    restore()
}

internal fun androidRenderRunShareCard(model: AndroidRunShareModel, load: (String) -> Bitmap?): Bitmap {
    val height = androidRunShareHeight(model.laps.size)
    val bitmap = Bitmap.createBitmap((WIDTH * SCALE).toInt(), (height * SCALE).toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(SCALE, SCALE)
    canvas.drawColor(PAGE)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG)

    // The track across the top, darkened towards its name.
    canvas.image(model.trackAsset?.let(load), 0f, 0f, WIDTH, HEADER, cover = true)
    fill.shader = LinearGradient(0f, HEADER * 0.35f, 0f, HEADER, 0x000E1422, 0xEB0E1422.toInt(), Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, WIDTH, HEADER, fill)
    fill.shader = null
    canvas.image(model.cupAsset?.let(load), 18f, 16f, 52f, 52f)
    // The engine class, as the product marks it: one chevron for 150cc, two for 200cc.
    fill.color = if (model.mode == 200) E200 else E150
    canvas.drawRoundRect(RectF(WIDTH - 118f, 18f, WIDTH - 18f, 52f), 6f, 6f, fill)
    canvas.drawText("${if (model.mode == 200) "»" else "›"} ${model.mode}cc", WIDTH - 68f, 42f, paint(18f, true, 0xFFFFFFFF.toInt(), Paint.Align.CENTER))
    val title = paint(28f, true, TEXT)
    canvas.drawText(fit(model.trackName, title, WIDTH - 40f), 20f, HEADER - 34f, title)
    canvas.drawText(model.cupName, 20f, HEADER - 12f, paint(15f, false, MUTED))

    // Who drove it, the place and the time.
    fill.color = CARD
    canvas.drawRect(0f, HEADER, WIDTH, HEADER + 96f, fill)
    var y = HEADER + 20f
    val rankColor = when (model.rank) { 1 -> GOLD; 2 -> SILVER; 3 -> BRONZE; else -> MUTED }
    model.rank?.let { canvas.drawText("#$it", 20f, y + 30f, paint(24f, true, rankColor, mono = true)) }
    val name = paint(24f, true, TEXT)
    canvas.drawText(fit(model.playerName, name, 200f), if (model.rank == null) 20f else 90f, y + 30f, name)
    canvas.drawText(androidRunTime(model.timeMs), WIDTH - 20f, y + 36f, paint(40f, true, TEXT, Paint.Align.RIGHT, mono = true))
    y = HEADER + 96f

    // The kart setup: each part's picture with its name under it.
    fill.color = LINE
    canvas.drawRect(20f, y, WIDTH - 20f, y + 1f, fill)
    val column = (WIDTH - 40f) / 4f
    val partName = paint(13f, false, MUTED, Paint.Align.CENTER)
    model.parts.take(4).forEachIndexed { index, (asset, label) ->
        val centre = 20f + column * index + column / 2f
        canvas.image(load(asset), centre - 32f, y + 14f, 64f, 64f)
        canvas.drawText(fit(label, partName, column - 8f), centre, y + 104f, partName)
    }
    if (model.parts.isEmpty()) canvas.drawText("Kart setup not recorded", WIDTH / 2f, y + 70f, paint(14f, false, MUTED, Paint.Align.CENTER))
    y += 132f

    // The laps, with the coins gained and mushrooms used named by their pictures.
    if (model.laps.isNotEmpty()) {
        fill.color = LINE
        canvas.drawRect(20f, y, WIDTH - 20f, y + 1f, fill)
        val coinX = 330f
        val mushroomX = 440f
        canvas.drawText("Lap", 24f, y + 24f, paint(13f, true, MUTED))
        canvas.image(load(model.coinAsset), coinX - 11f, y + 8f, 22f, 22f)
        canvas.image(load(model.mushroomAsset), mushroomX - 11f, y + 8f, 22f, 22f)
        y += 36f
        val number = paint(16f, true, MUTED, mono = true)
        val time = paint(18f, false, TEXT, mono = true)
        val count = paint(18f, false, TEXT, Paint.Align.CENTER, mono = true)
        model.laps.forEach { lap ->
            canvas.drawText(lap.lapNumber.toString(), 30f, y + 20f, number)
            canvas.drawText(androidRunTime(lap.timeMs), 80f, y + 20f, time)
            canvas.drawText(lap.coins?.toString() ?: "–", coinX, y + 20f, count)
            canvas.drawText(lap.mushrooms?.toString() ?: "–", mushroomX, y + 20f, count)
            y += LAP_ROW
        }
    }

    // Where it lives.
    fill.color = CARD
    canvas.drawRect(0f, height - 56f, WIDTH, height, fill)
    canvas.drawText("MK8DX Time Trials", 20f, height - 22f, paint(15f, true, TEXT))
    val host = runCatching { Uri.parse(model.url).host }.getOrNull() ?: ""
    canvas.drawText(host, WIDTH - 20f, height - 22f, paint(15f, false, MUTED, Paint.Align.RIGHT))
    return bitmap
}

/**
 * Opens the share sheet with the run's picture, its words and its link, the way a tournament
 * board is shared. Returns false when the picture could not be made.
 */
internal fun androidShareRun(context: Context, model: AndroidRunShareModel, chooserTitle: String): Boolean = runCatching {
    val cache = HashMap<String, Bitmap?>()
    val load: (String) -> Bitmap? = { path ->
        cache.getOrPut(path) { runCatching { context.assets.open(path).use(BitmapFactory::decodeStream) }.getOrNull() }
    }
    val bytes = ByteArrayOutputStream().use { out ->
        androidRenderRunShareCard(model, load).compress(Bitmap.CompressFormat.PNG, 100, out)
        out.toByteArray()
    }
    val folder = java.io.File(context.cacheDir, "mk8dx-result-images").apply { mkdirs() }
    val file = java.io.File(folder, androidRunShareFileName(model)).apply { writeBytes(bytes) }
    val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.result-image-provider", file)
    context.startActivity(
        Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, androidRunShareText(model))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            chooserTitle,
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    true
}.getOrDefault(false)

/**
 * A shared run's link lands on its track (ADR-0199 `&run=`); the board opens that run's Details
 * once. The request is state, so a board already on screen sees it too, and it is only cleared
 * when the row has opened. One pending run at a time.
 */
internal object AndroidRunFocus {
    private var pending by androidx.compose.runtime.mutableStateOf<Pair<String, String>?>(null)

    fun request(trackId: String, resultId: String?) {
        pending = resultId?.let { trackId to it }
    }

    /** The run waiting to be opened on this track, if any. */
    fun pendingFor(trackId: String): String? = pending?.takeIf { it.first == trackId }?.second

    fun opened() {
        pending = null
    }
}
