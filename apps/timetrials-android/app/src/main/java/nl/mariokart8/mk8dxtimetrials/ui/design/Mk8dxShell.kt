package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The shell (DESIGN_SYSTEM §11, §23, §24): TopBar with the brand lockup,
 * five bottom tabs with NavigationBar semantics, the task bar that replaces
 * them during a task, and the contextual global action.
 *
 * What this deliberately does **not** do: per-tab back stacks (OD-10) and a
 * navigation rail at width (OD-11). Both keep their safe defaults — one back
 * stack, bottom tabs at every width — until those decisions are taken.
 */

/** The mark itself: the owner's app icon, never redrawn (DESIGN_SYSTEM §2). */
@Composable
fun Mk8dxBrandMark(icon: ImageBitmap, modifier: Modifier = Modifier, label: String = "MK8DX Time Trials") {
    Image(
        bitmap = icon,
        contentDescription = label,
        contentScale = ContentScale.Fit,
        modifier = modifier.size(Mk8dxSpacing.xxxxl),
    )
}

/**
 * The compact lockup: the mark, the wordmark and the product line. The
 * typography around the symbol is the product's display face; the symbol is
 * untouched.
 */
@Composable
fun Mk8dxBrandLockup(
    icon: ImageBitmap,
    modifier: Modifier = Modifier,
    platform: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Mk8dxBrandMark(
            icon,
            if (onClick == null) Modifier else Modifier
                .clickable(role = Role.Button, onClick = onClick)
                .testTag("product-home-logo"),
        )
        Column(Modifier.padding(start = Mk8dxSpacing.sm)) {
            Text(
                "MK8DX",
                style = Mk8dxTheme.type.display6.copy(fontSize = 19.sp, letterSpacing = 0.02.em),
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "TIME TRIALS",
                style = Mk8dxTheme.type.micro.copy(
                    fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.06.em,
                ),
                color = colors.textSecondary,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
            )
            if (platform != null) {
                Surface(
                    color = Color.Transparent,
                    contentColor = colors.textTertiary,
                    border = BorderStroke(1.dp, colors.borderSubtle),
                    modifier = Modifier.padding(top = 3.dp).testTag("product-platform-android"),
                ) {
                    Text(
                        platform,
                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
                        style = Mk8dxTheme.type.micro.copy(
                            fontSize = 8.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.08.em,
                        ),
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** The top bar: one per route, brand on the left, the account cluster right. */
@Composable
fun Mk8dxTopBar(
    modifier: Modifier = Modifier,
    brand: @Composable RowScope.() -> Unit,
    actions: @Composable RowScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Surface(color = colors.surfaceRaised, modifier = modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
                    )
                    .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.xs)
                    .heightIn(min = Mk8dxSpacing.xxxxxl),
                verticalAlignment = Alignment.CenterVertically,
                // The account cluster is measured first and keeps its targets;
                // the brand takes what is left and never more than it needs,
                // which is what stops "TIME TRIALS" being cut at 360 dp.
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                brand()
                actions()
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
        }
    }
}

/** One destination in the bottom bar. */
data class Mk8dxTabDestination(
    val key: String,
    val label: String,
    val icon: Painter,
)

/**
 * Five tabs with NavigationBar semantics: a selectable group of `Role.Tab`
 * options, so a screen reader says which destination is selected.
 *
 * The slot geometry is kept from the measured production bar rather than
 * Material's defaults, because Material's own item padding is what truncated
 * "Tournaments" at 360 dp. The label still steps down before it ever clips.
 */
@Composable
fun Mk8dxBottomTabs(
    destinations: List<Mk8dxTabDestination>,
    selectedKey: String,
    onSelect: (Mk8dxTabDestination) -> Unit,
    modifier: Modifier = Modifier,
    navigationLabel: String = "Main navigation",
) {
    val colors = Mk8dxTheme.colors
    Surface(color = colors.surfaceRaised, modifier = modifier.fillMaxWidth().testTag("product-navigation")) {
        Column {
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
            Row(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal),
                    )
                    .selectableGroup()
                    .semantics { contentDescription = navigationLabel }
                    .heightIn(min = Mk8dxSpacing.xxxxxl)
                    .padding(horizontal = Mk8dxSpacing.xs, vertical = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (destination in destinations) {
                    val selected = destination.key == selectedKey
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = Mk8dxSpacing.targetMin)
                            .background(if (selected) colors.surfaceSelected else Color.Transparent)
                            .selectable(
                                selected = selected,
                                role = Role.Tab,
                                onClick = { onSelect(destination) },
                            )
                            .padding(vertical = Mk8dxSpacing.xs, horizontal = 1.dp)
                            .testTag("product-nav-${destination.key.lowercase()}"),
                    ) {
                        val tint = if (selected) colors.actionPrimary else colors.textSecondary
                        Icon(
                            painter = destination.icon,
                            contentDescription = null,
                            tint = tint,
                            modifier = Modifier.size(Mk8dxSpacing.xxl),
                        )
                        Spacer(Modifier.height(3.dp))
                        Mk8dxNavigationLabel(destination.label, tint)
                        if (selected) {
                            Spacer(Modifier.height(3.dp))
                            Box(
                                Modifier
                                    .widthIn(min = 18.dp)
                                    .fillMaxWidth(0.5f)
                                    .height(Mk8dxComponentDimensions.engineSelectorUnderline)
                                    .background(colors.actionPrimary),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Task mode (§11): the tabs step aside for Back, the title and Close. Both
 * actions do exactly what the system Back does, so the Back model is unchanged.
 */
@Composable
fun Mk8dxTaskBar(
    title: String,
    onClose: () -> Unit,
    closeLabel: String,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    Surface(color = colors.surfaceRaised, modifier = modifier.fillMaxWidth().testTag("product-task-bar")) {
        Column {
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
            Row(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal),
                    )
                    .heightIn(min = Mk8dxSpacing.xxxxxl)
                    .padding(horizontal = Mk8dxSpacing.lg, vertical = Mk8dxSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
            ) {
                Text(
                    title,
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).testTag("product-task-title"),
                )
                Mk8dxButton(
                    closeLabel,
                    onClose,
                    variant = Mk8dxButtonVariant.Quiet,
                    size = Mk8dxButtonSize.Sm,
                    modifier = Modifier.testTag("product-task-close"),
                )
            }
        }
    }
}

/** The level the global "Post a time" action takes on a route (§4). */
enum class Mk8dxGlobalActionLevel { Filled, Outline, Hidden }

/**
 * The contextual global action, docked above the tabs. It is filled only where
 * the route carries no primary of its own; a route with its own call to action
 * steps it down, and a task hides it.
 */
@Composable
fun Mk8dxDockedAction(
    label: String,
    onClick: () -> Unit,
    level: Mk8dxGlobalActionLevel,
    modifier: Modifier = Modifier,
) {
    if (level == Mk8dxGlobalActionLevel.Hidden) return
    Row(
        modifier
            .fillMaxWidth()
            // The strip the action is docked in belongs to the shell, so it
            // takes the product's app surface. Without it a migrated route in
            // Light showed a band of the legacy dark backdrop under the panels.
            .background(Mk8dxTheme.colors.surfaceApp)
            .padding(horizontal = Mk8dxSpacing.gutterPhone, vertical = Mk8dxSpacing.sm)
            .testTag("product-docked-action"),
        horizontalArrangement = Arrangement.End,
    ) {
        Mk8dxButton(
            label,
            onClick,
            variant = if (level == Mk8dxGlobalActionLevel.Filled) {
                Mk8dxButtonVariant.Primary
            } else {
                Mk8dxButtonVariant.Global
            },
            size = Mk8dxButtonSize.Sm,
            stopwatch = true,
        )
    }
}

/** How far a bottom-tab label follows the Player's text size before it stops. */
const val NAVIGATION_LABEL_SCALE_CAP = 1.3f

/**
 * A destination label that always shows its whole word.
 *
 * The web bar has 73 px per slot at 390 CSS px; a 360 dp phone has less, and
 * how much less depends on the system font — which is why "Tournaments" fit on
 * the emulator's Roboto and still came out as "Tourname…" on the owner's Vivo.
 * Rather than guess a size that survives every font, the label measures itself
 * and steps down until it fits. A destination is a name, not a hint.
 */
@Composable
internal fun Mk8dxNavigationLabel(text: String, tint: Color) {
    val sizes = listOf(10.sp, 9.5.sp, 9.sp, 8.5.sp)
    var index by remember(text) { mutableIntStateOf(0) }
    // Five equal slots cannot grow sideways, and "Tournaments" is one word: at
    // font scale 2.0 it would be cut to "Tourname..." however far the label
    // stepped down. So the label follows the Player's text size up to
    // [NAVIGATION_LABEL_SCALE_CAP] and then keeps its size - still larger than
    // the default, and the destination is still a whole name. Everything else
    // in the shell scales the whole way (DESIGN_SYSTEM §21).
    val fontScale = LocalDensity.current.fontScale
    val cap = if (fontScale > NAVIGATION_LABEL_SCALE_CAP) NAVIGATION_LABEL_SCALE_CAP / fontScale else 1f
    Text(
        text,
        color = tint,
        style = Mk8dxTheme.type.micro.copy(
            fontSize = sizes[index] * cap,
            lineHeight = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.sp,
        ),
        maxLines = 1,
        softWrap = false,
        onTextLayout = { result ->
            if (result.hasVisualOverflow && index < sizes.lastIndex) index += 1
        },
    )
}
