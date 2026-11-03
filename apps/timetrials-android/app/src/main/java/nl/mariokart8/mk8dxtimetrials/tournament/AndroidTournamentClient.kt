package nl.mariokart8.mk8dxtimetrials.tournament

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.putJsonArray
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession

private const val MAX_TOURNAMENT_RESPONSE_BYTES = 3 * 1024 * 1024

@Serializable
internal data class AndroidTournamentSummary(
    val tournamentId: String,
    val name: String,
    val seriesLabel: String? = null,
    val editionNumber: Int? = null,
    val eventDate: String? = null,
    val startAtMs: Long? = null,
    val timezone: String? = null,
    val stage: String,
    val workflowStep: Int = 2,
    val qualifierRounds: Boolean = true,
    /** ADR-0221: where the qualifier draw takes its order from (the one seeding field). */
    val seedingSource: String = "community_rating",
    /** ADR-0221: only Players with a verified claim count for the rating from this night. */
    val verifiedOnly: Boolean = false,
    val placementStrategy: String = "balanced",
    val ownerSeatingMode: String = "owner_strict",
    val qualifierTieBreakMode: String = "sp",
    val finalTieBreakMode: String = "sp",
    val maxParticipants: Int? = null,
    val revision: Int,
    val scoringSegment: Int = 1,
    val sourceKind: String = "unknown",
    val scoringNote: String? = null,
    val participantCount: Int,
    val presentCount: Int,
    val publicResults: Boolean,
    val affectsRating: Boolean,
    val updatedAtMs: Long,
) {
    /** ADR-0221: community_rating, director_nights, manual or random. */
    val effectiveSeedingSource: String
        get() = seedingSource.takeIf { it in TOURNAMENT_SEEDING_SOURCES } ?: "community_rating"
}

/** ADR-0221: where the qualifier draw takes its order from. */
internal val TOURNAMENT_SEEDING_SOURCES = listOf("community_rating", "director_nights", "manual", "random")

/**
 * ADR-0221 installation settings (`mk8dx.installation-settings.v1`). An
 * unknown value falls back to the default (everybody creates and counts), so
 * a newer server never takes a button away by accident.
 */
internal data class AndroidInstallationSettings(
    val playerCreation: String = "self_and_directors",
    val ratingEligibility: String = "all_players",
) {
    val directorsMayCreatePlayers: Boolean get() = playerCreation != "self_only"

    companion object {
        val DEFAULTS = AndroidInstallationSettings()

        fun decode(payload: String): AndroidInstallationSettings {
            val document = Json.parseToJsonElement(payload).jsonObject
            if (document["schemaVersion"]?.jsonPrimitive?.content != "mk8dx.installation-settings.v1") {
                throw AndroidTournamentClientException(message = "Tournament response contract mismatch")
            }
            val creation = document["playerCreation"]?.jsonPrimitive?.content
            val eligibility = document["ratingEligibility"]?.jsonPrimitive?.content
            return AndroidInstallationSettings(
                playerCreation = creation?.takeIf { it in setOf("self_and_directors", "self_only", "directors_only") }
                    ?: "self_and_directors",
                ratingEligibility = eligibility?.takeIf { it in setOf("all_players", "claimed_only") } ?: "all_players",
            )
        }
    }
}

/** ADR-0221: the server refused roster Player creation because only self sign-up creates Players. */
internal const val PLAYER_CREATION_DIRECTORS_DISABLED = "player_creation_directors_disabled"

/** One row of a roster import; a null field keeps the roster's value. */
internal data class AndroidParticipantImportRow(
    val playerId: String,
    val attendance: String? = null,
    val hasSwitch1: Boolean? = null,
    val hasSwitch2: Boolean? = null,
)

@Serializable
internal data class AndroidTournamentParticipant(
    val playerId: String,
    val username: String,
    val displayName: String,
    val attendance: String,
    val hasSwitch1: Boolean,
    val hasSwitch2: Boolean,
    val inactive: Boolean = false,
    /** ADR-0177 decision 18: Nieuw is its own state, not a kind of Inactief. */
    val isNew: Boolean = false,
    val seedScore: Double? = null,
    val seedRank: Int? = null,
)

@Serializable
internal data class AndroidTournamentStation(
    val ownerPlayerId: String,
    val ownerDisplayName: String,
    val switchType: String,
    val utpCableNumber: Int? = null,
)

/** A console in a group's slot, stored in slot order - present before anybody sits at it. */
@Serializable
internal data class AndroidTournamentGroupStation(
    val slotIndex: Int,
    val ownerPlayerId: String,
    val ownerDisplayName: String,
    val switchType: String,
    val utpCableNumber: Int? = null,
)

@Serializable
internal data class AndroidTournamentMemberStation(
    val ownerPlayerId: String,
    val ownerDisplayName: String,
    val switchType: String,
    val seatNumber: Int,
    val utpCableNumber: Int? = null,
)

@Serializable
internal data class AndroidTournamentMember(
    val playerId: String,
    val displayName: String,
    val seatOrder: Int,
    val station: AndroidTournamentMemberStation? = null,
    /**
     * The character this Player drove, as the score workbook recorded it. The
     * document has carried it since 2026-09-15; the phone dropped it on the
     * floor, so its Step 5/9 table could not show what the Web console shows.
     */
    val character: AndroidPublicCharacter? = null,
)

@Serializable
internal data class AndroidTournamentPlacement(
    val finishPosition: Int,
    val playerId: String,
    val displayName: String,
    val racePoints: Int,
)

@Serializable
internal data class AndroidTournamentRace(
    val raceNumber: Int,
    val raceResultId: String,
    val revision: Int,
    val trackId: String,
    val mode: Int? = null,
    val countsTowardStandings: Boolean,
    val placements: List<AndroidTournamentPlacement>,
)

@Serializable
internal data class AndroidTournamentStanding(
    val rank: Int,
    val playerId: String,
    val displayName: String,
    val points: Int,
    val races: Int,
    val wins: Int,
    val bestRace: Int,
    val complete: Boolean,
    /** What the races said, when a hand correction moved the total away from it. */
    val correctedFromRaces: Int? = null,
)

