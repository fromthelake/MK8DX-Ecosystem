package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** ADR-0220: "Request to host" on the Tournaments tab, the twin of the website's block. */
class AndroidDirectorHostRequestTest {
    private val open = """
        {"schemaVersion":"mk8dx.director-host-request.v1","administrator":false,"director":false,
         "request":{"requestId":"director_host_request.synthetic-1","status":"open","note":"Friday nights",
         "requestedAtMs":1790000000000,"decidedAtMs":null,"declineReason":null}}
    """.trimIndent()

    @Test
    fun `parses the standing and refuses another schema`() {
        val standing = parseAndroidHostRequestStanding(open)
        assertTrue(standing.showsCard())
        assertEquals("open", standing.request?.status)
        assertEquals("Friday nights", standing.request?.note)
        assertThrows(AndroidTournamentClientException::class.java) {
            parseAndroidHostRequestStanding(open.replace("director-host-request.v1", "director-host-request.v9"))
        }
    }

    @Test
    fun `administrators and Directors never see the card`() {
        val none = """{"schemaVersion":"mk8dx.director-host-request.v1","administrator":%s,"director":%s,"request":null}"""
        assertFalse(parseAndroidHostRequestStanding(none.format("true", "false")).showsCard())
        assertFalse(parseAndroidHostRequestStanding(none.format("false", "true")).showsCard())
        assertTrue(parseAndroidHostRequestStanding(none.format("false", "false")).showsCard())
    }

    @Test
    fun `says where the request stands, in English and Dutch`() {
        val request = parseAndroidHostRequestStanding(open).request
        val english = androidHostRequestStatusLine(AndroidProductLanguage.ENGLISH, request)!!
        assertTrue(english.startsWith("Request sent on "))
        assertTrue(english.endsWith(". The administrators will answer it."))
        assertTrue(androidHostRequestStatusLine(AndroidProductLanguage.DUTCH, request)!!.startsWith("Verzoek verstuurd op "))
        val declined = request!!.copy(status = "declined", decidedAtMs = 1_790_000_100_000, declineReason = "Run one night first")
        assertEquals("Declined: Run one night first", androidHostRequestStatusLine(AndroidProductLanguage.ENGLISH, declined))
        assertEquals("Afgewezen: Run one night first", androidHostRequestStatusLine(AndroidProductLanguage.DUTCH, declined))
        assertTrue(
            androidHostRequestStatusLine(AndroidProductLanguage.ENGLISH, declined.copy(declineReason = null))!!
                .startsWith("Declined on "),
        )
        assertNull(androidHostRequestStatusLine(AndroidProductLanguage.ENGLISH, null))
        assertNull(androidHostRequestStatusLine(AndroidProductLanguage.ENGLISH, request.copy(status = "approved")))
    }

    @Test
    fun `an empty note is no note`() {
        assertNull(androidHostRequestNote("   "))
        assertEquals("Friday nights", androidHostRequestNote("  Friday nights "))
    }
}
