package nl.mariokart8.mk8dxtimetrials.builds

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchPresentationCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidDutchUiCopy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.androidLocalizedPresentation
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPickerTile
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/* The four part colours are the builder's own key: the meter segments, the
   legend and each slot's caption name the same part in the same colour, so they
   are product data like a tier colour, not a route palette. */
private val CharacterColor = Color(0xFFFF9800)
private val BodyColor = Color(0xFF2196F3)
private val TireColor = Color(0xFF2ECC71)
private val GliderColor = Color(0xFF9B27B0)
private const val EFFECTIVE_CAP = 5.75

internal data class AndroidBuildSelection(
    val character: AndroidBuildPart,
    val body: AndroidBuildPart,
    val tire: AndroidBuildPart,
    val glider: AndroidBuildPart,
) {
    fun part(category: AndroidBuildPartCategory): AndroidBuildPart = when (category) {
        AndroidBuildPartCategory.CHARACTER -> character
        AndroidBuildPartCategory.BODY -> body
        AndroidBuildPartCategory.TIRE -> tire
        AndroidBuildPartCategory.GLIDER -> glider
    }

    fun replace(category: AndroidBuildPartCategory, part: AndroidBuildPart): AndroidBuildSelection = when (category) {
        AndroidBuildPartCategory.CHARACTER -> copy(character = part)
        AndroidBuildPartCategory.BODY -> copy(body = part)
        AndroidBuildPartCategory.TIRE -> copy(tire = part)
        AndroidBuildPartCategory.GLIDER -> copy(glider = part)
    }
}

internal data class AndroidBuildMetaAssessment(
    val groundSpeed: Double,
    val miniTurbo: Double,
    val optimum: Boolean,
    val meta: Boolean,
    val explanation: String,
)

internal fun assessAndroidBuild(selection: AndroidBuildSelection): AndroidBuildMetaAssessment {
    fun total(index: Int): Double = minOf(
        EFFECTIVE_CAP,
        categories.sumOf { category -> selection.part(category).stats[index] },
    )
    val groundSpeed = total(0)
    val miniTurbo = total(11)
    val optimum = kotlin.math.abs(groundSpeed + miniTurbo - 8.0) < .001 && groundSpeed <= miniTurbo
    val meta = kotlin.math.abs(groundSpeed - 3.25) < .001 && kotlin.math.abs(miniTurbo - 4.75) < .001
    val explanation = when {
        meta -> "The Meta: exactly 3.25 Ground Speed and 4.75 Mini-Turbo."
        optimum -> "Optimum Build: Speed + Mini-Turbo is 8.00 and Speed does not exceed Mini-Turbo."
        else -> String.format(Locale.ROOT, "Not optimum yet: Speed + Mini-Turbo is %.2f (target 8.00)%s",
            groundSpeed + miniTurbo,
            if (groundSpeed > miniTurbo) " and Speed is higher than Mini-Turbo." else ".",
        )
    }
    return AndroidBuildMetaAssessment(groundSpeed, miniTurbo, optimum, meta, explanation)
}

private val categories = listOf(
    AndroidBuildPartCategory.CHARACTER,
    AndroidBuildPartCategory.BODY,
    AndroidBuildPartCategory.TIRE,
    AndroidBuildPartCategory.GLIDER,
)
private fun buildParts(category: AndroidBuildPartCategory): List<AndroidBuildPart> =
    if (category == AndroidBuildPartCategory.CHARACTER) AndroidLoadoutVariants.characterParts(AndroidLoadoutCatalog.parts(category))
    else AndroidLoadoutCatalog.parts(category)

private fun buildPartMatchesQuery(part: AndroidBuildPart, query: String): Boolean {
    val tokens = query.trim().split(Regex("\\s+")).filter(String::isNotBlank)
    if (tokens.isEmpty()) return true
    val dutch = AndroidDutchUiCopy.translate(AndroidDutchPresentationCatalog.translate(part.name))
    val searchable = "${part.name}\n$dutch".lowercase(Locale.forLanguageTag("nl-NL"))
    return tokens.all { it.lowercase(Locale.forLanguageTag("nl-NL")) in searchable }
}

