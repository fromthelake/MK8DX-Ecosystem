package nl.mariokart8.mk8dxtimetrials.ecosystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Parity with apps/timetrials-web/test/engine-context.test.ts: the same cases,
 * the same answers, so web and Android resolve one engine for one situation.
 */
class EngineContextTest {
    @Test
    fun `parses only 150 and 200`() {
        assertEquals(150, EngineContext.parseMode(150))
        assertEquals(200, EngineContext.parseMode("200"))
        for (value in listOf<Any?>(null, "", "100", 0, "150cc", 151)) {
            assertNull("$value", EngineContext.parseMode(value))
        }
    }

    @Test
    fun `resolves explicit over surface over single-engine preference over 150`() {
        assertEquals(
            ResolvedEngine(200, EngineSource.EXPLICIT),
            EngineContext.resolve(explicit = 200, surface = 150, preference = "150"),
        )
        assertEquals(
            ResolvedEngine(200, EngineSource.SURFACE),
            EngineContext.resolve(surface = 200, preference = "150"),
        )
        assertEquals(ResolvedEngine(200, EngineSource.PREFERENCE), EngineContext.resolve(preference = "200"))
        assertEquals(ResolvedEngine(150, EngineSource.DEFAULT), EngineContext.resolve(preference = "all"))
        assertEquals(ResolvedEngine(150, EngineSource.DEFAULT), EngineContext.resolve())
    }

    @Test
    fun `puts a known engine into a track link and leaves an unknown one to the track page`() {
        assertEquals("/?leaderboard=track.a%20b&mode=200", EngineContext.leaderboardLink("track.a b", 200))
        assertEquals("/?leaderboard=track.x", EngineContext.leaderboardLink("track.x", null))
        assertEquals(
            "/?leaderboard=track.x&notification=7",
            EngineContext.leaderboardLink("track.x", null, listOf("notification" to "7")),
        )
    }
}
