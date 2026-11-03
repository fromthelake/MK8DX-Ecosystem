package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/*
 * The data-screen half of the design system (DESIGN_SYSTEM.md §4, §10, §15,
 * §21): the panels, tabs, filter summary and sheet, stat blocks, podium strip
 * and comparison grid a LOW-spectacle route is built from. The counterparts of
 * the web's `Panel`, `Tabs`, `FilterSummary`/`FilterSheet`, `StatBlock`,
 * `PodiumStrip` and `ComparisonGrid`. Every text comes from the caller.
 */

// ------------------------------------------------------------------ panels (§4, §15)

/**
 * Panel: the calm section surface of a LOW route. One hairline, one raised
 * surface, one quiet caption — no route palette and no coloured accent bar,
 * because on a data screen the colour budget belongs to the engine, the podium
 * and your own row.
 */
@Composable
fun Mk8dxPanel(
    title: String?,
    modifier: Modifier = Modifier,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(Mk8dxSpacing.md),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        if (title != null || trailing != null) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                if (title != null) {
                    Text(
                        title,
                        modifier = Modifier.weight(1f).semantics { heading() },
                        style = Mk8dxTheme.type.micro.copy(
                            fontWeight = FontWeight.Bold, letterSpacing = 0.08.em,
                        ),
                        color = colors.textSecondary,
                    )
                }
                trailing?.invoke(this)
            }
        }
        content()
    }
}

/** A quiet caption above a group of controls or a table. */
@Composable
fun Mk8dxSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.semantics { heading() },
        style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.08.em),
        color = Mk8dxTheme.colors.textSecondary,
    )
}

// ------------------------------------------------------------------ tabs (§11, §21)

/** One tab: its value, its label and the test tag the product knows it by. */
data class Mk8dxTabOption<T>(val value: T, val label: String, val tag: String? = null)

/**
 * Tabs: a selectable group of `Role.Tab` options, so a screen reader says which
 * view is selected. Selected = selected surface, a flare underline, ✓ and
 * weight; colour is never the only cue. The labels wrap rather than shrink, so
 * they stay whole at font scale 2.0.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> Mk8dxTabs(
    label: String,
    options: List<Mk8dxTabOption<T>>,
    value: T,
    onChange: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    FlowRow(
        modifier
            .fillMaxWidth()
            .semantics { contentDescription = label }
            .selectableGroup()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (option in options) {
            val selected = option.value == value
            val style = Mk8dxTheme.type.label.copy(
                fontSize = 13.5.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            )
            Row(
                Modifier
                    .heightIn(min = maxOf(Mk8dxComponentDimensions.segmentHeight, Mk8dxSpacing.targetMin))
                    .background(if (selected) colors.surfaceSelected else Color.Transparent)
                    .drawBehind {
                        if (selected) {
                            drawRect(
                                colors.actionPrimary,
                                topLeft = Offset(0f, size.height - 2.dp.toPx()),
                                size = Size(size.width, 2.dp.toPx()),
                            )
                        }
                    }
                    .selectable(selected = selected, role = Role.Tab, onClick = { onChange(option.value) })
                    .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.xs)
                    .then(option.tag?.let { Modifier.testTag(it) } ?: Modifier),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (selected) {
                    Text(
                        "✓ ", style = style.copy(fontWeight = FontWeight.Medium),
                        color = colors.textSecondary, modifier = Modifier.clearAndSetSemantics { },
                    )
                }
                Text(option.label, style = style, color = if (selected) colors.textPrimary else colors.textSecondary)
            }
        }
    }
}

/**
 * A toggle in a group of toggles (scope, references, rivals): the pressed state
 * is announced, and the selected state is a surface plus a ✓, never a colour.
 */
