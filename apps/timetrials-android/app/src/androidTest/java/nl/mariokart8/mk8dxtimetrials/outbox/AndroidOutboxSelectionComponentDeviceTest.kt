package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOutboxSelectionComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val keyA = "a".repeat(64)
    private val keyB = "b".repeat(64)
    private val keyC = "c".repeat(64)
    private val keyD = "d".repeat(64)

    @Test
    fun surfacePreservesOrderAndRequiresExplicitLoadAndSelection() {
        val loadCalls = AtomicInteger(0)
        val submitCalls = AtomicInteger(0)
        val selectedKeys = mutableListOf<String>()
        lateinit var setState: (AndroidOutboxIndexState) -> Unit
        lateinit var setLoading: (Boolean) -> Unit
        compose.setContent {
            var state by androidx.compose.runtime.remember {
                mutableStateOf<AndroidOutboxIndexState>(AndroidOutboxIndexState.Unloaded)
            }
            var loading by androidx.compose.runtime.remember { mutableStateOf(false) }
            setState = { state = it }
            setLoading = { loading = it }
            MaterialTheme {
                AndroidOutboxSelectionComponent(
                    state = state,
                    loadInProgress = loading,
                    labelProvider = { entry ->
                        when (entry.entryKeyHash) {
                            keyA -> "First captured result"
                            keyB -> "Second captured result"
                            keyC -> "Third captured result"
                            else -> error("private://label-provider-detail")
                        }
                    },
                    onLoadRequested = loadCalls::incrementAndGet,
                    onEntrySelected = selectedKeys::add,
                    onSubmitTimeTrial = submitCalls::incrementAndGet,
                )
            }
        }

        compose.onNodeWithTag("outbox-selection-status")
            .assertTextEquals("Saved results not loaded")
        compose.onNodeWithTag("outbox-selection-load")
            .assertIsEnabled()
            .assertTextEquals("Load saved results")
            .performClick()
        compose.onAllNodesWithTag("outbox-selection-list").assertCountEquals(0)
        assertEquals(1, loadCalls.get())
        assertEquals(emptyList<String>(), selectedKeys)

        compose.runOnIdle { setLoading(true) }
        compose.onNodeWithTag("outbox-selection-status")
            .assertTextEquals("Loading saved results")
        compose.onNodeWithTag("outbox-selection-load")
            .assertIsNotEnabled()
            .assertTextEquals("Loading saved results")

        compose.runOnIdle {
            setState(
                AndroidOutboxIndexState.Ready(
                    listOf(
                        entry(
                            keyB,
                            AndroidOutboxStoredState.FAILED,
                            revision = 2,
                            attempts = 1,
                            failureCode = "api.unavailable",
                        ),
                        entry(keyA, AndroidOutboxStoredState.PENDING),
                        entry(
                            keyC,
                            AndroidOutboxStoredState.SYNCED,
                            revision = 2,
                            attempts = 1,
                        ),
                        entry(keyD, AndroidOutboxStoredState.PENDING),
                    ),
                ),
            )
            setLoading(false)
        }
        compose.onNodeWithTag("outbox-selection-status")
            .assertTextEquals("4 saved results")
        compose.onNodeWithTag("outbox-selection-load")
            .assertIsEnabled()
            .assertTextEquals("Refresh saved results")
        compose.onNodeWithTag("outbox-selection-row-label-0")
            .assertTextEquals("Second captured result")
        compose.onNodeWithTag("outbox-selection-row-status-0").assertTextEquals("Failed")
        compose.onNodeWithTag("outbox-selection-row-label-1")
            .assertTextEquals("First captured result")
        compose.onNodeWithTag("outbox-selection-row-status-1").assertTextEquals("Pending")
        compose.onNodeWithTag("outbox-selection-row-label-2")
            .assertTextEquals("Third captured result")
        compose.onNodeWithTag("outbox-selection-row-status-2")
            .assertTextEquals("Synchronized")
        compose.onNodeWithTag("outbox-selection-row-label-3")
            .assertTextEquals("Result label unavailable")
        compose.onNodeWithTag("outbox-selection-select-3").assertIsNotEnabled()
        assertEquals(emptyList<String>(), selectedKeys)

        compose.onNodeWithTag("outbox-selection-select-0")
            .assertIsEnabled()
            .performClick()
        compose.onNodeWithTag("outbox-selection-select-2")
            .assertIsEnabled()
            .performClick()
        assertEquals(listOf(keyB, keyC), selectedKeys)

        compose.runOnIdle { setLoading(true) }
        compose.onNodeWithTag("outbox-selection-row-label-0")
            .assertTextEquals("Second captured result")
        compose.onNodeWithTag("outbox-selection-select-0").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-selection-select-1").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-selection-select-2").assertIsNotEnabled()

        compose.runOnIdle {
            setState(AndroidOutboxIndexState.Ready(emptyList()))
            setLoading(false)
        }
        compose.onNodeWithTag("outbox-selection-status").assertTextEquals("No saved results")
        compose.onNodeWithTag("outbox-selection-empty").assertIsDisplayed()
        compose.onNodeWithTag("outbox-selection-submit").performClick()
        assertEquals(1, submitCalls.get())
        compose.onAllNodesWithTag("outbox-selection-list").assertCountEquals(0)

        compose.runOnIdle {
            setState(
                AndroidOutboxIndexState.Unavailable(
                    AndroidOutboxIndexFailureCode.LOCAL_INDEX_UNAVAILABLE,
                ),
            )
        }
        compose.onNodeWithTag("outbox-selection-status")
            .assertTextEquals("Saved results unavailable")
        compose.onNodeWithTag("outbox-selection-load")
            .assertIsEnabled()
            .assertTextEquals("Refresh saved results")
        assertEquals(1, loadCalls.get())
        assertEquals(listOf(keyB, keyC), selectedKeys)
    }

    @Test
    fun unauthenticatedLocalListKeepsRowsVisibleButSynchronizationDisabled() {
        val selectedKeys = mutableListOf<String>()
        compose.setContent {
            MaterialTheme {
                AndroidOutboxSelectionComponent(
                    state = AndroidOutboxIndexState.Ready(
                        listOf(entry(keyA, AndroidOutboxStoredState.PENDING)),
                    ),
                    loadInProgress = false,
                    labelProvider = { "Saved 2026-08-18 12:00:00" },
                    onLoadRequested = {},
                    onEntrySelected = selectedKeys::add,
                    synchronizationAvailable = false,
                )
            }
        }

        compose.onNodeWithTag("outbox-selection-auth-required")
            .assertTextEquals("Sign in to synchronize saved results")
        compose.onNodeWithTag("outbox-selection-row-label-0")
            .assertTextEquals("Saved 2026-08-18 12:00:00")
        compose.onNodeWithTag("outbox-selection-select-0")
            .assertTextEquals("Sign in to synchronize")
            .assertIsNotEnabled()
        assertEquals(emptyList<String>(), selectedKeys)
    }

    private fun entry(
        key: String,
        state: AndroidOutboxStoredState,
        revision: Long = 1,
        attempts: Long = 0,
        failureCode: String? = null,
    ) = AndroidOutboxIndexEntry(
        entryKeyHash = key,
        createdAtMs = 1_786_900_000_000,
        storedState = state,
        stateRevision = revision,
        attemptCount = attempts,
        failureCode = failureCode,
    )
}
