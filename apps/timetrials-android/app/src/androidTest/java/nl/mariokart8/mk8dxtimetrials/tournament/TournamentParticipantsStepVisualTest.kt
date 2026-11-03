package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.printToString
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.LocalAndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TournamentParticipantsStepVisualTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun sourceBulkStatusActionCanSetTheWholeRosterAtOnce() {
        val applied = AtomicReference<Pair<List<String>, String>?>(null)
        setStep2Content(onAttendanceBulk = { ids, status -> applied.set(ids to status) })

        compose.onNodeWithTag("tournament-participants-menu").performClick()
        compose.onNodeWithText("Statussen wijzigen (bulk)").performClick()
        compose.onNodeWithTag("tournament-participants-step")
            .performScrollToNode(hasText("Zet alle deelnemers op:"))
        compose.onNodeWithTag("tournament-participants-status-all-present")
            .performScrollTo().performClick()

        assertEquals(7, applied.get()?.first?.size)
        assertEquals(ATTENDANCE_PRESENT, applied.get()?.second)
    }

    @Test
    fun sourceStateProducesVisualAndSemanticsArtifacts() {
        setStep2Content()

        compose.onNodeWithText("MK8DX LAN Toernooibord").assertIsDisplayed()
        compose.onNodeWithText("Stap 2 · Deelnemers selecteren").assertIsDisplayed()
        compose.onNodeWithText("Stap 2: Deelnemers en consoles").assertIsDisplayed()
        compose.onNodeWithText("Aanwezig 2").assertIsDisplayed()
        compose.onNodeWithText("Wachtlijst 1").assertIsDisplayed()
        compose.onNodeWithText("Afwezig 4").assertIsDisplayed()
        compose.onNodeWithText("Matteo").assertIsDisplayed()
        compose.onNodeWithText("RANK #1").assertIsDisplayed()
        compose.onNodeWithText("SP: 30,31").assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-hide-inactive").performScrollTo().assertIsDisplayed()
        // The toggle now names how many rows it is hiding, so the operator can
        // see that a filtered board is not an empty one.
        compose.onNodeWithText("Inactieve afwezigen verbergen (1)").assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-seed").performScrollTo().assertIsDisplayed()

        for (removedElement in listOf("Overview", "People", "Groups", "Standings", "Incoming", "Scores")) {
            compose.onAllNodesWithText(removedElement).assertCountEquals(0)
        }

        val artifactDirectory = requireNotNull(
            InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("step2-test-artifacts"),
        )
        val semantics = compose.onRoot(useUnmergedTree = true).printToString(maxDepth = 20)
            .replace(Regex("@[0-9a-fA-F]+"), "@<runtime>")
        File(artifactDirectory, "step2-semantics.txt").writeText(semantics)
        assertTrue(semantics.contains("tournament-participants-step"))
        assertTrue(semantics.contains("Maak kwalificatiegroepen"))
        FileOutputStream(File(artifactDirectory, "step2.png")).use { output ->
            val compressed = compose.onNodeWithTag("tournament-participants-step")
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
            assertTrue(compressed)
        }
    }

    @Test
    fun attendanceAndSwitchTogglesReportSourceValues() {
        val attendance = AtomicReference<Pair<String, String>>()
        val switches = AtomicReference<Triple<String, Boolean, Boolean>>()
        setStep2Content(
            onAttendance = { participant, value -> attendance.set(participant.displayName to value) },
            onSwitches = { participant, ns1, ns2 -> switches.set(Triple(participant.displayName, ns1, ns2)) },
        )

        compose.onNodeWithTag("roster-waiting-player.matteo").performScrollTo().performClick()
        assertEquals("Matteo" to "waiting", attendance.get())

        compose.onNodeWithTag("roster-ns2-player.matteo").performScrollTo().performClick()
        assertEquals(Triple("Matteo", true, true), switches.get())
    }

    @Test
    fun anEmptyRosterKeepsTheNextStepClosed() {
        val seeds = AtomicInteger(0)
        setStep2Content(document = emptyRosterDocument(), onSeed = { seeds.incrementAndGet() })

        compose.onNodeWithTag("tournament-participants-seed").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("Maak kwalificatiegroepen (nog niet klaar)").assertIsDisplayed()
        compose.onNodeWithText("Nog niet klaar: markeer minimaal 1 deelnemer als Aanwezig.")
            .performScrollTo().assertIsDisplayed()
        assertEquals(0, seeds.get())
    }

    @Test
    fun aReadyRosterOpensTheNextStep() {
        val seeds = AtomicInteger(0)
        setStep2Content(document = readyRosterDocument(), onSeed = { seeds.incrementAndGet() })

        compose.onNodeWithText("Klaar om groepen te maken").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-seed").performScrollTo().assertIsEnabled().performClick()
        assertEquals(1, seeds.get())
    }

    @Test
    fun theRosterFilterFollowsTheSourceHideRule() {
        setStep2Content()

        // Merle is inactive and absent, so the default source filter hides that row.
        compose.onAllNodesWithText("Merle").assertCountEquals(0)
        compose.onNodeWithTag("tournament-participants-hide-inactive").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-participants-roster-list").performScrollToNode(hasText("Merle"))
        compose.onNodeWithText("Merle").assertIsDisplayed()
    }

    @Test
    fun theRosterCsvExportUsesTheSourceColumns() {
        val csv = androidRosterCsv(androidTournamentParticipantsPreviewDocument().participants)
        val lines = csv.trim().lines()

        // The source Manager writes semicolons and Dutch display order.
        assertEquals("\uFEFFNaam;Status;NS1;NS2", lines.first())
        assertTrue(lines.contains("Matteo;Aanwezig;ja;nee"))
        assertTrue(lines.contains("Gideon;Aanwezig;nee;ja"))
        assertTrue(lines.contains("Moss HM;Wachtlijst;ja;nee"))
        assertEquals("Ben;Afwezig;nee;nee", lines[1])
        assertFalse(csv.contains("present"))
    }

    @Test
    fun unknownNamesNeedTwoConfirmationsBeforeAnythingIsCreated() {
        val rows = listOf(AndroidRosterCsvRow(7, "BertvandeGoei", ATTENDANCE_ABSENT, false, false))
        setStep2Content(
            importState = androidRosterReview(
                rows,
                listOf(AndroidRosterNameCandidates("BertvandeGoei", sameNameInOwnNights = false, candidates = emptyList())),
            ),
        )

        // ADR-0218: every row is a choice; a name nobody carries starts as "new Player".
        compose.onNodeWithTag("tournament-participants-csv").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-roster-review").assertIsDisplayed()
        compose.onNodeWithText("Nieuwe speler \"BertvandeGoei\"").assertIsDisplayed()
        compose.onNodeWithText("Lijst toepassen (maakt 1 nieuwe spelers aan)").assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-import-cancel").assertIsDisplayed()
    }

    @Test
    fun anAmbiguousNameWaitsForTheDirectorsChoice() {
        val mal = AndroidRosterCandidate(
            playerId = "player.mal", username = "mal", displayName = "Mal", matchedBy = "display_name",
            claimed = true, inTournament = false, nights = 12, nightsWithDirector = 3,
        )
        val otherMal = mal.copy(playerId = "player.mal_2", username = "mal-2", nights = 2, nightsWithDirector = 0)
        setStep2Content(
            importState = androidRosterReview(
                listOf(AndroidRosterCsvRow(8, "Mal", ATTENDANCE_PRESENT, true, false)),
                listOf(AndroidRosterNameCandidates("Mal", sameNameInOwnNights = true, candidates = listOf(mal, otherMal))),
            ),
        )

        compose.onNodeWithTag("tournament-participants-csv").performScrollTo().performClick()
        compose.onNodeWithText("Kies…").assertIsDisplayed()
        compose.onNodeWithText("1 regels wachten nog op een keuze.").assertIsDisplayed()
    }

    @Test
    fun aRejectedImportReportsThatNothingWasWritten() {
        setStep2Content(
            importState = AndroidRosterImport.Failed(
                androidRosterRejectionMessage(
                    listOf(AndroidRosterRejection(9, "Ben", "username_taken")),
                ),
            ),
        )

        compose.onNodeWithTag("tournament-participants-csv").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-participants-import-failed").assertIsDisplayed()
        compose.onNodeWithText(
            "Er is niets geïmporteerd. regel 9 \"Ben\": gebruikersnaam is bezet.",
        ).assertIsDisplayed()
    }

    /** ADR-0177 decision 11: the username is shown before anything is created. */
    @Test
    fun anUnknownFreeTextNameOffersOneConfirmationShowingTheDerivedUsername() {
        setStep2Content(
            participantAddState = AndroidParticipantAdd.Confirm("Jan Piet", "jan_piet"),
        )

        compose.onNodeWithTag("tournament-participants-add-report")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("\"Jan Piet\" is nog geen speler.").assertIsDisplayed()
        compose.onNodeWithText(
            "Aanmaken geeft de gebruikersnaam @jan_piet, of de eerstvolgende vrije (@jan_piet-2). De speler blijft claimbaar door de persoon zelf.",
        ).assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-add-confirm").assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-add-cancel").assertIsDisplayed()
    }

    @Test
    fun aCreatedParticipantReportsTheUsernameTheServerAllocated() {
        setStep2Content(
            participantAddState = AndroidParticipantAdd.Created("Jan Piet", "jan_piet"),
        )

        compose.onNodeWithTag("tournament-participants-add-created")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Jan Piet is aangemaakt als @jan_piet en toegevoegd.").assertIsDisplayed()
    }

    /** ADR-0177 decision 7: the layout is editable while no groups exist. */
    @Test
    fun changingTheSeedOrderSendsTheWholeLayoutToTheServer() {
        val sent = mutableListOf<List<Any?>>()
        setStep2Content(onUpdateSettings = { a, b, c, d -> sent += listOf(a, b, c, d) })

        compose.onNodeWithTag("tournament-participants-settings").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-participants-seed-order-random")
            .performScrollTo().performClick()

        assertEquals(listOf(listOf("random", "balanced", "owner_strict", null)), sent)
    }

    @Test
    fun theActiveLayoutOptionIsNotResent() {
        val sent = mutableListOf<List<Any?>>()
        setStep2Content(onUpdateSettings = { a, b, c, d -> sent += listOf(a, b, c, d) })

        compose.onNodeWithTag("tournament-participants-settings").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-participants-seed-order-community_rating")
            .performScrollTo().performClick()

        assertTrue(sent.isEmpty())
    }

    @Test
    fun theLayoutIsFrozenOnceGroupsExist() {
        val sent = mutableListOf<List<Any?>>()
        setStep2Content(settingsLocked = true, onUpdateSettings = { a, b, c, d -> sent += listOf(a, b, c, d) })

        compose.onNodeWithTag("tournament-participants-settings").performScrollTo().performClick()
        compose.onNodeWithTag("tournament-participants-seed-order-random")
            .performScrollTo().performClick()

        assertTrue(sent.isEmpty())
        compose.onNodeWithTag("tournament-participants-settings-locked")
            .performScrollTo().assertIsDisplayed()
    }

    /** The source Manager offers Strikt / Flexibel here; so must the phone. */
    @Test
    fun theOwnerSeatingModeIsOfferedExactlyAsTheSourceDoes() {
        val sent = mutableListOf<List<Any?>>()
        setStep2Content(onUpdateSettings = { a, b, c, d -> sent += listOf(a, b, c, d) })

        compose.onNodeWithTag("tournament-participants-settings").performScrollTo().performClick()
        compose.onNodeWithText("Strikt (standaard)").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Flexibel").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("tournament-participants-owner-seating-owner_soft")
            .performScrollTo().performClick()

        assertEquals(listOf(listOf("ranked", "balanced", "owner_soft", null)), sent)
    }

    /** The source labels the full shuffle "Volledig willekeurig", not "Willekeurig". */
    @Test
    fun theLayoutOptionsUseTheSourceLabels() {
        setStep2Content()

        compose.onNodeWithTag("tournament-participants-settings").performScrollTo().performClick()
        compose.onNodeWithText("Gebalanceerd (standaard)").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Minimale verschuiving").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Op ranglijst (standaard)").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Volledig willekeurig").performScrollTo().assertIsDisplayed()
    }

    /**
     * Production seeds Step 2 from legacy race history, where every Player is
     * an inactive absentee. The board must not claim there are no participants.
     */
    @Test
    fun aRosterHiddenEntirelyByTheInactiveFilterSaysSoInsteadOfLookingEmpty() {
        setStep2Content(document = allInactiveAbsentDocument())

        compose.onNodeWithTag("tournament-participants-all-hidden").assertIsDisplayed()
        compose.onNodeWithText(
            "Alle 3 deelnemers zijn inactieve afwezigen en staan daarom verborgen.",
        ).assertIsDisplayed()
        compose.onAllNodesWithText(
            "Nog geen deelnemers. Voeg ze onderaan toe of gebruik het ☰ Admin-menu.",
        ).assertCountEquals(0)
        compose.onNodeWithText("Inactieve afwezigen verbergen (3)").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun showingTheInactiveAbsenteesRevealsTheWholeRoster() {
        setStep2Content(document = allInactiveAbsentDocument())

        compose.onNodeWithTag("tournament-participants-show-inactive").performClick()

        compose.onNodeWithText("Oud Racer 1").assertIsDisplayed()
        compose.onAllNodesWithTag("tournament-participants-all-hidden").assertCountEquals(0)
    }

    @Test
    fun anEmptyRosterStillReportsThatNobodyIsAdded() {
        val document = androidTournamentParticipantsPreviewDocument()
        setStep2Content(document = document.copy(participants = emptyList()))

        compose.onNodeWithText(
            "Nog geen deelnemers. Voeg ze onderaan toe of gebruik het ☰ Admin-menu.",
        ).assertIsDisplayed()
        compose.onAllNodesWithTag("tournament-participants-all-hidden").assertCountEquals(0)
    }
    /**
     * The attendance counters say nothing about activity, and the filter lives
     * far below the board. The operator must be told at the board itself.
     */
    @Test
    fun theBoardHeaderNamesHowManyInactiveRowsAreHidden() {
        setStep2Content()

        compose.onNodeWithTag("tournament-participants-hidden-note").assertIsDisplayed()
        compose.onNodeWithText("1 inactief verborgen").assertIsDisplayed()
    }

    @Test
    fun tappingTheHiddenNoteRevealsTheInactiveRows() {
        setStep2Content()

        compose.onNodeWithTag("tournament-participants-hidden-note").performClick()

        compose.onAllNodesWithTag("tournament-participants-hidden-note").assertCountEquals(0)
        // Inactive rows sort last, so scroll the board to reach the badge.
        compose.onNodeWithTag("tournament-participants-roster-list")
            .performScrollToNode(hasText("Inactief"))
        compose.onNodeWithText("Inactief").assertIsDisplayed()
    }
    /**
     * ADR-0177 decision 18: a Player who has never raced is Nieuw, and that is
     * a different state from Inactief.
     *
     * ADR-0177 decision 20: the server now gives such a Player the canonical
     * TrueSkill prior, so their conservative score is 0,00 and their rank puts
     * them behind every rated Player instead of showing "#?".
     */
    @Test
    fun aPlayerWhoNeverRacedIsLabelledNieuwAndSeededAtThePrior() {
        val base = androidTournamentParticipantsPreviewDocument()
        val newcomer = AndroidTournamentParticipant(
            playerId = "player.kikker", username = "kikker", displayName = "Kikker",
            attendance = ATTENDANCE_WAITING, hasSwitch1 = false, hasSwitch2 = false,
            isNew = true, seedScore = 0.0, seedRank = 62,
        )
        setStep2Content(document = base.copy(participants = base.participants + newcomer))

        compose.onNodeWithTag("tournament-participants-roster-list")
            .performScrollToNode(hasText("Kikker"))
        compose.onNodeWithText("Nieuw").assertIsDisplayed()
        compose.onNodeWithText("RANK #62").assertIsDisplayed()
        compose.onNodeWithText("SP: 0,00").assertIsDisplayed()
    }

    /**
     * A Player whose rating genuinely has not been read shows a dash, not a
     * number that would read as a real score.
     */
    @Test
    fun aParticipantWithoutAnyRatingShowsADashInsteadOfANumber() {
        val base = androidTournamentParticipantsPreviewDocument()
        val unrated = AndroidTournamentParticipant(
            playerId = "player.onbekend", username = "onbekend", displayName = "Onbekend",
            attendance = ATTENDANCE_WAITING, hasSwitch1 = false, hasSwitch2 = false,
            isNew = true, seedScore = null, seedRank = null,
        )
        setStep2Content(document = base.copy(participants = base.participants + unrated))

        compose.onNodeWithTag("tournament-participants-roster-list")
            .performScrollToNode(hasText("Onbekend"))
        compose.onNodeWithText("RANK #?").assertIsDisplayed()
        compose.onNodeWithText("SP: -").assertIsDisplayed()
    }

    @Test
    fun aNieuwPlayerIsNotHiddenByTheInactiveFilter() {
        val base = androidTournamentParticipantsPreviewDocument()
        val newcomer = AndroidTournamentParticipant(
            playerId = "player.kikker", username = "kikker", displayName = "Kikker",
            attendance = ATTENDANCE_ABSENT, hasSwitch1 = false, hasSwitch2 = false,
            isNew = true, inactive = false,
        )
        setStep2Content(document = base.copy(participants = listOf(newcomer)))

        // Never having raced is not the same as having been skipped.
        compose.onNodeWithText("Kikker").assertIsDisplayed()
        compose.onAllNodesWithTag("tournament-participants-all-hidden").assertCountEquals(0)
    }
    private fun setStep2Content(
        document: AndroidTournamentDocument = androidTournamentParticipantsPreviewDocument(),
        onAttendance: (AndroidTournamentParticipant, String) -> Unit = { _, _ -> },
        onSwitches: (AndroidTournamentParticipant, Boolean, Boolean) -> Unit = { _, _, _ -> },
        onSeed: () -> Unit = {},
        importState: AndroidRosterImport? = null,
        participantAddState: AndroidParticipantAdd? = null,
        settingsLocked: Boolean = false,
        onUpdateSettings: (String, String, String, Int?) -> Unit = { _, _, _, _ -> },
        onAttendanceBulk: (List<String>, String) -> Unit = { _, _ -> },
    ) {
        // The board's source labels are Dutch; the test pins them in the Dutch product language.
        compose.setContent {
            CompositionLocalProvider(LocalAndroidProductLanguage provides AndroidProductLanguage.DUTCH) {
            Mk8dxTheme(Mk8dxAppearance.Dark) {
                Box {
                    TournamentParticipantsStep(
                        document = document,
                        busy = false,
                        error = null,
                        notice = null,
                        onBackToStart = {},
                        onRefresh = {},
                        onSetAttendance = onAttendance,
                        onSetSwitches = onSwitches,
                        onAddParticipant = {},
                        onAddRecentParticipants = {},
                        onAddHistoricalParticipants = {},
                        onMarkOwnersBulk = { _, _ -> },
                        onSetAttendanceBulk = onAttendanceBulk,
                        onExportCsv = {},
                        onImportCsvText = {},
                        importState = importState,
                        participantAddState = participantAddState,
                        onParticipantAddConfirm = {},
                        onParticipantAddCancel = {},
                        onImportConfirm = {},
                        onImportCancel = {},
                        onCreateQualifierGroups = onSeed,
                        settingsLocked = settingsLocked,
                        onUpdateSettings = onUpdateSettings,
                        modifier = Modifier,
                    )
                }
            }
            }
        }
    }

    private fun emptyRosterDocument(): AndroidTournamentDocument {
        val base = androidTournamentParticipantsPreviewDocument()
        return base.copy(
            summary = base.summary.copy(participantCount = 0, presentCount = 0),
            participants = emptyList(),
        )
    }

    private fun readyRosterDocument(): AndroidTournamentDocument {
        val base = androidTournamentParticipantsPreviewDocument()
        return base.copy(
            participants = base.participants.map {
                it.copy(attendance = ATTENDANCE_PRESENT, hasSwitch1 = true, hasSwitch2 = true)
            },
        )
    }
}

/** Every Player absent and inactive, exactly as a production Step 2 starts. */
private fun allInactiveAbsentDocument(): AndroidTournamentDocument {
    val base = androidTournamentParticipantsPreviewDocument()
    val participants = (1..3).map { index ->
        AndroidTournamentParticipant(
            playerId = "player.legacy_$index",
            username = "legacy_$index",
            displayName = "Oud Racer $index",
            attendance = ATTENDANCE_ABSENT,
            hasSwitch1 = false,
            hasSwitch2 = false,
            inactive = true,
        )
    }
    return base.copy(participants = participants)
}