@Composable
fun Mk8dxToggleChip(
    label: String,
    selected: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val style = Mk8dxTheme.type.label.copy(
        fontSize = 13.5.sp,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
    )
    Row(
        modifier
            .heightIn(min = maxOf(Mk8dxComponentDimensions.segmentHeight, Mk8dxSpacing.targetMin))
            .background(if (selected) colors.surfaceSelected else colors.surfaceControl)
            .border(1.dp, if (selected) colors.borderStrong else colors.borderSubtle)
            .selectable(selected = selected, role = Role.Tab, onClick = onToggle)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (selected) {
            Text(
                "✓ ", style = style.copy(fontWeight = FontWeight.Medium),
                color = colors.textSecondary, modifier = Modifier.clearAndSetSemantics { },
            )
        }
        Text(
            label, style = style, color = if (selected) colors.textPrimary else colors.textSecondary,
            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
    }
}

// ------------------------------------------------------------------ filters (§15, W10)

/**
 * FilterSummary: what the table is currently showing, in one line, with the way
 * to change it. The facets are read as one sentence, so a screen reader hears
 * the whole state before the button.
 */
@Composable
fun Mk8dxFilterSummary(
    facets: List<Pair<String, String>>,
    actionLabel: String,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    val sentence = facets.joinToString(" · ") { (name, value) -> "$name: $value" }
    Row(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Text(
            sentence,
            modifier = Modifier.weight(1f).semantics { contentDescription = sentence },
            style = Mk8dxTheme.type.bodyS,
            color = colors.textSecondary,
        )
        Mk8dxButton(actionLabel, onOpen, variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm)
    }
}

/**
 * FilterSheet: the controls the summary stands for. A modal sheet traps focus
 * and closes on Back / Escape, and it keeps the same controls the screen had —
 * nothing is dropped, only gathered.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Mk8dxFilterSheet(
    title: String,
    closeLabel: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = colors.surfaceApp,
        contentColor = colors.textBody,
        scrimColor = colors.scrim,
        modifier = modifier,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                // The controls have to stay reachable at font scale 2.0, so the
                // sheet scrolls rather than clipping its last filter.
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Mk8dxSpacing.lg)
                .padding(bottom = Mk8dxSpacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(
                    title,
                    modifier = Modifier.weight(1f).semantics { heading() },
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                )
                Mk8dxButton(
                    closeLabel, onDismiss,
                    variant = Mk8dxButtonVariant.Quiet, size = Mk8dxButtonSize.Sm,
                    modifier = Modifier.testTag("rank-filters-close"),
                )
            }
            content()
        }
    }
}

// ------------------------------------------------------------------ figures (§10, §15)

/** StatBlock: one figure with its name, the figure in tabular Plex Mono. */
@Composable
fun Mk8dxStatBlock(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    large: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier.semantics(mergeDescendants = true) { },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = Mk8dxTheme.type.micro, color = colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            value,
            style = if (large) Mk8dxTheme.type.dataL else Mk8dxTheme.type.dataM,
            color = colors.textPrimary, softWrap = false, maxLines = 1,
        )
        if (hint != null) {
            Text(hint, style = Mk8dxTheme.type.bodyS, color = colors.textTertiary)
        }
    }
}

/** A label/value line for a list of facts (profile, record). */
@Composable
fun Mk8dxFactRow(label: String, value: String, modifier: Modifier = Modifier) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMinDense)
            .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Text(label, modifier = Modifier.weight(1f), style = Mk8dxTheme.type.body, color = colors.textSecondary)
        Text(value, style = Mk8dxTheme.type.data, color = colors.textPrimary, softWrap = false, maxLines = 1)
    }
}

