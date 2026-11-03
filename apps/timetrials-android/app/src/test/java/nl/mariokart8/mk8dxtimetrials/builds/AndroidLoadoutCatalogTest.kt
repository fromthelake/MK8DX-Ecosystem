package nl.mariokart8.mk8dxtimetrials.builds

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLoadoutCatalogTest {
    @Test
    fun magicEightAndMetaAssessmentUseGroundSpeedAndMiniTurbo() {
        fun part(category: AndroidBuildPartCategory, speed: Double = 0.0, miniTurbo: Double = 0.0) =
            AndroidBuildPart(category, 0, "test.${category.name.lowercase()}", "Test", DoubleArray(13).also {
                it[0] = speed
                it[11] = miniTurbo
            })
        val assessment = assessAndroidBuild(
            AndroidBuildSelection(
                part(AndroidBuildPartCategory.CHARACTER, speed = 3.25, miniTurbo = 4.75),
                part(AndroidBuildPartCategory.BODY),
                part(AndroidBuildPartCategory.TIRE),
                part(AndroidBuildPartCategory.GLIDER),
            ),
        )
        assertTrue(assessment.optimum)
        assertTrue(assessment.meta)
        assertEquals(8.0, assessment.groundSpeed + assessment.miniTurbo, 0.001)
    }

    @Test
    fun generatedCatalogContainsEveryCanonicalPartAndCompleteStats() {
        assertEquals(54, AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER).size)
        assertEquals(41, AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.BODY).size)
        assertEquals(22, AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.TIRE).size)
        assertEquals(15, AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.GLIDER).size)
        assertEquals(132, AndroidLoadoutCatalog.parts.size)
        assertEquals(13, AndroidLoadoutCatalog.statKeys.size)
        assertTrue(AndroidLoadoutCatalog.parts.all { it.stats.size == 13 })
        assertTrue(AndroidLoadoutCatalog.parts.all { it.assetPath.startsWith("private-product/img/") })
    }

    @Test
    fun privatePresentationPathsUseSourceAssetIndicesInsteadOfFilteredListPositions() {
        assertEquals("private-product/img/character/0.png", AndroidLoadoutCatalog.find("character.mario")?.assetPath)
        assertEquals("private-product/img/character/16.png", AndroidLoadoutCatalog.find("character.yoshi")?.assetPath)
        assertEquals("private-product/img/character/25.png", AndroidLoadoutCatalog.find("character.toad")?.assetPath)
        assertEquals("private-product/img/character/68.png", AndroidLoadoutCatalog.find("character.inkling_boy")?.assetPath)
        assertEquals("private-product/img/character/81.png", AndroidLoadoutCatalog.find("character.mii_heavy")?.assetPath)
        assertEquals("private-product/img/body/29.png", AndroidLoadoutCatalog.find("body.mr_scooty")?.assetPath)
        assertEquals("private-product/img/tire/13.png", AndroidLoadoutCatalog.find("tire.azure_roller")?.assetPath)
        assertEquals("private-product/img/glider/12.png", AndroidLoadoutCatalog.find("glider.hylian_kite")?.assetPath)
        AndroidBuildPartCategory.entries.forEach { category ->
            assertEquals(
                AndroidLoadoutCatalog.parts(category).size,
                AndroidLoadoutCatalog.parts(category).map(AndroidBuildPart::sourceAssetIndex).toSet().size,
            )
        }
    }

    @Test
    fun characterColorFamiliesSelectMatchingBodyAndGliderArtwork() {
        assertEquals(28, AndroidLoadoutVariants.characters.size)
        assertEquals(213, AndroidLoadoutVariants.bodies.size)
        assertEquals(47, AndroidLoadoutVariants.gliders.size)
        val blackYoshi = AndroidLoadoutVariants.characters.first { it.id == "character_variant.yoshi.018_black" }
        assertEquals("black", AndroidLoadoutVariants.characterColorFamily(blackYoshi.id))
        assertTrue(AndroidLoadoutVariants.matched("body.standard_kart", blackYoshi.id)?.id?.endsWith("_black") == true)
        assertTrue(AndroidLoadoutVariants.matched("glider.super_glider", blackYoshi.id)?.id?.endsWith("_black") == true)
        assertEquals(
            "body_variant.buggybud.000_blue",
            AndroidLoadoutVariants.matched("body.buggybud", "character.inkling_boy")?.id,
        )
        assertEquals(
            "glider_variant.super_glider.012_inkling_m",
            AndroidLoadoutVariants.matched("glider.super_glider", "character.inkling_boy")?.id,
        )
        val appearances = AndroidLoadoutVariants.characterParts(AndroidLoadoutCatalog.parts(AndroidBuildPartCategory.CHARACTER))
        assertEquals(82, appearances.size)
        assertEquals((0..81).toList(), appearances.map(AndroidBuildPart::sourceAssetIndex))
        assertTrue(appearances.all { it.assetPath.startsWith("private-product/img/character/") })
        assertEquals("private-product/img/character/18.png", appearances.first { it.id == blackYoshi.id }.assetPath)
    }
}
