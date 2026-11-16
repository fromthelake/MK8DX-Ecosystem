import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  MysqlSubmissionFeedbackRepository,
  SubmissionFeedbackService,
} from "../timetrials/submission-feedback.js";
import {
  AdministratorOverviewService,
  MysqlAdministratorOverviewRepository,
} from "../administration/administrator-overview.js";

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../app.js";
import type { OperationalLogSink } from "../runtime/operational-log.js";
import type { StaticWebFile } from "../runtime/static-web.js";
import {
  createAdministratorAwareActorResolver,
  createBoundAccountActorResolver,
  createRotatingProvisioningBoundAccountActorResolver,
} from "../authentication/authentication-binding-resolver.js";
import {
  MysqlAdministratorGrantStatusRepository,
  MysqlAdministratorGrantWriteRepository,
} from
  "../administration/mysql-administrator-grant-repository.js";
import { AdministratorGrantService } from
  "../administration/administrator-grant-service.js";
import { MysqlTournamentReportRepository } from
  "../tournaments/mysql-tournament-report-repository.js";
import { TournamentReportService } from
  "../tournaments/tournament-report-service.js";
import { MysqlTournamentOperatorCapabilityRepository } from
  "../tournaments/mysql-tournament-operator-capability-repository.js";
import { TournamentOperatorCapabilityService } from
  "../tournaments/tournament-operator-capability-service.js";
import { DirectorHostRequestService } from "../tournaments/director-host-request-service.js";
import { InstallationSettingsService } from "../administration/installation-settings-service.js";
import { MysqlInstallationSettingsRepository } from "../administration/mysql-installation-settings-repository.js";
import { TournamentSignupService } from "../tournaments/tournament-signup-service.js";
import { MysqlTournamentSignupRepository } from "../tournaments/mysql-tournament-signup-repository.js";
import { MysqlDirectorHostRequestRepository } from
  "../tournaments/mysql-director-host-request-repository.js";
import { MysqlAuthenticationBindingRepository } from
  "../authentication/mysql-authentication-binding-repository.js";
import {
  AuthenticationProvisioningService,
} from "../authentication/authentication-provisioning-service.js";
import { MysqlAuthenticationProvisioningRepository } from
  "../authentication/mysql-authentication-provisioning-repository.js";
import {
  AuthenticationSubjectHmacKeyringProtector,
  type AuthenticationSubjectHmacKeyMaterial,
} from "../authentication/authentication-subject-hmac-protector.js";
import {
  createEmbeddedPasswordlessAuth,
  MK8DX_PASSWORDLESS_ISSUER,
  createEmbeddedVerifiedSubjectResolver,
  type EmbeddedAuthConfig,
  type PasswordlessEmailDelivery,
} from "../authentication/embedded-passwordless-auth.js";
import {
  AccountSwitchPinHasher,
  AccountSwitchPins,
  deriveAccountSwitchKeys,
  type AccountSwitchDirectory,
} from "../authentication/account-switch.js";
import {
  MysqlAccountSwitchLabels,
  MysqlAccountSwitchPinStore,
  MysqlAccountSwitchStore,
} from "../authentication/mysql-account-switch-store.js";
import type { AccountSwitchAuthApi } from "../authentication/account-switch-routes.js";
import type { NativeInvitationAuthApi } from "../authentication/native-invitation-routes.js";
import { MysqlEmbeddedAuthAuditSink } from
  "../authentication/mysql-embedded-auth-audit-sink.js";
import { MysqlPasswordlessAccountLookup } from
  "../authentication/mysql-passwordless-account-lookup.js";
import { MysqlOfflineInvitationTicketRepository } from
  "../authentication/mysql-offline-invitation-tickets.js";
import { OfflineInvitationTicketService } from
  "../authentication/offline-invitation-ticket.js";
import {
  Schema9AssetCatalog,
  TimeTrialSchema9AssetCatalogAdapter,
  TournamentSchema9AssetCatalogAdapter,
  WebManualSchema9TrackCatalogAdapter,
} from "../assets/schema9-asset-catalog.js";
import { AliasService } from "../identity/alias-service.js";
import { IdentityLinkAdminService } from "../identity/identity-link-admin-service.js";
import { MysqlIdentityLinkAdminRepository } from
  "../identity/mysql-identity-link-admin-repository.js";
import {
  ClaimLifecycleService,
  type AdministratorClaimAction,
} from "../identity/claim-lifecycle-service.js";
import { MysqlAliasReadRepository } from "../identity/mysql-alias-read-repository.js";
import { MysqlAliasWriteRepository } from "../identity/mysql-alias-write-repository.js";
import { MysqlClaimWriteRepository } from "../identity/mysql-claim-write-repository.js";
import { MysqlPlayerOnboardingRepository } from
  "../identity/mysql-player-onboarding-repository.js";
import { PlayerOnboardingService } from
  "../identity/player-onboarding-service.js";
import { MysqlLegacyHistoryRepository } from
  "../rating/mysql-legacy-history-repository.js";
import { MysqlPublicRatingRepository } from
  "../rating/mysql-rating-repository.js";
import { MysqlRatingLifecycleRepository } from
  "../rating/mysql-rating-lifecycle-repository.js";
import {
  RatingLifecycleError,
  RatingLifecycleService,
} from "../rating/rating-lifecycle-service.js";
import { createHistoryReplay } from "../rating/rating-history-replay.js";
import { MysqlIdentityReadRepository } from "../identity/mysql-identity-read-repository.js";
import { MysqlPlayerActivityRepository } from
  "../profiles/mysql-player-activity-repository.js";
import { PlayerActivityService } from
  "../profiles/player-activity-service.js";
import { ClaimCandidateService } from "../profiles/claim-candidate-service.js";
import { MysqlClaimCandidateRepository } from "../profiles/mysql-claim-candidate-repository.js";
import { MysqlClaimReviewReadRepository } from
  "../profiles/mysql-claim-review-read-repository.js";
import { ClaimReviewReadService } from
  "../profiles/claim-review-read-service.js";
import { MysqlPlayerClaimProductRepository } from
  "../profiles/mysql-player-claim-product-repository.js";
import { PlayerClaimProductService } from
  "../profiles/player-claim-product-service.js";
import { MysqlPlayerInsightsRepository } from
  "../profiles/mysql-player-insights-repository.js";
import { PlayerInsightsService } from
  "../profiles/player-insights-service.js";
import {
  TimeTrialProtectedValueAdapter,
  TimeTrialProtectedValueReader,
  WebPushProtectedValueAdapter,
  WebPushProtectedValueReader,
  TournamentProtectedValueAdapter,
  TournamentProtectedValueReader,
  type ProtectedValueDecryptionKeyring,
  type ProtectedValueKeyMaterial,
} from "../security/protected-value-adapters.js";
import {
  WebCsrfService,
  type WebCsrfKeyMaterial,
} from "../security/web-csrf-service.js";
import { MysqlTimeTrialReadRepository } from
  "../timetrials/mysql-time-trial-read-repository.js";
import { MysqlTimeTrialWriteRepository } from
  "../timetrials/mysql-time-trial-write-repository.js";
import { MysqlPublicTimeTrialRepository } from
  "../timetrials/mysql-public-time-trial-repository.js";
import { PublicTimeTrialService } from
  "../timetrials/public-time-trial-service.js";
import { MysqlReactionRepository } from
  "../timetrials/mysql-reaction-repository.js";
import { ReactionService } from "../timetrials/reaction-service.js";
import {
  CommunityOverviewService,
  MysqlCommunityOverviewRepository,
} from "../profiles/community-overview-service.js";
import {
  MysqlRecordBookRepository,
  RecordBookService,
} from "../profiles/record-book-service.js";
import {
  MysqlPlayerAvatarRepository,
  PlayerAvatarService,
} from "../profiles/player-avatar-service.js";
import {
  MysqlPlayerProfilePreferenceRepository,
  PlayerProfilePreferenceService,
} from "../profiles/player-profile-preferences.js";
import {
  MysqlPlayerVisibilityRepository,
  PlayerVisibilityService,
} from "../profiles/player-visibility-service.js";
import { TimeTrialCompletionService } from "../timetrials/completion-service.js";
import { MysqlWorldRecordTimes } from "../timetrials/world-record-plausibility.js";
import { MysqlTimeTrialCompletionRepository } from "../timetrials/mysql-completion-repository.js";
import { MysqlReferenceGhostReadingRepository } from "../reference-ghosts/mysql-reference-ghost-repository.js";
import { ReferenceGhostReadingService } from "../reference-ghosts/reference-ghost-readings.js";
import { MysqlTimeTrialLifecycleRepository } from
  "../timetrials/mysql-lifecycle-repository.js";
import { TimeTrialLifecycleService } from
  "../timetrials/lifecycle-service.js";
import {
  MysqlPlayerCountryRepository,
  PlayerCountryService,
} from "../profiles/player-country-service.js";
import { MysqlPublicCareerRepository } from
  "../profiles/mysql-public-career-repository.js";
import { PublicCareerService } from
  "../profiles/public-career-service.js";
import { MysqlHomeComebackRepository } from
  "../home/mysql-home-comeback-repository.js";