/** DataTable head: `micro` A0 labels over the column widths the table uses. */
@Composable
fun Mk8dxTableHeader(columns: List<Pair<String, Float>>, modifier: Modifier = Modifier) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier.fillMaxWidth().padding(bottom = Mk8dxSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        for ((label, weight) in columns) {
            Text(
                label,
                modifier = Modifier.weight(weight),
                style = Mk8dxTheme.type.micro.copy(fontWeight = FontWeight.Bold),
                color = colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** PodiumStrip: the top three as compact cells — numeral, name, value. */
data class Mk8dxPodiumEntry(val rank: Int, val name: String, val value: String, val you: Boolean = false)

@Composable
fun Mk8dxPodiumStrip(
    entries: List<Mk8dxPodiumEntry>,
    language: Mk8dxNumberLanguage,
    modifier: Modifier = Modifier,
) {
    if (entries.isEmpty()) return
    val colors = Mk8dxTheme.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        for (entry in entries.take(3)) {
            val rankColor = when (entry.rank) {
                1 -> colors.rankGold
                2 -> colors.rankSilver
                else -> colors.rankBronze
            }
            Column(
                Modifier
                    .weight(1f)
                    .background(if (entry.you) colors.personalWash else colors.surfaceControl)
                    .drawBehind { drawRect(rankColor, size = Size(3.dp.toPx(), size.height)) }
                    .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.sm)
                    .semantics(mergeDescendants = true) { },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    Mk8dxNumeric.formatRank(entry.rank, language),
                    style = Mk8dxTheme.type.data.copy(fontWeight = FontWeight.SemiBold),
                    color = rankColor, softWrap = false, maxLines = 1,
                )
                Text(
                    entry.name, style = Mk8dxTheme.type.bodyS, color = colors.textBody,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(entry.value, style = Mk8dxTheme.type.dataS, color = colors.textSecondary, softWrap = false, maxLines = 1)
            }
        }
    }
}

/**
 * A tier chip (Mastery levels, tournament tiers). The colour is the recovered
 * ladder's own value and stays product data; the chip only guarantees that the
 * label on it is readable, by choosing the darker or lighter foreground.
 */
@Composable
fun Mk8dxTierChip(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    dense: Boolean = false,
) {
    val colors = Mk8dxTheme.colors
    val onColor = Mk8dxTheme.inkOn(color)
    Box(
        modifier
            .background(color)
            .border(1.dp, colors.borderStrong)
            .padding(horizontal = if (dense) 4.dp else Mk8dxSpacing.sm, vertical = if (dense) 1.dp else 2.dp),
    ) {
        Text(
            label,
            style = Mk8dxTheme.type.micro.copy(
                fontSize = if (dense) 10.sp else 12.sp,
                lineHeight = if (dense) 12.sp else 14.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = onColor, maxLines = 1, softWrap = false,
        )
    }
}

/** A bar whose value is always printed beside it (§15 ProgressBar). */
@Composable
fun Mk8dxValueBar(
    fraction: Float,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    Box(
        modifier
            .heightIn(min = Mk8dxSpacing.xxl)
            .background(colors.surfaceControl)
            .semantics(mergeDescendants = true) { },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .heightIn(min = Mk8dxSpacing.xxl)
                .background(color.copy(alpha = .48f)),
        )
        Text(
            value,
            modifier = Modifier.padding(horizontal = Mk8dxSpacing.sm),
            style = Mk8dxTheme.type.dataS,
            color = colors.textPrimary,
            softWrap = false, maxLines = 1,
        )
    }
}

// ------------------------------------------------------------------ comparison (§15)

/** Which way a sortable column is ordered, or null when it does not order the table. */
enum class Mk8dxSortDirection { Ascending, Descending }

data class Mk8dxComparisonColumn(
    val key: String,
    val label: String,
    val tag: String? = null,
    val sorted: Mk8dxSortDirection? = null,
)

/**
 * ComparisonGrid (§15): a lead column and up to a handful of compared columns,
 * scrolled sideways as one table. The header cells are buttons where the caller
 * sorts by them, and the sort direction is in the label, not only in an arrow.
 */
@Composable
fun Mk8dxComparisonGrid(
    caption: String,
    leadColumn: Mk8dxComparisonColumn,
    columns: List<Mk8dxComparisonColumn>,
    rowCount: Int,
    leadWidth: Dp,
    columnWidth: Dp,
    rowHeight: Dp,
    onColumnClick: (Mk8dxComparisonColumn) -> Unit,
    modifier: Modifier = Modifier,
    /** False for a grid that only reads: no sort affordance is offered. */
    sortable: Boolean = true,
    lead: @Composable (Int) -> Unit,
    cell: @Composable (Int, Mk8dxComparisonColumn) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .semantics { contentDescription = caption },
    ) {
        Row(
            Modifier.background(colors.surfaceControl).heightIn(min = Mk8dxSpacing.targetMin),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Mk8dxComparisonHeaderCell(leadColumn, leadWidth, sortable, onColumnClick)
            for (column in columns) Mk8dxComparisonHeaderCell(column, columnWidth, sortable, onColumnClick)
        }
        for (index in 0 until rowCount) {
            Row(
                Modifier
                    .drawBehind {
                        drawRect(
                            colors.borderSubtle,
                            topLeft = Offset(0f, size.height - 1.dp.toPx()),
                            size = Size(size.width, 1.dp.toPx()),
                        )
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(leadWidth).heightIn(min = rowHeight)) { lead(index) }
                for (column in columns) {
                    Box(
                        Modifier.width(columnWidth).heightIn(min = rowHeight)
                            .padding(horizontal = Mk8dxSpacing.xs, vertical = Mk8dxSpacing.xs),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        cell(index, column)
                    }
                }
            }
        }
    }
}

