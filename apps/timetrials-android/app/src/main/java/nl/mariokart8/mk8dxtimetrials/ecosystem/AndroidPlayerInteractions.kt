package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalizedText as Text
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChip
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxChipTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDialog
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/*
 * "You and <Player>" (owner 2026-09-26), the same panel as the Web profile: what the viewer can
 * send one Player now, what is waiting for whom, and everything between them. Pokes and challenges
 * are once an hour; games wait for their answer; every closed action says why.
 */

private val androidHands = listOf(
    Triple("rock", "🪨", "Rock" to "Steen"),
    Triple("paper", "📄", "Paper" to "Papier"),
    Triple("scissors", "✂️", "Scissors" to "Schaar"),
)

private fun handIcon(hand: String?): String = androidHands.firstOrNull { it.first == hand }?.second ?: "?"

/** A game still waiting for its recipient. A roll from before duels existed never waits. */
internal fun androidIsOpenGame(entry: AndroidPlayerEngagement): Boolean {
    val detail = entry.detail
    if (detail?.respondedAtMs != null || detail?.recipientHand != null) return false
    return entry.kind == "rock_paper_scissors" || (entry.kind == "dice_roll" && detail?.duel == true)
}

internal data class AndroidHeadToHead(val wins: Int, val losses: Int, val draws: Int) {
    val played: Int get() = wins + losses + draws
}

/** Wins, losses and draws between the two, from the viewer's side. */
internal fun androidHeadToHead(entries: List<AndroidPlayerEngagement>, viewerPlayerId: String, kind: String): AndroidHeadToHead {
    var wins = 0; var losses = 0; var draws = 0
    entries.filter { it.kind == kind }.forEach { entry ->
        when (val outcome = entry.detail?.outcome) {
            null -> Unit
            "draw" -> draws += 1
            else -> if ((outcome == "actor") == (entry.actorPlayerId == viewerPlayerId)) wins += 1 else losses += 1
        }
    }
    return AndroidHeadToHead(wins, losses, draws)
}

internal data class AndroidInteractionLine(
    val icon: String,
    val text: String,
    val status: String? = null,
    val tone: Mk8dxChipTone = Mk8dxChipTone.Neutral,
)

private fun challengeTarget(entry: AndroidPlayerEngagement): String {
    val detail = entry.detail
    val track = detail?.trackId?.let { Schema9AndroidTrackCatalog.find(it)?.displayName ?: it } ?: ""
    return "$track · ${detail?.mode ?: "?"}cc · ${detail?.totalTimeMs?.let(Mk8dxNumeric::formatTime) ?: ""}"
}

/**
 * One history entry in words, from the viewer's side. Every line has the same shape (owner
 * 2026-09-26): who did what, then a status label - Waiting, Your turn, the winner, Sent or Received.
 * The twin of the Web's `describeEngagement`.
 */
