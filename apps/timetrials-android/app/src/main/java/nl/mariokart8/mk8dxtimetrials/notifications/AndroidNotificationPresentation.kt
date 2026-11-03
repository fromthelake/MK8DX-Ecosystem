package nl.mariokart8.mk8dxtimetrials.notifications

import java.util.Locale
import nl.mariokart8.mk8dxtimetrials.ecosystem.AndroidNotification
import nl.mariokart8.mk8dxtimetrials.ecosystem.EngineContext
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText

/**
 * What a notification says, and where it opens.
 *
 * Two rules live here and they are the same two the site keeps in
 * `apps/timetrials-web/src/notification-section.ts`:
 *
 * - **what it is about.** A notification is read on a lock screen, in one
 *   glance, next to twenty others. The title has to name the thing that
 *   happened - who, what, which track, how much - and the body carries the
 *   numbers behind it. "Je MK8DX-activiteit is bijgewerkt" told the reader
 *   only that they had an app;
 * - **where it goes.** The link is the site's own address for that fact, and
 *   the phone hands it to `parseAndroidDeepLink`, so a tap lands on the same
 *   screen the same tap opens in a browser.
 *
 * Both are pure functions over one notification, which is what lets the tests
 * read a table of them.
 */
internal data class AndroidNotificationPresentation(
    val title: String,
    val body: String,
    /** The site's own address for this fact, or null when it has no page. */
    val link: String?,
)

/**
 * Where this notification opens, as a site address.
 *
 * The twin of `notificationLink` on the Web, down to the `&notification=` an
 * overtake carries so the reader who taps it is not told about it twice.
 */
internal fun androidNotificationLink(notification: AndroidNotification): String? {
    val track = notification.trackId
    // An unknown engine is left to the track page, which resolves it the way
    // the web does (EngineContext, R4) - never an invented 150.
    val leaderboard = track?.let { EngineContext.leaderboardLink(it, notification.mode) }
    return when (notification.kind) {
        "overtaken" -> track?.let {
            EngineContext.leaderboardLink(it, notification.mode, listOf("notification" to notification.notificationId))
        } ?: "/?notifications=1"
        "reaction_received", "result_published" -> leaderboard
        "claim_decided" -> "/?settings=1"
        "claim_requested" -> "/?admin=1"
        // ADR-0220: administrators answer requests to host on the website; the
        // person reads the answer on the Tournaments tab.
        "host_requested" -> "/?admin=tournaments"
        "host_request_decided" -> "/?tournaments=1"
        // ADR-0222: a change of the reader's sign-up opens that night's page.
        "tournament_signup_selected", "tournament_signup_moved_up", "tournament_signup_removed" ->
            notification.tournamentId?.takeIf { ANDROID_SIGNUP_TOURNAMENT_ID.matches(it) }
                ?.let { "/?tournaments=$it" } ?: "/?tournaments=1"
        "group_invited", "group_joined", "group_left", "group_removed", "group_role_changed" ->
            "/?settings=1&section=groups"
        "world_record" -> leaderboard ?: "/?ranking=timetrials"
        // Straight to "You and <Player>" on the sender's page, where the game is
        // answered and the history of the two is kept (owner 2026-09-26).
        "rock_paper_scissors", "dice_roll", "poke" ->
            notification.actorPlayerId?.let { "/?player=$it#interactions" } ?: "/?notifications=1#player-games"
        // A challenge names a track, and the point of it is the leaderboard.
        "challenge" -> leaderboard ?: notification.actorPlayerId?.let { "/?player=$it" }
        else -> "/?notifications=1"
    }
}

/**
 * A dice notification: an invitation carries the sender's face ("4"); an answer carries
 * "<their face> vs <yours>", so older builds still read something sensible. Twin of the Web's diceNotice.
 */
