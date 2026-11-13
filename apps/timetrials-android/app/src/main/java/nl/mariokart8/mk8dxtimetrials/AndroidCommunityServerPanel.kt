package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import nl.mariokart8.mk8dxtimetrials.carry.AndroidCarriedQueue
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.outbox.androidOutboxCountsAsUnsent
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidProductTimeTrialOutboxFor
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxMetaLine
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * Runs of [origin] that have not reached it yet: its outbox (pending or failed) plus copies carried there that
 * wait for somebody to sign in. Read from that community's own namespace without making it active.
 */
internal fun androidCommunityUnsentCount(context: Context, origin: String): Int =
    androidCommunityOutboxUnsentCount(context, origin) +
        runCatching { AndroidCarriedQueue.forOrigin(context, origin).size() }.getOrDefault(0)

/** Runs in [origin]'s outbox that have not reached it yet, without the carried copies waiting for sign-in. */
internal fun androidCommunityOutboxUnsentCount(context: Context, origin: String): Int = runCatching {
    createAndroidProductTimeTrialOutboxFor(context, origin).listIndex()
        .count { androidOutboxCountsAsUnsent(it.storedState, it.failureCode) }
}.getOrDefault(0)

/**
 * What a community tile says about waiting runs: the outbox runs on one line, the carried copies waiting for
 * sign-in on their own line, and "Nothing waiting to be sent" only when both are zero.
 */
internal data class AndroidCommunityWaiting(val outboxRuns: Int, val carriedCopies: Int) {
    val nothing: Boolean get() = outboxRuns == 0 && carriedCopies == 0
    /** The generic line's count; null when that line is not shown. */
    val runsLine: Int? get() = outboxRuns.takeIf { it > 0 }
}

/**
 * Settings -> Community server (ADR-0225 section 1): every community this phone knows, the active one marked,
 * a one-tap switch to the others, how many runs each still has to send, and adding or forgetting one.
 */
