package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class Schema9ScanLegacyAssetResolverTest {
    @Test
    fun pinsTheCanonicalSchema9DatabaseAndExpectedScanInventories() {
        assertEquals(
            "2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0",
            Schema9ScanLegacyAssetResolver.SOURCE_DATABASE_SHA256,
        )
        assertEquals(22, Schema9ScanLegacyAssetResolver.TIRE_COUNT)
        assertEquals(110, Schema9ScanLegacyAssetResolver.COUNTRY_COUNT)
    }

    @Test
    fun resolvesSourceObservedTireAndCountryIndices() {
        assertEquals("tire.normal", Schema9ScanLegacyAssetResolver.resolveTire(0))
        assertEquals("tire.azure_roller", Schema9ScanLegacyAssetResolver.resolveTire(13))
        assertEquals("tire.leaf_tyres", Schema9ScanLegacyAssetResolver.resolveTire(21))
        // flags carry the schema-9 country index (ADR-0214)
        assertEquals("country.al", Schema9ScanLegacyAssetResolver.resolveCountry(1))
        assertEquals("country.nl", Schema9ScanLegacyAssetResolver.resolveCountry(155))
        assertEquals("country.zw", Schema9ScanLegacyAssetResolver.resolveCountry(247))
    }

    @Test
    fun rejectsOutOfRangeTiresAndCountriesWithoutMk8FlagAssets() {
        assertNull(Schema9ScanLegacyAssetResolver.resolveTire(-1))
        assertNull(Schema9ScanLegacyAssetResolver.resolveTire(22))
        assertNull(Schema9ScanLegacyAssetResolver.resolveCountry(-1))
        assertNull(Schema9ScanLegacyAssetResolver.resolveCountry(0))   // Afghanistan: no MK8 flag
        assertNull(Schema9ScanLegacyAssetResolver.resolveCountry(248)) // Åland: no MK8 flag
        assertNull(Schema9ScanLegacyAssetResolver.resolveCountry(249))
        assertNull(Schema9ScanLegacyAssetResolver.resolveCountry(250))
    }
}
