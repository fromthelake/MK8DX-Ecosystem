package nl.mariokart8.mk8dxtimetrials.tournament

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import nl.mariokart8.mk8dxtimetrials.R

/** The actual PNG board, scaled to the phone width like the source preview. */
@Composable
internal fun AndroidTournamentExportPreview(
    document: AndroidTournamentDocument,
    stage: String,
    mode: AndroidExportMode,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val ns1 = remember(context) { BitmapFactory.decodeResource(context.resources, R.drawable.mk8dx_ns1) }
    val ns2 = remember(context) { BitmapFactory.decodeResource(context.resources, R.drawable.mk8dx_ns2) }
    val model = remember(document, stage, mode) {
        if (mode == AndroidExportMode.LAYOUT) androidLayoutImageModel(document, stage)
        else androidResultsImageModel(document, stage)
    }
    val bitmap = remember(model, ns1, ns2) {
        androidRenderExportImage(
            model = model,
            minimums = androidExportMinimums(
                if (mode == AndroidExportMode.LAYOUT) "layout" else "results",
                isQualifier = stage != "final",
            ),
            ns1Icon = ns1,
            ns2Icon = ns2,
        )
    }
    DisposableEffect(bitmap) {
        onDispose { if (!bitmap.isRecycled) bitmap.recycle() }
    }
    Image(
        bitmap = bitmap.asImageBitmap(),
        contentDescription = "${model.title} · visuele PNG-preview",
        contentScale = ContentScale.FillWidth,
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(bitmap.width.toFloat() / bitmap.height.toFloat())
            .testTag(testTag),
    )
}
