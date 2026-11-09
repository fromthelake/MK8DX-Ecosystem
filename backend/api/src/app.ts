import { randomBytes } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";

import type { OperationalLogSink } from "./runtime/operational-log.js";
import {
  injectSocialMeta,
  socialPreviewMeta,
  type SocialPreviewDependencies,
} from "./runtime/social-preview.js";
import {
  STATIC_WEB_SECURITY_HEADERS,
  type StaticWebFile,
} from "./runtime/static-web.js";
import { registerPublicBundleRoutes } from "./runtime/public-bundle.js";

import { registerAdministratorGrantRoutes } from
  "./administration/administrator-grant-routes.js";
import { registerAdministratorOverviewRoutes } from
  "./administration/administrator-overview-routes.js";
import type { AdministratorOverviewService } from
  "./administration/administrator-overview.js";
import type { AdministratorGrantService } from
  "./administration/administrator-grant-service.js";

import {
  registerEmbeddedAuthRoutes,
  type EmbeddedPasswordlessAuth,
} from "./authentication/embedded-passwordless-auth.js";

import { registerAliasRoutes } from "./identity/alias-routes.js";
import type {
  AliasReadRepository,
  AliasService,
} from "./identity/alias-service.js";
import type { ClaimLifecycleService } from "./identity/claim-lifecycle-service.js";
import { registerIdentityRoutes } from "./identity/routes.js";
import { registerPlayerOnboardingRoutes } from
  "./identity/player-onboarding-routes.js";
import type { PlayerOnboardingService } from
  "./identity/player-onboarding-service.js";
import { registerPublicRatingRoutes } from "./rating/public-rating-routes.js";
import {
  registerRatingAdministrationRoutes,
  type RatingAdministrationReadRepository,
} from "./rating/rating-administration-routes.js";
import type { RatingLifecycleService } from "./rating/rating-lifecycle-service.js";
import { registerGameAssetRoutes } from "./runtime/game-assets.js";
import type { MysqlPublicRatingRepository } from
  "./rating/mysql-rating-repository.js";
import type {
  ActorContext,
  ActorResolver,
  IdentityReadRepository,
} from "./identity/types.js";
import { registerPlayerActivityRoutes } from
  "./profiles/player-activity-routes.js";
import type { PlayerActivityService } from
  "./profiles/player-activity-service.js";
import { registerIdentityLinkAdminRoutes } from
  "./identity/identity-link-admin-routes.js";
import type { IdentityLinkAdminService } from
  "./identity/identity-link-admin-service.js";
import { registerClaimReviewRoutes } from "./profiles/claim-review-routes.js";
import { registerClaimCandidateRoutes } from "./profiles/claim-candidate-routes.js";
import type { ClaimCandidateService } from "./profiles/claim-candidate-service.js";
import type { ClaimReviewReadService } from "./profiles/claim-review-read-service.js";
import { registerPlayerClaimProductRoutes } from
  "./profiles/player-claim-product-routes.js";
import type { PlayerClaimProductService } from
  "./profiles/player-claim-product-service.js";
import { registerPlayerInsightsRoutes } from
  "./profiles/player-insights-routes.js";
import { registerCommunityOverviewRoutes } from
  "./profiles/community-overview-routes.js";
import { registerRecordBookRoutes } from
  "./profiles/record-book-routes.js";
import type { RecordBookService } from
  "./profiles/record-book-service.js";
import type { CommunityOverviewService } from
  "./profiles/community-overview-service.js";
import { registerPlayerAvatarRoutes } from
  "./profiles/player-avatar-routes.js";
import type { PlayerAvatarService } from
  "./profiles/player-avatar-service.js";
import { registerAccountTimeTrialPreferenceRoutes } from
  "./profiles/account-time-trial-preferences.js";
import type { AccountTimeTrialPreferencesService } from
  "./profiles/account-time-trial-preferences.js";
import {
  registerAccountAppearancePreferenceRoutes,
  type AccountAppearancePreferenceService,
} from "./profiles/account-appearance-preference.js";
import {
  registerPlayerProfilePreferenceRoutes,
  type PlayerProfilePreferenceService,
} from "./profiles/player-profile-preferences.js";
import { registerAppDownloadRoutes } from
  "./runtime/app-download-routes.js";
import type { AppDownloadStore } from "./runtime/app-downloads.js";
import { registerClientSupportRoutes } from "./runtime/client-support-routes.js";
import { registerClientInstallationRoutes } from
  "./runtime/client-installation-routes.js";
import type { ClientInstallationService } from "./runtime/client-installations.js";
import { registerPlayerVisibilityRoutes } from
  "./profiles/player-visibility-routes.js";
import type { PlayerVisibilityService } from
  "./profiles/player-visibility-service.js";
import { registerTimeTrialCompletionRoutes } from "./timetrials/completion-routes.js";
import { registerReferenceGhostRoutes } from "./reference-ghosts/reference-ghost-routes.js";
import type { ReferenceGhostReadingService } from "./reference-ghosts/reference-ghost-readings.js";
import type { TimeTrialCompletionService } from "./timetrials/completion-service.js";
import { registerTimeTrialLifecycleRoutes } from
  "./timetrials/lifecycle-routes.js";
import type { TimeTrialLifecycleService } from
  "./timetrials/lifecycle-service.js";
import { registerPlayerCountryRoutes } from
  "./profiles/player-country-routes.js";
import type { PlayerCountryService } from
  "./profiles/player-country-service.js";
import { registerPublicCareerRoutes } from
  "./profiles/public-career-routes.js";
import type { PublicCareerService } from
  "./profiles/public-career-service.js";
import type { PlayerInsightsService } from
  "./profiles/player-insights-service.js";
