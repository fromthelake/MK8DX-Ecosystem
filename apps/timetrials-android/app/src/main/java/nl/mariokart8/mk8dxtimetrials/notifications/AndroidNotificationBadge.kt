package nl.mariokart8.mk8dxtimetrials.notifications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * "Something about the inbox changed" - the one signal the bell listens to.
 *
 * The count on the bell was read on its own five-minute timer and nothing told
 * it anything. So reading every notification left the inbox saying "You're all
 * caught up" while the bell went on claiming three, for up to five minutes,
 * and the owner reasonably read that as the app being wrong. It was: the two
 * were asking the same server the same question at different moments and never
 * comparing notes.
 *
 * A revision rather than a count, deliberately. The server owns the number -
 * another phone, the site, or a background pass can change it just as easily -
 * so this says only *when* to ask again, and the answer still comes from the
 * one place that knows.
 */
internal object AndroidNotificationBadge {
    private val state = MutableStateFlow(0)

    /** Bumped by whatever changed the inbox: a read, or a new one arriving. */
    fun changed() {
        state.value += 1
    }

    val revision: StateFlow<Int> = state
}
