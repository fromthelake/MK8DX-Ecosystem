package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * Design-system components for Checkpoint 1 (DESIGN_SYSTEM.md §7, §9, §10,
 * §13, §24): the Compose counterparts of the web's `ds-components.ts`, with
 * the same names and states. Every text comes from the caller. Not used by any
 * product screen before its own migration phase; the debug gallery shows them.
 */

// ------------------------------------------------------------------ shapes & icons

/** The slanted clip (parallelogram) of primary buttons, tags and rank tiles. */
class Mk8dxSlantShape(private val slant: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val s = with(density) { slant.toPx() }.coerceAtMost(size.width / 4)
        return Outline.Generic(Path().apply {
            moveTo(s, 0f); lineTo(size.width, 0f); lineTo(size.width - s, size.height); lineTo(0f, size.height); close()
        })
    }
}

val Mk8dxSlantButton = Mk8dxSlantShape(10.dp)
val Mk8dxSlantButtonSmall = Mk8dxSlantShape(6.dp)
val Mk8dxSlantTag = Mk8dxSlantShape(4.dp)

/**
 * The stroke colour below is the vector template's placeholder, never a drawn
 * colour: every call site paints these icons with `tint`, which replaces it.
 */
private fun strokeIcon(width: Float, height: Float, strokeWidth: Float, vararg paths: String): ImageVector {
    val builder = ImageVector.Builder(defaultWidth = width.dp, defaultHeight = height.dp, viewportWidth = width, viewportHeight = height)
    for (d in paths) {
        builder.addPath(
            pathData = addPathNodes(d), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = strokeWidth,
            strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
        )
    }
    return builder.build()
}

object Mk8dxIcons {
    /** The Time Trial stopwatch (24 grid, 2 px stroke): crown, pusher, dial, hand. */
    val Stopwatch: ImageVector = strokeIcon(
        24f, 24f, 2f,
        "M9.5 2.5h5M12 2.5v3", "M18.2 5.8l1.5-1.5",
        "M12 6.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z", "M12 14V9.6",
    )

    /** One chevron = 150cc, two = 200cc. Decorative; the text always carries the engine. */
    val Engine150: ImageVector = strokeIcon(10f, 12f, 2.4f, "M2.5 2l4 4-4 4")
    val Engine200: ImageVector = strokeIcon(16f, 12f, 2.4f, "M2.5 2l4 4-4 4", "M8.5 2l4 4-4 4")

    /** The scan action (§17): a camera, and never the brand. */
    val Camera: ImageVector = strokeIcon(
        24f, 24f, 2f,
        "M3 8.5h3.5l1.6-2.2h7.8l1.6 2.2H21v10.5H3z",
        "M12 11a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 1 1 0-6.4z",
    )

    /** Proof of a record: a framed play mark, which is an action rather than decoration. */
    val Play: ImageVector = strokeIcon(
        24f, 24f, 2f,
        "M3.5 5.5h17v13h-17z",
        "M10 9.5l5 2.5-5 2.5z",
    )

    /** Edit your own result: a pencil (owner 2026-09-29: "an edit text with edit icon"). */
    val Pencil: ImageVector = strokeIcon(
        24f, 24f, 2f,
        "M4 20h4L19.5 8.5l-4-4L4 16z",
        "M13.5 6.5l4 4",
    )
}

@Composable
private fun EngineShape(engine: Int, color: Color) {
    Icon(
        if (engine == 200) Mk8dxIcons.Engine200 else Mk8dxIcons.Engine150,
        contentDescription = null,
        tint = color,
        modifier = Modifier.size(width = if (engine == 200) 14.dp else 9.dp, height = 11.dp),
    )
}

private fun engineColor(colors: Mk8dxColorTokens, engine: Int): Color =
    if (engine == 200) colors.engine200 else colors.engine150

/** A focus ring drawn inside the clip (inset, 2 dp; 3 dp in HC), never clipped away. */
private fun Modifier.insideFocusRing(focused: Boolean, color: Color, width: Dp, horizontalInset: Dp): Modifier =
    drawWithContent {
        drawContent()
        if (focused) {
            val w = width.toPx()
            val dx = horizontalInset.toPx()
            val dy = 3.dp.toPx()
            drawRect(
                color, topLeft = Offset(dx + w / 2, dy + w / 2),
                size = Size(size.width - 2 * dx - w, size.height - 2 * dy - w), style = Stroke(w),
            )
        }
    }

// ------------------------------------------------------------------ actions (§9)

enum class Mk8dxButtonVariant { Primary, Global, Secondary, Quiet, Danger }
enum class Mk8dxButtonSize { Sm, Md, Lg }

