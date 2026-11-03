package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The per-track record, which the Web states the same way. Both clients have
 * to agree about what a percentage means, or the same player reads two
 * different answers depending on which one they open.
 */
class AndroidTournamentTrackSectionTest {

    private fun track(
        trackId: String,
        averageFieldShare: Double,
        races: Int = 5,
        wins: Int = 1,
        bestFinish: Int = 1,
        averageFinish: Double = 4.2,
    ) = AndroidTournamentTrack(
        trackId = trackId,
        races = races,
        wins = wins,
        podiums = 2,
        bestFinish = bestFinish,
        worstFinish = 9,
        averageFinish = averageFinish,
        averagePoints = 8.0,
        averageFieldShare = averageFieldShare,
        relativeToOwnAverage = -0.2,
        lastRacedAtMs = 1_774_569_600_000,
    )

    @Test
    fun `first is a hundred percent and last is nothing`() {
        // A field of ten scores the same as a field of twelve: tenth of ten,
        // eleventh of eleven and twelfth of twelve are all a 0% win.
        assertEquals(100, androidWinPercentage(0.0).toLong())
        assertEquals(0, androidWinPercentage(1.0).toLong())
        assertEquals(50, androidWinPercentage(0.5).toLong())
    }

    @Test
    fun `every track in the game is listed, not only the ones raced`() {
        val rows = androidAllTrackRows(listOf(track("track.gcn_baby_park", 0.3)))
        assertEquals(96, rows.size.toLong())
        val raced = rows.filter { it.races > 0 }
        assertEquals(1, raced.size.toLong())
        assertEquals("GCN Baby Park", raced.single().name)
        assertEquals(70, raced.single().winPercentage)
        // The point of the list: which have I never touched?
        assertNull(rows.first { it.trackId != "track.gcn_baby_park" }.winPercentage)
    }

    @Test
    fun `the track column follows the game's own cup order`() {
        val rows = androidAllTrackRows(emptyList())
        val ordered = androidSortTrackRows(rows, AndroidTrackSort.TRACK)
        assertEquals("Mario Kart Stadium", ordered.first().name)
        // Alphabetical would have put 3DS DK Jungle first, which is not where
        // anybody looks for it.
        assertTrue(ordered.first().name != "3DS DK Jungle")
    }

    @Test
    fun `an unraced track never outranks one somebody is bad at`() {
        val rows = androidAllTrackRows(
            listOf(track("track.gcn_baby_park", 0.95, races = 4)),
        )
        for (sort in listOf(AndroidTrackSort.RACES, AndroidTrackSort.WIN)) {
            val ordered = androidSortTrackRows(rows, sort)
            assertEquals(
                "a raced track must lead $sort even when the player is poor at it",
                "GCN Baby Park",
                ordered.first().name,
            )
            assertEquals(0, ordered.last().races.toLong())
        }
    }

    @Test
    fun `a track raced most often leads the races sort`() {
        val rows = androidAllTrackRows(
            listOf(
                track("track.gcn_baby_park", 0.3, races = 4),
                track("track.rainbow_road", 0.1, races = 9),
            ),
        )
        val ordered = androidSortTrackRows(rows, AndroidTrackSort.RACES)
        assertEquals("Rainbow Road", ordered.first().name)
        assertEquals("GCN Baby Park", ordered[1].name)
    }

    private fun varied() = androidAllTrackRows(
        listOf(
            track("track.gcn_baby_park", 0.3, races = 6, wins = 4, bestFinish = 2, averageFinish = 5.5),
            track("track.rainbow_road", 0.5, races = 2, wins = 1, bestFinish = 1, averageFinish = 8.0),
            track("track.dolphin_shoals", 0.4, races = 9, wins = 0, bestFinish = 3, averageFinish = 3.1),
        ),
    )

    @Test
    fun `sorts on races won`() {
        assertEquals(
            listOf("GCN Baby Park", "Rainbow Road", "Dolphin Shoals"),
            androidSortTrackRows(varied(), AndroidTrackSort.WINS).take(3).map { it.name },
        )
    }

