package nl.mariokart8.mk8dxtimetrials.track

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMark
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxEngineMarkSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * The track catalogue's own rules and its artwork loaders. The chooser that
 * draws them is `AndroidTrackChooser` (Phase 7/9, on the design system); the
 * legacy grid that lived here is retired with A02.
 */
internal const val ANDROID_TRACK_SEARCH_MAX_CODE_POINTS = 64

internal fun filterAndroidTrackCatalog(
    tracks: List<AndroidTrackCatalogEntry>,
    query: String,
): List<AndroidTrackCatalogEntry> {
    val normalized = query.trim().lowercase(Locale.ROOT)
    if (normalized.isEmpty()) return tracks.toList()
    return tracks.filter { track ->
        track.displayName.lowercase(Locale.ROOT).contains(normalized) ||
            AndroidDutchPresentationCatalog.translate(track.displayName)
                .lowercase(Locale.ROOT).contains(normalized) ||
            track.id.lowercase(Locale.ROOT).contains(normalized)
    }
}

internal fun boundedAndroidTrackSearchInput(value: String): String {
    val builder = StringBuilder()
    var offset = 0
    var count = 0
    while (offset < value.length && count < ANDROID_TRACK_SEARCH_MAX_CODE_POINTS) {
        val codePoint = value.codePointAt(offset)
        if (!Character.isISOControl(codePoint)) {
            builder.appendCodePoint(codePoint)
            count += 1
        }
        offset += Character.charCount(codePoint)
    }
    return builder.toString()
}

internal fun cupSelectionLabel(name: String, language: AndroidProductLanguage): String {
    if (language == AndroidProductLanguage.ENGLISH) return name.removeSuffix(" Cup")
    return AndroidDutchPresentationCatalog.translate(name)
        .replace(Regex("(?i)-?beker$"), "")
        .trim()
}

@Composable
internal fun TrackAssetArtwork(
    trackIndex: Int,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    ProductAssetImage(
        path = "private-product/img/track/$trackIndex.png",
        fallback = (trackIndex + 1).toString(),
        accent = Mk8dxTheme.colors.borderStrong,
        modifier = modifier,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
    )
}

@Composable
internal fun ProductAssetImage(
    path: String,
    fallback: String,
    accent: Color,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    contentScale: ContentScale = ContentScale.Fit,
) {
    val context = LocalContext.current
    val image = remember(path, context) {
        runCatching {
            context.assets.open(path).use(BitmapFactory::decodeStream)?.asImageBitmap()
        }.getOrNull()
    }
    if (image != null) {
        Image(
            bitmap = image,
            contentDescription = contentDescription,
            contentScale = contentScale,
            modifier = modifier,
        )
    } else {
        Box(
            modifier
                .clip(RoundedCornerShape(12.dp))
                .background(accent.copy(alpha = .26f))
                .then(
                    if (contentDescription == null) {
                        Modifier
                    } else {
                        Modifier.semantics { this.contentDescription = contentDescription }
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                fallback,
                color = accent,
                fontWeight = FontWeight.Black,
                style = MaterialTheme.typography.titleLarge,
            )
        }
    }
}

/**
 * A track the way this product has always shown one: the artwork with the cup
 * mark in one corner and the engine class in the other.
 *
 * Home invented it and the Rank console now uses it too, so it lives here
 * beside the artwork loader rather than in either screen. The Web has the same
 * thing in `track-thumb.ts`; the two clients should not drift into showing a
 * track differently.
 */
@Composable
internal fun TrackIdentityArtwork(
    trackIndex: Int,
    mode: Int?,
    contentDescription: String,
    modifier: Modifier = Modifier,
    cupTestTag: String? = null,
) {
    Box(
        modifier.clip(RoundedCornerShape(4.dp))
            .border(1.dp, Mk8dxTheme.colors.borderSubtle, RoundedCornerShape(4.dp)),
    ) {
        TrackAssetArtwork(
            trackIndex,
            Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            contentDescription,
        )
        ProductAssetImage(
            path = "private-product/img/cup/${trackIndex / 4}.png",
            fallback = "C",
            accent = Mk8dxTheme.colors.borderStrong,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(3.dp)
                .size(18.dp)
                .then(if (cupTestTag == null) Modifier else Modifier.testTag(cupTestTag)),
        )
        // The engine badge on art is the design system's own filled form
        // (§6): the engine colour, its shape and its figure together, so the
        // class is never colour alone.
        mode?.let {
            Mk8dxEngineMark(
                it,
                modifier = Modifier.align(Alignment.TopEnd),
                size = Mk8dxEngineMarkSize.Art,
            )
        }
    }
}
