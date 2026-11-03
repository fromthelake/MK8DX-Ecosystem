package nl.mariokart8.mk8dxtimetrials

import org.junit.Assert.assertEquals
import org.junit.Test

class MigrationBaselineTest {
    @Test
    fun preservesCanonicalApplicationIdentityAndSourceRole() {
        assertEquals("nl.mariokart8.mk8dxtimetrials", MigrationBaseline.APPLICATION_ID)
        assertEquals("canonical Android manual-entry base", MigrationBaseline.SOURCE_ROLE)
    }
}
