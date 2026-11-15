package nl.mariokart8.mk8dxtimetrials.tournament

// Step 5/9 · live capture delegations (security finding F05), the app's copy of
// the web panel (apps/timetrials-web/src/tournament-live-delegation-section.ts).
//
// A roster match never opens a public live feed by itself. A feed goes public
// when the night's Director (or an administrator) confirms it, or when it
// comes from an account the Director delegated live capture to for this night.
// The panel lists those delegations, issues one (12 hours by default, at most
// 7 days) and revokes one. The API decides every step again on the server.

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme
import java.text.DateFormat
import java.util.Date

/** How often the resumed Step 5/9 view re-reads the capture delegations (the web panel's period). */
internal const val ANDROID_LIVE_DELEGATION_REFRESH_MS = 30_000L

/** The durations the Director chooses from, in minutes: the web panel's list. */
internal val ANDROID_LIVE_DELEGATION_DURATIONS = listOf(
    120, 360, ANDROID_LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES, 1_440, 4_320, ANDROID_LIVE_CAPTURE_DELEGATION_MAX_MINUTES,
)

internal fun androidLiveDelegationDurationLabel(language: AndroidProductLanguage, minutes: Int): String = when (minutes) {
    120 -> androidText(language, "2 hours", "2 uur")
    360 -> androidText(language, "6 hours", "6 uur")
    ANDROID_LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES -> androidText(language, "12 hours (default)", "12 uur (standaard)")
    1_440 -> androidText(language, "24 hours", "24 uur")
    4_320 -> androidText(language, "3 days", "3 dagen")
    ANDROID_LIVE_CAPTURE_DELEGATION_MAX_MINUTES -> androidText(language, "7 days (maximum)", "7 dagen (maximaal)")
    else -> "$minutes min"
}

/** The delegation that lets this account's feed open the public view right now, if any. */
internal fun androidActiveLiveCaptureDelegation(
    delegations: List<AndroidLiveCaptureDelegation>?,
    userAccountId: String,
    nowMs: Long,
): AndroidLiveCaptureDelegation? =
    delegations?.firstOrNull { it.delegateUserAccountId == userAccountId && it.inForce(nowMs) }

/**
 * The accounts the Director can recognize: whoever connected Tournament Live to
 * this night. Accounts that already hold a delegation in force are left out.
 */
internal fun androidLiveDelegationCandidates(
    records: List<AndroidTournamentEvidenceRecord>,
    delegations: List<AndroidLiveCaptureDelegation>,
    nowMs: Long,
): List<AndroidTournamentEvidenceUploader> {
    val candidates = LinkedHashMap<String, AndroidTournamentEvidenceUploader>()
    for (record in records) {
        if (record.live == null) continue
        if (androidActiveLiveCaptureDelegation(delegations, record.uploadedBy.userAccountId, nowMs) != null) continue
        candidates[record.uploadedBy.userAccountId] = record.uploadedBy
    }
    return candidates.values.toList()
}

/** A feed on the public view can be withdrawn; one that never went public cannot. */
internal fun androidLiveFeedWithdrawable(record: AndroidTournamentEvidenceRecord): Boolean {
    val live = record.live ?: return false
    if (live.status !in setOf("active", "stopping", "complete")) return false
    return !(live.status == "stopping" && live.approvedAtMs == null)
}

internal fun androidDelegationMoment(ms: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms))

internal fun androidLiveDelegationState(
    language: AndroidProductLanguage,
    delegation: AndroidLiveCaptureDelegation,
    nowMs: Long,
    moment: (Long) -> String = ::androidDelegationMoment,
): String {
    if (delegation.status == "revoked") {
        val revokedAt = delegation.revokedAtMs ?: return androidText(language, "revoked", "ingetrokken")
        val at = moment(revokedAt)
        return androidText(language, "revoked $at", "ingetrokken $at")
    }
    val until = moment(delegation.expiresAtMs)
    return if (delegation.expiresAtMs <= nowMs) androidText(language, "expired $until", "verlopen $until")
    else androidText(language, "active until $until", "actief tot $until")
}

