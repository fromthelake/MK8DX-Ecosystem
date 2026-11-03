package nl.mariokart8.mk8dxtimetrials.notifications

import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotification
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotificationPreferences
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCanonicalNotificationSyncTest {
    private fun overtaken(count: Int = 1) = AndroidNotification(
        notificationId = "41",
        kind = "overtaken",
        actorDisplayName = "Floyd",
        trackId = "track.mario_circuit",
        mode = 150,
        actorTimeMs = 116_331,
        recipientTimeMs = 116_942,
        deltaMs = -611,
        recipientRank = 4,
        count = count,
        lastEventAtMs = 1_900_000_000_000,
        read = false,
    )

    @Test
    fun `an overtake says who, how much, where, and where you now stand`() {
        val presentation = androidNotificationPresentation(overtaken())

        assertEquals("Floyd was 0,611s sneller op Mario Circuit", presentation.title)
        assertEquals(
            "150cc · 1:56.331 tegen jouw 1:56.942 · jij staat nu #4",
            presentation.body,
        )
    }

    @Test
    fun `an overtake reads the same in English`() {
        val presentation = androidNotificationPresentation(
            overtaken(), AndroidProductLanguage.ENGLISH,
        )

        assertEquals("Floyd beat your time on Mario Circuit by 0.611s", presentation.title)
        assertTrue(presentation.body.contains("vs your 1:56.942"))
        assertTrue(presentation.body.contains("you are now #4"))
    }

    @Test
    fun `the line a Player reads most, in both languages`() {
        // Matteo takes Ben's time on Big Blue: the one notification this
        // product sends more than any other, pinned word for word so it cannot
        // drift. The gap is the server's own (actor minus recipient), the
        // times are both there, and the rank is where the reader now stands.
        val overtake = AndroidNotification(
            notificationId = "88",
            kind = "overtaken",
            actorDisplayName = "Matteo",
            trackId = "track.big_blue",
            mode = 150,
            actorTimeMs = 112_891,
            recipientTimeMs = 113_402,
            deltaMs = -511,
            recipientRank = 2,
            count = 1,
            lastEventAtMs = 1_900_000_000_000,
            read = false,
        )

        val dutch = androidNotificationPresentation(overtake, AndroidProductLanguage.DUTCH)
        assertEquals("Matteo was 0,511s sneller op Big Blue", dutch.title)
        assertEquals("150cc · 1:52.891 tegen jouw 1:53.402 · jij staat nu #2", dutch.body)

        val english = androidNotificationPresentation(overtake, AndroidProductLanguage.ENGLISH)
        assertEquals("Matteo beat your time on Big Blue by 0.511s", english.title)
        assertEquals("150cc · 1:52.891 vs your 1:53.402 · you are now #2", english.body)

        // And where it goes: that track's standing, at the class it happened in.
        assertEquals("/?leaderboard=track.big_blue&mode=150&notification=88", dutch.link)
    }

    @Test
    fun `a world record says how many were broken and where the last one was`() {
        val one = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "50", kind = "world_record", trackId = "track.mario_circuit",
                mode = 200, actorTimeMs = 96_100, count = 1,
                lastEventAtMs = 1_900_000_000_000, read = false,
            ),
        )
        assertEquals("Nieuw wereldrecord op Mario Circuit", one.title)
        assertTrue(one.body.startsWith("200cc · 1:36.100"))

        val many = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "50", kind = "world_record", trackId = "track.mario_circuit",
                mode = 150, count = 49, lastEventAtMs = 1_900_000_000_000, read = false,
            ),
        )
        assertEquals("49 nieuwe wereldrecords", many.title)
        assertTrue(many.body.startsWith("laatst: Mario Circuit"))
    }

    @Test
    fun `a claim notification names the outcome the website names`() {
        fun title(kind: String, detail: String) = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "8", kind = kind, actorDisplayName = "Mal", detail = detail, count = 1,
                lastEventAtMs = 1_900_000_000_000, read = false,
            ),
        ).title

        assertEquals("Je koppelverzoek is goedgekeurd", title("claim_decided", "verified"))
        assertEquals("Een beoordelaar heeft een vraag over je koppelverzoek", title("claim_decided", "info_requested"))
        assertEquals("Je spelerkoppeling is verwijderd", title("claim_decided", "revoked"))
        assertEquals("Je spelerkoppeling is gesloten", title("claim_decided", "released"))
        assertEquals("Je koppelverzoek is afgewezen", title("claim_decided", "rejected"))
        assertEquals("Iemand wil gekoppeld worden aan Mal", title("claim_requested", "requested"))
        assertEquals("Antwoord op je vraag over Mal", title("claim_requested", "reply"))
        // ADR-0220: a request to host and its answer.
        assertEquals("Mal vraagt om toernooien te hosten", title("host_requested", "requested"))
        assertEquals("Je bent nu Directeur", title("host_request_decided", "approved"))
        assertEquals("Je verzoek om te hosten is afgewezen", title("host_request_decided", "declined"))
        val english = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "9", kind = "host_requested", detail = "requested", count = 1,
                lastEventAtMs = 1_900_000_000_000, read = false,
            ),
            nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage.ENGLISH,
        )
        assertEquals("Somebody asks to host Tournaments", english.title)
        assertEquals("/?admin=tournaments", english.link)
    }

    @Test
    fun `every kind carries the address the site would open`() {
        fun link(kind: String, track: String? = null, actor: String? = null): String? =
            androidNotificationLink(
                AndroidNotification(
                    notificationId = "7", kind = kind, trackId = track, mode = 150,
                    actorPlayerId = actor, count = 1,
                    lastEventAtMs = 1_900_000_000_000, read = false,
                ),
            )

        assertEquals(
            "/?leaderboard=track.mario_circuit&mode=150&notification=7",
            link("overtaken", track = "track.mario_circuit"),
        )
        assertEquals("/?notifications=1", link("overtaken"))
        assertEquals("/?admin=1", link("claim_requested"))
        assertEquals("/?settings=1", link("claim_decided"))
        assertEquals("/?admin=tournaments", link("host_requested"))
        assertEquals("/?tournaments=1", link("host_request_decided"))
        assertEquals("/?settings=1&section=groups", link("group_invited"))
        assertEquals("/?ranking=timetrials", link("world_record"))
        // Pokes and games open "You and <Player>" on the sender's page.
        assertEquals("/?player=player.nova#interactions", link("poke", actor = "player.nova"))
        assertEquals("/?player=player.nova#interactions", link("dice_roll", actor = "player.nova"))
        assertEquals("/?player=player.nova#interactions", link("rock_paper_scissors", actor = "player.nova"))
        assertEquals("/?notifications=1#player-games", link("poke"))
    }

    @Test
    fun `a reaction names the track it was about`() {
        val presentation = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "42",
                kind = "reaction_received",
                actorDisplayName = "Nova",
                trackId = "track.mario_circuit",
                mode = 200,
                count = 1,
                lastEventAtMs = 1_900_000_000_000,
                read = false,
            ),
        )
        assertEquals("Nova reageerde op je tijd op Mario Circuit", presentation.title)
        assertEquals("200cc", presentation.body)
    }

    @Test
    fun `an unknown kind still says something a person can act on`() {
        val presentation = androidNotificationPresentation(
            AndroidNotification(
                notificationId = "44", kind = "something_new", count = 1,
                lastEventAtMs = 1_900_000_000_000, read = false,
            ),
        )
        assertEquals("Nieuw in MK8DX", presentation.title)
        assertEquals("Open de app om het te lezen.", presentation.body)
        assertEquals("/?notifications=1", presentation.link)
    }

    @Test
    fun `product preferences suppress delivery without changing the canonical inbox`() {
        val disabled = AndroidNotificationPreferences(
            competitiveOvertaken = false,
            activityReactions = true,
        )

        assertEquals(false, androidDeliveryAllowed(overtaken(), disabled))
    }
}
