package nl.mariokart8.mk8dxtimetrials.tournament

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The chat export is pasted into a group where people read it by heart, so its
 * exact shape is the contract. These expectations come from
 * `RulesEngine::exportWhatsApp` in the original Manager, not from the APK.
 */
class AndroidTournamentWhatsAppExportTest {
    private fun member(
        name: String,
        owner: String? = null,
        switchType: String = "ns1",
        seat: Int = 1,
        order: Int = seat,
    ) = AndroidTournamentMember(
        playerId = "player." + name.lowercase(),
        displayName = name,
        seatOrder = order,
        station = owner?.let {
            AndroidTournamentMemberStation(
                ownerPlayerId = "player." + it.lowercase(),
                ownerDisplayName = it,
                switchType = switchType,
                seatNumber = seat,
            )
        },
    )

    private fun standing(rank: Int, name: String, points: Int) = AndroidTournamentStanding(
        rank = rank,
        playerId = "player." + name.lowercase(),
        displayName = name,
        points = points,
        races = 4,
        wins = 1,
        bestRace = 1,
        complete = true,
    )

    private fun document(
        stage: String = "qualifier",
        members: List<AndroidTournamentMember> = emptyList(),
        rows: List<AndroidTournamentStanding> = emptyList(),
        groups: Int = 1,
    ): AndroidTournamentDocument {
        val base = androidTournamentParticipantsPreviewDocument()
        val built = (1..groups).map { sequence ->
            AndroidTournamentGroup(
                groupId = "$stage.$sequence",
                stage = stage,
                sequence = sequence,
                name = "Groep $sequence",
                locked = true,
                manualScoreSegments = 1,
                members = if (sequence == 1) members else emptyList(),
                races = emptyList(),
                manualScores = emptyList(),
                standings = AndroidTournamentStandings("manual", if (sequence == 1) rows else emptyList()),
            )
        }
        return base.copy(groups = built)
    }

    @Test
    fun theSeatLineCarriesItsSwitchMarkerAndOwner() {
        val text = androidTournamentWhatsAppText(
            document(members = listOf(
                member("Evan", owner = "Ben", seat = 1),
                member("Nova", owner = "Ben", seat = 2),
            )),
            "qualifier",
            AndroidWhatsAppExportMode.LAYOUT,
        )
        assertEquals(
            "Kwalificatiegroep 1\n— [NS1] Nintendo Switch van Ben: #1 Evan & #2 Nova",
            text,
        )
    }

    @Test
    fun aSecondSwitchGetsItsOwnMarkerAndTheFinalStageItsOwnTitle() {
        val text = androidTournamentWhatsAppText(
            document(stage = "final", members = listOf(member("Matteo", owner = "Valerio", switchType = "ns2"))),
            "final",
            AndroidWhatsAppExportMode.LAYOUT,
        )
        assertEquals(
            "Eindgroep 1\n— [NS2] Nintendo Switch van Valerio: #1 Matteo",
            text,
        )
    }

    @Test
    fun anOwnerNameThatAlreadyCarriesThePrefixIsNotDoubled() {
        assertEquals("Nintendo Switch van Ben", androidWhatsAppStationLabel("Nintendo Switch van Ben"))
        assertEquals("Nintendo Switch van Ben", androidWhatsAppStationLabel("Switch van Ben"))
        assertEquals("Nintendo Switch van Ben", androidWhatsAppStationLabel("Console Ben"))
        assertEquals("Nintendo Switch", androidWhatsAppStationLabel("   "))
    }

    @Test
    fun resultsAreNumberedFromOneWithTheScoreInBrackets() {
        val text = androidTournamentWhatsAppText(
            document(rows = listOf(standing(1, "Evan", 42), standing(2, "Nova", 38))),
            "qualifier",
            AndroidWhatsAppExportMode.RESULTS,
        )
        assertEquals("Kwalificatiegroep 1\nUitslag:\n#1 Evan (42 pt)\n#2 Nova (38 pt)", text)
    }

    @Test
    fun aScoreDropsItsTrailingZeros() {
        assertEquals("42", androidWhatsAppScoreText(42.0))
        assertEquals("38.5", androidWhatsAppScoreText(38.5))
        assertEquals("7.25", androidWhatsAppScoreText(7.25))
        assertEquals("-", androidWhatsAppScoreText(null))
    }

    @Test
    fun theAutoModePutsABlankLineBetweenSeatingAndResults() {
        val text = androidTournamentWhatsAppText(
            document(
                members = listOf(member("Evan", owner = "Ben")),
                rows = listOf(standing(1, "Evan", 42)),
            ),
            "qualifier",
            AndroidWhatsAppExportMode.AUTO,
        )
        assertEquals(
            "Kwalificatiegroep 1\n— [NS1] Nintendo Switch van Ben: #1 Evan\n\nUitslag:\n#1 Evan (42 pt)",
            text,
        )
    }

    @Test
    fun anEmptyExportSaysSoInTheOriginalWords() {
        val empty = androidTournamentParticipantsPreviewDocument().copy(groups = emptyList())
        assertEquals(
            "Geen kwalificatie-indeling gevonden.",
            androidTournamentWhatsAppText(empty, "qualifier", AndroidWhatsAppExportMode.LAYOUT),
        )
        assertEquals(
            "Geen eindgroep-uitslagen gevonden.",
            androidTournamentWhatsAppText(empty, "final", AndroidWhatsAppExportMode.RESULTS),
        )
        assertEquals(
            "Geen groepen gevonden.",
            androidTournamentWhatsAppText(empty, null, AndroidWhatsAppExportMode.AUTO),
        )
    }

    @Test
    fun aLayoutWithoutSeatsSaysItIsStillUnplaced() {
        val text = androidTournamentWhatsAppText(
            document(members = listOf(member("Evan"))),
            "qualifier",
            AndroidWhatsAppExportMode.LAYOUT,
        )
        assertEquals("Kwalificatiegroep 1\n— Nog geen plaatsing", text)
    }

    @Test
    fun groupsAreSeparatedByABlankLineAndNumberedFromTheirName() {
        val text = androidTournamentWhatsAppText(
            document(members = listOf(member("Evan", owner = "Ben")), groups = 2),
            "qualifier",
            AndroidWhatsAppExportMode.LAYOUT,
        )
        assertEquals(
            "Kwalificatiegroep 1\n— [NS1] Nintendo Switch van Ben: #1 Evan" +
                "\n\nKwalificatiegroep 2\n— Nog geen plaatsing",
            text,
        )
    }
}
