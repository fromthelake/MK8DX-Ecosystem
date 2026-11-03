package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
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
class AsyncAndroidOutboxSynchronizationComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val pending = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.PENDING,
        stateRevision = 1,
        attemptCount = 0,
    )
    private val synced = AndroidOutboxSynchronizationSnapshot(
        storedState = AndroidOutboxStoredState.SYNCED,
        stateRevision = 2,
        attemptCount = 1,
    )

    @Test
    fun recompositionPreservesBoundedStateAndDuplicateInputCannotStartAgain() {
        val factoryCalls = AtomicInteger(0)
        val deliveryCalls = AtomicInteger(0)
        val deliveryEntered = CountDownLatch(1)
        val deliveryRelease = CountDownLatch(1)
        val binding = AndroidOutboxSynchronizationBinding(
            AndroidOutboxSynchronizationActionsFactory { onState ->
                factoryCalls.incrementAndGet()
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState =
                        AndroidOutboxSynchronizationState.Ready(pending).also(onState)

                    override fun deliver(): AndroidOutboxSynchronizationState {
                        deliveryCalls.incrementAndGet()
                        onState(
                            AndroidOutboxSynchronizationState.Working(
                                AndroidOutboxSynchronizationAction.DELIVER,
                                pending,
                            ),
                        )
                        deliveryEntered.countDown()
                        check(deliveryRelease.await(5, TimeUnit.SECONDS))
                        return AndroidOutboxSynchronizationState.Ready(synced).also(onState)
                    }

                    override fun requestRetry(): AndroidOutboxSynchronizationState =
                        error("unexpected retry")
                }
            },
        )
        lateinit var recompose: () -> Unit
        compose.setContent {
            var marker by androidx.compose.runtime.remember { mutableStateOf(0) }
            recompose = { marker += 1 }
            MaterialTheme {
                AsyncAndroidOutboxSynchronizationComponent(binding = binding)
            }
            marker.hashCode()
        }

        compose.onNodeWithTag("outbox-synchronization-load").performClick()
        compose.waitUntil(5_000) {
            factoryCalls.get() == 1
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Ready to synchronize")
        compose.onNodeWithTag("outbox-synchronization-summary")
            .assertTextEquals("State revision 1 • Attempts 0")

        compose.runOnIdle(recompose)
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Ready to synchronize")
        assertEquals(1, factoryCalls.get())

        compose.onNodeWithTag("outbox-synchronization-deliver").performClick()
        assertTrue(deliveryEntered.await(5, TimeUnit.SECONDS))
        compose.waitUntil(5_000) {
            deliveryCalls.get() == 1
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Synchronizing result")
        compose.onNodeWithTag("outbox-synchronization-load").assertIsNotEnabled()
        compose.onNodeWithTag("outbox-synchronization-deliver")
            .assertIsNotEnabled()
        assertEquals(1, deliveryCalls.get())

        deliveryRelease.countDown()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Result synchronized").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("outbox-synchronization-summary")
            .assertTextEquals("State revision 2 • Attempts 1")
        assertEquals(2, factoryCalls.get())
    }

    @Test
    fun disposalDropsLateActionAndRemountStartsUnloaded() {
        val factoryCalls = AtomicInteger(0)
        val firstLoadEntered = CountDownLatch(1)
        val firstLoadRelease = CountDownLatch(1)
        val firstLoadFinished = CountDownLatch(1)
        val binding = AndroidOutboxSynchronizationBinding(
            AndroidOutboxSynchronizationActionsFactory { onState ->
                val factoryCall = factoryCalls.incrementAndGet()
                object : AndroidOutboxSynchronizationActions {
                    override fun load(): AndroidOutboxSynchronizationState {
                        if (factoryCall == 1) {
                            return try {
                                firstLoadEntered.countDown()
                                firstLoadRelease.await(5, TimeUnit.SECONDS)
                                AndroidOutboxSynchronizationState.Ready(synced).also(onState)
                            } finally {
                                firstLoadFinished.countDown()
                            }
                        }
                        return AndroidOutboxSynchronizationState.Ready(pending).also(onState)
                    }

                    override fun deliver(): AndroidOutboxSynchronizationState =
                        error("unexpected delivery")

                    override fun requestRetry(): AndroidOutboxSynchronizationState =
                        error("unexpected retry")
                }
            },
        )
        lateinit var setVisible: (Boolean) -> Unit
        compose.setContent {
            var visible by androidx.compose.runtime.remember { mutableStateOf(true) }
            setVisible = { visible = it }
            MaterialTheme {
                if (visible) {
                    AsyncAndroidOutboxSynchronizationComponent(binding = binding)
                }
            }
        }

        compose.onNodeWithTag("outbox-synchronization-load").performClick()
        assertTrue(firstLoadEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { setVisible(false) }
        firstLoadRelease.countDown()
        assertTrue(firstLoadFinished.await(5, TimeUnit.SECONDS))

        compose.runOnIdle { setVisible(true) }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Synchronization status not loaded")
        assertEquals(1, factoryCalls.get())
        compose.onNodeWithTag("outbox-synchronization-load").performClick()
        compose.waitUntil(5_000) {
            factoryCalls.get() == 2
        }
        compose.onNodeWithTag("outbox-synchronization-status")
            .assertTextEquals("Ready to synchronize")
        compose.onNodeWithTag("outbox-synchronization-summary")
            .assertTextEquals("State revision 1 • Attempts 0")
    }
}
