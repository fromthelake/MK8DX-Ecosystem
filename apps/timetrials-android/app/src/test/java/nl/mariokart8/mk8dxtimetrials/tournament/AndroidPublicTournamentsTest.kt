package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * These pin the rules the phone shares with the site. Both clients have to
 * answer the same way, so each case here has a twin in
 * `apps/timetrials-web/test/tournament-start-clock.test.ts`; change one and
 * change the other.
 */
class AndroidPublicTournamentsTest {
    @Test
    fun theDirectorsSwitchesHideTheIntroTheSummaryAndEveryGroupNoteButNeverAPlayerNote() {
        val story = AndroidTournamentStory(
            edition = 14, title = "TN14", intro = listOf("Een lange avond."), summary = listOf("Kort."),
            groups = listOf(AndroidPublicReportNote("Kampioen", listOf("De kampioenen."))),
            players = listOf(AndroidTournamentStoryPlayer(name = "Ben", paragraphs = listOf("Sterk."))),
        )
        val shown = androidStoryShown(
            story, AndroidPublicReportVisibility(intro = false, summary = true, groupNotes = false),
        )
        assertEquals(emptyList<String>(), shown.intro)
        assertEquals(listOf("Kort."), shown.summary)
        assertEquals(emptyList<AndroidPublicReportNote>(), shown.groups)
        assertEquals(story.players, shown.players)
        // A report published before the switches existed carries none of them and shows everything.
        val older = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
            .decodeFromString<AndroidPublicReportVisibility>("""{"topTracks":true,"benchmark":false,"duel":true,"distribution":true}""")
        assertEquals(story, androidStoryShown(story, older))
    }


    /** 2026-09-11T18:00:00Z, which is Friday 11 September at 20:00 in Amsterdam. */
    private val fridayEight = 1_789_149_600_000L

    /** 2026-09-07T22:00:00Z, which is midnight on the 8th there: a date-only night. */
    private val midnightEighth = 1_788_818_400_000L

    private fun night(
        id: String,
        stage: String,
        updatedAtMs: Long,
        startAtMs: Long? = null,
        workflowStep: Int? = null,
    ) = AndroidPublicTournamentSummary(
        tournamentId = id, name = id, stage = stage,
        updatedAtMs = updatedAtMs, startAtMs = startAtMs, workflowStep = workflowStep,
        timezone = "Europe/Amsterdam",
    )

    @Test
    fun `racing starts at step five, not at the stage`() {
        assertFalse(tournamentIsBeingRaced("qualifiers", 4))
        assertTrue(tournamentIsBeingRaced("qualifiers", 5))
        assertFalse(tournamentIsBeingRaced("finalized", 9))
        // Without a step the stage is the fallback, and it turns one step early.
        assertTrue(tournamentIsBeingRaced("qualifiers", null))
        assertFalse(tournamentIsBeingRaced("setup", null))
    }

    @Test
    fun `a night still to come sits on its own shelf`() {
        val now = 1_788_000_000_000L
        assertEquals(
            AndroidTournamentShelf.SOON,
            tournamentListShelf(night("f", "qualifiers", 1, now + 3_600_000, 4), now),
        )
        assertEquals(
            AndroidTournamentShelf.RUNNING,
            tournamentListShelf(night("t", "qualifiers", 1, now - 3_600_000, 5), now),
        )
        assertEquals(
            AndroidTournamentShelf.DRAFT,
            tournamentListShelf(night("d", "setup", 1, now - 3_600_000, 2), now),
        )
        assertEquals(
            AndroidTournamentShelf.FINISHED,
            tournamentListShelf(night("o", "finalized", 1, now - 90_000_000, null), now),
        )
    }

    @Test
    fun `the two shelves only an administrator is told about`() {
        // The server sends these marks to whoever may see the row at all, and
        // only where they are true. The site reads them the same way.
        val now = 1_788_000_000_000L
        val finished = night("o", "finalized", 1, now - 90_000_000, null)
        assertEquals(AndroidTournamentShelf.FINISHED, tournamentListShelf(finished, now))
        assertEquals(
            AndroidTournamentShelf.UNPUBLISHED,
            tournamentListShelf(finished.copy(published = false), now),
        )
        // Removed beats everything, including a night that is being raced.
        assertEquals(
            AndroidTournamentShelf.REMOVED,
            tournamentListShelf(finished.copy(removed = true), now),
        )
        assertEquals(
            AndroidTournamentShelf.REMOVED,
            tournamentListShelf(night("r", "finals", 1, now - 3_600_000, 8).copy(removed = true), now),
        )
    }

