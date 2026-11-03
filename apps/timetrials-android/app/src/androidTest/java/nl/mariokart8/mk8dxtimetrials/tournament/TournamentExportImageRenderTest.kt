package nl.mariokart8.mk8dxtimetrials.tournament

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.BitmapFactory
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Draws the shareable pictures on a device and leaves them where they can be
 * looked at. The content is covered by unit tests; this is what proves the
 * drawing itself produces a real PNG rather than an empty or broken one.
 */
@RunWith(AndroidJUnit4::class)
class TournamentExportImageRenderTest {

    private val document = exportDocument()

    private fun render(name: String, model: AndroidExportImageModel, minimums: List<Float>) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val ns1 = BitmapFactory.decodeResource(context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns1)
        val ns2 = BitmapFactory.decodeResource(context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns2)
        val bitmap = androidRenderExportImage(model, minimums, ns1, ns2)
        assertTrue("breedte", bitmap.width > 600)
        assertTrue("hoogte", bitmap.height > 300)
        val bytes = androidExportImageBytes(bitmap)
        assertTrue("png-signatuur", bytes.size > 5000)
        val folder = File(
            context.getExternalFilesDir(null),
            "export-images",
        ).apply { mkdirs() }
        File(folder, name).writeBytes(bytes)
        bitmap.recycle()
        ns1.recycle()
        ns2.recycle()
    }

    @Test
    fun rendersEveryBoardTheOwnerAskedToReviewSeparately() {
        render(
            "stap4-indeling.png",
            androidLayoutImageModel(document, "qualifier", "Kwalificatie-indeling"),
            androidExportMinimums("layout", isQualifier = true),
        )
        render(
            "stap6-uitslag.png",
            androidResultsImageModel(document, "qualifier", "Kwalificatie-uitslag"),
            androidExportMinimums("results", isQualifier = true),
        )
        render(
            "stap8-indeling.png",
            androidLayoutImageModel(document, "final", "Eindgroep-indeling"),
            androidExportMinimums("layout", isQualifier = false),
        )
        render(
            "stap10-uitslag.png",
            androidResultsImageModel(document, "final", "Eindgroep-uitslag"),
            androidExportMinimums("results", isQualifier = false),
        )
    }

    private fun exportDocument(): AndroidTournamentDocument {
        val base = groupBoardDocument(locked = true)
        val qualifierGroups = base.groups.mapIndexed { index, group ->
            group.copy(standings = standingsFor(group, offset = index * 100))
        }
        val finalGroups = qualifierGroups.mapIndexed { index, group ->
            group.copy(
                groupId = "final.${index + 1}",
                stage = "final",
                name = listOf("Kampioen", "Talent").getOrElse(index) { "Eindgroep ${index + 1}" },
                tierKey = listOf("champion", "talent").getOrElse(index) { "unknown" },
                standings = standingsFor(group, offset = 200 + index * 100),
            )
        }
        return base.copy(
            summary = base.summary.copy(
                name = "PORTREF Stepport",
                eventDate = "2026-03-27",
                workflowStep = 10,
            ),
            groups = qualifierGroups + finalGroups,
        )
    }

    private fun standingsFor(group: AndroidTournamentGroup, offset: Int): AndroidTournamentStandings =
        AndroidTournamentStandings(
            source = "manual",
            rows = group.members.mapIndexed { index, member ->
                AndroidTournamentStanding(
                    rank = index + 1,
                    playerId = member.playerId,
                    displayName = member.displayName,
                    points = offset + 150 - index * 12,
                    races = 12,
                    wins = if (index == 0) 4 else 1,
                    bestRace = index + 1,
                    complete = true,
                )
            },
        )
}