/**
 * The "requested" line of a waiting live feed: withdrawn by the Director (the
 * server then refuses every roster match, delegated or not, until the Director
 * reopens it), waiting for the Director, or already delegated.
 */
internal fun androidRequestedLiveFeedText(
    language: AndroidProductLanguage,
    uploaderDelegation: AndroidLiveCaptureDelegation?,
    moment: (Long) -> String = ::androidDelegationMoment,
    withdrawnAtMs: Long? = null,
): String {
    if (withdrawnAtMs != null) {
        val at = moment(withdrawnAtMs)
        // The web's wording (tournament-incoming-section.ts), so every catalog translates it.
        return androidText(
            language,
            "You withdrew this live feed on $at. It stays off the public view: no roster match or capture delegation opens it again. Confirm the live routing below to put it back.",
            "Je hebt deze live-feed op $at teruggetrokken. Hij blijft van de openbare weergave: geen rostermatch of capturedelegatie opent hem opnieuw. Bevestig hieronder de live-koppeling om hem terug te zetten.",
        )
    }
    if (uploaderDelegation == null) {
        return androidText(
            language,
            "Waiting for the Director. Nothing is public yet: a roster match alone never opens a live feed. Confirm the live routing below, or delegate live capture for this night to this account.",
            "Wacht op de toernooileider. Er is nog niets openbaar: een rostermatch alleen opent nooit een live-feed. Bevestig hieronder de live-koppeling, of delegeer de live-capture voor deze avond aan dit account.",
        )
    }
    val until = moment(uploaderDelegation.expiresAtMs)
    return androidText(
        language,
        "This account holds your capture delegation until $until. The next race whose names match the group list opens the public view; you can also confirm it now.",
        "Dit account heeft jouw capturedelegatie tot $until. De volgende race waarvan de namen bij de groepslijst passen, opent de openbare weergave; je kunt hem ook nu bevestigen.",
    )
}