    @Test
    fun `a night nobody closed leaves the shelves about tonight`() {
        // The twin of the site's rule: a day past its start it is late and
        // says so; three days past it, it is not "in progress" by any reading.
        val now = 1_788_000_000_000L
        val day = 86_400_000L
        val racing = night("s", "finals", 1, now - 2 * day, 8)
        assertEquals(AndroidTournamentShelf.RUNNING, tournamentListShelf(racing, now))
        assertEquals(2, tournamentOverdueDays(racing, now))
        val abandoned = night("s", "finals", 1, now - 4 * day, 8)
        assertEquals(AndroidTournamentShelf.STALLED, tournamentListShelf(abandoned, now))
        assertEquals(4, tournamentOverdueDays(abandoned, now))
        // Inside its own day a night is not late at all.
        val tonight = night("t", "finals", 1, now - 3_600_000, 8)
        assertEquals(AndroidTournamentShelf.RUNNING, tournamentListShelf(tonight, now))
        assertNull(tournamentOverdueDays(tonight, now))
        // And a finished night is never late, however old it is.
        assertNull(tournamentOverdueDays(night("o", "finalized", 1, now - 90 * day, null), now))
    }

    @Test
    fun `the card holds a night for a day after it starts`() {
        val start = 1_788_000_000_000L
        val summary = night("n", "setup", 1, start, 2)
        assertFalse(tournamentIsTonight(summary, start - 1_000))
        assertTrue(tournamentIsTonight(summary, start + 1_000))
        // Half past one, five and a half hours in: still the same evening.
        assertTrue(tournamentIsTonight(summary, start + 5_400_000 + 14_400_000))
        assertTrue(tournamentIsTonight(summary, start + NIGHT_WINDOW_MS - 1_000))
        assertFalse(tournamentIsTonight(summary, start + NIGHT_WINDOW_MS + 1_000))
    }

    @Test
    fun `a night being raced comes before one still to come, a stale one after`() {
        val now = 1_788_000_000_000L
        val friday = night("friday", "setup", 900, now + 3 * 86_400_000L, 2)
        val tonight = night("tonight", "qualifiers", 100, now - 3_600_000, 5)
        assertEquals(
            listOf("tonight", "friday"),
            orderViewerNights(listOf(friday, tonight), now).map { it.tournamentId },
        )
        // Left half-scored two days ago: it has had its day.
        val stale = night("stale", "qualifiers", 900, now - 2 * 86_400_000L, 5)
        assertEquals(
            listOf("friday", "stale"),
            orderViewerNights(listOf(stale, friday), now).map { it.tournamentId },
        )
    }

    @Test
    fun `the start is written out in the night's own zone`() {
        assertEquals(
            "Friday 11 September 2026 at 20:00",
            formatTournamentStart(fridayEight, "Europe/Amsterdam", dutch = false),
        )
        assertEquals(
            "Vrijdag 11 september 2026 om 20:00",
            formatTournamentStart(fridayEight, "Europe/Amsterdam", dutch = true),
        )
    }

    @Test
    fun `a night saved without a time of day says only the day`() {
        // "om 00:00" would state an agreement nobody made.
        assertFalse(hasStartTime(midnightEighth, "Europe/Amsterdam"))
        assertTrue(hasStartTime(fridayEight, "Europe/Amsterdam"))
        assertEquals(
            "Tuesday 8 September 2026",
            formatTournamentStart(midnightEighth, "Europe/Amsterdam", dutch = false),
        )
    }

    @Test
    fun `the countdown reads as a clock, with days only when there are any`() {
        assertEquals("00:00:00", formatTimeToStart(0))
        assertEquals("00:00:00", formatTimeToStart(-5_000))
        assertEquals("00:00:33", formatTimeToStart(33_000))
        assertEquals("09:12:33", formatTimeToStart(9 * 3_600_000L + 12 * 60_000L + 33_000L))
        assertEquals(
            "1d 09:12:33",
            formatTimeToStart(86_400_000L + 9 * 3_600_000L + 12 * 60_000L + 33_000L),
        )
    }
}