import {
  FollowPreferenceService,
  HomeComebackService,
  RivalPreferenceService,
} from "../home/home-comeback-service.js";
import { ActivityStoryService } from "../home/activity-story-service.js";
import { HomeFocusService } from "../home/home-focus-service.js";
import {
  AccountTimeTrialPreferencesService,
  MysqlAccountTimeTrialPreferencesRepository,
} from "../profiles/account-time-trial-preferences.js";
import {
  AccountAppearancePreferenceService,
  MysqlAccountAppearancePreferenceRepository,
} from "../profiles/account-appearance-preference.js";
import { MysqlMutationRateLimiter } from "../security/mysql-mutation-rate-limiter.js";
import { RefusalLedger } from "../security/refusal-ledger.js";
import {
  AdministratorRequestBudgetsService,
  MysqlAdministratorRequestBudgetsRepository,
} from "../administration/administrator-request-budgets.js";
import { PreAuthBudget, derivePreAuthBudgetKey } from "../security/pre-auth-budget.js";
import { AbuseBudgets, defaultAbuseBudgetSettings, type AbuseBudgetSettings } from "../security/abuse-budgets.js";
import { AuthEmailBudgets } from "../authentication/auth-email-budgets.js";
import { withNotificationFanOutBudget } from "../notifications/notification-fan-out-budget.js";
import { MysqlStepUpStore } from "../security/mysql-step-up-store.js";
import { StepUpService } from "../security/step-up-service.js";
import { fromNodeHeaders } from "better-auth/node";
import { MysqlNativeEmailAttemptLimiter } from "../authentication/mysql-native-email-attempt-limiter.js";
import { MysqlActivityStoryRepository } from
  "../home/mysql-activity-story-repository.js";
import { MysqlFollowPreferenceRepository } from
  "../home/mysql-follow-repository.js";
import { MysqlHomeFocusRepository } from
  "../home/mysql-home-focus-repository.js";
import { ClientInstallationService } from "../runtime/client-installations.js";
import { MysqlClientInstallationRepository } from
  "../runtime/mysql-client-installation-repository.js";
import { MysqlNotificationRepository } from
  "../notifications/mysql-notification-repository.js";
import {
  NotificationService,
  type ClaimDecisionNotice,
} from "../notifications/notification-service.js";

/** Which reviewer actions the person asking hears about (ADR-0216 section 5). */
const claimDecisionNotices: Partial<Record<AdministratorClaimAction, ClaimDecisionNotice>> = {
  verify: "verified",
  reject: "rejected",
  request_information: "info_requested",
  revoke: "revoked",
  release: "released",
};
import {
  MysqlNotificationProducerJobRepository,
  NotificationProducerWorker,
} from "../notifications/notification-producer-jobs.js";
import { WebPushEgressPolicy } from "../notifications/web-push-egress.js";
import { NotificationChannelService, WEB_PUSH_SUBSCRIPTIONS_PER_ACCOUNT } from
  "../notifications/notification-channel-service.js";
import { MysqlNotificationChannelRepository } from
  "../notifications/mysql-notification-channel-repository.js";
import {
  MysqlWebPushDeliveryRepository,
  WebPushDeliveryWorker,
  type WebPushConfiguration,
} from "../notifications/web-push-delivery.js";
import { MysqlSocialGroupRepository } from "../social/mysql-social-group-repository.js";
import { MysqlTournamentStandingRepository } from "../tournaments/mysql-tournament-standing-repository.js";
import { MysqlObservedIdentityAdminRepository } from
  "../tournament-history/mysql-observed-identity-admin-repository.js";
import { ObservedIdentityAdminService } from
  "../tournament-history/observed-identity-admin-service.js";
import { MysqlTournamentTrackRecordRepository } from
  "../tournaments/mysql-tournament-track-record-repository.js";
import { TournamentTrackRecordService } from
  "../tournaments/tournament-track-record-service.js";
import { TournamentStandingService } from "../tournaments/tournament-standing-service.js";
import { MysqlPlayerEngagementRepository } from "../social/mysql-player-engagement-repository.js";
import { PlayerEngagementService } from "../social/player-engagement-service.js";
import { SocialGroupService } from "../social/social-group-service.js";
import { MysqlWorldRecordRepository } from "../world-records/mysql-world-record-repository.js";
import { MysqlWebManualSessionRepository } from
  "../timetrials/mysql-web-manual-session-repository.js";
import { TimeTrialRevisionReadService } from "../timetrials/revision-read-service.js";
import { TimeTrialSubmissionService } from "../timetrials/submission-service.js";
import { EphemeralAndroidScanTestService } from
  "../timetrials/ephemeral-scan-test-service.js";
import type { TimeTrialSubmissionAuthorizer } from
  "../timetrials/submission-routes.js";
import { WebManualSessionService } from
  "../timetrials/web-manual-session-service.js";
import { WebManualSubmissionAuthorizer } from
  "../timetrials/web-manual-submission-authorizer.js";
import {
  AccountClaimTimeTrialSubmissionAuthorizer,
  isAccountClaimNativeTimeTrialSource,
} from
  "../timetrials/account-claim-submission-authorizer.js";
import { NativeTimeTrialSessionService } from
  "../timetrials/native-session-service.js";
import { MysqlTournamentReadRepository } from
  "../tournaments/mysql-tournament-read-repository.js";
import { MysqlTournamentWriteRepository } from
  "../tournaments/mysql-tournament-write-repository.js";
import { TournamentRevisionReadService } from
  "../tournaments/race-result-read-service.js";
import { TournamentRaceResultService } from "../tournaments/race-result-service.js";
import { MysqlTournamentPublicationRepository } from
  "../tournaments/mysql-tournament-publication-repository.js";
import { TournamentPublicationService } from
  "../tournaments/tournament-publication-service.js";
import { MysqlPublicTournamentRepository } from
  "../tournaments/mysql-public-tournament-repository.js";
import { MysqlRatingAdministrationRepository } from
  "../rating/mysql-rating-administration-repository.js";
import type { AppDownloadStore } from "../runtime/app-downloads.js";
import type { AppDownloadLinks } from "../runtime/app-download-links.js";
import { TournamentOperationService } from
  "../tournaments/tournament-operation-service.js";
import { MysqlHistoryEditionRepository } from "../tournaments/history-edition-projection.js";
import {
  MysqlTournamentStatisticsRepository,
  TournamentStatisticsService,
} from "../tournaments/tournament-statistics.js";
import { MysqlTournamentOperationRepository } from
  "../tournaments/mysql-tournament-operation-repository.js";
import { MysqlTournamentAcceptUnitOfWork } from
  "../tournaments/tournament-accept-unit-of-work.js";
import { TournamentConnectedService } from
  "../tournaments/tournament-connected-service.js";
import { MysqlTournamentConnectedRepository } from
  "../tournaments/mysql-tournament-connected-repository.js";
import { NativeEmailApprovalService } from "../authentication/native-email-approval.js";
import { TournamentRetractionService } from
  "../tournaments/tournament-retraction-service.js";
import { MysqlTournamentRetractionRepository } from
  "../tournaments/mysql-tournament-retraction-repository.js";
import { PublicTournamentService } from
  "../tournaments/public-tournament-service.js";
import type { TournamentSubmissionAuthorizer } from
  "../tournaments/race-result-routes.js";
import { AdministratorTournamentSubmissionAuthorizer } from
  "../tournaments/administrator-submission-authorizer.js";

export const expectedSchema9DatabaseSha256 =
  "2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0";
const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const authenticationKeyVersionPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const localDatabasePattern = /^[a-z][a-z0-9_]{0,60}_(?:dev|test|contract)$/;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

interface ReadinessRow extends RowDataPacket { ready: unknown; }

export class LocalRuntimeConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalRuntimeConfigurationError";
  }
}

export type LocalRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type LocalApiRuntimeConfig = Readonly<{
  mysql: Readonly<{
    host: "127.0.0.1" | "localhost" | "::1";
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  }>;
  schema9CatalogPath: string;
  authenticationKeys: AuthenticationSubjectHmacKeyMaterial;
  timeTrialKeys: ProtectedValueKeyMaterial;
  timeTrialDecryptionKeys: ProtectedValueDecryptionKeyring;
  tournamentKeys: ProtectedValueKeyMaterial;
  tournamentDecryptionKeys: ProtectedValueDecryptionKeyring;
}>;

export type HostedApiCoreRuntimeConfig = Readonly<{
  mysql: Readonly<{
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  }>;
  schema9CatalogPath: string;
  authenticationKeys: AuthenticationSubjectHmacKeyMaterial;
  authenticationRetainedKeys?: readonly AuthenticationSubjectHmacKeyMaterial[];
  timeTrialKeys: ProtectedValueKeyMaterial;
  timeTrialDecryptionKeys: ProtectedValueDecryptionKeyring;
  tournamentKeys: ProtectedValueKeyMaterial;
  tournamentDecryptionKeys: ProtectedValueDecryptionKeyring;
}>;

function required(environment: LocalRuntimeEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new LocalRuntimeConfigurationError(`${name} is required`);
  }
  return value;
}

function integer(
  environment: LocalRuntimeEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw === undefined) { return fallback; }
  if (!/^[0-9]+$/.test(raw)) {
    throw new LocalRuntimeConfigurationError(`${name} is invalid`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new LocalRuntimeConfigurationError(`${name} is invalid`);
  }
  return value;
}

function key(environment: LocalRuntimeEnvironment, name: string): Uint8Array {
  const encoded = required(environment, name);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch {
    throw new LocalRuntimeConfigurationError(`${name} is invalid`);
  }
  if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
    throw new LocalRuntimeConfigurationError(`${name} must be canonical base64 for 32 bytes`);
  }
  return Uint8Array.from(decoded);
}

function keyVersion(environment: LocalRuntimeEnvironment, name: string): string {
  const value = required(environment, name);
  if (!keyVersionPattern.test(value)) {
    throw new LocalRuntimeConfigurationError(`${name} is invalid`);
  }
  return value;
}

function authenticationKeys(
  environment: LocalRuntimeEnvironment,
): AuthenticationSubjectHmacKeyMaterial {
  const lookupKeyVersion = required(
    environment,
    "MK8DX_LOCAL_AUTHENTICATION_LOOKUP_KEY_VERSION",
  );
  if (
    lookupKeyVersion.length > 64 ||
    !authenticationKeyVersionPattern.test(lookupKeyVersion)
  ) {
    throw new LocalRuntimeConfigurationError(
      "MK8DX_LOCAL_AUTHENTICATION_LOOKUP_KEY_VERSION is invalid",
    );
  }
  return {
    lookupHmacKey: key(
      environment,
      "MK8DX_LOCAL_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64",
    ),
    lookupKeyVersion,
  };
}

