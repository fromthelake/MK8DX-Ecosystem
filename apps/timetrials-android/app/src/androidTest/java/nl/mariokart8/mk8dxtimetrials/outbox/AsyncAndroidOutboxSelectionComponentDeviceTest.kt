package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AsyncAndroidOutboxSelectionComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    private val validKey = "a".repeat(64)
    private val invalidKey = "A".repeat(64)

    @Test
    fun automaticallyLoadedCurrentIndexForwardsOnlyOpaqueOrFixedResult() {
        val indexFactoryCalls = AtomicInteger(0)
        val bindingFactoryKeys = mutableListOf<String>()
        val selectionResults = mutableListOf<AndroidOutboxSelectionResult>()
        val synchronizationBinding = AndroidOutboxSynchronizationBinding(
            AndroidOutboxSynchronizationActionsFactory {
                error("synchronization actions must remain opaque")
            },
        )
        val indexBinding = AndroidOutboxIndexBinding(
            AndroidOutboxIndexActionsFactory {
                val call = indexFactoryCalls.incrementAndGet()
                AndroidOutboxIndexActions {
                    if (call == 1) ready(validKey) else ready(invalidKey)
                }
            },
        )
        val selectionCoordinator = AndroidOutboxSelectionCoordinator { key ->
            bindingFactoryKeys += key
            synchronizationBinding
        }
        lateinit var recompose: () -> Unit
        compose.setContent {
            val marker = androidx.compose.runtime.remember { mutableStateOf(0) }
            recompose = { marker.value += 1 }
            MaterialTheme {
                AsyncAndroidOutboxSelectionComponent(
                    indexBinding = indexBinding,
                    selectionCoordinator = selectionCoordinator,
                    labelProvider = { entry ->
                        if (entry.entryKeyHash == validKey) {
                            "Valid saved result"
                        } else {
                            "Invalid saved result"
                        }
                    },
                    onSelectionResult = selectionResults::add,
                )
            }
            marker.value.hashCode()
        }

        assertEquals(emptyList<String>(), bindingFactoryKeys)
        assertEquals(emptyList<AndroidOutboxSelectionResult>(), selectionResults)

        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Valid saved result").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("outbox-selection-select-0").performClick()

        assertEquals(listOf(validKey), bindingFactoryKeys)
        assertEquals(1, selectionResults.size)
        val selected = selectionResults.single() as AndroidOutboxSelectionResult.Selected
        assertSame(synchronizationBinding, selected.binding)

        compose.runOnIdle(recompose)
        compose.onNodeWithTag("outbox-selection-row-label-0")
            .assertTextEquals("Valid saved result")
        assertEquals(1, indexFactoryCalls.get())

        compose.onNodeWithTag("outbox-selection-load").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Invalid saved result").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("outbox-selection-select-0").performClick()

        assertEquals(listOf(validKey), bindingFactoryKeys)
        assertEquals(
            AndroidOutboxSelectionResult.Failed(
                AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
            ),
            selectionResults.last(),
        )
        assertEquals(2, selectionResults.size)
        assertEquals(2, indexFactoryCalls.get())
    }

    private fun ready(key: String) = AndroidOutboxIndexState.Ready(
        listOf(
            AndroidOutboxIndexEntry(
                entryKeyHash = key,
                createdAtMs = 1_786_900_000_000,
                storedState = AndroidOutboxStoredState.PENDING,
                stateRevision = 1,
                attemptCount = 0,
            ),
        ),
    )
}