import { registerWebCsrfRoutes } from "./security/web-csrf-routes.js";
import type { WebCsrfService } from "./security/web-csrf-service.js";
import {
  registerTimeTrialSubmissionRoutes,
  type TimeTrialSubmissionAuthorizer,
  type TimeTrialWebCsrfVerifier,
} from "./timetrials/submission-routes.js";
import type { SubmissionFeedbackService } from "./timetrials/submission-feedback.js";
import { registerTimeTrialRevisionReadRoutes } from
  "./timetrials/revision-read-routes.js";
import type { TimeTrialRevisionReadService } from
  "./timetrials/revision-read-service.js";
import type { TimeTrialSubmissionService } from
  "./timetrials/submission-service.js";
import type { MutationRateLimiter } from "./security/mysql-mutation-rate-limiter.js";
import type { EphemeralAndroidScanTestService } from
  "./timetrials/ephemeral-scan-test-service.js";
import type { ActivityStoryService } from "./home/activity-story-service.js";
import { registerHomeRoutes } from "./home/home-routes.js";
import { registerHomeBootstrapRoutes } from
  "./home/home-bootstrap-routes.js";
import type { HomeFocusService } from "./home/home-focus-service.js";
import type {
  FollowPreferenceService,
  HomeComebackService,
  RivalPreferenceService,
} from "./home/home-comeback-service.js";
import { registerNotificationRoutes } from
  "./notifications/notification-routes.js";
import type { NotificationService } from
  "./notifications/notification-service.js";
import { registerNotificationChannelRoutes } from
  "./notifications/notification-channel-routes.js";
import type { NotificationChannelService } from
  "./notifications/notification-channel-service.js";
import { registerPlayerEngagementRoutes } from "./social/player-engagement-routes.js";
import type { PlayerEngagementService } from "./social/player-engagement-service.js";
import { registerSocialGroupRoutes } from "./social/social-group-routes.js";
import type { SocialGroupService } from "./social/social-group-service.js";
import { registerWorldRecordRoutes } from "./world-records/world-record-routes.js";
import type { WorldRecordService } from "./world-records/world-record-service.js";
import { registerReactionRoutes } from "./timetrials/reaction-routes.js";
import type { ReactionService } from "./timetrials/reaction-service.js";
import { registerPublicTimeTrialRoutes } from
  "./timetrials/public-time-trial-routes.js";
import type { PublicTimeTrialService } from
  "./timetrials/public-time-trial-service.js";
import { registerWebManualSessionRoutes } from
  "./timetrials/web-manual-session-routes.js";
import type { WebManualSessionService } from
  "./timetrials/web-manual-session-service.js";
import type { NativeEmailApprovalService } from
  "./authentication/native-email-approval.js";
import { registerNativeEmailApprovalRoutes } from
  "./authentication/native-email-approval-routes.js";
import { registerNativeTimeTrialSessionRoutes } from
  "./timetrials/native-session-routes.js";
import type { NativeTimeTrialSessionService } from
  "./timetrials/native-session-service.js";
import { registerSessionCapabilityRoutes } from
  "./authentication/session-capability-routes.js";
import {
  registerTournamentSubmissionRoutes,
  type TournamentSubmissionAuthorizer,
  type TournamentWebCsrfVerifier,
} from "./tournaments/race-result-routes.js";
import { registerTournamentRevisionReadRoutes } from
  "./tournaments/race-result-read-routes.js";
import type { TournamentRevisionReadService } from
  "./tournaments/race-result-read-service.js";
import type { TournamentRaceResultService } from
  "./tournaments/race-result-service.js";
import {
  registerPublicTournamentRoutes,
  registerTournamentPublicationRoutes,
} from "./tournaments/tournament-publication-routes.js";
import { registerObservedIdentityAdminRoutes } from
  "./tournament-history/observed-identity-admin-routes.js";
import type { ObservedIdentityAdminService } from
  "./tournament-history/observed-identity-admin-service.js";
import { registerTournamentTrackRecordRoutes } from
  "./tournaments/tournament-track-record-routes.js";
import type { TournamentTrackRecordService } from
  "./tournaments/tournament-track-record-service.js";
import { registerTournamentStandingRoutes } from
  "./tournaments/tournament-standing-routes.js";
import type { TournamentStandingService } from
  "./tournaments/tournament-standing-service.js";
import type { PublicTournamentService } from
  "./tournaments/public-tournament-service.js";
import type { TournamentPublicationService } from
  "./tournaments/tournament-publication-service.js";
import type { TournamentStatisticsService } from
  "./tournaments/tournament-statistics.js";
import {
  registerPublicTournamentEventRoutes,
  registerTournamentOperationRoutes,
  type TournamentOperationRouteDependencies,
} from "./tournaments/tournament-operation-routes.js";
import type { TournamentOperationService } from
  "./tournaments/tournament-operation-service.js";
import { registerTournamentConnectedRoutes } from
  "./tournaments/tournament-connected-routes.js";
import type { TournamentConnectedService } from
  "./tournaments/tournament-connected-service.js";
import { registerTournamentNativeOperationRoutes } from
  "./tournaments/tournament-native-operation-routes.js";
import { registerTournamentRetractionRoutes } from
  "./tournaments/tournament-retraction-routes.js";
import type { TournamentRetractionService } from
  "./tournaments/tournament-retraction-service.js";
import {
  registerTournamentReportRoutes,
  type TournamentReportRouteDependencies,
} from "./tournaments/tournament-report-routes.js";
import { registerTournamentOperatorCapabilityRoutes } from "./tournaments/tournament-operator-capability-routes.js";
import type { TournamentOperatorCapabilityService } from "./tournaments/tournament-operator-capability-service.js";
import { registerDirectorHostRequestRoutes } from "./tournaments/director-host-request-routes.js";
import { registerInstallationSettingsRoutes } from "./administration/installation-settings-routes.js";
import type { InstallationSettingsService } from "./administration/installation-settings-service.js";
import type { DirectorHostRequestService } from "./tournaments/director-host-request-service.js";
import { registerTournamentSignupRoutes } from "./tournaments/tournament-signup-routes.js";
import type { TournamentSignupService } from "./tournaments/tournament-signup-service.js";