private fun presentedAssetPath(part: AndroidBuildPart, characterId: String): String =
    AndroidLoadoutVariants.matched(part.id, characterId)?.assetPath ?: part.assetPath

/**
 * Build (A05), on the design system (Phase 12).
 *
 * A LOW-spectacle data screen: token surfaces, one hairline per panel, the
 * figures in tabular Plex Mono and the part art as the only art on the page.
 * The builder's four part colours stay, because the meter, the legend and the
 * slots use them to say which part paid for a number.
 */
@Composable
internal fun AndroidBuildScreen(
    websiteOrigin: String = nl.mariokart8.mk8dxtimetrials.BuildConfig.MK8DX_API_ORIGIN,
    /**
     * A combo to open with, in the order character, body, tyre, glider. An
     * Activity row hands its own loadout over here, the way the web combo
     * summary links to `/?build=...`; unknown or missing ids fall back to the
     * catalogue's first part for that category.
     */
    requestedPartIds: List<String> = emptyList(),
    modifier: Modifier = Modifier,
) {
    var selection by remember(requestedPartIds) {
        fun seed(category: AndroidBuildPartCategory, index: Int): AndroidBuildPart {
            val requested = requestedPartIds.getOrNull(index)
            val catalogue = buildParts(category)
            return catalogue.firstOrNull { it.id == requested }
                ?: AndroidLoadoutCatalog.find(requested)
                // A colour variant that this category does not list
                // still names the part it is a colour of.
                ?: AndroidLoadoutVariants.byId(requested)
                    ?.let { AndroidLoadoutCatalog.find(it.baseId) }
                ?: catalogue.first()
        }
        mutableStateOf(
            AndroidBuildSelection(
                seed(AndroidBuildPartCategory.CHARACTER, 0),
                seed(AndroidBuildPartCategory.BODY, 1),
                seed(AndroidBuildPartCategory.TIRE, 2),
                seed(AndroidBuildPartCategory.GLIDER, 3),
            ),
        )
    }
    var picker by remember { mutableStateOf<AndroidBuildPartCategory?>(null) }
    val context = LocalContext.current
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            .verticalScroll(rememberScrollState())
            .padding(Mk8dxSpacing.gutterPhone)
            .testTag("build-screen"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Mk8dxSectionLabel("BUILD")
        Mk8dxDisplayText(
            androidLocalizedPresentation("MK8DX Kart Builder"),
            Mk8dxTheme.type.display6,
        )
        Text(
            "Choose every part and compare the real in-game stat contributions.",
            color = colors.textSecondary,
            style = Mk8dxTheme.type.body,
        )
        Mk8dxPanel(null) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                categories.forEach { category ->
                    BuildPartTile(
                        category,
                        selection.part(category),
                        selection.character.id,
                        onClick = { picker = category },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        BuildStats(selection)
        Mk8dxButton(
            androidLocalizedPresentation("Share build"),
            {
                val url = "${websiteOrigin.trimEnd('/')}/?build=" + listOf(
                    selection.character.id,
                    selection.body.id,
                    selection.tire.id,
                    selection.glider.id,
                ).joinToString(",")
                val text = "MK8DX kart build\n" +
                    "Character: ${selection.character.name}\n" +
                    "Body: ${selection.body.name}\n" +
                    "Tires: ${selection.tire.name}\n" +
                    "Glider: ${selection.glider.name}\n\n$url"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }, "Share build"))
            },
            variant = Mk8dxButtonVariant.Secondary,
            modifier = Modifier.fillMaxWidth().testTag("build-share"),
        )
    }
    picker?.let { category ->
        BuildPartPicker(
            category = category,
            selected = selection.part(category),
            characterId = selection.character.id,
            onSelect = { part -> selection = selection.replace(category, part); picker = null },
            onDismiss = { picker = null },
        )
    }
}