/** The reader's own answer for a night, mirrored from the Web's viewerStandingIn. */
class AndroidViewerStandingTest {

    private fun seat(name: String, id: String?, seatNumber: Int, owner: String, rank: Int?) =
        AndroidPublicSeat(
            playerId = id, displayName = name, seatOrder = seatNumber - 1,
            stationOwnerPlayerId = "player.ben", stationOwnerDisplayName = owner,
            switchType = "ns1", seatNumber = seatNumber, seedRank = rank,
        )

    private val event = AndroidPublicTournamentEvent(
        tournamentId = "tournament.night", name = "Toernooi 13v2", stage = "qualifiers",
        workflowStep = 5, startAtMs = 1_789_149_600_000L, timezone = "Europe/Amsterdam",
        groups = listOf(
            AndroidPublicGroup(
                groupId = "group.1", stage = "qualifier", sequence = 1, name = "Groep 3",
                seating = listOf(
                    seat("Ben", "player.ben", 1, "Ben", 5),
                    seat("Jory", "player.jory", 2, "Ben", 40),
                    AndroidPublicSeat(
                        playerId = "player.other", displayName = "Elsewhere", seatOrder = 2,
                        stationOwnerDisplayName = "Evan", switchType = "ns2", seatNumber = 1,
                    ),
                ),
                standings = listOf(
                    AndroidPublicStanding(rank = 2, playerId = "player.ben", displayName = "Ben", points = 82, races = 8),
                    AndroidPublicStanding(rank = 1, playerId = "player.jory", displayName = "Jory", points = 90, races = 8),
                ),
                races = List(8) { AndroidPublicRace(it + 1) },
            ),
        ),
    )

    @Test
    fun `it names the group, the console and who is beside you`() {
        val standing = requireNotNull(viewerStandingIn(event, "player.ben"))
        assertEquals("Groep 3", standing.groupName)
        assertEquals("Ben", standing.stationOwnerDisplayName)
        assertEquals(1, standing.seatNumber)
        // Never yourself, and never the other console.
        assertEquals(listOf("Jory"), standing.seatMates.map { it.displayName })
        assertEquals(5, standing.seedRank)
        assertEquals(40, standing.seatMates.first().seedRank)
        assertEquals(82, standing.points)
        assertEquals(2, standing.groupRank)
        // The overall order exists but is not a result until the night is over.
        assertEquals(null, standing.placement)
    }

    @Test
    fun `the Your tournament card names a final group in the reader's language`() {
        val finals = event.copy(
            groups = listOf(
                event.groups.first(),
                AndroidPublicGroup(
                    groupId = "group.final", stage = "final", sequence = 1, name = "Kampioen", tierKey = "champion",
                    seating = listOf(seat("Ben", "player.ben", 1, "Ben", 5)),
                    standings = listOf(
                        AndroidPublicStanding(rank = 1, playerId = "player.ben", displayName = "Ben", points = 15, races = 1),
                    ),
                    races = List(1) { AndroidPublicRace(it + 1) },
                ),
            ),
        )
        val standing = requireNotNull(viewerStandingIn(finals, "player.ben"))
        // The stored name stays the server's; every line on the card shows the tier's own name.
        assertEquals("Kampioen", standing.groupName)
        assertEquals("Champion", viewerGroupLabel(standing, dutch = false))
        assertEquals("Kampioen", viewerGroupLabel(standing, dutch = true))
        assertTrue(viewerSeatLine(standing, dutch = false).startsWith("Champion · "))
        assertTrue(requireNotNull(viewerResultLine(standing, dutch = false)).contains("in Champion"))
        assertTrue(requireNotNull(viewerResultLine(standing, dutch = true)).contains("in Kampioen"))
    }

    @Test
    fun `somebody who is not in a group gets no standing from the document`() {
        assertEquals(null, viewerStandingIn(event, "player.nobody"))
        // ...but a night they are on the list for still has a card to show.
        val onList = viewerStandingOnTheList(event)
        assertEquals("Toernooi 13v2", onList.name)
        assertEquals(null, onList.groupName)
    }

