package nl.mariokart8.mk8dxtimetrials.outbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class AndroidOutboxSynchronizationSelectionScreenTest {
    @Test
    fun everyFixedSelectionFailureUsesOneGenericSafeMessage() {
        val messages = AndroidOutboxSelectionFailureCode.entries.map(
            ::androidOutboxSelectionFailureText,
        )

        assertEquals(
            setOf(ANDROID_OUTBOX_SELECTION_GENERIC_FAILURE_TEXT),
            messages.toSet(),
        )
        AndroidOutboxSelectionFailureCode.entries.forEach { code ->
            assertFalse(
                ANDROID_OUTBOX_SELECTION_GENERIC_FAILURE_TEXT.contains(
                    code.name,
                    ignoreCase = true,
                ),
            )
        }
    }
}