@Composable
private fun Mk8dxComparisonHeaderCell(
    column: Mk8dxComparisonColumn,
    width: Dp,
    sortable: Boolean,
    onColumnClick: (Mk8dxComparisonColumn) -> Unit,
) {
    val colors = Mk8dxTheme.colors
    val ordered = column.sorted != null
    Box(
        Modifier
            .width(width)
            .heightIn(min = Mk8dxSpacing.targetMin)
            .then(
                if (sortable) {
                    Modifier.clickable(role = Role.Button, onClick = { onColumnClick(column) })
                } else {
                    Modifier
                },
            )
            .padding(horizontal = Mk8dxSpacing.xs, vertical = Mk8dxSpacing.xs)
            .then(column.tag?.let { Modifier.testTag(it) } ?: Modifier),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            column.label + when {
                !sortable -> ""
                column.sorted == Mk8dxSortDirection.Ascending -> " ↑"
                column.sorted == Mk8dxSortDirection.Descending -> " ↓"
                else -> " ↕"
            },
            style = Mk8dxTheme.type.micro.copy(fontWeight = if (ordered) FontWeight.Bold else FontWeight.SemiBold),
            color = if (ordered) colors.textPrimary else colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A field label above an input, in the design system's quiet label type. */
@Composable
fun Mk8dxFieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = Mk8dxTheme.type.label,
        color = Mk8dxTheme.colors.textSecondary,
    )
}

/**
 * SearchField (§24 Forms): the same single-line field as [Mk8dxTextField], named
 * for what it does where a list is filtered as you type.
 */
@Composable
fun Mk8dxSearchField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    tag: String? = null,
) {
    Mk8dxTextField(label, value, onValueChange, modifier, placeholder = placeholder, tag = tag)
}

/** A meta line under a value: the quiet type, never a colour of its own. */
@Composable
fun Mk8dxMetaLine(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = Mk8dxTheme.type.bodyS,
        color = Mk8dxTheme.colors.textTertiary,
    )
}

/** The width a lead column takes on a phone and at width. */
fun mk8dxLeadColumnWidth(wide: Boolean): Dp = if (wide) 180.dp else 96.dp

// ------------------------------------------------------------------ pickers and lists (§24)

/**
 * Select (§24 Forms): a labelled value that opens a picker. Label, value and an
 * optional thumbnail share one 44 dp target announced as a button; the value
 * ellipsises rather than pushing the chevron off the row.
 */
@Composable
fun Mk8dxSelectField(
    label: String,
    value: String,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceControl)
            .border(1.dp, colors.borderStrong)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        leading?.invoke()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = Mk8dxTheme.type.micro, color = colors.textSecondary)
            Text(
                value, style = Mk8dxTheme.type.body, color = colors.textPrimary,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            "▾", style = Mk8dxTheme.type.label, color = colors.textSecondary,
            modifier = Modifier.clearAndSetSemantics { },
        )
    }
}

/**
 * AssetPicker tile (§14 SetupPicker): a piece of game art with its name under
 * it. The selected tile is a surface, a border and a ✓ before the name, so the
 * choice survives a colour-blind reading and forced colours.
 */
