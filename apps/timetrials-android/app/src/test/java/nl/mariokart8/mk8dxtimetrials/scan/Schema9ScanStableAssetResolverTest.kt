package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class Schema9ScanStableAssetResolverTest {
    @Test
    fun pinsCatalogHashAndCompleteInventory() {
        assertEquals(
            "2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0",
            Schema9ScanStableAssetResolver.SOURCE_DATABASE_SHA256,
        )
        assertEquals(414, Schema9ScanStableAssetResolver.ASSET_COUNT)
        assertEquals(54, Schema9ScanStableAssetResolver.CHARACTER_COUNT)
        assertEquals(28, Schema9ScanStableAssetResolver.CHARACTER_VARIANT_COUNT)
        assertEquals(41, Schema9ScanStableAssetResolver.BODY_COUNT)
        assertEquals(227, Schema9ScanStableAssetResolver.BODY_VARIANT_COUNT)
        assertEquals(15, Schema9ScanStableAssetResolver.GLIDER_COUNT)
        assertEquals(49, Schema9ScanStableAssetResolver.GLIDER_VARIANT_COUNT)
    }

    @Test
    fun resolvesBaseAndVariantRecordsWithExactParents() {
        assertEquals(
            ScanStableAssetRecord(ScanStableAssetType.CHARACTER),
            Schema9ScanStableAssetResolver.resolve("character.mario"),
        )
        assertEquals(
            ScanStableAssetRecord(
                ScanStableAssetType.CHARACTER_VARIANT,
                "character.yoshi",
            ),
            Schema9ScanStableAssetResolver.resolve(
                "character_variant.yoshi.018_black",
            ),
        )
        assertEquals(
            ScanStableAssetRecord(
                ScanStableAssetType.BODY_VARIANT,
                "body.bounder",
            ),
            Schema9ScanStableAssetResolver.resolve(
                "body_variant.bounder.000_grey",
            ),
        )
        assertEquals(
            ScanStableAssetRecord(
                ScanStableAssetType.GLIDER_VARIANT,
                "glider.super_glider",
            ),
            Schema9ScanStableAssetResolver.resolve(
                "glider_variant.super_glider.044_yoshi",
            ),
        )
    }

    @Test
    fun excludesOtherCatalogDomainsAndUnknownValues() {
        assertNull(Schema9ScanStableAssetResolver.resolve("track.mario_kart_stadium"))
        assertNull(Schema9ScanStableAssetResolver.resolve("tire.azure_roller"))
        assertNull(Schema9ScanStableAssetResolver.resolve("country.nl"))
        assertNull(Schema9ScanStableAssetResolver.resolve("character.unknown"))
        assertNull(Schema9ScanStableAssetResolver.resolve(""))
    }
}