/** The per-feed delegation shortcut and the two-tap withdrawal, under one recording. */
@Composable
internal fun LiveFeedDelegationActions(
    tournamentId: String,
    record: AndroidTournamentEvidenceRecord,
    delegations: List<AndroidLiveCaptureDelegation>?,
    nowMs: Long,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val scope = rememberCoroutineScope()
    var acting by remember(record.recordId, record.revision) { mutableStateOf(false) }
    var withdrawArmed by remember(record.recordId, record.revision) { mutableStateOf(false) }
    var status by remember(record.recordId, record.revision) { mutableStateOf<String?>(null) }
    var failed by remember(record.recordId, record.revision) { mutableStateOf(false) }
    val uploaderDelegation = androidActiveLiveCaptureDelegation(delegations, record.uploadedBy.userAccountId, nowMs)
    // A withdrawn feed stays private whatever the delegation says, so the shortcut would not open it.
    if (record.live?.status == "requested" && record.live.withdrawnAtMs == null && delegations != null &&
        uploaderDelegation == null
    ) {
        OutlinedButton(
            enabled = !busy && !acting,
            onClick = {
                acting = true; failed = false
                status = androidText(language, "Saving the capture delegation…", "Capturedelegatie wordt opgeslagen…")
                scope.launch {
                    runCatching { withContext(Dispatchers.IO) {
                        client.grantLiveCaptureDelegation(tournamentId, record.uploadedBy.userAccountId)
                    } }.onSuccess { status = null; onChanged() }.onFailure {
                        failed = true
                        status = androidText(language, "The capture delegation could not be saved.", "De capturedelegatie kon niet worden opgeslagen.")
                    }
                    acting = false
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("tournament-live-delegate-${record.recordId}"),
        ) {
            val name = record.uploadedBy.displayName
            Text(androidText(language, "Delegate live capture to $name (12 hours)", "Live-capture delegeren aan $name (12 uur)"))
        }
    }
    if (androidLiveFeedWithdrawable(record)) {
        OutlinedButton(
            enabled = !busy && !acting,
            onClick = {
                if (!withdrawArmed) {
                    withdrawArmed = true; failed = false
                    status = androidText(
                        language,
                        "Withdrawing takes this feed off the public view at once. Its races stay here for review, and only you can open it again; a roster match cannot.",
                        "Terugtrekken haalt deze feed direct van de openbare weergave. De races blijven hier voor controle en alleen jij kunt hem weer openen; een rostermatch niet.",
                    )
                    return@OutlinedButton
                }
                acting = true
                status = androidText(language, "Withdrawing the live feed…", "Live-feed wordt teruggetrokken…")
                scope.launch {
                    runCatching { withContext(Dispatchers.IO) { client.withdrawLiveAssociation(tournamentId, record) } }
                        .onSuccess { status = null; onChanged() }
                        .onFailure {
                            failed = true
                            status = androidText(language, "The live feed could not be withdrawn.", "De live-feed kon niet worden teruggetrokken.")
                        }
                    withdrawArmed = false
                    acting = false
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("tournament-live-withdraw-${record.recordId}"),
        ) {
            Text(
                if (withdrawArmed) androidText(language, "Tap again to withdraw", "Tik nogmaals om terug te trekken")
                else androidText(language, "Withdraw this live feed", "Deze live-feed terugtrekken"),
            )
        }
    }
    status?.let {
        Text(
            it,
            color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/**
 * The night's capture delegations: the list with each one's state, a revoke
 * for those in force, and a form that delegates to an account whose
 * Tournament Live connected to this night. [delegations] is null when the
 * list could not be read; the panel then says so and offers no writes.
 */
@Composable
internal fun LiveCaptureDelegationsPanel(
    tournamentId: String,
    records: List<AndroidTournamentEvidenceRecord>,
    delegations: List<AndroidLiveCaptureDelegation>?,
    nowMs: Long,
    busy: Boolean,
    client: AndroidTournamentClient,
    onChanged: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    val scope = rememberCoroutineScope()
    var acting by remember(tournamentId) { mutableStateOf(false) }
    var status by remember(tournamentId) { mutableStateOf<String?>(null) }
    var failed by remember(tournamentId) { mutableStateOf(false) }
    var chosenAccount by remember(tournamentId) { mutableStateOf<String?>(null) }
    var minutes by remember(tournamentId) { mutableStateOf(ANDROID_LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES) }
    fun write(saving: String, failure: String, work: () -> Unit) {
        acting = true; failed = false; status = saving
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { work() } }
                .onSuccess { status = null; chosenAccount = null; onChanged() }
                .onFailure { failed = true; status = failure }
            acting = false
        }
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(15.dp),
        modifier = Modifier.fillMaxWidth().testTag("tournament-live-delegations"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(androidText(language, "Live capture delegations", "Live-capturedelegaties"), fontWeight = FontWeight.Black)
            Text(
                androidText(
                    language,
                    "A roster match alone never opens a public live feed. A feed goes public when you confirm it, or when it comes from an account you delegated live capture to for this night. A delegation lasts 12 hours unless you choose otherwise (at most 7 days); revoking it takes that account's feeds off the public view at once.",
                    "Een rostermatch alleen opent nooit een openbare live-feed. Een feed wordt openbaar als jij hem bevestigt, of als hij komt van een account waaraan jij de live-capture voor deze avond hebt gedelegeerd. Een delegatie geldt 12 uur, tenzij je iets anders kiest (maximaal 7 dagen); intrekken haalt de feeds van dat account direct van de openbare weergave.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            if (delegations == null) {
                Text(
                    androidText(
                        language,
                        "Capture delegations could not be loaded. Live feeds still wait for your confirmation.",
                        "Capturedelegaties konden niet worden geladen. Live-feeds wachten nog steeds op jouw bevestiging.",
                    ),
                    color = Mk8dxDesignTheme.colors.statusWarning,
                )
                return@Column
            }
            if (delegations.isEmpty()) {
                Text(androidText(language, "No capture delegations for this night.", "Geen capturedelegaties voor deze avond."))
            }
            delegations.forEach { delegation ->
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "${delegation.delegateDisplayName} · ${androidLiveDelegationState(language, delegation, nowMs)}",
                        modifier = Modifier.weight(1f),
                    )
                    if (delegation.inForce(nowMs)) {
                        val name = delegation.delegateDisplayName
                        val description = androidText(
                            language, "Revoke the capture delegation of $name", "Capturedelegatie van $name intrekken",
                        )
                        OutlinedButton(
                            enabled = !busy && !acting,
                            onClick = {
                                write(
                                    androidText(language, "Revoking the capture delegation…", "Capturedelegatie wordt ingetrokken…"),
                                    androidText(language, "The capture delegation could not be revoked.", "De capturedelegatie kon niet worden ingetrokken."),
                                ) { client.revokeLiveCaptureDelegation(tournamentId, delegation.delegationId) }
                            },
                            modifier = Modifier.semantics { contentDescription = description }
                                .testTag("tournament-live-revoke-${delegation.delegationId}"),
                        ) { Text(androidText(language, "Revoke", "Intrekken")) }
                    }
                }
            }
            val candidates = androidLiveDelegationCandidates(records, delegations, nowMs)
            val chosen = candidates.firstOrNull { it.userAccountId == chosenAccount }
            var accountsOpen by remember(tournamentId) { mutableStateOf(false) }
            var durationsOpen by remember(tournamentId) { mutableStateOf(false) }
            Text(androidText(language, "Account", "Account"), style = MaterialTheme.typography.labelMedium)
            Box {
                OutlinedButton(
                    enabled = !busy && !acting && candidates.isNotEmpty(),
                    onClick = { accountsOpen = true },
                    modifier = Modifier.fillMaxWidth().testTag("tournament-live-delegation-account"),
                ) { Text(chosen?.displayName ?: androidText(language, "Choose an account", "Kies een account")) }
                DropdownMenu(expanded = accountsOpen, onDismissRequest = { accountsOpen = false }) {
                    candidates.forEach { candidate ->
                        DropdownMenuItem(
                            text = { Text(candidate.displayName) },
                            onClick = { chosenAccount = candidate.userAccountId; accountsOpen = false },
                        )
                    }
                }
            }
            Text(androidText(language, "Valid for", "Geldig voor"), style = MaterialTheme.typography.labelMedium)
            Box {
                OutlinedButton(
                    enabled = !busy && !acting && candidates.isNotEmpty(),
                    onClick = { durationsOpen = true },
                    modifier = Modifier.fillMaxWidth().testTag("tournament-live-delegation-duration"),
                ) { Text(androidLiveDelegationDurationLabel(language, minutes)) }
                DropdownMenu(expanded = durationsOpen, onDismissRequest = { durationsOpen = false }) {
                    ANDROID_LIVE_DELEGATION_DURATIONS.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(androidLiveDelegationDurationLabel(language, option)) },
                            onClick = { minutes = option; durationsOpen = false },
                        )
                    }
                }
            }
            Button(
                enabled = !busy && !acting && candidates.isNotEmpty(),
                onClick = {
                    val account = chosen
                    if (account == null) {
                        failed = true
                        status = androidText(language, "Choose an account to delegate live capture to.", "Kies een account om de live-capture aan te delegeren.")
                        return@Button
                    }
                    val chosenMinutes = minutes
                    write(
                        androidText(language, "Saving the capture delegation…", "Capturedelegatie wordt opgeslagen…"),
                        androidText(language, "The capture delegation could not be saved.", "De capturedelegatie kon niet worden opgeslagen."),
                    ) { client.grantLiveCaptureDelegation(tournamentId, account.userAccountId, chosenMinutes) }
                },
                modifier = Modifier.fillMaxWidth().testTag("tournament-live-delegation-grant"),
            ) { Text(androidText(language, "Delegate live capture", "Live-capture delegeren")) }
            Text(
                if (candidates.isEmpty()) androidText(
                    language,
                    "An account appears here once its Tournament Live has connected to this night and pressed Start. Its feed then waits for you.",
                    "Een account verschijnt hier zodra zijn Tournament Live met deze avond is verbonden en op START heeft gedrukt. De feed wacht dan op jou.",
                ) else androidText(
                    language,
                    "Only accounts whose Tournament Live connected to this night are offered. The delegation is for this night only.",
                    "Alleen accounts waarvan Tournament Live met deze avond is verbonden, worden aangeboden. De delegatie geldt alleen voor deze avond.",
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            status?.let {
                Text(it, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
