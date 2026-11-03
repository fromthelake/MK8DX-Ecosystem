package nl.mariokart8.mk8dxtimetrials.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text

/**
 * "Edit ✎": the one action that opens your own result in the form of Post a Time (ADR-0211),
 * wherever a run of yours is shown (owner 2026-09-29).
 */
@Composable
fun Mk8dxEditAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String? = null,
) {
    val colors = Mk8dxTheme.colors
    Row(
        modifier
            .heightIn(min = Mk8dxSpacing.targetMin)
            .border(1.dp, colors.borderStrong)
            .background(colors.surfaceControl)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Mk8dxSpacing.md)
            .then(if (tag == null) Modifier else Modifier.testTag(tag)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        Text(label, style = Mk8dxTheme.type.body.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
        Icon(Mk8dxIcons.Pencil, contentDescription = null, tint = colors.textPrimary, modifier = Modifier.size(18.dp))
    }
}

/**
 * A deliberate confirmation for an action that removes something from view (owner 2026-09-29:
 * "an additional prompt with a swipe motion to confirm"). The handle has to travel the whole
 * track; letting go earlier puts it back. A screen reader confirms with the node's own action.
 */
@Composable
fun Mk8dxSwipeToConfirm(
    label: String,
    onConfirmed: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tag: String? = null,
) {
    val colors = Mk8dxTheme.colors
    val handle = 56.dp
    val handlePx = with(LocalDensity.current) { handle.toPx() }
    var width by remember { mutableIntStateOf(0) }
    var offset by remember { mutableFloatStateOf(0f) }
    val travel = (width - handlePx).coerceAtLeast(1f)
    Box(
        modifier
            .fillMaxWidth()
            .height(handle)
            .background(colors.surfaceControl)
            .border(1.dp, if (enabled) colors.statusError else colors.borderStrong)
            .onSizeChanged { width = it.width }
            .semantics {
                contentDescription = label
                if (enabled) onClick(label) { onConfirmed(); true }
            }
            .then(if (tag == null) Modifier else Modifier.testTag(tag)),
    ) {
        Text(
            label,
            Modifier.align(Alignment.Center).padding(start = handle),
            style = Mk8dxTheme.type.body.copy(fontWeight = FontWeight.SemiBold),
            color = if (enabled) colors.statusError else colors.textSecondary,
        )
        Box(
            Modifier
                .offset { IntOffset(offset.roundToInt(), 0) }
                .size(handle)
                .background(if (enabled) colors.statusError else colors.borderStrong)
                .pointerInput(enabled, travel) {
                    if (!enabled) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (offset >= travel * 0.92f) {
                                offset = travel
                                onConfirmed()
                            } else {
                                offset = 0f
                            }
                        },
                        onDragCancel = { offset = 0f },
                    ) { _, drag -> offset = (offset + drag).coerceIn(0f, travel) }
                }
                .then(if (tag == null) Modifier else Modifier.testTag("$tag-handle")),
            contentAlignment = Alignment.Center,
        ) {
            Text("»", style = Mk8dxTheme.type.title, color = colors.actionOnPrimary)
        }
    }
}