    @Test
    fun `the scoring groups are only named while a step waits for scores`() {
        assertEquals(listOf("Groep 3" to 8), tournamentScoringGroups(event, 5))
        assertEquals(emptyList<Pair<String, Int>>(), tournamentScoringGroups(event, 4))
    }
}

/** The list's own order, which has to match the Web's rule and not merely resemble it. */
class AndroidTournamentListOrderTest {

    private fun night(id: String, stage: String, eventDate: String?, updatedAtMs: Long) =
        AndroidPublicTournamentSummary(
            tournamentId = id, name = id, stage = stage,
            eventDate = eventDate, updatedAtMs = updatedAtMs,
        )

    @Test
    fun `nights still to be raced read soonest first, finished ones newest first`() {
        val ordered = orderTournamentList(
            listOf(
                night("old", "finalized", "2023-05-19", 1),
                night("later", "setup", "2026-09-25", 2),
                night("soon", "setup", "2026-09-11", 3),
                night("recent", "finalized", "2026-03-27", 4),
            ),
        ).map { it.tournamentId }
        assertEquals(listOf("soon", "later", "recent", "old"), ordered)
    }

    @Test
    fun `the event date decides, as it does on the Web`() {
        // Touched last, but its night is further away: it still goes second.
        val ordered = orderTournamentList(
            listOf(
                night("friday", "setup", "2026-09-11", 1),
                night("october", "setup", "2026-10-02", 900),
            ),
        ).map { it.tournamentId }
        assertEquals(listOf("friday", "october"), ordered)
    }
}

/** The picture a public night offers, and which one it opens on. */
class AndroidPublicCheckpointTest {

    private fun seat(name: String, owner: String, switch: String, seatNumber: Int) =
        AndroidPublicSeat(
            playerId = "player.$name", displayName = name, seatOrder = seatNumber - 1,
            stationOwnerDisplayName = owner, switchType = switch, seatNumber = seatNumber,
        )

    private fun group(name: String, seated: Boolean, races: Int) = AndroidPublicGroup(
        groupId = "group.$name", stage = "qualifier", sequence = 1, name = name,
        seating = if (seated) listOf(seat("A", "Ben", "ns1", 1), seat("B", "Ben", "ns1", 2)) else emptyList(),
        standings = listOf(
            AndroidPublicStanding(rank = 1, playerId = "player.A", displayName = "A", races = races),
        ),
        races = List(races) { AndroidPublicRace(it + 1) },
    )

    private fun event(vararg groups: AndroidPublicGroup) = AndroidPublicTournamentEvent(
        tournamentId = "tournament.n", name = "Night", stage = "qualifiers", groups = groups.toList(),
    )

    @Test
    fun `a result needs a race, not merely somebody placed`() {
        val placedOnly = event(group("Groep 1", seated = true, races = 0))
        assertEquals(
            listOf("qualifier-layout"),
            androidPublicCheckpoints(placedOnly).map { it.key },
        )
        val raced = event(group("Groep 1", seated = true, races = 8))
        assertEquals(
            listOf("qualifier-layout", "qualifier-results"),
            androidPublicCheckpoints(raced).map { it.key },
        )
    }

    @Test
    fun `it opens on the newest picture that is actually complete`() {
        // One group of three scored: the result is on offer but is not the
        // night's state, so the layout is what opens.
        val partial = event(
            group("Groep 1", seated = true, races = 0),
            group("Groep 2", seated = true, races = 0).copy(groupId = "group.2", sequence = 2),
            group("Groep 3", seated = true, races = 8).copy(groupId = "group.3", sequence = 3),
        )
        assertEquals("qualifier-layout", androidPublicCurrentCheckpoint(partial)?.key)
        val whole = event(
            group("Groep 1", seated = true, races = 8),
            group("Groep 2", seated = true, races = 8).copy(groupId = "group.2", sequence = 2),
        )
        assertEquals("qualifier-results", androidPublicCurrentCheckpoint(whole)?.key)
    }

