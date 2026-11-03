package nl.mariokart8.mk8dxtimetrials.track

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidBenchmarkCatalogTest {
    @Test
    fun everyTrackAndModeHasWorldRecordAndNintendoReferences() {
        Schema9AndroidTrackCatalog.entries.forEach { track ->
            listOf(150, 200).forEach { mode ->
                val references = AndroidBenchmarkCatalog.forTrack(track.id, mode)
                assertEquals("${track.id} ${mode}cc", 2, references.size)
                assertEquals(
                    setOf(AndroidBenchmarkKind.WORLD_RECORD, AndroidBenchmarkKind.NINTENDO_STAFF),
                    references.map { it.kind }.toSet(),
                )
                assertTrue(references.all { it.timeMs > 0 && it.name.isNotBlank() })
                // Both references name the combo that drove the time, as the Web board shows it.
                assertTrue("${track.id} ${mode}cc", references.all { it.loadout?.size == 4 })
            }
        }
    }

    @Test
    fun marioKartStadiumStaffCountriesMatchHistoricalCatalog() {
        val staff150 = AndroidBenchmarkCatalog.forTrack("track.mario_kart_stadium", 150)
            .single { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }
        val staff200 = AndroidBenchmarkCatalog.forTrack("track.mario_kart_stadium", 200)
            .single { it.kind == AndroidBenchmarkKind.NINTENDO_STAFF }

        assertEquals("Nin★Chris", staff150.name)
        assertEquals("country.gb", staff150.countryId)
        assertEquals("country.de", staff200.countryId)
    }
}
