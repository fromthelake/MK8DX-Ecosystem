package nl.mariokart8.mk8dxtimetrials.outbox

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOutboxSynchronizationSelectionWorkflowTest {
    private val bindingA = binding()
    private val bindingB = binding()

    @Test
    fun fixedSelectionFailureRemainsSelectingUntilAValidBindingArrives() {
        val states = mutableListOf<AndroidOutboxSynchronizationSelectionWorkflowState>()
        val controller = AndroidOutboxSynchronizationSelectionWorkflowController(states::add)

        val failed = controller.acceptSelectionResult(
            AndroidOutboxSelectionResult.Failed(
                AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
            ),
        )
        assertEquals(
            AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(
                AndroidOutboxSelectionFailureCode.INDEX_UNAVAILABLE,
            ),
            failed,
        )

        val selected = controller.acceptSelectionResult(
            AndroidOutboxSelectionResult.Selected(bindingA),
        ) as AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing

        assertSame(bindingA, selected.binding)
        assertSame(selected, controller.currentState())
        assertEquals(listOf(failed, selected), states)
    }

    @Test
    fun activeOpaqueBindingCannotBeReplacedByAnotherSelectionResult() {
        val states = mutableListOf<AndroidOutboxSynchronizationSelectionWorkflowState>()
        val controller = AndroidOutboxSynchronizationSelectionWorkflowController(states::add)
        val selected = controller.acceptSelectionResult(
            AndroidOutboxSelectionResult.Selected(bindingA),
        )

        assertSame(
            selected,
            controller.acceptSelectionResult(AndroidOutboxSelectionResult.Selected(bindingB)),
        )
        assertSame(
            selected,
            controller.acceptSelectionResult(
                AndroidOutboxSelectionResult.Failed(
                    AndroidOutboxSelectionFailureCode.BINDING_UNAVAILABLE,
                ),
            ),
        )
        assertEquals(listOf(selected), states)
    }

    @Test
    fun explicitReturnClearsFailureOrBindingAndPermitsAnewSelection() {
        val states = mutableListOf<AndroidOutboxSynchronizationSelectionWorkflowState>()
        val controller = AndroidOutboxSynchronizationSelectionWorkflowController(states::add)
        controller.acceptSelectionResult(
            AndroidOutboxSelectionResult.Failed(
                AndroidOutboxSelectionFailureCode.INDEX_NOT_LOADED,
            ),
        )

        val clearedFailure = controller.returnToSelection()
        assertEquals(
            AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
            clearedFailure,
        )
        assertSame(clearedFailure, controller.returnToSelection())

        controller.acceptSelectionResult(AndroidOutboxSelectionResult.Selected(bindingA))
        val returned = controller.returnToSelection()
        val selectedAgain = controller.acceptSelectionResult(
            AndroidOutboxSelectionResult.Selected(bindingB),
        ) as AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing

        assertEquals(AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(), returned)
        assertSame(bindingB, selectedAgain.binding)
        assertEquals(5, states.size)
    }

    @Test
    fun concurrentTransitionsCannotPublishObserverStateOutOfOrder() {
        val observerStarted = CountDownLatch(1)
        val releaseObserver = CountDownLatch(1)
        val states = mutableListOf<AndroidOutboxSynchronizationSelectionWorkflowState>()
        val controller = AndroidOutboxSynchronizationSelectionWorkflowController { state ->
            if (state is AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing) {
                observerStarted.countDown()
                assertTrue(releaseObserver.await(5, TimeUnit.SECONDS))
            }
            states += state
        }
        val executor = Executors.newFixedThreadPool(2)
        try {
            val select = executor.submit<AndroidOutboxSynchronizationSelectionWorkflowState> {
                controller.acceptSelectionResult(
                    AndroidOutboxSelectionResult.Selected(bindingA),
                )
            }
            assertTrue(observerStarted.await(5, TimeUnit.SECONDS))
            val back = executor.submit<AndroidOutboxSynchronizationSelectionWorkflowState> {
                controller.returnToSelection()
            }
            assertFalse(back.isDone)

            releaseObserver.countDown()
            assertTrue(
                select.get(5, TimeUnit.SECONDS) is
                    AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing,
            )
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                back.get(5, TimeUnit.SECONDS),
            )
            assertEquals(
                listOf(
                    AndroidOutboxSynchronizationSelectionWorkflowState.Synchronizing(bindingA),
                    AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                ),
                states,
            )
            assertEquals(
                AndroidOutboxSynchronizationSelectionWorkflowState.Selecting(),
                controller.currentState(),
            )
        } finally {
            releaseObserver.countDown()
            executor.shutdownNow()
        }
    }

    private fun binding() = AndroidOutboxSynchronizationBinding(
        AndroidOutboxSynchronizationActionsFactory {
            error("workflow must not construct synchronization actions")
        },
    )
}
