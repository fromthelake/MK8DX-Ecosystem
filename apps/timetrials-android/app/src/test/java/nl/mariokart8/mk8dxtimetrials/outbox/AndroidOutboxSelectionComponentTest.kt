package nl.mariokart8.mk8dxtimetrials.outbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidOutboxSelectionComponentTest {
    @Test
    fun acceptsExactUnicodeCodePointLimitWithoutChangingTheLabel() {
        val padded = " saved result "
        val exactLimit = "\uD83D\uDE80".repeat(
            ANDROID_OUTBOX_SELECTION_LABEL_MAX_CODE_POINTS,
        )

        assertEquals(padded, boundedAndroidOutboxSelectionLabel(padded))
        assertEquals(exactLimit, boundedAndroidOutboxSelectionLabel(exactLimit))
    }

    @Test
    fun rejectsBlankOversizedAndControlLabels() {
        val oversized = "\uD83D\uDE80".repeat(
            ANDROID_OUTBOX_SELECTION_LABEL_MAX_CODE_POINTS + 1,
        )

        listOf("", "   ", "line\nbreak", "tab\tlabel", "\u0000", oversized).forEach {
            assertNull(boundedAndroidOutboxSelectionLabel(it))
        }
    }
}
