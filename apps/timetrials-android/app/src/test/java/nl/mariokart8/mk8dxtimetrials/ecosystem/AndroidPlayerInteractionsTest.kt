package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.notifications.androidDiceNotice
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The "You and <Player>" rules that do not need a screen (owner 2026-09-26). */
class AndroidPlayerInteractionsTest {
    private val en = AndroidProductLanguage.ENGLISH

    private fun game(
        kind: String,
        actor: String = "player.ben",
        detail: AndroidEngagementDetail? = null,
    ) = AndroidPlayerEngagement(
        engagementId = "player_engagement.abcdef", kind = kind,
        actorPlayerId = actor, recipientPlayerId = if (actor == "player.ben") "player.matteo" else "player.ben",
        detail = detail, createdAtMs = 1_900_000_000_000,
    )

    @Test
    fun `a duel waits for the roll back and a pre-duel roll never does`() {
        assertTrue(androidIsOpenGame(game("dice_roll", detail = AndroidEngagementDetail(face = 4, duel = true))))
        assertFalse(androidIsOpenGame(game("dice_roll", detail = AndroidEngagementDetail(face = 4))))
        assertFalse(androidIsOpenGame(game("dice_roll",
            detail = AndroidEngagementDetail(face = 4, duel = true, recipientFace = 2, outcome = "actor", respondedAtMs = 1))))
        assertTrue(androidIsOpenGame(game("rock_paper_scissors")))
        assertFalse(androidIsOpenGame(game("poke")))
    }

    @Test
    fun `head to head is counted from the viewer's side`() {
        val entries = listOf(
            game("rock_paper_scissors", detail = AndroidEngagementDetail(outcome = "actor", recipientHand = "rock")),
            game("rock_paper_scissors", actor = "player.matteo",
                detail = AndroidEngagementDetail(outcome = "actor", recipientHand = "rock")),
            game("rock_paper_scissors", detail = AndroidEngagementDetail(outcome = "draw", recipientHand = "rock")),
        )
        assertEquals(AndroidHeadToHead(1, 1, 1), androidHeadToHead(entries, "player.ben", "rock_paper_scissors"))
        assertEquals(AndroidHeadToHead(1, 1, 1), androidHeadToHead(entries, "player.matteo", "rock_paper_scissors"))
    }

    @Test
    fun `the history says what the viewer did and what is waiting`() {
        val open = game("dice_roll", detail = AndroidEngagementDetail(face = 5, duel = true))
        val sent = androidDescribeEngagement(open, "player.ben", "Matteo", en)
        assertEquals("You rolled 5 · Matteo still has to roll back", sent.text)
        assertEquals("Waiting", sent.status)
        val received = androidDescribeEngagement(open, "player.matteo", "Ben", en)
        assertEquals("Your turn", received.status)
        val done = game("dice_roll",
            detail = AndroidEngagementDetail(face = 5, duel = true, recipientFace = 6, outcome = "recipient", respondedAtMs = 1))
        val result = androidDescribeEngagement(done, "player.ben", "Matteo", en)
        assertEquals("You rolled 5 · Matteo rolled 6", result.text)
        assertEquals("Matteo won", result.status)
    }

    @Test
    fun `an old one-way roll says so and every line carries a status`() {
        val old = androidDescribeEngagement(game("dice_roll", detail = AndroidEngagementDetail(face = 4)), "player.ben", "Matteo", en)
        assertEquals("You rolled 4 · one-way roll from before duels", old.text)
        assertEquals("Old roll", old.status)
        assertEquals("Sent", androidDescribeEngagement(game("poke"), "player.ben", "Matteo", en).status)
        assertEquals("Received", androidDescribeEngagement(game("poke"), "player.matteo", "Ben", en).status)
    }

    @Test
    fun `each action card shows what was sent and where it stands`() {
        val now = 1_900_000_000_000
        val conversation = AndroidEngagementConversation(
            schemaVersion = "mk8dx.player-engagement-conversation.v1", playerId = "player.matteo", accepted = true,
            actions = mapOf(
                "poke" to AndroidEngagementAllowance(false, "cooldown", availableAtMs = now + 3_600_000),
                "dice_roll" to AndroidEngagementAllowance(false, "awaiting_answer"),
                "rock_paper_scissors" to AndroidEngagementAllowance(false, "awaiting_answer"),
                "challenge" to AndroidEngagementAllowance(true),
            ),
            engagements = listOf(
                game("dice_roll", detail = AndroidEngagementDetail(face = 6, duel = true)),
                game("rock_paper_scissors", detail = AndroidEngagementDetail(hand = "scissors")),
                game("rock_paper_scissors", detail = AndroidEngagementDetail(hand = "scissors")),
                game("poke"),
            ).map { it.copy(createdAtMs = now) },
        )
        val dice = androidCurrentStateNote("dice_roll", conversation, "player.ben", "Matteo", en, now)!!
        assertTrue(dice, dice.startsWith("You rolled 6 ") && dice.endsWith("waiting for Matteo to roll back."))
        val rps = androidCurrentStateNote("rock_paper_scissors", conversation, "player.ben", "Matteo", en, now)!!
        assertTrue(rps, rps.startsWith("You threw ✂️ ") && rps.endsWith("(2 games open)."))
        val poke = androidCurrentStateNote("poke", conversation, "player.ben", "Matteo", en, now)!!
        assertTrue(poke, poke.startsWith("You poked Matteo ") && poke.contains("next one at "))
        assertEquals(null, androidCurrentStateNote("challenge", conversation, "player.ben", "Matteo", en, now))
    }

    @Test
    fun `a dice notification reads the invitation and the answer`() {
        assertEquals("Ben rolled 4 — roll back to beat it", androidDiceNotice(en, "Ben", "4"))
        assertEquals("Ben rolled 3 against your 5 — you won", androidDiceNotice(en, "Ben", "3 vs 5"))
        assertEquals("Ben rolled 2 against your 2 — a draw", androidDiceNotice(en, "Ben", "2 vs 2"))
        assertEquals("Ben rolled a die", androidDiceNotice(en, "Ben", null))
    }
}