@Composable
internal fun AndroidCommunityServerPanel(
    apiOrigin: String,
    language: AndroidProductLanguage,
    onSwitch: (String) -> Unit,
    onAdd: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun t(english: String, dutch: String) = androidText(language, english, dutch)
    var communities by remember { mutableStateOf<List<AndroidCommunity>>(emptyList()) }
    var unsent by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var waitingCarried by remember { mutableStateOf<Map<String, List<JsonObject>>>(emptyMap()) }
    var message by remember { mutableStateOf<Pair<String, Mk8dxStatusTone>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var expandedCarried by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(apiOrigin, reload) {
        val (list, counts) = withContext(Dispatchers.IO) {
            val list = AndroidCommunities.list(context)
            list to list.associate { it.origin to androidCommunityOutboxUnsentCount(context, it.origin) }
        }
        communities = list
        unsent = counts
        waitingCarried = withContext(Dispatchers.IO) {
            list.associate { it.origin to runCatching { AndroidCarriedQueue.forOrigin(context, it.origin).list() }.getOrDefault(emptyList()) }
        }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    // The community switcher the header chip opens (it used to be a panel in Settings).
    Column(
        Modifier.fillMaxWidth().testTag("settings-communities"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Text(
            t(
                "Each community keeps its own account and unsent times. Switching takes one tap.",
                "Elke community houdt haar eigen account en niet verzonden tijden. Wisselen is één tik.",
            ),
            style = type.bodyS,
            color = colors.textSecondary,
        )
        communities.forEachIndexed { index, community ->
            val active = community.origin == apiOrigin
            val waiting = unsent[community.origin] ?: 0
            // A tile per community (owner, 12-11): the active one green, the others quieter until switched to.
            val tile = RoundedCornerShape(Mk8dxSpacing.sm)
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(tile)
                    .border(if (active) 2.dp else 1.dp, if (active) colors.statusSuccess else colors.borderSubtle, tile)
                    .background(if (active) colors.statusSuccess.copy(alpha = 0.10f) else colors.surfaceApp)
                    .padding(Mk8dxSpacing.md)
                    .testTag("settings-community-$index"),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        community.name,
                        style = type.title,
                        color = if (active) colors.textPrimary else colors.textSecondary,
                        modifier = Modifier.weight(1f).alpha(if (active) 1f else 0.75f),
                    )
                    if (active) Mk8dxChip(t("Active", "Actief"), tone = Mk8dxChipTone.Success)
                }
                if (community.name != community.origin) Mk8dxMetaLine(community.origin)
                val summary = AndroidCommunityWaiting(waiting, waitingCarried[community.origin].orEmpty().size)
                if (summary.nothing) {
                    Mk8dxMetaLine(t("Nothing waiting to be sent", "Niets wacht op verzenden"))
                }
                summary.runsLine?.let { runs ->
                    Mk8dxMetaLine(
                        if (runs == 1) t("1 run waiting to be sent", "1 rit wacht op verzenden")
                        else t("$runs runs waiting to be sent", "$runs ritten wachten op verzenden"),
                    )
                }
                // Copies carried here that wait for somebody to sign in: each can be called back.
                // Carried copies waiting for sign-in: one summary line, the list only on request (owner, 13-11:
                // "Mijn beste tijden meenemen" queued 111 copies and the sheet became one endless list).
                val carried = waitingCarried[community.origin].orEmpty()
                if (carried.isNotEmpty()) {
                    val open = expandedCarried == community.origin
                    Text(
                        if (carried.size == 1) t(
                            "1 carried time waits until you sign in here.",
                            "1 meegenomen tijd wacht tot je je hier aanmeldt.",
                        ) else t(
                            "${carried.size} carried times wait until you sign in here.",
                            "${carried.size} meegenomen tijden wachten tot je je hier aanmeldt.",
                        ),
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                        Mk8dxButton(
                            if (open) t("Hide", "Verbergen") else t("Show", "Bekijken"),
                            { expandedCarried = if (open) null else community.origin },
                            variant = Mk8dxButtonVariant.Quiet,
                            size = Mk8dxButtonSize.Sm,
                            tag = "settings-community-$index-carried-toggle",
                        )
                        Mk8dxButton(
                            t("Remove all", "Alles verwijderen"),
                            {
                                scope.launch {
                                    withContext(Dispatchers.IO) {
                                        val queue = AndroidCarriedQueue.forOrigin(context, community.origin)
                                        carried.mapNotNull { (it["submissionId"] as? JsonPrimitive)?.content }
                                            .forEach { id -> runCatching { queue.remove(id) } }
                                    }
                                    reload++
                                }
                            },
                            variant = Mk8dxButtonVariant.Quiet,
                            size = Mk8dxButtonSize.Sm,
                            tag = "settings-community-$index-carried-remove-all",
                        )
                    }
                    if (open) carried.forEachIndexed { carriedIndex, staged ->
                        val submissionId = (staged["submissionId"] as? JsonPrimitive)?.content
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                androidCarriedLabel(staged),
                                style = type.bodyS,
                                color = colors.textSecondary,
                                modifier = Modifier.weight(1f),
                            )
                            Mk8dxButton(
                                t("Remove", "Verwijderen"),
                                {
                                    if (submissionId != null) scope.launch {
                                        withContext(Dispatchers.IO) {
                                            runCatching { AndroidCarriedQueue.forOrigin(context, community.origin).remove(submissionId) }
                                        }
                                        reload++
                                    }
                                },
                                variant = Mk8dxButtonVariant.Quiet,
                                size = Mk8dxButtonSize.Sm,
                                tag = "settings-community-$index-carried-remove-$carriedIndex",
                            )
                        }
                    }
                }
                if (!active) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                        Mk8dxButton(
                            t("Switch", "Wisselen"),
                            { onSwitch(community.origin) },
                            variant = Mk8dxButtonVariant.Primary,
                            size = Mk8dxButtonSize.Sm,
                            tag = "settings-community-switch-$index",
                        )
                        Mk8dxButton(
                            t("Remove from this phone", "Van deze telefoon verwijderen"),
                            {
                                scope.launch {
                                    val outcome = withContext(Dispatchers.IO) {
                                        AndroidCommunities.remove(
                                            context, community.origin,
                                            androidCommunityUnsentCount(context, community.origin),
                                        ).also {
                                            // ADR-0225 amendment 1: the copy goes with the community.
                                            if (it == AndroidCommunityRemoval.Removed) {
                                                nl.mariokart8.mk8dxtimetrials.offline.AndroidOfflineCopyStore
                                                    .forOrigin(context, community.origin).delete()
                                            }
                                        }
                                    }
                                    message = when (outcome) {
                                        AndroidCommunityRemoval.Removed -> t(
                                            "${community.name} was removed from this phone.",
                                            "${community.name} is van deze telefoon verwijderd.",
                                        ) to Mk8dxStatusTone.Success
                                        is AndroidCommunityRemoval.RefusedUnsent -> t(
                                            "${community.name} still has runs that were not sent. Switch to it and send them first.",
                                            "${community.name} heeft nog ritten die niet zijn verzonden. Wissel ernaar en verstuur ze eerst.",
                                        ) to Mk8dxStatusTone.Warning
                                        else -> null
                                    }
                                    reload++
                                }
                            },
                            variant = Mk8dxButtonVariant.Quiet,
                            size = Mk8dxButtonSize.Sm,
                            tag = "settings-community-remove-$index",
                        )
                    }
                }
            }
        }
        message?.let { (text, tone) -> Mk8dxStatusMessage(text, tone = tone) }
        Mk8dxButton(
            t("Add a community", "Een community toevoegen"),
            onAdd,
            variant = Mk8dxButtonVariant.Secondary,
            tag = "settings-community-add",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Track and time of a waiting carried copy, as the person knows the run. */
internal fun androidCarriedLabel(staged: JsonObject): String {
    val trackId = (staged["trackId"] as? JsonPrimitive)?.content
    val track = trackId?.let { Schema9AndroidTrackCatalog.find(it)?.displayName ?: it } ?: "?"
    val time = (staged["totalTimeMs"] as? JsonPrimitive)?.content?.toLongOrNull()?.let(Mk8dxNumeric::formatTime) ?: "?"
    val mode = (staged["mode"] as? JsonPrimitive)?.content
    return "$track · ${mode}cc · $time"
}

/** The header chip's text: the community's own name when known, else its host. */
internal fun androidCommunityChipLabel(communities: List<AndroidCommunity>, activeOrigin: String): String =
    communities.firstOrNull { it.origin == activeOrigin }?.name?.takeIf { it.isNotBlank() }
        ?: AndroidCommunityList.displayNameOf(activeOrigin)
