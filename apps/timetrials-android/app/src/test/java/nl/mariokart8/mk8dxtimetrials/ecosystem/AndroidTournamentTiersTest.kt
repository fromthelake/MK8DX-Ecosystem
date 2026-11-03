package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.io.File
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The all-time ranking badge: eleven bands of twelve, the same as the web's
 * `tournament-tiers.ts` (`apps/timetrials-web/test/home-focus.test.ts`).
 */
class AndroidTournamentTiersTest {
    @After
    fun clearCatalogs() {
        AndroidProductCatalog.install { null }
    }

    @Test
    fun `ranks map to eleven bands of twelve and nothing above 132`() {
        assertEquals("champion", androidTournamentTierByRank(1)?.key)
        assertEquals("feest", androidTournamentTierByRank(60)?.key)
        val mushroom = androidTournamentTierByRank(61)
        assertEquals("Mushroom", mushroom?.name)
        assertEquals("Paddenstoel", mushroom?.dutchName)
        assertEquals("squid", androidTournamentTierByRank(84)?.key)
        assertEquals("shield", androidTournamentTierByRank(85)?.key)
        assertEquals("cloud", androidTournamentTierByRank(108)?.key)
        assertEquals("tourist", androidTournamentTierByRank(109)?.key)
        val coin = androidTournamentTierByRank(132)
        assertEquals("Coin", coin?.name)
        assertEquals("Munt", coin?.dutchName)
        assertNull(androidTournamentTierByRank(133))
        assertNull(androidTournamentTierByRank(0))
        assertEquals(11, ANDROID_TOURNAMENT_TIERS.size)
        ANDROID_TOURNAMENT_TIERS.forEachIndexed { index, tier ->
            assertEquals(index * 12 + 1, tier.minRank)
            assertEquals(index * 12 + 12, tier.maxRank)
        }
    }

    @Test
    fun `a band is named in the reader's language`() {
        val mushroom = requireNotNull(androidTournamentTierByRank(61))
        val coin = requireNotNull(androidTournamentTierByRank(132))
        assertEquals("Mushroom", androidTournamentTierLabel(mushroom.key, AndroidProductLanguage.ENGLISH))
        assertEquals("Paddenstoel", androidTournamentTierLabel(mushroom.key, AndroidProductLanguage.DUTCH))
        assertEquals("Munt", androidTournamentTierLabel(coin.key, AndroidProductLanguage.DUTCH))
        assertEquals("KAMPIOEN", androidTournamentTierBadge(ANDROID_TOURNAMENT_TIERS.first(), AndroidProductLanguage.DUTCH))
        assertEquals("COIN", androidTournamentTierBadge(coin, AndroidProductLanguage.ENGLISH))
        assertNull(androidTournamentTierLabel("new", AndroidProductLanguage.ENGLISH))
    }

    @Test
    fun `every band has a translation in the shipped catalogs`() {
        // The app's own catalogs, as they ship in its assets.
        val assets = File("src/main/assets")
        AndroidProductCatalog.install { path -> File(assets, path).takeIf { it.isFile }?.readText(Charsets.UTF_8) }
        assertEquals("Pilz", androidTournamentTierLabel("mushroom", AndroidProductLanguage.GERMAN))
        assertEquals("Moneda", androidTournamentTierLabel("coin", AndroidProductLanguage.SPANISH_LATIN_AMERICA))
        for (language in AndroidProductLanguage.entries.filter { it.usesCatalog && it != AndroidProductLanguage.ENGLISH_US }) {
            for (tier in ANDROID_TOURNAMENT_TIERS) {
                val label = requireNotNull(androidTournamentTierLabel(tier.key, language))
                assertTrue("${language.code} ${tier.key}", label.isNotBlank())
                if (tier.key in setOf("mushroom", "squid", "shield", "cloud", "coin")) {
                    assertTrue("${language.code} has no own name for ${tier.key}", label != tier.name)
                }
            }
        }
    }
}