@Serializable
internal data class AndroidTournamentStandings(
    val source: String,
    val rows: List<AndroidTournamentStanding>,
    val tieGroups: List<AndroidTournamentTieGroup> = emptyList(),
)

@Serializable
internal data class AndroidTournamentTiePlayer(
    val playerId: String,
    val displayName: String,
    val wins: Int,
    val bestRace: Int,
)

@Serializable
internal data class AndroidTournamentTieGroup(
    val points: Int,
    val resolved: Boolean,
    val players: List<AndroidTournamentTiePlayer>,
)

@Serializable
internal data class AndroidTournamentManualScore(
    val playerId: String,
    val segmentPoints: List<Int?>,
)

@Serializable
internal data class AndroidTournamentGroup(
    val groupId: String,
    val stage: String,
    val sequence: Int,
    val name: String,
    val tierKey: String? = null,
    val locked: Boolean,
    val manualScoreSegments: Int,
    val members: List<AndroidTournamentMember>,
    val stations: List<AndroidTournamentGroupStation> = emptyList(),
    val races: List<AndroidTournamentRace>,
    val manualScores: List<AndroidTournamentManualScore>,
    val standings: AndroidTournamentStandings,
)

internal data class AndroidTournamentGroupMembership(
    val groupId: String,
    val members: List<String>,
)

internal fun tournamentGroupsAfterMove(
    groups: List<AndroidTournamentGroup>,
    stage: String,
    playerId: String,
    targetGroupId: String?,
): List<AndroidTournamentGroupMembership> {
    val stageGroups = groups.filter { it.stage == stage }
    require(stageGroups.isNotEmpty()) { "This stage has no groups" }
    val target = targetGroupId?.let { id -> stageGroups.firstOrNull { it.groupId == id } }
    require(targetGroupId == null || target != null) { "The target group does not exist" }
    val alreadyInTarget = target?.members?.any { it.playerId == playerId } == true
    require(alreadyInTarget || target == null || target.members.size < 12) { "The target group is full" }
    return stageGroups.map { group ->
        AndroidTournamentGroupMembership(
            groupId = group.groupId,
            members = if (group.groupId == targetGroupId && alreadyInTarget) {
                group.members.map { it.playerId }
            } else {
                group.members.map { it.playerId }.filterNot { it == playerId } +
                    if (group.groupId == targetGroupId) listOf(playerId) else emptyList()
            },
        )
    }
}

/** The source Step 7 admin override swaps two Players; it never transfers one. */
internal fun tournamentGroupsAfterSwap(
    groups: List<AndroidTournamentGroup>,
    stage: String,
    firstPlayerId: String,
    secondPlayerId: String,
): List<AndroidTournamentGroupMembership> {
    require(firstPlayerId != secondPlayerId) { "choose two different Players" }
    val stageGroups = groups.filter { it.stage == stage }
    val firstGroup = stageGroups.firstOrNull { group ->
        group.members.any { it.playerId == firstPlayerId }
    } ?: error("the first Player is not in this stage")
    val secondGroup = stageGroups.firstOrNull { group ->
        group.members.any { it.playerId == secondPlayerId }
    } ?: error("the second Player is not in this stage")
    require(firstGroup.groupId != secondGroup.groupId) { "choose Players from different groups" }
    return stageGroups.map { group ->
        AndroidTournamentGroupMembership(
            groupId = group.groupId,
            members = group.members.map { member ->
                when (member.playerId) {
                    firstPlayerId -> secondPlayerId
                    secondPlayerId -> firstPlayerId
                    else -> member.playerId
                }
            },
        )
    }
}

@Serializable
internal data class AndroidTournamentOverallRow(
    val placement: Int,
    val playerId: String,
    val displayName: String,
    val groupName: String,
    val groupRank: Int,
    val points: Int,
)

@Serializable
internal data class AndroidTournamentLifecycle(
    val sequence: Int,
    val eventType: String,
    val detail: String? = null,
    val occurredAtMs: Long,
)

@Serializable
internal data class AndroidTournamentDocument(
    val schemaVersion: String,
    val summary: AndroidTournamentSummary,
    val participants: List<AndroidTournamentParticipant>,
    val stations: List<AndroidTournamentStation>,
    val groups: List<AndroidTournamentGroup>,
    val overall: List<AndroidTournamentOverallRow>,
    val lifecycle: List<AndroidTournamentLifecycle>,
)

@Serializable
private data class AndroidTournamentListResponse(
    val schemaVersion: String,
    val tournaments: List<AndroidTournamentSummary>,
)

@Serializable
internal data class AndroidRosterPlayerCreated(
    val playerId: String,
    val username: String,
    val displayName: String,
)

@Serializable
internal data class AndroidRosterPlayersCreated(
    val schemaVersion: String,
    val created: List<AndroidRosterPlayerCreated>,
)

@Serializable
internal data class AndroidRosterRejection(
    val row: Int,
    val displayName: String,
    val reason: String,
)

/**
 * ADR-0218 `mk8dx.roster-player-candidates.v1`: one Player a typed name may
 * mean, with the context the Director needs to tell equal names apart.
 */
@Serializable
internal data class AndroidRosterCandidate(
    val playerId: String,
    val username: String,
    val displayName: String,
    /** display_name, alias, username or partial. */
    val matchedBy: String,
    val aliasText: String? = null,
    /** director or installation. */
    val aliasScope: String? = null,
    val claimed: Boolean,
    val inTournament: Boolean,
    val nights: Int,
    val nightsWithDirector: Int,
    val lastNightName: String? = null,
    val lastNightDate: String? = null,
    val directorNames: List<String> = emptyList(),
    val characterKey: String? = null,
    val characterLabel: String? = null,
)

@Serializable
internal data class AndroidRosterNameCandidates(
    val name: String,
    val sameNameInOwnNights: Boolean,
    val candidates: List<AndroidRosterCandidate>,
)