internal fun androidDescribeEngagement(
    entry: AndroidPlayerEngagement,
    viewerPlayerId: String,
    otherName: String,
    language: AndroidProductLanguage,
): AndroidInteractionLine {
    val mine = entry.actorPlayerId == viewerPlayerId
    val detail = entry.detail
    val sent = androidText(language, "Sent", "Verstuurd")
    val received = androidText(language, "Received", "Ontvangen")
    val waiting = androidText(language, "Waiting", "Wacht")
    val yourTurn = androidText(language, "Your turn", "Jouw beurt")
    fun outcomeLine(icon: String, text: String): AndroidInteractionLine {
        val outcome = detail?.outcome
        return when {
            outcome == "draw" -> AndroidInteractionLine(icon, text, androidText(language, "Draw", "Gelijk"))
            (outcome == "actor") == mine -> AndroidInteractionLine(icon, text,
                androidText(language, "You won", "Jij won"), Mk8dxChipTone.Success)
            else -> AndroidInteractionLine(icon, text,
                androidText(language, "$otherName won", "$otherName won"), Mk8dxChipTone.Error)
        }
    }
    return when (entry.kind) {
        "poke" -> if (mine) AndroidInteractionLine("👋", androidText(language, "You poked $otherName", "Jij gaf $otherName een por"), sent)
            else AndroidInteractionLine("👋", androidText(language, "$otherName poked you", "$otherName gaf jou een por"), received, Mk8dxChipTone.Info)
        "dice_roll" -> {
            val face = detail?.face?.toString() ?: "?"
            val answer = detail?.recipientFace
            when {
                answer != null && detail.outcome != null -> {
                    val viewerFace = if (mine) face else answer.toString()
                    val otherFace = if (mine) answer.toString() else face
                    outcomeLine("🎲", androidText(language, "You rolled $viewerFace · $otherName rolled $otherFace",
                        "Jij gooide $viewerFace · $otherName gooide $otherFace"))
                }
                detail?.duel == true && mine -> AndroidInteractionLine("🎲",
                    androidText(language, "You rolled $face · $otherName still has to roll back", "Jij gooide $face · $otherName moet nog terug gooien"),
                    waiting)
                detail?.duel == true -> AndroidInteractionLine("🎲",
                    androidText(language, "$otherName rolled $face · roll back to beat it", "$otherName gooide $face · gooi terug om te winnen"),
                    yourTurn, Mk8dxChipTone.Warning)
                // A roll from before duels (before 2026-09-26) was one-way: nobody could answer it.
                else -> AndroidInteractionLine("🎲",
                    if (mine) androidText(language, "You rolled $face · one-way roll from before duels", "Jij gooide $face · losse worp van vóór de duels")
                    else androidText(language, "$otherName rolled $face · one-way roll from before duels", "$otherName gooide $face · losse worp van vóór de duels"),
                    androidText(language, "Old roll", "Oude worp"))
            }
        }
        "rock_paper_scissors" -> when {
            detail?.recipientHand != null && detail.outcome != null -> {
                val viewerHand = if (mine) detail.hand else detail.recipientHand
                val otherHand = if (mine) detail.recipientHand else detail.hand
                outcomeLine("✊", androidText(language, "You threw ${handIcon(viewerHand)} · $otherName threw ${handIcon(otherHand)}",
                    "Jij koos ${handIcon(viewerHand)} · $otherName koos ${handIcon(otherHand)}"))
            }
            mine -> AndroidInteractionLine("✊",
                androidText(language, "You threw ${handIcon(detail?.hand)} · $otherName still has to answer",
                    "Jij koos ${handIcon(detail?.hand)} · $otherName moet nog antwoorden"), waiting)
            else -> AndroidInteractionLine("✊",
                androidText(language, "$otherName threw a hidden hand · pick yours", "$otherName koos een verborgen zet · kies de jouwe"),
                yourTurn, Mk8dxChipTone.Warning)
        }
        else -> if (mine) AndroidInteractionLine("🏁",
            androidText(language, "You challenged $otherName to beat ${challengeTarget(entry)}",
                "Jij daagde $otherName uit om ${challengeTarget(entry)} te verbeteren"), sent)
            else AndroidInteractionLine("🏁",
                androidText(language, "$otherName challenged you to beat ${challengeTarget(entry)}",
                    "$otherName daagde jou uit om ${challengeTarget(entry)} te verbeteren"), received, Mk8dxChipTone.Info)
    }
}

/**
 * What the viewer last sent of this kind and where it stands, on the action's own card (owner
 * 2026-09-26): the die that is waiting, the hand that was thrown, the time that was sent.
 */
internal fun androidCurrentStateNote(
    kind: String,
    conversation: AndroidEngagementConversation,
    viewerPlayerId: String,
    otherName: String,
    language: AndroidProductLanguage,
    nowMs: Long,
): String? {
    val allowance = conversation.actions[kind] ?: return null
    val mineOfKind = conversation.engagements.filter { it.kind == kind && it.actorPlayerId == viewerPlayerId }
    fun whenText(entry: AndroidPlayerEngagement) = androidRelativeTime(entry.createdAtMs, nowMs, language)
    val next = allowance.availableAtMs?.let { androidText(language, " · next one at ${clockTime(it)}", " · volgende om ${clockTime(it)}") } ?: ""
    return when (allowance.reason) {
        "awaiting_answer" -> {
            val open = mineOfKind.filter(::androidIsOpenGame)
            val latest = open.firstOrNull() ?: return null
            val more = if (open.size > 1) androidText(language, " (${open.size} games open)", " (${open.size} spellen open)") else ""
            if (kind == "dice_roll") androidText(language,
                "You rolled ${latest.detail?.face ?: "?"} ${whenText(latest)} — waiting for $otherName to roll back$more.",
                "Jij gooide ${latest.detail?.face ?: "?"} ${whenText(latest)} — wacht tot $otherName terug gooit$more.")
            else androidText(language,
                "You threw ${handIcon(latest.detail?.hand)} ${whenText(latest)} — waiting for $otherName's hand$more.",
                "Jij koos ${handIcon(latest.detail?.hand)} ${whenText(latest)} — wacht op de zet van $otherName$more.")
        }
        "cooldown" -> {
            val latest = mineOfKind.firstOrNull() ?: return null
            if (kind == "challenge") androidText(language, "You sent ${challengeTarget(latest)} ${whenText(latest)}$next.",
                "Jij stuurde ${challengeTarget(latest)} ${whenText(latest)}$next.")
            else androidText(language, "You poked $otherName ${whenText(latest)}$next.", "Jij gaf $otherName ${whenText(latest)} een por$next.")
        }
        else -> null
    }
}