    @Test
    fun `the cable numbers count consoles in the order they first appear`() {
        val night = AndroidPublicTournamentEvent(
            tournamentId = "tournament.n", name = "Night", stage = "qualifiers",
            groups = listOf(
                AndroidPublicGroup(
                    groupId = "g1", stage = "qualifier", sequence = 1, name = "Groep 1",
                    // Seat order is the group's own order, so the third
                    // Player sits third even though they are seat #1 on their
                    // own console.
                    seating = listOf(
                        seat("A", "Ben", "ns1", 1),
                        seat("B", "Ben", "ns1", 2),
                        seat("C", "Evan", "ns2", 1).copy(seatOrder = 2),
                    ),
                ),
            ),
        )
        val document = androidExportDocumentFromPublicEvent(night)
        val cables = document.groups.first().members.map { it.station?.utpCableNumber }
        assertEquals(listOf(1, 1, 2), cables)
    }

    @Test
    fun `a group is named the way the site names it`() {
        // The tier's own name, in the reader's language. The site's Dutch
        // labels are the product's own; only three of the five differ.
        assertEquals("Kampioen", androidGroupLabel("Groep 1", "champion", dutch = true))
        assertEquals("Champion", androidGroupLabel("Groep 1", "champion", dutch = false))
        assertEquals("Avontuur", androidGroupLabel("Groep 4", "adventure", dutch = true))
        assertEquals("Adventure", androidGroupLabel("Groep 4", "adventure", dutch = false))
        assertEquals("Feest", androidGroupLabel("Groep 5", "feest", dutch = true))
        assertEquals("Party", androidGroupLabel("Groep 5", "feest", dutch = false))
        assertEquals("Talent", androidGroupLabel("Groep 2", "talent", dutch = false))
        // A generated name is translated; a name the Director wrote is not.
        assertEquals("Group 3", androidGroupLabel("Groep 3", null, dutch = false))
        assertEquals("Groep 3", androidGroupLabel("Groep 3", null, dutch = true))
        assertEquals("Winnaarspoule", androidGroupLabel("Winnaarspoule", null, dutch = false))
        // A stored tier name without a tier key is still the tier.
        assertEquals("Champion", androidGroupLabel("Kampioen", null, dutch = false))
        assertEquals("Party", androidGroupLabel("Feest", null, dutch = false))
        assertEquals("Avontuur", androidGroupLabel("Adventure", null, dutch = true))
    }

    @Test
    fun `a picture shared from a public page keeps every Player's SP rank`() {
        // The picture prints the rank and tints the tile with the band it sits
        // in, and it reads both from the participants. That list was left empty
        // by the conversion, so every row came out "#?" in the grey unknown
        // tile - on the phone only, because the site reads the rank straight
        // off the standing row.
        val night = AndroidPublicTournamentEvent(
            tournamentId = "tournament.n", name = "Night", stage = "finalized",
            groups = listOf(
                AndroidPublicGroup(
                    groupId = "g1", stage = "final", sequence = 1, name = "Kampioen",
                    tierKey = "champion",
                    standings = listOf(
                        AndroidPublicStanding(
                            rank = 1, playerId = "player.ben", displayName = "Ben",
                            points = 300, races = 12, wins = 4, seedRank = 5,
                        ),
                        AndroidPublicStanding(
                            rank = 2, playerId = "player.jory", displayName = "Jory",
                            points = 250, races = 12, wins = 1, seedRank = 40,
                        ),
                        // Somebody who never carried a rank keeps none.
                        AndroidPublicStanding(
                            rank = 3, playerId = "player.new", displayName = "Nieuw",
                            points = 100, races = 12, wins = 0,
                        ),
                    ),
                ),
            ),
        )
        val document = androidExportDocumentFromPublicEvent(night)
        val rankOf = document.participants.associate { it.displayName to it.seedRank }
        assertEquals(5, rankOf["Ben"])
        assertEquals(40, rankOf["Jory"])
        assertEquals(null, rankOf["Nieuw"])
        // And the tile follows the rank: 5 is Champion, 40 is Avontuur.
        assertEquals("champion", tierForRank(rankOf["Ben"]).key)
        assertEquals("adventure", tierForRank(rankOf["Jory"]).key)
        assertEquals("new", tierForRank(rankOf["Nieuw"]).key)
    }
}