@Serializable
internal data class AndroidRosterCandidatesResponse(
    val schemaVersion: String,
    val entries: List<AndroidRosterNameCandidates>,
)

@Serializable
internal data class AndroidRosterAliasCreated(val playerId: String, val aliasText: String)

@Serializable
internal data class AndroidRosterAliasesResponse(
    val schemaVersion: String,
    val created: List<AndroidRosterAliasCreated>,
    val existing: Int,
)

/** One Player to create from the roster: a file row and its name; `confirmSameName` answers ADR-0218's warning. */
internal data class AndroidRosterPlayerRequest(
    val row: Int,
    val displayName: String,
    val confirmSameName: Boolean = false,
)

@Serializable
internal data class AndroidTournamentDirector(
    val userAccountId: String,
    val displayName: String,
    val isAdministrator: Boolean = false,
)

@Serializable
internal data class AndroidTournamentDirectorList(
    val schemaVersion: String,
    val canActForOthers: Boolean,
    val directors: List<AndroidTournamentDirector>,
)

@Serializable
internal data class AndroidTournamentPlayerSearchResult(
    val playerId: String,
    val username: String,
    val displayName: String,
    // Public active aliases: the Tournament Manager's in-game handles, so a
    // roster or workbook row like "Sounder" resolves to the participant Sander.
    val aliases: List<String> = emptyList(),
)
@Serializable
private data class AndroidTournamentPlayerSearchResponse(val schemaVersion: String, val players: List<AndroidTournamentPlayerSearchResult>)

@Serializable
internal data class AndroidIncomingTournamentResult(
    val incomingResultId: String,
    val tournamentId: String,
    val sourceKind: String,
    val status: String,
    val revision: Int,
    val result: JsonObject,
    val suggestedPhase: String? = null,
    val suggestedGroupId: String? = null,
    val suggestedRaceNumber: Int? = null,
    val occurredAtMs: Long? = null,
    val capturedAtMs: Long? = null,
    val duplicateWarning: Boolean,
    val evidenceRecordId: String? = null,
    val submittedByDisplayName: String? = null,
    val createdAtMs: Long,
)

@Serializable
internal data class AndroidTournamentEvidenceScore(val observedPlayer: String, val points: Int)

@Serializable
internal data class AndroidTournamentEvidenceGroup(
    val observedGroupLabel: String,
    val races: Int,
    val connectionErrors: Int,
    val topThree: List<AndroidTournamentEvidenceScore> = emptyList(),
)

@Serializable
internal data class AndroidTournamentEvidenceUploader(val userAccountId: String, val displayName: String)

@Serializable
internal data class AndroidTournamentLiveMapping(val observedGroupLabel: String, val groupId: String, val phase: String)

@Serializable
internal data class AndroidTournamentLiveAssociation(
    val status: String,
    val mappings: List<AndroidTournamentLiveMapping> = emptyList(),
    val approvedAtMs: Long? = null,
    val stoppedAtMs: Long? = null,
    val completedAtMs: Long? = null,
)

@Serializable
internal data class AndroidTournamentEvidenceRecord(
    val recordId: String,
    val clientRecordId: String,
    val revision: Int,
    val status: String,
    val sourceKind: String,
    val uploadedBy: AndroidTournamentEvidenceUploader,
    val startedAtMs: Long? = null,
    val stoppedAtMs: Long? = null,
    val analysisCompletedAtMs: Long? = null,
    val complete: Boolean,
    val suggestedTournamentId: String? = null,
    val suggestedTournamentName: String? = null,
    val linkedTournamentId: String? = null,
    val groups: List<AndroidTournamentEvidenceGroup> = emptyList(),
    val resultCount: Int,
    val createdAtMs: Long,
    val updatedAtMs: Long,
    val live: AndroidTournamentLiveAssociation? = null,
)

@Serializable
private data class AndroidTournamentEvidenceResponse(
    val schemaVersion: String,
    val records: List<AndroidTournamentEvidenceRecord>,
)

@Serializable
internal data class AndroidPublicLiveParticipantReference(val namespace: String, val value: String)

@Serializable
internal data class AndroidPublicLiveStanding(
    val rank: Int,
    val observedPlayerName: String,
    val total: Int,
    val participantReference: AndroidPublicLiveParticipantReference,
)

@Serializable
internal data class AndroidPublicLiveGroup(
    val recordId: String,
    val groupId: String,
    val phase: String,
    val status: String,
    val streamRevision: Int,
    val countedRaces: Int,
    val receivedRaces: Int,
    val lastReceivedAtMs: Long,
    val controlPoints: List<String> = emptyList(),
    val standings: List<AndroidPublicLiveStanding> = emptyList(),
)

@Serializable
private data class AndroidPublicLiveGroupsResponse(val schemaVersion: String, val groups: List<AndroidPublicLiveGroup>)

internal fun AndroidIncomingTournamentResult.correctedWithExactPlayerSuggestions(
    participants: List<AndroidTournamentParticipant>,
): JsonObject? {
    val placements = runCatching { result["placements"]?.jsonArray }.getOrNull() ?: return null
    val corrected = placements.map { value ->
        val placement = value.jsonObject
        val reference = placement["participantReference"]?.jsonObject ?: return null
        val existingId = reference["value"]?.jsonPrimitive?.content
        val existingNamespace = reference["namespace"]?.jsonPrimitive?.content
        val observed = placement["observedPlayerName"]?.jsonPrimitive?.content ?: existingId ?: return null
        val matches = participants.filter { participant ->
            (existingNamespace == "player" && participant.playerId == existingId) ||
                participant.displayName.equals(observed, ignoreCase = true) ||
                participant.username.equals(observed, ignoreCase = true)
        }
        if (matches.size != 1) return null
        buildJsonObject {
            for ((key, field) in placement) put(key, field)
            put("participantReference", buildJsonObject {
                put("namespace", "player")
                put("value", matches.single().playerId)
            })
        }
    }
    return buildJsonObject {
        for ((key, field) in result) put(key, field)
        putJsonArray("placements") { corrected.forEach(::add) }
        put("verification", buildJsonObject {
            put("status", "producer_check_passed")
            put("method", "tournament_manager_human_confirmation")
        })
    }
}

