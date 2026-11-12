package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Home's hero is the product's one personal HIGH surface, so it is allowed a
 * backdrop (DESIGN_SYSTEM §5, §16). Which track that is, is derived here: the
 * one this Player drove most recently, else the first track their focus names,
 * and Mario Kart Stadium when the bootstrap carries neither. The art itself always
 * comes from the canonical catalogue — this returns its index, never a path.
 */
class AndroidHomeHeroTest {
    private val player = AndroidHomePlayer("player.ben", "Ben")

    private fun bootstrap(
        stories: List<AndroidActivityStory> = emptyList(),
        focusTrackId: String? = null,
    ) = AndroidHomeBootstrap(
        schemaVersion = "mk8dx.home-bootstrap.v1",
        authenticated = true,
        comeback = AndroidHomeComeback(
            "mk8dx.home-comeback.v1",
            player,
            AndroidTimeTrialStanding(3, 8, 1_000_000),
            emptyList(),
        ),
        focus = focusTrackId?.let {
            AndroidHomeFocusDocument(
                "mk8dx.home-focus.v1",
                listOf(AndroidFocusRow(it, 150, 92_000, 3, 12, 90_000)),
            )
        },
        stories = AndroidActivityStoriesDocument("mk8dx.activity-stories.v1", stories),
    )

    private fun story(playerId: String, trackId: String, atMs: Long) = AndroidActivityStory(
        AndroidActivityPlayer(playerId, playerId),
        trackId, 150, 1, 92_000, 92_000,
        personalBest = false,
        latestAtMs = atMs,
    )

    @Test
    fun theBackdropIsTheTrackThisPlayerDroveMostRecently() {
        val home = bootstrap(
            stories = listOf(
                story("player.ben", "track.toad_harbour", 2_000),
                story("player.ben", "track.big_blue", 9_000),
                story("player.rival", "track.mario_kart_stadium", 10_000),
            ),
            focusTrackId = "track.mario_kart_stadium",
        )
        assertEquals(
            Schema9AndroidTrackCatalog.find("track.big_blue")?.index,
            androidHomeBackdropTrackIndex(home, "player.ben"),
        )
    }

    @Test
    fun withoutOwnActivityTheFocusTrackIsUsed() {
        val home = bootstrap(
            stories = listOf(story("player.rival", "track.big_blue", 10_000)),
            focusTrackId = "track.toad_harbour",
        )
        assertEquals(
            Schema9AndroidTrackCatalog.find("track.toad_harbour")?.index,
            androidHomeBackdropTrackIndex(home, "player.ben"),
        )
    }

    @Test
    fun withNeitherStadiumIsTheIntroductoryBackdrop() {
        assertEquals(
            Schema9AndroidTrackCatalog.find("track.mario_kart_stadium")?.index,
            androidHomeBackdropTrackIndex(bootstrap(), "player.ben"),
        )
    }

    @Test
    fun anUnknownTrackNeverBecomesArt() {
        val home = bootstrap(
            stories = listOf(story("player.ben", "track.not_a_real_track", 10_000)),
        )
        assertNull(androidHomeBackdropTrackIndex(home, "player.ben"))
    }

    @Test
    fun theMasteryLadderLabelIsSpelledOutForTheHero() {
        assertEquals("Advanced B", androidMasteryLongLabel("Adv B"))
        assertEquals("Mythic", androidMasteryLongLabel("Myth"))
        assertEquals("Titan", androidMasteryLongLabel("Titan"))
    }

    @Test
    fun noTournamentTierBeforeAFirstRatedRace() {
        assertNull(homeHeroTournamentTier(AndroidTournamentStanding(rank = 1, of = 2, score = 0.0, played = false)))
        assertEquals(androidTournamentTierByRank(1), homeHeroTournamentTier(AndroidTournamentStanding(1, 2, 0.0, played = true)))
        // An older server sends no flag: the tier stays as before.
        assertEquals(androidTournamentTierByRank(1), homeHeroTournamentTier(AndroidTournamentStanding(1, 2, 0.0)))
        assertNull(homeHeroTournamentTier(null))
    }

    @Test
    fun thePlayedFlagIsReadFromTheComebackDocument() {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; explicitNulls = false }
        assertEquals(false, json.decodeFromString<AndroidTournamentStanding>(
            """{"rank":1,"of":2,"score":0,"played":false}""").played)
        assertNull(json.decodeFromString<AndroidTournamentStanding>("""{"rank":1,"of":2,"score":0}""").played)
    }
}
