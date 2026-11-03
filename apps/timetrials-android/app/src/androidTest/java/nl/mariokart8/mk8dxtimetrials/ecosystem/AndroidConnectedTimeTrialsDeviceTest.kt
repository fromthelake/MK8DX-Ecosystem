package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.swipe
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import java.io.FileOutputStream
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearance
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme as Mk8dxDesignTheme

class AndroidConnectedTimeTrialsDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun clearPersistedRankView() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        AndroidRankViewStateStore(context, "player.ben").clear()
        AndroidRankViewStateStore(context, "anonymous").clear()
    }

    private val source = object : AndroidTimeTrialsEcosystemDataSource {
        override fun home() = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = AndroidHomeComeback(
                "mk8dx.home-comeback.v1",
                AndroidHomePlayer("player.ben", "Ben"),
                AndroidTimeTrialStanding(4, 28, 12_345_678, 6),
                listOf(AndroidRivalComparison("player.rival", "Rival", 7, 4, 11, -925)),
            ),
            focus = AndroidHomeFocusDocument(
                "mk8dx.home-focus.v1",
                listOf(
                    AndroidFocusRow(
                        "track.mario_kart_stadium", 150, 92_000, 3, 12, 90_000,
                        AndroidFocusTarget("player.rival", "Rival", 91_500, 2),
                    ),
                ),
            ),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(
                    AndroidTrackBestPlayer("player.ben", listOf(
                        AndroidTrackBest("track.mario_kart_stadium", 150, 92_000, 3),
                        AndroidTrackBest("track.big_blue", 200, 87_000, 1),
                    )),
                    AndroidTrackBestPlayer("player.rival", listOf(AndroidTrackBest("track.mario_kart_stadium", 150, 91_500, 2))),
                ),
            ),
            stories = AndroidActivityStoriesDocument(
                "mk8dx.activity-stories.v1",
                listOf(
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.rival", "Rival", "country.de"),
                        "track.mario_kart_stadium", 150, 3, 93_000, 91_500, 1_500,
                        true, AndroidActivityRank(2, 4, passedCount = 2), System.currentTimeMillis(),
                        listOf(
                            AndroidActivityRun(
                                "user_submission.time.ACTIVITYDETAIL01",
                                91_500,
                                System.currentTimeMillis(),
                                listOf(
                                    AndroidActivityLap(1, 30_000, 10),
                                    AndroidActivityLap(2, 30_000, 8),
                                    AndroidActivityLap(3, 31_500),
                                ),
                                AndroidActivityLoadout(
                                    characterId = "character.yoshi",
                                    characterVariantId = "character_variant.yoshi.018_black",
                                    bodyId = "body.mr_scooty",
                                    bodyVariantId = "body_variant.mr_scooty.000_blue",
                                    tireId = "tire.roller",
                                    gliderId = "glider.cloud_glider",
                                    gliderVariantId = "glider_variant.cloud_glider.000_blue",
                                ),
                                sourceKind = "android_manual",
                            ),
                        ),
                        viewerOvertake = AndroidViewerOvertake(
                            "notification.overtaken.1", 91_500, 92_000, -500, 4,
                        ),
                        runRank = 2,
                    ),
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.threat", "Nova"),
                        "track.big_blue", 200, 1, 87_650, 87_650,
                        personalBest = true, latestAtMs = System.currentTimeMillis() - 1_000,
                    ),
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.ben", "Ben"),
                        "track.big_blue", 200, 4, 90_000, 87_000, 3_000,
                        personalBest = true, latestAtMs = System.currentTimeMillis() - 2_000,
                    ),
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.ace", "Ace"),
                        "track.toad_harbour", 150, 1, 120_000, 120_000,
                        personalBest = false,
                        latestAtMs = System.currentTimeMillis() - 3_000,
                        runDetails = listOf(
                            AndroidActivityRun(
                                "user_submission.time.ACTIVITYDETAIL03",
                                120_000,
                                System.currentTimeMillis() - 3_000,
                                listOf(
                                    AndroidActivityLap(1, 40_000, 3, 1),
                                    AndroidActivityLap(2, 40_000, 6, 1),
                                    AndroidActivityLap(3, 40_000, 10, 1),
                                ),
                                AndroidActivityLoadout(
                                    characterId = "character.yoshi",
                                    bodyId = "body.mr_scooty",
                                    tireId = "tire.roller",
                                    gliderId = "glider.cloud_glider",
                                ),
                                sourceKind = "android_scan",
                            ),
                        ),
                        runRank = 3,
                    ),
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.floyd", "Floyd", "country.nl"),
                        "track.gba_cheese_land", 200, 1, 95_000, 95_000,
                        personalBest = true,
                        latestAtMs = System.currentTimeMillis() - 4_000,
                        runDetails = listOf(
                            AndroidActivityRun(
                                "user_submission.time.ACTIVITYDETAIL02",
                                95_000,
                                System.currentTimeMillis() - 4_000,
                                listOf(
                                    AndroidActivityLap(1, 31_000, 4, 1),
                                    AndroidActivityLap(2, 32_000, 6, 1),
                                    AndroidActivityLap(3, 32_000, 10, 1),
                                ),
                                AndroidActivityLoadout(
                                    characterId = "character.yoshi",
                                    characterVariantId = "character_variant.yoshi.018_black",
                                    bodyId = "body.mr_scooty",
                                    tireId = "tire.roller",
                                    gliderId = "glider.cloud_glider",
                                ),
                                sourceKind = "android_scan",
                            ),
                        ),
                        runRank = 5,
                    ),
                    AndroidActivityStory(
                        AndroidActivityPlayer("player.lex", "Lex"),
                        "track.gba_ribbon_road", 200, 2, 99_500, 98_500, 1_000,
                        personalBest = true, latestAtMs = System.currentTimeMillis() - 5_000,
                    ),
                ),
            ),
        )

        override fun leaderboard(trackId: String, mode: Int) = listOf(
            AndroidPublicTimeTrialResult(
                "result.1", "player.ben", "ben", "Ben", trackId, mode, 92_000, 2,
                countryId = "country.nl",
                sourceKind = "android_manual",
            ),
            AndroidPublicTimeTrialResult(
                "result.2", "player.rival", "rival", "Rival", trackId, mode, 91_500, 1,
                countryId = "country.de",
                sourceKind = "android_scan",
            ),
        )

        override fun worldRecords() = listOf(
            AndroidWorldRecord(
                mode = 150,
                trackId = "track.mario_kart_stadium",
                trackName = "Mario Kart Stadium",
                totalTimeMs = 89_500,
                playerName = "World Record",
                lapTimesMs = listOf(29_500, 30_000, 30_000),
                coinsPerLap = listOf(3, 3, 4),
                mushroomsPerLap = listOf(1, 1, 1),
            ),
        )
    }

    /**
     * A01 Home on the design system (Phase 10). This replaces the assertions
     * that pinned the old presentation — the cyan filter pills, the five-step
     * delta ramp and its `-0:00.500`, the emoji-free but hand-built cards — with
     * the same journeys through the migrated page: the sections are there, a
     * delta is the system's one format, the detail dialog opens and closes, and
     * the engine-class filter is a radio group whose selection is announced.
     */
    /** A Player whose account preference names 150cc only (ADR-0172, R1). */
    private val singleEngineSource = object : AndroidTimeTrialsEcosystemDataSource {
        override fun home() = AndroidHomeBootstrap(
            schemaVersion = "mk8dx.home-bootstrap.v1",
            authenticated = true,
            comeback = AndroidHomeComeback(
                "mk8dx.home-comeback.v1",
                AndroidHomePlayer("player.ben", "Ben"),
                AndroidTimeTrialStanding(4, 28, 12_345_678, 6),
                emptyList(),
            ),
            focus = AndroidHomeFocusDocument(
                "mk8dx.home-focus.v1",
                listOf(
                    AndroidFocusRow("track.mario_kart_stadium", 150, 92_000, 3, 12, 90_000),
                ),
                modePreference = "150",
            ),
            trackBests = AndroidTrackBestsDocument(
                "mk8dx.public-track-bests.v1",
                listOf(
                    AndroidTrackBestPlayer(
                        "player.ben",
                        listOf(AndroidTrackBest("track.mario_kart_stadium", 150, 92_000, 3)),
                    ),
                ),
            ),
        )

        override fun leaderboard(trackId: String, mode: Int) =
            emptyList<AndroidPublicTimeTrialResult>()
    }

    @Test
    fun homeShowsFocusAndCommunityActivity() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(390.dp)) {
                    AndroidHomeExperience(
                        source, "player.ben", {},
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                    )
                }
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithTag("your-focus").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("YOUR FOCUS").fetchSemanticsNode()
        compose.onNodeWithText("COMMUNITY ACTIVITY").fetchSemanticsNode()
        compose.onNodeWithTag("focus-closest_battle").fetchSemanticsNode()
        compose.onNodeWithText("NEEDS ACTION").performScrollTo().fetchSemanticsNode()
        compose.onNodeWithTag("activity-primary-track.mario_kart_stadium-150")
            .performScrollTo().fetchSemanticsNode()
        // One delta format across the product: a true minus, seconds and
        // thousandths, never the old fixed `-0:00.500`.
        compose.onNodeWithText("−0.500", useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText("Rival passed you", substring = true).fetchSemanticsNode()
        compose.onNodeWithTag("activity-compare-track.mario_kart_stadium-150").performClick()
        compose.onNodeWithTag("activity-detail-dialog").fetchSemanticsNode()
        // The lap table names its coins and mushrooms by their pictures; each part is its name,
        // then its picture (owner 2026-09-29).
        compose.onAllNodesWithContentDescription("Mushrooms").onFirst().fetchSemanticsNode()
        compose.onAllNodesWithTag("run-part-lines").onFirst().fetchSemanticsNode()
        compose.onAllNodesWithText("Yoshi", substring = true).onFirst().fetchSemanticsNode()
        compose.onNodeWithText("Close").performClick()
        val screenshot = compose.onNodeWithTag("community-activity").captureToImage().asAndroidBitmap()
        val screenshotFile = InstrumentationRegistry.getInstrumentation().targetContext
            .getExternalFilesDir(null)!!.resolve("community-feed-390.png")
        FileOutputStream(screenshotFile).use {
            screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand(
                "cp ${screenshotFile.absolutePath} /sdcard/Download/mk8dx-community-feed-390.png",
            ).close()
        compose.onNodeWithTag("activity-row-track.toad_harbour-150")
            .performScrollTo().fetchSemanticsNode()
        compose.onNodeWithTag("activity-rank-track.toad_harbour-150", useUnmergedTree = true)
            .fetchSemanticsNode()
        compose.onNodeWithTag("activity-metrics-track.toad_harbour-150", useUnmergedTree = true)
            .fetchSemanticsNode()
        compose.onNodeWithText("#3", useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithTag("activity-race-track.mario_kart_stadium-150").performClick()
        // The engine-class filter is a radio group; choosing 200cc selects it
        // and leaves "All cc" unselected, which is what a screen reader hears.
        compose.onNode(
            hasText("200cc") and hasAnyAncestor(hasTestTag("activity-filter-mode")),
        ).performScrollTo().performClick()
        compose.onNode(
            hasText("200cc") and hasAnyAncestor(hasTestTag("activity-filter-mode")),
        ).assertIsSelected()
        compose.onNode(
            hasText("All cc") and hasAnyAncestor(hasTestTag("activity-filter-mode")),
        ).assertIsNotSelected()
        val densityScreenshot = compose.onNodeWithTag("community-activity").captureToImage().asAndroidBitmap()
        val densityFile = InstrumentationRegistry.getInstrumentation().targetContext
            .getExternalFilesDir(null)!!.resolve("community-feed-density-390.png")
        FileOutputStream(densityFile).use {
            densityScreenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand(
                "cp ${densityFile.absolutePath} /sdcard/Download/mk8dx-community-feed-density-390.png",
            ).close()
    }

    /**
     * The Journey's engine control (§7, R1). With a preference that names one
     * engine, the other is *named as hidden* rather than drawn as zero, and the
     * local override reveals it without writing anything.
     */
    @Test
    fun aHiddenEngineIsNamedAndCanBeRevealedLocally() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(390.dp)) {
                    AndroidHomeExperience(
                        singleEngineSource, "player.ben", {},
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                    )
                }
            }
        }

        compose.waitUntil(5_000) {
            runCatching {
                compose.onNodeWithTag("time-trial-journey").fetchSemanticsNode()
            }.isSuccess
        }
        compose.onNodeWithText("200cc is hidden by your Time Trial preference.", substring = true)
            .performScrollTo().fetchSemanticsNode()
        compose.onNodeWithTag("journey-show-hidden-engine").performScrollTo().performClick()
        compose.onNodeWithTag("journey-mode-selector").performScrollTo().fetchSemanticsNode()
        compose.onNode(
            hasText("200cc") and hasAnyAncestor(hasTestTag("journey-mode-selector")),
        ).assertIsSelected()
    }

    @Test
    fun accountOwnerCanWithdrawAResultUploadedUnderTheWrongTrack() {
        val submissionId = "user_submission.time.RESULT01"
        var managed = AndroidManagedTimeTrial(
            submissionId = submissionId,
            playerId = "player.ben",
            playerUsername = "ben",
            playerDisplayName = "Ben",
            retirementState = "active",
            publicationStatus = "published",
            publicationReason = "accepted",
            current = AndroidManagedTimeTrialRevision(
                1, 150, "track.mario_kart_stadium", 92_000,
                sourceKind = "android_scan", createdAtMs = 1_900_000_000_000,
            ),
        )
        val managementSource = object : AndroidTimeTrialsEcosystemDataSource {
            override fun home() = AndroidHomeBootstrap("mk8dx.home-bootstrap.v1", true)
            override fun leaderboard(trackId: String, mode: Int) = emptyList<AndroidPublicTimeTrialResult>()
            override fun playerResults(playerId: String) = listOf(
                AndroidPublicTimeTrialResult(
                    submissionId, "player.ben", "ben", "Ben",
                    "track.mario_kart_stadium", 150, 92_000,
                    sourceKind = "android_scan",
                ),
            )
            override fun managedTimeTrials() = listOf(managed)
            override fun playerProfile(playerId: String) =
                AndroidProfilePlayer("player.ben", AndroidUsername("ben"), "Ben")
            override fun recordBook() = AndroidRecordBook("mk8dx.public-record-book.v1", emptyList())
            override fun retireTimeTrial(submissionId: String, reasonCode: String): AndroidManagedTimeTrial {
                assertEquals("wrong_track_or_mode", reasonCode)
                managed = managed.copy(retirementState = "retired", publicationStatus = "withheld")
                return managed
            }
        }

        compose.setContent {
            MaterialTheme {
                AndroidProfileRecordsScreen(managementSource, "player.ben", {}, "https://example.test")
            }
        }

        // Withdraw sits behind Edit and is confirmed by sliding the handle all the way (2026-09-29).
        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithTag("fix-result-$submissionId").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithTag("fix-result-$submissionId").performScrollTo().performClick()
        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithTag("post-time-manage-withdraw").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithTag("post-time-manage-withdraw").performScrollTo().performClick()
        compose.onNodeWithText("Withdraw this result?").fetchSemanticsNode()
        // A short drag is not a confirmation.
        compose.onNodeWithTag("post-time-withdraw-swipe-handle").performTouchInput {
            swipe(center, androidx.compose.ui.geometry.Offset(center.x + 40f, center.y), 300)
        }
        compose.waitForIdle()
        assertEquals("active", managed.retirementState)
        compose.onNodeWithTag("post-time-withdraw-swipe-handle").performTouchInput {
            swipe(center, androidx.compose.ui.geometry.Offset(center.x + 3_000f, center.y), 400)
        }
        compose.waitUntil(5_000) {
            managed.retirementState == "retired"
        }
        assertEquals("withheld", managed.publicationStatus)
    }

    @Test
    fun compactHomeKeepsFocusFiltersOnSingleLines() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(328.dp)) {
                    AndroidHomeExperience(
                        source, "player.ben", {},
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                    )
                }
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithTag("focus-scope").fetchSemanticsNode() }.isSuccess
        }
        for (label in listOf("Rivals", "Global")) {
            compose
                .onNode(hasText(label) and hasAnyAncestor(hasTestTag("focus-scope")))
                .performScrollTo()
            // The label itself, not its 44 dp target: a word that fits on one
            // line is wider than it is tall, and one that wrapped is not.
            val bounds = compose
                .onNode(
                    hasText(label) and hasAnyAncestor(hasTestTag("focus-scope")),
                    useUnmergedTree = true,
                )
                .fetchSemanticsNode()
                .boundsInRoot
            check(bounds.width > bounds.height) {
                "$label wrapped in the compact Home focus controls: $bounds"
            }
        }
        // The scope is a radio group, so which one is chosen is announced and
        // not only painted.
        compose.onNode(
            hasText("Global") and hasAnyAncestor(hasTestTag("focus-scope")),
        ).performScrollTo().performClick().assertIsSelected()
    }

    /**
     * A02's board on the design system (Phase 9). The assertions that pinned
     * the old presentation — the 🏆/🥈 markers, the amber "you" row and the
     * five-step delta ramp with its `-0.500` — are replaced by the same
     * journeys through the migrated board: rank numerals in their measured
     * column, your own row marked as yours in words as well as in colour, the
     * system's one delta format, and both references marked WR/NG instead of a rank.
     */
    @Test
    fun trackContextShowsOwnCommunityAndBothReferences() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidTrackContext(
                    "track.mario_kart_stadium", 150, "player.ben", source,
                    Modifier.verticalScroll(rememberScrollState()),
                )
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("World Record", substring = true).fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("Ben").fetchSemanticsNode()
        compose.onNodeWithText("Rival").fetchSemanticsNode()
        compose.onNodeWithText("#1").fetchSemanticsNode()
        compose.onNodeWithText("#2").fetchSemanticsNode()
        compose.onNodeWithText("🏆").assertDoesNotExist()
        compose.onNodeWithText("YOU").fetchSemanticsNode()
        compose.onNodeWithContentDescription("nl").fetchSemanticsNode()
        compose.onNodeWithText("−0.500", substring = true).fetchSemanticsNode()
        // Both references: the World Record and the Nintendo staff ghost. Their WR/NG mark says they
        // hold no rank; no line under the name repeats it (owner 2026-09-28).
        compose.onNodeWithText("WR").fetchSemanticsNode()
        compose.onAllNodesWithText("no rank", substring = true).assertCountEquals(0)
        compose.onNodeWithText("Nin★", substring = true).performScrollTo().fetchSemanticsNode()
    }

    @Test
    fun compactTrackContextKeepsMillisecondTimesInTheirColumn() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                Box(Modifier.width(328.dp)) {
                    AndroidTrackContext(
                        "track.mario_kart_stadium", 150, "player.ben", source,
                        Modifier.verticalScroll(rememberScrollState()),
                    )
                }
            }
        }

        compose.waitUntil(5_000) {
            // Twice on purpose: your PB in the summary strip, and your own row.
            compose.onAllNodesWithText("1:32.000").fetchSemanticsNodes().size == 2
        }
        // The texts themselves: a row with Details is one tappable node that merges them.
        val player = compose.onNodeWithText("Ben", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val time = compose.onAllNodesWithText("1:32.000", useUnmergedTree = true).onLast().fetchSemanticsNode().boundsInRoot
        val rank = compose.onNodeWithText("#2", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        check(time.width > time.height * 2.4f) { "Track time wrapped at phone width: $time" }
        check(player.right <= time.left) { "Player name collided with the time column: $player / $time" }
        check(rank.right <= player.left) { "Rank column collided with the name: $rank / $player" }
    }

    @Test
    fun signedOutTrackContextDoesNotInventAPersonalReference() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidTrackContext(
                    "track.mario_kart_stadium", 150, null, source,
                    Modifier.verticalScroll(rememberScrollState()),
                )
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("Sign in to compare these times with your PB.").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("Community and official references").fetchSemanticsNode()
    }

    @Test
    fun globalStandingHeadingUsesNormalLinesOnPhoneWidth() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, {})
            }
        }

        compose.waitUntil(5_000) {
            runCatching {
                compose.onNodeWithText("GLOBAL TIME TRIAL STANDING")
                    .fetchSemanticsNode()
            }.isSuccess
        }
        val bounds = compose.onNodeWithText("GLOBAL TIME TRIAL STANDING")
            .fetchSemanticsNode().boundsInRoot
        check(bounds.width > bounds.height * 3) {
            "Global standing heading collapsed into a narrow text column: $bounds"
        }
        compose.onNodeWithTag("rank-tab-mastery").performClick()
        compose.onNodeWithText("MASTERY DISTRIBUTION").fetchSemanticsNode()
        compose.onNodeWithText("Adv B").fetchSemanticsNode()
        compose.onNodeWithTag("rank-mastery-help").performClick()
        compose.onNodeWithTag("rank-mastery-help-dialog").fetchSemanticsNode()
        compose.onNodeWithText("Tier limit = current WR × (1 + tier offset)")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithTag("rank-tab-total").performClick()
        // Phase 6 (A04): the four control panels became one summary line and a
        // filter sheet, so the scope chips are reached through it.
        compose.onNodeWithText("Filters").performClick()
        compose.onNodeWithTag("rank-scope-rivals").performClick()
        compose.onNodeWithTag("rank-scope-rivals").assertIsSelected()
        compose.onNodeWithTag("rank-filters-close").performClick()
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("rank-filter-summary").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("GLOBAL TIME TRIAL STANDING").fetchSemanticsNode()
        compose.onNodeWithText("TOTAL TIME & DELTA").fetchSemanticsNode()
    }

    @Test
    fun signedOutRankShowsPublicCommunityAndReferencePlayers() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, null, {}, {})
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("PUBLIC RANK").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("Filters").performClick()
        compose.onNodeWithText("Global").fetchSemanticsNode()
        compose.onNodeWithTag("rank-reference-nintendo_staff").fetchSemanticsNode()
        compose.onNodeWithTag("rank-reference-world_record").fetchSemanticsNode()
    }

    @Test
    fun signedInReferencesOpenTheWebStyleDeltaTable() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, {})
            }
        }

        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("GLOBAL TIME TRIAL STANDING").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("Filters").performClick()
        compose.onNodeWithTag("rank-reference-nintendo_staff").performScrollTo().performClick()
        compose.onNodeWithTag("rank-reference-nintendo_staff").assertIsSelected()
        compose.onNodeWithTag("rank-reference-world_record").performScrollTo().performClick()
        compose.onNodeWithTag("rank-reference-world_record").assertIsSelected()
        compose.onNodeWithTag("rank-filters-close").performClick()
        compose.onNodeWithTag("rank-tab-tracks").performScrollTo().performClick()
        compose.onNodeWithTag("rank-tab-tracks").assertIsSelected()
        compose.onNodeWithTag("rank-track-table", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rank-track-name-track.mario_kart_stadium", useUnmergedTree = true)
            .assertExists()
        compose.onAllNodesWithText("Mushroom Cup", useUnmergedTree = true).assertCountEquals(0)
        compose.onNodeWithText("PER-TRACK COMPARISON", substring = true).performScrollTo()
        compose.onNodeWithTag("rank-track-player-player.ben", useUnmergedTree = true).fetchSemanticsNode()
        val nintendo = compose.onNodeWithTag(
            "rank-track-player-reference.nintendo_staff",
            useUnmergedTree = true,
        )
            .fetchSemanticsNode().boundsInRoot
        check(nintendo.width > nintendo.height) {
            "Nintendo Ghost header was cut into an unreadable narrow column: $nintendo"
        }
    }


    /**
     * Phase 6 (A04). The view switch is a real tab group, so a screen reader
     * says which view Ranking is on.
     */
    @Test
    fun rankingViewTabsAreAnnouncedWithExactlyOneSelected() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, {})
            }
        }
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("rank-tab-total").fetchSemanticsNode() }.isSuccess
        }
        val tab = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        compose.onNodeWithTag("rank-tab-total").assert(tab).assertIsSelected()
        compose.onNodeWithTag("rank-tab-medals").assert(tab).assertIsNotSelected()
        compose.onNodeWithTag("rank-tab-mastery").assert(tab).assertIsNotSelected()
        compose.onNodeWithTag("rank-tab-tracks").assert(tab).assertIsNotSelected()
        compose.onNodeWithTag("rank-section-time_trials").assert(tab).assertIsSelected()
        compose.onNodeWithTag("rank-section-tournament").assert(tab).assertIsNotSelected()
    }

    /**
     * The engine is data: switching 150 → 200 replaces what the table below is
     * about, rather than repainting the same rows in another colour
     * (ENGINE_CONTEXT_INVENTORY §4.3, T-ENG-RANK).
     */
    @Test
    fun switchingEngineReplacesTheTracksBelowIt() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, {})
            }
        }
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("rank-tab-tracks").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithTag("rank-tab-tracks").performScrollTo().performClick()
        compose.waitUntil(5_000) {
            runCatching {
                compose.onNodeWithTag("rank-open-track-track.mario_kart_stadium", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isSuccess
        }
        // 150cc: the track Ben has a 150cc best on. 200cc: the other one.
        compose.onNodeWithTag("rank-engine-selector", useUnmergedTree = true).assertExists()
        compose.onNode(
            hasText("200cc").and(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton)),
        ).performScrollTo().performClick()
        compose.waitUntil(5_000) {
            runCatching {
                compose.onNodeWithTag("rank-open-track-track.big_blue", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isSuccess
        }
        check(
            runCatching {
                compose.onNodeWithTag("rank-open-track-track.mario_kart_stadium", useUnmergedTree = true)
                    .fetchSemanticsNode()
            }.isFailure,
        ) { "the 150cc track survived a switch to 200cc" }
    }

    /**
     * The filter sheet holds every control the four stacked panels held, and
     * closing it leaves the screen on the same view.
     */
    @Test
    fun theFilterSheetHoldsEveryControlAndCloses() {
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, {})
            }
        }
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("rank-filter-summary").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithText("Filters").performClick()
        for (tag in listOf(
            "rank-scope-global", "rank-scope-rivals", "rank-scope-groups",
            "rank-track-scope-base", "rank-track-scope-bcp", "rank-track-scope-all",
            "rank-reference-nintendo_staff", "rank-reference-world_record",
            "rank-player-search", "rank-reset-filters",
        )) {
            compose.onNodeWithTag(tag).performScrollTo().assertExists()
        }
        compose.onNodeWithTag("rank-track-scope-base").performScrollTo().performClick()
        compose.onNodeWithTag("rank-track-scope-base").assertIsSelected()
        compose.onNodeWithTag("rank-filters-close").performScrollTo().performClick()
        compose.waitForIdle()
        // The summary states what the sheet was used for, and the view is
        // exactly where it was left.
        compose.onNodeWithText("Tracks: Base 48", substring = true).assertExists()
        compose.onNodeWithTag("rank-tab-total").assertIsSelected()
    }

    @Test
    fun deltaTrackArtworkOpensThatTrackInSubmit() {
        var openedTrackId: String? = null
        compose.setContent {
            Mk8dxDesignTheme(Mk8dxAppearance.Dark) {
                AndroidRankScreen(source, "player.ben", {}, { openedTrackId = it })
            }
        }

        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("rank-tab-tracks").fetchSemanticsNode() }.isSuccess
        }
        compose.onNodeWithTag("rank-tab-tracks").performScrollTo().performClick()
        compose.onNodeWithTag("rank-open-track-track.mario_kart_stadium", useUnmergedTree = true)
            .performScrollTo().performClick()
        compose.runOnIdle { assertEquals("track.mario_kart_stadium", openedTrackId) }
    }
}