private fun clockTime(atMs: Long): String = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(atMs))

/** Why an action is closed, in the words shown under its buttons. */
internal fun androidAllowanceNote(
    allowance: AndroidEngagementAllowance?,
    otherName: String,
    kind: String,
    language: AndroidProductLanguage,
): String? {
    if (allowance == null || allowance.available) return null
    return when (allowance.reason) {
        "cooldown" -> allowance.availableAtMs?.let {
            androidText(language, "Next one at ${clockTime(it)}.", "Volgende om ${clockTime(it)}.")
        } ?: androidText(language, "Once an hour per Player.", "Eén keer per uur per speler.")
        "awaiting_answer" -> if (kind == "dice_roll") androidText(language, "Waiting for $otherName to roll back.", "Wacht tot $otherName terug gooit.")
            else androidText(language, "Waiting for $otherName's hand.", "Wacht op de zet van $otherName.")
        "no_account" -> androidText(language, "$otherName has no account yet, so they would not be notified.",
            "$otherName heeft nog geen account en zou geen melding krijgen.")
        "recipient_limit" -> androidText(language, "$otherName has had the most interactions allowed today.",
            "$otherName heeft vandaag het maximum aantal interacties gehad.")
        else -> androidText(language, "$otherName does not accept this from you.", "$otherName ontvangt dit niet van jou.")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AndroidPlayerInteractionsPanel(
    client: AndroidTimeTrialsEcosystemDataSource,
    viewerPlayerId: String,
    playerId: String,
    displayName: String,
    modifier: Modifier = Modifier,
) {
    val language = LocalAndroidProductLanguage.current
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    val scope = rememberCoroutineScope()
    var refresh by remember(playerId) { mutableIntStateOf(0) }
    var conversation by remember(playerId) { mutableStateOf<AndroidEngagementConversation?>(null) }
    var bests by remember(playerId) { mutableStateOf<List<AndroidTrackBest>>(emptyList()) }
    var failed by remember(playerId) { mutableStateOf(false) }
    var busy by remember(playerId) { mutableStateOf(false) }
    var status by remember(playerId) { mutableStateOf("") }
    var chooseTrack by remember(playerId) { mutableStateOf(false) }
    LaunchedEffect(client, playerId, refresh) {
        withContext(Dispatchers.IO) {
            val loaded = runCatching { client.engagementConversation(playerId) }
            conversation = loaded.getOrNull() ?: conversation
            failed = loaded.isFailure
            if (bests.isEmpty()) bests = runCatching { client.trackBestsFor(viewerPlayerId) }.getOrDefault(emptyList())
        }
    }
    val notified = androidText(language, "$displayName gets a notification.", "$displayName krijgt een melding.")
    fun act(work: suspend () -> String) {
        if (busy) return
        busy = true
        status = androidText(language, "Sending…", "Versturen…")
        scope.launch {
            status = runCatching { withContext(Dispatchers.IO) { work() } }.getOrElse { error ->
                error.message?.takeIf { it.isNotBlank() } ?: androidText(language, "Try again later.", "Probeer het later opnieuw.")
            }
            busy = false
            refresh += 1
        }
    }
    Mk8dxPanel(
        androidText(language, "YOU AND ${displayName.uppercase()}", "JIJ EN ${displayName.uppercase()}"),
        modifier.fillMaxWidth().testTag("player-interactions"),
    ) {
        val current = conversation
        if (current == null) {
            Text(if (failed) androidText(language, "Interactions could not be loaded.", "Interacties konden niet worden geladen.")
                else androidText(language, "Loading…", "Laden…"), style = type.bodyS, color = colors.textSecondary)
            return@Mk8dxPanel
        }
        val rps = androidHeadToHead(current.engagements, viewerPlayerId, "rock_paper_scissors")
        val dice = androidHeadToHead(current.engagements, viewerPlayerId, "dice_roll")
        val record = listOfNotNull(
            if (rps.played == 0) null else androidText(language, "Rock-paper-scissors ${rps.wins}–${rps.losses}", "Steen-papier-schaar ${rps.wins}–${rps.losses}"),
            if (dice.played == 0) null else androidText(language, "Dice duels ${dice.wins}–${dice.losses}", "Dobbelduels ${dice.wins}–${dice.losses}"),
        )
        Text(if (record.isEmpty() && current.engagements.isNotEmpty()) androidText(language, "No finished games yet.", "Nog geen afgeronde spelletjes.")
            else if (record.isEmpty()) androidText(language, "Nothing between you and $displayName yet.", "Nog niets tussen jou en $displayName.")
            else androidText(language, "You vs $displayName: ", "Jij vs $displayName: ") + record.joinToString(" · "),
            style = type.bodyS, color = colors.textSecondary)
        if (status.isNotBlank()) Mk8dxStatusMessage(status)

        val waiting = current.engagements.filter { it.recipientPlayerId == viewerPlayerId && androidIsOpenGame(it) }
        if (waiting.isNotEmpty()) {
            Mk8dxSectionLabel(androidText(language, "YOUR TURN", "JOUW BEURT"))
            waiting.forEach { entry ->
                val line = androidDescribeEngagement(entry, viewerPlayerId, displayName, language)
                Text("${line.icon} ${line.text}", style = type.bodyS, color = colors.textPrimary)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                    if (entry.kind == "dice_roll") {
                        Mk8dxButton(androidText(language, "🎲 Roll back", "🎲 Gooi terug"), {
                            act {
                                val result = client.answerDice(entry.engagementId)
                                result?.let { androidDescribeEngagement(it, viewerPlayerId, displayName, language) }
                                    ?.let { "${it.text}${it.status?.let { status -> " — $status" } ?: ""}" } ?: ""
                            }
                        }, variant = Mk8dxButtonVariant.Primary, size = Mk8dxButtonSize.Sm, tag = "interaction-roll-back")
                    } else {
                        androidHands.forEach { (hand, icon, names) ->
                            Mk8dxButton("$icon ${androidText(language, names.first, names.second)}", {
                                act {
                                    val result = client.answerRps(entry.engagementId, hand)
                                    result?.let { androidDescribeEngagement(it, viewerPlayerId, displayName, language) }
                                        ?.let { "${it.text}${it.status?.let { status -> " — $status" } ?: ""}" } ?: ""
                                }
                            }, variant = Mk8dxButtonVariant.Primary, size = Mk8dxButtonSize.Sm, tag = "interaction-answer-$hand")
                        }
                    }
                }
            }
        }

        if (!current.accepted) {
            Text(if (current.actions["poke"]?.reason == "no_account") androidText(language,
                "$displayName has no account yet, so there is nobody to notify. Interactions open once they sign in.",
                "$displayName heeft nog geen account, dus niemand krijgt een melding. Interacties kunnen zodra $displayName zich aanmeldt.")
                else androidText(language, "$displayName does not accept interactions from you right now.",
                "$displayName ontvangt nu geen interacties van jou."), style = type.bodyS, color = colors.textBody)
        } else {
            @Composable
            fun ActionBlock(icon: String, title: String, explain: String, kind: String, content: @Composable (Boolean) -> Unit) {
                val allowance = current.actions[kind]
                val open = allowance?.available == true && !busy
                Column(
                    Modifier.fillMaxWidth().border(1.dp, colors.borderSubtle).padding(Mk8dxSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs),
                ) {
                    Text("$icon $title", style = type.body.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    Text(explain, style = type.micro, color = colors.textSecondary)
                    content(open)
                    (androidCurrentStateNote(kind, current, viewerPlayerId, displayName, language, System.currentTimeMillis())
                        ?: androidAllowanceNote(allowance, displayName, kind, language))?.let {
                        Text(it, style = type.micro.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary,
                            modifier = Modifier.testTag("interaction-note-$kind"))
                    }
                }
            }
            val closed = androidText(language, "Not available now", "Nu niet beschikbaar")
            ActionBlock("👋", androidText(language, "Poke", "Por"), androidText(language, "Say hi. Once an hour.", "Zeg hallo. Eén keer per uur."), "poke") { open ->
                Mk8dxButton(androidText(language, "Poke", "Porren"), {
                    act { client.sendEngagement(playerId, "poke"); "${androidText(language, "Poke sent.", "Por verstuurd.")} $notified" }
                }, variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                    disabledReason = if (open) null else closed, disabledReasonShown = false, tag = "interaction-poke")
            }
            ActionBlock("🎲", androidText(language, "Dice duel", "Dobbelduel"),
                androidText(language, "You roll now, $displayName rolls back. Highest wins.", "Jij gooit nu, $displayName gooit terug. Hoogste wint."), "dice_roll") { open ->
                Mk8dxButton(androidText(language, "Roll the dice", "Gooi de dobbelsteen"), {
                    act {
                        val detail = client.sendEngagement(playerId, "dice_roll")
                        "${androidText(language, "You rolled ${detail?.face ?: "?"}.", "Je gooide ${detail?.face ?: "?"}.")} $notified"
                    }
                }, variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                    disabledReason = if (open) null else closed, disabledReasonShown = false, tag = "interaction-dice")
            }
            ActionBlock("✊", androidText(language, "Rock, paper, scissors", "Steen, papier, schaar"),
                androidText(language, "Pick your hand; $displayName answers without seeing it.", "Kies je zet; $displayName antwoordt zonder hem te zien."),
                "rock_paper_scissors") { open ->
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                    androidHands.forEach { (hand, icon, names) ->
                        Mk8dxButton("$icon ${androidText(language, names.first, names.second)}", {
                            act {
                                client.sendEngagement(playerId, "rock_paper_scissors", AndroidEngagementDetail(hand = hand))
                                "${androidText(language, "You threw $icon.", "Je koos $icon.")} $notified"
                            }
                        }, variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                            disabledReason = if (open) null else closed, disabledReasonShown = false, tag = "interaction-rps-$hand")
                    }
                }
            }
            ActionBlock("🏁", androidText(language, "Beat my time", "Versla mijn tijd"),
                if (bests.isEmpty()) androidText(language, "Publish a time first, then challenge with it.", "Publiceer eerst een tijd en daag daarmee uit.")
                else androidText(language, "Send one of your published times to beat. Once an hour.", "Stuur een van je gepubliceerde tijden om te verbeteren. Eén keer per uur."),
                "challenge") { open ->
                Mk8dxButton(androidText(language, "Choose a time…", "Kies een tijd…"), { chooseTrack = true },
                    variant = Mk8dxButtonVariant.Secondary, size = Mk8dxButtonSize.Sm,
                    disabledReason = if (open && bests.isNotEmpty()) null else closed, disabledReasonShown = false, tag = "interaction-challenge")
            }
        }

        Mk8dxSectionLabel(androidText(language, "HISTORY", "GESCHIEDENIS"))
        if (current.engagements.isEmpty()) {
            Text(androidText(language, "Your interactions will appear here.", "Je interacties verschijnen hier."),
                style = type.micro, color = colors.textSecondary)
        }
        val nowMs = remember(current) { System.currentTimeMillis() }
        current.engagements.forEach { entry ->
            val line = androidDescribeEngagement(entry, viewerPlayerId, displayName, language)
            Row(
                Modifier.fillMaxWidth().testTag("interaction-history-${entry.engagementId}"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
            ) {
                Text(line.icon, Modifier.width(22.dp), style = type.body)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(line.text, style = type.bodyS, color = colors.textBody)
                    Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        line.status?.let { Mk8dxChip(it, tone = line.tone) }
                        Text(androidRelativeTime(entry.createdAtMs, nowMs, language), style = type.micro, color = colors.textSecondary)
                    }
                }
            }
        }
    }
    if (chooseTrack) {
        Mk8dxDialog(androidText(language, "Choose your published time", "Kies jouw gepubliceerde tijd"),
            androidText(language, "Close", "Sluiten"), { chooseTrack = false }) {
            Column(Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                bests.sortedWith(compareBy<AndroidTrackBest> { it.mode }.thenBy { it.trackId }).forEach { best ->
                    val name = Schema9AndroidTrackCatalog.find(best.trackId)?.displayName ?: best.trackId
                    Mk8dxButton("$name · ${best.mode}cc · ${Mk8dxNumeric.formatTime(best.totalTimeMs)}", {
                        chooseTrack = false
                        act {
                            client.sendEngagement(playerId, "challenge", AndroidEngagementDetail(trackId = best.trackId, mode = best.mode))
                            "${androidText(language, "Challenge sent with your published best.", "Uitdaging verstuurd met jouw gepubliceerde beste tijd.")} $notified"
                        }
                    }, variant = Mk8dxButtonVariant.Quiet, size = Mk8dxButtonSize.Sm)
                }
            }
        }
    }
}