@Composable
private fun BuildPartTile(
    category: AndroidBuildPartCategory,
    part: AndroidBuildPart,
    characterId: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = category.color()
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceControl)
            .border(1.dp, colors.borderSubtle)
            // The slot's colour is its edge, not the ink of its name: an orange
            // or green caption would miss the contrast floor on the Light
            // surface, and an inline swatch breaks up at font scale 2.0.
            .drawBehind { drawRect(color, size = Size(3.dp.toPx(), size.height)) }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(Mk8dxSpacing.xs)
            .semantics(mergeDescendants = true) { }
            .testTag("build-part-${category.name.lowercase()}"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
    ) {
        ProductAssetImage(
            path = presentedAssetPath(part, characterId),
            fallback = part.name.take(1),
            accent = color,
            modifier = Modifier.fillMaxWidth().height(78.dp).padding(Mk8dxSpacing.xs),
        )
        Text(
            category.label(),
            color = colors.textSecondary,
            style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold),
            textAlign = TextAlign.Center,
        )
        Text(
            part.name,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            style = Mk8dxTheme.type.bodyS,
            color = colors.textPrimary,
            textAlign = TextAlign.Center,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BuildStats(selection: AndroidBuildSelection) {
    val colors = Mk8dxTheme.colors
    val assessment = assessAndroidBuild(selection)
    Mk8dxPanel(
        androidLocalizedPresentation("BUILD STATS"),
        modifier = Modifier.testTag("build-stats"),
    ) {
        BuildLegend()
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg)) {
            Mk8dxStatBlock(
                androidLocalizedPresentation("Speed"),
                String.format(Locale.ROOT, "%.2f", assessment.groundSpeed),
                Modifier.weight(1f),
                large = true,
            )
            Mk8dxStatBlock(
                "Mini-Turbo",
                String.format(Locale.ROOT, "%.2f", assessment.miniTurbo),
                Modifier.weight(1f),
                large = true,
            )
        }
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            Mk8dxChip(
                androidLocalizedPresentation(
                    if (assessment.optimum) "✓ Optimum Build" else "✕ Not optimum",
                ),
                tone = if (assessment.optimum) Mk8dxChipTone.Success else Mk8dxChipTone.Neutral,
            )
            Mk8dxChip(
                androidLocalizedPresentation(
                    if (assessment.meta) "★ The Meta" else "☆ Not The Meta",
                ),
                tone = if (assessment.meta) Mk8dxChipTone.Warning else Mk8dxChipTone.Neutral,
            )
        }
        Text(
            assessment.explanation,
            style = Mk8dxTheme.type.bodyS,
            color = colors.textSecondary,
        )
        Text(
            "Meta target: combine any character, body, tires and glider that reach exactly 3.25 Ground Speed and 4.75 Mini-Turbo. Optimum alternatives follow the Magic 8 rule: both stats total 8.00 and Ground Speed is not higher than Mini-Turbo.",
            style = Mk8dxTheme.type.bodyS,
            color = colors.textSecondary,
            modifier = Modifier.testTag("build-meta-explanation"),
        )
        val sections = listOf(
            "Speed" to listOf(0 to "Ground", 1 to "Water", 3 to "Air", 2 to "Anti-Gravity"),
            "Handling" to listOf(6 to "Ground", 7 to "Water", 9 to "Air", 8 to "Anti-Gravity"),
            "Other" to listOf(4 to "Acceleration", 11 to "Mini-Turbo", 5 to "Weight", 10 to "Traction", 12 to "Invincibility"),
        )
        sections.forEach { (title, rows) ->
            Mk8dxSectionLabel(
                androidLocalizedPresentation(title).uppercase(Locale.ROOT),
                Modifier.padding(top = Mk8dxSpacing.sm),
            )
            rows.forEach { (index, label) -> BuildStatRow(label, index, selection) }
        }
    }
}