export type AppDependencies = Readonly<{
  identityRepository: IdentityReadRepository;
  requestConcurrencyLimit?: number;
  embeddedAuth?: Readonly<{
    auth: EmbeddedPasswordlessAuth;
    baseUrl: string;
    offlineLan?: boolean;
  }>;
  nativeEmailApproval?: Readonly<{
    service: Pick<NativeEmailApprovalService, "request" | "verifyCode" | "inspectLink" | "approveLink">;
  }>;
  resolveActor?: ActorResolver;
  claimLifecycle?: Pick<
    ClaimLifecycleService,
    "requestClaim" | "administratorAction" | "openDispute" | "releaseOwnClaim" | "replyToClaim"
  >;
  claimCsrfVerifier?: Readonly<{
    verify(actor: ActorContext, token: string): boolean;
  }>;
  administratorOverview?: Readonly<{
    service: Pick<AdministratorOverviewService, "overview">;
  }>;
  administratorGrants?: Readonly<{
    service: Pick<
      AdministratorGrantService,
      "grantAdministrator" | "revokeAdministrator"
    >;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
    rateLimiter: MutationRateLimiter;
  }>;
  aliasRepository?: AliasReadRepository;
  aliasService?: Pick<AliasService, "createAlias" | "updateAlias">;
  playerActivity?: Readonly<{
    service: Pick<PlayerActivityService, "loadMine">;
  }>;
  identityLinkAdmin?: Readonly<{
    service: IdentityLinkAdminService;
    csrfVerifier: { verify(actor: unknown, proof: string): boolean | Promise<boolean> };
  }>;
  // Which person was behind a name on screen, per tournament section. The
  // binder derives it; this is where a person overrules it.
  observedIdentityAdmin?: Readonly<{
    service: ObservedIdentityAdminService;
    csrfVerifier: { verify(actor: unknown, proof: string): boolean | Promise<boolean> };
  }>;
  // The claim walk of ADR-0216: the person's own claims with notes, and the reviewer's cards.
  claimReviews?: Readonly<{
    service: Pick<ClaimReviewReadService, "listMyClaimWalk" | "listReviewQueue">;
  }>;
  // ADR-0219: the Players a signed-in person may be, with public context.
  claimCandidates?: Readonly<{
    service: Pick<ClaimCandidateService, "search">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean | Promise<boolean> }>;
  }>;
  playerClaimProduct?: Readonly<{
    service: Pick<
      PlayerClaimProductService,
      "search" | "searchPublic" | "list" | "listMine" | "listReviewQueue" |
      "listLinkedPlayerAccounts"
    >;
  }>;
  playerOnboarding?: Readonly<{
    service: Pick<PlayerOnboardingService, "createOwnPlayer" | "createPlayerForAdministrator" | "createRosterPlayers">;
    csrfVerifier?: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
    rateLimiter?: MutationRateLimiter;
  }>;
  publicRatings?: Readonly<{
    repository: Pick<MysqlPublicRatingRepository, "listRatings">;
    history?: Readonly<{
      listRatingHistory(playerId: string): Promise<readonly unknown[]>;
      listOpponents(playerId: string): Promise<readonly unknown[]>;
      listTournamentStandings(): Promise<readonly unknown[]>;
      headToHead(playerAId: string, playerBId: string): Promise<unknown>;
    }>;
  }>;
  gameAssets?: Readonly<{ rootDirectory: string }>;
  appDownloads?: Readonly<{ store: AppDownloadStore }>;
  clientInstallations?: Readonly<{ service: ClientInstallationService }>;
  playerInsights?: Readonly<{
    service: Pick<PlayerInsightsService, "loadMine">;
  }>;
  publicCareer?: Readonly<{
    service: Pick<PublicCareerService, "loadCareer">;
  }>;
  playerCountry?: Readonly<{
    service: Pick<PlayerCountryService, "setOwnCountry">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  playerVisibility?: Readonly<{
    service: Pick<
      PlayerVisibilityService, "readOwn" | "setOwn" | "setForPlayer"
    >;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>;
  timeTrialLifecycle?: Readonly<{
    service: Pick<
      TimeTrialLifecycleService,
      "readOwnedOrAdministered" | "listOwn" | "listForAdministrator"
      | "correct" | "retire" | "restore" | "setVideo"
    >;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>;
  // ADR-0210 rule 10: a native reading fills in what a published result is missing.
  timeTrialCompletion?: Readonly<{
    service: Pick<TimeTrialCompletionService, "complete">;
    rateLimiter?: MutationRateLimiter;
  }>;
  // ADR-0212: proven Nintendo staff and World Record ghost readings from LiveTrial.
  referenceGhosts?: Readonly<{
    service: Pick<ReferenceGhostReadingService, "record" | "list">;
    rateLimiter?: MutationRateLimiter;
  }>;
  communityOverview?: Readonly<{
    service: Pick<CommunityOverviewService, "loadOverview">;
  }>;
  recordBook?: Readonly<{
    service: Pick<RecordBookService, "loadRecordBook">;
  }>;
  playerAvatar?: Readonly<{
    service: Pick<PlayerAvatarService, "setOwnAvatar">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  timeTrialSubmission?: Readonly<{
    service: Pick<TimeTrialSubmissionService, "submit">;
    testService?: Pick<EphemeralAndroidScanTestService, "submit" | "listForAccount">;
    authorizer: TimeTrialSubmissionAuthorizer;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter?: MutationRateLimiter;
    feedback?: Pick<SubmissionFeedbackService, "forSubmission">;
  }>;
  publicTimeTrials?: Readonly<{
    service: Pick<
      PublicTimeTrialService,
      "listPlayerResults" | "listLeaderboard" | "listPlayerTrackBests" |
      "listTrackBestsForPlayers" | "listRecentResults" | "listStandings"
    >;
  }>;
  reactions?: Readonly<{
    service: Pick<ReactionService, "summarize" | "react" | "remove">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter?: MutationRateLimiter;
  }>;
  notifications?: Readonly<{
    service: Pick<NotificationService, "listMine" | "markRead" | "listEvents">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  home?: Readonly<{
    comeback: Pick<HomeComebackService, "loadMine">;
    rivals: Pick<RivalPreferenceService, "listMine" | "add" | "remove">;
    follows: Pick<FollowPreferenceService, "listMine" | "add" | "remove">;
    focus: Pick<HomeFocusService, "loadMine">;
    stories: Pick<ActivityStoryService, "listStories">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>;
  webManualSession?: Readonly<{
    service: Pick<WebManualSessionService, "bootstrap">;
  }>;
  nativeTimeTrialSession?: Readonly<{
    service: Pick<NativeTimeTrialSessionService, "bootstrap" | "bootstrapV2">;
  }>;
  webCsrf?: Readonly<{
    service: Pick<WebCsrfService, "issue">;
  }>;
  timeTrialRevisionRead?: Readonly<{
    service: Pick<TimeTrialRevisionReadService, "readRevision">;
  }>;
  tournamentSubmission?: Readonly<{
    service: Pick<TournamentRaceResultService, "submit">;
    authorizer: TournamentSubmissionAuthorizer;
    csrfVerifier?: TournamentWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  tournamentRevisionRead?: Readonly<{
    service: Pick<TournamentRevisionReadService, "readRevision">;
  }>;
  tournamentPublications?: Readonly<{
    service: Pick<
      TournamentPublicationService,
      "listReview" | "createPublication" | "republish" | "retract"
    >;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
    rateLimiter: MutationRateLimiter;
    onPublished?: (publicationId: string) => Promise<void>;
  }>;
  publicTournaments?: Readonly<{
    service: Pick<PublicTournamentService, "loadPublication" | "listPlayerResults">;
  }>;
  tournamentStanding?: Readonly<{
    service: Pick<TournamentStandingService, "standing" | "rivalries" | "sharedRaces">;
  }>;
  // Which tracks a Player is strong on, out of the corrected tournament
  // history. Separate from the standing because it answers a different
  // question and only exists for the tournaments that were recorded.
  tournamentTrackRecord?: Readonly<{
    service: Pick<TournamentTrackRecordService, "recordFor">;
  }>;
  // Canonical tournament operation (ADR-0160): the administrator board
  // requires the same-origin CSRF proof; the public event reads are
  // session-aware (in-progress events for signed-in accounts only).
  ratingAdministration?: Readonly<{
    service: Pick<RatingLifecycleService, "recordDecision" | "recalculate" | "applyPublication">;
    readRepository: RatingAdministrationReadRepository;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
  }>;
  tournamentOperations?: Readonly<{
    service: TournamentOperationRouteDependencies["service"] &
      Pick<TournamentOperationService, "listPublic" | "loadPublic" | "loadPublicPlacements">;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
    /** What the community raced over every finished night, where it is known. */
    statistics?: Pick<TournamentStatisticsService, "load" | "loadTrack">;
  }>;
  notificationChannels?: Readonly<{
    service: NotificationChannelService;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>;
  accountTimeTrialPreferences?: Readonly<{
    service: Pick<AccountTimeTrialPreferencesService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  accountAppearancePreference?: Readonly<{
    service: Pick<AccountAppearancePreferenceService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  playerProfilePreferences?: Readonly<{
    service: Pick<PlayerProfilePreferenceService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>;
  socialGroups?: Readonly<{
    service: Pick<SocialGroupService, "listMine" | "create" | "invite" | "respond" | "leave" | "removeMember" | "setRole" | "archive" | "saveRankScope">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter?: MutationRateLimiter;
  }>;
  playerEngagements?: Readonly<{
    service: Pick<PlayerEngagementService, "send" | "list" | "answer" | "conversation">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter?: MutationRateLimiter;
  }>;
  worldRecords?: Readonly<{ service: Pick<WorldRecordService, "list"> }>;
  tournamentConnected?: Readonly<{
    service: TournamentConnectedService;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
  }>;
  tournamentRetraction?: Readonly<{
    service: TournamentRetractionService;
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
  }>;
  tournamentReports?: Readonly<{
    service: TournamentReportRouteDependencies["service"];
    csrfVerifier: Readonly<{
      verify(actor: ActorContext, token: string): boolean;
    }>;
  }>;
  tournamentOperatorCapabilities?: Readonly<{
    service: TournamentOperatorCapabilityService;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>;
  // "Request to host" (ADR-0220): the Tournaments page's request and the Directors queue.
  // ADR-0221: who creates Players and who counts for the rating, and the explicit recalculation.
  installationSettings?: Readonly<{
    service: Pick<InstallationSettingsService, "current" | "administration" | "update" | "recomputeRatings">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>;
  directorHostRequests?: Readonly<{
    service: Pick<DirectorHostRequestService, "standing" | "submit" | "queue" | "approve" | "decline">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>;
  // Open sign-up, the waiting list and the status line (ADR-0222).
  tournamentSignups?: Readonly<{
    service: Pick<TournamentSignupService, "status" | "signUp" | "withdraw" | "board" | "configure" | "closeNow" | "move">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>;
  readinessProbe?: Readonly<{
    check(): Promise<void>;
    timeoutMs: number;
  }>;
  operationalLog?: OperationalLogSink;
  socialPreview?: SocialPreviewDependencies;
  staticWeb?: Readonly<{
    files: ReadonlyMap<string, StaticWebFile>;
  }>;
  publicBundle?: Readonly<{ root: string; origin: string }>;
}>;

const anonymousActor: ActorResolver = async () => ({ role: "anonymous" });

async function boundedReadiness(
  probe: NonNullable<AppDependencies["readinessProbe"]>,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe.check(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("readiness timed out")), probe.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) { clearTimeout(timeout); }
  }
}

const clientErrorPhrases: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  406: "Not Acceptable",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  429: "Too Many Requests",
};

export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const operationalLog = dependencies.operationalLog;
  const app = Fastify({
    logger: false,
    genReqId: () => randomBytes(8).toString("hex"),
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
  });

  if (dependencies.requestConcurrencyLimit !== undefined) {
    const limit = dependencies.requestConcurrencyLimit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error("request concurrency limit is invalid");
    }
    let inFlight = 0;
    const counted = new WeakSet<object>();
    const release = (request: object): void => {
      if (!counted.delete(request)) return;
      inFlight = Math.max(0, inFlight - 1);
    };
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?", 1)[0];
      // Monitoring must still be able to distinguish alive/not-ready while
      // ordinary work is deliberately shedding load.
      if (path === "/health/live" || path === "/health/ready") return;
      if (inFlight >= limit) {
        void reply.header("retry-after", "1");
        return reply.code(503).send({
          statusCode: 503,
          error: "Service Unavailable",
          message: "Server is busy. Try again shortly.",
        });
      }
      inFlight += 1;
      counted.add(request);
    });
    app.addHook("onResponse", async (request) => { release(request); });
    app.addHook("onRequestAbort", async (request) => { release(request); });
  }

  // How long the application itself took, so a slow page can be attributed
  // to the app or to everything around it (spawn, queueing, network) without
  // guessing. Timing only; it carries no request or user data.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header(
      "server-timing",
      `app;dur=${Math.round(reply.elapsedTime)}`,
    );
    return payload;
  });

  if (operationalLog !== undefined) {
    app.addHook("onResponse", async (request, reply) => {
      if (reply.statusCode >= 500) {
        operationalLog.log({
          event: "request_failed",
          category: "request",
          requestId: String(request.id),
          method: request.method,
          route: request.routeOptions?.url ?? "unmatched",
          statusCode: reply.statusCode,
          durationMs: reply.elapsedTime,
        });
      }
    });
  }
  app.setErrorHandler((error: unknown, request, reply) => {
    const raised = error instanceof Error
      ? (error as Error & { statusCode?: unknown; code?: unknown })
      : undefined;
    const statusCode = raised !== undefined &&
      typeof raised.statusCode === "number" &&
      Number.isSafeInteger(raised.statusCode)
      ? raised.statusCode
      : 500;
    if (raised !== undefined && statusCode >= 400 && statusCode < 500) {
      // Preserve the default bounded client-error shape (schema-validation
      // messages are structural, never private values).
      return reply.status(statusCode).send({
        statusCode,
        ...(typeof raised.code === "string" ? { code: raised.code } : {}),
        error: clientErrorPhrases[statusCode] ?? "Client Error",
        message: raised.message,
      });
    }
    // Server-side failures never echo internal error text to clients; the
    // operational log records only the error class and route pattern.
    operationalLog?.log({
      event: "request_error",
      category: "request",
      requestId: String(request.id),
      method: request.method,
      route: request.routeOptions?.url ?? "unmatched",
      statusCode: 500,
      errorName: raised?.name ?? "UnknownError",
    });
    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal Server Error",
    });
  });

  app.get("/health/live", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", const: "alive" } },
        },
      },
    },
  }, async () => ({ status: "alive" }));

  app.get("/health/ready", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", const: "ready" } },
        },
        503: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", const: "not_ready" } },
        },
      },
    },
  }, async (_request, reply) => {
    if (dependencies.readinessProbe === undefined) {
      return reply.code(503).send({ status: "not_ready" });
    }
    try {
      await boundedReadiness(dependencies.readinessProbe);
      return reply.send({ status: "ready" });
    } catch {
      operationalLog?.log({
        event: "readiness_failed",
        category: "readiness",
        statusCode: 503,
      });
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  if (dependencies.staticWeb !== undefined) {
    // Root-mounted Passenger deployments route every request to this
    // application, so the static web product is served same-origin from the
    // closed in-memory map built at startup (no filesystem access per
    // request, no path construction from request input).
    const socialPreview = dependencies.socialPreview;
    const indexHtml = socialPreview === undefined
      ? null
      : dependencies.staticWeb.files.get("/")?.body.toString("utf8") ?? null;
    for (const [route, file] of dependencies.staticWeb.files) {
      if (route === "/" && socialPreview !== undefined && indexHtml !== null) {
        // Shared links get server-rendered Open Graph metadata; the
        // response varies by query, so it is served without an ETag.
        app.get(route, async (request, reply) => {
          for (const [header, value] of
            Object.entries(STATIC_WEB_SECURITY_HEADERS)) {
            void reply.header(header, value);
          }
          void reply.header("cache-control", "no-cache");
          let body = indexHtml;
          try {
            const meta = await socialPreviewMeta(
              request.query as Readonly<Record<string, unknown>>,
              socialPreview,
            );
            body = injectSocialMeta(indexHtml, meta);
          } catch {
            // The plain document is always a safe fallback.
          }
          return reply.type(file.contentType).send(body);
        });
        continue;
      }
      app.get(route, async (request, reply) => {
        for (const [header, value] of
          Object.entries(STATIC_WEB_SECURITY_HEADERS)) {
          void reply.header(header, value);
        }
        void reply.header("cache-control", "no-cache");
        void reply.header("etag", file.etag);
        if (request.headers["if-none-match"] === file.etag) {
          return reply.code(304).send();
        }
        return reply.type(file.contentType).send(file.body);
      });
    }
  }

  if (dependencies.publicBundle !== undefined) {
    await registerPublicBundleRoutes(app, dependencies.publicBundle.root,
      dependencies.publicBundle.origin);
  }

  if (dependencies.embeddedAuth !== undefined) {
    await registerEmbeddedAuthRoutes(
      app,
      dependencies.embeddedAuth.auth,
      dependencies.embeddedAuth.baseUrl,
      dependencies.embeddedAuth.offlineLan === true,
    );
  }
  if (dependencies.nativeEmailApproval !== undefined) {
    await registerNativeEmailApprovalRoutes(app, {
      service: dependencies.nativeEmailApproval.service,
    });
  }

  await registerIdentityRoutes(app, {
    repository: dependencies.identityRepository,
    resolveActor: dependencies.resolveActor ?? anonymousActor,
    ...(dependencies.claimLifecycle === undefined
      ? {}
      : { claimLifecycle: dependencies.claimLifecycle }),
    ...(dependencies.claimCsrfVerifier === undefined
      ? {}
      : { claimCsrfVerifier: dependencies.claimCsrfVerifier }),
  });
  if (dependencies.administratorOverview !== undefined) {
    await registerAdministratorOverviewRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.administratorOverview.service,
    });
  }
  if (dependencies.administratorGrants !== undefined) {
    await registerAdministratorGrantRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.administratorGrants.service,
      csrfVerifier: dependencies.administratorGrants.csrfVerifier,
      rateLimiter: dependencies.administratorGrants.rateLimiter,
    });
  }
  if (
    dependencies.aliasRepository !== undefined ||
    dependencies.aliasService !== undefined
  ) {
    await registerAliasRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      ...(dependencies.aliasRepository === undefined
        ? {}
        : { repository: dependencies.aliasRepository }),
      ...(dependencies.aliasService === undefined
        ? {}
        : { service: dependencies.aliasService }),
    });
  }
  if (dependencies.playerActivity !== undefined) {
    await registerPlayerActivityRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerActivity.service,
    });
  }
  if (dependencies.identityLinkAdmin !== undefined) {
    await registerIdentityLinkAdminRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.identityLinkAdmin.service,
      csrfVerifier: dependencies.identityLinkAdmin.csrfVerifier,
    });
  }
  if (dependencies.observedIdentityAdmin !== undefined) {
    await registerObservedIdentityAdminRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.observedIdentityAdmin.service,
      csrfVerifier: dependencies.observedIdentityAdmin.csrfVerifier,
    });
  }
  if (dependencies.claimReviews !== undefined) {
    await registerClaimReviewRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.claimReviews.service,
    });
  }
  if (dependencies.claimCandidates !== undefined) {
    await registerClaimCandidateRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.claimCandidates.service,
      csrfVerifier: dependencies.claimCandidates.csrfVerifier,
    });
  }
  if (dependencies.playerClaimProduct !== undefined) {
    await registerPlayerClaimProductRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerClaimProduct.service,
    });
  }
  if (dependencies.playerOnboarding !== undefined) {
    await registerPlayerOnboardingRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerOnboarding.service,
      ...(dependencies.playerOnboarding.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerOnboarding.csrfVerifier }),
      ...(dependencies.playerOnboarding.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.playerOnboarding.rateLimiter }),
    });
  }
  if (dependencies.publicRatings !== undefined) {
    await registerPublicRatingRoutes(app, {
      repository: dependencies.publicRatings.repository,
      ...(dependencies.publicRatings.history === undefined
        ? {}
        : { history: dependencies.publicRatings.history }),
    });
  }
  if (dependencies.appDownloads !== undefined) {
    await registerAppDownloadRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      store: dependencies.appDownloads.store,
    });
    // Public on purpose: a Player whose build has been turned off must be able
    // to learn that without signing in first.
    await registerClientSupportRoutes(app, dependencies.appDownloads.store);
  }
  if (dependencies.clientInstallations !== undefined) {
    await registerClientInstallationRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.clientInstallations.service,
    });
  }
  if (dependencies.gameAssets !== undefined) {
    await registerGameAssetRoutes(app, {
      rootDirectory: dependencies.gameAssets.rootDirectory,
    });
  }
  if (dependencies.playerInsights !== undefined) {
    await registerPlayerInsightsRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerInsights.service,
    });
  }
  if (dependencies.publicCareer !== undefined) {
    await registerPublicCareerRoutes(app, {
      service: dependencies.publicCareer.service,
    });
  }
  if (dependencies.communityOverview !== undefined) {
    await registerCommunityOverviewRoutes(app, {
      service: dependencies.communityOverview.service,
    });
  }
  if (dependencies.recordBook !== undefined) {
    await registerRecordBookRoutes(app, {
      service: dependencies.recordBook.service,
    });
  }
  if (dependencies.playerAvatar !== undefined) {
    await registerPlayerAvatarRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerAvatar.service,
      rateLimiter: dependencies.playerAvatar.rateLimiter,
      ...(dependencies.playerAvatar.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerAvatar.csrfVerifier }),
    });
  }
  if (dependencies.playerCountry !== undefined) {
    await registerPlayerCountryRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerCountry.service,
      rateLimiter: dependencies.playerCountry.rateLimiter,
      ...(dependencies.playerCountry.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerCountry.csrfVerifier }),
    });
  }
  if (dependencies.playerVisibility !== undefined) {
    await registerPlayerVisibilityRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerVisibility.service,
      ...(dependencies.playerVisibility.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerVisibility.csrfVerifier }),
    });
  }
  if (dependencies.timeTrialLifecycle !== undefined) {
    await registerTimeTrialLifecycleRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.timeTrialLifecycle.service,
      ...(dependencies.timeTrialLifecycle.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.timeTrialLifecycle.csrfVerifier }),
    });
  }
  if (dependencies.timeTrialCompletion !== undefined) {
    await registerTimeTrialCompletionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.timeTrialCompletion.service,
      ...(dependencies.timeTrialCompletion.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.timeTrialCompletion.rateLimiter }),
    });
  }
  if (dependencies.referenceGhosts !== undefined) {
    await registerReferenceGhostRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.referenceGhosts.service,
      ...(dependencies.referenceGhosts.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.referenceGhosts.rateLimiter }),
    });
  }
  if (dependencies.timeTrialSubmission !== undefined) {
    await registerTimeTrialSubmissionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.timeTrialSubmission.service,
      ...(dependencies.timeTrialSubmission.testService === undefined
        ? {}
        : { testService: dependencies.timeTrialSubmission.testService }),
      authorizer: dependencies.timeTrialSubmission.authorizer,
      ...(dependencies.timeTrialSubmission.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.timeTrialSubmission.csrfVerifier }),
      ...(dependencies.timeTrialSubmission.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.timeTrialSubmission.rateLimiter }),
      ...(dependencies.timeTrialSubmission.feedback === undefined
        ? {}
        : { feedback: dependencies.timeTrialSubmission.feedback }),
    });
  }
  if (dependencies.publicTimeTrials !== undefined) {
    await registerPublicTimeTrialRoutes(
      app,
      dependencies.publicTimeTrials.service,
    );
  }
  if (dependencies.reactions !== undefined) {
    await registerReactionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.reactions.service,
      ...(dependencies.reactions.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.reactions.csrfVerifier }),
      ...(dependencies.reactions.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.reactions.rateLimiter }),
    });
  }
  if (dependencies.home !== undefined) {
    await registerHomeRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      comeback: dependencies.home.comeback,
      rivals: dependencies.home.rivals,
      follows: dependencies.home.follows,
      focus: dependencies.home.focus,
      stories: dependencies.home.stories,
      ...(dependencies.home.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.home.csrfVerifier }),
    });
    // Everything the Home page needs in one answer. Registered only when
    // every part is present, so a runtime that mounts a subset keeps the
    // individual routes and simply has no bootstrap.
    if (dependencies.notifications !== undefined &&
        dependencies.playerClaimProduct !== undefined &&
        dependencies.publicTimeTrials !== undefined &&
        dependencies.reactions !== undefined) {
      await registerHomeBootstrapRoutes(app, {
        resolveActor: dependencies.resolveActor ?? anonymousActor,
        identity: dependencies.identityRepository,
        notifications: dependencies.notifications.service,
        claims: dependencies.playerClaimProduct.service,
        comeback: dependencies.home.comeback,
        focus: dependencies.home.focus,
        follows: dependencies.home.follows,
        stories: dependencies.home.stories,
        trackBests: dependencies.publicTimeTrials.service,
        reactions: dependencies.reactions.service,
        ...(dependencies.publicRatings === undefined
          ? {}
          : { ratings: dependencies.publicRatings.repository }),
        ...(dependencies.publicRatings?.history === undefined
          ? {}
          : { ratingHistory: dependencies.publicRatings.history }),
        ...(dependencies.publicCareer === undefined
          ? {}
          : { career: dependencies.publicCareer.service }),
        ...(dependencies.aliasRepository === undefined
          ? {}
          : { aliases: dependencies.aliasRepository }),
        ...(dependencies.worldRecords === undefined
          ? {}
          : { worldRecords: dependencies.worldRecords.service }),
      });
    }
  }
  if (dependencies.notifications !== undefined) {
    await registerNotificationRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.notifications.service,
      rateLimiter: dependencies.notifications.rateLimiter,
      ...(dependencies.notifications.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.notifications.csrfVerifier }),
    });
  }
  if (dependencies.webManualSession !== undefined) {
    await registerWebManualSessionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.webManualSession.service,
    });
  }
  if (dependencies.nativeTimeTrialSession !== undefined) {
    await registerNativeTimeTrialSessionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.nativeTimeTrialSession.service,
    });
  }
  if (dependencies.webCsrf !== undefined) {
    await registerWebCsrfRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.webCsrf.service,
    });
  }
  if (dependencies.resolveActor !== undefined) {
    await registerSessionCapabilityRoutes(
      app,
      dependencies.resolveActor,
      dependencies.tournamentOperatorCapabilities === undefined
        ? async () => false
        : (userAccountId) => dependencies.tournamentOperatorCapabilities!.service.has(userAccountId),
    );
  }
  if (dependencies.timeTrialRevisionRead !== undefined) {
    await registerTimeTrialRevisionReadRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.timeTrialRevisionRead.service,
    });
  }
  if (dependencies.tournamentSubmission !== undefined) {
    await registerTournamentSubmissionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentSubmission.service,
      authorizer: dependencies.tournamentSubmission.authorizer,
      rateLimiter: dependencies.tournamentSubmission.rateLimiter,
      ...(dependencies.tournamentSubmission.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.tournamentSubmission.csrfVerifier }),
    });
  }
  if (dependencies.tournamentRevisionRead !== undefined) {
    await registerTournamentRevisionReadRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentRevisionRead.service,
    });
  }
  if (dependencies.tournamentPublications !== undefined) {
    await registerTournamentPublicationRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentPublications.service,
      csrfVerifier: dependencies.tournamentPublications.csrfVerifier,
      rateLimiter: dependencies.tournamentPublications.rateLimiter,
      ...(dependencies.tournamentPublications.onPublished === undefined
        ? {}
        : { onPublished: dependencies.tournamentPublications.onPublished }),
    });
  }
  if (dependencies.publicTournaments !== undefined) {
    await registerPublicTournamentRoutes(
      app,
      dependencies.publicTournaments.service,
    );
  }
  if (dependencies.tournamentStanding !== undefined) {
    await registerTournamentStandingRoutes(
      app,
      dependencies.tournamentStanding.service,
    );
  }
  if (dependencies.tournamentTrackRecord !== undefined) {
    await registerTournamentTrackRecordRoutes(
      app,
      dependencies.tournamentTrackRecord.service,
    );
  }
  if (dependencies.ratingAdministration !== undefined) {
    await registerRatingAdministrationRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.ratingAdministration.service,
      readRepository: dependencies.ratingAdministration.readRepository,
      csrfVerifier: dependencies.ratingAdministration.csrfVerifier,
    });
  }
  if (dependencies.tournamentOperations !== undefined) {
    await registerTournamentOperationRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentOperations.service,
      csrfVerifier: dependencies.tournamentOperations.csrfVerifier,
      ...(dependencies.playerOnboarding === undefined ? {} : {
        // A delegated director (tournament.operation capability, plain
        // account role) may also create roster Players, exactly as on the
        // native surface where the bearer gate upgrades that capability.
        createRosterPlayers: (
          actor: ActorContext,
          requests: readonly Readonly<{ row: number; displayName: string; confirmSameName?: boolean }>[],
          options?: Readonly<{ tournamentId?: string }>,
        ) =>
          dependencies.playerOnboarding!.service.createRosterPlayers(
            actor, requests,
            dependencies.tournamentOperatorCapabilities === undefined
              ? undefined
              : (userAccountId: string) =>
                dependencies.tournamentOperatorCapabilities!.service.has(userAccountId),
            options ?? {},
          ),
      }),
    });
    await registerPublicTournamentEventRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentOperations.service,
      ...(dependencies.tournamentOperations.statistics === undefined
        ? {}
        : { statistics: dependencies.tournamentOperations.statistics }),
    });
  }
  if (dependencies.notificationChannels !== undefined) {
    await registerNotificationChannelRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.notificationChannels.service,
      ...(dependencies.notificationChannels.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.notificationChannels.csrfVerifier }),
    });
  }
  if (dependencies.accountTimeTrialPreferences !== undefined) {
    await registerAccountTimeTrialPreferenceRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.accountTimeTrialPreferences.service,
      rateLimiter: dependencies.accountTimeTrialPreferences.rateLimiter,
      ...(dependencies.accountTimeTrialPreferences.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.accountTimeTrialPreferences.csrfVerifier }),
    });
  }
  if (dependencies.accountAppearancePreference !== undefined) {
    await registerAccountAppearancePreferenceRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.accountAppearancePreference.service,
      rateLimiter: dependencies.accountAppearancePreference.rateLimiter,
      ...(dependencies.accountAppearancePreference.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.accountAppearancePreference.csrfVerifier }),
    });
  }
  if (dependencies.playerProfilePreferences !== undefined) {
    await registerPlayerProfilePreferenceRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerProfilePreferences.service,
      rateLimiter: dependencies.playerProfilePreferences.rateLimiter,
      ...(dependencies.playerProfilePreferences.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerProfilePreferences.csrfVerifier }),
    });
  }
  if (dependencies.socialGroups !== undefined) {
    await registerSocialGroupRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.socialGroups.service,
      ...(dependencies.socialGroups.csrfVerifier === undefined ? {} : { csrfVerifier: dependencies.socialGroups.csrfVerifier }),
      ...(dependencies.socialGroups.rateLimiter === undefined ? {} : { rateLimiter: dependencies.socialGroups.rateLimiter }),
    });
  }
  if (dependencies.playerEngagements !== undefined) {
    await registerPlayerEngagementRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.playerEngagements.service,
      ...(dependencies.playerEngagements.csrfVerifier === undefined
        ? {}
        : { csrfVerifier: dependencies.playerEngagements.csrfVerifier }),
      ...(dependencies.playerEngagements.rateLimiter === undefined
        ? {}
        : { rateLimiter: dependencies.playerEngagements.rateLimiter }),
    });
  }
  if (dependencies.worldRecords !== undefined) {
    await registerWorldRecordRoutes(app, dependencies.worldRecords.service);
  }
  if (dependencies.tournamentConnected !== undefined) {
    registerTournamentConnectedRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      tournamentConnected: dependencies.tournamentConnected.service,
      csrfVerifier: dependencies.tournamentConnected.csrfVerifier,
    });
    if (dependencies.tournamentOperations !== undefined) {
      await registerTournamentNativeOperationRoutes(app, {
        resolveActor: dependencies.resolveActor ?? anonymousActor,
        operations: dependencies.tournamentOperations.service,
        connected: dependencies.tournamentConnected.service,
        ...(dependencies.tournamentOperatorCapabilities === undefined ? {} : {
          hasOperationCapability: (userAccountId: string) =>
            dependencies.tournamentOperatorCapabilities!.service.has(userAccountId),
        }),
        ...(dependencies.tournamentRetraction === undefined ? {} : {
          // Removal hides a Tournament and its own director may do it, so the
          // service authorizes on the real actor rather than the upgraded one.
          removeTournament: (actor, input) =>
            dependencies.tournamentRetraction!.service.remove(actor as never, input),
        }),
        ...(dependencies.playerOnboarding === undefined ? {} : {
          // ADR-0177: roster Player creation reuses the identity boundary; the
          // native route gate above is what authorizes it.
          createRosterPlayers: (actor, requests, options) =>
            dependencies.playerOnboarding!.service.createRosterPlayers(
              actor as never, requests, undefined, options ?? {},
            ),
        }),
      });
    }
  }
  if (dependencies.tournamentRetraction !== undefined) {
    registerTournamentRetractionRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      tournamentRetraction: dependencies.tournamentRetraction.service,
      csrfVerifier: dependencies.tournamentRetraction.csrfVerifier,
    });
  }
  if (dependencies.tournamentReports !== undefined) {
    await registerTournamentReportRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentReports.service,
      csrfVerifier: dependencies.tournamentReports.csrfVerifier,
    });
  }
  if (dependencies.tournamentOperatorCapabilities !== undefined) {
    await registerTournamentOperatorCapabilityRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentOperatorCapabilities.service,
      csrfVerifier: dependencies.tournamentOperatorCapabilities.csrfVerifier,
    });
  }
  if (dependencies.installationSettings !== undefined) {
    await registerInstallationSettingsRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.installationSettings.service,
      csrfVerifier: dependencies.installationSettings.csrfVerifier,
    });
  }
  if (dependencies.directorHostRequests !== undefined) {
    await registerDirectorHostRequestRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.directorHostRequests.service,
      csrfVerifier: dependencies.directorHostRequests.csrfVerifier,
    });
  }
  if (dependencies.tournamentSignups !== undefined) {
    await registerTournamentSignupRoutes(app, {
      resolveActor: dependencies.resolveActor ?? anonymousActor,
      service: dependencies.tournamentSignups.service,
      csrfVerifier: dependencies.tournamentSignups.csrfVerifier,
    });
  }
  await app.ready();
  return app;
}