internal fun androidDiceNotice(language: AndroidProductLanguage, actor: String, detail: String?): String {
    val result = Regex("^(\\d) vs (\\d)$").matchEntire(detail ?: "")
    if (result != null) {
        val theirs = result.groupValues[1].toInt()
        val yours = result.groupValues[2].toInt()
        val verdict = when {
            theirs == yours -> androidText(language, "a draw", "gelijkspel")
            yours > theirs -> androidText(language, "you won", "jij wint")
            else -> androidText(language, "$actor won", "$actor wint")
        }
        return androidText(language, "$actor rolled $theirs against your $yours — $verdict",
            "$actor gooide $theirs tegen jouw $yours — $verdict")
    }
    return if (detail?.matches(Regex("^\\d$")) == true) {
        androidText(language, "$actor rolled $detail — roll back to beat it", "$actor gooide $detail — gooi terug om te winnen")
    } else {
        androidText(language, "$actor rolled a die", "$actor gooide een dobbelsteen")
    }
}

/** "1:59.317", or nothing when there is no time to show. */
internal fun androidNotificationTime(totalMs: Int?): String? {
    if (totalMs == null || totalMs <= 0) return null
    return String.format(
        Locale.US, "%d:%02d.%03d", totalMs / 60_000, (totalMs % 60_000) / 1000, totalMs % 1000,
    )
}

/** "0.412" in English, "0,412" in Dutch - a gap, never a sign. */
private fun gapText(language: AndroidProductLanguage, deltaMs: Int?): String? {
    if (deltaMs == null || deltaMs == 0) return null
    val seconds = String.format(Locale.US, "%.3f", kotlin.math.abs(deltaMs) / 1000.0)
    return if (language == AndroidProductLanguage.DUTCH) seconds.replace('.', ',') else seconds
}

