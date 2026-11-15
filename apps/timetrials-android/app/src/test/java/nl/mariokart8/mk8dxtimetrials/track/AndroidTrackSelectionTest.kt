package nl.mariokart8.mk8dxtimetrials.track

import org.junit.Assert.assertEquals
import org.junit.Test
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage

class AndroidTrackSelectionTest {
    private val tracks = listOf(
        AndroidTrackCatalogEntry("track.mario_kart_stadium", 0, "Mario Kart Stadium", 3),
        AndroidTrackCatalogEntry("track.gcn_baby_park", 1, "GCN Baby Park", 7),
        AndroidTrackCatalogEntry("track.water_park", 2, "Water Park", 3),
    )

    @Test
    fun filteringIsStableCaseInsensitiveAndMatchesNameOrCanonicalId() {
        assertEquals(tracks, filterAndroidTrackCatalog(tracks, ""))
        assertEquals(listOf(tracks[1]), filterAndroidTrackCatalog(tracks, "baby"))
        assertEquals(listOf(tracks[0]), filterAndroidTrackCatalog(tracks, "MARIO KART"))
        assertEquals(listOf(tracks[0]), filterAndroidTrackCatalog(tracks, "stadion"))
        assertEquals(
            listOf(tracks[1]),
            filterAndroidTrackCatalog(tracks, "track.gcn_baby_park"),
        )
        assertEquals(emptyList<AndroidTrackCatalogEntry>(), filterAndroidTrackCatalog(tracks, "x"))
    }

    @Test
    fun searchInputDropsControlsAndStopsAtSixtyFourUnicodeCodePoints() {
        val value = "\u0000" + "😀".repeat(63) + "A\nB"

        assertEquals("😀".repeat(63) + "A", boundedAndroidTrackSearchInput(value))
    }

    @Test
    fun cupSelectionUsesTheShortLocalizedCupName() {
        assertEquals("Mushroom", cupSelectionLabel("Mushroom Cup", AndroidProductLanguage.ENGLISH))
        assertEquals("Paddenstoel", cupSelectionLabel("Mushroom Cup", AndroidProductLanguage.DUTCH))
    }

    @Test
    fun cupSelectionFollowsTheAppLanguageNotTheDutchTable() {
        // A2 walkthrough: an English (US) app showed "Paddenstoel", "Bloemen", ... on Post a time.
        assertEquals("Mushroom", cupSelectionLabel("Mushroom Cup", AndroidProductLanguage.ENGLISH_US))
        AndroidProductCatalog.install { path ->
            if (path == "i18n/de.json") {
                """{"schemaVersion":"mk8dx.web-message-catalog.v1","language":"de","messages":{},""" +
                    """"gameNames":{"Mushroom Cup":"Pilz-Cup"}}"""
            } else {
                null
            }
        }
        try {
            assertEquals("Pilz-Cup", cupSelectionLabel("Mushroom Cup", AndroidProductLanguage.GERMAN))
            // A language without a catalog entry falls back to English, never to Dutch.
            assertEquals("Mushroom Cup", cupSelectionLabel("Mushroom Cup", AndroidProductLanguage.FRENCH))
        } finally {
            AndroidProductCatalog.install { null }
        }
    }
}