/**
 * Button (§9). A disabled button always says why: the reason line shows under
 * it and is also the button's state description, so TalkBack reads it with
 * "disabled". Loading keeps the button in place with a spinner and its label.
 */
@Composable
fun Mk8dxButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: Mk8dxButtonVariant = Mk8dxButtonVariant.Secondary,
    size: Mk8dxButtonSize = Mk8dxButtonSize.Md,
    stopwatch: Boolean = false,
    camera: Boolean = false,
    /** A publish action may carry the selected engine's fill as a visual reminder. */
    engine: Int? = null,
    disabledReason: String? = null,
    /**
     * False where the reason is already written beside the button — a status
     * line the button sits under. The reason is still the button's state
     * description, so TalkBack hears it with "disabled"; it is only not
     * printed twice.
     */
    disabledReasonShown: Boolean = true,
    loadingLabel: String? = null,
    nextStep: String? = null,
    /**
     * A test tag for the button itself. It belongs on the pressable row rather
     * than on the column around it: that is the node that carries the label,
     * the role and the disabled state, and a product test asserts all three.
     */
    tag: String? = null,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val pressed by interaction.collectIsPressedAsState()
    val disabled = disabledReason != null
    val busy = loadingLabel != null
    val focusWidth = if (Mk8dxTheme.appearance == Mk8dxAppearance.HighContrast) Mk8dxSpacing.focusWidthHighContrast else Mk8dxSpacing.focusWidth
    val slanted = variant == Mk8dxButtonVariant.Primary && !disabled
    val shape: Shape = when {
        !slanted -> RectangleShape
        size == Mk8dxButtonSize.Sm -> Mk8dxSlantButtonSmall
        else -> Mk8dxSlantButton
    }
    val slant = if (!slanted) 0.dp else if (size == Mk8dxButtonSize.Sm) 6.dp else 10.dp
    val content: Color
    val fill: Color
    val edge: Pair<Dp, Color>?
    when {
        disabled -> { content = colors.textTertiary; fill = Color.Transparent; edge = 1.dp to colors.borderStrong }
        variant == Mk8dxButtonVariant.Primary && engine != null -> {
            content = colors.engineOnFill
            fill = if (engine == 200) colors.engine200 else colors.engine150
            edge = null
        }
        variant == Mk8dxButtonVariant.Primary -> { content = colors.actionOnPrimary; fill = colors.actionPrimary; edge = null }
        variant == Mk8dxButtonVariant.Global -> { content = colors.actionPrimary; fill = Color.Transparent; edge = 1.5.dp to colors.actionPrimary.copy(alpha = .6f) }
        variant == Mk8dxButtonVariant.Secondary -> { content = colors.textBody; fill = colors.surfaceControl; edge = 1.dp to colors.borderStrong }
        variant == Mk8dxButtonVariant.Danger -> { content = colors.statusError; fill = Color.Transparent; edge = 1.5.dp to colors.statusError.copy(alpha = .7f) }
        else -> { content = colors.textSecondary; fill = Color.Transparent; edge = null }
    }
    val minHeight = when {
        variant == Mk8dxButtonVariant.Quiet -> Mk8dxSpacing.targetMin
        variant == Mk8dxButtonVariant.Global -> maxOf(Mk8dxComponentDimensions.controlHeight, Mk8dxSpacing.targetMin)
        variant != Mk8dxButtonVariant.Primary -> maxOf(Mk8dxComponentDimensions.buttonHeightSecondary, Mk8dxSpacing.targetMin)
        size == Mk8dxButtonSize.Sm -> maxOf(Mk8dxComponentDimensions.buttonHeightSm, Mk8dxSpacing.targetMin)
        size == Mk8dxButtonSize.Lg -> Mk8dxComponentDimensions.buttonHeightLg
        else -> Mk8dxComponentDimensions.buttonHeightMd
    }
    val textStyle = when {
        disabled -> type.label.copy(fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
        variant == Mk8dxButtonVariant.Primary -> type.title.copy(
            fontSize = when (size) { Mk8dxButtonSize.Sm -> 15.5.sp; Mk8dxButtonSize.Md -> 17.sp; Mk8dxButtonSize.Lg -> 18.5.sp },
            fontWeight = FontWeight.Bold,
        )
        else -> type.label.copy(fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
    }
    val iconSize = when {
        variant == Mk8dxButtonVariant.Global -> 17.dp
        size == Mk8dxButtonSize.Sm -> 18.dp
        size == Mk8dxButtonSize.Lg -> 22.dp
        else -> 20.dp
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Row(
            Modifier
                .heightIn(min = minHeight)
                .clip(shape)
                .background(fill)
                .then(if (edge != null) Modifier.border(edge.first, edge.second, shape) else Modifier)
                .drawWithContent {
                    drawContent()
                    // Pressed indication, inside the clip like the focus ring.
                    if (pressed && !disabled) drawRect(content.copy(alpha = .14f))
                }
                .insideFocusRing(focused, colors.focusRing, focusWidth, if (slanted) slant + 2.dp else 3.dp)
                .clickable(
                    interactionSource = interaction,
                    indication = null,
                    enabled = !disabled,
                    role = Role.Button,
                    onClick = { if (!busy) onClick() },
                )
                .semantics {
                    when {
                        disabledReason != null -> stateDescription = disabledReason
                        loadingLabel != null -> stateDescription = loadingLabel
                        nextStep != null -> stateDescription = nextStep
                    }
                }
                .padding(
                    start = if (variant == Mk8dxButtonVariant.Primary) slant + 10.dp else if (variant == Mk8dxButtonVariant.Quiet) 4.dp else 16.dp,
                    end = if (variant == Mk8dxButtonVariant.Primary) slant + 16.dp else if (variant == Mk8dxButtonVariant.Quiet) 4.dp else 16.dp,
                    top = 6.dp, bottom = 6.dp,
                )
                .then(tag?.let { Modifier.testTag(it) } ?: Modifier),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(16.dp), color = content, strokeWidth = 2.dp, trackColor = content.copy(alpha = .3f))
            } else if (stopwatch && !disabled) {
                Icon(Mk8dxIcons.Stopwatch, contentDescription = null, tint = content, modifier = Modifier.size(iconSize))
            } else if (camera && !disabled) {
                Icon(Mk8dxIcons.Camera, contentDescription = null, tint = content, modifier = Modifier.size(iconSize))
            }
            Text(
                loadingLabel ?: label,
                style = textStyle,
                color = content,
                textAlign = TextAlign.Center,
                textDecoration = if (variant == Mk8dxButtonVariant.Quiet && !disabled) TextDecoration.Underline else null,
            )
        }
        if (disabledReason != null && disabledReasonShown) {
            // Already the button's state description; not read twice.
            Text(
                disabledReason, style = type.label, color = colors.textTertiary,
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

/**
 * The two-press (armed) action's logic: the first press arms, the second
 * confirms, and any change elsewhere cancels ([disarm]).
 */
class Mk8dxArmedAction {
    var armed: Boolean = false
        private set

    /** Returns true when this press confirms the action. */
    fun press(): Boolean {
        if (!armed) {
            armed = true
            return false
        }
        armed = false
        return true
    }

    fun disarm() {
        armed = false
    }
}

/** Armed (two-stage) primary: a 3 dp flare halo and the next-step text, announced politely. */
@Composable
fun Mk8dxArmedButton(
    label: String,
    armedLabel: String,
    nextStep: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    stopwatch: Boolean = true,
    action: Mk8dxArmedAction = remember { Mk8dxArmedAction() },
    engine: Int? = null,
    controlledArmed: Boolean? = null,
    onArmedChange: (Boolean) -> Unit = {},
    /** The tag belongs on the pressable row, which carries the label and the role. */
    tag: String? = null,
) {
    var internalArmed by remember { mutableStateOf(action.armed) }
    val armed = controlledArmed ?: internalArmed
    val colors = Mk8dxTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Box(
            Modifier
                .drawBehind {
                    // The 3 dp flare halo, outside the clip with a 2 dp gap, so it reads as a state.
                    if (armed) {
                        val w = 3.dp.toPx()
                        val s = 10.dp.toPx() + w
                        val path = Path().apply {
                            moveTo(s, w / 2); lineTo(size.width - w / 2, w / 2)
                            lineTo(size.width - s, size.height - w / 2); lineTo(w / 2, size.height - w / 2); close()
                        }
                        drawPath(path, colors.actionPrimary, style = Stroke(w))
                    }
                }
                .padding(5.dp),
        ) {
            Mk8dxButton(
                label = if (armed) armedLabel else label,
                onClick = {
                    if (armed) {
                        action.disarm()
                        if (controlledArmed == null) internalArmed = false
                        onArmedChange(false)
                        onConfirm()
                    } else {
                        action.press()
                        if (controlledArmed == null) internalArmed = true
                        onArmedChange(true)
                    }
                },
                variant = Mk8dxButtonVariant.Primary,
                stopwatch = stopwatch,
                engine = engine,
                nextStep = if (armed) nextStep else null,
                tag = tag,
            )
        }
        if (armed) {
            Text(
                nextStep, style = Mk8dxTheme.type.label.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

// ------------------------------------------------------------------ engine (§7)

enum class Mk8dxEngineMarkSize { Md, Lg, Plain, Art }

/**
 * EngineMark: a tinted chip with an engine edge, chevron and text.
 *
 * [Mk8dxEngineMarkSize.Art] is the one filled form: §6 reserves fills with ink
 * for engine badges placed *on art*, where a tint over a photograph cannot be
 * trusted to stay readable. It is also the smallest, because a track thumbnail
 * has to hold the badge, the track's name and its cup without them colliding.
 */
@Composable
fun Mk8dxEngineMark(engine: Int, modifier: Modifier = Modifier, size: Mk8dxEngineMarkSize = Mk8dxEngineMarkSize.Md) {
    val colors = Mk8dxTheme.colors
    val c = engineColor(colors, engine)
    if (size == Mk8dxEngineMarkSize.Art) {
        // A badge printed on artwork keeps its size relative to the art: the
        // thumbnail it sits on cannot grow with the text scale, and a badge
        // that did would cover the picture it is labelling.
        val density = LocalDensity.current
        Row(
            modifier
                .heightIn(min = 16.dp)
                .background(c)
                .padding(horizontal = 4.dp, vertical = 1.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EngineShape(engine, colors.engineOnFill)
            Text(
                "${engine}cc", color = colors.engineOnFill, maxLines = 1, softWrap = false,
                style = Mk8dxTheme.type.micro.copy(
                    fontSize = with(density) { 10.dp.toSp() },
                    lineHeight = with(density) { 12.dp.toSp() },
                    fontWeight = FontWeight.Bold,
                ),
            )
        }
        return
    }
    val edge = if (size == Mk8dxEngineMarkSize.Lg) 4.dp else 3.dp
    Row(
        modifier
            .then(
                if (size == Mk8dxEngineMarkSize.Plain) Modifier else Modifier
                    .heightIn(min = if (size == Mk8dxEngineMarkSize.Lg) 28.dp else Mk8dxComponentDimensions.chipHeight)
                    .background(Mk8dxTheme.tint(colors, c))
                    .drawBehind { drawRect(c, size = Size(edge.toPx(), this.size.height)) }
                    .padding(start = if (size == Mk8dxEngineMarkSize.Lg) 12.dp else 9.dp, end = if (size == Mk8dxEngineMarkSize.Lg) 11.dp else 8.dp),
            ),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        EngineShape(engine, c)
        Text(
            "${engine}cc", color = c, maxLines = 1, softWrap = false,
            style = Mk8dxTheme.type.label.copy(fontSize = if (size == Mk8dxEngineMarkSize.Lg) 14.sp else 12.5.sp, fontWeight = FontWeight.SemiBold),
        )
    }
}

/**
 * EngineSelector (§7): a radio group; the selected option gets the engine
 * tint, a 3 dp underline in the engine colour, ✓ and a bold label. Colour is
 * never the only cue, and TalkBack hears "selected" from the radio semantics.
 */
@Composable
fun Mk8dxEngineSelector(
    label: String,
    value: Int,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .semantics { contentDescription = label }
            .selectableGroup()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (engine in listOf(150, 200)) {
            val selected = engine == value
            val c = engineColor(colors, engine)
            val underline = Mk8dxComponentDimensions.engineSelectorUnderline
            Row(
                Modifier
                    .heightIn(min = maxOf(if (large) 42.dp else Mk8dxComponentDimensions.segmentHeight, Mk8dxSpacing.targetMin))
                    .background(if (selected) Mk8dxTheme.tint(colors, c) else Color.Transparent)
                    .drawBehind {
                        if (selected) drawRect(c, topLeft = Offset(0f, size.height - underline.toPx()), size = Size(size.width, underline.toPx()))
                    }
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { onChange(engine) })
                    .padding(horizontal = if (large) 18.dp else 14.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val style = Mk8dxTheme.type.label.copy(
                    fontSize = if (large) 15.5.sp else 14.sp,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                )
                if (selected) Text("✓", style = style, color = c, modifier = Modifier.clearAndSetSemantics { })
                EngineShape(engine, c)
                Text("${engine}cc", style = style, color = if (selected) c else colors.textSecondary, softWrap = false)
            }
        }
    }
}

// ------------------------------------------------------------------ selection

/** SegmentedControl: radio semantics; selected = selected surface, flare underline, ✓ and weight. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> Mk8dxSegmentedControl(
    label: String,
    choices: List<Pair<T, String>>,
    value: T,
    onChange: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    FlowRow(
        modifier
            .semantics { contentDescription = label }
            .selectableGroup()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for ((choice, text) in choices) {
            val selected = choice == value
            Row(
                Modifier
                    .heightIn(min = maxOf(Mk8dxComponentDimensions.segmentHeight, Mk8dxSpacing.targetMin))
                    // A one-character choice (mushrooms 0-3) is still a 44 dp
                    // target: the floor is on both sides, not only the height
                    // (§21; found on the device in Phase 7).
                    .widthIn(min = Mk8dxSpacing.targetMin)
                    .background(if (selected) colors.surfaceSelected else Color.Transparent)
                    .drawBehind {
                        if (selected) drawRect(colors.actionPrimary, topLeft = Offset(0f, size.height - 2.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                    }
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { onChange(choice) })
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val style = Mk8dxTheme.type.label.copy(fontSize = 13.5.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium)
                if (selected) Text("✓ ", style = style.copy(fontWeight = FontWeight.Medium), color = colors.textSecondary, modifier = Modifier.clearAndSetSemantics { })
                Text(text, style = style, color = if (selected) colors.textPrimary else colors.textSecondary)
            }
        }
    }
}

// ------------------------------------------------------------------ status

enum class Mk8dxChipTone { Neutral, Success, Warning, Error, Info, Advanced, Intermediate, Beginner, RaceDirection, Combined, Live }

@Composable
fun Mk8dxChip(label: String, modifier: Modifier = Modifier, tone: Mk8dxChipTone = Mk8dxChipTone.Neutral) {
    val colors = Mk8dxTheme.colors
    val c = when (tone) {
        Mk8dxChipTone.Neutral -> colors.textSecondary
        Mk8dxChipTone.Success -> colors.statusSuccess
        Mk8dxChipTone.Warning -> colors.statusWarning
        Mk8dxChipTone.Error -> colors.statusError
        Mk8dxChipTone.Info -> colors.statusInfo
        Mk8dxChipTone.Advanced -> colors.tierAdvanced
        Mk8dxChipTone.Intermediate -> colors.tierIntermediate
        Mk8dxChipTone.Beginner -> colors.tierBeginner
        Mk8dxChipTone.RaceDirection -> colors.modeRaceDirection
        Mk8dxChipTone.Combined -> colors.textBody
        Mk8dxChipTone.Live -> colors.liveOn
    }
    val background = when (tone) {
        Mk8dxChipTone.Combined -> Modifier.border(1.dp, colors.borderStrong)
        Mk8dxChipTone.Live -> Modifier.background(colors.live, Mk8dxSlantTag)
        else -> Modifier.background(Mk8dxTheme.tint(colors, c), Mk8dxSlantTag)
    }
    Row(
        modifier.heightIn(min = Mk8dxComponentDimensions.chipHeight).then(background).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tone == Mk8dxChipTone.Live) Box(Modifier.size(6.dp).background(c, CircleShape))
        Text(
            label, style = Mk8dxTheme.type.micro.copy(fontWeight = if (tone == Mk8dxChipTone.Live) FontWeight.Bold else FontWeight.SemiBold),
            color = c, maxLines = 1, softWrap = false,
        )
    }
}

/** YouChip: the personal accent tag on your own row. */
@Composable
fun Mk8dxYouChip(label: String, modifier: Modifier = Modifier) {
    val colors = Mk8dxTheme.colors
    Text(
        label.uppercase(),
        modifier = modifier.background(colors.personalAccent, Mk8dxSlantShape(3.dp)).padding(horizontal = 7.dp, vertical = 3.dp),
        style = Mk8dxTheme.type.micro.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.66.sp),
        color = colors.personalOnAccent, maxLines = 1, softWrap = false,
    )
}

/**
 * HiddenByPreference (§7 "hidden ≠ zero", §24 Status).
 *
 * Where the account's own Time Trial preference filters an engine out of a
 * passive surface, that surface says the engine is *hidden*, instead of drawing
 * the zeros a missing engine would otherwise produce. The way to look anyway is
 * a quiet local override: it reveals the engine for this mount only and writes
 * nothing to the account, which is the whole point of the control.
 */
@Composable
fun Mk8dxHiddenByPreference(
    message: String,
    actionLabel: String,
    onShow: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String? = null,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceControl)
            .border(1.dp, colors.borderSubtle)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(message, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        Mk8dxButton(
            actionLabel,
            onShow,
            variant = Mk8dxButtonVariant.Quiet,
            size = Mk8dxButtonSize.Sm,
            tag = tag,
        )
    }
}

// ------------------------------------------------------------------ data (§10, §15)

enum class Mk8dxRowKind { Normal, You, Reference }

data class Mk8dxRankRow(
    val rank: Int,
    val name: String,
    val timeMs: Long,
    val deltaMs: Long? = null,
    val kind: Mk8dxRowKind = Mk8dxRowKind.Normal,
    val youLabel: String? = null,
)

/** The largest rank a table must make room for (its rank column is sized from it). */
fun mk8dxLargestRank(rows: List<Mk8dxRankRow>): Int = rows.maxOfOrNull { it.rank } ?: 1

/**
 * Ranking table / TimingRow (§10, §15): the rank column is as wide as the
 * formatted largest rank of the dataset, names ellipsise first, numbers never
 * clip, wrap or abbreviate. Below 600 dp each row takes two lines, and the time
 * and gap move to their own lines when a large font scale needs the room.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Mk8dxRankingTable(
    caption: String,
    language: Mk8dxNumberLanguage,
    rows: List<Mk8dxRankRow>,
    modifier: Modifier = Modifier,
    timing: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val phone = LocalConfiguration.current.screenWidthDp < 600
    val rankStyle = type.data.copy(fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val widest = Mk8dxNumeric.formatRank(mk8dxLargestRank(rows), language)
    val rankWidth = with(density) { measurer.measure(widest, rankStyle, softWrap = false, maxLines = 1).size.width.toDp() } + 2.dp
    Column(modifier.fillMaxWidth().background(colors.surfaceRaised).semantics { contentDescription = caption }) {
        for (row in rows) {
            val podium = if (row.rank <= 3 && row.kind != Mk8dxRowKind.Reference) row.rank else null
            val edge: Pair<Dp, Color>? = when {
                row.kind == Mk8dxRowKind.You -> 4.dp to colors.personalEdge
                podium == 1 -> 3.dp to colors.rankGold
                podium == 2 -> 3.dp to colors.rankSilver
                podium == 3 -> 3.dp to colors.rankBronze
                else -> null
            }
            val textColor = when (row.kind) {
                Mk8dxRowKind.You -> colors.textPrimary
                Mk8dxRowKind.Reference -> colors.textTertiary
                Mk8dxRowKind.Normal -> colors.textBody
            }
            val rankColor = when (podium) {
                1 -> colors.rankGold
                2 -> colors.rankSilver
                3 -> colors.rankBronze
                else -> textColor
            }
            val rank: @Composable () -> Unit = {
                Text(
                    Mk8dxNumeric.formatRank(row.rank, language),
                    modifier = Modifier.width(rankWidth),
                    style = if (row.kind == Mk8dxRowKind.Reference) rankStyle.copy(fontWeight = FontWeight.Medium) else rankStyle,
                    color = rankColor, textAlign = TextAlign.End, softWrap = false, maxLines = 1,
                )
            }
            val name: @Composable (Modifier) -> Unit = { nameModifier ->
                Row(nameModifier, horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        row.name, style = type.body.copy(fontWeight = FontWeight.Medium), color = textColor,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    )
                    if (row.kind == Mk8dxRowKind.You && row.youLabel != null) Mk8dxYouChip(row.youLabel)
                }
            }
            val time: @Composable () -> Unit = {
                Text(
                    Mk8dxNumeric.formatTime(row.timeMs),
                    style = if (row.kind == Mk8dxRowKind.You) type.data.copy(fontWeight = FontWeight.SemiBold) else type.data,
                    color = if (row.kind == Mk8dxRowKind.You) colors.textPrimary else textColor, softWrap = false, maxLines = 1,
                )
            }
            val delta: @Composable () -> Unit = {
                row.deltaMs?.let { gap ->
                    Text(
                        Mk8dxNumeric.formatDelta(gap), style = type.dataS, softWrap = false, maxLines = 1,
                        color = when (Mk8dxNumeric.deltaDirection(gap)) {
                            Mk8dxDeltaDirection.Faster -> colors.deltaFaster
                            Mk8dxDeltaDirection.Slower -> colors.deltaSlower
                            Mk8dxDeltaDirection.Even -> colors.textTertiary
                        },
                    )
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(
                        min = when {
                            phone -> Mk8dxComponentDimensions.tableRowPhone
                            timing -> Mk8dxComponentDimensions.tableRowTiming
                            else -> Mk8dxComponentDimensions.tableRow
                        },
                    )
                    .background(if (row.kind == Mk8dxRowKind.You) colors.personalWash else Color.Transparent)
                    .drawBehind {
                        edge?.let { (width, color) -> drawRect(color, size = Size(width.toPx(), size.height)) }
                        drawRect(colors.borderSubtle, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx()))
                    }
                    .semantics(mergeDescendants = true) { }
                    .padding(horizontal = Mk8dxSpacing.md, vertical = if (phone) Mk8dxSpacing.sm else 0.dp),
                horizontalArrangement = Arrangement.spacedBy(if (phone) Mk8dxSpacing.sm else Mk8dxSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                rank()
                if (phone) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        name(Modifier.fillMaxWidth())
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md)) {
                            time()
                            delta()
                        }
                    }
                } else {
                    name(Modifier.weight(1f))
                    time()
                    delta()
                }
            }
        }
    }
}

/** HeroRank: display type at four fixed steps by digit count (never fluid per value). */
@Composable
fun Mk8dxHeroRank(rank: Int, language: Mk8dxNumberLanguage, label: String, modifier: Modifier = Modifier) {
    val text = Mk8dxNumeric.formatRank(rank, language)
    Text(
        text,
        modifier = modifier.semantics { contentDescription = "$label $text" },
        style = Mk8dxTheme.type.heroRank(Mk8dxNumeric.heroRankStep(rank)),
        color = Mk8dxTheme.colors.textPrimary, softWrap = false, maxLines = 1,
    )
}

/** A display heading (Saira Condensed 800, synthesized oblique, caps). */
@Composable
fun Mk8dxDisplayText(text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = Mk8dxTheme.colors.textPrimary) {
    Text(text.uppercase(), modifier = modifier.semantics { heading() }, style = style, color = color)
}

// ------------------------------------------------------------------ forms (§13)

/** TimeInput's pure rules, shared by the component and its tests. */
object Mk8dxTimeInputRules {
    const val DIGITS = 6

    /** Only digits, at most six (M SS mmm), filled from the left. */
    fun sanitize(raw: String): String = raw.filter(Char::isDigit).take(DIGITS)

    /** What the input announces: "1:45.912", with unfilled digits as zeros. */
    fun valueText(digits: String): String {
        val padded = sanitize(digits).padEnd(DIGITS, '0')
        return "${padded[0]}:${padded.substring(1, 3)}.${padded.substring(3)}"
    }
}

/**
 * TimeInput (§13): one real text field (numeric keyboard, labelled, six digits)
 * drawn as digit cells. The cells grow with the font scale (minimum size, never
 * a fixed height). TalkBack hears the label and the formatted time.
 */
@Composable
fun Mk8dxTimeInput(
    label: String,
    digits: String,
    onDigitsChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    invalid: Boolean = false,
    doubt: Boolean = false,
    compact: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val value = Mk8dxTimeInputRules.sanitize(digits)
    val narrow = LocalConfiguration.current.screenWidthDp < 360
    val cellWidth = when {
        compact -> 26.dp
        narrow -> Mk8dxComponentDimensions.timeInputCellWidthCompact
        else -> Mk8dxComponentDimensions.timeInputCellWidth
    }
    val cellHeight = when {
        compact -> 36.dp
        narrow -> Mk8dxComponentDimensions.timeInputCellHeightCompact
        else -> Mk8dxComponentDimensions.timeInputCellHeight
    }
    val digitStyle = Mk8dxTheme.type.dataXl.copy(fontSize = if (compact) 17.sp else if (narrow) 24.sp else 32.sp)
    val separatorStyle = digitStyle.copy(fontSize = if (compact) 16.sp else if (narrow) 20.sp else 26.sp)
    val baseline = when {
        invalid -> colors.statusError
        doubt -> colors.statusWarning
        else -> colors.borderControl
    }
    val focusWidth = if (Mk8dxTheme.appearance == Mk8dxAppearance.HighContrast) Mk8dxSpacing.focusWidthHighContrast else Mk8dxSpacing.focusWidth
    BasicTextField(
        value = value,
        onValueChange = { onDigitsChange(Mk8dxTimeInputRules.sanitize(it)) },
        modifier = modifier.semantics {
            contentDescription = label
            stateDescription = Mk8dxTimeInputRules.valueText(value)
        },
        interactionSource = interaction,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        decorationBox = { inner ->
            Box(
                Modifier
                    .then(if (focused) Modifier.border(focusWidth, colors.focusRing) else Modifier)
                    .padding(3.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    var index = 0
                    for (part in listOf("d", ":", "d", "d", ".", "d", "d", "d")) {
                        if (part != "d") {
                            Text(part, style = separatorStyle, color = colors.textTertiary)
                            continue
                        }
                        val digit = value.getOrNull(index)
                        val cursor = focused && index == minOf(value.length, Mk8dxTimeInputRules.DIGITS - 1)
                        Box(
                            Modifier
                                .sizeIn(minWidth = cellWidth, minHeight = cellHeight)
                                .background(colors.surfaceControl)
                                .drawBehind {
                                    drawRect(baseline, topLeft = Offset(0f, size.height - 2.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                                    if (cursor) {
                                        val w = focusWidth.toPx()
                                        drawRect(colors.focusRing, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), style = Stroke(w))
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                (digit ?: '0').toString(),
                                style = if (digit == null) digitStyle.copy(fontWeight = FontWeight.Normal) else digitStyle,
                                color = if (digit == null) colors.textTertiary else colors.textPrimary,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                            )
                        }
                        index += 1
                    }
                }
                // The real field: present for input and IME, invisible (the cells draw it).
                Box(Modifier.size(1.dp).alpha(0f)) { inner() }
            }
        },
    )
}

/**
 * TextField (§13, §24 Forms): the label above the field, the field itself on the
 * control surface with a hairline, and an optional message under it. Nothing
 * here has a fixed height, so the box grows with the font scale instead of
 * clipping its own text at 2.0.
 */
@Composable
fun Mk8dxTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    hint: String? = null,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    invalid: Boolean = false,
    /** Shown as dots (a PIN on a shared phone); the value itself is unchanged. */
    secret: Boolean = false,
    /**
     * A test tag for the input itself. Like a button's, it belongs on the node
     * that carries the label and the text, not on the column around it: that is
     * the node a test types into and a screen reader reads.
     */
    tag: String? = null,
) {
    val colors = Mk8dxTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val focusWidth =
        if (Mk8dxTheme.appearance == Mk8dxAppearance.HighContrast) {
            Mk8dxSpacing.focusWidthHighContrast
        } else {
            Mk8dxSpacing.focusWidth
        }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Text(label, style = Mk8dxTheme.type.label, color = colors.textSecondary)
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = Mk8dxSpacing.targetMin)
                .background(colors.surfaceControl)
                .border(
                    if (focused) focusWidth else 1.dp,
                    when {
                        invalid -> colors.statusError
                        focused -> colors.focusRing
                        else -> colors.borderControl
                    },
                )
                .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (value.isEmpty() && placeholder != null) {
                Text(
                    placeholder,
                    style = Mk8dxTheme.type.body,
                    color = colors.textTertiary,
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = singleLine,
                interactionSource = interaction,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                visualTransformation = if (secret) {
                    androidx.compose.ui.text.input.PasswordVisualTransformation()
                } else {
                    androidx.compose.ui.text.input.VisualTransformation.None
                },
                textStyle = Mk8dxTheme.type.body.copy(color = colors.textPrimary),
                cursorBrush = SolidColor(colors.actionPrimary),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = label }
                    .then(tag?.let { Modifier.testTag(it) } ?: Modifier),
            )
        }
        if (hint != null) {
            Text(hint, style = Mk8dxTheme.type.bodyS, color = colors.textTertiary)
        }
    }
}

/**
 * Toggle (§24 Selection): one preference on one 44 dp row. The state is a mark
 * and a word as well as a fill, never a colour alone, and the row carries
 * `Role.Switch` so a screen reader hears it as on or off.
 */
@Composable
fun Mk8dxToggleRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    onText: String = "On",
    offText: String = "Off",
    description: String? = null,
    enabled: Boolean = true,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceControl)
            .border(1.dp, if (checked) colors.borderStrong else colors.borderSubtle)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            )
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Box(
            Modifier
                .size(20.dp)
                .background(if (checked) colors.actionPrimary else Color.Transparent)
                .border(1.5.dp, if (checked) colors.actionPrimary else colors.borderControl),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) {
                Text(
                    "✓",
                    style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold),
                    color = colors.actionOnPrimary,
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = Mk8dxTheme.type.body, color = colors.textPrimary)
            if (description != null) {
                Text(description, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
            }
        }
        Text(
            if (checked) onText else offText,
            style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold),
            color = if (checked) colors.textPrimary else colors.textSecondary,
            softWrap = false, maxLines = 1,
            modifier = Modifier.clearAndSetSemantics { },
        )
    }
}

