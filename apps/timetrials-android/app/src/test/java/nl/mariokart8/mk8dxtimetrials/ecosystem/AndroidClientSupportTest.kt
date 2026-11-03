package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidClientSupportTest {
    private fun support(
        minimumSupportedBuild: Int = 1,
        retiredBuilds: List<Int> = emptyList(),
    ) = AndroidClientSupport(
        currentVersion = "2.44.0-build73",
        currentBuild = 73,
        minimumSupportedBuild = minimumSupportedBuild,
        retiredBuilds = retiredBuilds,
        downloadPagePath = "/?apps=1",
        message = null,
    )

    @Test
    fun nothingIsRetiredUntilTheOwnerTurnsABuildOff() {
        val answer = support()
        listOf(1, 60, 72, 73).forEach { assertFalse("build $it", answer.retires(it)) }
    }

    @Test
    fun everythingBeforeTheMinimumMustUpdate() {
        val answer = support(minimumSupportedBuild = 72)
        assertTrue(answer.retires(71))
        assertFalse(answer.retires(72))
        assertFalse(answer.retires(73))
    }

    @Test
    fun oneNamedBuildIsTurnedOffWithoutTouchingItsNeighbours() {
        val answer = support(retiredBuilds = listOf(71))
        assertFalse(answer.retires(70))
        assertTrue(answer.retires(71))
        assertFalse(answer.retires(72))
    }

    @Test
    fun bothSwitchesApplyTogether() {
        val answer = support(minimumSupportedBuild = 70, retiredBuilds = listOf(72))
        assertEqualsBlocked(listOf(true, false, false, true, false), answer, 69..73)
    }

    private fun assertEqualsBlocked(
        expected: List<Boolean>,
        answer: AndroidClientSupport,
        builds: IntRange,
    ) {
        builds.forEachIndexed { index, build ->
            val blocked = answer.retires(build)
            assertTrue(
                "build $build expected ${expected[index]} but was $blocked",
                blocked == expected[index],
            )
        }
    }
}