@Composable
fun Mk8dxPickerTile(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    art: @Composable () -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(if (selected) colors.surfaceSelected else colors.surfaceControl)
            .border(if (selected) 2.dp else 1.dp, if (selected) colors.borderControl else colors.borderSubtle)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(Mk8dxSpacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxs),
    ) {
        art()
        Text(
            if (selected) "✓ $label" else label,
            style = Mk8dxTheme.type.micro.copy(
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            ),
            color = if (selected) colors.textPrimary else colors.textSecondary,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * One option in a list a picker offers: a full-width 44 dp row with its art,
 * its name, and a ✓ when it is the chosen one. `Role.RadioButton` makes the
 * choice audible; the tick makes it visible without colour.
 */
@Composable
fun Mk8dxOptionRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(if (selected) colors.surfaceSelected else colors.surfaceControl)
            .border(1.dp, if (selected) colors.borderStrong else colors.borderSubtle)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        leading?.invoke()
        Text(
            if (selected) "✓ $label" else label,
            modifier = Modifier.weight(1f),
            style = Mk8dxTheme.type.body.copy(
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            ),
            color = if (selected) colors.textPrimary else colors.textBody,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * NotificationItem (§24 Content): one entry of the inbox. An unread entry keeps
 * a 3 dp flare edge *and* a tag, because a colour alone is not a state; the
 * caller owns every word, the thumbnail and the actions.
 */
@Composable
fun Mk8dxNotificationItem(
    title: String,
    modifier: Modifier = Modifier,
    unread: Boolean = false,
    unreadLabel: String? = null,
    meta: String? = null,
    leading: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .drawBehind {
                if (unread) drawRect(colors.actionPrimary, size = Size(3.dp.toPx(), size.height))
            }
            .padding(Mk8dxSpacing.md),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        leading?.invoke()
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                title,
                modifier = Modifier.weight(1f),
                style = Mk8dxTheme.type.title,
                color = colors.textPrimary,
            )
            if (unread && unreadLabel != null) {
                Mk8dxChip(unreadLabel, tone = Mk8dxChipTone.Warning)
            }
        }
        content()
        if (meta != null && meta.isNotBlank()) Mk8dxMetaLine(meta)
    }
}

/**
 * Dialog (§21, §24 Forms): an overlay that traps focus, closes on Back and
 * carries a labelled title. It scrolls nothing itself — a picker puts its own
 * list inside — and it never forces a height the font scale cannot grow past.
 */
@Composable
fun Mk8dxDialog(
    title: String,
    closeLabel: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier
                .fillMaxWidth(.94f)
                .widthIn(max = 720.dp)
                .background(colors.surfaceApp)
                .border(1.dp, colors.borderStrong)
                .padding(Mk8dxSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(
                    title,
                    modifier = Modifier.weight(1f).semantics { heading() },
                    style = Mk8dxTheme.type.title,
                    color = colors.textPrimary,
                )
                Mk8dxButton(
                    closeLabel, onDismiss,
                    variant = Mk8dxButtonVariant.Quiet, size = Mk8dxButtonSize.Sm,
                )
            }
            content()
        }
    }
}

/** A row of stat blocks that wraps at narrow widths. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Mk8dxStatRow(
    stats: List<Triple<String, String, String?>>,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        for ((label, value, hint) in stats) {
            Mk8dxStatBlock(label, value, Modifier.widthIn(min = 96.dp), hint)
        }
    }
}

// ------------------------------------------------------------------ spectacle (§5, §16, §24 Content)

/**
 * ArtHero (§16): the identity strip of a MEDIUM or HIGH route.
 *
 * MEDIUM passes a small piece of art that sits *beside* the name — a face, a
 * cup, a thumbnail — and gets display-3. HIGH passes [backdrop], and the art
 * fills the strip behind a shade drawn from the app surface, so the display
 * type on top keeps its contrast whatever the artwork happens to be. A data tab
 * never asks for a backdrop; that is what keeps the levels apart.
 */
