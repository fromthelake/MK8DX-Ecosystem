package nl.mariokart8.mk8dxtimetrials.carry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.AndroidCommunities
import nl.mariokart8.mk8dxtimetrials.AndroidCommunity
import nl.mariokart8.mk8dxtimetrials.AndroidCommunityList
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF
import nl.mariokart8.mk8dxtimetrials.outbox.ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED
import nl.mariokart8.mk8dxtimetrials.lan.AndroidOriginTrust
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidLocalTimeTrialOutbox
import nl.mariokart8.mk8dxtimetrials.outbox.createAndroidProductTimeTrialOutboxFor
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentClient
import nl.mariokart8.mk8dxtimetrials.tournament.AndroidTournamentConnectionOpener
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * "Carry to another community" for a sent result (ADR-0225 2.5). Null while the phone knows only one community:
 * the saved results then show no such action at all.
 */
internal val LocalAndroidCarryOffer = compositionLocalOf<((entryKey: String) -> Unit)?> { null }

/**
 * ADR-0225: what the saved results need to show a carried copy the active community refused, and to remove it.
 * Present whenever the active community is known, also with a single community on the phone.
 */
internal class AndroidCarriedRefusals(val communityName: String, val discard: (entryKey: String) -> Boolean)

internal val LocalAndroidCarriedRefusals = compositionLocalOf<AndroidCarriedRefusals?> { null }

/** "Not accepted by <community>: why." for the two refusal codes, null for anything else. */
internal fun androidCarriedRefusalText(language: AndroidProductLanguage, name: String, failureCode: String?): String? =
    when (failureCode) {
        ANDROID_CANONICAL_TRANSPORT_CARRIED_TIMES_DISABLED -> androidText(language,
            "Not accepted by $name: this community does not accept times from other communities.",
            "Niet aangenomen door $name: deze community neemt geen tijden van andere communities aan.")
        ANDROID_CANONICAL_TRANSPORT_CARRIED_FROM_SELF -> androidText(language,
            "Not accepted by $name: this time already comes from this community.",
            "Niet aangenomen door $name: deze tijd komt al uit deze community.")
        else -> null
    }

private sealed interface CarryStep {
    data class Choose(val entryKey: String) : CarryStep
    data class Checking(val target: AndroidCommunity) : CarryStep
    data class Done(val text: String, val tone: Mk8dxStatusTone) : CarryStep
}

