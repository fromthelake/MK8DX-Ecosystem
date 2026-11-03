package nl.mariokart8.mk8dxtimetrials.track

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class Schema9AndroidTrackCatalogTest {
    @Test
    fun exposesCompleteContiguousSchema9TrackOrderAndStableLookup() {
        val tracks = Schema9AndroidTrackCatalog.entries

        assertEquals(96, tracks.size)
        assertEquals((0 until 96).toList(), tracks.map(AndroidTrackCatalogEntry::index))
        assertEquals(96, tracks.map(AndroidTrackCatalogEntry::id).toSet().size)
        assertTrue(tracks.all { it.id.startsWith("track.") })
        assertTrue(tracks.all { it.displayName.isNotBlank() })
        assertTrue(tracks.all { it.lapCount == 3 || it.lapCount == 7 })
        tracks.forEach { track ->
            assertSame(track, Schema9AndroidTrackCatalog.find(track.id))
        }
        assertNull(Schema9AndroidTrackCatalog.find("track.not_in_schema9"))
    }

    @Test
    fun retainsTheOnlySevenLapTrackWithoutInferringFromItsName() {
        val sevenLapTracks = Schema9AndroidTrackCatalog.entries.filter { it.lapCount == 7 }

        assertEquals(1, sevenLapTracks.size)
        assertEquals("track.gcn_baby_park", sevenLapTracks.single().id)
        assertEquals("GCN Baby Park", sevenLapTracks.single().displayName)
    }
}