@Composable
fun Mk8dxArtHero(
    title: String,
    modifier: Modifier = Modifier,
    meta: String? = null,
    backdrop: Boolean = false,
    titleStyle: TextStyle? = null,
    art: (@Composable () -> Unit)? = null,
    /**
     * A small mark that stays *beside* the name even when [art] is a backdrop —
     * the Player's own character on Home, where the backdrop is the track behind
     * them. Without it a HIGH hero would have to choose between the two.
     */
    leading: (@Composable () -> Unit)? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    val style = titleStyle ?: if (backdrop) Mk8dxTheme.type.display2 else Mk8dxTheme.type.display3
    Box(modifier.fillMaxWidth()) {
        if (backdrop && art != null) {
            Box(Modifier.matchParentSize()) { art() }
            // The shade: §16 holds the art at art-opacity under the words, and
            // the words are display type, so the shade is the app surface at
            // the share that keeps them at 4.5:1 in every appearance.
            Box(
                Modifier
                    .matchParentSize()
                    .background(colors.surfaceApp.copy(alpha = if (Mk8dxTheme.appearance == Mk8dxAppearance.Light) 0.82f else 0.72f)),
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                // The strip is at least this tall, and grows with its words at
                // a large font scale; the art behind it fills whatever height
                // the words ask for rather than stopping short of them.
                .then(if (backdrop) Modifier.heightIn(min = 120.dp) else Modifier)
                .padding(
                    horizontal = if (backdrop) Mk8dxSpacing.md else 0.dp,
                    vertical = if (backdrop) Mk8dxSpacing.lg else 0.dp,
                ),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!backdrop && art != null) art()
            leading?.invoke()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                Mk8dxDisplayText(title, style)
                if (meta != null) {
                    Text(meta, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
                }
                content?.invoke(this)
            }
        }
    }
}

/**
 * LiveTag (§4 A4, §24 Status): the one filled tag a running night is allowed.
 * It is [Mk8dxChip]'s Live tone under the catalogue's own name, so there is one
 * implementation and callers do not have to know the tone enum.
 */
@Composable
fun Mk8dxLiveTag(label: String, modifier: Modifier = Modifier) {
    Mk8dxChip(label, modifier, tone = Mk8dxChipTone.Live)
}

// ------------------------------------------------------------------ boards (§15, §24 Content)

/** One line of a group board: a place, a name, a value, and what marks it. */
data class Mk8dxBoardRow(
    val rank: Int,
    val name: String,
    val value: String,
    val you: Boolean = false,
    /** A wash across the whole row — a qualifier row carries where that Player went on to. */
    val wash: Color? = null,
    val key: String = name,
)

/**
 * GroupBoard (§24 Content): one group's standing.
 *
 * The group's name in display type, its own colour as the board's top edge and
 * never as the only carrier of anything, the three columns the export prints,
 * and the first three in the rank colours. Used by a night being run, a night
 * that has finished and the published report alike, so the three cannot drift.
 */
@Composable
fun Mk8dxGroupBoard(
    title: String,
    rows: List<Mk8dxBoardRow>,
    language: Mk8dxNumberLanguage,
    columns: Triple<String, String, String>,
    modifier: Modifier = Modifier,
    meta: String? = null,
    accent: Color? = null,
    youLabel: String? = null,
    onRowClick: ((Mk8dxBoardRow) -> Unit)? = null,
    face: (@Composable (Mk8dxBoardRow) -> Unit)? = null,
    header: (@Composable RowScope.() -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val rankStyle = type.data.copy(fontWeight = FontWeight.SemiBold)
    // §10: the rank column is as wide as the formatted largest rank of this
    // board, measured, so #1 and #12 share one column and neither is clipped.
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val rankWidth = with(density) {
        measurer.measure(
            Mk8dxNumeric.formatRank(rows.maxOfOrNull { it.rank } ?: 1, language),
            rankStyle, softWrap = false, maxLines = 1,
        ).size.width.toDp()
    } + 2.dp
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceRaised)
            .border(1.dp, colors.borderSubtle)
            .drawBehind {
                if (accent != null) drawRect(accent, size = Size(size.width, 3.dp.toPx()))
            }
            .padding(Mk8dxSpacing.md),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            Mk8dxDisplayText(title, type.display6, Modifier.weight(1f))
            header?.invoke(this)
        }
        if (meta != null) Mk8dxMetaLine(meta)
        Row(
            Modifier.fillMaxWidth().padding(top = Mk8dxSpacing.xxs),
            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
        ) {
            val head = type.micro.copy(fontWeight = FontWeight.Bold)
            Text(columns.first, style = head, color = colors.textSecondary, modifier = Modifier.width(rankWidth))
            Text(columns.second, style = head, color = colors.textSecondary, modifier = Modifier.weight(1f))
            Text(
                columns.third, style = head, color = colors.textSecondary,
                textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 40.dp),
            )
        }
        for (row in rows) {
            val rankColor = when {
                row.you -> colors.personalAccent
                row.rank == 1 -> colors.rankGold
                row.rank == 2 -> colors.rankSilver
                row.rank == 3 -> colors.rankBronze
                else -> colors.textSecondary
            }
            val edge: Pair<Dp, Color>? = when {
                row.you -> 4.dp to colors.personalEdge
                row.rank == 1 -> 3.dp to colors.rankGold
                row.rank == 2 -> 3.dp to colors.rankSilver
                row.rank == 3 -> 3.dp to colors.rankBronze
                else -> null
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Mk8dxComponentDimensions.tableRowDense)
                    .background(
                        when {
                            row.you -> colors.personalWash
                            row.wash != null -> row.wash
                            else -> Color.Transparent
                        },
                    )
                    .drawBehind {
                        if (edge != null) drawRect(edge.second, size = Size(edge.first.toPx(), size.height))
                    }
                    .then(
                        if (onRowClick == null) Modifier
                        else Modifier.clickable(role = Role.Button) { onRowClick(row) },
                    )
                    .padding(start = Mk8dxSpacing.sm, end = Mk8dxSpacing.xs, top = 3.dp, bottom = 3.dp)
                    .semantics(mergeDescendants = true) { },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(
                    Mk8dxNumeric.formatRank(row.rank, language),
                    style = rankStyle, color = rankColor, softWrap = false, maxLines = 1,
                    modifier = Modifier.width(rankWidth),
                )
                Text(
                    row.name,
                    style = type.body.copy(fontWeight = if (row.you) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (row.you) colors.textPrimary else colors.textBody,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (row.you && youLabel != null) Mk8dxYouChip(youLabel)
                face?.invoke(row)
                Text(
                    row.value,
                    style = type.data.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary, softWrap = false, maxLines = 1,
                    textAlign = TextAlign.End,
                    modifier = Modifier.widthIn(min = 40.dp),
                )
            }
        }
    }
}

