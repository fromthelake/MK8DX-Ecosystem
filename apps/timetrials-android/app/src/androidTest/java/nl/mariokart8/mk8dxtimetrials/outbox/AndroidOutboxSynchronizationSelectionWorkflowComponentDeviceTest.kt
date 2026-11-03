package nl.mariokart8.mk8dxtimetrials.outbox

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test

class AndroidOutboxSynchronizationSelectionWorkflowComponentDeviceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun recompositionRetainsOpaqueBindingAndDependencyReplacementResetsSelection() {
        val bindingA = binding()
        val bindingB = binding()
        val dependenciesA = dependencies("a")
        val dependenciesB = dependencies("b")
        val currentDependencies = mutableStateOf(dependenciesA)
        val recomposeMarker = mutableStateOf(0)
        lateinit var state: AndroidOutboxSynchronizationSelectionWorkflowState
        lateinit var accept: (AndroidOutboxSelectionResult) -> Unit
        lateinit var returnToSelection: () -> Unit

        compose.setContent {
            AndroidOutboxSynchronizationSelectionWorkflowComponent(
                dependencies = currentDependencies.value,
            ) { currentState, onSelectionResult, onReturn ->
                state = currentState
                accept = onSelectionResult
                returnToSelection = onReturn
                recomposeMarker.value.hashCode()
            }
        }

        compose.runOnIdle {
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                state,
            )
            accept(
                AndroidOutboxSelectionResult.Failed(
                    AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
                ),
            )
        }
        compose.runOnIdle {
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(
                    AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
                ),
                state,
            )
            accept(AndroidOutboxSelectionResult.Selected(bindingA))
        }
        compose.runOnIdle {
            assertSame(
                bindingA,
                (state as AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing)
                    .binding,
            )
            recomposeMarker.value += 1
        }
        compose.runOnIdle {
            assertSame(
                bindingA,
                (state as AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing)
                    .binding,
            )
            accept(AndroidOutboxSelectionResult.Selected(bindingB))
        }
        compose.runOnIdle {
            assertSame(
                bindingA,
                (state as AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing)
                    .binding,
            )
            returnToSelection()
        }
        compose.runOnIdle {
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                state,
            )
            accept(AndroidOutboxSelectionResult.Selected(bindingA))
        }

        lateinit var oldAccept: (AndroidOutboxSelectionResult) -> Unit
        compose.runOnIdle {
            oldAccept = accept
            currentDependencies.value = dependenciesB
        }
        compose.runOnIdle {
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                state,
            )
            oldAccept(AndroidOutboxSelectionResult.Selected(bindingB))
        }
        compose.runOnIdle {
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                state,
            )
        }
    }

    private fun dependencies(seed: String) = AndroidOutboxSynchronizationSelectionDependencies(
        indexBinding = AndroidOutboxIndexBinding(
            AndroidOutboxIndexActionsFactory {
                error("dependency $seed must remain passive")
            },
        ),
        selectionCoordinator = AndroidOutboxSelectionCoordinator {
            error("dependency $seed must not select automatically")
        },
    )

    private fun binding() = AndroidOutboxSynchronizationBinding(
        AndroidOutboxSynchronizationActionsFactory {
            error("workflow must not construct synchronization actions")
        },
    )
}