@Composable
internal fun AndroidCarryHost(
    activeOrigin: String,
    localOutbox: AndroidLocalTimeTrialOutbox,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var communities by remember { mutableStateOf<List<AndroidCommunity>>(emptyList()) }
    var step by remember { mutableStateOf<CarryStep?>(null) }
    LaunchedEffect(activeOrigin) {
        communities = withContext(Dispatchers.IO) { runCatching { AndroidCommunities.list(context) }.getOrDefault(emptyList()) }
    }
    val source = communities.firstOrNull { it.origin == activeOrigin }
    val targets = communities.filter { it.origin != activeOrigin }
    val offer: ((String) -> Unit)? = if (targets.isEmpty()) null else { key -> step = CarryStep.Choose(key) }
    val refusals = remember(activeOrigin, localOutbox, source?.name) {
        AndroidCarriedRefusals(source?.name ?: AndroidCommunityList.displayNameOf(activeOrigin)) { key ->
            runCatching { localOutbox.discardRefusedCarried(key) }.getOrDefault(false)
        }
    }
    CompositionLocalProvider(LocalAndroidCarryOffer provides offer, LocalAndroidCarriedRefusals provides refusals) {
        content()
    }

    val language = LocalAndroidProductLanguage.current
    val current = step ?: return
    Mk8dxDialog(
        title = androidText("Carry to another community", "Meenemen naar een andere community"),
        closeLabel = androidText("Close", "Sluiten"),
        onDismiss = { if (current !is CarryStep.Checking) step = null },
        modifier = Modifier.testTag("carry-dialog"),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            when (current) {
                is CarryStep.Choose -> {
                    Text(
                        androidText(
                            "Choose the community this time should also count in. That community decides whether it takes times from elsewhere.",
                            "Kies de community waar deze tijd ook moet meetellen. Die community bepaalt zelf of ze tijden van elders aanneemt.",
                        ),
                        style = Mk8dxTheme.type.body,
                        color = Mk8dxTheme.colors.textBody,
                    )
                    targets.forEachIndexed { index, target ->
                        Mk8dxButton(
                            target.name,
                            {
                                step = CarryStep.Checking(target)
                                scope.launch {
                                    val outcome = withContext(Dispatchers.IO) {
                                        runCatching {
                                            carryAndroidResult(
                                                record = localOutbox.read(current.entryKey),
                                                sourceOrigin = activeOrigin,
                                                sourceName = source?.name?.takeIf { it != source.origin },
                                                targetOrigin = target.origin,
                                                readPolicy = {
                                                    AndroidCarriedTimesPolicy.of(
                                                        AndroidTournamentClient(
                                                            target.origin,
                                                            null,
                                                            AndroidTournamentConnectionOpener { url ->
                                                                AndroidOriginTrust.open(context, url)
                                                            },
                                                        ).installationSettings().carriedTimes,
                                                    )
                                                },
                                                queue = AndroidCarriedQueue.forOrigin(context, target.origin),
                                                targetSubmissions = {
                                                    createAndroidProductTimeTrialOutboxFor(context, target.origin)
                                                        .list().map { it.canonicalSubmission }
                                                },
                                                nowMs = System.currentTimeMillis(),
                                            )
                                        }.getOrDefault(AndroidCarryOutcome.NotCarriable)
                                    }
                                    step = outcomeStep(outcome, target.name, language)
                                }
                            },
                            variant = Mk8dxButtonVariant.Secondary,
                            tag = "carry-target-$index",
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                is CarryStep.Checking -> Mk8dxStatusMessage(
                    androidText("Asking ${current.target.name}…", "${current.target.name} wordt gevraagd…"),
                    tone = Mk8dxStatusTone.Info,
                )
                is CarryStep.Done -> Mk8dxStatusMessage(current.text, tone = current.tone, modifier = Modifier.testTag("carry-result"))
            }
        }
    }
}

internal fun androidCarryQueuedText(language: AndroidProductLanguage, name: String, review: Boolean): String =
    androidText(language, "It is sent when you switch to $name and are signed in there.",
        "Hij wordt verzonden zodra je naar $name wisselt en daar bent aangemeld.") +
        if (review) {
            " " + androidText(language, "An administrator of $name approves it first.",
                "Een beheerder van $name keurt hem eerst goed.")
        } else ""

private fun outcomeStep(
    outcome: AndroidCarryOutcome,
    name: String,
    language: AndroidProductLanguage,
): CarryStep {
    return when (outcome) {
        is AndroidCarryOutcome.Queued ->
            CarryStep.Done(androidCarryQueuedText(language, name, outcome.review), Mk8dxStatusTone.Success)
        AndroidCarryOutcome.Refused -> CarryStep.Done(
            androidText(language, "That community does not accept times from other communities.",
                "Die community neemt geen tijden van andere communities aan."),
            Mk8dxStatusTone.Warning,
        )
        AndroidCarryOutcome.Unreachable -> CarryStep.Done(
            androidText(language, "$name could not be reached. Nothing was carried; try again later.",
                "$name was niet bereikbaar. Er is niets meegenomen; probeer het later opnieuw."),
            Mk8dxStatusTone.Error,
        )
        AndroidCarryOutcome.AlreadyCarried -> CarryStep.Done(
            androidText(language, "This time is already on its way to $name.",
                "Deze tijd is al onderweg naar $name."),
            Mk8dxStatusTone.Info,
        )
        AndroidCarryOutcome.NotCarriable -> CarryStep.Done(
            androidText(language, "This result cannot be carried.", "Deze uitslag kan niet worden meegenomen."),
            Mk8dxStatusTone.Error,
        )
    }
}
