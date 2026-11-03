package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutCatalog
import nl.mariokart8.mk8dxtimetrials.builds.AndroidLoadoutVariants
import nl.mariokart8.mk8dxtimetrials.scan.ScanLoadoutV1
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The kart setup shows the scanned colour variant while its base part is the
 * scanned one; the picker itself still offers base parts only (SPEC §7 D8).
 */
class AndroidPostTimePartVisualTest {
    private val yoshi = AndroidLoadoutCatalog.find("character.yoshi")!!
    private val superGlider = AndroidLoadoutCatalog.find("glider.super_glider")!!
    private val loadout = mapOf("characterId" to "character.yoshi", "gliderId" to "glider.super_glider")
    private val yellowScan = ScanLoadoutV1(
        characterId = "character.yoshi",
        characterVariantId = "character_variant.yoshi.020_yellow",
        gliderId = "glider.super_glider",
    )

    @Test
    fun aTypedYoshiShowsTheDefaultColours() {
        assertEquals("Yoshi", androidPostTimePartVisual(yoshi, loadout, null).name)
        assertEquals(
            AndroidLoadoutVariants.byId("glider_variant.super_glider.044_yoshi")!!.assetPath,
            androidPostTimePartVisual(superGlider, loadout, null).assetPath,
        )
    }

    @Test
    fun aScannedYellowYoshiShowsYellowAndItsGliderFollows() {
        val character = androidPostTimePartVisual(yoshi, loadout, yellowScan)
        assertEquals("Yoshi · Yellow", character.name)
        assertEquals(AndroidLoadoutVariants.byId("character_variant.yoshi.020_yellow")!!.assetPath, character.assetPath)
        assertEquals(
            AndroidLoadoutVariants.byId("glider_variant.super_glider.043_yellow")!!.assetPath,
            androidPostTimePartVisual(superGlider, loadout, yellowScan).assetPath,
        )
    }

    @Test
    fun aScannedGliderVariantIsShownAsRead() {
        val scan = yellowScan.copy(gliderVariantId = "glider_variant.super_glider.000_black")
        assertEquals(
            AndroidLoadoutVariants.byId("glider_variant.super_glider.000_black")!!.assetPath,
            androidPostTimePartVisual(superGlider, loadout, scan).assetPath,
        )
    }

    @Test
    fun aChangedCharacterDropsTheScannedColour() {
        val mario = AndroidLoadoutCatalog.find("character.mario")!!
        val changed = loadout + ("characterId" to "character.mario")
        assertEquals("Mario", androidPostTimePartVisual(mario, changed, yellowScan).name)
        assertEquals(
            androidPostTimePartVisual(superGlider, changed, null).assetPath,
            androidPostTimePartVisual(superGlider, changed, yellowScan).assetPath,
        )
    }
}