    @Test
    fun `the best finish is the small number, so it sorts the other way`() {
        // Ranking a first place below a third would answer the click wrongly.
        assertEquals(
            listOf("Rainbow Road", "GCN Baby Park", "Dolphin Shoals"),
            androidSortTrackRows(varied(), AndroidTrackSort.BEST).take(3).map { it.name },
        )
    }

    @Test
    fun `the average finish sorts lowest first`() {
        assertEquals(
            listOf("Dolphin Shoals", "GCN Baby Park", "Rainbow Road"),
            androidSortTrackRows(varied(), AndroidTrackSort.AVERAGE).take(3).map { it.name },
        )
    }

    @Test
    fun `an unraced track stays last on every new column`() {
        for (sort in listOf(AndroidTrackSort.WINS, AndroidTrackSort.BEST, AndroidTrackSort.AVERAGE)) {
            assertEquals(
                "an unraced track must not outrank a raced one under $sort",
                0,
                androidSortTrackRows(varied(), sort).last().races.toLong(),
            )
        }
    }

    @Test
    fun `both clients offer the same columns`() {
        // The Web table heads are Track, Raced, Won, Best, Average, Win %.
        assertEquals(6, AndroidTrackSort.entries.size.toLong())
    }

    @Test
    fun `below three races a track says nothing about a strength`() {
        val judged = androidJudgedTracks(
            listOf(
                track("track.gcn_baby_park", 0.2, races = ANDROID_MINIMUM_RACES_FOR_A_VERDICT),
                track("track.dolphin_shoals", 0.0, races = 1),
            ),
        )
        // One lucky night is a good night, not a strength.
        assertEquals(1, judged.size.toLong())
        assertEquals("track.gcn_baby_park", judged.single().trackId)
    }
}

/**
 * The three things the ninety-six-track table had on the site and not on the
 * phone: the cup a track belongs to, a typed filter, and the colour a win
 * percentage reads in. The Web's own rules, so the two agree rather than
 * resemble each other.
 */
class AndroidTournamentTrackTableParityTest {

    private fun row(name: String, cup: String, win: Int?) = AndroidTrackRow(
        trackId = "track.$name", trackIndex = 0, name = name,
        races = if (win == null) 0 else 4, wins = 1, winPercentage = win,
        bestFinish = 1, averageFinish = 3.0, cupName = cup,
    )


    private fun racedTrack(
        trackId: String,
        races: Int,
        wins: Int,
        best: Int,
        average: Double,
    ) = AndroidTournamentTrack(
        trackId = trackId,
        races = races,
        wins = wins,
        podiums = 2,
        bestFinish = best,
        worstFinish = 9,
        averageFinish = average,
        averagePoints = 8.0,
        averageFieldShare = 0.4,
        relativeToOwnAverage = -0.2,
        lastRacedAtMs = 1_774_569_600_000,
    )
    /** Three raced tracks among the ninety-six, so a filter has something to keep. */
    private fun varied() = androidAllTrackRows(
        listOf(
            racedTrack("track.gcn_baby_park", races = 6, wins = 4, best = 2, average = 5.5),
            racedTrack("track.rainbow_road", races = 2, wins = 1, best = 1, average = 8.0),
            racedTrack("track.dolphin_shoals", races = 9, wins = 0, best = 3, average = 3.1),
        ),
    )

    @Test
    fun `every track carries the cup it belongs to`() {
        val rows = androidAllTrackRows(emptyList())
        assertEquals(96, rows.size)
        assertTrue(rows.all { it.cupName.isNotBlank() })
        assertEquals("Mushroom Cup", rows.first().cupName)
    }

    @Test
    fun `the filter reads the track name and the cup`() {
        val baby = row("Baby Park", "Crossing Cup", 50)
        assertTrue(androidTrackMatches(baby, ""))
        assertTrue(androidTrackMatches(baby, "baby"))
        assertTrue(androidTrackMatches(baby, "  BABY  "))
        assertTrue(androidTrackMatches(baby, "crossing"))
        assertFalse(androidTrackMatches(baby, "rainbow"))
    }

