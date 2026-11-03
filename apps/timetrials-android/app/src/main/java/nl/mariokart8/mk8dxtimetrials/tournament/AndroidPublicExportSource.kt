package nl.mariokart8.mk8dxtimetrials.tournament

/**
 * A public night, in the shape the exporter draws from.
 *
 * The picture builders take the operator's own document, because that is what
 * a Director has in front of them. A participant reading the public page has
 * the public document instead, and it carries the same facts under different
 * names. The site solves this with `tournamentExportSourceFromPublicEvent`;
 * this is the same conversion, so both clients draw the same picture from the
 * same night.
 *
 * The UTP cable numbers are the interesting part. They are not stored: they
 * are the order in which consoles first appear, qualifier groups before final
 * ones and each group in sequence, numbered 1..N. Both clients have to count
 * them the same way or the same evening prints different cable numbers on the
 * phone and on the site.
 */
internal fun androidExportDocumentFromPublicEvent(
    event: AndroidPublicTournamentEvent,
): AndroidTournamentDocument {
    val ordered = mutableListOf<String>()
    for (stage in listOf("qualifier", "final")) {
        event.groups
            .filter { it.stage == stage }
            .sortedBy { it.sequence }
            .forEach { group ->
                group.seating.sortedBy { it.seatOrder }.forEach { seat ->
                    val key = seat.stationOwnerDisplayName + "|" + seat.switchType
                    if (!ordered.contains(key)) ordered.add(key)
                }
            }
    }
    val cables = ordered.withIndex().associate { (index, key) -> key to index + 1 }

    val summary = AndroidTournamentSummary(
        tournamentId = event.tournamentId,
        name = event.name,
        editionNumber = event.editionNumber,
        eventDate = event.eventDate,
        startAtMs = event.startAtMs,
        timezone = event.timezone,
        stage = event.stage,
        workflowStep = event.workflowStep ?: 2,
        revision = 0,
        participantCount = event.participantCount,
        presentCount = event.participantCount,
        publicResults = event.stage == "finalized",
        affectsRating = false,
        updatedAtMs = 0,
    )

    val groups = event.groups
        .sortedWith(compareBy({ if (it.stage == "qualifier") 0 else 1 }, { it.sequence }))
        .map { group ->
            AndroidTournamentGroup(
                groupId = group.groupId,
                stage = group.stage,
                sequence = group.sequence,
                name = group.name,
                locked = true,
                manualScoreSegments = 0,
                members = group.seating.sortedBy { it.seatOrder }.map { seat ->
                    val key = seat.stationOwnerDisplayName + "|" + seat.switchType
                    AndroidTournamentMember(
                        // A Player who is not public has no identifier in the
                        // projection; the display name is what the picture
                        // prints, so a stable stand-in keeps the row intact.
                        playerId = seat.playerId ?: ("display:" + seat.displayName),
                        displayName = seat.displayName,
                        seatOrder = seat.seatOrder,
                        station = AndroidTournamentMemberStation(
                            ownerPlayerId = seat.stationOwnerPlayerId
                                ?: ("display:" + seat.stationOwnerDisplayName),
                            ownerDisplayName = seat.stationOwnerDisplayName,
                            switchType = seat.switchType,
                            seatNumber = seat.seatNumber,
                            utpCableNumber = cables[key],
                        ),
                    )
                },
                races = emptyList(),
                manualScores = emptyList(),
                standings = AndroidTournamentStandings(
                    source = "public",
                    rows = group.standings.sortedBy { it.rank }.map { row ->
                        AndroidTournamentStanding(
                            rank = row.rank,
                            playerId = row.playerId ?: ("display:" + row.displayName),
                            displayName = row.displayName,
                            points = row.points,
                            races = row.races,
                            wins = row.wins,
                            bestRace = 0,
                            complete = row.races > 0,
                        )
                    },
                ),
            )
        }

    // The picture prints each Player's SP rank and tints the tile with the
    // band that rank sits in, and it reads both from the participants - which
    // this conversion left empty, so every row on a picture shared from a
    // public page came out "#?" in the grey unknown tile. The projection does
    // carry the rank: it travels on each standing row.
    val ranked = event.groups
        .flatMap { group -> group.standings }
        .mapNotNull { row ->
            val id = row.playerId ?: ("display:" + row.displayName)
            AndroidTournamentParticipant(
                playerId = id,
                username = "",
                displayName = row.displayName,
                attendance = "present",
                hasSwitch1 = false,
                hasSwitch2 = false,
                seedRank = row.seedRank,
            ).takeIf { row.displayName.isNotBlank() }
        }
        .distinctBy { it.playerId }

    return AndroidTournamentDocument(
        schemaVersion = "mk8dx.public-tournament-event.v1",
        summary = summary,
        participants = ranked,
        stations = emptyList(),
        groups = groups,
        overall = emptyList(),
        lifecycle = emptyList(),
    )
}

