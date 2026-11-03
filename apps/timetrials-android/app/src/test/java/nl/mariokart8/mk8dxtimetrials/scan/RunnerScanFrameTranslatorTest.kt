package nl.mariokart8.mk8dxtimetrials.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RunnerScanFrameTranslatorTest {
    private val fullFrame = """
        {
          "fields": {
            "player_total": "1:00.000",
            "player_lap_1": "0:20.000",
            "player_lap_2": "0:19.500",
            "player_lap_3": "0:20.500"
          },
          "lap_sum_ok": true,
          "lap_sum_repairs": 0,
          "expected_field_count": 4,
          "kart_config": {
            "status": "implemented",
            "owners": {
              "player": {
                "card_name": "Driver",
                "character": {
                  "id": "character.mario",
                  "name": "Mario",
                  "score": 0.91,
                  "ok": true,
                  "crop_path": "local-only.png"
                },
                "wheel": {"index": 13, "score": 0.8, "ok": true}
              }
            }
          }
        }
    """.trimIndent()

    private fun assertError(code: RunnerScanFrameErrorCode, value: String) {
        val error = assertThrows(RunnerScanFrameException::class.java) {
            translateRunnerScanFrame(value)
        }
        assertEquals(code, error.code)
        assertEquals("TT Scan runner frame is invalid.", error.message)
    }

    @Test
    fun translatesFullRunnerBridgeEnvelope() {
        val frame = translateRunnerScanFrame(fullFrame)

        assertEquals("1:00.000", frame.fields["player_total"])
        assertTrue(frame.lapSumAccepted)
        assertEquals(0, frame.lapSumRepairs)
        assertEquals(4, frame.expectedFieldCount)
        val player = frame.identityOwners?.get("player")
        assertEquals("Driver", player?.cardName)
        assertEquals("character.mario", player?.slots?.get(ScanIdentityKind.CHARACTER)?.id)
        assertEquals(13, player?.slots?.get(ScanIdentityKind.TIRE)?.index)
    }

    @Test
    fun translatesIdentityOnlyAndMissingIdentityFrames() {
        val identityOnly = translateRunnerScanFrame(
            fullFrame
                .replace(Regex("\\{\\s*\"player_total\".*?\"0:20.500\"\\s*}", RegexOption.DOT_MATCHES_ALL), "{}")
                .replace("\"lap_sum_ok\": true", "\"lap_sum_ok\": null"),
        )
        assertTrue(identityOnly.fields.isEmpty())
        assertFalse(identityOnly.lapSumAccepted)
        assertEquals("Driver", identityOnly.identityOwners?.get("player")?.cardName)

        val withoutIdentity = translateRunnerScanFrame(
            """{"fields":{},"lap_sum_ok":null,"lap_sum_repairs":0,"expected_field_count":0,"kart_config":null}""",
        )
        assertNull(withoutIdentity.identityOwners)
    }

    @Test
    fun preservesEmptyOwnersAsAnIdentityFrame() {
        val frame = translateRunnerScanFrame(
            """{"fields":{},"lap_sum_ok":false,"lap_sum_repairs":0,"expected_field_count":0,"kart_config":{"owners":{}}}""",
        )
        assertEquals(emptyMap<String, ScanIdentityOwnerFrame>(), frame.identityOwners)
    }

    @Test
    fun rejectsMalformedPrimitiveAndIdentityShapes() {
        assertError(RunnerScanFrameErrorCode.INVALID_JSON, "[]")
        assertError(
            RunnerScanFrameErrorCode.INVALID_FIELDS,
            fullFrame.replace("\"1:00.000\"", "60000"),
        )
        assertError(
            RunnerScanFrameErrorCode.INVALID_SHAPE,
            fullFrame.replace("\"lap_sum_repairs\": 0", "\"lap_sum_repairs\": -1"),
        )
        assertError(
            RunnerScanFrameErrorCode.INVALID_IDENTITY,
            fullFrame.replace("\"index\": 13", "\"index\": \"13\""),
        )
    }

    @Test
    fun ghostPanelRiderIsReadAsThePlayersRecord() {
        val ghostPanel = ScanConsensusFrame(
            fields = linkedMapOf(
                "ghost_total" to "1:26.574",
                "ghost_lap_1" to "0:30.310",
                "ghost_lap_2" to "0:29.022",
                "ghost_lap_3" to "0:27.242",
            ),
            lapSumAccepted = true,
            expectedFieldCount = 4,
            identityOwners = mapOf("ghost" to ScanIdentityOwnerFrame(cardName = "BEnZor")),
        )
        val read = ghostPanel.ghostPanelAsPlayer()
        assertEquals(
            listOf("player_total", "player_lap_1", "player_lap_2", "player_lap_3"),
            read.fields.keys.toList(),
        )
        assertEquals("1:26.574", read.fields["player_total"])
        assertEquals("BEnZor", read.identityOwners?.get("player")?.cardName)
        assertNull(read.identityOwners?.get("ghost"))
        assertTrue(read.lapSumAccepted)
    }

    @Test
    fun anEndScreenWithAPlayerCardIsLeftAlone() {
        val endScreen = ScanConsensusFrame(
            fields = linkedMapOf("player_total" to "1:00.000", "ghost_total" to "1:01.000"),
            identityOwners = mapOf(
                "player" to ScanIdentityOwnerFrame(cardName = "Me"),
                "ghost" to ScanIdentityOwnerFrame(cardName = "Them"),
            ),
        )
        assertEquals(endScreen, endScreen.ghostPanelAsPlayer())
        assertFalse(endScreen.ghostPanelAsPlayer().fields.keys.none { it.startsWith("ghost_") })
    }
}
