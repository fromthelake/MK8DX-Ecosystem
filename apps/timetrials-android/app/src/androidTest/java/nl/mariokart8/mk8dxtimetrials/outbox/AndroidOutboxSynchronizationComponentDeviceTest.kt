package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
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
class AndroidOutboxSynchronizationComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun surfaceRendersBoundedStateAndKeepsDeliveryRetrySeparate() {
        val loadCalls = AtomicInteger(0)
        val deliveryCalls = AtomicInteger(0)
        val retryCalls = AtomicInteger(0)
        lateinit var setState: (AndroidOutboxSynchronizationState) -> Unit
        compose.setContent {
            var state by androidx.compose.runtime.remember {
                mutableStateOf<AndroidOutboxSynchronizationState>(
                    AndroidOutboxSynchronizationState.Unloaded,
                )
            }
            setState = { state = it }
            MaterialTheme {
                AndroidOutboxSynchronizationComponent(
                    state = state,
                    onLoadRequested = loadCalls::incrementAndGet,
                    onDeliveryRequested = deliveryCalls::incrementAndGet,
                    onRetryRequested = retryCalls::incrementAndGet,
                )
            }
        }

        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Synchronization status not loaded")
        compose.onNodeWithTag("outbox-synchronization-load")
            .assertIsEnabled()
            .assertTextEquals("Load status")
            .performClick()
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()
        compose.onAllNodesWithTag("outbox-synchronization-summary").assertCountEquals(0)
        assertEquals(1, loadCalls.get())

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.Ready(
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.PENDING,
                        stateRevision = 1,
                        attemptCount = 0,
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Ready to synchronize")
        compose.onNodeWithTag("outbox-synchronization-summary")
            .assertTextEquals("State revision 1 • Attempts 0")
        compose.onNodeWithTag("outbox-synchronization-load")
            .assertTextEquals("Refresh status")
        compose.onNodeWithTag("outbox-synchronization-deliver")
            .assertIsEnabled()
            .performClick()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()
        assertEquals(1, deliveryCalls.get())

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.Working(
                    AndroidOutboxSynchronizationAction.DELIVER,
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.PENDING,
                        stateRevision = 1,
                        attemptCount = 0,
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Synchronizing result")
        compose.onNodeWithTag("outbox-synchronization-load").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.ActionFailed(
                    AndroidOutboxSynchronizationFailureCode.ACTION_IN_PROGRESS,
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.PENDING,
                        stateRevision = 1,
                        attemptCount = 0,
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Another synchronization action is in progress")
        compose.onNodeWithTag("outbox-synchronization-load").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.Ready(
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.FAILED,
                        stateRevision = 2,
                        attemptCount = 1,
                        failureCode = "transport.failed",
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Last synchronization attempt failed")
        compose.onNodeWithTag("outbox-synchronization-failure-code")
            .assertTextEquals("Failure code: transport.failed")
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry")
            .assertIsEnabled()
            .performClick()
        assertEquals(1, retryCalls.get())

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.ActionFailed(
                    AndroidOutboxSynchronizationFailureCode.DELIVERY_UNAVAILABLE,
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.PENDING,
                        stateRevision = 3,
                        attemptCount = 1,
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Could not synchronize result")
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()
        compose.onAllNodesWithTag("outbox-synchronization-failure-code").assertCountEquals(0)

        compose.runOnIdle {
            setState(
                AndroidOutboxSynchronizationState.Ready(
                    AndroidOutboxSynchronizationSnapshot(
                        AndroidOutboxStoredState.SYNCED,
                        stateRevision = 4,
                        attemptCount = 2,
                    ),
                ),
            )
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Result synchronized")
        compose.onNodeWithTag("outbox-synchronization-deliver").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-retry").assertIsNotEnabled()
        compose.onAllNodesWithTag("outbox-synchronization-failure-code").assertCountEquals(0)
        assertEquals(1, loadCalls.get())
        assertEquals(1, deliveryCalls.get())
        assertEquals(1, retryCalls.get())
    }
}