internal fun androidNotificationPresentation(
    notification: AndroidNotification,
    language: AndroidProductLanguage = AndroidProductLanguage.DUTCH,
): AndroidNotificationPresentation {
    val actor = notification.actorDisplayName
        ?: androidText(language, "Somebody", "Iemand")
    val track = notification.trackId?.let { Schema9AndroidTrackCatalog.find(it)?.displayName }
    val mode = notification.mode?.let { "${it}cc" }
    val onTrack = track?.let { androidText(language, " on $it", " op $it") } ?: ""
    val gap = gapText(language, notification.deltaMs)
    val yours = androidNotificationTime(notification.recipientTimeMs)
    val theirs = androidNotificationTime(notification.actorTimeMs)
    val rank = notification.recipientRank
    val count = notification.count

    val (title, body) = when (notification.kind) {
        // The one that matters most: a rival took your time on a track. The
        // title says who, how much and where - the three things a reader wants
        // before they decide to open anything - and the body is the evidence:
        // the class, both times, and where they now stand.
        "overtaken" -> {
            val head = if (gap == null) {
                androidText(language, "$actor beat your time$onTrack", "$actor was sneller dan jij$onTrack")
            } else {
                androidText(
                    language,
                    "$actor beat your time$onTrack by ${gap}s",
                    "$actor was ${gap}s sneller$onTrack",
                )
            }
            head to listOfNotNull(
                mode,
                if (theirs != null && yours != null) {
                    androidText(language, "$theirs vs your $yours", "$theirs tegen jouw $yours")
                } else {
                    theirs
                },
                rank?.let { androidText(language, "you are now #$it", "jij staat nu #$it") },
                if (count > 1) androidText(language, "$count times", "$count keer") else null,
            ).joinToString(" · ")
        }
        // The other one the owner named: World Records. One entry counts every
        // record broken since it was last read, so it says how many rather than
        // naming one track as if it were the only one.
        "world_record" -> if (count > 1) {
            androidText(language, "$count new World Records", "$count nieuwe wereldrecords") to
                listOfNotNull(
                    androidText(language, "most recently", "laatst")
                        .let { last -> track?.let { "$last: $it" } ?: last },
                    mode,
                    theirs,
                ).joinToString(" · ")
        } else {
            androidText(
                language,
                "New World Record${track?.let { " on $it" } ?: ""}",
                "Nieuw wereldrecord${track?.let { " op $it" } ?: ""}",
            ) to listOfNotNull(
                mode,
                theirs,
                androidText(language, "tap to see the run", "tik om de run te bekijken"),
            ).joinToString(" · ")
        }
        "reaction_received" -> androidText(
            language,
            if (count > 1) "$count reactions on your ${track ?: "Time Trial"} time"
            else "$actor reacted to your ${track ?: "Time Trial"} time",
            if (count > 1) "$count reacties op je tijd${onTrack}"
            else "$actor reageerde op je tijd${onTrack}",
        ) to listOfNotNull(mode, yours).joinToString(" · ")
        "result_published" -> androidText(
            language,
            "Your ${track ?: "Time Trial"} time is published",
            "Je tijd${onTrack} staat online",
        ) to listOfNotNull(
            mode, yours, rank?.let { androidText(language, "#$it", "#$it") },
        ).joinToString(" · ")
        // The same outcomes the website names (ADR-0216): approval, decline, a question, revoke, release.
        "claim_decided" -> when (notification.detail) {
            "verified" -> androidText(language, "Your Player claim was approved", "Je koppelverzoek is goedgekeurd") to
                androidText(
                    language, "Your results now count for your Player.",
                    "Je resultaten tellen nu mee voor je speler.",
                )
            "info_requested" -> androidText(
                language, "A reviewer has a question about your Player claim",
                "Een beoordelaar heeft een vraag over je koppelverzoek",
            ) to androidText(language, "Answer it on the website under Settings.", "Beantwoord het op de website onder Instellingen.")
            "revoked" -> androidText(language, "Your Player link was removed", "Je spelerkoppeling is verwijderd") to
                androidText(language, "Open Settings for the reason.", "Open Instellingen voor de reden.")
            "released" -> androidText(language, "Your Player link was closed", "Je spelerkoppeling is gesloten") to
                androidText(language, "Open Settings for details.", "Open Instellingen voor details.")
            else -> androidText(language, "Your Player claim was declined", "Je koppelverzoek is afgewezen") to
                androidText(language, "Open Settings for the reason.", "Open Instellingen voor de reden.")
        }
        "claim_requested" -> if (notification.detail == "reply") {
            androidText(
                language, "An answer to your question about $actor", "Antwoord op je vraag over $actor",
            ) to androidText(language, "Decide on the website under Administration.", "Besluit op de website onder Beheer.")
        } else {
            androidText(
                language, "Somebody wants to be linked to $actor", "Iemand wil gekoppeld worden aan $actor",
            ) to androidText(language, "Decide on the website under Administration.", "Besluit op de website onder Beheer.")
        }
        // "Request to host" (ADR-0220): the same words the website uses.
        "host_requested" -> (
            notification.actorDisplayName?.let {
                androidText(language, "$it asks to host Tournaments", "$it vraagt om toernooien te hosten")
            } ?: androidText(language, "Somebody asks to host Tournaments", "Iemand vraagt om toernooien te hosten")
            ) to androidText(
            language,
            "Decide on the website under Administration → Tournaments → Directors.",
            "Besluit op de website onder Beheer → Toernooien → Directeuren.",
        )
        "host_request_decided" -> if (notification.detail == "approved") {
            androidText(language, "You are now a Director", "Je bent nu Directeur") to
                androidText(language, "You can host Tournaments now.", "Je kunt nu toernooien hosten.")
        } else {
            androidText(language, "Your request to host was declined", "Je verzoek om te hosten is afgewezen") to
                androidText(language, "Open Tournaments for the reason.", "Open Toernooien voor de reden.")
        }
        // Open sign-up (ADR-0222): the same words the website uses, with the night's name.
        "tournament_signup_selected", "tournament_signup_moved_up", "tournament_signup_removed" ->
            androidSignupNotificationTitle(language, notification.kind, notification.detail, notification.tournamentName) to
                (notification.tournamentName ?: "")
        "group_invited" -> androidText(
            language,
            "$actor invited you to ${notification.groupName ?: "a Group"}",
            "$actor nodigde je uit voor ${notification.groupName ?: "een groep"}",
        ) to androidText(language, "Open Settings to accept.", "Open Instellingen om te accepteren.")
        "group_joined" -> androidText(
            language,
            "$actor joined ${notification.groupName ?: "your Group"}",
            "$actor kwam bij ${notification.groupName ?: "je groep"}",
        ) to (notification.groupName ?: "")
        "group_left" -> androidText(
            language,
            "$actor left ${notification.groupName ?: "your Group"}",
            "$actor verliet ${notification.groupName ?: "je groep"}",
        ) to (notification.groupName ?: "")
        "group_removed" -> if (notification.detail == "archived") {
            androidText(
                language,
                "${notification.groupName ?: "A Group"} was archived",
                "${notification.groupName ?: "Een groep"} is gearchiveerd",
            ) to ""
        } else {
            androidText(
                language,
                "You were removed from ${notification.groupName ?: "a Group"}",
                "Je bent verwijderd uit ${notification.groupName ?: "een groep"}",
            ) to ""
        }
        "group_role_changed" -> androidText(
            language,
            "Your role in ${notification.groupName ?: "a Group"} changed",
            "Je rol in ${notification.groupName ?: "een groep"} is gewijzigd",
        ) to (notification.detail ?: "")
        "poke" -> (
            if (count > 1) {
                androidText(language, "$actor poked you $count times", "$actor porde je $count keer")
            } else {
                androidText(language, "$actor poked you", "$actor gaf je een por")
            }
            ) to androidText(language, "Open to poke back.", "Open om terug te porren.")
        "rock_paper_scissors" -> androidText(
            language,
            if (notification.detail == "result") "$actor answered your game" else "$actor challenged you to rock-paper-scissors",
            if (notification.detail == "result") "$actor beantwoordde je spel" else "$actor daagt je uit voor steen-papier-schaar",
        ) to if (notification.detail == "result") {
            androidText(language, "Open to see who won.", "Open om te zien wie won.")
        } else {
            androidText(language, "Open to choose your hand.", "Open om je zet te kiezen.")
        }
        "dice_roll" -> androidDiceNotice(language, actor, notification.detail) to
            if (notification.detail?.matches(Regex("^\\d$")) == true) {
                androidText(language, "Open to roll back.", "Open om terug te gooien.")
            } else {
                "🎲 ${notification.detail ?: "?"}"
            }
        "challenge" -> androidText(
            language, "$actor challenged you$onTrack", "$actor daagde je uit$onTrack",
        ) to listOfNotNull(
            mode, theirs?.let { androidText(language, "beat $it", "verbeter $it") },
        ).joinToString(" · ")
        else -> androidText(language, "New in MK8DX", "Nieuw in MK8DX") to
            androidText(language, "Open the app to read it.", "Open de app om het te lezen.")
    }
    return AndroidNotificationPresentation(
        title = title,
        body = body.ifBlank {
            androidText(language, "Open MK8DX for the details.", "Open MK8DX voor de details.")
        },
        link = androidNotificationLink(notification),
    )
}

