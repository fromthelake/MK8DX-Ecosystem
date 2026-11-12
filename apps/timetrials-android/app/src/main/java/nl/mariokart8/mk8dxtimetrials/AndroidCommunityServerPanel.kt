package nl.mariokart8.mk8dxtimetrials

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
internal fun androidCommunityUnsentCount(context: Context, origin: String): Int = runCatching {
    createAndroidProductTimeTrialOutboxFor(context, origin).listIndex()
        .count { androidOutboxCountsAsUnsent(it.storedState, it.failureCode) }
}.getOrDefault(0) + runCatching { AndroidCarriedQueue.forOrigin(context, origin).size() }.getOrDefault(0)

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
    LaunchedEffect(apiOrigin, reload) {
        val (list, counts) = withContext(Dispatchers.IO) {
            val list = AndroidCommunities.list(context)
            list to list.associate { it.origin to androidCommunityUnsentCount(context, it.origin) }
        }
        communities = list
        unsent = counts
        waitingCarried = withContext(Dispatchers.IO) {
            list.associate { it.origin to runCatching { AndroidCarriedQueue.forOrigin(context, it.origin).list() }.getOrDefault(emptyList()) }
        }
    }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(t("Community server", "Communityserver"), modifier = Modifier.testTag("settings-communities")) {
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
            Column(
                Modifier.fillMaxWidth().testTag("settings-community-$index"),
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
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    if (active) Mk8dxChip(t("Active", "Actief"), tone = Mk8dxChipTone.Success)
                }
                if (community.name != community.origin) Mk8dxMetaLine(community.origin)
                Mk8dxMetaLine(
                    when (waiting) {
                        0 -> t("Nothing waiting to be sent", "Niets wacht op verzenden")
                        1 -> t("1 run waiting to be sent", "1 rit wacht op verzenden")
                        else -> t("$waiting runs waiting to be sent", "$waiting ritten wachten op verzenden")
                    },
                )
                // Copies carried here that wait for somebody to sign in: each can be called back.
                waitingCarried[community.origin].orEmpty().forEachIndexed { carriedIndex, staged ->
                    val submissionId = (staged["submissionId"] as? JsonPrimitive)?.content
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            t("Carried time waiting for sign-in: ${androidCarriedLabel(staged)}",
                                "Meegenomen tijd wacht op aanmelden: ${androidCarriedLabel(staged)}"),
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
                                        )
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