function protectedKeys(
  environment: LocalRuntimeEnvironment,
  prefix: "MK8DX_LOCAL_TIME_TRIAL" | "MK8DX_LOCAL_TOURNAMENT",
): ProtectedValueKeyMaterial {
  const encryptionKey = key(environment, `${prefix}_ENCRYPTION_KEY_BASE64`);
  const lookupHmacKey = key(environment, `${prefix}_LOOKUP_HMAC_KEY_BASE64`);
  if (Buffer.from(encryptionKey).equals(Buffer.from(lookupHmacKey))) {
    throw new LocalRuntimeConfigurationError(`${prefix} keys must be distinct`);
  }
  return {
    encryptionKey,
    encryptionKeyVersion: keyVersion(environment, `${prefix}_ENCRYPTION_KEY_VERSION`),
    lookupHmacKey,
    lookupKeyVersion: keyVersion(environment, `${prefix}_LOOKUP_KEY_VERSION`),
  };
}

function decryptionKeys(
  environment: LocalRuntimeEnvironment,
  name: string,
  active: ProtectedValueKeyMaterial,
): ProtectedValueDecryptionKeyring {
  const raw = environment[name];
  const result: Record<string, Uint8Array> = {};
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LocalRuntimeConfigurationError(`${name} is invalid`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      Object.keys(parsed).length > 16) {
      throw new LocalRuntimeConfigurationError(`${name} is invalid`);
    }
    for (const [version, encoded] of Object.entries(parsed)) {
      if (!keyVersionPattern.test(version) || typeof encoded !== "string") {
        throw new LocalRuntimeConfigurationError(`${name} is invalid`);
      }
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
        throw new LocalRuntimeConfigurationError(`${name} is invalid`);
      }
      result[version] = Uint8Array.from(decoded);
    }
  }
  const configuredActive = result[active.encryptionKeyVersion];
  if (configuredActive !== undefined &&
    !Buffer.from(configuredActive).equals(Buffer.from(active.encryptionKey))) {
    throw new LocalRuntimeConfigurationError(`${name} conflicts with the active key`);
  }
  result[active.encryptionKeyVersion] = Uint8Array.from(active.encryptionKey);
  return result;
}

export function loadLocalApiRuntimeConfig(
  environment: LocalRuntimeEnvironment,
): LocalApiRuntimeConfig {
  const host = environment["MK8DX_LOCAL_MYSQL_HOST"] ?? "127.0.0.1";
  if (!loopbackHosts.has(host)) {
    throw new LocalRuntimeConfigurationError("MK8DX_LOCAL_MYSQL_HOST must be loopback");
  }
  const database = required(environment, "MK8DX_LOCAL_MYSQL_DATABASE");
  if (!localDatabasePattern.test(database)) {
    throw new LocalRuntimeConfigurationError(
      "MK8DX_LOCAL_MYSQL_DATABASE must be an explicit _dev/_test/_contract schema",
    );
  }
  const schema9CatalogPath = required(environment, "MK8DX_LOCAL_SCHEMA9_CATALOG_PATH");
  if (!isAbsolute(schema9CatalogPath)) {
    throw new LocalRuntimeConfigurationError(
      "MK8DX_LOCAL_SCHEMA9_CATALOG_PATH must be absolute",
    );
  }
  const timeTrialKeys = protectedKeys(environment, "MK8DX_LOCAL_TIME_TRIAL");
  const tournamentKeys = protectedKeys(environment, "MK8DX_LOCAL_TOURNAMENT");
  const configuredAuthenticationKeys = authenticationKeys(environment);
  const mysqlUser = required(environment, "MK8DX_LOCAL_MYSQL_USER");
  if (!/^[A-Za-z0-9_]{1,32}$/.test(mysqlUser)) {
    throw new LocalRuntimeConfigurationError("MK8DX_LOCAL_MYSQL_USER is invalid");
  }
  const mysqlPassword = required(environment, "MK8DX_LOCAL_MYSQL_PASSWORD");
  if (mysqlPassword.length > 1024) {
    throw new LocalRuntimeConfigurationError("MK8DX_LOCAL_MYSQL_PASSWORD is invalid");
  }
  const distinctKeys = [
    timeTrialKeys.encryptionKey,
    timeTrialKeys.lookupHmacKey,
    tournamentKeys.encryptionKey,
    tournamentKeys.lookupHmacKey,
    configuredAuthenticationKeys.lookupHmacKey,
  ].map((value) => Buffer.from(value).toString("base64"));
  if (new Set(distinctKeys).size !== distinctKeys.length) {
    throw new LocalRuntimeConfigurationError(
      "local protected-value and authentication keys must be distinct",
    );
  }
  return {
    mysql: {
      host: host as LocalApiRuntimeConfig["mysql"]["host"],
      port: integer(environment, "MK8DX_LOCAL_MYSQL_PORT", 3306, 1, 65535),
      user: mysqlUser,
      password: mysqlPassword,
      database,
      connectionLimit: integer(
        environment,
        "MK8DX_LOCAL_MYSQL_CONNECTION_LIMIT",
        10,
        1,
        32,
      ),
    },
    schema9CatalogPath,
    authenticationKeys: configuredAuthenticationKeys,
    timeTrialKeys,
    timeTrialDecryptionKeys: decryptionKeys(
      environment,
      "MK8DX_LOCAL_TIME_TRIAL_DECRYPTION_KEYS_JSON",
      timeTrialKeys,
    ),
    tournamentKeys,
    tournamentDecryptionKeys: decryptionKeys(
      environment,
      "MK8DX_LOCAL_TOURNAMENT_DECRYPTION_KEYS_JSON",
      tournamentKeys,
    ),
  };
}

export type LocalApiRuntime = Readonly<{
  app: FastifyInstance;
  timeTrialSubmissionService: TimeTrialSubmissionService;
  timeTrialRevisionReadService: TimeTrialRevisionReadService;
  tournamentRaceResultService: TournamentRaceResultService;
  tournamentRevisionReadService: TournamentRevisionReadService;
  close(): Promise<void>;
}>;

export type VerifiedProviderSubject = Readonly<{
  issuerKey: string;
  subject: string;
}>;

export type VerifiedProviderSubjectResolver = (
  request: FastifyRequest,
) => Promise<VerifiedProviderSubject | null>;

export type LocalApiRuntimeRoutePolicies = Readonly<{
  timeTrialSubmissionAuthorizer?: TimeTrialSubmissionAuthorizer;
  tournamentSubmissionAuthorizer?: TournamentSubmissionAuthorizer;
  webManual?: Readonly<{
    producerVersion: string;
    csrfKeys: WebCsrfKeyMaterial;
  }>;
  operationalLog?: OperationalLogSink;
  staticWeb?: Readonly<{ files: ReadonlyMap<string, StaticWebFile>; origin: string }>;
  publicBundle?: Readonly<{ root: string; origin: string }>;
  gameAssets?: Readonly<{ rootDirectory: string }>;
  // The owner's native app builds offered to signed-in members (Apps page).
  appDownloads?: Readonly<{ store: AppDownloadStore; staticLinks?: AppDownloadLinks }>;
  webPush?: WebPushConfiguration;
  /** H1: installation and per-target budgets; the defaults apply without it. */
  abuseBudgets?: AbuseBudgetSettings;
}>;

export type EmbeddedAuthenticationRuntimePolicy = Readonly<{
  config: EmbeddedAuthConfig;
  emailDelivery: PasswordlessEmailDelivery;
  offlineLan?: boolean;
  /** How long a confirmed step-up lasts (default 600 seconds, 60 to 3600). */
  stepUpWindowSeconds?: number;
}>;

function ensureWebCsrfKeySeparation(
  config: HostedApiCoreRuntimeConfig,
  keyMaterial: WebCsrfKeyMaterial,
): void {
  const existing = new Set([
    config.authenticationKeys.lookupHmacKey,
    config.timeTrialKeys.encryptionKey,
    config.timeTrialKeys.lookupHmacKey,
    config.tournamentKeys.encryptionKey,
    config.tournamentKeys.lookupHmacKey,
  ].map((value) => Buffer.from(value).toString("base64")));
  const csrfKeys = Object.values(keyMaterial.keys).map((value) =>
    Buffer.from(value).toString("base64"));
  if (csrfKeys.some((value) => existing.has(value)) ||
    new Set(csrfKeys).size !== csrfKeys.length) {
    throw new LocalRuntimeConfigurationError(
      "web CSRF keys must be distinct from all runtime keys",
    );
  }
}