/** The key to the meter's colours; it wraps rather than clipping at scale 2.0. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BuildLegend() {
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        categories.forEach { category ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).background(category.color()))
                Text(
                    category.label(),
                    style = Mk8dxTheme.type.micro,
                    color = Mk8dxTheme.colors.textSecondary,
                    modifier = Modifier.padding(start = Mk8dxSpacing.xs),
                )
            }
        }
    }
}

/**
 * One stat, as the meter the web ships: the name and "total/cap" on one line,
 * and a track underneath carrying each part's own contribution in its own
 * colour. Reading a build means reading which part paid for the number.
 *
 * The number inside a segment is measured rather than assumed: where the font
 * scale leaves no room for four of them, the segments stay and the
 * contributions are printed underneath instead of being clipped.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BuildStatRow(label: String, statIndex: Int, selection: AndroidBuildSelection) {
    val colors = Mk8dxTheme.colors
    val contributions = categories.map { category ->
        maxOf(0.0, selection.part(category).stats[statIndex])
    }
    val total = minOf(EFFECTIVE_CAP, contributions.sum())
    val valueStyle = Mk8dxTheme.type.dataS.copy(fontWeight = FontWeight.Bold)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val segmentMin = remember(valueStyle, density) {
        val measured = with(density) { measurer.measure("0.00", valueStyle).size.width.toDp() }
        maxOf(22.dp, measured + Mk8dxSpacing.sm)
    }
    val meterHeight = remember(valueStyle, density) {
        val measured = with(density) { measurer.measure("0.00", valueStyle).size.height.toDp() }
        maxOf(22.dp, measured + Mk8dxSpacing.xs)
    }
    Column(Modifier.fillMaxWidth().padding(vertical = Mk8dxSpacing.xxs)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = Mk8dxTheme.type.bodyS,
                color = colors.textBody,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                String.format(Locale.ROOT, "%.2f/%.2f", total, EFFECTIVE_CAP),
                color = colors.textPrimary,
                style = Mk8dxTheme.type.dataS,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.padding(start = Mk8dxSpacing.sm),
            )
        }
        val shown = mutableListOf<Pair<Int, Double>>()
        var remaining = total
        contributions.forEachIndexed { index, contribution ->
            val part = minOf(remaining, contribution)
            if (part > 0) { shown += index to part; remaining -= part }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.xxs)) {
            val track = maxWidth
            // Proportional widths, but never below the room a two-decimal
            // number needs; the overflow that floor can cause is taken off the
            // widest segment so the fill still ends where the total says. Where
            // the font scale leaves no room for the numbers inside the track,
            // the segments keep their colours and the numbers move underneath.
            val numbersFit = segmentMin * shown.size <= track
            val floor = if (numbersFit) segmentMin else 2.dp
            val widths = shown.map { (_, value) ->
                maxOf(floor, track * (value / EFFECTIVE_CAP).toFloat())
            }.toMutableList()
            val overflow = widths.fold(0.dp) { sum, width -> sum + width } - track
            if (overflow > 0.dp && widths.isNotEmpty()) {
                val widest = widths.indices.maxByOrNull { widths[it].value } ?: 0
                widths[widest] = maxOf(floor, widths[widest] - overflow)
            }
            Column(Modifier.fillMaxWidth()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = meterHeight)
                        .background(colors.surfaceControl)
                        .border(1.dp, colors.borderStrong),
                ) {
                    Row(Modifier.fillMaxWidth().heightIn(min = meterHeight)) {
                        shown.forEachIndexed { position, entry ->
                            val category = categories[entry.first]
                            Box(
                                Modifier.width(widths[position]).fillMaxHeight()
                                    .background(category.color()),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (numbersFit) {
                                    Text(
                                        String.format(Locale.ROOT, "%.2f", entry.second),
                                        color = category.statInk(),
                                        style = valueStyle,
                                        maxLines = 1,
                                        softWrap = false,
                                    )
                                }
                                // The web segment's inset right shadow: the seam
                                // that keeps two contributions readable as two.
                                Box(
                                    Modifier
                                        .align(Alignment.CenterEnd)
                                        .width(1.dp)
                                        .fillMaxHeight()
                                        .background(colors.scrim),
                                )
                            }
                        }
                    }
                    // The empty remainder keeps the scale legible with a
                    // hairline at every whole point, at the top and bottom edge.
                    // 1 to 5 on the 5.75 cap, the same lines as the Web (owner 2026-09-26: 5.00 was missing).
                    (1..EFFECTIVE_CAP.toInt()).forEach { tick ->
                        val x = track * (tick.toFloat() / EFFECTIVE_CAP.toFloat())
                        listOf(Alignment.TopStart, Alignment.BottomStart).forEach { edge ->
                            Box(
                                Modifier
                                    .align(edge)
                                    .offset(x = x)
                                    .width(1.dp)
                                    .height(4.dp)
                                    .background(colors.borderControl),
                            )
                        }
                    }
                }
                if (!numbersFit && shown.isNotEmpty()) {
                    FlowRow(
                        Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.xxs),
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    ) {
                        shown.forEach { (index, value) ->
                            val category = categories[index]
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
                            ) {
                                Box(Modifier.size(8.dp).background(category.color()))
                                Text(
                                    "${category.label()} ${String.format(Locale.ROOT, "%.2f", value)}",
                                    style = Mk8dxTheme.type.dataS,
                                    color = colors.textBody,
                                    maxLines = 1,
                                    softWrap = false,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* The ink each segment prints its own contribution in. Phase 17: measured from
   the part's own colour rather than listed beside it, so the four can never
   disagree and a changed part colour cannot leave an unreadable caption. */
