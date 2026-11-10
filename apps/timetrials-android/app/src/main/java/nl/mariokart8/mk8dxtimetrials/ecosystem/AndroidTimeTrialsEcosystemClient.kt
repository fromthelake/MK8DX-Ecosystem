package nl.mariokart8.mk8dxtimetrials.ecosystem

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import nl.mariokart8.mk8dxtimetrials.auth.AndroidAuthenticatedNativeSession

private const val MAX_ECOSYSTEM_RESPONSE_BYTES = 3 * 1024 * 1024
private val trackIdPattern = Regex("^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$")

@Serializable
internal data class AndroidAppRelease(
    val version: String,
    val releasedOn: String,
)

@Serializable
private data class AndroidAppDownloadEntry(
    val id: String,
    val platform: String,
    val version: String,
    val releasedOn: String,
)

@Serializable
private data class AndroidAppDownloadsDocument(
    val schemaVersion: String,
    val entries: List<AndroidAppDownloadEntry>,
)

@Serializable
private data class AndroidClientSupportAndroid(
    val currentVersion: String,
    val currentBuild: Int? = null,
    val minimumSupportedBuild: Int,
    val retiredBuilds: List<Int> = emptyList(),
    val downloadPagePath: String,
    val message: String? = null,
)

@Serializable
private data class AndroidClientSupportDocument(
    val schemaVersion: String,
    val android: AndroidClientSupportAndroid,
)

@Serializable
internal data class AndroidTrackBest(
    val trackId: String,
    val mode: Int,
    val totalTimeMs: Long,
    val rank: Int,
)

@Serializable
internal data class AndroidTrackBestPlayer(
    val playerId: String,
    val bests: List<AndroidTrackBest>,
)

@Serializable
internal data class AndroidTrackBestsDocument(
    val schemaVersion: String,
    val players: List<AndroidTrackBestPlayer>,
)

@Serializable
internal data class AndroidHomePlayer(
    val playerId: String,
    val displayName: String,
    // The bootstrap has always named the Player's avatar; Home simply never
    // read it, so the APK showed a generic glyph where the web shows a face.
    val avatarId: String? = null,
)

@Serializable
internal data class AndroidUsername(
    val value: String,
)

@Serializable
internal data class AndroidProfilePlayer(
    val playerId: String,
    val username: AndroidUsername,
    val displayName: String,
    val countryId: String? = null,
    val avatarId: String? = null,
    val favoriteBodyId: String? = null,
    val favoriteTireId: String? = null,
    val favoriteGliderId: String? = null,
    val timeTrialModePreference: String? = null,
)

@Serializable
internal data class AndroidPlayerProfilePreferences(
    val schemaVersion: String = "mk8dx.player-profile-preferences.v1",
    val countryId: String? = null,
    val favoriteCharacterId: String? = null,
    val favoriteBodyId: String? = null,
    val favoriteTireId: String? = null,
    val favoriteGliderId: String? = null,
)

@Serializable
private data class AndroidPlayerProfilePreferencesUpdate(
    val countryId: String? = null,
    val favoriteCharacterId: String? = null,
    val favoriteBodyId: String? = null,
    val favoriteTireId: String? = null,
    val favoriteGliderId: String? = null,
)

@Serializable
internal data class AndroidTimeTrialPreferences(
    val schemaVersion: String = "mk8dx.account-time-trial-preferences.v1",
    val modePreference: String,
    val screenName: String? = null,
    val trackAccess: String = "unknown",
)

/**
 * The account's appearance choice (ADR-0205). `appearance` is null when the
 * account has never held one, which is not the same as having chosen System.
 */
@Serializable
internal data class AndroidAccountAppearancePreference(
    val schemaVersion: String = "mk8dx.account-appearance-preference.v1",
    val appearance: String? = null,
)

@Serializable
private data class AndroidAccountAppearancePreferenceUpdate(val appearance: String)

@Serializable
private data class AndroidTimeTrialPreferencesUpdate(
    val modePreference: String,
    val screenName: String? = null,
    val trackAccess: String,
)

@Serializable
internal data class AndroidRivalComparison(
    val playerId: String,
    val displayName: String,
    val tracksAhead: Int,
    val tracksBehind: Int,
    val sharedCombos: Int,
    val totalDeltaMs: Long,
    val avatarId: String? = null,
    // What the same comparison said at the previous visit; Home turns the
    // difference into the "since you were away" lines the web writes.
    val previous: AndroidRivalComparisonSnapshot? = null,
)

@Serializable
internal data class AndroidRivalComparisonSnapshot(
    val tracksAhead: Int,
    val tracksBehind: Int,
    val sharedCombos: Int,
    val totalDeltaMs: Long,
)

@Serializable
internal data class AndroidComebackReactions(
    val count: Int,
    val resultCount: Int,
    val kinds: List<String>,
)

@Serializable
internal data class AndroidTimeTrialStanding(
    val standing: Int,
    val of: Int,
    val totalMs: Long,
    val previousStanding: Int? = null,
)

@Serializable
internal data class AndroidTournamentStanding(
    val rank: Int,
    val of: Int,
    val score: Double,
    /** False until the Player has a rated race; older servers omit it (shown as before). */
    val played: Boolean? = null,
)

@Serializable
internal data class AndroidHomeComeback(
    val schemaVersion: String,
    val player: AndroidHomePlayer,
    val timeTrials: AndroidTimeTrialStanding,
    val rivals: List<AndroidRivalComparison>,
    val reactions: AndroidComebackReactions? = null,
    /** When the previous visit ended; absent on a first visit. */
    val sinceMs: Long? = null,
    // The bootstrap has always carried this; the APK simply never read it, so
    // Home could not show the Tournament standing the web shows.
    val tournament: AndroidTournamentStanding? = null,
)

@Serializable
internal data class AndroidFocusTarget(
    val playerId: String,
    val displayName: String,
    val bestMs: Long,
    val rank: Int,
)

@Serializable
internal data class AndroidFocusRow(
    val trackId: String,
    val mode: Int,
    val myBestMs: Long,
    val myRank: Int,
    val humanCount: Int,
    val leaderBestMs: Long,
    val above: AndroidFocusTarget? = null,
)

@Serializable
internal data class AndroidHomeFocusDocument(
    val schemaVersion: String,
    val rows: List<AndroidFocusRow>,
    val modePreference: String = "all",
)

@Serializable
internal data class AndroidActivityPlayer(
    val playerId: String,
    val displayName: String,
    val countryId: String? = null,
    val avatarId: String? = null,
)

@Serializable
internal data class AndroidPassedPlayer(
    val playerId: String,
    val displayName: String,
)

@Serializable
internal data class AndroidActivityRank(
    val after: Int,
    val before: Int? = null,
    val passed: List<AndroidPassedPlayer> = emptyList(),
    val passedCount: Int,
)

@Serializable
internal data class AndroidActivityLap(
    val lapNumber: Int,
    val timeMs: Long,
    val coinsCollected: Int? = null,
    val mushroomsUsed: Int? = null,
)

@Serializable
internal data class AndroidActivityLoadout(
    val characterId: String? = null,
    val characterVariantId: String? = null,
    val bodyId: String? = null,
    val bodyVariantId: String? = null,
    val tireId: String? = null,
    val gliderId: String? = null,
    val gliderVariantId: String? = null,
)

@Serializable
internal data class AndroidActivityRun(
    val resultId: String,
    val timeMs: Long,
    val atMs: Long,
    val laps: List<AndroidActivityLap> = emptyList(),
    val loadout: AndroidActivityLoadout? = null,
    val sourceKind: String,
    val correctedFields: List<String> = emptyList(),
)

