package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTournamentMutationErrorTest {
    @Test
    fun `entered races are reported as score protection instead of revision conflict`() {
        val message = androidTournamentMutationError(
            AndroidTournamentClientException(409, "groups with entered races stay locked"), AndroidProductLanguage.DUTCH,
        )

        assertTrue(message.contains("blijft vergrendeld"))
        assertTrue(message.contains("uitslagen zijn niet verwijderd"))
        assertFalse(message.contains("intussen gewijzigd"))
    }

    @Test
    fun `stale revision asks for a fresh read and review`() {
        val message = androidTournamentMutationError(
            AndroidTournamentClientException(409, "the tournament changed; reload and retry"), AndroidProductLanguage.DUTCH,
        )

        assertTrue(message.contains("intussen gewijzigd"))
        assertTrue(message.contains("Vernieuw"))
        assertTrue(message.contains("actuele stap"))
    }

    @Test
    fun `other domain conflict retains the concrete server reason`() {
        val message = androidTournamentMutationError(
            AndroidTournamentClientException(409, "complete every final score first"), AndroidProductLanguage.DUTCH,
        )

        assertTrue(message.contains("complete every final score first"))
        assertFalse(message.contains("elders gewijzigd"))
    }
}
