package nl.mariokart8.mk8dxtimetrials.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidDutchPresentationCatalogTest {
    @Test
    fun translatesCanonicalGameNamesAndCountriesWithoutChangingUnknownValues() {
        assertEquals("Paddenstoelbeker", AndroidDutchPresentationCatalog.translate("cup.mushroom_cup"))
        assertEquals("Mario Kart-Stadion", AndroidDutchPresentationCatalog.translate("Mario Kart Stadium"))
        assertEquals("Standaardkart", AndroidDutchPresentationCatalog.translate("Standard Kart"))
        assertEquals("Nederland", AndroidDutchPresentationCatalog.translate("country.nl"))
        assertEquals("BEnZor", AndroidDutchPresentationCatalog.translate("BEnZor"))
    }

    @Test
    fun translatesDynamicUiCopyUsedByTrackAndSettingsScreens() {
        assertEquals("24 bekers · 96 circuits", AndroidDutchUiCopy.translate("24 cups · 96 tracks"))
        assertEquals("3 ronden · Basisspel", AndroidDutchUiCopy.translate("3 laps · Base game"))
        assertEquals("Relevante klassen: alleen 200cc", AndroidDutchUiCopy.translate("Relevant classes: 200cc only"))
        assertEquals("Ronde 2: 0:31.500 · munten 8 · paddenstoelen 1", AndroidDutchUiCopy.translate("Lap 2: 0:31.500 · coins 8 · mushrooms 1"))
        assertEquals("Birdo · Lichtblauw", AndroidDutchUiCopy.translate("Birdo · Light Blue"))
        assertEquals("Meeste eerste plaatsen", AndroidDutchUiCopy.translate("Most leaderboard #1s"))
        assertEquals("Grootste circuitdekking", AndroidDutchUiCopy.translate("Widest track coverage"))
        assertEquals(
            "1. Ben · 57 circuit-klassecombinaties",
            AndroidDutchUiCopy.translate("1. Ben · 57 track·class combos"),
        )
    }

    @Test
    fun translatesFocusAndCommunityActivityWithoutBrokenPlurals() {
        assertEquals("GROOTSTE ACHTERSTAND", AndroidDutchUiCopy.translate("BIGGEST GAP"))
        assertEquals(
            "Valerio staat hier #2 — jij staat #3 van 3.",
            AndroidDutchUiCopy.translate("Valerio is #2 here — you are #3 of 3."),
        )
        assertEquals("1 rit · persoonlijk record", AndroidDutchUiCopy.translate("1 runs · persoonlijk record"))
        assertEquals("2 ritten · persoonlijk record", AndroidDutchUiCopy.translate("2 runs · persoonlijk record"))
        assertEquals("1 rit", AndroidDutchUiCopy.translate("1 run"))
        assertEquals("3 ritten", AndroidDutchUiCopy.translate("3 runs"))
        assertEquals("96 CIRCUITS", AndroidDutchUiCopy.translate("96 TRACKS"))
        assertEquals(
            "Meld je aan om resultaten met je spelersprofiel te synchroniseren. Je kunt de app ook eerst bekijken.",
            AndroidDutchUiCopy.translate("Sign in to sync results to your Player profile. You can explore the app first."),
        )
    }

    @Test
    fun translatesAccountScannerAndGuidedTournamentStates() {
        assertEquals("Plaatsen als ben", AndroidDutchUiCopy.translate("Posting as ben"))
        assertEquals("STAP 2 VAN 10", AndroidDutchUiCopy.translate("STEP 2 OF 10"))
        assertEquals("STAP 2/10 · VOORBEREIDING", AndroidDutchUiCopy.translate("STEP 2/10 · SETUP"))
        assertEquals(
            "2/8 aanwezig · versie 4",
            AndroidDutchUiCopy.translate("2/8 present · revision 4"),
        )
        assertEquals(
            "Laagste herkenningszekerheid 72%",
            AndroidDutchUiCopy.translate("Lowest identity confidence 72%"),
        )
        assertEquals(
            "Aanbevolen op de toernooiavond: Tournament Live",
            AndroidDutchUiCopy.translate("Recommended on race day: Tournament Live"),
        )
        assertEquals(
            "Stap 9 · Binnenkomende uitslagen van Tournament Live / Processor",
            AndroidDutchUiCopy.translate("Step 9 · Tournament Live / Processor incoming results"),
        )
        assertEquals(
            "Er staat nog niets klaar. Verbind Tournament Live met dit toernooi en selecteer voor iedere feed de juiste finalegroep. Verbonden uitslagen verschijnen hier automatisch en tellen pas mee na acceptatie.",
            AndroidDutchUiCopy.translate("Nothing is waiting yet. In Tournament Live connect to this Tournament and select the correct final group for every feed. Connected results appear here automatically and do not count until accepted."),
        )
    }

    @Test
    fun countryPickerContainsOnlyCountriesWithCanonicalMk8FlagAssets() {
        assertEquals(110, AndroidDutchPresentationCatalog.countries.size)
        assertEquals(false, AndroidDutchPresentationCatalog.countries.any { it.id == "country.af" })
        assertEquals(true, AndroidDutchPresentationCatalog.countries.any { it.id == "country.nl" })
    }
}
