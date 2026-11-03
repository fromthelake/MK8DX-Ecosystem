package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
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
class AsyncAndroidOutboxIndexComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val ready = AndroidOutboxIndexState.Ready(
        listOf(
            AndroidOutboxIndexEntry(
                entryKeyHash = "a".repeat(64),
                createdAtMs = 1_786_900_000_000,
                storedState = AndroidOutboxStoredState.PENDING,
                stateRevision = 1,
                attemptCount = 0,
            ),
        ),
    )

    @Test
    fun automaticLoadIsStableAcrossRecompositionAndDuplicateInputIsGuarded() {
        val factoryCalls = AtomicInteger(0)
        val loadCalls = AtomicInteger(0)
        val loadEntered = CountDownLatch(1)
        val loadRelease = CountDownLatch(1)
        val binding = AndroidOutboxIndexBinding(
            AndroidOutboxIndexActionsFactory {
                factoryCalls.incrementAndGet()
                AndroidOutboxIndexActions {
                    loadCalls.incrementAndGet()
                    loadEntered.countDown()
                    check(loadRelease.await(5, TimeUnit.SECONDS))
                    ready
                }
            },
        )
        lateinit var recompose: () -> Unit
        lateinit var requestLoad: () -> Unit
        compose.setContent {
            var marker by androidx.compose.runtime.remember { mutableStateOf(0) }
            recompose = { marker += 1 }
            MaterialTheme {
                AsyncAndroidOutboxIndexComponent(binding = binding) { state, loading, load ->
                    requestLoad = load
                    Column {
                        Text(
                            text = state.label(),
                            modifier = Modifier.testTag("outbox-index-state"),
                        )
                        Button(
                            onClick = load,
                            enabled = !loading,
                            modifier = Modifier.testTag("outbox-index-load"),
                        ) {
                            Text(if (loading) "Loading" else "Load")
                        }
                    }
                }
            }
            marker.hashCode()
        }

        assertTrue(loadEntered.await(5, TimeUnit.SECONDS))
        compose.onNodeWithTag("outbox-index-load").assertIsNotEnabled()
        compose.runOnIdle {
            requestLoad()
            requestLoad()
        }
        assertEquals(1, factoryCalls.get())
        assertEquals(1, loadCalls.get())

        loadRelease.countDown()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Ready 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("outbox-index-state").assertTextEquals("Ready 1")
        compose.runOnIdle(recompose)
        compose.onNodeWithTag("outbox-index-state").assertTextEquals("Ready 1")
        assertEquals(1, factoryCalls.get())
    }

    @Test
    fun disposalDropsLateLoadAndRemountStartsANewAutomaticLoad() {
        val factoryCalls = AtomicInteger(0)
        val firstLoadEntered = CountDownLatch(1)
        val firstLoadRelease = CountDownLatch(1)
        val firstLoadFinished = CountDownLatch(1)
        val binding = AndroidOutboxIndexBinding(
            AndroidOutboxIndexActionsFactory {
                val factoryCall = factoryCalls.incrementAndGet()
                AndroidOutboxIndexActions {
                    if (factoryCall == 1) {
                        return@AndroidOutboxIndexActions try {
                            firstLoadEntered.countDown()
                            firstLoadRelease.await(5, TimeUnit.SECONDS)
                            ready
                        } finally {
                            firstLoadFinished.countDown()
                        }
                    }
                    ready
                }
            },
        )
        lateinit var setVisible: (Boolean) -> Unit
        compose.setContent {
            var visible by androidx.compose.runtime.remember { mutableStateOf(true) }
            setVisible = { visible = it }
            MaterialTheme {
                if (visible) {
                    AsyncAndroidOutboxIndexComponent(binding = binding) { state, loading, load ->
                        Column {
                            Text(
                                text = state.label(),
                                modifier = Modifier.testTag("outbox-index-state"),
                            )
                            Button(
                                onClick = load,
                                enabled = !loading,
                                modifier = Modifier.testTag("outbox-index-load"),
                            ) {
                                Text("Load")
                            }
                        }
                    }
                }
            }
        }

        assertTrue(firstLoadEntered.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { setVisible(false) }
        firstLoadRelease.countDown()
        assertTrue(firstLoadFinished.await(5, TimeUnit.SECONDS))

        compose.runOnIdle { setVisible(true) }
        compose.waitUntil(5_000) {
            factoryCalls.get() == 2 &&
                compose.onAllNodesWithText("Ready 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("outbox-index-state").assertTextEquals("Ready 1")
    }
}

private fun AndroidOutboxIndexState.label(): String = when (this) {
    AndroidOutboxIndexState.Unloaded -> "Unloaded"
    is AndroidOutboxIndexState.Ready -> "Ready ${entries.size}"
    is AndroidOutboxIndexState.Unavailable -> "Unavailable ${code.name}"
}