    @Test
    fun `the win percentage sweeps red through yellow to green`() {
        // One hue sweep, 0 to 120 degrees, as the site does it.
        val low = androidWinPercentageColor(0)
        val mid = androidWinPercentageColor(50)
        val high = androidWinPercentageColor(100)
        assertTrue("0% should be reddest", low.red > low.green)
        assertTrue("100% should be greenest", high.green > high.red)
        // 50% sits between them rather than at either end.
        assertTrue(mid.green > low.green && mid.red > high.red)
        // Out-of-range values are clamped rather than wrapping the hue.
        assertEquals(low, androidWinPercentageColor(-20))
        assertEquals(high, androidWinPercentageColor(140))
    }

    @Test
    fun `a number filter reads its operator, and a bare number means equals`() {
        assertEquals(
            AndroidNumericFilter(">", 3.0),
            androidParseNumericFilter("> 3"),
        )
        assertEquals(
            AndroidNumericFilter("<=", 2.0),
            androidParseNumericFilter("<=2"),
        )
        assertEquals(
            AndroidNumericFilter("<>", 0.0),
            androidParseNumericFilter("!= 0"),
        )
        assertEquals(
            AndroidNumericFilter("=", 1.0),
            androidParseNumericFilter("1"),
        )
        // The site accepts a comma and a trailing per-cent sign.
        assertEquals(
            AndroidNumericFilter(">=", 4.5),
            androidParseNumericFilter(">= 4,5"),
        )
        assertEquals(
            AndroidNumericFilter(">", 50.0),
            androidParseNumericFilter("> 50%"),
        )
        // An unreadable box filters nothing rather than everything.
        assertNull(androidParseNumericFilter(""))
        assertNull(androidParseNumericFilter("three"))
    }

    @Test
    fun `each column filters on its own value`() {
        val rows = varied()
        assertEquals(
            listOf("Dolphin Shoals"),
            androidFilterTrackRows(rows, AndroidTrackFilters(races = "> 8")).map { it.name },
        )
        assertEquals(
            listOf("GCN Baby Park"),
            androidFilterTrackRows(rows, AndroidTrackFilters(wins = ">= 2")).map { it.name },
        )
        // Text columns match on "contains", in either case.
        assertEquals(
            listOf("GCN Baby Park"),
            androidFilterTrackRows(rows, AndroidTrackFilters(track = "baby")).map { it.name },
        )
    }

    @Test
    fun `a track with no value in a column never matches a number filter`() {
        // Filtering on Win % hides the unraced tracks by itself, as on the site.
        val rows = androidAllTrackRows(emptyList())
        assertEquals(
            emptyList<String>(),
            androidFilterTrackRows(rows, AndroidTrackFilters(win = ">= 0")).map { it.name },
        )
    }

    @Test
    fun `a column can be pointed the other way`() {
        val rows = varied()
        val most = androidSortTrackRows(rows, AndroidTrackSort.RACES, descending = true)
        val fewest = androidSortTrackRows(rows, AndroidTrackSort.RACES, descending = false)
        assertEquals(9L, most.first().races.toLong())
        // Reversed, the raced track with the fewest races leads - and a track
        // nobody raced is still last.
        assertEquals(2L, fewest.first().races.toLong())
        assertEquals(0L, fewest.last().races.toLong())
    }

    @Test
    fun `a column opens the way the site opens it`() {
        assertEquals(true, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.RACES])
        assertEquals(true, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.WINS])
        assertEquals(true, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.WIN])
        assertEquals(false, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.BEST])
        assertEquals(false, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.AVERAGE])
        assertEquals(false, ANDROID_SORT_OPENS_DESCENDING[AndroidTrackSort.TRACK])
    }

    @Test
    fun `the table has the site's seven columns, five of them numeric`() {
        assertEquals(7, ANDROID_TRACK_COLUMNS.size)
        assertEquals(
            listOf("Track", "Cup", "Raced", "Won", "Best", "Average", "Win %"),
            ANDROID_TRACK_COLUMNS.map { it.english },
        )
        assertEquals(5, ANDROID_TRACK_COLUMNS.count { it.numeric })
    }
}
