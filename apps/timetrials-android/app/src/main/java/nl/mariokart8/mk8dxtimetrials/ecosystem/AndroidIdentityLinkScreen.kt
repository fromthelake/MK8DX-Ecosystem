package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.offline.androidNoConnectionText
import nl.mariokart8.mk8dxtimetrials.offline.isConnectionFailure
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxOptionRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSearchField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * Accounts and Players, on the phone (part of A13, MINIMAL).
 *
 * Everyone who played before this ecosystem existed already has a Player here.
 * When they sign in for the first time they arrive as an account attached to
 * nothing, and somebody has to say which Player is them. Each Player is offered
 * with the history that identifies them, so the choice is an informed one
 * rather than a guess at a name.
 *
 * Linking and unlinking call exactly the same endpoints as before; what changed
 * is that the picker is a searchable dialog instead of a dropdown, and that
 * unlinking — which takes somebody's history away from their account — now asks
 * first. Nothing here became easier to trigger than it was.
 */
@Composable
internal fun AndroidIdentityLinkScreen(client: AndroidIdentityLinkClient) {
    val scope = rememberCoroutineScope()
    var overview by remember { mutableStateOf<AndroidIdentityLinkOverview?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var forbidden by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    val language = LocalAndroidProductLanguage.current

    LaunchedEffect(client, reload) {
        message = null
        runCatching { withContext(Dispatchers.IO) { client.overview() } }
            .onSuccess { overview = it }
            .onFailure { failure ->
                if (failure is AndroidIdentityLinkException && failure.forbidden) {
                    forbidden = true
                } else {
                    message = if (failure.isConnectionFailure()) {
                        androidNoConnectionText(language, client.originText, showingCopy = false)
                    } else {
                        failure.message ?: "Accounts and Players are unavailable."
                    }
                }
            }
    }

    // Not an administrator: the screen is simply not offered rather than shown
    // as something that would only refuse.
    if (forbidden) return

    val act: (suspend () -> Unit, String) -> Unit = { work, done ->
        busy = true
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { work() } }
                .onSuccess { message = done; reload += 1 }
                .onFailure {
                    message = if (it.isConnectionFailure()) androidNoConnectionText(language, client.originText, showingCopy = false)
                    else it.message ?: "That did not work."
                }
            busy = false
        }
    }

    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val current = overview
    Column(
        Modifier.fillMaxWidth().testTag("identity-link-section"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
    ) {
        Mk8dxSectionLabel(androidText("ACCOUNTS AND PLAYERS", "ACCOUNTS EN SPELERS"))
        Text(
            androidText(
                "Who can sign in, and whose history they see.",
                "Wie zich kan aanmelden, en wiens geschiedenis diegene ziet.",
            ),
            style = type.bodyS,
            color = colors.textSecondary,
        )
        message?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Info) }
        if (current == null) {
            Text(
                androidText("Loading accounts…", "Accounts laden…"),
                style = type.bodyS,
                color = colors.textSecondary,
            )
            return@Column
        }
        val unlinked = current.accounts.filter { it.linkedPlayerId == null }
        Text(
            androidText(
                "${current.accounts.size} account(s), ${unlinked.size} not yet linked.",
                "${current.accounts.size} account(s), ${unlinked.size} nog niet gekoppeld.",
            ),
            style = type.bodyS,
            color = colors.textSecondary,
        )
        // A plain Column, not a LazyColumn: this section sits inside the
        // Profile and Administration lists, and a lazy list inside a
        // scrolling parent is measured with an unbounded height and crashes.
        // The list is bounded (500 accounts at most) and usually a dozen.
        Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
            // The ones needing a decision first: there is no reason to scroll
            // past the settled ones to find the work.
            (unlinked + current.accounts.filter { it.linkedPlayerId != null }).forEach { account ->
                AndroidIdentityLinkRow(
                    account = account,
                    players = current.players,
                    searchCandidates = { query, timeTrials, tournaments ->
                        withContext(Dispatchers.IO) { client.claimCandidates(query, timeTrials, tournaments) }
                    },
                    busy = busy,
                    onLink = { playerId ->
                        act({ client.link(account.userAccountId, playerId) }, "Linked.")
                    },
                    onUnlink = {
                        act({ client.unlink(account.userAccountId) }, "Unlinked.")
                    },
                )
            }
        }
    }
}

private fun history(player: AndroidIdentityLinkPlayer): String {
    val parts = buildList {
        if (player.timeTrials > 0) add("${player.timeTrials} Time Trials")
        if (player.tournamentRaces > 0) add("${player.tournamentRaces} Tournament races")
    }
    return if (parts.isEmpty()) "no recorded history" else parts.joinToString(" · ")
}