private fun AndroidBuildPartCategory.statInk(): Color = Mk8dxTheme.inkOn(color())

@Composable
private fun BuildPartPicker(
    category: AndroidBuildPartCategory,
    selected: AndroidBuildPart,
    characterId: String,
    onSelect: (AndroidBuildPart) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember(category) { mutableStateOf("") }
    val parts = remember(category, query) {
        buildParts(category).filter { buildPartMatchesQuery(it, query) }
    }
    Mk8dxDialog(
        title = androidLocalizedPresentation("Select ${category.label().lowercase()}"),
        closeLabel = androidLocalizedPresentation("Close"),
        onDismiss = onDismiss,
    ) {
        Mk8dxSearchField(
            androidLocalizedPresentation("Search ${category.label().lowercase()}"),
            query,
            { query = it },
            Modifier.testTag("build-search-${category.name.lowercase()}"),
        )
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 84.dp),
            modifier = Modifier.fillMaxWidth().heightIn(max = 430.dp),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            items(parts, key = AndroidBuildPart::id) { part ->
                Mk8dxPickerTile(
                    label = androidLocalizedPresentation(part.name),
                    selected = part.id == selected.id,
                    onClick = { onSelect(part) },
                ) {
                    ProductAssetImage(
                        path = presentedAssetPath(part, characterId),
                        fallback = part.name.take(1),
                        accent = category.color(),
                        modifier = Modifier.fillMaxWidth().height(70.dp),
                    )
                }
            }
        }
    }
}

private fun AndroidBuildPartCategory.label(): String = when (this) {
    AndroidBuildPartCategory.CHARACTER -> "Character"
    AndroidBuildPartCategory.BODY -> "Body"
    AndroidBuildPartCategory.TIRE -> "Tires"
    AndroidBuildPartCategory.GLIDER -> "Glider"
}

/**
 * The one Android definition of a part category's colour. The scanner's
 * progress panel reads it too, so the builder's key and the scan tiles cannot
 * drift into two palettes for the same four parts.
 */
internal fun AndroidBuildPartCategory.color(): Color = when (this) {
    AndroidBuildPartCategory.CHARACTER -> CharacterColor
    AndroidBuildPartCategory.BODY -> BodyColor
    AndroidBuildPartCategory.TIRE -> TireColor
    AndroidBuildPartCategory.GLIDER -> GliderColor
}
