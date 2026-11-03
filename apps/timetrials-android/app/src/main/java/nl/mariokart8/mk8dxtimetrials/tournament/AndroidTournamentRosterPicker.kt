package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.track.ProductAssetImage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

// ADR-0218: a name is never an identity. These are the Android twins of the
// website's picker: candidates with context beside "new Player", and the
// Step 2 import review with one choice per row.

/** The asset of a recorded character, when the catalog knows it. */
internal fun androidRosterCharacterAsset(characterKey: String?): String? {
    if (characterKey == null) return null
    return AndroidLoadoutVariants.byId(characterKey)?.assetPath ?: AndroidLoadoutCatalog.find(characterKey)?.assetPath
}

@Composable
private fun RosterCandidateCard(candidate: AndroidRosterCandidate, modifier: Modifier = Modifier) {
    val language = LocalAndroidProductLanguage.current
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        androidRosterCharacterAsset(candidate.characterKey)?.let { asset ->
            ProductAssetImage(
                path = asset,
                fallback = candidate.displayName.take(1),
                accent = TextSoft,
                modifier = Modifier.size(28.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(candidate.displayName, fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 18.sp)
            Text(
                androidRosterCandidateContext(candidate, language),
                color = TextSoft,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }
    }
}

/**
 * ADR-0221: the installation's settings as the Tournament screen read them
 * with the night. The default (everybody creates Players) is what a server
 * before migration 0081 behaves like.
 */
internal val LocalAndroidInstallationSettings = staticCompositionLocalOf { AndroidInstallationSettings.DEFAULTS }

/** ADR-0221: why there is no "new Player" when only self sign-up creates Players. */
@Composable
internal fun androidPlayerCreationClosedText(): String = androidText(
    "On this site Players create themselves when they sign up. Ask the person to sign up, then add their Player.",
    "Op deze site maken spelers zichzelf aan bij het aanmelden. Vraag de persoon zich aan te melden en voeg daarna zijn speler toe.",
)

/**
 * The choice for one typed name: every candidate with its context and a
 * button, then "new Player", which warns first when the name is already in
 * this Director's own nights.
 */
@Composable
internal fun TournamentRosterChoiceList(
    entry: AndroidRosterNameCandidates,
    pickLabel: @Composable (AndroidRosterCandidate) -> String,
    onPick: (AndroidRosterCandidate) -> Unit,
    onCreate: ((Boolean) -> Unit)?,
    blockOnNight: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("tournament-roster-choices")) {
        Text(
            if (entry.candidates.isEmpty()) {
                androidText("Nobody is called \"${entry.name}\" yet.", "Niemand heet nog \"${entry.name}\".")
            } else {
                androidText(
                    "Who is \"${entry.name}\"? A name is never an identity: choose the Player, or create a new one.",
                    "Wie is \"${entry.name}\"? Een naam is nooit een identiteit: kies de speler, of maak een nieuwe aan.",
                )
            },
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
        entry.candidates.forEach { candidate ->
            val blocked = blockOnNight && candidate.inTournament
            Surface(
                color = PanelBackground,
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, TextSoft.copy(alpha = .35f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    RosterCandidateCard(candidate)
                    SecondaryButton(
                        label = if (blocked) androidText("Already on the list", "Staat al op de lijst") else pickLabel(candidate),
                        onClick = { onPick(candidate) },
                        enabled = !blocked,
                        testTag = "tournament-roster-pick-${candidate.playerId}",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        val creationOpen = LocalAndroidInstallationSettings.current.directorsMayCreatePlayers
        if (onCreate != null && !creationOpen) {
            Text(
                androidPlayerCreationClosedText(),
                color = TextSoft,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.testTag("tournament-roster-creation-closed"),
            )
        }
        if (onCreate != null && creationOpen) {
            if (entry.sameNameInOwnNights) {
                Text(
                    androidText(
                        "There is already a \"${entry.name}\" in your nights. Only create a new Player if this is someone else; their username gets a number (for example -2).",
                        "Er is al een \"${entry.name}\" in jouw avonden. Maak alleen een nieuwe speler aan als dit iemand anders is; de gebruikersnaam krijgt een nummer (bijvoorbeeld -2).",
                    ),
                    color = WarningAmber,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.testTag("tournament-roster-same-name-warning"),
                )
            }
            SecondaryButton(
                label = if (entry.sameNameInOwnNights) {
                    androidText("Create another \"${entry.name}\"", "Nog een \"${entry.name}\" aanmaken")
                } else {
                    androidText("New Player \"${entry.name}\"", "Nieuwe speler \"${entry.name}\"")
                },
                onClick = { onCreate(entry.sameNameInOwnNights) },
                testTag = "tournament-roster-create",
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The Step 3/7 board's "new Player" for a name Players already carry. */
@Composable
internal fun TournamentRosterChoiceDialog(
    entry: AndroidRosterNameCandidates,
    onPick: (AndroidRosterCandidate) -> Unit,
    onCreate: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanelBackground,
        titleContentColor = TextMain,
        textContentColor = TextSoft,
        title = {
            Text(androidText("Who is \"${entry.name}\"?", "Wie is \"${entry.name}\"?"), fontSize = 16.sp, fontWeight = FontWeight.Black)
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                TournamentRosterChoiceList(
                    entry = entry,
                    pickLabel = { candidate -> androidText("Seat ${candidate.displayName}", "${candidate.displayName} plaatsen") },
                    onPick = onPick,
                    onCreate = onCreate,
                    blockOnNight = true,
                )
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("tournament-roster-dialog-cancel")) {
                Text(androidText("Cancel", "Annuleren"), color = TextSoft)
            }
        },
    )
}

/**
 * ADR-0218: the Step 2 import review. Every row shows its name, its status
 * and a choice (a candidate, new Player, skip); "apply" stays off while a
 * row waits for a choice and asks twice when it creates Players.
 */
@Composable
internal fun TournamentRosterReview(
    review: AndroidRosterImport.Review,
    onChoose: (Int, AndroidRosterChoice?) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val language = LocalAndroidProductLanguage.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("tournament-roster-review")) {
        Text(
            androidText(
                "Choose who each of the ${review.rows.size} rows is. A name is never an identity: nothing is linked or created until you apply the list.",
                "Kies wie elk van de ${review.rows.size} regels is. Een naam is nooit een identiteit: er wordt niets gekoppeld of aangemaakt tot je de lijst toepast.",
            ),
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
        review.rows.forEachIndexed { index, row ->
            val entry = review.entries.getOrNull(index)
            val choice = review.choices[row.row]
            var open by remember(row.row) { mutableStateOf(false) }
            val chosenCandidate = (choice as? AndroidRosterChoice.Player)?.let { picked ->
                entry?.candidates?.firstOrNull { it.playerId == picked.playerId }
            }
            val sameName = entry?.sameNameInOwnNights == true
            val choiceLabel = when {
                choice == null -> androidText("Choose…", "Kies…")
                chosenCandidate != null -> "${chosenCandidate.displayName} — ${androidRosterCandidateContext(chosenCandidate, language)}"
                choice == AndroidRosterChoice.New && sameName ->
                    androidText("Another \"${row.displayName}\" (new Player)", "Nog een \"${row.displayName}\" (nieuwe speler)")
                choice == AndroidRosterChoice.New ->
                    androidText("New Player \"${row.displayName}\"", "Nieuwe speler \"${row.displayName}\"")
                else -> androidText("Skip this row", "Regel overslaan")
            }
            val status = when (row.attendance) {
                ATTENDANCE_PRESENT -> androidText("Present", "Aanwezig")
                ATTENDANCE_ABSENT -> androidText("Absent", "Afwezig")
                else -> androidText("Waiting list", "Wachtlijst")
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${row.row}. ${row.displayName} · $status", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                OutlinedButton(
                    onClick = { open = true },
                    modifier = Modifier.fillMaxWidth().testTag("tournament-roster-review-pick-${row.row}"),
                ) {
                    Text(choiceLabel, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    entry?.candidates?.forEach { candidate ->
                        DropdownMenuItem(
                            text = {
                                Text(
                                    "${candidate.displayName} — ${androidRosterCandidateContext(candidate, language)}",
                                    fontSize = 12.sp,
                                )
                            },
                            onClick = { open = false; onChoose(row.row, AndroidRosterChoice.Player(candidate.playerId)) },
                        )
                    }
                    if (LocalAndroidInstallationSettings.current.directorsMayCreatePlayers) DropdownMenuItem(
                        text = {
                            Text(
                                if (sameName) {
                                    androidText("Another \"${row.displayName}\" (new Player)", "Nog een \"${row.displayName}\" (nieuwe speler)")
                                } else {
                                    androidText("New Player \"${row.displayName}\"", "Nieuwe speler \"${row.displayName}\"")
                                },
                                fontSize = 12.sp,
                            )
                        },
                        onClick = { open = false; onChoose(row.row, AndroidRosterChoice.New) },
                    )
                    DropdownMenuItem(
                        text = { Text(androidText("Skip this row", "Regel overslaan"), fontSize = 12.sp) },
                        onClick = { open = false; onChoose(row.row, AndroidRosterChoice.Skip) },
                    )
                }
                if (choice == AndroidRosterChoice.New && sameName) {
                    Text(
                        androidText(
                            "There is already a \"${row.displayName}\" in your nights; this creates someone else.",
                            "Er is al een \"${row.displayName}\" in jouw avonden; dit maakt iemand anders aan.",
                        ),
                        color = WarningAmber,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }
        }
        if (review.openRows > 0) {
            Text(
                androidText("${review.openRows} rows still need a choice.", "${review.openRows} regels wachten nog op een keuze."),
                color = WarningAmber,
                fontSize = 13.sp,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val creating = review.creating
            SecondaryButton(
                label = when {
                    review.secondConfirmation ->
                        androidText("Confirm again: create $creating new Players", "Bevestig nogmaals: maak $creating nieuwe spelers aan")
                    creating > 0 ->
                        androidText("Apply the list (creates $creating new Players)", "Lijst toepassen (maakt $creating nieuwe spelers aan)")
                    else -> androidText("Apply the list", "Lijst toepassen")
                },
                onClick = onConfirm,
                enabled = review.openRows == 0,
                testTag = "tournament-participants-import-confirm",
                modifier = Modifier.weight(1f),
            )
            SecondaryButton(
                label = androidText("Cancel", "Annuleren"),
                onClick = onCancel,
                testTag = "tournament-participants-import-cancel",
                modifier = Modifier.weight(1f),
            )
        }
    }
}