/** The tones a status message can carry; the tone is never its only cue. */
enum class Mk8dxStatusTone { Neutral, Success, Warning, Error, Info }

/**
 * StatusMessage (§24 Status): what just happened, on a tinted surface with an
 * edge in the tone's colour. It is a polite live region, so a save that
 * succeeded or failed is announced without stealing focus.
 */
@Composable
fun Mk8dxStatusMessage(
    text: String,
    modifier: Modifier = Modifier,
    tone: Mk8dxStatusTone = Mk8dxStatusTone.Neutral,
) {
    if (text.isBlank()) return
    val colors = Mk8dxTheme.colors
    val c = when (tone) {
        Mk8dxStatusTone.Neutral -> colors.textSecondary
        Mk8dxStatusTone.Success -> colors.statusSuccess
        Mk8dxStatusTone.Warning -> colors.statusWarning
        Mk8dxStatusTone.Error -> colors.statusError
        Mk8dxStatusTone.Info -> colors.statusInfo
    }
    Row(
        modifier
            .fillMaxWidth()
            .background(Mk8dxTheme.tint(colors, c))
            .drawBehind { drawRect(c, size = Size(3.dp.toPx(), size.height)) }
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Text(text, style = Mk8dxTheme.type.bodyS, color = colors.textBody)
    }
}

/** A spacer in the design-system scale, for callers composing the components. */
@Composable
fun Mk8dxGap(size: Dp = Mk8dxSpacing.lg) = Spacer(Modifier.size(size))
