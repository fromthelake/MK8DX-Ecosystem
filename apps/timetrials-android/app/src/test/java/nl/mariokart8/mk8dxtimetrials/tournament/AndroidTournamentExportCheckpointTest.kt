package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidTournamentExportCheckpointTest {
    @Test
    fun `every export checkpoint retains all earlier source tabs`() {
        assertEquals(
            listOf("Kwalificatie-indeling"),
            androidTournamentExportCheckpoints(4).map { it.label },
        )
        assertEquals(
            listOf("Kwalificatie-indeling", "Kwalificatie-uitslag"),
            androidTournamentExportCheckpoints(6).map { it.label },
        )
        assertEquals(
            listOf("Kwalificatie-indeling", "Kwalificatie-uitslag", "Eindgroep-indeling"),
            androidTournamentExportCheckpoints(8).map { it.label },
        )
        assertEquals(
            listOf(
                "Kwalificatie-indeling",
                "Kwalificatie-uitslag",
                "Eindgroep-indeling",
                "Eindgroep-uitslag",
            ),
            androidTournamentExportCheckpoints(10).map { it.label },
        )
    }

    @Test
    fun `the active source checkpoint is always the last tab`() {
        assertEquals(AndroidExportMode.LAYOUT, androidTournamentExportCheckpoints(4).last().mode)
        assertEquals(AndroidExportMode.RESULTS, androidTournamentExportCheckpoints(6).last().mode)
        assertEquals("final", androidTournamentExportCheckpoints(8).last().stage)
        assertEquals(AndroidExportMode.RESULTS, androidTournamentExportCheckpoints(10).last().mode)
    }
}