@Serializable
internal data class AndroidActivityStory(
    val player: AndroidActivityPlayer,
    val trackId: String,
    val mode: Int,
    val runs: Int,
    val startMs: Long,
    val bestMs: Long,
    val improvedMs: Long? = null,
    val personalBest: Boolean,
    val rank: AndroidActivityRank? = null,
    val latestAtMs: Long,
    val runDetails: List<AndroidActivityRun> = emptyList(),
    val viewerOvertake: AndroidViewerOvertake? = null,
    val personalBestDeltaMs: Long? = null,
    /** Story best minus this Player's personal best immediately before the story. */
    val playerDeltaMs: Long? = null,
    /** Human-leaderboard position captured once when this run was published. */
    val runRank: Int? = null,
)

@Serializable
internal data class AndroidViewerOvertake(
    val notificationId: String,
    val actorTimeMs: Long,
    val recipientTimeMs: Long,
    val deltaMs: Long,
    val recipientRank: Int,
)

@Serializable
internal data class AndroidActivityStoriesDocument(
    val schemaVersion: String,
    val stories: List<AndroidActivityStory>,
)

@Serializable
internal data class AndroidHomeBootstrap(
    val schemaVersion: String,
    val authenticated: Boolean,
    val comeback: AndroidHomeComeback? = null,
    val focus: AndroidHomeFocusDocument? = null,
    val trackBests: AndroidTrackBestsDocument? = null,
    val stories: AndroidActivityStoriesDocument? = null,
    val notifications: AndroidNotificationInbox? = null,
    val player: AndroidProfilePlayer? = null,
    /** The current World Records as Mastery needs them; applied as the baseline on arrival. */
    val worldRecordTimes: AndroidWorldRecordTimesDocument? = null,
)

@Serializable
internal data class AndroidWorldRecordTime(val mode: Int, val trackId: String, val totalTimeMs: Long)

@Serializable
internal data class AndroidWorldRecordTimesDocument(val schemaVersion: String, val records: List<AndroidWorldRecordTime>)

@Serializable
internal data class AndroidPublicTimeTrialResult(
    val resultId: String,
    val playerId: String,
    val playerUsername: String,
    val playerDisplayName: String,
    val trackId: String,
    val mode: Int,
    val totalTimeMs: Long,
    val rank: Int? = null,
    val revision: Int = 1,
    val countryId: String? = null,
    val laps: List<AndroidActivityLap> = emptyList(),
    val loadout: AndroidActivityLoadout? = null,
    val sourceKind: String,
    val correctedFields: List<String> = emptyList(),
    val resultAtMs: Long = 0,
    val publishedAtMs: Long = 0,
    /** The Player's own YouTube video of this run (ADR-0211); always a youtube.com/watch link. */
    val videoUrl: String? = null,
)

@Serializable
internal data class AndroidPlayerTimeTrialsDocument(
    val schemaVersion: String,
    val results: List<AndroidPublicTimeTrialResult>,
)

@Serializable
internal data class AndroidManagedTimeTrialRevision(
    val revision: Int,
    val modeCc: Int,
    val trackId: String,
    val totalTimeMs: Long,
    val laps: List<Long> = emptyList(),
    /** Per lap: the HUD coin balance at the lap's end and the mushrooms used (ADR-0211). */
    val lapDetails: List<AndroidManagedLapCounts>? = null,
    /** characterId, bodyId, tireId, gliderId and their variant ids, when recorded. */
    val loadout: Map<String, String>? = null,
    val sourceKind: String,
    val createdAtMs: Long,
)

@Serializable
internal data class AndroidManagedLapCounts(
    val coinsCollected: Int? = null,
    val mushroomsUsed: Int? = null,
)

/**
 * A correction in the form of Post a Time (ADR-0211): only what changed travels, so an untouched
 * part keeps what it recorded. Absent lapDetails/loadout keep the previous revision's.
 */
@Serializable
internal data class AndroidTimeTrialCorrection(
    val totalTimeMs: Long,
    val laps: List<Long>,
    val lapDetails: List<AndroidManagedLapCounts>? = null,
    val loadout: Map<String, String>? = null,
    val reasonCode: String,
    val note: String? = null,
)

@Serializable
internal data class AndroidManagedTimeTrial(
    val submissionId: String,
    val playerId: String,
    val playerUsername: String,
    val playerDisplayName: String,
    val retirementState: String,
    val publicationStatus: String,
    val publicationReason: String,
    val current: AndroidManagedTimeTrialRevision,
    /** The Player's YouTube video of the run, always https://www.youtube.com/watch?v=<id>. */
    val videoUrl: String? = null,
)

@Serializable
internal data class AndroidPersonalBest(
    val trackId: String,
    val modeCC: Int,
    val bestTimeMs: Long,
    val attemptCount: Int,
)

@Serializable
internal data class AndroidInsightsTimeTrials(
    val submissionCount: Int,
    val personalBests: List<AndroidPersonalBest>,
)

@Serializable
internal data class AndroidInsightsTournaments(
    val raceCount: Int,
    val countedRaceCount: Int,
    val wins: Int,
    val podiums: Int,
    val countedPoints: Int,
    val countedFinishPositionTotal: Int,
)

/** `/v1/me/player-insights`: the signed-in Player's record book and Tournament totals (My records & stats). */
@Serializable
internal data class AndroidPlayerInsights(
    val schemaVersion: String,
    val playerId: String,
    val timeTrials: AndroidInsightsTimeTrials,
    val tournaments: AndroidInsightsTournaments,
)

/** One race on a Player's Tournament rating trajectory (`/v1/public/players/{id}/rating-history`). */
@Serializable
internal data class AndroidRatingPoint(
    val sequence: Int,
    val tournamentNumber: Int,
    val sectionLabel: String,
    val raceIndex: Int,
    val finishPosition: Int,
    val score: Double,
    val mu: Double? = null,
    val sigma: Double? = null,
)

@Serializable
private data class AndroidRatingHistoryDocument(val schemaVersion: String, val points: List<AndroidRatingPoint>)

/** One of the signed-in Player's recent runs from `/v1/me/player-activity`, for momentum. */
@Serializable
internal data class AndroidOwnRun(
    val trackId: String,
    val modeCC: Int,
    val totalTimeMs: Long,
    val occurredAtMs: Long? = null,
    val createdAtMs: Long,
) {
    val atMs: Long get() = occurredAtMs ?: createdAtMs
}

@Serializable
private data class AndroidOwnActivityPlayer(val playerId: String, val displayName: String)

@Serializable
private data class AndroidOwnActivityDocument(
    val schemaVersion: String,
    val player: AndroidOwnActivityPlayer,
    val timeTrials: List<AndroidOwnRun>,
)

@Serializable
private data class AndroidManagedTimeTrialsDocument(
    val schemaVersion: String,
    val results: List<AndroidManagedTimeTrial>,
)

@Serializable
private data class AndroidManagedTimeTrialDocument(
    val schemaVersion: String,
    val result: AndroidManagedTimeTrial,
)

@Serializable
private data class AndroidRetirementRequest(
    val reasonCode: String,
    val note: String? = null,
)

@Serializable
internal data class AndroidRecordHolder(
    val playerId: String,
    val displayName: String,
    val value: Int,
    val avatarId: String? = null,
)

@Serializable
internal data class AndroidRecordCategory(
    val key: String,
    val holders: List<AndroidRecordHolder>,
)

@Serializable
internal data class AndroidRecordBook(
    val schemaVersion: String,
    val categories: List<AndroidRecordCategory>,
)

