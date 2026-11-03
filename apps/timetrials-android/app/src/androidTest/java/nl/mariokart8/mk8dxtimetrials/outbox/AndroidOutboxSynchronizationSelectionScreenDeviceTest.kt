package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOutboxSynchronizationSelectionScreenDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val entryKey = "a".repeat(64)

    @Test
    fun explicitSelectionFailureSynchronizationAndReturnRemainOneBoundedWorkflow() {
        val indexFactoryCalls = AtomicInteger(0)
        val bindingFactoryCalls = AtomicInteger(0)
        val synchronizationFactoryCalls = AtomicInteger(0)
        val deliveryStarted = CountDownLatch(1)
        val releaseDelivery = CountDownLatch(1)
        val synchronizationBinding = AndroidOutboxSynchronizationBinding(
            AndroidOutboxSynchronizationActionsFactory { onState ->
                synchronizationFactoryCalls.incrementAndGet()
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState = pending()

                    override fun deliver(): AndroidOutboxSynchronizationState {
                        onState(
                            AndroidOutboxSynchronizationState.Working(
                                AndroidOutboxSynchronizationAction.DELIVER,
                                pending().snapshot,
                            ),
                        )
                        deliveryStarted.countDown()
                        assertTrue(releaseDelivery.await(5, TimeUnit.SECONDS))
                        return AndroidOutboxSynchronizationState.Ready(
                            AndroidOutboxSynchronizationSnapshot(
                                AndroidOutboxStoredState.SYNCED,
                                stateRevision = 2,
                                attemptCount = 1,
                            ),
                        )
                    }

                    override fun requestRetry(): AndroidOutboxSynchronizationState =
                        error("retry must remain explicit and unavailable from pending")
                }
            },
        )
        val dependencies = AndroidOutboxSynchronizationSelectionDependencies(
            indexBinding = AndroidOutboxIndexBinding(
                AndroidOutboxIndexActionsFactory {
                    indexFactoryCalls.incrementAndGet()
                    AndroidOutboxIndexActions {
                        AndroidOutboxIndexState.Ready(
                            listOf(
                                AndroidOutboxIndexEntry(
                                    entryKeyHash = entryKey,
                                    createdAtMs = 1_786_900_900_000,
                                    storedState = AndroidOutboxStoredState.PENDING,
                                    stateRevision = 1,
                                    attemptCount = 0,
                                ),
                            ),
                        )
                    }
                },
            ),
            selectionCoordinator = AndroidOutboxSelectionCoordinator {
                if (bindingFactoryCalls.incrementAndGet() == 1) {
                    error("private://binding-configuration")
                }
                synchronizationBinding
            },
        )
        try {
            compose.setContent {
                MaterialTheme {
                    AndroidOutboxSynchronizationSelectionScreen(
                        dependencies = dependencies,
                        labelProvider = { "Synthetic saved result" },
                    )
                }
            }

            compose.onAllNodesWithTag("outbox-workflow-selection-failure")
                .assertCountEquals(0)
            assertEquals(0, bindingFactoryCalls.get())
            assertEquals(0, synchronizationFactoryCalls.get())

            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Synthetic saved result")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("outbox-selection-select-0").performClick()
            compose.onNodeWithTag("outbox-workflow-selection-failure")
                .assertTextEquals(ANDROID_OUTBOX_SELECTION_GENERIC_FAILURE_TEXT)
            compose.onAllNodesWithText(entryKey).assertCountEquals(0)
            assertEquals(1, bindingFactoryCalls.get())
            assertEquals(0, synchronizationFactoryCalls.get())

            compose.onNodeWithTag("outbox-selection-select-0").performClick()
            compose.onNodeWithTag("outbox-synchronization-status")
                .assertTextEquals("Synchronization status not loaded")
            compose.onNodeWithTag("outbox-workflow-return-to-selection")
                .assertTextEquals("Back to saved results")
            assertEquals(2, bindingFactoryCalls.get())
            assertEquals(0, synchronizationFactoryCalls.get())

            compose.onNodeWithTag("outbox-synchronization-load").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Ready to synchronize")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            assertEquals(1, synchronizationFactoryCalls.get())
            compose.onNodeWithTag("outbox-synchronization-deliver").performClick()
            assertTrue(deliveryStarted.await(5, TimeUnit.SECONDS))
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Synchronizing result")
                    .fetchSemanticsNodes().isNotEmpty()
            }

            compose.onNodeWithTag("outbox-workflow-return-to-selection").performClick()
            releaseDelivery.countDown()
            compose.waitUntil(5_000) {
                indexFactoryCalls.get() == 2 &&
                    compose.onAllNodesWithText("Synthetic saved result")
                        .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("outbox-selection-status")
                .assertTextEquals("1 saved results")
            compose.onAllNodesWithTag("outbox-synchronization")
                .assertCountEquals(0)
            assertEquals(2, indexFactoryCalls.get())
            assertEquals(2, synchronizationFactoryCalls.get())
        } finally {
            releaseDelivery.countDown()
        }
    }

    private fun pending() = AndroidOutboxSynchronizationState.Ready(
        AndroidOutboxSynchronizationSnapshot(
            AndroidOutboxStoredState.PENDING,
            stateRevision = 1,
            attemptCount = 0,
        ),
    )
}