@Composable
private fun AndroidIdentityLinkRow(
    account: AndroidIdentityLinkAccount,
    players: List<AndroidIdentityLinkPlayer>,
    searchCandidates: suspend (String, Boolean, Boolean) -> List<AndroidClaimCandidate>,
    busy: Boolean,
    onLink: (String) -> Unit,
    onUnlink: () -> Unit,
) {
    var picking by remember { mutableStateOf(false) }
    var confirmingUnlink by remember { mutableStateOf(false) }
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Mk8dxPanel(null) {
        Text(
            account.email ?: account.screenName ?: account.userAccountId,
            style = type.title,
            color = colors.textPrimary,
        )
        if (account.linkedPlayerId != null) {
            val player = players.firstOrNull { it.playerId == account.linkedPlayerId }
            Mk8dxChip(androidText("Linked", "Gekoppeld"), tone = Mk8dxChipTone.Success)
            Text(
                if (player == null) {
                    "linked to ${account.linkedPlayerName ?: account.linkedPlayerId}"
                } else {
                    "linked to ${player.displayName} — ${history(player)}"
                },
                style = type.bodyS,
                color = colors.textSecondary,
            )
            Mk8dxButton(
                androidText("Unlink", "Ontkoppelen"),
                { confirmingUnlink = true },
                variant = Mk8dxButtonVariant.Danger,
                disabledReason = if (busy) androidText("Working…", "Bezig…") else null,
                disabledReasonShown = false,
                tag = "identity-unlink-${account.userAccountId}",
                modifier = Modifier.fillMaxWidth(),
            )
            if (confirmingUnlink) {
                Mk8dxDialog(
                    androidText("Unlink this account?", "Dit account ontkoppelen?"),
                    androidText("Cancel", "Annuleren"),
                    { confirmingUnlink = false },
                ) {
                    Text(
                        androidText(
                            "The account keeps signing in, but stops seeing this Player's history " +
                                "until it is linked again. No result is deleted.",
                            "Het account kan zich blijven aanmelden, maar ziet de geschiedenis van deze " +
                                "speler niet meer tot het opnieuw gekoppeld is. Er wordt niets verwijderd.",
                        ),
                        style = type.body,
                        color = colors.textBody,
                    )
                    Mk8dxButton(
                        androidText("Unlink", "Ontkoppelen"),
                        {
                            confirmingUnlink = false
                            onUnlink()
                        },
                        variant = Mk8dxButtonVariant.Danger,
                        tag = "identity-unlink-confirm-${account.userAccountId}",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            return@Mk8dxPanel
        }
        if (account.userAccountId.isEmpty()) {
            Mk8dxChip(androidText("No account yet", "Nog geen account"), tone = Mk8dxChipTone.Warning)
            Text(
                androidText(
                    "has signed in but has no account here yet",
                    "heeft zich aangemeld maar heeft hier nog geen account",
                ),
                style = type.bodyS,
                color = colors.textSecondary,
            )
            return@Mk8dxPanel
        }
        Mk8dxChip(androidText("Not linked", "Niet gekoppeld"), tone = Mk8dxChipTone.Warning)
        Mk8dxButton(
            androidText("Choose a Player…", "Kies een speler…"),
            { picking = true },
            variant = Mk8dxButtonVariant.Secondary,
            disabledReason = if (busy) androidText("Working…", "Bezig…") else null,
            disabledReasonShown = false,
            tag = "identity-choose-${account.userAccountId}",
            modifier = Modifier.fillMaxWidth(),
        )
        if (picking) {
            AndroidIdentityLinkPicker(
                players.filter { it.linkedAccountId == null },
                searchCandidates = searchCandidates,
                onDismiss = { picking = false },
                onChoose = { playerId ->
                    picking = false
                    onLink(playerId)
                },
            )
        }
    }
}

/**
 * The Player picker: a searchable list instead of a dropdown, because an
 * administrator choosing between a hundred Players was scrolling a menu with
 * no way to narrow it. Each row still carries the history that identifies the
 * Player, which is what makes the choice an informed one.
 *
 * ADR-0219: the same two questions the website asks at sign-up (Time Trial
 * times on this site? a tournament listed here?) sort a typed name's
 * candidates, each with its public context: published Time Trials (count,
 * last date, classes) and nights (count, Directors, last night). Without a
 * typed name, or when the server cannot answer, the local list stays.
 */
@Composable
private fun AndroidIdentityLinkPicker(
    players: List<AndroidIdentityLinkPlayer>,
    searchCandidates: suspend (String, Boolean, Boolean) -> List<AndroidClaimCandidate>,
    onDismiss: () -> Unit,
    onChoose: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var timeTrials by remember { mutableStateOf(false) }
    var tournaments by remember { mutableStateOf(false) }
    var candidates by remember { mutableStateOf<List<AndroidClaimCandidate>?>(null) }
    val language = LocalAndroidProductLanguage.current
    val trimmed = query.trim()
    LaunchedEffect(trimmed, timeTrials, tournaments) {
        candidates = null
        if (trimmed.length < 2) return@LaunchedEffect
        delay(250)
        candidates = runCatching { searchCandidates(trimmed, timeTrials, tournaments) }.getOrNull()
    }
    val matching = players.filter { it.displayName.contains(trimmed, ignoreCase = true) }
    Mk8dxDialog(
        androidText("Choose a Player", "Kies een speler"),
        androidText("Cancel", "Annuleren"),
        onDismiss,
        modifier = Modifier.testTag("identity-player-picker"),
    ) {
        AndroidIdentityLinkQuestion(
            androidText(
                "Are this person's Time Trial times already on this website?",
                "Staan de Time Trial-tijden van deze persoon al op deze website?",
            ),
            timeTrials,
            "identity-question-time-trials",
        ) { timeTrials = it }
        AndroidIdentityLinkQuestion(
            androidText(
                "Has this person taken part in a tournament listed on this site?",
                "Heeft deze persoon meegedaan aan een toernooi dat op deze site staat?",
            ),
            tournaments,
            "identity-question-tournaments",
        ) { tournaments = it }
        Mk8dxSearchField(
            androidText("Search Players", "Spelers zoeken"),
            query,
            { query = it },
        )
        Column(
            Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
        ) {
            val found = candidates
            if (trimmed.length >= 2 && found != null) {
                androidClaimCandidateGroups(found, timeTrials, tournaments).forEach { (fits, group) ->
                    when (fits) {
                        true -> Mk8dxSectionLabel(androidText("MATCHES THE ANSWERS", "PAST BIJ DE ANTWOORDEN"))
                        false -> Mk8dxSectionLabel(androidText("OTHER PLAYERS WITH THIS NAME", "ANDERE SPELERS MET DEZE NAAM"))
                        null -> Unit
                    }
                    group.forEach { candidate ->
                        val lines = buildList {
                            add("${candidate.displayName} (@${candidate.username})")
                            add(androidClaimCandidateTimeTrialLine(candidate.timeTrials, language))
                            add(androidClaimCandidateTournamentLine(candidate.tournaments, language))
                            if (candidate.claimed) {
                                add(androidText("Already linked to an account", "Al aan een account gekoppeld"))
                            }
                        }
                        Mk8dxOptionRow(
                            lines.joinToString("\n"),
                            selected = false,
                            onClick = { if (!candidate.claimed) onChoose(candidate.playerId) },
                            modifier = Modifier.testTag("identity-candidate-${candidate.playerId}"),
                        )
                    }
                }
                if (found.isEmpty()) {
                    Text(
                        androidText("No Player matches that.", "Geen speler komt daarmee overeen."),
                        style = Mk8dxTheme.type.bodyS,
                        color = Mk8dxTheme.colors.textSecondary,
                    )
                }
                return@Column
            }
            matching.forEach { player ->
                Mk8dxOptionRow(
                    "${player.displayName} — ${history(player)}",
                    selected = false,
                    onClick = { onChoose(player.playerId) },
                    modifier = Modifier.testTag("identity-player-${player.playerId}"),
                )
            }
            if (matching.isEmpty()) {
                Text(
                    androidText("No Player matches that.", "Geen speler komt daarmee overeen."),
                    style = Mk8dxTheme.type.bodyS,
                    color = Mk8dxTheme.colors.textSecondary,
                )
            }
        }
    }
}

/** One yes/no question of ADR-0219. */
@Composable
private fun AndroidIdentityLinkQuestion(
    question: String,
    answer: Boolean,
    tag: String,
    onAnswer: (Boolean) -> Unit,
) {
    Text(question, style = Mk8dxTheme.type.bodyS, color = Mk8dxTheme.colors.textBody)
    Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Mk8dxButton(
            androidText("Yes", "Ja"),
            { onAnswer(true) },
            variant = if (answer) Mk8dxButtonVariant.Primary else Mk8dxButtonVariant.Secondary,
            tag = "$tag-yes",
            modifier = Modifier.weight(1f),
        )
        Mk8dxButton(
            androidText("No", "Nee"),
            { onAnswer(false) },
            variant = if (answer) Mk8dxButtonVariant.Secondary else Mk8dxButtonVariant.Primary,
            tag = "$tag-no",
            modifier = Modifier.weight(1f),
        )
    }
}
