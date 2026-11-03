package nl.mariokart8.mk8dxtimetrials.tournament

/**
 * The night's report, derived - the same derivation the site does in
 * `tournament-report.ts`.
 *
 * Per group, per Player: the position after every race, the finish positions,
 * the gap to the top three, the duel with the Player one place up and the
 * spread of finishes. Nothing here is stored; it all comes out of the
 * published races. The charts are drawn from this, so the two clients have to
 * derive it identically or the same night reads differently on each.
 *
 * Kept free of Compose on purpose: it is arithmetic, and arithmetic is what
 * the tests beside it check.
 */

internal data class AndroidReportRaceRow(
    val raceNumber: Int,
    val trackId: String?,
    val position: Int,
    val racePoints: Int,
    val totalAfter: Int,
    /** The standing in the group after this race; equal totals share a rank. */
    val positionAfter: Int,
    val tiedAfter: Boolean,
)

internal data class AndroidReportBenchmarkPoint(
    /** This Player's total minus the one holding that place: positive is ahead. */
    val delta: Int,
    /** Who held the place after this race; empty when the group was that small. */
    val displayName: String,
    val playerTotal: Int,
    val benchmarkTotal: Int,
)

internal data class AndroidReportOpponent(
    val displayName: String,
    val groupRank: Int,
    /** This Player's total minus the opponent's, per shared race. */
    val deltas: List<Int>,
)

internal data class AndroidReportPlayer(
    val displayName: String,
    val playerId: String?,
    val character: AndroidPublicCharacter?,
    val groupName: String,
    val groupTierKey: String?,
    val groupRank: Int,
    val overallRank: Int?,
    val points: Int,
    val raceCount: Int,
    val winCount: Int,
    val top3Count: Int,
    val bestFinish: Int?,
    val avgFinish: Double?,
    val rows: List<AndroidReportRaceRow>,
    val benchmarkFirst: List<AndroidReportBenchmarkPoint>,
    val benchmarkSecond: List<AndroidReportBenchmarkPoint>,
    val benchmarkThird: List<AndroidReportBenchmarkPoint>,
    val opponent: AndroidReportOpponent?,
    /** Finishes per position, index 0 is first place. */
    val distribution: List<Int>,
)

internal data class AndroidReportGroup(
    val groupId: String,
    val name: String,
    val tierKey: String?,
    val stage: String,
    val players: List<AndroidReportPlayer>,
    val raceCount: Int,
)

internal data class AndroidTournamentReport(
    val groups: List<AndroidReportGroup>,
    /** The tracks driven most, when the races recorded their track. */
    val topTracks: List<Pair<String, Int>>,
    val raceCount: Int,
    val playerCount: Int,
    val maxPosition: Int,
)

/** The report of a night: the finals when they were raced, the qualifiers before that. */
internal fun androidTournamentReport(
    event: AndroidPublicTournamentEvent,
): AndroidTournamentReport {
    val finals = event.groups.filter { it.stage == "final" && it.races.isNotEmpty() }
    val source = finals.ifEmpty { event.groups.filter { it.races.isNotEmpty() } }
    val playerCount = if (event.overall.isNotEmpty()) {
        event.overall.size
    } else {
        event.groups.flatMap { group -> group.standings.map { it.displayName } }.toSet().size
    }
    val observedMax = event.groups
        .flatMap { group -> group.races.flatMap { race -> race.placements.map { it.finishPosition } } }
        .maxOrNull() ?: 0
    val maxPosition = maxOf(
        12,
        observedMax,
        source.maxOfOrNull { it.standings.size } ?: 0,
    )
    val overallRank = event.overall.associate { it.displayName to it.placement }
    val groups = source
        .sortedWith(compareBy({ if (it.stage == "qualifier") 0 else 1 }, { it.sequence }))
        .map { androidReportGroup(it, overallRank, maxPosition) }

    val trackCounts = linkedMapOf<String, Int>()
    for (group in source) {
        for (race in group.races) {
            val trackId = race.trackId ?: continue
            trackCounts[trackId] = (trackCounts[trackId] ?: 0) + 1
        }
    }
    val topTracks = trackCounts.entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(5)
        .map { it.key to it.value }

    return AndroidTournamentReport(
        groups = groups,
        topTracks = topTracks,
        raceCount = source.sumOf { it.races.size },
        playerCount = playerCount,
        maxPosition = maxPosition,
    )
}

private data class RaceSnapshot(
    val race: AndroidPublicRace,
    val totals: Map<String, Int>,
    val ranking: Map<String, Pair<Int, Boolean>>,
)