/**
 * The pictures a public night actually has, and which of them is the one to
 * open on.
 *
 * The console derives its tabs from the step number, which a reader of the
 * public page does not have to hand. These derive them from the night itself,
 * exactly as the site does: a layout exists once somebody is seated, and a
 * result needs a race to have been driven - a standings row appears the moment
 * a Player is placed, points at zero, and offering that as "the result" made a
 * night at Step 5 look like a finished qualifier.
 */
internal fun androidPublicCheckpoints(
    event: AndroidPublicTournamentEvent,
): List<AndroidTournamentExportCheckpoint> {
    fun has(stage: String, mode: AndroidExportMode): Boolean = event.groups.any { group ->
        group.stage == stage && if (mode == AndroidExportMode.LAYOUT) {
            group.seating.isNotEmpty()
        } else {
            group.standings.any { it.races > 0 }
        }
    }
    return androidTournamentExportCheckpoints(10).filter { has(it.stage, it.mode) }
}

/**
 * Where the night stands, which is not always the newest picture on offer: a
 * stage's result counts only once every group in it has raced.
 */
internal fun androidPublicCurrentCheckpoint(
    event: AndroidPublicTournamentEvent,
): AndroidTournamentExportCheckpoint? {
    val checkpoints = androidPublicCheckpoints(event)
    fun complete(checkpoint: AndroidTournamentExportCheckpoint): Boolean {
        val groups = event.groups.filter { it.stage == checkpoint.stage }
        if (groups.isEmpty()) return false
        return if (checkpoint.mode == AndroidExportMode.LAYOUT) {
            groups.all { it.seating.isNotEmpty() }
        } else {
            groups.all { group -> group.standings.any { it.races > 0 } }
        }
    }
    return checkpoints.lastOrNull { complete(it) } ?: checkpoints.lastOrNull()
}

/**
 * Draws the night's current picture and hands it to whatever the reader shares
 * with. The same renderer the console uses, over the document this file builds
 * from the public night, so a participant pastes the drawing a Director would.
 */
internal fun androidSharePublicNight(
    context: android.content.Context,
    event: AndroidPublicTournamentEvent,
) {
    val checkpoint = androidPublicCurrentCheckpoint(event) ?: return
    runCatching {
        val document = androidExportDocumentFromPublicEvent(event)
        val model = when (checkpoint.mode) {
            AndroidExportMode.LAYOUT -> androidLayoutImageModel(document, checkpoint.stage, checkpoint.label)
            AndroidExportMode.RESULTS -> androidResultsImageModel(document, checkpoint.stage, checkpoint.label)
        }
        val minimums = androidExportMinimums(
            if (checkpoint.mode == AndroidExportMode.LAYOUT) "layout" else "results",
            isQualifier = checkpoint.stage != "final",
        )
        val ns1 = android.graphics.BitmapFactory.decodeResource(
            context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns1,
        )
        val ns2 = android.graphics.BitmapFactory.decodeResource(
            context.resources, nl.mariokart8.mk8dxtimetrials.R.drawable.mk8dx_ns2,
        )
        val bitmap = androidRenderExportImage(model, minimums, ns1, ns2)
        val bytes = androidExportImageBytes(bitmap)
        bitmap.recycle()
        ns1.recycle()
        ns2.recycle()
        val folder = java.io.File(context.cacheDir, "mk8dx-result-images").apply { mkdirs() }
        val file = java.io.File(
            folder,
            androidExportFileName(document, checkpoint.stage, checkpoint.mode),
        ).apply { writeBytes(bytes) }
        val uri = androidx.core.content.FileProvider.getUriForFile(
            context, context.packageName + ".result-image-provider", file,
        )
        context.startActivity(
            android.content.Intent.createChooser(
                android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "image/png"
                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                    // The picture already carries the names, the seats and
                    // the scores; the message only labels it.
                    putExtra(
                        android.content.Intent.EXTRA_TEXT,
                        androidExportShareCaption(document, checkpoint.stage, checkpoint.mode),
                    )
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
                "Deel afbeelding",
            ),
        )
    }
}