@Serializable
internal data class AndroidNotification(
    val notificationId: String,
    val kind: String,
    val actorPlayerId: String? = null,
    val actorDisplayName: String? = null,
    val trackId: String? = null,
    val mode: Int? = null,
    val groupId: String? = null,
    val groupName: String? = null,
    /** The night a sign-up entry is about (ADR-0222), so it opens that night's page. */
    val tournamentId: String? = null,
    val tournamentName: String? = null,
    val detail: String? = null,
    val actorTimeMs: Int? = null,
    val recipientTimeMs: Int? = null,
    val deltaMs: Int? = null,
    val recipientRank: Int? = null,
    val count: Int,
    val lastEventAtMs: Long,
    val read: Boolean,
)

/**
 * One of the events an entry counted.
 *
 * The inbox collapses on purpose - forty-nine broken World Records are one
 * line, not forty-nine notifications on your phone - but the ones it folded
 * away are still facts, and an entry that says "49" should be openable.
 */
@Serializable
internal data class AndroidClientCheckinRequest(
    val installationId: String,
    val client: String,
    val version: String,
    val build: Int,
    val deviceModel: String? = null,
)

@Serializable
internal data class AndroidNotificationEvent(
    val occurredAtMs: Long,
    val actorPlayerId: String? = null,
    val actorDisplayName: String? = null,
    val trackId: String? = null,
    val mode: Int? = null,
    val detail: String? = null,
    val actorTimeMs: Int? = null,
    val recipientTimeMs: Int? = null,
    val recipientRank: Int? = null,
)

@Serializable
internal data class AndroidNotificationEventPage(
    val schemaVersion: String,
    val notificationId: String,
    val events: List<AndroidNotificationEvent>,
)

@Serializable
internal data class AndroidNotificationInbox(
    val schemaVersion: String,
    val unreadCount: Int,
    val notifications: List<AndroidNotification>,
)

@Serializable
internal data class AndroidNotificationPreferences(
    val competitiveOvertaken: Boolean,
    val activityReactions: Boolean,
    // Who may reach this Player with a poke: "all", "rivals" or "none". A
    // different question from what they want delivered, so it is its own
    // setting rather than a reuse of the delivery scope.
    val engagementAcceptScope: String = "all",
)

@Serializable
internal data class AndroidWebPushStatus(
    val supported: Boolean,
    val subscriptionCount: Int,
)

@Serializable
internal data class AndroidNotificationSettings(
    val schemaVersion: String,
    val preferences: AndroidNotificationPreferences,
    val webPush: AndroidWebPushStatus,
)

@Serializable
private data class AndroidNotificationAcknowledgement(val acknowledged: Boolean)

@Serializable
internal data class AndroidTournamentStandingEntry(
    val rank: Int,
    val playerId: String,
    val username: String,
    val displayName: String,
    val score: Double? = null,
    val tournaments: Int,
    val races: Int,
    val wins: Int,
    val podiums: Int,
    val points: Int,
    val finishPositionTotal: Int,
    val finishes: List<Int>,
    val lastRaceAtMs: Long? = null,
)

@Serializable
private data class AndroidTournamentStandingDocument(
    val schemaVersion: String,
    val entries: List<AndroidTournamentStandingEntry>,
)

@Serializable
internal data class AndroidTournamentRivalry(
    val playerId: String,
    val username: String,
    val displayName: String,
    val sharedRaces: Int,
    val ahead: Int,
    val behind: Int,
    val tied: Int,
    val averagePointsDelta: Double,
)

/** One Player's record over only the races a whole comparison finished. */
@Serializable
internal data class AndroidTournamentSharedRecord(
    val playerId: String,
    val races: Int,
    val wins: Int,
    val podiums: Int,
    val points: Int,
    val finishPositionTotal: Int,
    val finishes: List<Int>,
)

@Serializable
internal data class AndroidTournamentSharedRaces(
    val sharedRaces: Int,
    val entries: List<AndroidTournamentSharedRecord>,
)

@Serializable
private data class AndroidTournamentSharedRacesDocument(
    val schemaVersion: String,
    val sharedRaces: Int,
    val entries: List<AndroidTournamentSharedRecord>,
)

@Serializable
private data class AndroidTournamentRivalriesDocument(
    val schemaVersion: String,
    val playerId: String,
    val opponents: List<AndroidTournamentRivalry>,
)

/**
 * One track out of a Player's tournament record.
 *
 * `relativeToOwnAverage` is the number that matters: how this track compares
 * with the same player's own average finish, as a share of the field, so a
 * verdict survives a move between divisions. Negative is better.
 */
@Serializable
internal data class AndroidTournamentTrack(
    val trackId: String,
    val races: Int,
    val wins: Int,
    val podiums: Int,
    val bestFinish: Int,
    val worstFinish: Int,
    val averageFinish: Double,
    val averagePoints: Double? = null,
    val averageFieldShare: Double,
    val relativeToOwnAverage: Double,
    val lastRacedAtMs: Long,
)

@Serializable
internal data class AndroidTournamentTrackRecord(
    val schemaVersion: String = "",
    val playerId: String = "",
    val racesWithTrack: Int = 0,
    // TN4-TN6 were never recorded, so a long career always has some.
    val racesWithoutTrack: Int = 0,
    val overallFieldShare: Double? = null,
    val tracks: List<AndroidTournamentTrack> = emptyList(),
)

@Serializable
private data class AndroidEngagementRequest(
    val kind: String,
    val detail: AndroidEngagementDetail? = null,
)

@Serializable
internal data class AndroidEngagementDetail(
    val hand: String? = null,
    val face: Int? = null,
    /** dice_roll: a duel the recipient answers with their own server roll. */
    val duel: Boolean? = null,
    val recipientFace: Int? = null,
    val trackId: String? = null,
    val mode: Int? = null,
    val totalTimeMs: Long? = null,
    val recipientHand: String? = null,
    val outcome: String? = null,
    val respondedAtMs: Long? = null,
)

@Serializable
private data class AndroidEngagementAcknowledgement(
    val engagementId: String,
    val kind: String,
    val recipientPlayerId: String,
    val detail: AndroidEngagementDetail? = null,
)

@Serializable
internal data class AndroidPlayerEngagement(
    val engagementId: String,
    val kind: String,
    val actorPlayerId: String,
    val recipientPlayerId: String,
    val actorDisplayName: String? = null,
    val recipientDisplayName: String? = null,
    val detail: AndroidEngagementDetail? = null,
    val createdAtMs: Long,
)

@Serializable
internal data class AndroidRpsStats(
    val played: Int,
    val wins: Int,
    val losses: Int,
    val draws: Int,
)

@Serializable
internal data class AndroidPlayerEngagementsDocument(
    val schemaVersion: String,
    val engagements: List<AndroidPlayerEngagement>,
    val rpsStats: AndroidRpsStats,
)

@Serializable
private data class AndroidPlayerEngagementResult(
    val schemaVersion: String,
    val engagement: AndroidPlayerEngagement,
)

@Serializable
private data class AndroidRpsReply(val hand: String)

@Serializable
private class AndroidDiceReply

/** Why one action cannot be sent now; the page shows it beside the button. */
@Serializable
internal data class AndroidEngagementAllowance(
    val available: Boolean,
    val reason: String? = null,
    val availableAtMs: Long? = null,
    val engagementId: String? = null,
)

/** The viewer's history with one Player and what they can send them now (owner 2026-09-26). */
@Serializable
internal data class AndroidEngagementConversation(
    val schemaVersion: String,
    val playerId: String,
    val accepted: Boolean,
    val actions: Map<String, AndroidEngagementAllowance>,
    val engagements: List<AndroidPlayerEngagement>,
)

@Serializable
private data class AndroidReactionRequest(val resultId: String, val kind: String)

@Serializable
internal data class AndroidReactionSummary(
    val resultId: String,
    val counts: Map<String, Int>,
    val mine: String? = null,
)