/**
 * SortHeader (§15): one column head that orders the table. The direction is in
 * the label rather than only in an arrow's rotation, and the whole head is a
 * 44 dp button.
 */
@Composable
fun Mk8dxSortHeader(
    label: String,
    sorted: Mk8dxSortDirection?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    Box(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = Mk8dxSpacing.sm),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            label + when (sorted) {
                Mk8dxSortDirection.Ascending -> " ↑"
                Mk8dxSortDirection.Descending -> " ↓"
                else -> " ↕"
            },
            style = Mk8dxTheme.type.micro.copy(
                fontWeight = if (sorted != null) FontWeight.Bold else FontWeight.SemiBold,
            ),
            color = if (sorted != null) colors.textPrimary else colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The filter box that belongs to one column of a wide table: the head above it
 * already names the column, so the box carries only its own hint. It is the
 * dense twin of [Mk8dxTextField] and keeps the 44 dp target.
 */
@Composable
fun Mk8dxColumnFilter(
    label: String,
    value: String,
    hint: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = Mk8dxTheme.type.data.copy(color = colors.textPrimary),
        cursorBrush = SolidColor(colors.actionPrimary),
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceControl)
            .border(1.dp, colors.borderStrong)
            .padding(horizontal = Mk8dxSpacing.sm, vertical = Mk8dxSpacing.sm)
            .semantics { contentDescription = label },
        decorationBox = { field ->
            if (value.isEmpty()) {
                Text(hint, style = Mk8dxTheme.type.dataS, color = colors.textTertiary, maxLines = 1)
            }
            field()
        },
    )
}

/**
 * Disclosure (§24 Content): a labelled row that opens what is under it. The
 * open state is announced, and the ▸/▾ is decorative beside the word.
 */
@Composable
fun Mk8dxDisclosure(
    label: String,
    open: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .background(colors.surfaceControl)
            .border(1.dp, colors.borderSubtle)
            .clickable(role = Role.Button, onClick = onToggle)
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm)
            .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Text(
            if (open) "▾" else "▸",
            style = Mk8dxTheme.type.label, color = colors.textSecondary,
            modifier = Modifier.clearAndSetSemantics { },
        )
        Text(
            label,
            style = Mk8dxTheme.type.label.copy(fontWeight = FontWeight.SemiBold),
            color = colors.textPrimary,
            modifier = Modifier.weight(1f),
        )
    }
}