@Serializable
private data class AndroidIncomingResultsResponse(
    val schemaVersion: String,
    val results: List<AndroidIncomingTournamentResult>,
)

internal class AndroidTournamentClientException(
    val statusCode: Int? = null,
    message: String,
    /** ADR-0177 decision 10: a rejected roster names its offending rows. */
    val rejections: List<AndroidRosterRejection> = emptyList(),
    /** The server's error code, when it sent one (ADR-0221 reads player_creation_directors_disabled). */
    val code: String? = null,
) : RuntimeException(message)

internal fun interface AndroidTournamentConnectionOpener {
    fun open(url: URL): HttpsURLConnection
}

internal class AndroidTournamentClient(
    origin: String,
    /**
     * Absent when nobody is signed in. The public endpoints answer anyone -
     * that is the point of them - so the phone can read the Tournaments
     * overview without an account, exactly as the site does. Every operator
     * call still needs a session and is refused without one.
     */
    private val session: AndroidAuthenticatedNativeSession?,
    private val opener: AndroidTournamentConnectionOpener,
) {
    private val origin = exactOrigin(origin)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    /** ADR-0221: who creates Players and who counts; public, read with the night. */
    fun installationSettings(): AndroidInstallationSettings =
        AndroidInstallationSettings.decode(request("GET", "/v1/installation-settings"))

    /** ADR-0221: just "only verified Players" for this night. */
    fun updateVerifiedOnly(tournamentId: String, revision: Int, verifiedOnly: Boolean): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/update-settings", buildJsonObject {
            put("expectedRevision", revision)
            put("verifiedOnly", verifiedOnly)
        }.toString()),
    )

    fun list(directorUserAccountId: String? = null): List<AndroidTournamentSummary> {
        val path = "/v1/native/tournaments" + (directorUserAccountId?.let {
            "?director=" + java.net.URLEncoder.encode(it, Charsets.UTF_8.name())
        } ?: "")
        val response = json.decodeFromString<AndroidTournamentListResponse>(request("GET", path))
        if (response.schemaVersion != "mk8dx.native-tournaments.v1") malformedResponse()
        return response.tournaments
    }

    /**
     * ADR-0177 decisions 9 and 10: creates every named Player or none of them.
     * A rejection carries the offending rows so the operator can fix the file.
     */
    fun createRosterPlayers(
        rows: List<Pair<Int, String>>,
    ): Result<List<AndroidRosterPlayerCreated>> =
        createRosterPlayers(rows.map { (row, name) -> AndroidRosterPlayerRequest(row, name) }, tournamentId = null)

    /**
     * ADR-0218: the same batch with the night it is for, so the server checks a
     * repeated name against that Night's Director, and with the Director's
     * explicit "yes, another one" per row. Usernames come back suffixed
     * (`marc-2`) when the plain one is taken.
     */
    fun createRosterPlayers(
        rows: List<AndroidRosterPlayerRequest>,
        tournamentId: String?,
    ): Result<List<AndroidRosterPlayerCreated>> = runCatching {
        val body = buildJsonObject {
            if (tournamentId != null) put("tournamentId", tournamentId)
            put("players", kotlinx.serialization.json.buildJsonArray {
                rows.forEach { request ->
                    add(buildJsonObject {
                        put("row", request.row)
                        put("displayName", request.displayName)
                        if (request.confirmSameName) put("confirmSameName", true)
                    })
                }
            })
        }.toString()
        json.decodeFromString<AndroidRosterPlayersCreated>(
            request("POST", "/v1/native/roster-players", body),
        ).created
    }

    /**
     * ADR-0218: the Players each name may mean, with context, one entry per
     * name in the order asked. Nothing is linked by asking.
     */
    fun rosterCandidates(
        names: List<String>,
        tournamentId: String?,
        partial: Boolean,
    ): List<AndroidRosterNameCandidates> {
        val trimmed = names.map { it.trim() }
        require(trimmed.isNotEmpty() && trimmed.size <= 200 && trimmed.all { it.length in 1..64 })
        val body = buildJsonObject {
            putJsonArray("names") { trimmed.forEach { add(it) } }
            if (tournamentId != null) put("tournamentId", tournamentId)
            if (partial) put("partial", true)
        }.toString()
        val response = json.decodeFromString<AndroidRosterCandidatesResponse>(
            request("POST", "/v1/native/roster-player-candidates", body),
        )
        if (response.schemaVersion != "mk8dx.roster-player-candidates.v1" || response.entries.size != trimmed.size) {
            malformedResponse()
        }
        return response.entries
    }

    /** ADR-0218: spellings the Director chose a Player for become that Director's own aliases. */
    fun rememberRosterAliases(tournamentId: String, aliases: List<Pair<String, String>>): Int {
        if (aliases.isEmpty()) return 0
        val body = buildJsonObject {
            putJsonArray("aliases") {
                aliases.forEach { (playerId, name) ->
                    addJsonObject { put("playerId", playerId); put("name", name.trim()) }
                }
            }
        }.toString()
        val response = json.decodeFromString<AndroidRosterAliasesResponse>(
            request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/roster-aliases", body),
        )
        if (response.schemaVersion != "mk8dx.roster-aliases.v1") malformedResponse()
        return response.created.size
    }

    /**
     * The public list, the same one the site reads. It answers for a signed-out
     * visitor too, so the phone can show what is coming without the operator
     * API and without being a Director.
     */
    fun listPublic(): List<AndroidPublicTournamentSummary> {
        val response = json.decodeFromString<AndroidPublicTournamentListResponse>(
            request("GET", "/v1/public/tournament-events"),
        )
        if (response.schemaVersion != "mk8dx.public-tournament-events.v1") malformedResponse()
        return response.tournaments
    }

    /**
     * "Alle races tot nu toe": what the community has raced over every
     * finished night, counted server-side from the corrected history. Public
     * reading, like the list above it.
     */
    fun statistics(): AndroidTournamentStatistics {
        val response = json.decodeFromString<AndroidTournamentStatistics>(
            request("GET", "/v1/public/tournament-statistics"),
        )
        if (response.schemaVersion != "mk8dx.public-tournament-statistics.v1") malformedResponse()
        return response
    }

    /** One track's own TrueSkill, everybody from a Score of zero. */
    fun trackSkill(trackId: String): AndroidTrackSkill {
        val response = json.decodeFromString<AndroidTrackSkill>(
            request(
                "GET",
                "/v1/public/tournament-statistics/tracks/" +
                    java.net.URLEncoder.encode(trackId, Charsets.UTF_8.name()),
            ),
        )
        if (response.schemaVersion != "mk8dx.public-track-skill.v1") malformedResponse()
        return response
    }

    /**
     * The imported stories for the past editions. The site revalidates this
     * file rather than trusting a cached copy - it has no content hash in its
     * name - and so does this, by asking for it fresh each time the page needs
     * it.
     */
    fun listStories(): List<AndroidTournamentStory> = runCatching {
        // The file is an envelope, not a bare array: {schemaVersion, source,
        // stories}. Decoding it as a list silently produced nothing, and an
        // old edition showed its tables with none of its story.
        json.decodeFromString<AndroidTournamentStoryFile>(
            request("GET", "/styles/tournament-stories.json"),
        ).stories
    }.getOrDefault(emptyList())

    /** One night's public document, the same one the site's page reads. */
    fun loadPublic(tournamentId: String): AndroidPublicTournamentEvent =
        json.decodeFromString(
            request("GET", "/v1/public/tournament-events/" +
                java.net.URLEncoder.encode(tournamentId, Charsets.UTF_8.name())),
        )

    /** Compact archive standings for up to eight nights in one HTTP call. */
    fun loadPublicPlacements(tournamentIds: List<String>): List<AndroidPublicTournamentPlacementSnapshot> {
        require(tournamentIds.isNotEmpty() && tournamentIds.size <= 8)
        val ids = tournamentIds.distinct().joinToString(",") {
            java.net.URLEncoder.encode(it, Charsets.UTF_8.name())
        }
        val response = json.decodeFromString<AndroidPublicTournamentPlacementsResponse>(
            request("GET", "/v1/public/tournament-placements?ids=$ids"),
        )
        if (response.schemaVersion != "mk8dx.public-tournament-placements.v1") malformedResponse()
        return response.tournaments
    }

    /** ADR-0220: the signed-in account's own request to host (AndroidDirectorHostRequest.kt parses it). */
    internal fun hostRequestStandingDocument(): String =
        request("GET", "/v1/native/director-host-request")

    /** ADR-0220: asks the administrators to let this account host Tournaments, with an optional note. */
    internal fun submitHostRequestDocument(note: String?): String =
        request("POST", "/v1/native/director-host-request", buildJsonObject {
            if (note != null) put("note", note)
        }.toString())

    /** ADR-0222: a night's sign-up and the reader's own status (AndroidTournamentSignup.kt parses it). */
    internal fun signupDocument(tournamentId: String): String =
        request("GET", "/v1/native/tournaments/${signupPathId(tournamentId)}/signup")

    /** ADR-0222: signs the account's verified Player up, or changes the consoles it brings. */
    internal fun signUpDocument(tournamentId: String, hasSwitch1: Boolean, hasSwitch2: Boolean): String =
        request("POST", "/v1/native/tournaments/${signupPathId(tournamentId)}/signup", buildJsonObject {
            put("hasSwitch1", hasSwitch1)
            put("hasSwitch2", hasSwitch2)
        }.toString())

    /** ADR-0222: withdraws before the night; the next on the waiting list moves up. */
    internal fun withdrawSignupDocument(tournamentId: String): String =
        request("POST", "/v1/native/tournaments/${signupPathId(tournamentId)}/signup/actions/withdraw", "{}")

    /** ADR-0222: the Director's view of every sign-up and the console warning. */
    internal fun signupBoardDocument(tournamentId: String): String =
        request("GET", "/v1/native/tournaments/${signupPathId(tournamentId)}/signups")

    private fun signupPathId(tournamentId: String): String {
        if (!ANDROID_SIGNUP_PATH_ID.matches(tournamentId)) {
            throw AndroidTournamentClientException(message = "Tournament id is invalid")
        }
        return tournamentId
    }

    /** ADR-0177 decision 3: the accounts this operator may direct a Tournament as. */
    fun listDirectors(): AndroidTournamentDirectorList {
        val response = json.decodeFromString<AndroidTournamentDirectorList>(
            request("GET", "/v1/native/tournament-directors"),
        )
        if (response.schemaVersion != "mk8dx.native-tournament-directors.v1") malformedResponse()
        return response
    }

    fun create(
        name: String,
        eventDate: String,
        startTime: String,
        directorUserAccountId: String? = null,
    ): AndroidTournamentSummary = json.decodeFromString(
        request("POST", "/v1/native/tournaments", buildJsonObject {
            val timezone = TimeZone.getDefault()
            val parser = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).apply {
                isLenient = false
                this.timeZone = timezone
            }
            val startAtMs = requireNotNull(parser.parse("$eventDate $startTime")) { "Invalid Tournament date or time" }.time
            put("name", name); put("eventDate", eventDate); put("startAtMs", startAtMs); put("timezone", timezone.id)
            put("seedingSource", "community_rating"); put("placementStrategy", "balanced"); put("qualifierRounds", true)
            if (directorUserAccountId != null) put("directorUserAccountId", directorUserAccountId)
        }.toString()),
    )

    fun setWorkflowStep(tournamentId: String, revision: Int, targetStep: Int, direction: String? = null): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/${when (direction) {
            "advance" -> "advance-current-step"
            "rollback" -> "rollback-current-step"
            else -> "set-workflow-step"
        }}", buildJsonObject {
            put("expectedRevision", revision)
            if (direction == null) put("targetStep", targetStep)
        }.toString()),
    )

    fun searchPlayers(query: String): List<AndroidTournamentPlayerSearchResult> {
        val response = json.decodeFromString<AndroidTournamentPlayerSearchResponse>(request("GET", "/v1/player-directory?query=${java.net.URLEncoder.encode(query, Charsets.UTF_8.name())}"))
        if (response.schemaVersion != "mk8dx.player-directory.v1") malformedResponse()
        return response.players
    }

    fun listPlayers(): List<AndroidTournamentPlayerSearchResult> {
        val response = json.decodeFromString<AndroidTournamentPlayerSearchResponse>(request("GET", "/v1/player-directory"))
        if (response.schemaVersion != "mk8dx.player-directory.v1") malformedResponse()
        return response.players
    }

    fun addParticipant(tournamentId: String, revision: Int, playerId: String): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/participants", buildJsonObject {
            put("expectedRevision", revision); put("playerId", playerId); put("attendance", "waiting"); put("hasSwitch1", false); put("hasSwitch2", false)
        }.toString()),
    )

    /**
     * ADR-0177 decision 7: the Step 2 qualification layout, while no groups exist.
     * `qualifierRounds` is deliberately absent; the compact workflow is historical.
     */
    fun updateSettings(
        tournamentId: String,
        revision: Int,
        /** ADR-0221: community_rating, director_nights, manual or random. */
        seedingSource: String,
        placementStrategy: String,
        ownerSeatingMode: String,
        maxParticipants: Int?,
        verifiedOnly: Boolean? = null,
    ): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/update-settings", buildJsonObject {
            put("expectedRevision", revision)
            require(seedingSource in TOURNAMENT_SEEDING_SOURCES)
            put("seedingSource", seedingSource)
            if (verifiedOnly != null) put("verifiedOnly", verifiedOnly)
            put("placementStrategy", placementStrategy)
            put("ownerSeatingMode", ownerSeatingMode)
            if (maxParticipants == null) put("maxParticipants", JsonNull)
            else put("maxParticipants", maxParticipants)
        }.toString()),
    )

    fun updateTieBreakMode(
        tournamentId: String,
        revision: Int,
        stage: String,
        mode: String,
    ): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/update-settings", buildJsonObject {
            put("expectedRevision", revision)
            put(if (stage == "final") "finalTieBreakMode" else "qualifierTieBreakMode", mode)
        }.toString()),
    )

    fun setTieBreakOrder(
        tournamentId: String,
        revision: Int,
        groupId: String,
        points: Int,
        playerIds: List<String>,
    ): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/tie-breaks", buildJsonObject {
            put("expectedRevision", revision)
            put("groupId", groupId)
            put("points", points)
            putJsonArray("playerIds") { playerIds.forEach { add(it) } }
        }.toString()),
    )

    fun addRecentParticipants(tournamentId: String, revision: Int): AndroidTournamentDocument = decodeDocument(
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/participants/actions/add-recent",
            buildJsonObject { put("expectedRevision", revision) }.toString(),
        ),
    )

    fun addHistoricalParticipants(tournamentId: String, revision: Int): AndroidTournamentDocument = decodeDocument(
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/participants/actions/add-historical",
            buildJsonObject { put("expectedRevision", revision) }.toString(),
        ),
    )

    fun removeParticipant(tournamentId: String, revision: Int, playerId: String): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/participants/actions/remove", buildJsonObject { put("expectedRevision", revision); put("playerId", playerId) }.toString()),
    )

    fun generateGroups(tournamentId: String, revision: Int, stage: String): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/generate-groups", buildJsonObject { put("expectedRevision", revision); put("stage", stage) }.toString()),
    )

    fun lockGroups(tournamentId: String, revision: Int, stage: String, locked: Boolean): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/lock-groups", buildJsonObject { put("expectedRevision", revision); put("stage", stage); put("locked", locked) }.toString()),
    )

    /** The source Manager's Step 3 / Step 7 layout file, applied to existing groups. */
    fun importGroupLayout(
        tournamentId: String,
        revision: Int,
        stage: String,
        groups: List<AndroidLayoutGroupRequest>,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/import-group-layout",
            buildJsonObject {
                put("expectedRevision", revision)
                put("stage", stage)
                putJsonArray("groups") {
                    groups.forEach { group ->
                        addJsonObject {
                            put("name", group.name)
                            putJsonArray("seats") {
                                group.seats.forEach { seat ->
                                    addJsonObject {
                                        put("playerId", seat.playerId)
                                        put("stationOwnerPlayerId", seat.stationOwnerPlayerId)
                                        put("switchType", seat.switchType)
                                        put("seatNumber", seat.seatNumber)
                                    }
                                }
                            }
                            if (group.stations.isNotEmpty()) {
                                putJsonArray("stations") {
                                    group.stations.forEach { station ->
                                        addJsonObject {
                                            put("stationOwnerPlayerId", station.stationOwnerPlayerId)
                                            put("switchType", station.switchType)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }.toString(),
        ),
    )

    fun finalize(tournamentId: String, revision: Int, publicResults: Boolean, affectsRating: Boolean): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/finalize", buildJsonObject { put("expectedRevision", revision); put("publicResults", publicResults); put("affectsRating", affectsRating); put("reasonCode", "android_operator_finalization") }.toString()),
    )

    fun load(tournamentId: String): AndroidTournamentDocument = decodeDocument(
        request("GET", "/v1/native/tournaments/${pathSegment(tournamentId)}"),
    )

    /**
     * A recorded race: the canonical unit the rating is applied from. Manual
     * totals never reach TrueSkill, so a night that should count has to arrive
     * as races.
     */
    fun enterRace(
        tournamentId: String,
        revision: Int,
        groupId: String,
        raceNumber: Int,
        trackId: String,
        finishOrder: List<String>,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/enter-race",
            buildJsonObject {
                put("expectedRevision", revision)
                put("groupId", groupId)
                put("raceNumber", raceNumber)
                put("trackId", trackId)
                putJsonArray("finishOrder") { finishOrder.forEach { add(it) } }
            }.toString(),
        ),
    )

    /**
     * A whole group in one call: the races the workbook holds and the character
     * each Player drove. The server writes them in one transaction, keeping one
     * lifecycle line per race, so an import either lands whole or not at all.
     */
    fun enterRaces(
        tournamentId: String,
        revision: Int,
        groupId: String,
        races: List<AndroidResolvedRace>,
        characters: List<AndroidResolvedCharacter>,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/enter-races",
            buildJsonObject {
                put("expectedRevision", revision)
                put("groupId", groupId)
                putJsonArray("races") {
                    races.forEach { race ->
                        addJsonObject {
                            put("raceNumber", race.raceNumber)
                            put("trackId", race.trackId)
                            putJsonArray("finishOrder") { race.finishOrder.forEach { add(it) } }
                        }
                    }
                }
                if (characters.isNotEmpty()) {
                    putJsonArray("characters") {
                        characters.forEach { character ->
                            addJsonObject {
                                put("playerId", character.playerId)
                                character.characterKey?.let { put("characterKey", it) }
                                put("characterLabel", character.label)
                                character.roster?.let { put("characterRoster", it) }
                            }
                        }
                    }
                }
            }.toString(),
        ),
    )

    /**
     * Removing a Tournament hides it: it leaves every list, the activity
     * window and the results, and comes out of TrueSkill, but the record
     * survives so an administrator can restore it. Its own director may do
     * this, not only an administrator.
     */
    fun removeTournament(tournamentId: String, reason: String) {
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/remove",
            buildJsonObject { put("reason", reason) }.toString(),
        )
    }

    fun deleteDraft(tournamentId: String, revision: Int) {
        val response = json.parseToJsonElement(
            request(
                "POST",
                "/v1/native/tournaments/${pathSegment(tournamentId)}/actions/delete",
                buildJsonObject { put("expectedRevision", revision) }.toString(),
            ),
        ).jsonObject
        if (response["deleted"]?.jsonPrimitive?.content != "true") malformedResponse()
    }

    /** A roster file or a bulk action in one request: every row is judged
     * with the same rules as one participant at a time, in one transaction,
     * one revision and one document (the site's `participants/actions/import`). */
    fun importParticipants(
        tournamentId: String,
        revision: Int,
        rows: List<AndroidParticipantImportRow>,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/participants/actions/import",
            buildJsonObject {
                put("expectedRevision", revision)
                put("rows", buildJsonArray {
                    rows.forEach { row ->
                        add(buildJsonObject {
                            put("playerId", row.playerId)
                            row.attendance?.let { put("attendance", it) }
                            row.hasSwitch1?.let { put("hasSwitch1", it) }
                            row.hasSwitch2?.let { put("hasSwitch2", it) }
                        })
                    }
                })
            }.toString(),
        ),
    )

    fun updateParticipant(
        tournamentId: String,
        revision: Int,
        participant: AndroidTournamentParticipant,
        attendance: String = participant.attendance,
        hasSwitch1: Boolean = participant.hasSwitch1,
        hasSwitch2: Boolean = participant.hasSwitch2,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/participants",
            buildJsonObject {
                put("expectedRevision", revision)
                put("playerId", participant.playerId)
                put("attendance", attendance)
                put("hasSwitch1", hasSwitch1)
                put("hasSwitch2", hasSwitch2)
            }.toString(),
        ),
    )

    fun updateGroups(
        tournamentId: String,
        revision: Int,
        stage: String,
        groups: List<AndroidTournamentGroupMembership>,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/groups",
            buildJsonObject {
                put("expectedRevision", revision)
                put("stage", stage)
                putJsonArray("groups") {
                    groups.forEach { group ->
                        add(buildJsonObject {
                            put("groupId", group.groupId)
                            putJsonArray("members") {
                                group.members.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) }
                            }
                        })
                    }
                }
            }.toString(),
        ),
    )

    fun setManualScores(
        tournamentId: String,
        revision: Int,
        groupId: String,
        segments: Int,
        scores: Map<String, List<Int?>>,
    ): AndroidTournamentDocument = decodeDocument(
        request("POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/manual-scores", buildJsonObject {
            put("expectedRevision", revision); put("groupId", groupId); put("segments", segments)
            putJsonArray("scores") {
                scores.forEach { (playerId, points) -> add(buildJsonObject {
                    put("playerId", playerId)
                    putJsonArray("segmentPoints") { points.forEach { point -> add(point?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) } }
                }) }
            }
        }.toString()),
    )

    fun recordIncident(
        tournamentId: String,
        revision: Int,
        category: String,
        note: String,
        playerId: String? = null,
    ): AndroidTournamentDocument = decodeDocument(
        request(
            "POST", "/v1/native/tournaments/${pathSegment(tournamentId)}/incidents",
            buildJsonObject {
                put("expectedRevision", revision)
                put("category", category)
                put("note", note)
                playerId?.let { put("playerId", it) }
            }.toString(),
        ),
    )

    fun incoming(tournamentId: String): List<AndroidIncomingTournamentResult> {
        val response = json.decodeFromString<AndroidIncomingResultsResponse>(
            request("GET", "/v1/native/tournaments/${pathSegment(tournamentId)}/incoming-results"),
        )
        if (response.schemaVersion != "mk8dx.native-tournament-incoming.v1") malformedResponse()
        return response.results
    }

    fun evidenceRecords(tournamentId: String): List<AndroidTournamentEvidenceRecord> {
        val response = json.decodeFromString<AndroidTournamentEvidenceResponse>(
            request("GET", "/v1/native/tournaments/${pathSegment(tournamentId)}/evidence-records"),
        )
        if (response.schemaVersion != "mk8dx.native-tournament-evidence-records.v1") malformedResponse()
        return response.records
    }

    fun publicLiveGroups(tournamentId: String): List<AndroidPublicLiveGroup> {
        val response = json.decodeFromString<AndroidPublicLiveGroupsResponse>(
            request("GET", "/v1/public/tournaments/${pathSegment(tournamentId)}/live-standings"),
        )
        if (response.schemaVersion != "mk8dx.public-tournament-live-groups.v1") malformedResponse()
        return response.groups
    }

    fun approveLiveAssociation(
        tournamentId: String,
        record: AndroidTournamentEvidenceRecord,
        mappings: Map<String, String>,
        phase: String,
    ) {
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/evidence-records/${pathSegment(record.recordId)}/actions/approve-live",
            buildJsonObject {
                put("expectedRevision", record.revision)
                put("reason", "Sticker names and live group routing checked in MK8DX Android")
                putJsonArray("mappings") {
                    mappings.forEach { (observed, groupId) -> addJsonObject {
                        put("observedGroupLabel", observed); put("groupId", groupId); put("phase", phase)
                    } }
                }
            }.toString(),
        )
    }

    fun linkEvidenceRecord(
        tournamentId: String,
        record: AndroidTournamentEvidenceRecord,
        phase: String,
        mappings: Map<String, String>,
    ) {
        request(
            "POST",
            "/v1/native/tournaments/${pathSegment(tournamentId)}/evidence-records/${pathSegment(record.recordId)}/actions/link",
            buildJsonObject {
                put("expectedRevision", record.revision)
                put("reason", "Recording and group suggestions reviewed in MK8DX Android")
                putJsonArray("mappings") {
                    mappings.forEach { (observed, groupId) -> addJsonObject {
                        put("observedGroupLabel", observed)
                        put("groupId", groupId)
                        put("phase", phase)
                    } }
                }
            }.toString(),
        )
    }

    fun rejectIncoming(incomingResultId: String, revision: Int, reason: String) {
        request(
            "POST", "/v1/native/tournament-incoming-results/${pathSegment(incomingResultId)}/actions/reject",
            buildJsonObject {
                put("expectedRevision", revision)
                put("reason", reason)
            }.toString(),
        )
    }

    fun acceptIncoming(
        incoming: AndroidIncomingTournamentResult,
        tournamentRevision: Int,
        groupId: String,
        raceNumber: Int,
    ) {
        request(
            "POST", "/v1/native/tournament-incoming-results/${pathSegment(incoming.incomingResultId)}/actions/accept",
            buildJsonObject {
                put("expectedRevision", incoming.revision)
                put("tournamentRevision", tournamentRevision)
                put("groupId", groupId)
                put("raceNumber", raceNumber)
                put("correctedResult", incoming.result)
                put("reason", "Confirmed in MK8DX Android")
                incoming.occurredAtMs?.let { put("occurredAtMs", it) }
            }.toString(),
        )
    }

    fun acceptIncomingGroup(
        document: AndroidTournamentDocument,
        groupId: String,
        incoming: List<AndroidIncomingTournamentResult>,
    ) {
        request(
            "POST", "/v1/native/tournament-incoming-results/actions/accept-group",
            buildJsonObject {
                put("tournamentRevision", document.summary.revision)
                put("groupId", groupId)
                put("reason", "Complete group feed confirmed in MK8DX Android")
                putJsonArray("entries") {
                    incoming.forEach { pending ->
                        val corrected = requireNotNull(pending.correctedWithExactPlayerSuggestions(document.participants))
                        val raceNumber = pending.suggestedRaceNumber ?: pending.result["raceNumber"]?.jsonPrimitive?.content?.toIntOrNull()
                        requireNotNull(raceNumber)
                        add(buildJsonObject {
                            put("incomingResultId", pending.incomingResultId)
                            put("expectedRevision", pending.revision)
                            put("raceNumber", raceNumber)
                            put("correctedResult", corrected)
                            pending.occurredAtMs?.let { put("occurredAtMs", it) }
                        })
                    }
                }
            }.toString(),
        )
    }

    private fun request(method: String, path: String, body: String? = null): String {
        val requested = URI(path)
        val target = URI(origin.scheme, null, origin.host, origin.port, requested.path, requested.query, null)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) throw AndroidTournamentClientException(message = "Tournament endpoint mismatch")
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            session?.let { connection.setRequestProperty("Authorization", "Bearer ${it.bearerToken}") }
            if (body != null) {
                val encoded = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(encoded.size)
                connection.outputStream.use { it.write(encoded) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8_192)
                while (output.size() <= MAX_TOURNAMENT_RESPONSE_BYTES) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
                if (output.size() > MAX_TOURNAMENT_RESPONSE_BYTES) throw AndroidTournamentClientException(status, "Tournament response was too large")
                output.toString(Charsets.UTF_8.name())
            }.orEmpty()
            if (status !in 200..299) {
                val document = runCatching { json.parseToJsonElement(response).jsonObject }.getOrNull()
                val message = document?.get("message")?.toString()?.trim('"')
                    ?: "Tournament request failed"
                val rejections = runCatching {
                    document?.get("rejections")?.let {
                        json.decodeFromJsonElement<List<AndroidRosterRejection>>(it)
                    }
                }.getOrNull().orEmpty()
                val code = runCatching { document?.get("code")?.jsonPrimitive?.content }.getOrNull()
                throw AndroidTournamentClientException(status, message, rejections, code)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun decodeDocument(payload: String): AndroidTournamentDocument =
        json.decodeFromString<AndroidTournamentDocument>(payload).also {
            if (it.schemaVersion != "mk8dx.tournament-operation.v1") malformedResponse()
        }

    private fun malformedResponse(): Nothing =
        throw AndroidTournamentClientException(message = "Tournament response contract mismatch")
}

private fun exactOrigin(value: String): URI {
    val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Tournament origin is invalid") }
    require(
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
            uri.rawPath in setOf("", "/") && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.port == -1 || uri.port in 1..65_535),
    )
    return uri
}

private fun pathSegment(value: String): String {
    require(value.matches(Regex("^[A-Za-z0-9._-]{1,160}$")))
    return value
}