private fun androidReportGroup(
    group: AndroidPublicGroup,
    overallRank: Map<String, Int>,
    maxPosition: Int,
): AndroidReportGroup {
    val races = group.races.filter { it.countsTowardStandings }.sortedBy { it.raceNumber }
    val totals = linkedMapOf<String, Int>()
    group.standings.forEach { totals[it.displayName] = 0 }

    val perRace = mutableListOf<RaceSnapshot>()
    for (race in races) {
        for (placement in race.placements) {
            totals[placement.displayName] = (totals[placement.displayName] ?: 0) + placement.racePoints
        }
        val snapshot = LinkedHashMap(totals)
        // The standing's own order: total first, then the name, so two equal
        // totals always resolve the same way on both clients.
        val ordered = snapshot.entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .map { it.key to it.value }
        val ranking = linkedMapOf<String, Pair<Int, Boolean>>()
        ordered.forEachIndexed { index, (name, total) ->
            val sameAbove = index > 0 && ordered[index - 1].second == total
            val sameBelow = index < ordered.size - 1 && ordered[index + 1].second == total
            val rank = if (sameAbove) ranking[ordered[index - 1].first]!!.first else index + 1
            ranking[name] = rank to (sameAbove || sameBelow)
        }
        perRace.add(RaceSnapshot(race, snapshot, ranking))
    }

    fun rowsFor(name: String): List<AndroidReportRaceRow> = perRace.mapNotNull { entry ->
        val placement = entry.race.placements.firstOrNull { it.displayName == name } ?: return@mapNotNull null
        val standing = entry.ranking[name] ?: (0 to false)
        AndroidReportRaceRow(
            raceNumber = entry.race.raceNumber,
            trackId = entry.race.trackId,
            position = placement.finishPosition,
            racePoints = placement.racePoints,
            totalAfter = entry.totals[name] ?: 0,
            positionAfter = standing.first,
            tiedAfter = standing.second,
        )
    }

    /** Who held a place in the standing after a race, and their total. */
    fun topAfter(entry: RaceSnapshot, index: Int): Pair<String, Int> {
        val ordered = entry.totals.entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        val found = ordered.getOrNull(index) ?: return "" to 0
        return found.key to found.value
    }

    fun benchmarkFor(name: String, index: Int, entry: RaceSnapshot): AndroidReportBenchmarkPoint {
        val (heldName, heldTotal) = topAfter(entry, index)
        val own = entry.totals[name] ?: 0
        return AndroidReportBenchmarkPoint(own - heldTotal, heldName, own, heldTotal)
    }

    val players = group.standings.map { row ->
        val rows = rowsFor(row.displayName)
        val raced = perRace.filter { entry ->
            entry.race.placements.any { it.displayName == row.displayName }
        }
        val positions = rows.map { it.position }
        val distribution = (1..maxPosition).map { place -> positions.count { it == place } }
        val opponentRow = if (row.rank == 1) {
            group.standings.firstOrNull { it.rank == 2 }
        } else {
            group.standings.firstOrNull { it.rank == row.rank - 1 }
        }
        val opponent = opponentRow?.let { other ->
            AndroidReportOpponent(
                displayName = other.displayName,
                groupRank = other.rank,
                deltas = raced
                    .filter { entry -> entry.race.placements.any { it.displayName == other.displayName } }
                    .map { entry ->
                        (entry.totals[row.displayName] ?: 0) - (entry.totals[other.displayName] ?: 0)
                    },
            )
        }
        AndroidReportPlayer(
            displayName = row.displayName,
            playerId = row.playerId,
            character = row.character,
            groupName = group.name,
            groupTierKey = group.tierKey,
            groupRank = row.rank,
            overallRank = overallRank[row.displayName],
            points = row.points,
            raceCount = rows.size,
            winCount = positions.count { it == 1 },
            top3Count = positions.count { it <= 3 },
            bestFinish = positions.minOrNull(),
            avgFinish = if (positions.isEmpty()) null else positions.sum().toDouble() / positions.size,
            rows = rows,
            benchmarkFirst = raced.map { benchmarkFor(row.displayName, 0, it) },
            benchmarkSecond = raced.map { benchmarkFor(row.displayName, 1, it) },
            benchmarkThird = raced.map { benchmarkFor(row.displayName, 2, it) },
            opponent = if (opponent == null || opponent.deltas.isEmpty()) null else opponent,
            distribution = distribution,
        )
    }

    return AndroidReportGroup(
        groupId = group.groupId,
        name = group.name,
        tierKey = group.tierKey,
        stage = group.stage,
        players = players,
        raceCount = races.size,
    )
}

/**
 * The source's per-Player accent: a golden-angle hue per group rank, so twelve
 * Players in a group all read apart. The site computes the same hue.
 */
internal const val ANDROID_REPORT_ACCENT_COUNT = 12

internal fun androidReportAccentIndex(groupRank: Int): Int =
    (maxOf(1, groupRank) - 1) % ANDROID_REPORT_ACCENT_COUNT

internal fun androidReportAccentHue(groupRank: Int): Float =
    (Math.round(androidReportAccentIndex(groupRank) * 137.508) % 360).toFloat()

/** A number the way this reader reads one: 4,4 in Dutch, 4.4 in English. */
internal fun androidReportNumber(value: Double, digits: Int = 1, dutch: Boolean): String {
    val text = String.format(java.util.Locale.ROOT, "%." + digits + "f", value)
        .trimEnd('0').trimEnd('.')
    return if (dutch) text.replace('.', ',') else text
}

internal fun androidReportPercent(part: Int, whole: Int, dutch: Boolean): String {
    if (whole == 0) return "0%"
    return androidReportNumber(part.toDouble() / whole * 100, 1, dutch) + "%"
}