@Serializable
private data class AndroidReactionSummariesDocument(
    val schemaVersion: String,
    val reactions: List<AndroidReactionSummary>,
)

@Serializable
private data class AndroidReactionRemoveRequest(val resultId: String)

@Serializable
private data class AndroidNotificationReadRequest(val notificationIds: List<String>)

@Serializable
// No default value: kotlinx omits a property that equals its default, which
// would serialize this as `{}` and the route would refuse it as neither form.
private data class AndroidNotificationReadAllRequest(val all: Boolean)

@Serializable
internal data class AndroidRival(
    val playerId: String,
    val displayName: String,
)

@Serializable
internal data class AndroidRivalsDocument(
    val schemaVersion: String,
    val rivals: List<AndroidRival>,
)

@Serializable
private data class AndroidLeaderboardDocument(
    val schemaVersion: String,
    val results: List<AndroidPublicTimeTrialResult>,
)

@Serializable
internal data class AndroidWorldRecordHolder(
    val playerName: String,
    val videoUrl: String? = null,
    val lapTimesMs: List<Long>,
    val coinsPerLap: List<Int>,
    val mushroomsPerLap: List<Int>,
    val nationName: String? = null,
    val recordDate: String? = null,
    val durationDays: Int? = null,
    val characterName: String? = null,
    val bodyName: String? = null,
    val tireName: String? = null,
    val gliderName: String? = null,
)

@Serializable
internal data class AndroidWorldRecord(
    val mode: Int,
    val trackId: String,
    val trackName: String,
    val totalTimeMs: Long,
    val playerName: String,
    val videoUrl: String? = null,
    val lapTimesMs: List<Long>,
    val coinsPerLap: List<Int>,
    val mushroomsPerLap: List<Int>,
    val holders: List<AndroidWorldRecordHolder> = emptyList(),
    val nationName: String? = null,
    val recordDate: String? = null,
    val durationDays: Int? = null,
    val characterName: String? = null,
    val bodyName: String? = null,
    val tireName: String? = null,
    val gliderName: String? = null,
)

@Serializable
private data class AndroidWorldRecordsDocument(
    val schemaVersion: String,
    val records: List<AndroidWorldRecord>,
)

/**
 * What LiveTrial read from a Nintendo staff or World Record ghost (ADR-0212). The board fills
 * only what a reference row is missing, from a reading of exactly its time.
 */
@Serializable
internal data class AndroidReferenceGhostReading(
    val kind: String,
    val trackId: String,
    val mode: Int,
    val totalTimeMs: Long,
    val lapTimesMs: List<Long>,
    /** Coins gained per lap, as mkwrs counts them. */
    val coinsPerLap: List<Int>? = null,
    val mushroomsPerLap: List<Int>? = null,
)

@Serializable
private data class AndroidReferenceGhostReadingsDocument(
    val schemaVersion: String,
    val readings: List<AndroidReferenceGhostReading>,
)

@Serializable
internal data class AndroidRankStanding(
    val rank: Int, val playerId: String, val playerDisplayName: String, val mode: Int,
    val totalTimeMs: Long, val averageTimeMs: Long, val playedTracks: Int,
    val goldMedals: Int, val silverMedals: Int, val bronzeMedals: Int,
)

@Serializable
private data class AndroidRankStandingsDocument(val schemaVersion: String, val standings: List<AndroidRankStanding>)

@Serializable
internal data class AndroidDirectoryPlayer(val playerId: String, val displayName: String)

@Serializable
private data class AndroidDirectoryDocument(val schemaVersion: String, val players: List<AndroidDirectoryPlayer>)

@Serializable
internal data class AndroidSocialGroupMember(val playerId: String, val displayName: String, val role: String, val status: String)

@Serializable
internal data class AndroidSocialGroup(val groupId: String, val name: String, val myRole: String, val myStatus: String, val members: List<AndroidSocialGroupMember>)

@Serializable
internal data class AndroidRankScopePreference(val global: Boolean, val rivals: Boolean, val groupIds: List<String>)

@Serializable
private data class AndroidSocialGroupsDocument(val schemaVersion: String, val groups: List<AndroidSocialGroup>, val rankScope: AndroidRankScopePreference)

@Serializable
private data class AndroidCsrfDocument(val schemaVersion: String, val headerName: String, val value: String)

internal class AndroidEcosystemClientException(
    val statusCode: Int? = null,
    message: String,
    /** The API's own error code, when it sent one (e.g. time_trial_time_implausible). */
    val code: String? = null,
) : RuntimeException(message)

internal fun interface AndroidEcosystemConnectionOpener {
    fun open(url: URL): HttpsURLConnection
}

internal interface AndroidTimeTrialsEcosystemDataSource {
    fun home(): AndroidHomeBootstrap
    fun leaderboard(trackId: String, mode: Int): List<AndroidPublicTimeTrialResult>
    fun latestAndroidRelease(): AndroidAppRelease? = null
    fun clientSupport(): AndroidClientSupport? = null
    fun playerResults(playerId: String): List<AndroidPublicTimeTrialResult> = emptyList()
    fun managedTimeTrials(): List<AndroidManagedTimeTrial> = emptyList()
    /** My records & stats: the signed-in Player's record book; null when signed out. */
    fun playerInsights(): AndroidPlayerInsights? = null
    /** My records & stats: the signed-in Player's last 100 runs (retired ones excluded by the server). */
    fun ownRuns(): List<AndroidOwnRun> = emptyList()
    /** A Player's Tournament rating after every counted race, oldest first (the Web profile's chart). */
    fun ratingHistory(playerId: String): List<AndroidRatingPoint> = emptyList()
    fun retireTimeTrial(submissionId: String, reasonCode: String): AndroidManagedTimeTrial? = null
    fun restoreTimeTrial(submissionId: String): AndroidManagedTimeTrial? = null
    /** Corrects the Player's own published result (ADR-0211). */
    fun correctTimeTrial(submissionId: String, correction: AndroidTimeTrialCorrection): AndroidManagedTimeTrial? = null
    /** Attaches the Player's YouTube video to their result, or removes it (null). */
    fun setTimeTrialVideo(submissionId: String, videoUrl: String?): AndroidManagedTimeTrial? = null
    fun playerProfile(playerId: String): AndroidProfilePlayer? = null
    fun recordBook(): AndroidRecordBook? = null
    fun notifications(): AndroidNotificationInbox? = null
    fun markNotificationsRead(notificationIds: List<String>) = Unit
    /** Says which build this copy of the app is; see `client-installations.ts`. */
    fun checkInClient(
        installationId: String,
        version: String,
        build: Int,
        deviceModel: String?,
    ) = Unit
    fun notificationEvents(notificationId: String): List<AndroidNotificationEvent> = emptyList()
    fun markAllNotificationsRead() = Unit
    fun notificationSettings(): AndroidNotificationSettings? = null
    fun saveNotificationPreferences(preferences: AndroidNotificationPreferences): AndroidNotificationPreferences = preferences
    fun rivals(): List<AndroidRival> = emptyList()
    fun sendEngagement(playerId: String, kind: String,
        detail: AndroidEngagementDetail? = null): AndroidEngagementDetail? = null
    fun playerEngagements(): AndroidPlayerEngagementsDocument = AndroidPlayerEngagementsDocument(
        "mk8dx.player-engagements.v1", emptyList(), AndroidRpsStats(0, 0, 0, 0))
    fun answerRps(engagementId: String, hand: String): AndroidPlayerEngagement? = null
    /** Rolls back in a dice duel; the server rolls. */
    fun answerDice(engagementId: String): AndroidPlayerEngagement? = null
    fun engagementConversation(playerId: String): AndroidEngagementConversation? = null
    fun trackBestsFor(playerId: String): List<AndroidTrackBest> = emptyList()
    fun reactToRun(resultId: String, kind: String) = Unit
    fun removeReaction(resultId: String) = Unit
    fun reactionSummaries(resultIds: List<String>): List<AndroidReactionSummary> = emptyList()
    fun tournamentStanding(): List<AndroidTournamentStandingEntry> = emptyList()
    fun tournamentRivalries(playerId: String): List<AndroidTournamentRivalry> = emptyList()
    /** The main Player first, then one or two others. */
    fun tournamentSharedRaces(playerIds: List<String>): AndroidTournamentSharedRaces? = null
    fun tournamentTrackRecord(playerId: String): AndroidTournamentTrackRecord? = null
    fun worldRecords(): List<AndroidWorldRecord> = emptyList()
    /** ADR-0212: LiveTrial's staff and World Record ghost readings for one track and class. */
    fun referenceGhostReadings(trackId: String, mode: Int): List<AndroidReferenceGhostReading> = emptyList()
    fun rankStandings(mode: Int, scope: String = "all"): List<AndroidRankStanding> = emptyList()
    fun findPlayers(query: String): List<AndroidDirectoryPlayer> = emptyList()
    fun socialGroups(): Pair<List<AndroidSocialGroup>, AndroidRankScopePreference> = emptyList<AndroidSocialGroup>() to AndroidRankScopePreference(true, false, emptyList())
    fun saveRankScope(preference: AndroidRankScopePreference) = Unit
    fun timeTrialPreferences(): AndroidTimeTrialPreferences? = null
    fun saveTimeTrialPreferences(preference: AndroidTimeTrialPreferences): AndroidTimeTrialPreferences = preference
    fun playerProfilePreferences(): AndroidPlayerProfilePreferences? = null
    fun savePlayerProfilePreferences(preference: AndroidPlayerProfilePreferences): AndroidPlayerProfilePreferences = preference
    /** ADR-0205: the account's appearance *choice*, never a resolved mode. */
    fun appearancePreference(): AndroidAccountAppearancePreference? = null
    fun saveAppearancePreference(appearance: String): AndroidAccountAppearancePreference? = null
}

