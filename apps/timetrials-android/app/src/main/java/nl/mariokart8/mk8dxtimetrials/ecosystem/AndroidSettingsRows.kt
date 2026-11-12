package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * One group of Settings: a section header and calm rows on one raised surface, separated by hairlines
 * (owner 2026-11-13: grouped list rows instead of a stack of heavy panels).
 */
@Composable
internal fun AndroidSettingsGroup(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
        Text(
            title.uppercase(),
            style = Mk8dxTheme.type.micro,
            color = colors.textSecondary,
            modifier = Modifier.padding(horizontal = Mk8dxSpacing.xs).semantics { heading() },
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(colors.surfaceRaised)
                .border(1.dp, colors.borderSubtle),
            content = content,
        )
    }
}

/** The hairline between two rows of a group. */
@Composable
internal fun AndroidSettingsDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Mk8dxTheme.colors.borderSubtle))
}

/**
 * A row: its title, the current value on one short line, and a chevron when it opens something. Without
 * [onClick] it only shows what it says.
 */
@Composable
internal fun AndroidSettingsRow(
    title: String,
    value: String? = null,
    onClick: (() -> Unit)? = null,
    tag: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = Mk8dxTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Mk8dxSpacing.targetMin)
            .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it }
            .padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm)
            .let { if (tag != null) it.testTag(tag) else it },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Mk8dxTheme.type.body, color = colors.textPrimary)
            if (!value.isNullOrBlank()) {
                Text(
                    value,
                    style = Mk8dxTheme.type.bodyS,
                    color = colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.invoke()
        if (onClick != null && trailing == null) {
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(22.dp))
        }
    }
}

/** A row whose control opens in place under it (appearance, notifications, public profile). */
@Composable
internal fun AndroidSettingsExpandableRow(
    title: String,
    value: String?,
    tag: String,
    initiallyOpen: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    var open by rememberSaveable(tag) { mutableStateOf(initiallyOpen) }
    val colors = Mk8dxTheme.colors
    AndroidSettingsRow(title, value, onClick = { open = !open }, tag = tag) {
        Icon(
            if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
            contentDescription = null,
            tint = colors.textSecondary,
            modifier = Modifier.size(22.dp),
        )
    }
    if (open) {
        Column(
            Modifier.fillMaxWidth().padding(start = Mk8dxSpacing.md, end = Mk8dxSpacing.md, bottom = Mk8dxSpacing.md),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            content = content,
        )
    }
}

/** A row with a control right under its title, for choices that save the moment they change. */
@Composable
internal fun AndroidSettingsControlRow(
    /** Null when the control names itself (a text field carries its own label). */
    title: String?,
    note: String? = null,
    status: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Mk8dxSpacing.md, vertical = Mk8dxSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
    ) {
        if (title != null || !status.isNullOrBlank()) Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title.orEmpty(), style = Mk8dxTheme.type.body, color = colors.textPrimary, modifier = Modifier.weight(1f))
            if (!status.isNullOrBlank()) {
                Text(status, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary, modifier = Modifier.testTag("settings-inline-status"))
            }
        }
        content()
        if (!note.isNullOrBlank()) {
            Text(note, style = Mk8dxTheme.type.bodyS, color = colors.textSecondary)
        }
    }
}

/** What an automatically saved text field does once the typing stops. */
internal sealed interface AndroidAutoSave {
    /** The community already has this value: nothing is sent. */
    data object Unchanged : AndroidAutoSave
    /** Send this value; null clears it. */
    data class Save(val value: String?) : AndroidAutoSave
}

/** The trimmed draft against what is saved; a blank draft clears the field. */
internal fun androidSettingsAutoSave(draft: String, saved: String?): AndroidAutoSave {
    val next = draft.trim().ifBlank { null }
    return if (next == saved?.trim()?.ifBlank { null }) AndroidAutoSave.Unchanged else AndroidAutoSave.Save(next)
}

/** How long a typed field waits after the last keystroke before it saves itself. */
internal const val ANDROID_SETTINGS_AUTOSAVE_DELAY_MS = 800L