async function createMysqlApiRuntime(
  config: HostedApiCoreRuntimeConfig,
  authentication:
    | Readonly<{
        kind: "external";
        resolveVerifiedProviderSubject: VerifiedProviderSubjectResolver;
      }>
    | Readonly<{
        kind: "embedded";
        policy: EmbeddedAuthenticationRuntimePolicy;
      }>,
  routePolicies: LocalApiRuntimeRoutePolicies = {},
): Promise<LocalApiRuntime> {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(await readFile(config.schema9CatalogPath, "utf8"));
  } catch {
    throw new LocalRuntimeConfigurationError("schema-9 catalog could not be loaded");
  }
  const catalog = new Schema9AssetCatalog(snapshot, expectedSchema9DatabaseSha256);
  const poolOptions = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    connectionLimit: config.mysql.connectionLimit,
    multipleStatements: false,
    namedPlaceholders: false,
  } as const;
  const pool = mysql.createPool(poolOptions);
  try {
  const clock = { nowMs: () => Date.now() };
  const authenticationSubjectProtector = new AuthenticationSubjectHmacKeyringProtector({
    active: config.authenticationKeys,
    retained: config.authenticationRetainedKeys ?? [],
  });
  // Refusals of every limiter in this process, counted in memory and flushed in one batch every
  // 30 seconds and at shutdown (security/refusal-ledger.ts): a refused request costs no DB write.
  const refusalLedger = new RefusalLedger(pool, clock.nowMs, {
    ledgerFailed(errorName) {
      routePolicies.operationalLog?.log({ event: "rate_limit_ledger_failed", category: "lifecycle", errorName });
    },
  });
  const stopRefusalLedgerFlush = refusalLedger.startFlushTimer();
  const bindingRepository = new MysqlAuthenticationBindingRepository(pool, clock);
  const offlineInvitation = authentication.kind === "embedded" &&
      authentication.policy.offlineLan === true
    ? {
        origin: new URL(authentication.policy.config.baseUrl).origin,
        tickets: new OfflineInvitationTicketService(
          new MysqlOfflineInvitationTicketRepository(pool),
          createHmac("sha256", Buffer.from(authentication.policy.config.secrets[0]!.value, "base64"))
            .update("mk8dx.offline-invitation-digest.v1", "ascii").digest(),
        ),
        attempts: {
          limiter: new MysqlMutationRateLimiter(pool, clock.nowMs, undefined, refusalLedger),
          tokenKey: createHmac("sha256", Buffer.from(authentication.policy.config.secrets[0]!.value, "base64"))
            .update("mk8dx.offline-invitation-attempt.v1", "ascii").digest(),
        },
        async bindAccount(authUserId: string,
                          target: import("../authentication/offline-invitation-ticket.js").OfflineInvitationTarget) {
          const subject = authenticationSubjectProtector
            .protectVerifiedSubjectCandidates(MK8DX_PASSWORDLESS_ISSUER, authUserId)[0];
          if (subject === undefined) { throw new Error("offline auth subject unavailable"); }
          await new AuthenticationProvisioningService(
            new MysqlAuthenticationProvisioningRepository(pool),
            { async decide() { return { action: "link_account" as const,
              userAccountId: target.userAccountId }; } },
            {
              newUserAccountId: () => `user_account.${randomUUID()}`,
              newAuthenticationBindingId: () => `restricted_auth_binding.${randomUUID()}`,
            },
            clock,
            "authentication_provisioner.offline_invitation_v1",
          ).provision(subject);
        },
      }
    : undefined;
  // ADR-0224 phase 2: one-tap account switching on shared devices (embedded auth only).
  const accountSwitch = authentication.kind === "embedded"
    ? (() => {
        const keys = deriveAccountSwitchKeys(authentication.policy.config.secrets);
        const store = new MysqlAccountSwitchStore(pool);
        const labels = new MysqlAccountSwitchLabels(pool);
        const administratorStatus = new MysqlAdministratorGrantStatusRepository(pool);
        const directory: AccountSwitchDirectory = {
          async resolve(authUserId) {
            for (const subject of authenticationSubjectProtector
              .protectVerifiedSubjectCandidates(MK8DX_PASSWORDLESS_ISSUER, authUserId)) {
              const bound = await bindingRepository.resolveActiveAccount(subject);
              if (bound === null) { continue; }
              const described = await labels.describe(bound.userAccountId);
              return {
                userAccountId: bound.userAccountId,
                administrator: described.offlineAdministrator ||
                  await administratorStatus.isActiveAdministrator(bound.userAccountId),
                label: described.label,
                playerId: described.playerId,
              };
            }
            return null;
          },
        };
        const limiter = new MysqlMutationRateLimiter(pool, clock.nowMs, undefined, refusalLedger);
        const pins = new AccountSwitchPins(new MysqlAccountSwitchPinStore(pool),
          new AccountSwitchPinHasher(keys), limiter);
        return { keys, store, directory, pins, limiter, nowMs: clock.nowMs };
      })()
    : undefined;
  const embeddedAuth = authentication.kind === "embedded"
    ? createEmbeddedPasswordlessAuth(
        pool,
        authentication.policy.config,
        authentication.policy.emailDelivery,
        new MysqlEmbeddedAuthAuditSink(pool, clock),
        new MysqlPasswordlessAccountLookup(pool),
        offlineInvitation,
        accountSwitch,
      )
    : null;
  const rawSubjectResolver = authentication.kind === "external"
    ? authentication.resolveVerifiedProviderSubject
    : createEmbeddedVerifiedSubjectResolver(embeddedAuth!);
  const protectedSubjectResolver = async (request: FastifyRequest) => {
    const verified = await rawSubjectResolver(request);
    return verified === null
      ? null
      : authenticationSubjectProtector.protectVerifiedSubjectCandidates(
          verified.issuerKey,
          verified.subject,
        );
  };
  const resolveAccountActor = embeddedAuth === null
    ? createBoundAccountActorResolver(
        async (request) => (await protectedSubjectResolver(request))?.[0] ?? null,
        bindingRepository,
      )
    : createRotatingProvisioningBoundAccountActorResolver(
        protectedSubjectResolver,
        bindingRepository,
        new AuthenticationProvisioningService(
          new MysqlAuthenticationProvisioningRepository(pool),
          { async decide() { return { action: "create_account" } as const; } },
          {
            newUserAccountId: () => `user_account.${randomUUID()}`,
            newAuthenticationBindingId: () =>
              `restricted_auth_binding.${randomUUID()}`,
          },
          clock,
          "authentication_provisioner.better_auth_v1",
        ),
      );
  const resolveActor = createAdministratorAwareActorResolver(
    resolveAccountActor,
    new MysqlAdministratorGrantStatusRepository(pool),
  );
  const webManualConfig = routePolicies.webManual;
  if (webManualConfig !== undefined) {
    ensureWebCsrfKeySeparation(config, webManualConfig.csrfKeys);
  }
  const idGenerator = {
    newPlayerClaimId: () => `player_claim.${randomUUID()}`,
    newRestrictedReviewId: () => `restricted_review.${randomUUID()}`,
  };
  const aliasIdGenerator = { newAliasId: () => `alias.${randomUUID()}` };
  const timeTrialProtector = new TimeTrialProtectedValueAdapter(config.timeTrialKeys);
  const tournamentProtector = new TournamentProtectedValueAdapter(config.tournamentKeys);
  const timeTrialReader = new TimeTrialProtectedValueReader(config.timeTrialDecryptionKeys);
  const webPushProtector = new WebPushProtectedValueAdapter(config.timeTrialKeys);
  const webPushReader = new WebPushProtectedValueReader(config.timeTrialDecryptionKeys);
  const tournamentReader = new TournamentProtectedValueReader(
    config.tournamentDecryptionKeys,
  );
  const worldRecordTimes = new MysqlWorldRecordTimes(pool);
  // ADR-0225: a carried time is checked against the administrator's carriedTimes setting (read per
  // submission) and refused when it names one of this installation's own public origins.
  const carriedTimesSettings = new InstallationSettingsService({
    repository: new MysqlInstallationSettingsRepository(pool),
    clock,
  });
  const ownOrigins = [
    ...(authentication.kind === "embedded"
      ? [authentication.policy.config.baseUrl, ...authentication.policy.config.trustedOrigins]
      : []),
    ...(routePolicies.publicBundle === undefined ? [] : [routePolicies.publicBundle.origin]),
  ];
  const timeTrialSubmissionService = new TimeTrialSubmissionService(
    new MysqlTimeTrialWriteRepository(pool, clock),
    new TimeTrialSchema9AssetCatalogAdapter(catalog),
    timeTrialProtector,
    worldRecordTimes,
    {
      policy: async () => (await carriedTimesSettings.current()).carriedTimes,
      ownOrigins,
    },
  );
  const ephemeralScanTestService = new EphemeralAndroidScanTestService(
    pool,
    new TimeTrialSchema9AssetCatalogAdapter(catalog),
    clock,
  );
  const webManualRepository = webManualConfig === undefined
    ? null
    : new MysqlWebManualSessionRepository(pool);
  const webCsrfService = webManualConfig === undefined
    ? null
    : new WebCsrfService(
        webManualConfig.csrfKeys,
        clock,
        { newNonce: () => randomBytes(24) },
      );
  const webManualSessionService = webManualConfig === undefined ||
    webManualRepository === null
    ? null
    : new WebManualSessionService(
        webManualRepository,
        new WebManualSchema9TrackCatalogAdapter(catalog),
        { newOpaqueId: () => randomUUID() },
        clock,
        webManualConfig.producerVersion,
      );
  const webManualSubmissionAuthorizer = webManualRepository === null
    ? null
    : new WebManualSubmissionAuthorizer(webManualRepository);
  const configuredTimeTrialAuthorizer = routePolicies.timeTrialSubmissionAuthorizer;
  const accountClaimTimeTrialAuthorizer = embeddedAuth === null ||
      webManualRepository === null
    ? null
    : new AccountClaimTimeTrialSubmissionAuthorizer(webManualRepository);
  const nativeTimeTrialAuthorizer = accountClaimTimeTrialAuthorizer === null
    ? configuredTimeTrialAuthorizer
    : {
        async authorize(context: Parameters<
          TimeTrialSubmissionAuthorizer["authorize"]
        >[0]): Promise<boolean> {
          if (isAccountClaimNativeTimeTrialSource(context.sourceKind)) {
            return accountClaimTimeTrialAuthorizer.authorize(context);
          }
          return configuredTimeTrialAuthorizer?.authorize(context) ?? false;
        },
      };
  const timeTrialSubmissionAuthorizer = webManualSubmissionAuthorizer === null
    ? nativeTimeTrialAuthorizer
    : {
        async authorize(context: Parameters<
          TimeTrialSubmissionAuthorizer["authorize"]
        >[0]): Promise<boolean> {
          // web_scan is the same browser session as web_manual, only with the provenance of a
          // scan recorded on it (ADR-0204): same authorizer, same CSRF, same eligibility.
          if (context.sourceKind === "web_manual" || context.sourceKind === "web_scan") {
            return webManualSubmissionAuthorizer.authorize(context);
          }
          return nativeTimeTrialAuthorizer?.authorize(context) ?? false;
        },
      };
  const timeTrialRevisionReadService = new TimeTrialRevisionReadService(
    new MysqlTimeTrialReadRepository(pool),
    timeTrialReader,
    clock,
  );
  const tournamentRaceResultService = new TournamentRaceResultService(
    new MysqlTournamentWriteRepository(pool),
    new TournamentSchema9AssetCatalogAdapter(catalog),
    tournamentProtector,
  );
  const tournamentRevisionReadService = new TournamentRevisionReadService(
    new MysqlTournamentReadRepository(pool),
    tournamentReader,
    clock,
  );
    const claimLifecycle = new ClaimLifecycleService(
      new MysqlClaimWriteRepository(pool),
      idGenerator,
      clock,
    );
    const aliasService = new AliasService(
      new MysqlAliasWriteRepository(pool),
      aliasIdGenerator,
      clock,
    );
    const administratorGrantService = new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId: () => `administrator_grant.${randomUUID()}` },
      clock,
    );
    const playerActivityService = new PlayerActivityService(
      new MysqlPlayerActivityRepository(pool),
    );
    // Who is who: the administrator surface that links an address to the
    // Player whose history it should see, and takes the link away again.
    const identityLinkAdminService = new IdentityLinkAdminService(
      new MysqlIdentityLinkAdminRepository(pool, authenticationSubjectProtector),
      {
        administratorLink: (actor, command) =>
          claimLifecycle.administratorLink(actor, command),
        administratorAction: (actor, command) =>
          claimLifecycle.administratorAction(actor, command),
      },
    );
    const playerClaimProductService = new PlayerClaimProductService(
      new MysqlPlayerClaimProductRepository(pool),
    );
    const ratingLifecycleService = new RatingLifecycleService(
      new MysqlRatingLifecycleRepository(pool),
      clock,
    );
    // Every recalculation - removing a Tournament, reopening a finalized
    // night, the Beheer → Rating button - replays the rating the way the
    // production epochs were built: history recompute, measured parameters,
    // decay, then every counting result set oldest first (ADR-0155 addendum).
    ratingLifecycleService.useHistoryReplay(createHistoryReplay(pool, ratingLifecycleService));
    // ADR-0221: who creates Players and who counts; the recalculation it asks
    // for is the same faithful replay as every other recalculation.
    const installationSettingsService = new InstallationSettingsService({
      repository: new MysqlInstallationSettingsRepository(pool),
      clock,
      recomputeRatings: (input) => ratingLifecycleService.recalculate(input),
    });
    const playerOnboardingService = new PlayerOnboardingService(
      new MysqlPlayerOnboardingRepository(pool),
      {
        newPlayerId: () => `player.${randomUUID()}`,
        newPlayerClaimId: idGenerator.newPlayerClaimId,
      },
      clock,
      installationSettingsService,
    );
    const playerInsightsService = new PlayerInsightsService(
      new MysqlPlayerInsightsRepository(pool),
    );
  const publicTimeTrialService = new PublicTimeTrialService(
      new MysqlPublicTimeTrialRepository(pool),
    );
    const publicCareerService = new PublicCareerService(
      new MysqlPublicCareerRepository(pool),
    );
    const communityOverviewService = new CommunityOverviewService(
      new MysqlCommunityOverviewRepository(pool),
    );
    const recordBookService = new RecordBookService(
      new MysqlRecordBookRepository(pool),
    );
    const playerAvatarService = new PlayerAvatarService(
      new MysqlPlayerAvatarRepository(pool),
      catalog,
    );
    const playerCountryService = new PlayerCountryService(
      new MysqlPlayerCountryRepository(pool),
      catalog,
    );
    const playerVisibilityService = new PlayerVisibilityService(
      new MysqlPlayerVisibilityRepository(pool),
    );
    const timeTrialLifecycleService = new TimeTrialLifecycleService(
      new MysqlTimeTrialLifecycleRepository(pool),
      worldRecordTimes,
      new TimeTrialSchema9AssetCatalogAdapter(catalog),
    );
    const identityRepository = new MysqlIdentityReadRepository(pool);
    const homeComebackRepository = new MysqlHomeComebackRepository(pool);
    const homeComebackService = new HomeComebackService(
      homeComebackRepository,
    );
    const rivalPreferenceService = new RivalPreferenceService(
      homeComebackRepository,
    );
    const followPreferenceService = new FollowPreferenceService(
      new MysqlFollowPreferenceRepository(pool),
    );
    const homeFocusService = new HomeFocusService(
      new MysqlHomeFocusRepository(pool),
    );
    const accountTimeTrialPreferencesService =
      new AccountTimeTrialPreferencesService(
        new MysqlAccountTimeTrialPreferencesRepository(pool),
        clock.nowMs,
      );
    // The appearance choice is synced, the resolved mode never is (ADR-0205).
    const accountAppearancePreferenceService =
      new AccountAppearancePreferenceService(
        new MysqlAccountAppearancePreferenceRepository(pool),
        clock.nowMs,
      );
    const playerProfilePreferenceService = new PlayerProfilePreferenceService(
      new MysqlPlayerProfilePreferenceRepository(pool),
      catalog,
      clock.nowMs,
    );
    // Cleanup and refusal counts are reported as fixed event names and numbers only.
    const mutationRateLimiter = new MysqlMutationRateLimiter(pool, clock.nowMs, {
      cleanupCompleted(deletedRows, complete) {
        routePolicies.operationalLog?.log({ event: "rate_limit_cleanup_completed", category: "lifecycle",
          detail: `deleted:${String(deletedRows)} complete:${String(complete)}` });
      },
      cleanupFailed(errorName) {
        routePolicies.operationalLog?.log({ event: "rate_limit_cleanup_failed", category: "lifecycle", errorName });
      },
      refusalsSinceLastReport(refusals) {
        const detail = Object.entries(refusals).map(([scope, count]) => `${scope}:${String(count)}`)
          .join(" ").slice(0, 160);
        routePolicies.operationalLog?.log({ event: "rate_limit_refusals", category: "lifecycle", detail });
      },
    }, refusalLedger);
    const stopRateLimitCleanup = mutationRateLimiter.startCleanupTimer();
    // H1: installation-wide and per-target budgets on the same durable limiter (MK8DX_HOSTED_BUDGET_*).
    const abuseBudgets = new AbuseBudgets(mutationRateLimiter,
      routePolicies.abuseBudgets ?? defaultAbuseBudgetSettings());
    const activityStoryService = new ActivityStoryService(
      new MysqlActivityStoryRepository(pool),
    );
    // Which build each device runs, said by the client itself. One row per
    // version per installation; see `client-installations.ts` for what is kept
    // and for the retention the write path applies.
    const clientInstallationService = new ClientInstallationService(
      new MysqlClientInstallationRepository(pool),
      clock.nowMs,
      mutationRateLimiter,
    );
    const notificationRepository = withNotificationFanOutBudget(new MysqlNotificationRepository(pool), abuseBudgets);
    const notificationService = new NotificationService({
      repository: notificationRepository,
      onProducerError: (context, error) => {
        routePolicies.operationalLog?.log({
          event: "notification_producer_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
          detail: context,
        });
      },
    });
    const notificationProducerJobs = new MysqlNotificationProducerJobRepository(pool);
    const notificationProducerWorker = new NotificationProducerWorker(
      notificationProducerJobs,
      notificationRepository,
      clock.nowMs,
    );
    const reactionService = new ReactionService({
      repository: new MysqlReactionRepository(pool),
      onNewReaction: async (resultId) => {
        await notificationService.notifyReactionReceived(resultId);
      },
    });
    const tournamentPublicationService = new TournamentPublicationService(
      new MysqlTournamentPublicationRepository(pool),
      { newPublicationId: () => `tournament_publication.${randomUUID()}` },
      clock,
    );
    const publicTournamentService = new PublicTournamentService(
      new MysqlPublicTournamentRepository(pool),
    );
    // Built once and shared: the operation service reads the published report
    // for a public night, the report service writes it.
    const tournamentReportRepository = new MysqlTournamentReportRepository(pool);
    // The community's own numbers, over every finished night. Reads the
    // corrected history and writes nothing, like the editions themselves.
    const tournamentStatisticsService = new TournamentStatisticsService(
      new MysqlTournamentStatisticsRepository(pool),
    );
    const tournamentOperationDependencies = {
      repository: new MysqlTournamentOperationRepository(pool),
      historyEditions: new MysqlHistoryEditionRepository(pool),
      publishedReports: tournamentReportRepository,
      raceResults: tournamentRaceResultService,
      publications: tournamentPublicationService,
      rating: ratingLifecycleService,
      ids: {
        newTournamentId: () => `tournament.${randomUUID()}`,
        newGroupId: () => `tournament_group.${randomUUID()}`,
      },
      clock,
      ...(routePolicies.operationalLog === undefined
        ? {}
        : { operationalLog: routePolicies.operationalLog }),
    };
    const tournamentOperationService =
      new TournamentOperationService(tournamentOperationDependencies);
    const notificationAwareTimeTrialLifecycleService = {
      readOwnedOrAdministered: timeTrialLifecycleService.readOwnedOrAdministered.bind(timeTrialLifecycleService),
      listOwn: timeTrialLifecycleService.listOwn.bind(timeTrialLifecycleService),
      listForAdministrator: timeTrialLifecycleService.listForAdministrator.bind(timeTrialLifecycleService),
      retire: timeTrialLifecycleService.retire.bind(timeTrialLifecycleService),
      setVideo: timeTrialLifecycleService.setVideo.bind(timeTrialLifecycleService),
      publishReviewed: timeTrialLifecycleService.publishReviewed.bind(timeTrialLifecycleService),
      resolveCarriedWaiting: timeTrialLifecycleService.resolveCarriedWaiting.bind(timeTrialLifecycleService),
      correct: async (...args: Parameters<TimeTrialLifecycleService["correct"]>) => {
        return timeTrialLifecycleService.correct(...args);
      },
      restore: async (...args: Parameters<TimeTrialLifecycleService["restore"]>) => {
        return timeTrialLifecycleService.restore(...args);
      },
    };
    const notificationChannelRepository = new MysqlNotificationChannelRepository(pool);
    const notificationChannelService = new NotificationChannelService(
      notificationChannelRepository,
      webPushProtector,
      routePolicies.webPush?.publicKey ?? null,
      clock.nowMs,
      new WebPushEgressPolicy(routePolicies.webPush?.extraProviderHosts ?? []),
    );
    const webPushDeliveryRepository = new MysqlWebPushDeliveryRepository(pool, webPushReader);
    const webPushWorker = routePolicies.webPush === undefined
      ? null
      : new WebPushDeliveryWorker(
          webPushDeliveryRepository,
          routePolicies.webPush,
          clock.nowMs,
        );
    const playerEngagementService = new PlayerEngagementService(
      new MysqlPlayerEngagementRepository(pool),
      clock,
      { newEngagementId: () => `player_engagement.${randomUUID()}` },
    );
    const tournamentStandingService = new TournamentStandingService(
      new MysqlTournamentStandingRepository(pool),
    );
    const tournamentTrackRecordService = new TournamentTrackRecordService(
      new MysqlTournamentTrackRecordRepository(pool),
    );
    const observedIdentityAdminService = new ObservedIdentityAdminService(
      new MysqlObservedIdentityAdminRepository(pool),
      clock.nowMs,
    );
    const socialGroupService = new SocialGroupService(
      new MysqlSocialGroupRepository(pool),
      () => `social_group.${randomUUID()}`,
      clock.nowMs,
    );
    // Reference updates are an explicit reviewed install operation.
    // Ordinary startup never fetches or replaces the installed snapshot.
    const worldRecordService = new MysqlWorldRecordRepository(pool);
    // Accepting a pending contribution writes a race result, attaches it to a
    // group, revises the Tournament and closes the pending record. Those live
    // behind three repositories, so they are rebuilt against one connection and
    // one transaction: Accept commits completely or leaves nothing behind.
    const tournamentAcceptUnitOfWork = new MysqlTournamentAcceptUnitOfWork(
      pool,
      (connection) => ({
        repository: new MysqlTournamentConnectedRepository(pool, connection),
        raceResults: new TournamentRaceResultService(
          new MysqlTournamentWriteRepository(pool, connection),
          new TournamentSchema9AssetCatalogAdapter(catalog),
          tournamentProtector,
        ),
        operations: new TournamentOperationService({
          ...tournamentOperationDependencies,
          repository: new MysqlTournamentOperationRepository(pool, connection),
        }),
      }),
    );
    const tournamentOperatorCapabilityService = new TournamentOperatorCapabilityService(
      new MysqlTournamentOperatorCapabilityRepository(pool),
      { newGrantId: () => `account_capability_grant.${randomUUID()}` },
      clock,
    );
    // ADR-0220: an approval writes the same audited grant as the Directors section.
    const directorHostRequestService = new DirectorHostRequestService({
      repository: new MysqlDirectorHostRequestRepository(pool),
      hasTournamentOperation: (userAccountId) => tournamentOperatorCapabilityService.has(userAccountId),
      ids: {
        newRequestId: () => `director_host_request.${randomUUID()}`,
        newGrantId: () => `account_capability_grant.${randomUUID()}`,
      },
      clock,
      notifier: {
        hostRequested: (requestId) => notificationService.notifyHostRequested(requestId),
        hostRequestDecided: (requestId, userAccountId, decision) =>
          notificationService.notifyHostRequestDecided(requestId, userAccountId, decision),
      },
    });
    // ADR-0222: open sign-up writes the roster rows and tells each Player their outcome.
    const tournamentSignupService = new TournamentSignupService({
      repository: new MysqlTournamentSignupRepository(pool),
      clock,
      notifier: { signupChanged: (notice) => notificationService.notifyTournamentSignup(notice) },
      ...(routePolicies.operationalLog === undefined ? {} : { operationalLog: routePolicies.operationalLog }),
    });
    const tournamentConnectedService = new TournamentConnectedService(
      new MysqlTournamentConnectedRepository(pool),
      tournamentRaceResultService,
      tournamentOperationService,
      undefined,
      tournamentAcceptUnitOfWork,
      (userAccountId) => tournamentOperatorCapabilityService.has(userAccountId),
      // F04: evidence uploads share the durable limiter, so several API
      // processes of one installation spend one budget.
      { rateLimiter: new MysqlMutationRateLimiter(pool, clock.nowMs, undefined, refusalLedger) },
    );
    const tournamentRetractionService = new TournamentRetractionService(
      new MysqlTournamentRetractionRepository(pool),
      tournamentPublicationService,
      ratingLifecycleService,
      Date.now,
      tournamentReportRepository,
    );
    const tournamentReportService = new TournamentReportService(
      tournamentReportRepository,
      tournamentOperationService,
      { newGrantId: () => `account_capability_grant.${randomUUID()}` },
      clock,
      new MysqlPublicRatingRepository(pool),
    );
    // Owner decision 2026-11-15 (audit 4B): dangerous actions need a fresh e-mail confirmation of
    // the session that asks. Only where this installation sends e-mail; an offline LAN has none.
    const stepUp = embeddedAuth === null || authentication.kind !== "embedded" ||
        authentication.policy.offlineLan === true ||
        typeof authentication.policy.emailDelivery.sendStepUp !== "function"
      ? null
      : (() => {
          const delivery = authentication.policy.emailDelivery;
          const store = new MysqlStepUpStore(pool);
          return {
            service: new StepUpService(
              store,
              { sendStepUp: (message) => delivery.sendStepUp!(message) },
              mutationRateLimiter,
              {
                linkOrigin: authentication.policy.config.baseUrl,
                ...(authentication.policy.stepUpWindowSeconds === undefined
                  ? {}
                  : { windowSeconds: authentication.policy.stepUpWindowSeconds }),
              },
            ),
            store,
            resolveSession: async (request: FastifyRequest) => {
              const found = await embeddedAuth.api.getSession({ headers: fromNodeHeaders(request.headers) });
              if (found === null || found.user.emailVerified !== true) { return null; }
              return {
                sessionId: found.session.id,
                authUserId: found.user.id,
                email: found.user.email,
                emailVerified: true,
              };
            },
            trustedOrigins: authentication.policy.config.trustedOrigins,
            preAuthBudget: new PreAuthBudget(mutationRateLimiter,
              derivePreAuthBudgetKey(authentication.policy.config.secrets[0]!.value),
              embeddedAuth.clientAddress),
          };
        })();
    const app = await buildApp({
      identityRepository,
      resolveActor,
      abuseBudgets,
      ...(embeddedAuth === null || authentication.kind !== "embedded"
        ? {}
        : {
            authEmailBudgets: new AuthEmailBudgets(
              abuseBudgets,
              new PreAuthBudget(mutationRateLimiter,
                derivePreAuthBudgetKey(authentication.policy.config.secrets[0]!.value),
                embeddedAuth.clientAddress),
              createHmac("sha256", Buffer.from(authentication.policy.config.secrets[0]!.value, "base64"))
                .update("mk8dx.auth-email-recipient-budget.v1", "ascii").digest(),
            ),
          }),
      // Bound request memory and database waiters under botnet/viral bursts.
      // Health routes remain outside this gate for operator diagnosis.
      requestConcurrencyLimit: 100,
      ...(routePolicies.operationalLog === undefined
        ? {}
        : { operationalLog: routePolicies.operationalLog }),
      ...(routePolicies.staticWeb === undefined
        ? {}
        : { staticWeb: routePolicies.staticWeb }),
      ...(routePolicies.publicBundle === undefined
        ? {}
        : { publicBundle: routePolicies.publicBundle }),
      ...(routePolicies.staticWeb === undefined ||
        authentication.kind !== "embedded"
        ? {}
        : {
            socialPreview: {
              baseUrl: authentication.policy.config.baseUrl,
              playerName: async (playerId: string) => {
                const player = await identityRepository
                  .findPublicPlayerById(playerId);
                return player?.displayName ?? null;
              },
              playerAvatarId: async (playerId: string) => {
                const player = await identityRepository
                  .findPublicPlayerById(playerId);
                return player?.avatarId ?? null;
              },
            },
          }),
      ...(routePolicies.gameAssets === undefined
        ? {}
        : { gameAssets: routePolicies.gameAssets }),
      ...(routePolicies.appDownloads === undefined
        ? {}
        : { appDownloads: { ...routePolicies.appDownloads, rateLimiter: mutationRateLimiter } }),
      clientInstallations: { service: clientInstallationService },
      ...(stepUp === null ? {} : { stepUp }),
      ...(embeddedAuth === null
        ? {}
        : {
            embeddedAuth: {
              auth: embeddedAuth,
              baseUrl: authentication.kind === "embedded"
                ? authentication.policy.config.baseUrl
                : "",
              offlineLan: authentication.kind === "embedded" && authentication.policy.offlineLan === true,
            },
          }),
      administratorOverview: {
        service: new AdministratorOverviewService(
          new MysqlAdministratorOverviewRepository(pool),
          clock,
        ),
      },
      administratorRequestBudgets: {
        service: new AdministratorRequestBudgetsService(
          new MysqlAdministratorRequestBudgetsRepository(pool),
          abuseBudgets.settings,
          clock,
          undefined,
          () => refusalLedger.unflushed(),
        ),
      },
      quotaRefusals: refusalLedger,
      claimLifecycle: {
        // The people who decide a request hear that it arrived; the producer
        // never fails the request itself.
        requestClaim: async (actor, command) => {
          const snapshot = await claimLifecycle.requestClaim(actor, command);
          await notificationService.notifyClaimRequested(
            snapshot.playerClaimId,
            snapshot.playerId,
          );
          return snapshot;
        },
        openDispute: claimLifecycle.openDispute.bind(claimLifecycle),
        // The person asking hears every decision and question (ADR-0216);
        // starting a review is not news for them.
        administratorAction: async (actor, command) => {
          const outcome = await claimLifecycle.administratorAction(
            actor,
            command,
          );
          const notice = claimDecisionNotices[command.action];
          if (notice !== undefined) {
            await notificationService.notifyClaimDecided(
              outcome.userAccountId,
              notice,
            );
          }
          return outcome;
        },
        replyToClaim: async (actor, command) => {
          const snapshot = await claimLifecycle.replyToClaim(actor, command);
          await notificationService.notifyClaimRequested(
            snapshot.playerClaimId,
            snapshot.playerId,
            "reply",
          );
          return snapshot;
        },
        releaseOwnClaim: claimLifecycle.releaseOwnClaim.bind(claimLifecycle),
      },
      ...(webCsrfService === null
        ? {}
        : { claimCsrfVerifier: webCsrfService }),
      ...(webCsrfService === null
        ? {}
        : {
            administratorGrants: {
              service: administratorGrantService,
              csrfVerifier: webCsrfService,
              rateLimiter: mutationRateLimiter,
            },
          }),
      aliasRepository: new MysqlAliasReadRepository(pool),
      aliasService,
      aliasProtection: {
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null ? {} : { csrfVerifier: webCsrfService }),
      },
      playerActivity: { service: playerActivityService },
      // Linking is a write from the administrator's own browser, so it is
      // offered only where the same-origin proof exists to protect it.
      ...(webCsrfService === null
        ? {}
        : {
          identityLinkAdmin: {
            service: identityLinkAdminService,
            csrfVerifier: webCsrfService,
          },
          observedIdentityAdmin: {
            service: observedIdentityAdminService,
            csrfVerifier: webCsrfService,
          },
        }),
      playerClaimProduct: { service: playerClaimProductService },
      // ADR-0219: the browser route needs the same-origin proof; without it
      // only the native (bearer) twin answers.
      claimCandidates: {
        service: new ClaimCandidateService(new MysqlClaimCandidateRepository(pool)),
        csrfVerifier: webCsrfService ?? { verify: () => false },
      },
      claimReviews: {
        service: new ClaimReviewReadService(new MysqlClaimReviewReadRepository(pool)),
      },
      playerOnboarding: {
        service: playerOnboardingService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      publicRatings: {
        repository: new MysqlPublicRatingRepository(pool),
        history: new MysqlLegacyHistoryRepository(pool),
      },
      playerInsights: { service: playerInsightsService },
      publicCareer: { service: publicCareerService },
      communityOverview: { service: communityOverviewService },
      recordBook: { service: recordBookService },
      playerAvatar: {
        service: playerAvatarService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      playerCountry: {
        service: playerCountryService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      playerVisibility: {
        service: playerVisibilityService,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      timeTrialLifecycle: {
        service: notificationAwareTimeTrialLifecycleService,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      timeTrialCompletion: {
        service: new TimeTrialCompletionService(
          new MysqlTimeTrialCompletionRepository(pool, clock),
          new TimeTrialSchema9AssetCatalogAdapter(catalog),
          timeTrialProtector,
        ),
        rateLimiter: mutationRateLimiter,
      },
      referenceGhosts: {
        service: new ReferenceGhostReadingService(
          new MysqlReferenceGhostReadingRepository(pool),
          worldRecordTimes,
          {
            knowsTrack: (trackId) => catalog.validate("/trackId", trackId, "track") === null,
            baseLoadout: (loadout) => {
              const characterId = catalog.basePart(loadout.characterId, "character");
              const bodyId = catalog.basePart(loadout.bodyId, "body");
              const tireId = catalog.basePart(loadout.tireId, "tire");
              const gliderId = catalog.basePart(loadout.gliderId, "glider");
              return characterId === null || bodyId === null || tireId === null || gliderId === null
                ? null : { characterId, bodyId, tireId, gliderId };
            },
          },
          clock,
        ),
        rateLimiter: mutationRateLimiter,
      },
      publicTimeTrials: { service: publicTimeTrialService },
      reactions: {
        service: reactionService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      home: {
        comeback: homeComebackService,
        rivals: rivalPreferenceService,
        follows: followPreferenceService,
        focus: homeFocusService,
        stories: activityStoryService,
        rivalBestTimes: new MysqlPublicTimeTrialRepository(pool),
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      notifications: {
        service: notificationService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      notificationChannels: {
        service: notificationChannelService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      accountTimeTrialPreferences: {
        service: accountTimeTrialPreferencesService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      ...(embeddedAuth === null || accountSwitch === undefined || authentication.kind !== "embedded"
        ? {}
        : {
            accountSwitch: {
              api: embeddedAuth.api as unknown as AccountSwitchAuthApi,
              pins: accountSwitch.pins,
              store: accountSwitch.store,
              rateLimiter: mutationRateLimiter,
              keys: accountSwitch.keys,
              preAuthBudget: new PreAuthBudget(mutationRateLimiter,
                derivePreAuthBudgetKey(authentication.policy.config.secrets[0]!.value),
                embeddedAuth.clientAddress),
              trustedOrigins: authentication.policy.config.trustedOrigins
                .map((origin) => new URL(origin).origin),
              ...(webCsrfService === null ? {} : { csrfVerifier: webCsrfService }),
            },
          }),
      ...(offlineInvitation === undefined
        ? {}
        : {
            deviceInvitations: {
              tickets: offlineInvitation.tickets,
              origin: offlineInvitation.origin,
              rateLimiter: mutationRateLimiter,
              ...(webCsrfService === null ? {} : { csrfVerifier: webCsrfService }),
            },
            ...(embeddedAuth === null || authentication.kind !== "embedded"
              ? {}
              : {
                  nativeInvitations: {
                    api: embeddedAuth.api as unknown as NativeInvitationAuthApi,
                    origin: offlineInvitation.origin,
                    preAuthBudget: new PreAuthBudget(mutationRateLimiter,
                      derivePreAuthBudgetKey(authentication.policy.config.secrets[0]!.value),
                      embeddedAuth.clientAddress),
                  },
                }),
          }),
      accountAppearancePreference: {
        service: accountAppearancePreferenceService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      playerProfilePreferences: {
        service: playerProfilePreferenceService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      socialGroups: {
        service: socialGroupService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null ? {} : { csrfVerifier: webCsrfService }),
      },
      playerEngagements: {
        service: playerEngagementService,
        rateLimiter: mutationRateLimiter,
        ...(webCsrfService === null ? {} : { csrfVerifier: webCsrfService }),
      },
      worldRecords: { service: worldRecordService },
      ...(webCsrfService === null
        ? {}
        : {
            tournamentPublications: {
              service: tournamentPublicationService,
              csrfVerifier: webCsrfService,
              rateLimiter: mutationRateLimiter,
              // Publishing a tournament applies its races to the rating
              // (ADR-0155); an excluded or already applied publication is
              // a normal no-op and real failures reach the operational log
              // without ever failing the committed publication.
              onPublished: async (publicationId: string): Promise<void> => {
                try {
                  await ratingLifecycleService.applyPublication(publicationId);
                } catch (error) {
                  if (error instanceof RatingLifecycleError &&
                    error.code === "conflict") {
                    return;
                  }
                  routePolicies.operationalLog?.log({
                    event: "rating_application_failed",
                    category: "lifecycle",
                    errorName: error instanceof Error
                      ? error.name
                      : "UnknownError",
                  });
                }
              },
            },
          }),
      publicTournaments: { service: publicTournamentService },
      tournamentStanding: { service: tournamentStandingService },
      tournamentTrackRecord: { service: tournamentTrackRecordService },
      ...(webCsrfService === null
        ? {}
        : {
            tournamentOperations: {
              service: tournamentOperationService,
              csrfVerifier: webCsrfService,
              statistics: tournamentStatisticsService,
            },
            tournamentConnected: {
              service: tournamentConnectedService,
              csrfVerifier: webCsrfService,
            },
            tournamentRetraction: {
              service: tournamentRetractionService,
              csrfVerifier: webCsrfService,
            },
            tournamentReports: {
              service: tournamentReportService,
              csrfVerifier: webCsrfService,
            },
            tournamentOperatorCapabilities: {
              service: tournamentOperatorCapabilityService,
              csrfVerifier: webCsrfService,
            },
            directorHostRequests: {
              service: directorHostRequestService,
              csrfVerifier: webCsrfService,
            },
            installationSettings: {
              service: installationSettingsService,
              csrfVerifier: webCsrfService,
            },
            tournamentSignups: {
              service: tournamentSignupService,
              csrfVerifier: webCsrfService,
            },
            ratingAdministration: {
              service: ratingLifecycleService,
              readRepository: new MysqlRatingAdministrationRepository(pool),
              csrfVerifier: webCsrfService,
            },
          }),
      ...(timeTrialSubmissionAuthorizer === undefined
        ? {}
        : {
      timeTrialSubmission: {
              // The write transaction enqueues durable derived-notification
              // work. Publication never waits for fan-out.
              service: timeTrialSubmissionService,
        authorizer: timeTrialSubmissionAuthorizer,
        rateLimiter: mutationRateLimiter,
              feedback: new SubmissionFeedbackService(
                new MysqlSubmissionFeedbackRepository(pool),
              ),
              testService: ephemeralScanTestService,
              ...(webCsrfService === null
                ? {}
                : { csrfVerifier: webCsrfService }),
            },
          }),
      ...(webManualSessionService === null
        ? {}
        : { webManualSession: { service: webManualSessionService } }),
      ...(embeddedAuth === null || webManualRepository === null
        ? {}
        : {
            nativeTimeTrialSession: {
              service: new NativeTimeTrialSessionService(webManualRepository),
            },
          }),
      // ADR-0209: approve a native client's device code from the account's inbox.
      ...(embeddedAuth === null || webManualRepository === null ||
          authentication.kind !== "embedded" ||
          typeof authentication.policy.emailDelivery.sendNativeSignIn !== "function"
        ? {}
        : (() => {
            const delivery = authentication.policy.emailDelivery;
            const native = new NativeTimeTrialSessionService(webManualRepository);
            const auditSink = new MysqlEmbeddedAuthAuditSink(pool, clock);
            return {
              nativeEmailApproval: {
                service: new NativeEmailApprovalService(
                  embeddedAuth,
                  { sendNativeSignIn: (message) => delivery.sendNativeSignIn!(message) },
                  {
                    // Eligible = the address's account resolves through its
                    // active binding to a verified Player, exactly what the
                    // native bootstrap will ask for after sign-in.
                    async isEligible(authUserId) {
                      const subjects = authenticationSubjectProtector
                        .protectVerifiedSubjectCandidates(MK8DX_PASSWORDLESS_ISSUER, authUserId);
                      for (const subject of subjects) {
                        const account = await bindingRepository.resolveActiveAccount(subject);
                        if (account === null) { continue; }
                        try {
                          await native.bootstrapV2({ role: "account", userAccountId: account.userAccountId });
                          return true;
                        } catch {
                          return false;
                        }
                      }
                      return false;
                    },
                  },
                  { async record(event) {
                    await auditSink.record({ kind: event.kind, subjectId: event.subjectId, clientId: event.clientId });
                  } },
                  {
                    linkOrigin: authentication.policy.config.baseUrl,
                    attemptLimiter: new MysqlNativeEmailAttemptLimiter(pool, clock.nowMs),
                  },
                ),
              },
            };
          })()),
      ...(webCsrfService === null
        ? {}
        : { webCsrf: { service: webCsrfService } }),
      // Canonical Tournament race results produced by the recorded and live
      // products reach the platform here. Without an explicitly configured
      // policy the boundary is the audited administrator role plus the
      // same-origin CSRF proof, matching Tournament publication (ADR-0147);
      // a configured authorizer (tests, non-browser compositions) replaces it
      // and then no CSRF proof is required.
      tournamentSubmission: {
        service: tournamentRaceResultService,
        rateLimiter: mutationRateLimiter,
        authorizer: routePolicies.tournamentSubmissionAuthorizer
          ?? new AdministratorTournamentSubmissionAuthorizer(),
        ...(routePolicies.tournamentSubmissionAuthorizer !== undefined
          || webCsrfService === null
          ? {}
          : { csrfVerifier: webCsrfService }),
      },
      readinessProbe: {
        timeoutMs: 2_000,
        async check(): Promise<void> {
          const [rows] = await pool.execute<ReadinessRow[]>("SELECT 1 AS ready");
          if (rows.length !== 1 || rows[0]?.ready !== 1) {
            throw new Error("MySQL readiness response was invalid");
          }
        },
      },
    });
    const ephemeralScanTestCleanup = setInterval(() => {
      void ephemeralScanTestService.purgeExpired().catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "ephemeral_scan_test_cleanup_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, 15 * 60 * 1_000);
    ephemeralScanTestCleanup.unref();
    // ADR-0222: a night's sign-up also closes on its first read after the time; this sweep makes
    // sure the draw and its notifications do not wait for a visitor. Closing is idempotent.
    const closeDueSignups = (): void => {
      void tournamentSignupService.closeDue().catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "tournament_signup_sweep_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const signupCloseTimer = setInterval(closeDueSignups, 60_000);
    signupCloseTimer.unref();
    // F04: never-linked Tournament evidence past its retention, in bounded
    // batches; evidence that is linked, pending review or belongs to a night
    // still being run is never touched.
    const applyEvidenceRetention = (): void => {
      void tournamentConnectedService.applyEvidenceRetention(200).then((outcome) => {
        if (outcome.deleted > 0 || outcome.purged > 0) {
          routePolicies.operationalLog?.log({
            event: "tournament_evidence_retention",
            category: "lifecycle",
            detail: `deleted:${outcome.deleted} purged:${outcome.purged}`,
          });
        }
      }).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "tournament_evidence_retention_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const evidenceRetentionTimer = setInterval(applyEvidenceRetention, 60 * 60 * 1_000);
    evidenceRetentionTimer.unref();
    // Used or expired step-up links and old step-up audit rows, in bounded batches.
    const stepUpRetentionTimer = stepUp === null ? null : setInterval(() => {
      void stepUp.store.purge(clock.nowMs()).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "step_up_retention_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, 60 * 60 * 1_000);
    stepUpRetentionTimer?.unref();
    const deliverWebPush = (): void => {
      void webPushWorker?.tick().then((round) => {
        // Compact, identifier-free signal when a round met slow or refused endpoints.
        if (round !== null && (round.timeouts > 0 || round.refused > 0 || round.released > 0)) {
          routePolicies.operationalLog?.log({
            event: "web_push_delivery_degraded",
            category: "lifecycle",
            durationMs: round.durationMs,
            detail: `claimed:${round.claimed} delivered:${round.delivered} retry:${round.retried} dead:${round.dead} timeout:${round.timeouts} refused:${round.refused} released:${round.released}`,
          });
        }
      }).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "web_push_delivery_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const produceNotifications = (): void => {
      void notificationProducerWorker.tick().catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "notification_producer_worker_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const notificationProducerTimer = setInterval(produceNotifications, 2_000);
    notificationProducerTimer.unref();
    const inspectNotificationProducer = (): void => {
      void notificationProducerJobs.backlog(clock.nowMs()).then((backlog) => {
        if (backlog.readyCount >= 100 || backlog.oldestReadyAgeMs >= 60_000 ||
            backlog.deadRecentCount > 0) {
          routePolicies.operationalLog?.log({
            event: "notification_producer_backlog",
            category: "readiness",
            detail: `ready:${backlog.readyCount} processing:${backlog.processingCount} dead24h:${backlog.deadRecentCount} oldestMs:${backlog.oldestReadyAgeMs}`,
          });
        }
      }).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "notification_producer_inspection_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const inspectWebPush = (): void => {
      if (webPushWorker === null) return;
      void webPushDeliveryRepository.backlog(clock.nowMs()).then((backlog) => {
        const totals = webPushWorker.metrics();
        if (backlog.dueCount >= 100 || backlog.oldestDueAgeMs >= 5 * 60_000 ||
            totals.skippedTicks > 0 || totals.timeouts > 0) {
          routePolicies.operationalLog?.log({
            event: "web_push_delivery_backlog",
            category: "readiness",
            detail: `due:${backlog.dueCount} processing:${backlog.processingCount} oldestMs:${backlog.oldestDueAgeMs} ticks:${totals.ticks} skipped:${totals.skippedTicks} timeouts:${totals.timeouts} refused:${totals.refused} lastMs:${totals.lastTickDurationMs}`,
          });
        }
      }).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "web_push_inspection_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    };
    const notificationProducerInspectionTimer = setInterval(() => {
      inspectNotificationProducer();
      inspectWebPush();
    }, 15 * 60 * 1_000);
    notificationProducerInspectionTimer.unref();
    const purgeNotificationProducerJobs = (): void => {
      // Push subscription retention: excess over the per-account quota is
      // retired, and subscriptions revoked over 30 days ago are deleted.
      void notificationChannelRepository.purgeStaleSubscriptions({
        nowMs: clock.nowMs(),
        maximumActive: WEB_PUSH_SUBSCRIPTIONS_PER_ACCOUNT,
        revokedRetentionMs: 30 * 24 * 60 * 60 * 1_000,
      }).catch((error: unknown) => {
        routePolicies.operationalLog?.log({
          event: "web_push_retention_failed",
          category: "lifecycle",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
      void notificationProducerJobs.purgeTerminal(clock.nowMs()).catch(
        (error: unknown) => {
          routePolicies.operationalLog?.log({
            event: "notification_producer_retention_failed",
            category: "lifecycle",
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        },
      );
    };
    const notificationProducerRetentionTimer = setInterval(
      purgeNotificationProducerJobs, 24 * 60 * 60 * 1_000);
    notificationProducerRetentionTimer.unref();
    // The first round runs shortly after start rather than inside composition:
    // composing the runtime opens no database connection, and closing it right
    // away leaves nothing in flight.
    const notificationStartupTimer = setTimeout(() => {
      produceNotifications();
      inspectNotificationProducer();
      purgeNotificationProducerJobs();
      applyEvidenceRetention();
      if (webPushWorker !== null) { deliverWebPush(); }
    }, 5_000);
    notificationStartupTimer.unref();
    const webPushTimer = webPushWorker === null
      ? null
      : setInterval(deliverWebPush, 15_000);
    webPushTimer?.unref();
    let closed = false;
    return {
      app,
      timeTrialSubmissionService,
      timeTrialRevisionReadService,
      tournamentRaceResultService,
      tournamentRevisionReadService,
      async close(): Promise<void> {
        if (closed) { return; }
        closed = true;
        clearInterval(ephemeralScanTestCleanup);
        clearTimeout(notificationStartupTimer);
        clearInterval(signupCloseTimer);
        clearInterval(evidenceRetentionTimer);
        if (stepUpRetentionTimer !== null) { clearInterval(stepUpRetentionTimer); }
        stopRateLimitCleanup();
        stopRefusalLedgerFlush();
        if (webPushTimer !== null) { clearInterval(webPushTimer); }
        clearInterval(notificationProducerTimer);
        clearInterval(notificationProducerInspectionTimer);
        clearInterval(notificationProducerRetentionTimer);
        try {
          await app.close();
        } finally {
          // The last counts of this process (graceful shutdown); never throws.
          await refusalLedger.flush();
          await pool.end();
        }
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function createLocalApiRuntime(
  config: LocalApiRuntimeConfig,
  resolveVerifiedProviderSubject: VerifiedProviderSubjectResolver,
  routePolicies: LocalApiRuntimeRoutePolicies = {},
): Promise<LocalApiRuntime> {
  return createMysqlApiRuntime(
    config,
    { kind: "external", resolveVerifiedProviderSubject },
    routePolicies,
  );
}

export async function createHostedApiRuntime(
  config: HostedApiCoreRuntimeConfig,
  authentication: EmbeddedAuthenticationRuntimePolicy,
  routePolicies: LocalApiRuntimeRoutePolicies = {},
): Promise<LocalApiRuntime> {
  return createMysqlApiRuntime(
    config,
    { kind: "embedded", policy: authentication },
    routePolicies,
  );
}