internal class AndroidTimeTrialsEcosystemClient(
    origin: String,
    private val session: AndroidAuthenticatedNativeSession?,
    private val opener: AndroidEcosystemConnectionOpener,
) : AndroidTimeTrialsEcosystemDataSource {
    private val origin = exactEcosystemOrigin(origin)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    override fun home(): AndroidHomeBootstrap =
        json.decodeFromString<AndroidHomeBootstrap>(request("/v1/bootstrap")).also {
            if (it.schemaVersion != "mk8dx.home-bootstrap.v1") malformed()
            if (session != null && !it.authenticated) {
                throw AndroidEcosystemClientException(401, "Sign in again to load your progress.")
            }
            it.comeback?.let { document ->
                if (document.schemaVersion != "mk8dx.home-comeback.v1") malformed()
            }
            // Every Mastery label follows the current World Records (owner 2026-09-26); the bootstrap
            // carries them, so no screen has to ask on its own.
            it.worldRecordTimes?.takeIf { document -> document.schemaVersion == "mk8dx.world-record-times.v1" }
                ?.let { document -> AndroidMasteryThresholds.applyWorldRecordTimes(document.records.map { r -> Triple(r.mode, r.trackId, r.totalTimeMs) }) }
            it.focus?.let { document ->
                if (document.schemaVersion != "mk8dx.home-focus.v1") malformed()
            }
            it.trackBests?.let { document ->
                if (document.schemaVersion != "mk8dx.public-track-bests.v1") malformed()
            }
            it.stories?.let { document ->
                if (document.schemaVersion != "mk8dx.activity-stories.v1") malformed()
            }
        }

    override fun leaderboard(trackId: String, mode: Int): List<AndroidPublicTimeTrialResult> {
        require(trackId.matches(trackIdPattern) && mode in setOf(150, 200))
        val query = "trackId=${encodeQuery(trackId)}&mode=$mode"
        val document = json.decodeFromString<AndroidLeaderboardDocument>(
            request("/v1/public/time-trial-leaderboard?$query"),
        )
        if (document.schemaVersion != "mk8dx.public-time-trial-leaderboard.v1" ||
            document.results.any { it.trackId != trackId || it.mode != mode }) malformed()
        return document.results
    }

    /**
     * Deliberately readable without a session: this is the one answer a Player
     * whose build has been turned off has to be able to get.
     */
    override fun clientSupport(): AndroidClientSupport? {
        val document = json.decodeFromString<AndroidClientSupportDocument>(
            request("/v1/public/client-support"),
        )
        if (document.schemaVersion != "mk8dx.client-support.v1") malformed()
        val android = document.android
        if (android.minimumSupportedBuild < 1 || android.retiredBuilds.size > 200 ||
            android.retiredBuilds.any { it < 1 } ||
            !android.downloadPagePath.startsWith("/") ||
            android.downloadPagePath.length > 128 ||
            android.downloadPagePath.contains("..")
        ) malformed()
        return AndroidClientSupport(
            currentVersion = android.currentVersion,
            currentBuild = android.currentBuild,
            minimumSupportedBuild = android.minimumSupportedBuild,
            retiredBuilds = android.retiredBuilds,
            downloadPagePath = android.downloadPagePath,
            message = android.message,
        )
    }

    override fun latestAndroidRelease(): AndroidAppRelease? {
        val document = json.decodeFromString<AndroidAppDownloadsDocument>(
            request("/v1/app-downloads"),
        )
        if (document.schemaVersion != "mk8dx.app-downloads.v1") malformed()
        val release = document.entries.singleOrNull {
            it.id == "android-timetrials" && it.platform == "android"
        } ?: return null
        if (!release.version.matches(Regex("^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$")) ||
            !release.releasedOn.matches(Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
        ) malformed()
        return AndroidAppRelease(release.version, release.releasedOn)
    }

    override fun playerResults(playerId: String): List<AndroidPublicTimeTrialResult> {
        require(playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")))
        val document = json.decodeFromString<AndroidPlayerTimeTrialsDocument>(
            request("/v1/public/players/${encodeQuery(playerId)}/time-trials"),
        )
        if (document.schemaVersion != "mk8dx.public-player-time-trials.v1" ||
            document.results.any { it.playerId != playerId }) malformed()
        return document.results
    }

    override fun playerInsights(): AndroidPlayerInsights? {
        if (session == null) return null
        val document = json.decodeFromString<AndroidPlayerInsights>(request("/v1/me/player-insights"))
        if (document.schemaVersion != "mk8dx.player-insights.v1" ||
            document.timeTrials.personalBests.any { (it.modeCC != 150 && it.modeCC != 200) || it.bestTimeMs <= 0 }) malformed()
        return document
    }

    override fun ratingHistory(playerId: String): List<AndroidRatingPoint> {
        require(playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")))
        val document = json.decodeFromString<AndroidRatingHistoryDocument>(
            request("/v1/public/players/${encodeQuery(playerId)}/rating-history"),
        )
        if (document.schemaVersion != "mk8dx.public-rating-history.v1" || document.points.any { !it.score.isFinite() }) malformed()
        return document.points
    }

    override fun ownRuns(): List<AndroidOwnRun> {
        if (session == null) return emptyList()
        val document = json.decodeFromString<AndroidOwnActivityDocument>(request("/v1/me/player-activity"))
        if (document.schemaVersion != "mk8dx.player-activity.v1" || document.timeTrials.size > 100) malformed()
        return document.timeTrials.filter { it.modeCC == 150 || it.modeCC == 200 }
    }

    override fun managedTimeTrials(): List<AndroidManagedTimeTrial> {
        if (session == null) return emptyList()
        val document = json.decodeFromString<AndroidManagedTimeTrialsDocument>(
            request("/v1/account/time-trials?limit=100"),
        )
        if (document.schemaVersion != "mk8dx.managed-time-trial-list.v1" ||
            document.results.any { !validManagedTimeTrial(it) }) malformed()
        return document.results
    }

    override fun retireTimeTrial(
        submissionId: String,
        reasonCode: String,
    ): AndroidManagedTimeTrial? = updateRetirement(
        submissionId,
        "retire",
        AndroidRetirementRequest(reasonCode),
    )

    override fun restoreTimeTrial(submissionId: String): AndroidManagedTimeTrial? =
        updateRetirement(
            submissionId,
            "restore",
            AndroidRetirementRequest("other", "Restored from the Android app."),
        )

    override fun correctTimeTrial(
        submissionId: String,
        correction: AndroidTimeTrialCorrection,
    ): AndroidManagedTimeTrial? = managedAction(
        submissionId, "correct", json.encodeToString(AndroidTimeTrialCorrection.serializer(), correction),
    )

    override fun setTimeTrialVideo(submissionId: String, videoUrl: String?): AndroidManagedTimeTrial? =
        // `null` removes the video, so it is written out rather than left away (explicitNulls = false).
        managedAction(
            submissionId, "video",
            kotlinx.serialization.json.buildJsonObject {
                put("videoUrl", kotlinx.serialization.json.JsonPrimitive(videoUrl))
            }.toString(),
        )

    private fun updateRetirement(
        submissionId: String,
        action: String,
        body: AndroidRetirementRequest,
    ): AndroidManagedTimeTrial? {
        require(action == "retire" || action == "restore")
        return managedAction(submissionId, action, json.encodeToString(AndroidRetirementRequest.serializer(), body))
    }

    private fun managedAction(submissionId: String, action: String, body: String): AndroidManagedTimeTrial? {
        if (session == null) return null
        require(submissionId.matches(Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")))
        require(action in setOf("retire", "restore", "correct", "video"))
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" ||
            csrf.headerName != "X-MK8DX-CSRF" || csrf.value.isBlank()) malformed()
        val document = json.decodeFromString<AndroidManagedTimeTrialDocument>(request(
            "/v1/time-trials/${encodeQuery(submissionId)}/actions/$action",
            "POST",
            body,
            csrf.value,
        ))
        if (document.schemaVersion != "mk8dx.managed-time-trial.v1" ||
            !validManagedTimeTrial(document.result)) malformed()
        return document.result
    }

    private fun validManagedTimeTrial(result: AndroidManagedTimeTrial): Boolean =
        result.submissionId.matches(Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")) &&
            result.playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")) &&
            result.retirementState in setOf("active", "retired") &&
            result.publicationStatus in setOf("published", "withheld") &&
            result.current.modeCc in setOf(150, 200) &&
            result.current.totalTimeMs in 1..599_999

    override fun playerProfile(playerId: String): AndroidProfilePlayer {
        require(playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")))
        return json.decodeFromString(request("/v1/players/${encodeQuery(playerId)}"))
    }

    override fun recordBook(): AndroidRecordBook =
        json.decodeFromString<AndroidRecordBook>(request("/v1/public/record-book")).also {
            if (it.schemaVersion != "mk8dx.public-record-book.v1" ||
                it.categories.any { category ->
                    category.key !in setOf("firsts", "podiums", "published", "coverage")
                }) malformed()
        }

    override fun notifications(): AndroidNotificationInbox? {
        if (session == null) return null
        return json.decodeFromString<AndroidNotificationInbox>(request("/v1/notifications")).also {
            if (it.schemaVersion != "mk8dx.notifications.v1") malformed()
        }
    }

    override fun notificationEvents(notificationId: String): List<AndroidNotificationEvent> {
        if (session == null) return emptyList()
        require(notificationId.matches(Regex("^[0-9]{1,19}$")))
        return json.decodeFromString<AndroidNotificationEventPage>(
            request("/v1/notifications/$notificationId/events"),
        ).also {
            if (it.schemaVersion != "mk8dx.notification-events.v1" ||
                it.notificationId != notificationId) malformed()
        }.events
    }

    override fun markAllNotificationsRead() {
        if (session == null) return
        val body = json.encodeToString(
            AndroidNotificationReadAllRequest.serializer(),
            AndroidNotificationReadAllRequest(all = true),
        )
        val result = json.decodeFromString<AndroidNotificationAcknowledgement>(
            request("/v1/notifications/read", "POST", body),
        )
        if (!result.acknowledged) malformed()
    }

    /**
     * Which build this copy of the app is running, said once a pass.
     *
     * The server keeps one row per version per installation, so this is what
     * makes "who is still on an old build" answerable at all. Nothing about
     * the Player travels with it: the account is the session, and the
     * installation id is the app's own local profile.
     */
    override fun checkInClient(
        installationId: String,
        version: String,
        build: Int,
        deviceModel: String?,
    ) {
        if (session == null) return
        require(build >= 1)
        val body = json.encodeToString(
            AndroidClientCheckinRequest.serializer(),
            AndroidClientCheckinRequest(
                installationId = installationId,
                client = "android",
                version = version,
                build = build,
                deviceModel = deviceModel?.take(64)?.takeIf { it.isNotBlank() },
            ),
        )
        val result = json.decodeFromString<AndroidNotificationAcknowledgement>(
            request("/v1/native/client-checkin", "POST", body),
        )
        if (!result.acknowledged) malformed()
    }

    override fun markNotificationsRead(notificationIds: List<String>) {
        if (session == null || notificationIds.isEmpty()) return
        require(notificationIds.size <= 100 && notificationIds.all { it.matches(Regex("^[0-9]{1,19}$")) })
        val body = json.encodeToString(
            AndroidNotificationReadRequest.serializer(),
            AndroidNotificationReadRequest(notificationIds.distinct()),
        )
        val result = json.decodeFromString<AndroidNotificationAcknowledgement>(
            request("/v1/notifications/read", "POST", body),
        )
        if (!result.acknowledged) malformed()
    }

    override fun notificationSettings(): AndroidNotificationSettings? {
        if (session == null) return null
        return json.decodeFromString<AndroidNotificationSettings>(request("/v1/notification-settings")).also {
            if (it.schemaVersion != "mk8dx.notification-settings.v1") malformed()
        }
    }

    override fun saveNotificationPreferences(
        preferences: AndroidNotificationPreferences,
    ): AndroidNotificationPreferences {
        if (session == null) return preferences
        val result = json.decodeFromString<AndroidNotificationAcknowledgement>(request(
            "/v1/notification-settings/preferences",
            "PUT",
            json.encodeToString(AndroidNotificationPreferences.serializer(), preferences),
        ))
        if (!result.acknowledged) malformed()
        return preferences
    }

    /** Public, like the Time Trial boards: no session is needed to read it. */
    override fun tournamentStanding(): List<AndroidTournamentStandingEntry> {
        val document = json.decodeFromString<AndroidTournamentStandingDocument>(
            request("/v1/public/tournament-standing"),
        )
        if (document.schemaVersion != "mk8dx.tournament-standing.v1") malformed()
        if (document.entries.any { it.finishes.size != ANDROID_TOURNAMENT_FINISH_POSITIONS }) {
            malformed()
        }
        return document.entries
    }

    override fun tournamentRivalries(playerId: String): List<AndroidTournamentRivalry> {
        require(playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")))
        val document = json.decodeFromString<AndroidTournamentRivalriesDocument>(
            request("/v1/public/players/${encodeQuery(playerId)}/tournament-rivalries"),
        )
        if (document.schemaVersion != "mk8dx.tournament-rivalries.v1" ||
            document.playerId != playerId
        ) malformed()
        return document.opponents
    }

    /**
     * Every compared Player's record over only the races all of them finished,
     * the count the site's comparison cards draw from.
     */
    override fun tournamentSharedRaces(playerIds: List<String>): AndroidTournamentSharedRaces {
        require(playerIds.size in 2..3 && playerIds.distinct().size == playerIds.size)
        require(playerIds.all { it.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")) })
        val document = json.decodeFromString<AndroidTournamentSharedRacesDocument>(
            request(
                "/v1/public/tournament-shared-races?players=" +
                    playerIds.joinToString(",") { encodeQuery(it) },
            ),
        )
        if (document.schemaVersion != "mk8dx.tournament-shared-races.v1" ||
            document.entries.map { it.playerId } != playerIds ||
            document.entries.any { it.finishes.size != ANDROID_TOURNAMENT_FINISH_POSITIONS }
        ) malformed()
        return AndroidTournamentSharedRaces(document.sharedRaces, document.entries)
    }

    /** Public, like the standing it sits beside. */
    override fun tournamentTrackRecord(playerId: String): AndroidTournamentTrackRecord {
        require(playerId.matches(Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")))
        val document = json.decodeFromString<AndroidTournamentTrackRecord>(
            request("/v1/public/players/${encodeQuery(playerId)}/tournament-tracks"),
        )
        if (document.schemaVersion != "mk8dx.tournament-track-record.v1" ||
            document.playerId != playerId
        ) malformed()
        return document
    }

    override fun sendEngagement(playerId: String, kind: String,
        detail: AndroidEngagementDetail?): AndroidEngagementDetail? {
        if (session == null) return null
        require(kind in setOf("poke", "rock_paper_scissors", "dice_roll", "challenge"))
        val result = json.decodeFromString<AndroidEngagementAcknowledgement>(request(
            "/v1/players/${encodeQuery(playerId)}/engagements",
            "POST",
            json.encodeToString(AndroidEngagementRequest.serializer(), AndroidEngagementRequest(kind, detail)),
            csrfProof(),
            acceptedStatus = 201,
        ))
        if (result.kind != kind || result.engagementId.isBlank() ||
            result.recipientPlayerId != playerId
        ) malformed()
        return result.detail
    }

    override fun playerEngagements(): AndroidPlayerEngagementsDocument {
        if (session == null) return AndroidPlayerEngagementsDocument(
            "mk8dx.player-engagements.v1", emptyList(), AndroidRpsStats(0, 0, 0, 0))
        val document = json.decodeFromString<AndroidPlayerEngagementsDocument>(request("/v1/player-engagements"))
        if (document.schemaVersion != "mk8dx.player-engagements.v1") malformed()
        return document
    }

    override fun answerRps(engagementId: String, hand: String): AndroidPlayerEngagement {
        require(hand in setOf("rock", "paper", "scissors"))
        require(engagementId.matches(Regex("^player_engagement\\.[A-Za-z0-9_-]{6,128}$")))
        val document = json.decodeFromString<AndroidPlayerEngagementResult>(request(
            "/v1/player-engagements/${encodeQuery(engagementId)}/reply", "POST",
            json.encodeToString(AndroidRpsReply.serializer(), AndroidRpsReply(hand)),
            csrfProof(),
        ))
        if (document.schemaVersion != "mk8dx.player-engagement-result.v1" ||
            document.engagement.engagementId != engagementId) malformed()
        return document.engagement
    }

    override fun answerDice(engagementId: String): AndroidPlayerEngagement {
        require(engagementId.matches(Regex("^player_engagement\\.[A-Za-z0-9_-]{6,128}$")))
        val document = json.decodeFromString<AndroidPlayerEngagementResult>(request(
            "/v1/player-engagements/${encodeQuery(engagementId)}/reply", "POST",
            json.encodeToString(AndroidDiceReply.serializer(), AndroidDiceReply()),
            csrfProof(),
        ))
        if (document.schemaVersion != "mk8dx.player-engagement-result.v1" ||
            document.engagement.engagementId != engagementId) malformed()
        return document.engagement
    }

    override fun engagementConversation(playerId: String): AndroidEngagementConversation? {
        if (session == null) return null
        val document = json.decodeFromString<AndroidEngagementConversation>(
            request("/v1/players/${encodeQuery(playerId)}/engagements"))
        if (document.schemaVersion != "mk8dx.player-engagement-conversation.v1" ||
            document.playerId != playerId) malformed()
        return document
    }

    override fun trackBestsFor(playerId: String): List<AndroidTrackBest> {
        val document = json.decodeFromString<AndroidTrackBestsDocument>(request(
            "/v1/public/track-bests?players=${encodeQuery(playerId)}",
        ))
        if (document.schemaVersion != "mk8dx.public-track-bests.v1") malformed()
        return document.players.firstOrNull { it.playerId == playerId }?.bests.orEmpty()
    }

    override fun reactToRun(resultId: String, kind: String) {
        if (session == null) throw AndroidEcosystemClientException(message = "Sign in to react")
        require(resultId.matches(Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")))
        require(kind in setOf("laugh", "very_funny", "crying", "nervous", "wow", "unbelievable",
            "cool", "competitive", "watching", "fire", "fast", "rocket", "strong", "clap",
            "thumbs_up", "trophy", "gold", "crown", "target", "heart"))
        request("/v1/time-trial-reactions", "PUT",
            json.encodeToString(AndroidReactionRequest.serializer(), AndroidReactionRequest(resultId, kind)),
            csrfProof())
    }

    override fun removeReaction(resultId: String) {
        if (session == null) throw AndroidEcosystemClientException(message = "Sign in to react")
        require(resultId.matches(Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")))
        request("/v1/time-trial-reactions", "DELETE",
            json.encodeToString(AndroidReactionRemoveRequest.serializer(), AndroidReactionRemoveRequest(resultId)),
            csrfProof())
    }

    override fun reactionSummaries(resultIds: List<String>): List<AndroidReactionSummary> {
        require(resultIds.size in 1..20)
        require(resultIds.all { it.matches(Regex("^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")) })
        val document = json.decodeFromString<AndroidReactionSummariesDocument>(request(
            "/v1/public/time-trial-reactions?resultIds=${resultIds.joinToString(",")}",
        ))
        if (document.schemaVersion != "mk8dx.public-time-trial-reactions.v1" ||
            document.reactions.any { it.resultId !in resultIds }) malformed()
        return document.reactions
    }

    private fun csrfProof(): String {
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" ||
            csrf.headerName != "X-MK8DX-CSRF" || csrf.value.isBlank()) malformed()
        return csrf.value
    }

    override fun rivals(): List<AndroidRival> {
        if (session == null) return emptyList()
        val document = json.decodeFromString<AndroidRivalsDocument>(request("/v1/account/rivals"))
        if (document.schemaVersion != "mk8dx.player-rivals.v1") malformed()
        return document.rivals
    }

    override fun worldRecords(): List<AndroidWorldRecord> {
        val document = json.decodeFromString<AndroidWorldRecordsDocument>(request("/v1/public/world-records"))
        if (document.schemaVersion != "mk8dx.world-records.v1") malformed()
        if (document.records.isNotEmpty() &&
            (document.records.size != 192 || document.records.map { "${it.mode}|${it.trackId}" }.toSet().size != 192)
        ) malformed()
        return document.records
    }

    override fun referenceGhostReadings(trackId: String, mode: Int): List<AndroidReferenceGhostReading> {
        require(trackId.matches(trackIdPattern) && mode in setOf(150, 200))
        val document = json.decodeFromString<AndroidReferenceGhostReadingsDocument>(
            request("/v1/public/reference-ghost-readings?trackId=${encodeQuery(trackId)}&mode=$mode"),
        )
        if (document.schemaVersion != "mk8dx.reference-ghost-readings.v1") malformed()
        return document.readings.filter {
            it.trackId == trackId && it.mode == mode && it.kind in setOf("nintendo_staff", "world_record") &&
                it.lapTimesMs.size in 3..7 && it.lapTimesMs.sum() == it.totalTimeMs
        }
    }

    override fun rankStandings(mode: Int, scope: String): List<AndroidRankStanding> {
        require(mode in setOf(150, 200))
        require(scope in setOf("base", "bcp", "all"))
        val document = json.decodeFromString<AndroidRankStandingsDocument>(request("/v1/public/time-trial-standings?mode=$mode&scope=$scope"))
        if (document.schemaVersion != "mk8dx.public-time-trial-standings.v1" || document.standings.any { it.mode != mode }) malformed()
        return document.standings
    }

    override fun findPlayers(query: String): List<AndroidDirectoryPlayer> {
        require(query.trim().length in 2..64)
        val document = json.decodeFromString<AndroidDirectoryDocument>(request("/v1/public/player-directory?query=${encodeQuery(query.trim())}"))
        if (document.schemaVersion != "mk8dx.player-directory.v1") malformed()
        return document.players
    }

    override fun socialGroups(): Pair<List<AndroidSocialGroup>, AndroidRankScopePreference> {
        if (session == null) return super.socialGroups()
        val document = json.decodeFromString<AndroidSocialGroupsDocument>(request("/v1/account/groups"))
        if (document.schemaVersion != "mk8dx.social-groups.v1") malformed()
        return document.groups to document.rankScope
    }

    override fun saveRankScope(preference: AndroidRankScopePreference) {
        if (session == null) return
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" || csrf.headerName != "X-MK8DX-CSRF" || csrf.value.isBlank()) malformed()
        request("/v1/account/rank-scope", "PUT", json.encodeToString(AndroidRankScopePreference.serializer(), preference), csrf.value)
    }

    override fun timeTrialPreferences(): AndroidTimeTrialPreferences? {
        if (session == null) return null
        return json.decodeFromString<AndroidTimeTrialPreferences>(request("/v1/account/time-trial-preferences")).also {
            if (it.schemaVersion != "mk8dx.account-time-trial-preferences.v1" ||
                it.modePreference !in setOf("all", "150", "200") ||
                it.trackAccess !in setOf("unknown", "base_only", "base_and_bcp")) malformed()
        }
    }

    override fun saveTimeTrialPreferences(preference: AndroidTimeTrialPreferences): AndroidTimeTrialPreferences {
        if (session == null) return preference
        require(preference.modePreference in setOf("all", "150", "200"))
        require(preference.trackAccess in setOf("unknown", "base_only", "base_and_bcp"))
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" || csrf.value.isBlank()) malformed()
        return json.decodeFromString<AndroidTimeTrialPreferences>(request(
            "/v1/account/time-trial-preferences", "PUT",
            json.encodeToString(AndroidTimeTrialPreferencesUpdate.serializer(),
                AndroidTimeTrialPreferencesUpdate(preference.modePreference, preference.screenName, preference.trackAccess)), csrf.value,
        ))
    }

    override fun playerProfilePreferences(): AndroidPlayerProfilePreferences? {
        if (session == null) return null
        return json.decodeFromString<AndroidPlayerProfilePreferences>(request("/v1/account/player-profile-preferences")).also {
            if (it.schemaVersion != "mk8dx.player-profile-preferences.v1") malformed()
        }
    }

    override fun savePlayerProfilePreferences(preference: AndroidPlayerProfilePreferences): AndroidPlayerProfilePreferences {
        if (session == null) return preference
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" || csrf.value.isBlank()) malformed()
        val update = AndroidPlayerProfilePreferencesUpdate(
            preference.countryId, preference.favoriteCharacterId, preference.favoriteBodyId,
            preference.favoriteTireId, preference.favoriteGliderId,
        )
        return json.decodeFromString(request(
            "/v1/account/player-profile-preferences", "PUT",
            json.encodeToString(AndroidPlayerProfilePreferencesUpdate.serializer(), update), csrf.value,
        ))
    }

    override fun appearancePreference(): AndroidAccountAppearancePreference? {
        if (session == null) return null
        return json.decodeFromString<AndroidAccountAppearancePreference>(
            request("/v1/account/appearance-preference"),
        ).also {
            if (it.schemaVersion != "mk8dx.account-appearance-preference.v1" ||
                (it.appearance != null && it.appearance !in APPEARANCE_CHOICES)) malformed()
        }
    }

    override fun saveAppearancePreference(appearance: String): AndroidAccountAppearancePreference? {
        if (session == null) return null
        require(appearance in APPEARANCE_CHOICES)
        val csrf = json.decodeFromString<AndroidCsrfDocument>(request("/v1/session/csrf"))
        if (csrf.schemaVersion != "mk8dx.web-csrf.v1" || csrf.value.isBlank()) malformed()
        return json.decodeFromString<AndroidAccountAppearancePreference>(
            request(
                "/v1/account/appearance-preference", "PUT",
                json.encodeToString(
                    AndroidAccountAppearancePreferenceUpdate.serializer(),
                    AndroidAccountAppearancePreferenceUpdate(appearance),
                ),
                csrf.value,
            ),
        )
    }

    private fun request(
        pathAndQuery: String,
        method: String = "GET",
        body: String? = null,
        csrf: String? = null,
        acceptedStatus: Int = 200,
    ): String {
        val path = pathAndQuery.substringBefore('?')
        val query = pathAndQuery.substringAfter('?', "").ifBlank { null }
        require(path.startsWith("/v1/") && !path.contains(".."))
        val target = URI(origin.scheme, null, origin.host, origin.port, path, query, null)
        val connection = opener.open(target.toURL())
        try {
            if (connection.url.toURI() != target) {
                throw AndroidEcosystemClientException(message = "Ecosystem endpoint mismatch")
            }
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.allowUserInteraction = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Accept", "application/json")
            session?.let { connection.setRequestProperty("Authorization", "Bearer ${it.bearerToken}") }
            csrf?.let { connection.setRequestProperty("X-MK8DX-CSRF", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status == acceptedStatus) connection.inputStream else connection.errorStream
            val response = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8_192)
                while (output.size() <= MAX_ECOSYSTEM_RESPONSE_BYTES) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
                if (output.size() > MAX_ECOSYSTEM_RESPONSE_BYTES) {
                    throw AndroidEcosystemClientException(status, "Ecosystem response was too large")
                }
                output.toString(Charsets.UTF_8.name())
            }.orEmpty()
            if (status != acceptedStatus) {
                val error = runCatching { json.parseToJsonElement(response).jsonObject }.getOrNull()
                val message = error?.get("message")?.toString()?.trim('"') ?: "Ecosystem request failed"
                val code = error?.get("code")?.toString()?.trim('"')
                throw AndroidEcosystemClientException(status, message, code)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun malformed(): Nothing =
        throw AndroidEcosystemClientException(message = "Ecosystem response contract mismatch")

    private companion object {
        /** The three values `/v1/account/appearance-preference` accepts. */
        val APPEARANCE_CHOICES = setOf("system", "light", "dark")
    }
}

private fun exactEcosystemOrigin(value: String): URI {
    val uri = runCatching { URI(value) }
        .getOrElse { throw IllegalArgumentException("Ecosystem origin is invalid") }
    require(
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
            uri.rawPath in setOf("", "/") && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.port == -1 || uri.port in 1..65_535),
    )
    return uri
}

private fun encodeQuery(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
