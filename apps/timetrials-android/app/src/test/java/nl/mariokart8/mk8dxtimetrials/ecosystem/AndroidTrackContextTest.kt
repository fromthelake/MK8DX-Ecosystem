package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkCatalog
import nl.mariokart8.mk8dxtimetrials.track.AndroidBenchmarkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class AndroidTrackContextTest {
    @Test
    fun `maps every nation in the current WR snapshot to a canonical flag`() {
        assertEquals("country.au", androidCountryIdForNation("Australia"))
        assertEquals("country.ca", androidCountryIdForNation("Canada"))
        assertEquals("country.co", androidCountryIdForNation("Colombia"))
        assertEquals("country.fr", androidCountryIdForNation("France"))
        assertEquals("country.de", androidCountryIdForNation("Germany"))
        assertEquals("country.jp", androidCountryIdForNation("Japan"))
        assertEquals("country.nl", androidCountryIdForNation("Netherlands"))
        assertEquals("country.no", androidCountryIdForNation("Norway"))
        assertEquals("country.es", androidCountryIdForNation("Spain"))
        assertEquals("country.gb", androidCountryIdForNation("UK"))
        assertEquals("country.us", androidCountryIdForNation("USA"))
        assertNull(androidCountryIdForNation(null))
    }

    @Test
    fun `the Details name the client that recorded a result`() {
        assertEquals("Android", androidSourceLabel("android_scan"))
        assertEquals("Windows", androidSourceLabel("livetrial_capture"))
        assertEquals("Web", androidSourceLabel("web_manual"))
        assertNull(androidSourceLabel("migration_import"))
    }

    @Test
    fun `coins are shown as gained per lap, from the HUD balance at each lap's end`() {
        assertEquals(listOf(8, 1, 1), androidLapCoinGains(listOf(8, 9, 10)))
        // A hit costs coins: the gain can be negative, as the Web shows it.
        assertEquals(listOf(5, -2, 4), androidLapCoinGains(listOf(5, 3, 7)))
        // A lap without a balance leaves that lap and the next one unknown.
        assertEquals(listOf(4, null, null, 2), androidLapCoinGains(listOf(4, null, 6, 8)))
    }

    @Test
    fun `a staff row takes its laps, mushrooms and coins from a ghost reading of exactly its time`() {
        val staff = AndroidBenchmarkCatalog.forTrack("track.3ds_alpine_pass", 150)
            .single { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }
        val reading = AndroidReferenceGhostReading(
            "nintendo_staff", staff.trackId, 150, staff.timeMs,
            listOf(48_000L, 48_000L, staff.timeMs - 96_000L), listOf(5, 3, 2), listOf(1, 1, 1),
        )
        val older = reading.copy(totalTimeMs = staff.timeMs + 1)
        val filled = androidBenchmarkWithReading(staff, listOf(older, reading))
        assertEquals(listOf(5, 3, 2), filled.coinsPerLap)
        assertEquals(listOf(1, 1, 1), filled.mushroomsPerLap)
        assertEquals(3, filled.lapTimesMs?.size)
        // A World Record reading never fills a staff row, and nothing known is replaced.
        assertSame(staff, androidBenchmarkWithReading(staff, listOf(reading.copy(kind = "world_record"))))
        val record = AndroidBenchmarkCatalog.forTrack("track.3ds_alpine_pass", 150)
            .single { it.kind == AndroidBenchmarkKind.WORLD_RECORD }
        val replaced = androidBenchmarkWithReading(
            record, listOf(reading.copy(kind = "world_record", totalTimeMs = record.timeMs, coinsPerLap = listOf(0, 0, 0))),
        )
        assertEquals(record.coinsPerLap, replaced.coinsPerLap)
    }
}
