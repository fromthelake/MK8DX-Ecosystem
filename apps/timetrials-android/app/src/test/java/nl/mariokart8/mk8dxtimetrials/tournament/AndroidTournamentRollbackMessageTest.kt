package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The source Manager guards every backward step with a confirmation naming what
 * is undone. These assert the phone repeats the same promise the canonical
 * rollback actually keeps.
 */
class AndroidTournamentRollbackMessageTest {

    @Test
    fun `going back to step 2 promises the roster survives`() {
        val message = rollbackConfirmationMessage(2, AndroidProductLanguage.DUTCH)
        assertTrue(message.contains("Kwalificatiegroepen en alle vervolgdata worden verwijderd"))
        // The server drops groups on rollback from step 3, never participants.
        assertTrue(message.contains("deelnemerslijst"))
    }

    @Test
    fun `reopening a locked layout is described as reopening, not deleting`() {
        assertEquals(
            "Terug naar Stap 3? De kwalificatie-indeling wordt heropend.",
            rollbackConfirmationMessage(3, AndroidProductLanguage.DUTCH),
        )
        assertEquals(
            "Terug naar Stap 7? De eindgroep-indeling wordt heropend.",
            rollbackConfirmationMessage(7, AndroidProductLanguage.DUTCH),
        )
    }

    @Test
    fun `going back to step 6 names the final groups that are removed`() {
        val message = rollbackConfirmationMessage(6, AndroidProductLanguage.DUTCH)
        assertTrue(message.contains("Eindgroepen en eindgroepplaatsing worden verwijderd"))
    }

    @Test
    fun `every reachable backward step has its own message`() {
        (2..9).forEach { target ->
            val message = rollbackConfirmationMessage(target, AndroidProductLanguage.DUTCH)
            assertTrue("stap $target", message.startsWith("Terug naar Stap $target?"))
        }
    }

    @Test
    fun `only the steps whose rollback destroys generated data are marked destructive`() {
        // Server-side: rollback from 3 drops both stages' groups, from 7 the
        // final groups. Rollback from 4 and 8 only unlocks a layout.
        assertTrue(rollbackDiscardsData(3))
        assertTrue(rollbackDiscardsData(7))
        assertFalse(rollbackDiscardsData(4))
        assertFalse(rollbackDiscardsData(8))
        assertFalse(rollbackDiscardsData(5))
    }
}