internal val ANDROID_SIGNUP_TOURNAMENT_ID = Regex("^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

/** A change of the reader's own sign-up (ADR-0222), the twin of the website's `signupTitle`. */
internal fun androidSignupNotificationTitle(
    language: nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage,
    kind: String,
    detail: String?,
    night: String?,
): String = when {
    kind == "tournament_signup_removed" -> if (night == null) {
        androidText(language, "The Director took you off the list", "De Directeur heeft je van de lijst gehaald")
    } else {
        androidText(language, "The Director took you off the list for $night", "De Directeur heeft je van de lijst voor $night gehaald")
    }
    kind == "tournament_signup_moved_up" -> if (night == null) {
        androidText(language, "You moved up from the waiting list: you're in", "Je bent van de wachtlijst doorgeschoven: je doet mee")
    } else {
        androidText(language, "You moved up from the waiting list: you're in for $night", "Je bent van de wachtlijst doorgeschoven: je doet mee aan $night")
    }
    detail == "waiting" -> if (night == null) {
        androidText(language, "You're on the waiting list", "Je staat op de wachtlijst")
    } else {
        androidText(language, "You're on the waiting list for $night", "Je staat op de wachtlijst voor $night")
    }
    else -> if (night == null) {
        androidText(language, "You're in", "Je doet mee")
    } else {
        androidText(language, "You're in for $night", "Je doet mee aan $night")
    }
}
