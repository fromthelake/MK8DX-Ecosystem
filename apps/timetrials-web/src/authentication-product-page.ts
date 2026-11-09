import { expandShortLink } from "./short-links.js";
import {
  approveDeviceEmail,
  inspectDeviceEmail,
  isDeviceEmailToken,
  NativeEmailApprovalClientError,
} from "./native-email-approval-client.js";
import {
  parseEngineMode,
  readViewerEnginePreference,
  resolveEngineMode,
  type EngineMode,
} from "./engine-context.js";
import {
  forgetAppearanceSync,
  onAppearanceChange,
  resolvedAppearance,
  syncAppearanceWithAccount,
} from "./appearance-runtime.js";
import { mountAppearanceSettings } from "./appearance-settings.js";
import {
  button as dsButton,
  field as dsField,
  panel as dsPanel,
  statusMessage as dsStatusMessage,
  tabs as dsTabs,
  useDocument,
} from "./ds-components.js";
import {
  mountAppShell,
  type AppShellHandle,
  type ShellActive,
} from "./ds-shell.js";
import {
  isKnownRoute, routeContextBar, routeDocumentTitle, routeGlobalAction, routeSpectacle,
} from "./route-identity.js";
import {
  createWebAuthenticationClient,
  WebAuthenticationError,
  type WebAuthenticationClient,
} from "./authentication-client.js";
import {
  mountPostTimeTask,
  type MountedPostTimeTask,
  type PostTimeTaskOptions,
} from "./post-time-task.js";
import { createPostTimeBoardClient, verifiedPlayerId } from "./post-time-session.js";
import { createTimeTrialLifecycleClient } from "./time-trial-lifecycle-client.js";
import { scannerBase, scannerHref, takeSessionScanHandoff } from "./scan-handoff.js";
import { scanFillFromHandoff } from "./scan-service.js";
import { trackLapCount } from "./post-time-model.js";
import { openScanSourcePicker } from "./ds-scan.js";
import {
  mountPlayerClaimSection,
  type MountedPlayerClaimSection,
} from "./player-claim-section.js";
import {
  mountPlayerInsightsSection,
  type MountedPlayerInsightsSection,
} from "./ds-mystats.js";
import {
  mountPublicPlayerProfileForViewer,
  type MountedPublicPlayerProfile,
} from "./public-player-profile.js";
import { mountScanTestSection } from "./scan-test-section.js";
import {
  mountAdministratorClaimReviewSection,
  type MountedAdministratorClaimReviewSection,
} from "./administrator-claim-review-section.js";
import {
  mountAdministratorObservedIdentitySection,
  type MountedObservedIdentitySection,
} from "./administrator-observed-identity-section.js";
import { mountAdministratorClientInstallationSection } from
  "./administrator-client-installation-section.js";
import {
  mountAdministratorOverviewSection,
  type MountedAdministratorOverviewSection,
} from "./administrator-overview-section.js";
import {
  mountAdministratorIdentityLinkSection,
  type MountedAdministratorIdentityLinkSection,
} from "./administrator-identity-link-section.js";
import type { MountedRatingLeaderboard } from "./rating-view.js";
import {
  fetchTimeTrialStandings,
  mountTimeTrialStanding,
  type MountedTimeTrialStanding,
  type TimeTrialRankInitialView,
} from "./time-trial-standing-view.js";
import { fetchFocusRows } from "./home-focus.js";
import { parseRankTrackFocus } from "./rank-track-focus.js";
import {
  mountCupsView,
  type MountedCupsView,
} from "./ds-cups.js";
import {
  createFollowClient,
  createRivalClient,
  mountFollowSettings,
} from "./rival-settings.js";
import {
  mountActivityStories,
  type MountedActivityStories,
} from "./ds-activity.js";
import { fetchHeadToHead } from "./rating-graph.js";
import { createNotificationClient } from "./notification-client.js";
import { fetchComeback } from "./home-hero.js";
import {
  mountHome,
  mountSignedOutHome,
  type MountedHome,
} from "./ds-home.js";
import {
  discardPreloaded,
  forgetRemembered,
  installResponseCache,
  primeFromBootstrap,
} from "./preloaded-responses.js";
import { createPlayerClaimClient } from "./player-claim-client.js";
import {
  createTournamentStandingClient,
} from "./tournament-standing-client.js";
import { createTournamentTrackClient } from "./tournament-track-client.js";
import { mountTournamentStanding } from "./tournament-standing-view.js";
import {
  PRODUCT_LANGUAGES,
  localized,
  productLanguage,
  setProductLanguage,
} from "./product-language.js";
import {
  returnIntentFromSearch,
  signInHref,
} from "./return-intent.js";
import {
  isPlayerId,
  resolvePlayerReference,
} from "./public-player-client.js";
import {
  mountWelcomeOnboarding,
  type MountedWelcomeOnboarding,
} from "./welcome-onboarding.js";
import { createPublicPlayerClient } from "./public-player-client.js";
import { avatarAppearance } from "./avatar-manifest.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import {
  mountNotificationSection,
  type MountedNotificationSection,
} from "./notification-section.js";
import {
  mountAccountTimeTrialSettings,
} from "./account-time-trial-settings.js";
import { mountPlayerProfilePreferenceSettings } from "./player-profile-preference-settings.js";
import {
  mountRivalSettings,
  type MountedRivalSettings,
} from "./rival-settings.js";

import {
  mountCommunityView,
  type MountedCommunityView,
} from "./ds-community.js";
import {
  mountAppDownloadsView,
  type MountedAppDownloads,
} from "./app-downloads-view.js";
import {
  mountRecordsView,
  type MountedRecordsView,
} from "./ds-records.js";
import {
  mountBuildConfigurator,
  type MountedBuildConfigurator,
} from "./ds-build.js";
import {
  mountPlayerComparison,
  type MountedPlayerComparison,
} from "./ds-compare.js";
import {
  mountTrackBoard,
  type MountedTrackBoard,
  type TrackBoardOptions,
} from "./ds-track-board.js";
import { createPublicTimeTrialClient } from "./public-time-trial-client.js";
import {
  mountTournamentCanonicalImportSection,
  type MountedTournamentCanonicalImportSection,
} from "./tournament-canonical-import-section.js";
import {
  mountTournamentPublicationSection,
  type MountedTournamentPublicationSection,
} from "./tournament-publication-section.js";
import {
  mountPublicTournament,
  type MountedPublicTournament,
} from "./ds-public-tournament.js";
import { isHistoryEditionId, type MountedTournamentsView } from "./tournaments-view.js";
import { mountTournamentEvent, mountTournamentsList } from "./ds-tournaments.js";
import {
  mountTournamentOperation,
  type MountedTournamentOperation,
} from "./tournament-operation-view.js";
import {
  mountTournamentReport,
  type MountedTournamentReport,
} from "./tournament-report-view.js";
import {
  mountRatingAdministrationSection,
  type MountedRatingAdministrationSection,
} from "./rating-administration-section.js";
import {
  mountAdministratorAliasSection,
  type MountedAdministratorAliasSection,
} from "./administrator-alias-section.js";
import {
  mountPlayerVisibilitySettings,
  type MountedPlayerVisibilitySettings,
} from "./player-visibility-settings.js";
import { mountLanguageSettings } from "./language-settings.js";
import {
  createSocialGroupClient,
  mountSocialGroupSettings,
  type MountedSocialGroupSettings,
} from "./social-group-settings.js";
import {
  mountAdministratorTimeTrialSection,
  type MountedAdministratorTimeTrialSection,
} from "./administrator-time-trial-section.js";
import { mountTournamentOperatorAccess, type MountedTournamentOperatorAccess } from "./tournament-operator-access-section.js";
import { mountInstallationSettingsSection, type MountedInstallationSettingsSection } from "./installation-settings-section.js";
import { mountDirectorHostRequest, type MountedDirectorHostRequest } from "./director-host-request-section.js";
import {
  forgetNavIdentity,
  readNavIdentity,
  rememberNavIdentity,
} from "./nav-identity-cache.js";
import {
  detachCurrentWebPushSubscription,
  mountWebPushSettings,
} from "./web-push-settings.js";
import {
  mountProfileAliasSection,
  type MountedProfileAliasSection,
} from "./profile-alias-section.js";
import {
  mountAdministratorTournamentRemovalSection,
  type MountedAdministratorTournamentRemovalSection,
} from "./administrator-tournament-removal-section.js";

export type AuthenticationProductPageOptions = Readonly<{
  client?: WebAuthenticationClient;
  pathname?: string;
  search?: string;
  mountPostTime?: (
    root: HTMLElement,
    taskOptions: PostTimeTaskOptions,
  ) => Pick<MountedPostTimeTask, "unmount" | "heading">;
  mountClaim?: (
    root: HTMLElement,
  ) => Pick<MountedPlayerClaimSection, "ready" | "unmount"> &
    Partial<Pick<MountedPlayerClaimSection, "state">>;
  mountWelcome?: (
    root: HTMLElement,
  ) => Pick<MountedWelcomeOnboarding, "ready" | "unmount">;
  mountInsights?: (
    root: HTMLElement,
  ) => Pick<MountedPlayerInsightsSection, "ready" | "unmount">;
  mountPublicProfile?: (
    root: HTMLElement,
    playerId: string,
    tab?: "overview" | "timetrials" | "mastery",
    viewerPlayerId?: Promise<string | null>,
  ) => Pick<MountedPublicPlayerProfile, "ready" | "unmount">;
  mountAdministratorReview?: (
    root: HTMLElement,
    client?: undefined,
    options?: Readonly<{ hideWhenEmpty?: boolean }>,
  ) => Pick<MountedAdministratorClaimReviewSection, "ready" | "unmount">;
  mountLeaderboard?: (
    root: HTMLElement,
    trackId: string,
    mode: 150 | 200,
    boardOptions: TrackBoardOptions,
  ) => Pick<MountedTrackBoard, "ready" | "unmount">;
  mountTournamentPublication?: (
    root: HTMLElement,
  ) => Pick<MountedTournamentPublicationSection, "ready" | "unmount">;
  mountAdministratorTimeTrials?: (
    root: HTMLElement,
  ) => Pick<MountedAdministratorTimeTrialSection, "ready" | "unmount">;
  mountPlayerVisibility?: (
    root: HTMLElement,
  ) => Pick<MountedPlayerVisibilitySettings, "ready" | "unmount">;
  mountPublicTournament?: (
    root: HTMLElement,
    publicationId: string,
  ) => Pick<MountedPublicTournament, "ready" | "unmount">;
  mountRanking?: (
    root: HTMLElement,
  ) => Pick<MountedRatingLeaderboard, "ready" | "unmount">;
  mountTimeTrialStanding?: (
    root: HTMLElement,
    context: Promise<Readonly<{
      viewerPlayerId: string | null;
      rivalPlayerIds: ReadonlySet<string>;
      modePreference?: "all" | "150" | "200";
      trackAccess?: "unknown" | "base_only" | "base_and_bcp";
      groups?: readonly Readonly<{ groupId: string; name: string; playerIds: readonly string[] }>[];
      rankScope?: Readonly<{ global: boolean; rivals: boolean; groupIds: readonly string[] }>;
      saveRankScope?: (scope: Readonly<{ global: boolean; rivals: boolean; groupIds: readonly string[] }>) => Promise<void>;
    }>>,
  ) => Pick<MountedTimeTrialStanding, "ready" | "unmount">;
  mountCups?: (
    root: HTMLElement,
    cupsOptions?: Readonly<{
      trackHref?: (trackId: string) => string;
      engine?: EngineMode;
      onEngineChange?: (engine: EngineMode) => void;
    }>,
  ) => Pick<MountedCupsView, "ready" | "unmount">;
  mountCompare?: (
    root: HTMLElement,
    playerAId: string,
    playerBId: string | null,
    compareOptions?: Readonly<{
      initialMode?: EngineMode;
      onEngineChange?: (engine: EngineMode) => void;
    }>,
  ) => Pick<MountedPlayerComparison, "ready" | "unmount">;
  mountBuild?: (
    root: HTMLElement,
    initialQuery: string | null,
  ) => Pick<MountedBuildConfigurator, "ready" | "unmount">;
  mountCommunity?: (
    root: HTMLElement,
  ) => Pick<MountedCommunityView, "ready" | "unmount">;
  mountTournamentReport?: (
    root: HTMLElement,
    tournamentId: string,
  ) => Pick<MountedTournamentReport, "ready" | "unmount">;
  mountTournamentOperation?: typeof mountTournamentOperation;
  mountDirectorHostRequest?: (root: HTMLElement) => MountedDirectorHostRequest;
}>;

export type MountedAuthenticationProductPage = Readonly<{
  container: HTMLElement;
  status: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

/**
 * The route's query from an in-app address. The fragment is a place on the page
 * (`/?player=x#interactions`), never part of the last parameter's value.
 */
export function searchOfHref(href: string): string {
  const withoutFragment = href.split("#")[0] ?? "";
  const queryIndex = withoutFragment.indexOf("?");
  return queryIndex < 0 ? "" : withoutFragment.slice(queryIndex);
}

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function deviceName(clientId: string): string {
  return clientId === "mk8dx.timetrials.android.v1"
    ? "MK8DX Time Trials for Android"
    : clientId === "mk8dx.tournament.desktop.v1"
      ? "MK8DX Tournament Live / Processor"
      : "Windows desktop app";
}

// The reviewed product icon is shared by the tab, install manifest and Home.
const PRODUCT_ICON = "/styles/app-icon-512.png";

/** The Rank views a link may ask for, exactly those the console writes. */
function isRankTab(
  value: string | null,
): value is "total" | "medals" | "mastery" | "tracks" {
  return value === "total" || value === "medals" ||
    value === "mastery" || value === "tracks";
}

export function mountAuthenticationProductPage(
  root: HTMLElement,
  options: AuthenticationProductPageOptions = {},
): MountedAuthenticationProductPage {
  const document = root.ownerDocument;
  // The design-system factories build in this document too (the tests drive the page against their
  // own document object, the browser has exactly one).
  useDocument(document);
  const client = options.client ?? createWebAuthenticationClient();
  const pathname = options.pathname ?? globalThis.location.pathname;
  const search = options.search ?? globalThis.location.search;
  const isDevice = pathname === "/device";
  // Where the current navigation is, updated on every client-side route
  // change. Signing in returns here — the person's interrupted destination —
  // instead of dropping everyone on Home (ADR-0180 follow-up).
  let activeSearch = search;
  const currentReturnIntent = (): string | null =>
    isDevice ? null : returnIntentFromSearch(activeSearch);
  const currentCallbackURL = (): string => {
    if (isDevice) { return `/device${search}`; }
    return currentReturnIntent() ?? "/";
  };
  const mountPostTime = options.mountPostTime ?? mountPostTimeTask;
  const mountClaim = options.mountClaim ?? mountPlayerClaimSection;
  const mountWelcome = options.mountWelcome ?? mountWelcomeOnboarding;
  const mountInsights = options.mountInsights ?? mountPlayerInsightsSection;
  const mountPublicProfile = options.mountPublicProfile ?? mountPublicPlayerProfileForViewer;
  const mountAdministratorReview = options.mountAdministratorReview ??
    mountAdministratorClaimReviewSection;
  const mountLeaderboard = options.mountLeaderboard ?? mountTrackBoard;
  const mountTournamentPublication = options.mountTournamentPublication ??
    mountTournamentPublicationSection;
  const mountAdministratorTimeTrials = options.mountAdministratorTimeTrials ??
    mountAdministratorTimeTrialSection;
  const mountVisibility = options.mountPlayerVisibility ??
    mountPlayerVisibilitySettings;
  const mountTournament = options.mountPublicTournament ?? mountPublicTournament;
  const mountOperation = options.mountTournamentOperation ?? mountTournamentOperation;
  const mountHostRequest = options.mountDirectorHostRequest ?? ((root: HTMLElement) => mountDirectorHostRequest(root));
  const mountRanking = options.mountRanking ?? mountTournamentStanding;
  const mountTimeTrialRank = options.mountTimeTrialStanding ??
    mountTimeTrialStanding;
  const mountCupsSection = options.mountCups ?? mountCupsView;
  const mountCompareSection = options.mountCompare ?? mountPlayerComparison;
  const mountBuildSection = options.mountBuild ?? mountBuildConfigurator;
  const mountCommunitySection = options.mountCommunity ?? mountCommunityView;
  const mountReport = options.mountTournamentReport ?? mountTournamentReport;
  // The route's content block. The one <main> is the AppShell's (DESIGN_SYSTEM §11); this keeps
  // the legacy .tt-auth composition its unmigrated content still needs.
  const container = document.createElement("div");
  container.className = "tt-auth";

  // The product language switch, offered where a signed-out visitor is - exactly as the old
  // header did. Signed in, Settings owns the choice and the switch gives way to the account
  // controls, so the cluster never carries two ways to do the same thing.
  const languageToggle = document.createElement("span");
  languageToggle.className = "ds-language-toggle";
  languageToggle.setAttribute("role", "group");
  languageToggle.setAttribute("aria-label", "Language / Taal");
  // English and Dutch keep their buttons; the other game languages sit in one compact list beside them.
  for (const language of PRODUCT_LANGUAGES.filter((entry) => entry.code === "en" || entry.code === "nl")) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "ds-language-option";
    option.textContent = language.code.toUpperCase();
    option.setAttribute("lang", language.code);
    option.setAttribute("title", language.label);
    option.setAttribute(
      "aria-pressed", language.code === productLanguage() ? "true" : "false",
    );
    option.addEventListener("click", () => {
      if (productLanguage() !== language.code) { setProductLanguage(language.code); }
    });
    languageToggle.append(option);
  }
  const moreLanguages = document.createElement("select");
  moreLanguages.className = "ds-language-more";
  moreLanguages.setAttribute("aria-label", "More languages");
  const morePrompt = document.createElement("option");
  morePrompt.value = "";
  morePrompt.textContent = "…";
  moreLanguages.append(morePrompt);
  for (const language of PRODUCT_LANGUAGES.filter((entry) => entry.code !== "en" && entry.code !== "nl")) {
    const option = document.createElement("option");
    option.value = language.code;
    // A code like its EN/NL neighbours keeps the header within a 320 px phone ("Deutsch" plus "Anmelden"
    // pushed the sign-in button out); the full name is the option's title and the Settings picker's label.
    option.textContent = language.code.toUpperCase();
    option.title = language.label;
    option.setAttribute("lang", language.code);
    option.selected = language.code === productLanguage();
    moreLanguages.append(option);
  }
  moreLanguages.addEventListener("change", () => {
    const chosen = PRODUCT_LANGUAGES.find((entry) => entry.code === moreLanguages.value);
    if (chosen !== undefined && chosen.code !== productLanguage()) { setProductLanguage(chosen.code); }
  });
  languageToggle.append(moreLanguages);
  languageToggle.hidden = true;

  // The page's own heading and live region sit outside every route's content, so they carry the
  // design system's type and ink themselves. Without them the `/device` page's heading and status
  // inherited the wrong ink in Light (found by the Phase 12 browser gate).
  const heading = document.createElement("h1");
  heading.textContent = isDevice
    ? localized("Authorize a device", "Apparaat goedkeuren")
    : "MK8DX Player Hub";
  const status = document.createElement("p");
  status.className = "tt-auth__status";
  status.setAttribute("role", "status");
  status.textContent = "Checking your session…";
  const content = document.createElement("div");
  content.className = "tt-auth__content";
  container.append(heading, status, content);

  // Signing out and handing the browser to somebody else are different intentions, so they stay
  // different controls. The account menu and the Settings page both reach this one implementation.
  let endSession: (switching: boolean) => void = () => undefined;

  const shell: AppShellHandle = mountAppShell(root, {
    text: {
      skip: localized("Skip to content", "Naar de inhoud"),
      mode: localized("Mode", "Modus"),
      primary: localized("Primary", "Hoofdnavigatie"),
      sections: localized("Sections", "Onderdelen"),
      more: localized("More", "Meer"),
      account: localized("Account", "Account"),
      notifications: localized("Notifications", "Meldingen"),
      signIn: localized("Sign in", "Aanmelden"),
      signOut: localized("Sign out", "Afmelden"),
      switchAccount: localized("Switch account", "Ander account"),
      settings: localized("Settings", "Instellingen"),
      myStats: localized("My records & stats", "Mijn records en cijfers"),
      administration: localized("Administration", "Beheer"),
      profile: localized("My profile", "Mijn profiel"),
      apps: localized("Get the MK8DX app", "Download de MK8DX-app"),
      appsLabel: localized("Get the app", "Download de app"),
      postTime: localized("Post a time", "Tijd plaatsen"),
      brandLabel: "MK8DX Time Trials",
      back: localized("Back", "Terug"),
      close: localized("Close", "Sluiten"),
      language: "Language / Taal",
      destinations: {
        home: localized("Home", "Start"),
        tracks: localized("Tracks", "Circuits"),
        ranking: localized("Ranking", "Klassement"),
        records: localized("Records", "Records"),
        build: localized("Build", "Kart"),
        community: localized("Community", "Community"),
        tournaments: localized("Tournaments", "Toernooien"),
      },
    },
    brandAssetBase: `${GAME_ASSET_BASE}images/brand/`,
    languageToggle,
    onSignOut: () => { endSession(false); },
    onSwitchAccount: () => { endSession(true); },
  });
  // The device-approval page has no product navigation, exactly as before.
  if (isDevice) { shell.setChrome("bare"); }
  // The mark is the same drawing in both appearances; only its neutral stopwatch prints in ink on
  // Light (DESIGN_SYSTEM §2). It follows the resolved profile, which a device on System can change
  // under the page without anyone choosing anything.
  const followBrandAppearance = (): void => {
    shell.setBrandAppearance(resolvedAppearance() === "light" ? "light" : "dark");
  };
  followBrandAppearance();
  const stopAppearanceWatch = onAppearanceChange(followBrandAppearance);
  const appearanceMedia = globalThis.matchMedia?.("(prefers-color-scheme: light)");
  appearanceMedia?.addEventListener?.("change", followBrandAppearance);
  // Every route is now a design-system surface. The wrapper remains only as the stable mount point
  // used by the router and tests; it no longer selects a route palette.
  const pageShell = document.createElement("div");
  pageShell.className = "page-shell ds-root";
  pageShell.append(container);
  shell.main.append(pageShell);
  const setActiveNav = (key: ShellActive): void => { shell.setActive(key); };

  let disposed = false;
  let operation = 0;
  let controller: AbortController | null = null;
  let sessionCache: ReturnType<WebAuthenticationClient["session"]> | null =
    null;
  const loadSession = (): ReturnType<WebAuthenticationClient["session"]> => {
    if (sessionCache === null) {
      sessionCache = client.session();
      // A failed check must not poison later navigations.
      sessionCache.catch(() => { sessionCache = null; });
      void sessionCache.then((session) => {
        applyNavSession(session !== null);
      }).catch(() => undefined);
    }
    return sessionCache;
  };
  // The bootstrap already answered whether someone is signed in, so the
  // session check does not need a request of its own. Setting the cache
  // here mirrors loadSession exactly, side effect included.
  const primeSession = (authenticated: boolean): void => {
    sessionCache = Promise.resolve(authenticated ? { authenticated: true } : null);
    applyNavSession(authenticated);
  };
  // Only the two surfaces that act on it ever ask, and only once.
  let capabilitiesCache:
    ReturnType<WebAuthenticationClient["capabilities"]> | null = null;
  let installationMode: "email-link" | "offline-invitation" | "checking" | "unavailable" =
    client.installationMode === undefined ? "email-link" : "checking";
  let installationModeRequest: Promise<void> | null = null;
  const loadCapabilityDocument = async () => {
    if (capabilitiesCache === null) {
      capabilitiesCache = client.capabilities();
      capabilitiesCache.catch(() => { capabilitiesCache = null; });
    }
    return await capabilitiesCache.catch(() => null);
  };
  const loadCapabilities = async (): Promise<boolean> =>
    (await loadCapabilityDocument())?.administrator === true;
  // Shared parts are re-mounted on every navigation and would otherwise
  // re-ask for answers that had not changed.
  installResponseCache();
  let identityLoaded = false;
  let appearanceSynced = false;
  let administratorResolved = false;
  let appearanceSettings: Readonly<{ unmount(): void }> | null = null;

  const applyNavSession = (signedIn: boolean): void => {
    if (isDevice || disposed) { return; }
    shell.setSignedIn(signedIn);
    if (!signedIn) {
      identityLoaded = false;
      administratorResolved = false;
      shell.setIdentity(null);
      shell.setUnread(0);
      shell.setAdministrator(false);
      return;
    }
    // The host throttles at roughly five requests per second per IP
    // (ADR-0159), and anything over that waits about a second. The unread
    // badge is chrome, not page content, so it gives up its slot in the first
    // burst and asks once the page's own data has settled.
    const refreshUnreadBadge = (): void => {
      void createNotificationClient().inbox().then((inbox) => {
        if (!disposed) { shell.setUnread(inbox.unreadCount); }
      }).catch(() => undefined);
    };
    // requestIdleCallback fires as soon as the main thread is free, which is
    // still inside the opening burst, so the wait is explicit: one full second
    // puts the badge in the next throttling window rather than competing with
    // the page's own data for the same five slots.
    globalThis.setTimeout(() => { if (!disposed) { refreshUnreadBadge(); } }, 1_100);
    // Administration is offered in the account menu only to an account that has it. That answer is
    // cached for the page lifetime and asked for in the same settled window as the badge, so the
    // menu never costs the opening burst one of its five slots.
    if (!administratorResolved) {
      administratorResolved = true;
      globalThis.setTimeout(() => {
        if (disposed) { return; }
        void loadCapabilities().then((administrator) => {
          if (!disposed) { shell.setAdministrator(administrator); }
        }).catch(() => undefined);
      }, 1_100);
    }
    // The account is canonical for the appearance choice (ADR-0205). It is asked once per page,
    // in the same settled window as the badge, and applies without a transition.
    if (!appearanceSynced) {
      appearanceSynced = true;
      globalThis.setTimeout(() => {
        if (!disposed) { void syncAppearanceWithAccount().catch(() => undefined); }
      }, 1_100);
    }
    if (identityLoaded) { return; }
    // "I am signed in as Bas": the verified Player identity (never the
    // email or account id) with the chosen character, linking to the
    // Player's own profile.
    //
    // Resolving it costs two requests - the claim set, then the Player - and
    // it was doing so in the opening burst of every single page, taking two of
    // the five slots the host allows per second before any page content moved.
    // Who you are signed in as is the most stable fact the page knows, so it is
    // remembered: the chip paints from the remembered identity immediately and
    // the truth is re-read once the page's own data has settled. A changed
    // display name or character therefore appears a second later than before,
    // on a chip that was previously blank for that whole second anyway.
    const paintIdentity = (identity: Readonly<{
      username: string; displayName: string; avatarId?: string;
    }>): void => {
      const appearance = avatarAppearance(identity.avatarId);
      shell.setIdentity({
        displayName: identity.displayName,
        href: `/?player=${encodeURIComponent(identity.username)}`,
        ...(appearance === undefined
          ? {}
          : { avatarSrc: `${GAME_ASSET_BASE}${appearance.iconPath}` }),
      });
    };
    const remembered = readNavIdentity();
    if (remembered !== null) { identityLoaded = true; paintIdentity(remembered); }
    const resolveIdentity = (): void => {
      void createPlayerClaimClient().listMine().then(async (claims) => {
        const playerId = claims.find(
          (candidate) => candidate.claimStatus === "verified",
        )?.playerId ?? null;
        if (playerId === null || disposed) {
          if (playerId === null) { forgetNavIdentity(); }
          return;
        }
        const player = await createPublicPlayerClient().load(playerId);
        if (disposed) { return; }
        const identity = {
          username: player.username,
          displayName: player.displayName,
          ...(player.avatarId === undefined ? {} : { avatarId: player.avatarId }),
        };
        rememberNavIdentity(identity);
        paintIdentity(identity);
        identityLoaded = true;
      }).catch(() => undefined);
    };
    if (remembered === null) { resolveIdentity(); return; }
    globalThis.setTimeout(() => { if (!disposed) { resolveIdentity(); } }, 1_100);
  };
  // Public pages never probe the session; the Me area lights up once a
  // session-requiring page has resolved it (and stays cached after that).
  // (identity helpers live above; see readRememberedIdentity)
  const refreshNavSession = (): void => {
    if (isDevice || sessionCache === null) { return; }
    void sessionCache.then((session) => {
      applyNavSession(session !== null);
    }).catch(() => undefined);
  };
  let notificationPushSettings: Readonly<{ ready: Promise<void>; unmount(): void }> | null = null;
  let postTime: Pick<MountedPostTimeTask, "unmount" | "heading"> | null = null;
  let claim: Pick<MountedPlayerClaimSection, "ready" | "unmount"> | null = null;
  let welcome: Pick<MountedWelcomeOnboarding, "ready" | "unmount"> | null = null;
  let insights: Pick<MountedPlayerInsightsSection, "ready" | "unmount"> | null = null;
  let publicProfile: Pick<MountedPublicPlayerProfile, "ready" | "unmount"> | null = null;
  let administratorReview: Pick<
    MountedAdministratorClaimReviewSection,
    "ready" | "unmount"
  > | null = null;
  let administratorOverview: MountedAdministratorOverviewSection | null = null;
  let administratorInstallations:
    ReturnType<typeof mountAdministratorClientInstallationSection> | null = null;
  let administratorIdentityLinks:
    Pick<MountedAdministratorIdentityLinkSection, "ready" | "unmount"> | null = null;
  let administratorObservedIdentities:
    Pick<MountedObservedIdentitySection, "ready" | "unmount"> | null = null;
  let leaderboard: Pick<MountedTrackBoard, "ready" | "unmount"> | null = null;
  let ranking: Pick<MountedRatingLeaderboard, "ready" | "unmount"> | null = null;
  let timeTrialStanding: Pick<
    MountedTimeTrialStanding,
    "ready" | "unmount"
  > | null = null;
  let cups: Pick<MountedCupsView, "ready" | "unmount"> | null = null;
  let comparison: Pick<MountedPlayerComparison, "ready" | "unmount"> | null = null;
  let build: Pick<MountedBuildConfigurator, "ready" | "unmount"> | null = null;
  let activityFeed: Pick<MountedActivityStories, "ready" | "unmount"> | null = null;
  let notifications: Pick<MountedNotificationSection, "ready" | "unmount"> | null = null;
  let profilePreferenceSettings: Readonly<{ unmount(): void }> | null = null;
  let rivalSettings: Pick<MountedRivalSettings, "unmount"> | null = null;
  let followSettings: Pick<MountedRivalSettings, "unmount"> | null = null;
  let socialGroupSettings: Pick<MountedSocialGroupSettings, "unmount"> | null = null;
  let accountTimeTrialSettings: Readonly<{ unmount(): void }> | null = null;
  let webPushSettings: Readonly<{ unmount(): void }> | null = null;
  let community: Pick<MountedCommunityView, "ready" | "unmount"> | null = null;
  let records: Pick<MountedRecordsView, "ready" | "unmount"> | null = null;
  let appDownloads: Pick<MountedAppDownloads, "ready" | "unmount"> | null = null;
  let homeHero: Pick<MountedHome, "ready" | "unmount"> | null = null;
  let signedOutHome: Pick<MountedHome, "ready" | "unmount"> | null = null;
  let tournamentPublication: Pick<
    MountedTournamentPublicationSection,
    "ready" | "unmount"
  > | null = null;
  let tournamentCanonicalImport: Pick<
    MountedTournamentCanonicalImportSection,
    "unmount"
  > | null = null;
  let administratorTimeTrials: Pick<
    MountedAdministratorTimeTrialSection,
    "ready" | "unmount"
  > | null = null;
  let playerVisibility: Pick<
    MountedPlayerVisibilitySettings,
    "ready" | "unmount"
  > | null = null;
  let publicTournament: Pick<MountedPublicTournament, "ready" | "unmount"> | null = null;
  let tournaments: Pick<MountedTournamentsView, "ready" | "unmount"> | null = null;
  let tournamentOperation: Pick<MountedTournamentOperation, "ready" | "unmount"> | null = null;
  let tournamentReport: Pick<MountedTournamentReport, "ready" | "unmount"> | null = null;
  let ratingAdministration: Pick<MountedRatingAdministrationSection, "ready" | "unmount"> | null = null;
  let administratorAliases: Pick<MountedAdministratorAliasSection, "unmount"> | null = null;
  let profileAliases: MountedProfileAliasSection | null = null;
  let tournamentRemoval: MountedAdministratorTournamentRemovalSection | null = null;
  let tournamentOperatorAccess: MountedTournamentOperatorAccess | null = null;
  let installationSettings: MountedInstallationSettingsSection | null = null;
  let hostRequest: MountedDirectorHostRequest | null = null;
  /**
   * A context bar the route itself supplies (W17's operator door). The shell's own rule answers a
   * mode from the address; this answers a role the address cannot see, and it is cleared with the
   * route that set it so it can never outlive its page.
   */
  let routeContextNode: HTMLElement | null = null;

  const unmountProduct = (): void => {
    // The docked action belongs to the route that armed it (T-DOCK): leaving Home or the track page
    // returns the dock to the shell's own rule.
    shell.setDock(null);
    routeContextNode = null;
    signedOutHome?.unmount();
    signedOutHome = null;
    notificationPushSettings?.unmount();
    notificationPushSettings = null;
    claim?.unmount();
    welcome?.unmount();
    insights?.unmount();
    postTime?.unmount();
    publicProfile?.unmount();
    administratorReview?.unmount();
    tournamentCanonicalImport?.unmount();
    leaderboard?.unmount();
    ranking?.unmount();
    timeTrialStanding?.unmount();
    cups?.unmount();
    comparison?.unmount();
    build?.unmount();
    activityFeed?.unmount();
    notifications?.unmount();
    profilePreferenceSettings?.unmount();
    accountTimeTrialSettings?.unmount();
    appearanceSettings?.unmount();
    appearanceSettings = null;
    webPushSettings?.unmount();
    rivalSettings?.unmount();
    followSettings?.unmount();
    socialGroupSettings?.unmount();
    community?.unmount();
    records?.unmount();
    appDownloads?.unmount();
    homeHero?.unmount();
    tournamentPublication?.unmount();
    administratorTimeTrials?.unmount();
    playerVisibility?.unmount();
    publicTournament?.unmount();
    tournaments?.unmount();
    tournamentOperation?.unmount();
    tournamentReport?.unmount();
    ratingAdministration?.unmount();
    administratorAliases?.unmount();
    administratorObservedIdentities?.unmount();
    tournamentOperatorAccess?.unmount();
    installationSettings?.unmount();
    hostRequest?.unmount();
    hostRequest = null;
    tournaments = null;
    tournamentOperation = null;
    tournamentReport = null;
    ratingAdministration = null;
    administratorAliases = null;
    administratorObservedIdentities = null;
    tournamentOperatorAccess = null;
    installationSettings = null;
    administratorTimeTrials = null;
    playerVisibility = null;
    ranking = null;
    timeTrialStanding = null;
    cups = null;
    comparison = null;
    build = null;
    activityFeed = null;
    notifications = null;
    profilePreferenceSettings = null;
    accountTimeTrialSettings = null;
    webPushSettings = null;
    rivalSettings = null;
    followSettings = null;
    socialGroupSettings = null;
    community = null;
    records = null;
    homeHero = null;
    claim = null;
    welcome = null;
    insights = null;
    postTime = null;
    publicProfile = null;
    administratorReview = null;
    leaderboard = null;
    tournamentPublication = null;
    publicTournament = null;
  };

  // Tournaments are first-class: the list and every event page are public,
  // the operation board is administrator-only and re-authorized server-side.
  const renderTournaments = async (eventId: string | null, operate: boolean, directorUserAccountId: string | null): Promise<void> => {
    setActiveNav("tournaments");
    unmountProduct();
    clear(content);
    // One bootstrap answers the shared chrome (session, notifications,
    // claims, own Player) so this page costs a handful of requests instead
    // of a six-request burst against the hosting limit (ADR-0159).
    const extras = await primeFromBootstrap().catch(() => null);
    if (disposed) { return; }
    if (extras !== null) { primeSession(extras.authenticated); }
    // Capabilities are only asked for a signed-in visitor: an anonymous
    // probe would cost a request and log a 401 for nothing.
    const session = await loadSession().catch(() => null);
    if (disposed) { return; }
    const capabilities = session === null ? null : await loadCapabilityDocument();
    const administrator = capabilities?.administrator === true;
    // A delegated Tournament operator is exactly the person who runs a
    // race night. The server already grants them the capability and
    // reports it here; this page used to admit administrators only, so
    // the grant did nothing on the Web.
    const mayOperate = administrator || capabilities?.tournamentOperation === true;
    if (disposed) { return; }
    // A past edition served from the history has no operation console: the
    // link with operate=1 lands on its public page instead of "not found".
    if (operate && !(eventId !== null && isHistoryEditionId(eventId))) {
      if (session === null) { renderSignIn(); return; }
      heading.textContent = "";
      heading.hidden = true;
      status.textContent = "";
      status.hidden = true;
      if (!mayOperate) {
        status.hidden = false;
        status.textContent = localized(
          "Only Directors run Tournament nights. You can ask to host on the Tournaments page.",
          "Alleen Directeuren draaien toernooiavonden. Op de Toernooien-pagina kun je vragen om te hosten.",
        );
        return;
      }
      status.textContent = "";
      const operationRoot = document.createElement("div");
      content.append(operationRoot);
      tournamentOperation = mountOperation(operationRoot, {
        tournamentId: eventId,
        directorUserAccountId,
        administrator,
        onNavigate: (href) => {
          globalThis.history?.pushState?.(null, "", href);
          void renderForSearch(searchOfHref(href));
        },
      });
      await tournamentOperation.ready;
      return;
    }
    // W17/W19-W21 on the design system (Phase 11): the hero carries the page's own name and line,
    // so the frame's heading and status are not printed a second time above it.
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const tournamentsRoot = document.createElement("div");
    content.append(tournamentsRoot);
    const operator = capabilities?.tournamentOperation === true;
    // Everyone who is not running the night still wants to know whether they
    // are in it. The claim lookup is the same one the feed uses and is cached.
    const viewer = await feedViewerPlayerId().catch(() => null);
    // ADR-0220: a signed-in account that is not a Director reads how to become one and may ask.
    // Administrators and Directors never see it; the server's answer decides as well.
    const hostRequestRoot = eventId === null && session !== null && !administrator && !operator
      ? document.createElement("div")
      : null;
    tournaments = eventId === null
      ? mountTournamentsList(tournamentsRoot, undefined, {
        administrator,
        operator,
        viewerPlayerId: viewer,
        ...(hostRequestRoot === null ? {} : { hostRequestRoot }),
        // Running the night is a role, and a role is answered by the shell's context bar rather
        // than by a button above everybody else's list (SCREEN_MIGRATION_MATRIX W17).
        onContextBar: (node) => { routeContextNode = node; },
      })
      : mountTournamentEvent(tournamentsRoot, eventId, undefined, { administrator, operator });
    if (hostRequestRoot !== null) { hostRequest = mountHostRequest(hostRequestRoot); }
    await tournaments.ready;
  };

  const renderTournamentReport = async (tournamentId: string): Promise<void> => {
    setActiveNav("tournaments");
    if (!await requireSession()) { return; }
    unmountProduct(); clear(content);
    heading.textContent = ""; heading.hidden = true;
    status.textContent = ""; status.hidden = true;
    const reportRoot = document.createElement("div"); content.append(reportRoot);
    tournamentReport = mountReport(reportRoot, tournamentId);
    await tournamentReport.ready;
  };

  // W22 on the design system (Phase 12); OD-04 keeps its safe default — the old publication view
  // stays reachable and keeps its own "Segment N" vocabulary.
  const renderPublicTournament = async (publicationId: string): Promise<void> => {
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const tournamentRoot = document.createElement("div");
    content.append(tournamentRoot);
    publicTournament = mountTournament(tournamentRoot, publicationId);
    await publicTournament.ready;
  };

  // W06 on the design system (Phase 12). The directory resolves the engine once (R4) so its track
  // links carry it instead of dropping the reader back on 150, and the choice is written into the
  // address the same way every other migrated route writes it.
  const renderCups = async (requestedMode: EngineMode | null): Promise<void> => {
    setActiveNav("tracks");
    let mode: EngineMode = requestedMode ?? 150;
    if (requestedMode === null) {
      const session = await loadSession().catch(() => null);
      const preference = session === null ? null : await readViewerEnginePreference();
      if (disposed) { return; }
      mode = resolveEngineMode({ preference }).mode;
    }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const cupsRoot = document.createElement("div");
    content.append(cupsRoot);
    cups = mountCupsSection(cupsRoot, {
      engine: mode,
      onEngineChange: (next) => {
        const url = new URL(window.location.href);
        url.searchParams.set("mode", String(next));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        activeSearch = url.search;
        shell.setSignInHref(signInHref(currentReturnIntent()));
      },
    });
    await cups.ready;
  };

  // W13 on the design system (Phase 12): the route draws `.ds-root` and carries its own heading.
  const renderRecords = async (): Promise<void> => {
    setActiveNav("records");
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const recordsRoot = document.createElement("div");
    content.append(recordsRoot);
    records = mountRecordsView(recordsRoot);
    await records.ready;
  };

  const renderApps = async (): Promise<void> => {
    setActiveNav("apps");
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const page = document.createElement("div");
    page.className = "ds-root ds-apps ds-stack";
    page.setAttribute("data-spectacle", "low");
    const title = document.createElement("h1");
    title.className = "ds-display-3";
    title.textContent = localized("Get the MK8DX apps", "Download de MK8DX-apps");
    const intro = document.createElement("p");
    intro.className = "ds-apps__intro ds-body-m";
    intro.textContent = localized(
      "Install MK8DX on your phone or PC. Downloads stay private to signed-in community members.",
      "Installeer MK8DX op je telefoon of pc. Downloads blijven privé voor aangemelde communityleden.",
    );
    const appsRoot = document.createElement("div");
    page.append(title, intro, appsRoot);
    content.append(page);
    // The catalog and binaries are intentionally account-protected. Avoid
    // probing the protected endpoint for anonymous visitors: the session is
    // already being resolved for the shared navigation and a guaranteed 401
    // only spends one of the host's small per-IP dynamic-request budget.
    const session = await loadSession().catch(() => null);
    if (disposed) { return; }
    if (session === null) {
      const prompt = document.createElement("section");
      prompt.className = "ds-panel ds-apps__signed-out";
      const message = document.createElement("p");
      message.setAttribute("role", "status");
      message.textContent = localized(
        "Sign in to download the MK8DX apps.",
        "Meld je aan om de MK8DX-apps te downloaden.",
      );
      const signIn = document.createElement("a");
      signIn.className = "ds-button ds-slant";
      signIn.setAttribute("data-variant", "primary");
      signIn.setAttribute("data-size", "md");
      // Signing in brings the person back to this download offer.
      signIn.setAttribute("href", signInHref("/?apps=1"));
      signIn.textContent = localized("Sign in", "Aanmelden");
      prompt.append(message, signIn);
      appsRoot.append(prompt);
      return;
    }
    appDownloads = mountAppDownloadsView(appsRoot);
    await appDownloads.ready;
  };

  // W15 on the design system (Phase 12).
  const renderCommunity = async (): Promise<void> => {
    setActiveNav("community");
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const communityRoot = document.createElement("div");
    content.append(communityRoot);
    community = mountCommunitySection(communityRoot);
    await community.ready;
  };

  const renderBuild = async (query: string): Promise<void> => {
    setActiveNav("build");
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const buildRoot = document.createElement("div");
    content.append(buildRoot);
    build = mountBuildSection(
      buildRoot,
      query === "1" || query === "" ? null : query,
    );
    await build.ready;
  };

  const renderCompare = async (
    playerAId: string,
    playerBId: string | null,
    requestedMode: EngineMode | null,
  ): Promise<void> => {
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    // Compare is competitive by intent: a compact Add rival / Remove
    // rival control for every OTHER Player in the comparison (Follow
    // stays on the profile and in Settings). Non-blocking enrichment -
    // the public comparison renders without waiting on the session.
    const rivalControls = document.createElement("div");
    rivalControls.className = "profile-controls";
    content.append(rivalControls);
    // "Add as rival" is a control beside the comparison, not the comparison.
    // Resolving it costs the claim set, the rival list and the other Player's
    // name, and it was doing so in the same second as the head-to-head and both
    // Players' track bests - eight requests against a five-per-second budget,
    // so three of them waited a second and the comparison waited with them.
    // It now resolves once the comparison has had the window to itself.
    globalThis.setTimeout(() => {
    if (disposed) { return; }
    void loadSession().then(async (session) => {
      if (session === null || disposed) { return; }
      const claims = await createPlayerClaimClient().listMine()
        .catch(() => []);
      const ownPlayerId = claims.find(
        (candidate) => candidate.claimStatus === "verified",
      )?.playerId ?? null;
      if (ownPlayerId === null || disposed) { return; }
      const others = [playerAId, playerBId].filter(
        (candidate): candidate is string =>
          candidate !== null && candidate !== ownPlayerId);
      if (others.length === 0) { return; }
      const rivalClient = createRivalClient();
      const rivals = await rivalClient.list().catch(() => []);
      if (disposed) { return; }
      for (const otherId of others) {
        const name = await createPublicPlayerClient().load(otherId)
          .then((player) => player.displayName)
          .catch(() => otherId.replace("player.", ""));
        if (disposed) { return; }
        const button = document.createElement("button");
        button.type = "button";
        let active = rivals.some((entry) => entry.playerId === otherId);
        const paint = (): void => {
          button.className = "tt-auth__button profile-controls__button";
          button.setAttribute("aria-pressed", active ? "true" : "false");
          button.textContent = active
            ? `Rival ✓ ${name}`
            : `Add ${name} as rival`;
        };
        paint();
        button.addEventListener("click", () => {
          button.disabled = true;
          const action = active
            ? rivalClient.remove(otherId)
            : rivalClient.add(otherId);
          action.then(() => { active = !active; }).catch(() => undefined)
            .then(() => {
              if (!disposed) { paint(); button.disabled = false; }
            });
        });
        rivalControls.append(button);
      }
    }).catch(() => undefined);
    }, 1_100);
    const compareRoot = document.createElement("div");
    content.append(compareRoot);
    // W12 on the design system (Phase 12): ONE EngineSelector, and the address carries the engine
    // on every change so a comparison can be shared at the engine class it was read at (R6).
    // The view resolves the engine itself (a link's `mode`, else the viewer's single-engine
    // preference, else 150) without blocking the mount, and reports it: the address then carries
    // the resolved engine and every later change, exactly as the track board does (R4/R6).
    comparison = mountCompareSection(compareRoot, playerAId, playerBId, {
      ...(requestedMode === null ? {} : { initialMode: requestedMode }),
      onEngineChange: (next) => {
        const url = new URL(window.location.href);
        url.searchParams.set("mode", String(next));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        activeSearch = url.search;
        shell.setSignInHref(signInHref(currentReturnIntent()));
      },
    });
    await comparison.ready;
  };

  const renderRanking = async (
    section: string,
    initialView: TimeTrialRankInitialView = {},
    /**
     * Whose Tournament standing to open on. A profile links here so somebody
     * can read another Player's skill, tracks and rivalries, not only their
     * own - which is what `?player=` on this route means.
     */
    focusReference: string | null = null,
  ): Promise<void> => {
    setActiveNav("ranking");
    unmountProduct();
    clear(content);
    heading.classList.add("ds-page-title--ranking");
    status.classList.add("ds-page-status--ranking");
    const showTournament = section === "tournament";
    heading.textContent = showTournament
      ? localized("Tournament skill & competitors", "Toernooiniveau & concurrenten")
      : localized("Time Trial standing & Mastery", "Time Trial-stand & Mastery");
    status.textContent = showTournament
      ? localized(
        "TrueSkill, race record and head-to-head across finalized tournaments",
        "TrueSkill, raceresultaten en onderlinge duels in afgeronde toernooien",
      )
      : localized(
        "Public Base 48, BCP 48 and All 96 standings with direct comparisons.",
        "Openbare standen voor Basis 48, BCP 48 en Alle 96 met directe vergelijkingen.",
      );
    const subnav = document.createElement("nav");
    subnav.className = "subnav subnav--ranking";
    subnav.setAttribute("aria-label", "Ranking sections");
    const timeTrialsTab = document.createElement("a");
    timeTrialsTab.className = "subnav__tab";
    if (!showTournament) { timeTrialsTab.setAttribute("aria-current", "page"); }
    timeTrialsTab.href = "/?ranking=timetrials";
    timeTrialsTab.textContent = "Time Trials";
    const tournamentTab = document.createElement("a");
    tournamentTab.className = "subnav__tab";
    if (showTournament) { tournamentTab.setAttribute("aria-current", "page"); }
    tournamentTab.href = "/?ranking=tournament";
    // The tab is no longer only a rating list, so it stops calling itself one.
    tournamentTab.textContent = "Tournament";
    subnav.append(timeTrialsTab, tournamentTab);
    const rankingRoot = document.createElement("div");
    content.append(subnav, rankingRoot);
    if (showTournament) {
      // Who is looking and who they follow decide what the Tournament tab opens
      // on: yourself against your rivals. Both are handed over unresolved so a
      // signed-out visitor still gets the standing without waiting on a session.
      const viewerPlayerId = loadSession().then(async (session) => {
        if (session === null) { return null; }
        const claims = await createPlayerClaimClient().listMine().catch(() => []);
        return claims.find(
          (candidate) => candidate.claimStatus === "verified",
        )?.playerId ?? null;
      }).catch(() => null);
      const rivalPlayerIds = loadSession().then(async (session) => {
        if (session === null) { return new Set<string>(); }
        const list = await createRivalClient().list().catch(() => []);
        return new Set(list.map((candidate) => candidate.playerId));
      }).catch(() => new Set<string>());
      ranking = options.mountRanking !== undefined
        ? mountRanking(rankingRoot)
        : mountTournamentStanding(
            rankingRoot,
            createTournamentStandingClient(),
            viewerPlayerId,
            rivalPlayerIds,
            createTournamentTrackClient(),
            focusReference,
          );
      await ranking.ready;
      return;
    }
    // Rank consumes claims/focus in addition to its own standing. Prime those
    // account sections from the aggregate bootstrap so this page stays within
    // the hosting per-IP dynamic-request budget.
    const extras = await primeFromBootstrap().catch(() => null);
    if (extras !== null) { primeSession(extras.authenticated); }
    const context = loadSession().then(async (session) => {
      if (session === null) {
        return { viewerPlayerId: null, rivalPlayerIds: new Set<string>() };
      }
      const socialClient = createSocialGroupClient();
      const focusController = new AbortController();
      const [claims, rivals, socialGroups, focus, comeback] = await Promise.all([
        createPlayerClaimClient().listMine().catch(() => []),
        createRivalClient().list().catch(() => []),
        socialClient.list().catch(() => null),
        fetchFocusRows(focusController.signal).catch(() => null),
        fetchComeback(focusController.signal).catch(() => null),
      ]);
      return {
        viewerPlayerId: claims.find(
          (candidate) => candidate.claimStatus === "verified",
        )?.playerId ?? null,
        rivalPlayerIds: new Set(rivals.map((candidate) => candidate.playerId)),
        modePreference: focus?.modePreference ?? "all",
        trackAccess: focus?.trackAccess ?? "unknown",
        focusRows: focus?.rows ?? [],
        ...(comeback === null ? {} : {
          standing: {
            standing: comeback.timeTrials.standing,
            of: comeback.timeTrials.of,
            ...(comeback.timeTrials.previousStanding === undefined
              ? {}
              : { previousStanding: comeback.timeTrials.previousStanding }),
          },
        }),
        groups: socialGroups?.groups.filter((group) => group.myStatus === "active").map((group) => ({
          groupId: group.groupId,
          name: group.name,
          playerIds: group.members.filter((member) => member.status === "active").map((member) => member.playerId),
        })) ?? [],
        ...(socialGroups === null ? {} : {
          rankScope: socialGroups.rankScope,
          saveRankScope: (scope: typeof socialGroups.rankScope) => socialClient.saveRankScope(scope),
        }),
      };
    });
    timeTrialStanding = options.mountTimeTrialStanding !== undefined
      ? mountTimeTrialRank(rankingRoot, context)
      : mountTimeTrialStanding(
        rankingRoot,
        context,
        fetchTimeTrialStandings,
        initialView,
      );
    await timeTrialStanding.ready;
  };

  const renderLeaderboard = async (
    trackId: string,
    requestedMode: EngineMode | null,
    focusResultId: string | null = null,
  ): Promise<void> => {
    setActiveNav("tracks");
    // EngineContext (R4): a link without an engine resolves it here - the signed-in viewer's
    // single-engine preference, otherwise 150 - and the address then carries it (R6).
    let mode: EngineMode = requestedMode ?? 150;
    if (requestedMode === null) {
      const session = await loadSession().catch(() => null);
      const preference = session === null ? null : await readViewerEnginePreference();
      if (disposed) { return; }
      mode = resolveEngineMode({ preference }).mode;
      const url = new URL(window.location.href);
      url.searchParams.set("mode", String(mode));
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const leaderboardRoot = document.createElement("div");
    content.append(leaderboardRoot);
    // W07 on the design system (Phase 9). One page, one engine selector: the board, the references,
    // the Player's PB, the gap, the cup links and the entry action all follow the same EngineContext,
    // and an engine switch rewrites the address rather than reloading the route. Entry stays the ONE
    // canonical task (POST_A_TIME §9), opened on this exact track and engine class.
    const boardOptions: TrackBoardOptions = {
      client: createPublicTimeTrialClient(),
      claimClient: {
        async listMine(signal) {
          const session = await loadSession().catch(() => null);
          return session === null ? [] : createPlayerClaimClient().listMine(signal);
        },
      },
      signedIn: async () => await loadSession().catch(() => null) !== null,
      signInHref,
      ...(focusResultId === null ? {} : { focusResultId }),
      onPrimaryAction: (node, postHref, label) => { shell.setDock({ watch: node, href: postHref, label }); },
      onEngineChange: (next) => {
        const url = new URL(window.location.href);
        url.searchParams.set("mode", String(next));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        activeSearch = url.search;
        shell.setSignInHref(signInHref(currentReturnIntent()));
      },
    };
    leaderboard = mountLeaderboard(leaderboardRoot, trackId, mode, boardOptions);
    await leaderboard.ready;
  };

  /**
   * The canonical Post-a-Time task (W08). `?post=1` opens the shared Tracks & Cups chooser; `?post=
   * track.x&mode=150` opens it on that track. The engine comes from the address, else EngineContext
   * - never a fixed 150 (R4).
   */
  const renderPostTime = async (
    trackQuery: string,
    requestedMode: EngineMode | null,
  ): Promise<void> => {
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const trackId = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(trackQuery) ? trackQuery : null;
    const session = await loadSession().catch(() => null);
    if (disposed) { return; }
    if (session === null) {
      heading.hidden = false;
      status.hidden = false;
      heading.textContent = localized("Post a time", "Tijd plaatsen");
      const prompt = document.createElement("p");
      const link = document.createElement("a");
      link.className = "tt-auth__link";
      link.setAttribute("href", signInHref(activeSearch === "" ? "/?post=1" : `/${activeSearch}`));
      link.textContent = localized(
        "Sign in to post a time", "Meld je aan om een tijd te plaatsen",
      );
      prompt.append(link);
      content.append(prompt);
      return;
    }
    const playerId = await verifiedPlayerId().catch(() => null);
    if (disposed) { return; }
    const mode: EngineMode = requestedMode ??
      resolveEngineMode({ preference: await readViewerEnginePreference().catch(() => null) }).mode;
    if (disposed) { return; }
    const taskRoot = document.createElement("div");
    content.append(taskRoot);
    const scannerHome = scannerBase(document);
    const handoff = trackId === null ? null : takeSessionScanHandoff(trackId);
    postTime = mountPostTime(taskRoot, {
      trackId,
      mode: handoff?.mode ?? mode,
      playerId: playerId ?? "player.unclaimed",
      boardClient: createPostTimeBoardClient(),
      // The optional YouTube link is attached to the result right after it is published.
      videoClient: createTimeTrialLifecycleClient(),
      scanHref: scannerHome,
      // One mapping from what a producer read into this draft (the scan service, ADR-0206).
      ...(handoff === null ? {} : { scanFill: scanFillFromHandoff(handoff) }),
      onScan: (): void => {
        const at = globalThis.location;
        const current = new URLSearchParams(activeSearch).get("post");
        if (scannerHome === null || at === undefined || current === null ||
          !/^track\./.test(current)) {
          return;
        }
        // ScanSourcePicker first, so the camera opens on the screen the Player actually has and
        // never asks again. The draft stays in session storage and is waiting on the way back.
        openScanSourcePicker({
          onChoose: (source) => {
            at.assign(scannerHref(
              scannerHome, current,
              (new URLSearchParams(activeSearch).get("mode") === "200" ? 200 : 150),
              `${at.pathname}${at.search}`,
              source,
              trackLapCount(current),
            ));
          },
        });
      },
      onTrackChosen: (chosen): void => {
        const url = `/?post=${encodeURIComponent(chosen)}&mode=${mode}`;
        activeSearch = url.slice(1);
        globalThis.history?.replaceState?.(null, "", url);
      },
      onModeChanged: (chosen): void => {
        const query = new URLSearchParams(activeSearch);
        query.set("mode", String(chosen));
        activeSearch = `?${query.toString()}`;
        globalThis.history?.replaceState?.(null, "", `/${activeSearch}`);
      },
      onComplete: (): void => {
        globalThis.history?.pushState?.(null, "", "/");
        void renderForSearch("");
      },
    });
  };

  const renderPublicProfile = async (
    reference: string,
    tab: "overview" | "timetrials" | "mastery",
  ): Promise<void> => {
    // `/?player=nola` is the shareable form; `/?player=player.<uuid>` stays
    // valid so no link ever written down stops working.
    const playerId = isPlayerId(reference)
      ? reference
      : await resolvePlayerReference(reference).catch(() => null);
    if (disposed) { return; }
    if (playerId === null) {
      setActiveNav(null);
      unmountProduct();
      clear(content);
      heading.textContent = localized("Player not found", "Speler niet gevonden");
      status.textContent = localized(
        `No Player races under the name "${reference}".`,
        `Er rijdt geen speler onder de naam "${reference}".`,
      );
      return;
    }
    // The profile view of the same one-request bootstrap: the shared parts
    // every page shows, plus this Player's rating, career and aliases.
    const extras = await primeFromBootstrap(playerId).catch(() => null);
    // Arriving by identifier rewrites the address to the name, so what the
    // visitor sees, shares or copies is `?player=nola` rather than a UUID.
    if (reference === playerId && pathname === "/") {
      void createPublicPlayerClient().load(playerId).then((player) => {
        if (disposed || player.username.length === 0) { return; }
        const tabValue = tab === "overview" ? "" : `&tab=${tab}`;
        globalThis.history?.replaceState?.(
          null, "", `/?player=${encodeURIComponent(player.username)}${tabValue}`,
        );
      }).catch(() => undefined);
    }
    if (extras !== null && !disposed) { primeSession(extras.authenticated); }
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const compare = dsButton({
      label: "Compare with another Player",
      variant: "quiet",
      href: `/?compare=${encodeURIComponent(playerId)}`,
    });
    const controlsRow = document.createElement("div");
    controlsRow.className = "ds-root ds-profile-actions ds-cluster";
    controlsRow.setAttribute("data-gap", "sm");
    controlsRow.append(compare.root);
    const profileRoot = document.createElement("div");
    content.append(controlsRow, profileRoot);
    // Follow/Rival controls: private preferences of the signed-in
    // viewer about this Player. Never shown on the own profile; the
    // viewed Player is not notified either way. The public profile
    // render never WAITS on this: the session check runs as a
    // non-blocking enrichment after the public first render, and an
    // anonymous visitor sees exactly the public profile.
    void loadSession().then(async (session) => {
      if (session === null || disposed) { return; }
      const claims = await createPlayerClaimClient().listMine()
        .catch(() => []);
      const ownPlayerId = claims.find(
        (candidate) => candidate.claimStatus === "verified",
      )?.playerId ?? null;
      if (ownPlayerId === playerId && !disposed) {
        mountScanTestSection(profileRoot, playerId);
        return;
      }
      if (ownPlayerId === null || disposed) {
        return;
      }
      const followClient = createFollowClient();
      const rivalClient = createRivalClient();
      const [follows, rivals] = await Promise.all([
        followClient.list().catch(() => []),
        rivalClient.list().catch(() => []),
      ]);
      if (disposed) { return; }
      const toggleButton = (
        labels: Readonly<{ off: string; on: string }>,
        client: Readonly<{
          add(id: string): Promise<void>;
          remove(id: string): Promise<void>;
        }>,
        active: boolean,
      ): HTMLElement => {
        const action = dsButton({
          label: active ? labels.on : labels.off,
          variant: "quiet",
        });
        let state = active;
        const paint = (): void => {
          action.control.setAttribute("aria-pressed", state ? "true" : "false");
          const label = action.control.querySelector(".ds-button__label");
          if (label !== null) { label.textContent = state ? labels.on : labels.off; }
        };
        paint();
        action.control.addEventListener("click", () => {
          action.setDisabled("Updating…");
          const request = state
            ? client.remove(playerId)
            : client.add(playerId);
          request.then(() => { state = !state; }).catch(() => undefined)
            .then(() => {
              if (!disposed) { paint(); action.setDisabled(null); }
            });
        });
        return action.root;
      };
      controlsRow.append(
        toggleButton(
          { off: "Follow", on: "Following" },
          {
            add: (id) => followClient.add(id),
            remove: (id) => followClient.remove(id),
          },
          follows.some((entry) => entry.playerId === playerId),
        ),
        toggleButton(
          { off: "Add rival", on: "Rival ✓" },
          {
            add: (id) => rivalClient.add(id),
            remove: (id) => rivalClient.remove(id),
          },
          rivals.some((entry) => entry.playerId === playerId),
        ),
      );
      // Viewer-perspective head-to-head: one row against the viewer's
      // own Player, linking to the full comparison. Non-blocking;
      // failures stay silent.
      void fetchHeadToHead(ownPlayerId, playerId)
        .then((summary) => {
          if (disposed || summary.sharedRaces === 0) { return; }
          controlsRow.append(dsButton({
            label: `Head-to-head: you ${summary.aAhead} · ${
              summary.bAhead} them over ${summary.sharedRaces} shared races →`,
            variant: "quiet",
            href: `/?compare=${encodeURIComponent(ownPlayerId)},${
              encodeURIComponent(playerId)}`,
          }).root);
        })
        .catch(() => undefined);
    }).catch(() => undefined);
    // Who is looking decides whether a poke is offered at all; on your own
    // profile there is nobody to poke. The lookup is handed over unresolved so
    // a public profile never waits on a session to render.
    publicProfile = mountPublicProfile(
      profileRoot, playerId, tab, feedViewerPlayerId().catch(() => null),
    );
    await publicProfile.ready;
  };

  /**
   * The viewer for a feed: never a request when nobody is signed in. A
   * knowingly unauthorized probe is a 401 in everybody's console and tells
   * the feed nothing it could not have assumed.
   */
  const feedViewerPlayerId = async (): Promise<string | null> => {
    const session = await loadSession().catch(() => null);
    if (session === null) { return null; }
    const claims = await createPlayerClaimClient().listMine().catch(() => []);
    return claims.find(
      (candidate) => candidate.claimStatus === "verified",
    )?.playerId ?? null;
  };

  const renderSignIn = (): void => {
    const activeQuery = new URLSearchParams(
      activeSearch.startsWith("?") ? activeSearch.slice(1) : activeSearch,
    );
    // Someone who clicked a Sign in control (or followed a dead link) came
    // here to sign in; the form leads. The marketing hero stays for a visitor
    // who simply landed on the signed-out Home.
    const explicit = activeQuery.get("signin") !== null ||
      activeQuery.get("authError") !== null ||
      activeQuery.get("welcome") !== null ||
      currentReturnIntent() !== null;
    setActiveNav(explicit ? null : "home");
    unmountProduct();
    clear(content);
    heading.hidden = false;
    status.hidden = false;
    heading.textContent = "MK8DX";
    status.textContent = isDevice
      ? localized(
        "Sign in before approving this device.",
        "Meld je aan voordat je dit apparaat goedkeurt.",
      )
      : localized(
        "One email address is all you need. Nothing to remember, nothing to reset.",
        "Eén e-mailadres is genoeg. Niets om te onthouden, niets om te herstellen.",
      );
    if (installationMode === "checking") {
      status.textContent = localized("Checking how to sign in…", "Aanmeldmethode controleren…");
      const marker = document.createElement("p");
      marker.className = "ds-body";
      marker.textContent = status.textContent;
      content.append(marker);
      if (installationModeRequest === null) {
        installationModeRequest = client.installationMode!().then((mode) => {
          installationMode = mode;
        }).catch(() => { installationMode = "unavailable"; });
      }
      void installationModeRequest.then(() => {
        if (!disposed && marker.isConnected) { renderSignIn(); }
      });
      return;
    }
    if (installationMode === "unavailable") {
      status.textContent = localized(
        "We could not check how this installation signs in.",
        "We konden de aanmeldmethode van deze installatie niet controleren.",
      );
      const retry = dsButton({
        label: localized("Try again", "Opnieuw proberen"), variant: "secondary",
        onPress: () => {
          installationMode = "checking";
          installationModeRequest = null;
          renderSignIn();
        },
      });
      content.append(retry.root);
      return;
    }
    if (installationMode === "offline-invitation") {
      const invitation = document.createElement("div");
      invitation.className = "ds-stack";
      const instruction = document.createElement("p");
      instruction.className = "ds-body";
      instruction.textContent = localized(
        "Use the personal invitation link or QR code from the administrator's host screen to sign in. The invitation expires after 15 minutes and works once.",
        "Gebruik de persoonlijke uitnodigingslink of QR-code van het beheerscherm op de host-pc om je aan te melden. De uitnodiging verloopt na 15 minuten en werkt één keer.",
      );
      const distinction = document.createElement("p");
      distinction.className = "ds-body-s";
      distinction.textContent = localized(
        "The setup QR installs trust in this local server; it does not sign you in. Ask the host administrator for a new invitation if yours has expired.",
        "De setup-QR installeert vertrouwen in deze lokale server; daarmee meld je je niet aan. Vraag de hostbeheerder om een nieuwe uitnodiging als de jouwe is verlopen.",
      );
      invitation.append(instruction, distinction);
      if (isDevice) {
        status.textContent = localized(
          "Sign in with your invitation first, then return to approve this device.",
          "Meld je eerst aan met je uitnodiging en kom daarna terug om dit apparaat goed te keuren.",
        );
        content.append(dsPanel({ title: localized("Local invitation", "Lokale uitnodiging"),
          titleLevel: 2, children: [invitation] }));
      } else {
        heading.hidden = true;
        status.hidden = true;
        const landingRoot = document.createElement("div");
        content.append(landingRoot);
        signedOutHome = mountSignedOutHome(landingRoot, {
          signInPanel: invitation, signInFirst: explicit,
          brandSrc: PRODUCT_ICON,
        });
      }
      return;
    }
    // A link that has expired, or that a mail scanner opened first, used to
    // land here silently: the person saw the marketing page and concluded
    // that clicking had done nothing. `errorCallbackURL` finally has a
    // reader.
    const linkFailed = activeQuery.get("authError") !== null;
    const form = document.createElement("form");
    // The landing is a design-system page, so its one form sits on a design-system surface. The
    // legacy `.tt-auth__form` background was the dark panel a light label could not be read on.
    form.className = "ds-root ds-stack";
    form.setAttribute("data-gap", "md");
    if (linkFailed) {
      // W03 (Phase 12): the failed-link notice is the design system's own warning message, so it
      // reads the same as every other thing the product tells somebody went wrong.
      form.append(dsStatusMessage("warning", localized(
        "That link did not work. Sign-in links can only be opened once, and they expire after 15 minutes. Enter your address below and we will send a fresh one.",
        "Die link werkte niet. Aanmeldlinks werken maar één keer en verlopen na 15 minuten. Vul hieronder je adres in, dan sturen we een nieuwe.",
      )));
    }
    // The one field and the one action of the sign-in form, on the design system: the landing that
    // carries them is a design-system page now, and the legacy control colours did not survive the
    // move (axe colour-contrast on `label`, `input` and `.tt-auth__button`).
    const fieldId = "tt-auth-email";
    const label = document.createElement("label");
    label.className = "ds-field__label";
    label.setAttribute("for", fieldId);
    label.textContent = localized("Email address", "E-mailadres");
    const email = document.createElement("input");
    email.className = "ds-input";
    email.id = fieldId;
    email.type = "email";
    email.name = "email";
    email.autocomplete = "email";
    email.maxLength = 320;
    email.required = true;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ds-root ds-button ds-slant";
    submit.setAttribute("data-variant", "primary");
    submit.setAttribute("data-size", "md");
    const submitLabel = document.createElement("span");
    submitLabel.className = "ds-button__label";
    submitLabel.textContent = localized("Email me a link", "Mail me een link");
    submit.append(submitLabel);
    const formStatus = document.createElement("p");
    formStatus.className = "ds-body-s ds-signin__status";
    formStatus.setAttribute("role", "status");
    const fieldBlock = document.createElement("div");
    fieldBlock.className = "ds-field";
    fieldBlock.append(label, email);
    form.append(fieldBlock, submit, formStatus);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      operation += 1;
      const current = operation;
      controller?.abort();
      controller = new AbortController();
      submit.disabled = true;
      email.disabled = true;
      const address = email.value.trim();
      formStatus.textContent = localized("Sending…", "Versturen…");
      void client.requestMagicLink(email.value, currentCallbackURL(), controller.signal)
        .then(() => {
          if (disposed || current !== operation) { return; }
          status.textContent = localized(
            `Check ${address}`,
            `Kijk in ${address}`,
          );
          formStatus.textContent = localized(
            "If that address can receive mail, a link is on its way — it may take a minute, and it is sometimes filed as spam. Opening it signs you in, and if you are new it sets up your Player.",
            "Als dat adres mail kan ontvangen, is er een link onderweg — dat kan een minuut duren en belandt soms in spam. Door hem te openen meld je je aan; ben je nieuw, dan maak je meteen je speler aan.",
          );
          // Letting somebody re-send after a mistyped address is kinder than
          // making them reload the page.
          submit.disabled = false;
          email.disabled = false;
          submitLabel.textContent = localized(
            "Send another link", "Stuur nog een link",
          );
        })
        .catch(() => {
          if (disposed || current !== operation) { return; }
          status.textContent = localized(
            "We could not send that link just now. Please try again.",
            "We konden die link nu niet versturen. Probeer het opnieuw.",
          );
          formStatus.textContent = status.textContent;
          submit.disabled = false;
          email.disabled = false;
        });
    });
    if (!isDevice) {
      heading.hidden = true;
      status.hidden = true;
      // W01 on the design system (Phase 10). The landing explains the product, offers the places a
      // phone cannot otherwise reach, previews what the community is doing, and carries this very
      // form - one sign-in, in one place. The form leads when the visitor asked to sign in.
      const signInCopy = document.createElement("div");
      const signInDetail = document.createElement("p");
      signInDetail.className = "ds-body";
      signInDetail.textContent = explicit && currentReturnIntent() !== null
        ? localized(
          "After signing in you continue where you left off.",
          "Na het aanmelden ga je verder waar je gebleven was.",
        )
        : localized(
          "New here or coming back, it works the same way: give us your email and we send a one-time link. New accounts pick their racing name straight after.",
          "Nieuw of terugkerend, het werkt hetzelfde: geef je e-mailadres en we sturen een eenmalige link. Nieuwe accounts kiezen daarna meteen hun racenaam.",
        );
      signInCopy.append(signInDetail, form);
      const landingRoot = document.createElement("div");
      content.append(landingRoot);
      signedOutHome = mountSignedOutHome(landingRoot, {
        signInPanel: signInCopy,
        signInFirst: explicit,
        brandSrc: PRODUCT_ICON,
      });
      if (explicit) { email.focus?.(); }
    } else {
      // On `/device` there is no landing to carry the form, so it gets its own panel — the same
      // surface, the same one field and one action (W03/W04).
      const panelHost = document.createElement("div");
      panelHost.className = "ds-root ds-signin ds-stack";
      panelHost.append(dsPanel({
        title: localized("Sign in", "Aanmelden"), titleLevel: 2,
        note: localized(
          "One email address is all you need. Nothing to remember, nothing to reset.",
          "Eén e-mailadres is genoeg. Niets om te onthouden, niets om te herstellen."),
        children: [form],
      }));
      content.append(panelHost);
      email.focus?.();
    }
  };

  // Signing out and handing the browser to somebody else are different
  // intentions, so they are different buttons. Switching is honestly
  // described: this signs you out first, then you sign in as someone else.
  const renderSignedInHeader = (): HTMLElement => {
    // W04 (Phase 12): signing out and handing the browser to somebody else stay two intentions and
    // two buttons, with the same honest explanation under them — on the design system's controls.
    let ending = false;
    const end = (switching: boolean): void => {
      if (disposed || ending) { return; }
      ending = true;
      const reason = localized("Signing out…", "Bezig met afmelden…");
      signOut.setDisabled(reason);
      switchAccount.setDisabled(reason);
      endSession(switching);
    };
    const signOut = dsButton({
      label: localized("Sign out", "Afmelden"), variant: "secondary",
      onPress: () => end(false),
    });
    const switchAccount = dsButton({
      label: localized("Switch account", "Ander account"), variant: "quiet",
      onPress: () => end(true),
    });
    const group = document.createElement("div");
    group.className = "ds-root ds-signin__account";
    const actions = document.createElement("div");
    actions.className = "ds-cluster";
    actions.setAttribute("data-gap", "sm");
    actions.append(signOut.root, switchAccount.root);
    const explanation = document.createElement("p");
    explanation.className = "ds-micro";
    explanation.textContent = localized(
      "Switching signs you out here first, then you sign in with a different account.",
      "Overstappen meldt je hier eerst af; daarna meld je je aan met een ander account.");
    group.append(actions, explanation);
    return group;
  };

  const endSessionImplementation = (switching: boolean): void => {
      if (disposed) { return; }
      status.textContent = switching
        ? "Signing out so you can use another account…"
        : "Signing out…";
      void detachCurrentWebPushSubscription().catch(() => undefined)
        .then(() => client.signOut()).then(() => {
        sessionCache = null;
        capabilitiesCache = null;
        // The remembered header identity belongs to the session that just
        // ended; the next account must never see the previous name. The same
        // goes for the briefly remembered answers (the claim set, the inbox)
        // that would otherwise repaint it.
        forgetNavIdentity();
        forgetRemembered();
        // Signing out keeps this device's appearance choice (ADR-0205 §6); it simply stops being
        // an account value, so the next sign-in hydrates from whoever signs in.
        forgetAppearanceSync();
        appearanceSynced = false;
        identityLoaded = false;
        if (disposed) { return; }
        // The header is chrome shared by every page: it must show the
        // signed-out state now, not after the next full reload.
        applyNavSession(false);
        renderSignIn();
        if (switching) {
          status.textContent = localized(
            "Signed out. Sign in with a different account to continue.",
            "Afgemeld. Meld je aan met een ander account om verder te gaan.",
          );
        }
      }).catch(() => {
        if (!disposed) { status.textContent = "Could not sign out. Please retry."; }
      });
  };
  endSession = endSessionImplementation;

  // W04 Device approval on the design system (Phase 12). Presentation only: the device-code
  // lookup, the two-step approve/deny, every state and every word are unchanged. The page is a
  // MINIMAL route (DESIGN_SYSTEM §5) — no art, one panel, one field, one action at a time.
  const renderDevice = async (): Promise<void> => {
    unmountProduct();
    clear(content);
    heading.hidden = true;
    status.hidden = false;
    const page = document.createElement("div");
    page.className = "ds-root ds-device ds-stack";
    page.setAttribute("data-spectacle", "minimal");
    const title = document.createElement("h1");
    title.className = "ds-title";
    title.textContent = localized("Approve a device", "Apparaat goedkeuren");
    const body = document.createElement("div");
    body.className = "ds-stack";
    page.append(title, renderSignedInHeader(), body);
    content.append(page);

    const fieldId = "ds-device-code";
    const input = document.createElement("input");
    input.className = "ds-text-input";
    input.id = fieldId;
    input.name = "user_code";
    input.autocomplete = "one-time-code";
    input.maxLength = 32;
    input.value = new URLSearchParams(search).get("user_code") ?? "";
    const lookup = dsButton({ label: localized("Continue", "Doorgaan"), variant: "primary" });
    lookup.control.setAttribute("type", "submit");
    const form = document.createElement("form");
    form.className = "ds-stack";
    form.setAttribute("data-gap", "md");
    const notice = document.createElement("div");
    form.append(dsField({
      label: localized("Device code", "Apparaatcode"), control: input, labelFor: fieldId,
      hint: localized("The code your app is showing.", "De code die je app toont."),
    }), lookup.root, notice);
    body.append(dsPanel({
      title: localized("Device code", "Apparaatcode"), titleLevel: 2,
      note: localized(
        "Enter the code your app is showing, then decide whether it may use this account.",
        "Voer de code in die je app toont en beslis daarna of die dit account mag gebruiken."),
      children: [form],
    }));

    const say = (tone: "info" | "success" | "warning" | "error", text: string): void => {
      status.textContent = text;
      notice.replaceChildren(dsStatusMessage(tone, text));
    };

    const inspect = async (): Promise<void> => {
      lookup.setDisabled(localized("Checking the device code…", "Apparaatcode controleren…"));
      input.disabled = true;
      say("info", localized("Checking the device code…", "Apparaatcode controleren…"));
      try {
        const device = await client.device(input.value);
        if (disposed) { return; }
        const decision = document.createElement("div");
        decision.className = "ds-stack";
        decision.setAttribute("data-gap", "md");
        const summary = document.createElement("p");
        summary.className = "ds-body";
        summary.textContent = localized(
          `${deviceName(device.clientId)} requests access to your account.`,
          `${deviceName(device.clientId)} vraagt toegang tot je account.`,
        );
        const warning = dsStatusMessage("warning", localized(
          "Approve only if you started this request on your device.",
          "Keur alleen goed als je dit verzoek zelf op je apparaat bent begonnen.",
        ));
        const decisionNotice = document.createElement("div");
        let decided = false;
        const decide = (approved: boolean): void => {
          if (decided) { return; }
          decided = true;
          const working = approved
            ? localized("Approving device…", "Apparaat goedkeuren…")
            : localized("Denying device…", "Apparaat weigeren…");
          approve.setDisabled(working);
          deny.setDisabled(working);
          status.textContent = working;
          decisionNotice.replaceChildren(dsStatusMessage("info", working));
          const action = approved
            ? client.approveDevice(device.userCode)
            : client.denyDevice(device.userCode);
          void action.then(() => {
            if (disposed) { return; }
            const done = approved
              ? localized(
                "Device approved. Go back to the app to finish signing in.",
                "Apparaat goedgekeurd. Ga terug naar de app om het aanmelden af te ronden.")
              : localized("Device request denied.", "Apparaatverzoek geweigerd.");
            status.textContent = done;
            decisionNotice.replaceChildren(dsStatusMessage(approved ? "success" : "info", done));
          }).catch(() => {
            if (disposed) { return; }
            decided = false;
            const failed = localized(
              "Could not update the device request. Please retry.",
              "Het apparaatverzoek kon niet worden bijgewerkt. Probeer het opnieuw.");
            status.textContent = failed;
            decisionNotice.replaceChildren(dsStatusMessage("error", failed));
            approve.setDisabled(null);
            deny.setDisabled(null);
          });
        };
        const approve = dsButton({
          label: localized("Approve device", "Apparaat goedkeuren"), variant: "primary",
          onPress: () => decide(true),
        });
        const deny = dsButton({
          label: localized("Deny", "Weigeren"), variant: "secondary",
          onPress: () => decide(false),
        });
        const actions = document.createElement("div");
        actions.className = "ds-cluster";
        actions.setAttribute("data-gap", "sm");
        actions.append(approve.root, deny.root);
        decision.append(summary, warning, actions, decisionNotice);
        body.replaceChildren(dsPanel({
          title: localized("Review this device request.", "Beoordeel dit apparaatverzoek."),
          titleLevel: 2,
          children: [decision],
        }));
        status.textContent = localized(
          "Review this device request.", "Beoordeel dit apparaatverzoek.");
        approve.control.focus?.();
      } catch (error) {
        if (disposed) { return; }
        say("error", error instanceof WebAuthenticationError &&
          error.code === "invalid_device_code"
          ? localized(
            "That device code is invalid or expired.",
            "Die apparaatcode is ongeldig of verlopen.")
          : localized(
            "Could not check the device code. Please retry.",
            "De apparaatcode kon niet worden gecontroleerd. Probeer het opnieuw."));
        lookup.setDisabled(null);
        input.disabled = false;
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void inspect();
    });
    if (input.value.length > 0) { await inspect(); }
  };

  const renderProduct = async (): Promise<void> => {
    setActiveNav("home");
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;

    // W02 on the design system (Phase 10): identity and standing in the hero, the two engine-scoped
    // blocks under one EngineSelector, the story feed, the next night, the inbox and More places.
    // Notifications also stay behind the counted bell.
    const homeRoot = document.createElement("div");
    content.append(homeRoot);
    try {
      homeHero = mountHome(homeRoot, {
        // The hero's "Post a time" is this viewport's A4, so the phone dock only appears once that
        // action has scrolled away (DESIGN_SYSTEM §11, T-DOCK).
        onPrimaryAction: (node, href, label) => { shell.setDock({ watch: node, href, label }); },
      });
    } catch {
      if (homeRoot.parentNode === content) { content.removeChild(homeRoot); }
    }
    await homeHero?.ready;
    discardPreloaded();
  };

  const requireSession = async (): Promise<boolean> => {
    const session = await loadSession().catch(() => null);
    if (disposed) { return false; }
    if (session === null) {
      renderSignIn();
      return false;
    }
    return true;
  };

  // Onboarding is its own route with its own composition. It used to be
  // `?settings=1&onboarding=1`: the whole Settings page with a welcome banner
  // stapled on, where the one required step rendered third behind a sign-out
  // button and a language dropdown.
  const renderWelcome = async (): Promise<void> => {
    setActiveNav(null);
    if (!await requireSession()) { return; }
    unmountProduct();
    clear(content);
    heading.hidden = true;
    status.hidden = true;
    const welcomeRoot = document.createElement("div");
    content.append(welcomeRoot);
    welcome = mountWelcome(welcomeRoot);
    await welcome.ready;
  };

  const renderSettingsPage = async (): Promise<void> => {
    setActiveNav(null);
    // Settings mounts several account widgets. One bootstrap supplies their
    // shared identity/claim documents without a request burst.
    const extras = await primeFromBootstrap().catch(() => null);
    if (extras !== null) { primeSession(extras.authenticated); }
    const session = await loadSession().catch(() => null);
    if (disposed) { return; }
    if (session === null) { renderSignIn(); return; }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const page = document.createElement("div");
    page.className = "ds-root ds-settings ds-stack";
    page.setAttribute("data-spectacle", "low");
    const title = document.createElement("h1");
    title.className = "ds-display-3";
    title.textContent = localized("Settings", "Instellingen");
    const intro = document.createElement("p");
    intro.className = "ds-settings__intro ds-body-m";
    intro.textContent = localized(
      "Your Player identity and public profile.",
      "Je speleridentiteit en openbare profiel.",
    );
    const group = (id: string, label: string): Readonly<{ section: HTMLElement; body: HTMLElement }> => {
      const section = document.createElement("section");
      section.className = "ds-settings__group ds-stack";
      section.id = id;
      const heading = document.createElement("h2");
      heading.className = "ds-display-6";
      heading.textContent = label;
      const body = document.createElement("div");
      body.className = "ds-settings__group-body";
      section.append(heading, body);
      return { section, body };
    };
    const accountGroup = group("settings-account", localized("Account & device", "Account en apparaat"));
    const playerGroup = group("settings-player", localized("Player identity", "Speleridentiteit"));
    const timeTrialGroup = group("settings-time-trials", "Time Trials");
    const communityGroup = group("settings-community", localized("Community & notifications", "Community en meldingen"));
    const localNav = document.createElement("nav");
    localNav.className = "ds-settings__nav";
    localNav.setAttribute("aria-label", localized("Settings sections", "Onderdelen van instellingen"));
    for (const [href, label] of [
      ["#settings-account", localized("Account", "Account")],
      ["#settings-player", localized("Player", "Speler")],
      ["#settings-time-trials", "Time Trials"],
      ["#settings-community", localized("Community", "Community")],
    ] as const) {
      const link = document.createElement("a");
      link.className = "ds-button";
      link.setAttribute("data-variant", "quiet");
      link.setAttribute("href", href);
      link.textContent = label;
      localNav.append(link);
    }
    page.append(title, intro, localNav, accountGroup.section, playerGroup.section,
      timeTrialGroup.section, communityGroup.section);
    content.append(page);
    const accountRow = document.createElement("div");
    accountRow.className = "ds-panel settings__account";
    if (await loadCapabilities()) {
      // Administration stays reachable, deliberately secondary.
      const adminLink = document.createElement("a");
      adminLink.className = "ds-button";
      adminLink.setAttribute("data-variant", "quiet");
      adminLink.setAttribute("href", "/?admin=1");
      adminLink.textContent = "Administration";
      accountRow.append(adminLink);
    }
    accountRow.append(renderSignedInHeader());
    accountGroup.body.append(accountRow);
    const languageRoot = document.createElement("div");
    accountGroup.body.append(languageRoot);
    mountLanguageSettings(languageRoot);
    // Appearance (DESIGN_SYSTEM §19, ADR-0205). The first design-system island on this page: it
    // renders in the chosen profile, so Light is visible on the control that chooses it.
    const appearanceRoot = document.createElement("div");
    appearanceRoot.className = "settings__appearance";
    accountGroup.body.append(appearanceRoot);
    appearanceSettings?.unmount();
    appearanceSettings = mountAppearanceSettings(appearanceRoot, { signedIn: true });
    const claimRoot = document.createElement("div");
    claimRoot.id = "player-claim";
    playerGroup.body.append(claimRoot);
    const mountedClaim = mountClaim(claimRoot);
    claim = mountedClaim;
    // Owner decision 2026-08-28: a Player manages their own alternate names
    // here, beside the claim that gives them the right to. Aliases and claims
    // are the same subject - which names belong to which identity.
    const aliasRoot = document.createElement("div");
    aliasRoot.id = "profile-aliases";
    playerGroup.body.append(aliasRoot);
    profileAliases?.dispose();
    profileAliases = mountProfileAliasSection(aliasRoot);
    const claimState = mountedClaim.state === undefined
      ? "linked" as const
      : await mountedClaim.state;
    if (disposed) { return; }

    const preferencesRoot = document.createElement("div");
    timeTrialGroup.body.append(preferencesRoot);
    accountTimeTrialSettings = mountAccountTimeTrialSettings(preferencesRoot);

    // Presence sits directly under the Player itself: "who am I here" and
    // "where do I show up" are one thought.
    if (claimState === "linked") {
      const visibilityRoot = document.createElement("div");
      playerGroup.body.append(visibilityRoot);
      try {
        playerVisibility = mountVisibility(visibilityRoot);
      } catch {
        if (visibilityRoot.parentNode === content) {
          content.removeChild(visibilityRoot);
        }
      }
      const profilePreferenceRoot = document.createElement("div");
      playerGroup.body.append(profilePreferenceRoot);
      try {
        profilePreferenceSettings = mountPlayerProfilePreferenceSettings(profilePreferenceRoot);
      } catch {
        if (profilePreferenceRoot.parentNode === content) {
          content.removeChild(profilePreferenceRoot);
        }
      }
    }

    {
      const notificationSettingsRoot = document.createElement("div");
      communityGroup.body.append(notificationSettingsRoot);
      webPushSettings = mountWebPushSettings(notificationSettingsRoot);
      if (claimState === "linked") {
        const rivalRoot = document.createElement("div");
        communityGroup.body.append(rivalRoot);
        try {
          rivalSettings = mountRivalSettings(rivalRoot);
        } catch {
          if (rivalRoot.parentNode === content) {
            content.removeChild(rivalRoot);
          }
        }
        const followRoot = document.createElement("div");
        communityGroup.body.append(followRoot);
        try {
          followSettings = mountFollowSettings(followRoot);
        } catch {
          if (followRoot.parentNode === content) {
            content.removeChild(followRoot);
          }
        }
        const socialGroupRoot = document.createElement("div");
        socialGroupRoot.id = "social-groups";
        communityGroup.body.append(socialGroupRoot);
        try {
          socialGroupSettings = mountSocialGroupSettings(socialGroupRoot);
        } catch {
          if (socialGroupRoot.parentNode === content) {
            content.removeChild(socialGroupRoot);
          }
        }
      }
      const emailRoot = document.createElement("section");
      emailRoot.className = "ds-panel country-settings";
      const emailTitle = document.createElement("h3");
      emailTitle.className = "ds-title";
      emailTitle.textContent = "Account email";
      const emailNote = document.createElement("p");
      emailNote.className = "ds-panel__note country-settings__note";
      emailNote.textContent = "Change the private email used to sign in (optional). For your security, confirm the request from your current inbox and then verify the new address.";
      const emailInput = document.createElement("input");
      emailInput.type = "email"; emailInput.autocomplete = "email"; emailInput.maxLength = 320;
      emailInput.className = "ds-input country-settings__select"; emailInput.placeholder = "New email address (optional)";
      const emailSave = document.createElement("button");
      emailSave.type = "button"; emailSave.className = "ds-button"; emailSave.setAttribute("data-variant", "secondary"); emailSave.textContent = "Start email change";
      const emailStatus = document.createElement("p"); emailStatus.className = "ds-body-s country-settings__status"; emailStatus.setAttribute("role", "status");
      emailRoot.append(emailTitle, emailNote, emailInput, emailSave, emailStatus);
      emailSave.addEventListener("click", () => {
        if (!emailInput.checkValidity()) {
          emailInput.setAttribute("aria-invalid", "true");
          emailStatus.textContent = "Enter a valid email address before starting this optional change.";
          emailInput.focus();
          return;
        }
        emailInput.setAttribute("aria-invalid", "false");
        emailSave.disabled = true; emailStatus.textContent = "Requesting confirmation…";
        const request = client.changeEmail === undefined
          ? Promise.reject(new Error("email change unavailable"))
          : client.changeEmail(emailInput.value, "/?settings=1&emailChanged=1");
        void request
          .then(() => { emailStatus.textContent = "Email change requested. Check your current inbox first, then the new inbox."; })
          .catch(() => { emailStatus.textContent = "The email change could not be started. Check the address, sign in again, and retry."; })
          .finally(() => { emailSave.disabled = false; });
      });
      accountGroup.body.append(emailRoot);
    }
  };

  const renderNotificationsPage = async (): Promise<void> => {
    setActiveNav(null);
    if (!await requireSession()) { return; }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const page = document.createElement("div");
    page.className = "ds-root ds-notifications-page ds-stack";
    content.append(page);
    // Turning notifications on belongs where you read them, not only three
    // clicks away in Settings: this is the page you open when you wonder why
    // you did not hear about something.
    const inboxRoot = document.createElement("div");
    page.append(inboxRoot);
    notifications = mountNotificationSection(inboxRoot);
    const pushRoot = document.createElement("div");
    page.append(pushRoot);
    notificationPushSettings?.unmount();
    notificationPushSettings = mountWebPushSettings(pushRoot, { inboxContext: true });
    await Promise.all([notifications.ready, notificationPushSettings.ready]);
  };

  // W16 on the design system (Phase 12). The route asks for the COMPLETE feed through the shared
  // activity contract, so it can never be handed the Home bootstrap's preference-filtered copy (R3).
  const renderActivityPage = async (): Promise<void> => {
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const feedRoot = document.createElement("div");
    content.append(feedRoot);
    activityFeed = mountActivityStories(feedRoot, {
      viewerPlayerId: feedViewerPlayerId(),
    });
    await activityFeed.ready;
  };

  const renderMyStatsPage = async (): Promise<void> => {
    setActiveNav(null);
    if (!await requireSession()) { return; }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    status.textContent = "";
    status.hidden = true;
    const insightsRoot = document.createElement("div");
    insightsRoot.id = "personal-insights";
    content.append(insightsRoot);
    insights = mountInsights(insightsRoot);
    await insights.ready;
  };

  const renderAdminPage = async (): Promise<void> => {
    setActiveNav(null);
    // The administration page mounts four sections at once; priming the
    // shared chrome from one bootstrap keeps the burst inside the hosting
    // budget (ADR-0159).
    const extras = await primeFromBootstrap().catch(() => null);
    if (disposed) { return; }
    if (extras !== null) { primeSession(extras.authenticated); }
    const session = await loadSession().catch(() => null);
    if (disposed) { return; }
    if (session === null) { renderSignIn(); return; }
    unmountProduct();
    clear(content);
    heading.textContent = "";
    heading.hidden = true;
    if (!await loadCapabilities()) {
      heading.hidden = false;
      heading.textContent = localized("Administration", "Beheer");
      status.hidden = false;
      status.textContent = "Administrator access is required.";
      // A Director decides link requests for the Players of their own nights (ADR-0216); those
      // appear here, under the same address the notification opens.
      const reviewRoot = document.createElement("div");
      reviewRoot.className = "ds-root ds-admin ds-stack";
      content.append(reviewRoot);
      administratorReview = mountAdministratorReview(reviewRoot, undefined, { hideWhenEmpty: true });
      return;
    }
    status.textContent = "";
    status.hidden = true;
    const page = document.createElement("div");
    page.className = "ds-root ds-admin ds-stack";
    page.setAttribute("data-spectacle", "minimal");
    const title = document.createElement("h1");
    title.className = "ds-display-3";
    title.textContent = localized("Administration", "Beheer");
    const intro = document.createElement("p");
    intro.className = "ds-body ds-admin__intro";
    intro.textContent = localized(
      "Review identity, Tournament, Time Trial and rating work. Changes remain separate, explicit actions.",
      "Beoordeel identiteit, toernooien, tijdritten en ratingwerk. Wijzigingen blijven afzonderlijke, expliciete acties.",
    );
    const overviewRoot = document.createElement("div");
    const claimsRoot = document.createElement("div");
    const tournamentsRoot = document.createElement("div");
    const timeTrialsRoot = document.createElement("div");
    const ratingRoot = document.createElement("div");
    const installationRoot = document.createElement("div");
    const sections: readonly Readonly<{ slug: string; label: string; root: HTMLElement }>[] = [
      { slug: "overview", label: localized("Overview", "Overzicht"), root: overviewRoot },
      { slug: "claims", label: localized("Claims", "Claims"), root: claimsRoot },
      { slug: "tournaments", label: localized("Tournaments", "Toernooien"), root: tournamentsRoot },
      { slug: "time-trials", label: localized("Time Trials", "Tijdritten"), root: timeTrialsRoot },
      { slug: "rating", label: localized("Rating", "Rating"), root: ratingRoot },
      // ADR-0221: who creates Players and who counts for the rating.
      { slug: "installation", label: localized("Installation settings", "Installatie-instellingen"), root: installationRoot },
    ];
    for (const section of sections) {
      section.root.className = "ds-admin__section ds-stack";
      section.root.setAttribute("data-admin-section", section.slug);
    }
    const requested = new URLSearchParams(activeSearch).get("admin");
    let selected = sections.some((section) => section.slug === requested) ? requested! : "overview";
    let subnav: HTMLElement;
    const show = (slug: string, writeAddress = false): void => {
      selected = sections.some((section) => section.slug === slug) ? slug : "overview";
      for (const section of sections) { section.root.hidden = section.slug !== selected; }
      for (const link of Array.from(subnav.querySelectorAll(".ds-tab"))) {
        const current = link.getAttribute("href") === `/?admin=${selected}`;
        if (current) { link.setAttribute("aria-current", "page"); }
        else { link.removeAttribute("aria-current"); }
      }
      if (writeAddress) {
        const destination = `/?admin=${selected}`;
        activeSearch = destination.slice(1);
        globalThis.history?.pushState?.(null, "", destination);
        shell.setSignInHref(signInHref(currentReturnIntent()));
      }
    };
    subnav = dsTabs({
      label: localized("Administration sections", "Beheeronderdelen"),
      items: sections.map((section) => ({
        href: `/?admin=${section.slug}`,
        label: section.label,
        current: section.slug === selected,
        onSelect: () => show(section.slug, true),
      })),
    });
    page.append(title, intro, subnav, ...sections.map((section) => section.root));
    content.append(page);
    // The numbers first: who is here, who was around lately, what waits.
    administratorOverview?.unmount();
    administratorOverview = mountAdministratorOverviewSection(overviewRoot, {
      onOpenClaims: () => show("claims", true),
    });
    // Which app each Player actually runs. It sits under the numbers because
    // it answers the same kind of question: who is here, and with what.
    administratorInstallations?.unmount();
    administratorInstallations =
      mountAdministratorClientInstallationSection(overviewRoot);
    administratorReview = mountAdministratorReview(claimsRoot);
    // Who can sign in and whose history they see. It sits with claims because
    // it is the same question a claim answers, asked by the owner on somebody
    // else's behalf rather than by the Player themselves.
    administratorIdentityLinks?.unmount();
    administratorIdentityLinks = mountAdministratorIdentityLinkSection(claimsRoot);
    // Which person was behind a name on a console. It belongs beside account
    // linking and aliases: all three answer "who is this, really", and this one
    // answers it for a name that only ever existed on a screen.
    administratorObservedIdentities?.unmount();
    administratorObservedIdentities =
      mountAdministratorObservedIdentitySection(claimsRoot);
    // Aliases sit with claims: both are explicit identity reconciliation.
    administratorAliases = mountAdministratorAliasSection(claimsRoot);
    // Removal is offered on the race-day surface where a director reaches for
    // it; the undo belongs here, because bringing a Tournament back changes what
    // the public sees and what everybody's TrueSkill is.
    tournamentRemoval?.dispose();
    tournamentRemoval = mountAdministratorTournamentRemovalSection(tournamentsRoot);
    administratorTimeTrials = mountAdministratorTimeTrials(timeTrialsRoot);
    ratingAdministration = mountRatingAdministrationSection(ratingRoot);
    installationSettings?.unmount();
    installationSettings = mountInstallationSettingsSection(installationRoot);
    // Newly imported races must show up as publication candidates without a
    // page reload, so the review section is simply re-mounted after an import
    // (it always appends after the import panel, keeping the reading order).
    const remountTournamentPublication = (): void => {
      tournamentPublication?.unmount();
      tournamentPublication = mountTournamentPublication(tournamentsRoot);
    };
    // Producer output enters here; publication of what was imported is the
    // separate audited step rendered directly below it.
    const operateLink = document.createElement("p");
    const operateAnchor = document.createElement("a");
    operateAnchor.className = "tt-auth__button tt-auth__button--primary";
    operateAnchor.setAttribute("href", "/?tournaments=1&operate=1");
    operateAnchor.textContent = "Run a tournament night";
    operateLink.append(operateAnchor);
    tournamentsRoot.append(operateLink);
    tournamentOperatorAccess = mountTournamentOperatorAccess(tournamentsRoot);
    tournamentCanonicalImport = mountTournamentCanonicalImportSection(
      tournamentsRoot,
      { onImported: remountTournamentPublication },
    );
    tournamentPublication = mountTournamentPublication(tournamentsRoot);
    show(selected);
    await Promise.all([
      administratorOverview.ready,
      administratorReview.ready,
      tournamentPublication.ready,
      administratorTimeTrials.ready,
      ratingAdministration.ready,
      tournamentOperatorAccess.ready,
      installationSettings.ready,
    ]);
  };

  // Internal navigation stays inside this mounted application: links to
  // "/?..." push a history entry and re-render only the content area, so
  // no document reload, no module re-fetch, and no blank shell between
  // screens. The session result is cached for the page lifetime (sign-out
  // invalidates it).
  // W33. Unknown addresses used to render Home, which told the reader their link had worked.
  // ADR-0209: the link in a native sign-in email. No website session is needed: the link itself
  // proves the inbox. Opening it only shows what asks for access; Approve is a separate press,
  // because mail scanners open links on their own.
  const renderDeviceEmail = async (token: string): Promise<void> => {
    unmountProduct();
    clear(content);
    heading.hidden = true;
    status.hidden = false;
    const page = document.createElement("div");
    page.className = "ds-root ds-device ds-stack";
    page.setAttribute("data-spectacle", "minimal");
    const title = document.createElement("h1");
    title.className = "ds-title";
    title.textContent = localized("Approve a sign-in", "Aanmelding goedkeuren");
    const body = document.createElement("div");
    body.className = "ds-stack";
    page.append(title, body);
    content.append(page);
    const say = (tone: "info" | "success" | "warning" | "error", text: string): void => {
      status.textContent = text;
      body.replaceChildren(dsStatusMessage(tone, text));
    };
    const unusable = localized(
      "This link has expired or was already used. Ask the app for a new email.",
      "Deze link is verlopen of al gebruikt. Vraag de app om een nieuwe e-mail.");
    say("info", localized("Checking the link…", "Link controleren…"));
    if (!isDeviceEmailToken(token)) { say("error", unusable); return; }
    let request;
    try {
      request = await inspectDeviceEmail(token);
    } catch (error) {
      if (disposed) { return; }
      say("error", error instanceof NativeEmailApprovalClientError && error.code === "expired_or_used"
        ? unusable
        : localized("The link could not be checked. Please retry.", "De link kon niet worden gecontroleerd. Probeer het opnieuw."));
      return;
    }
    if (disposed) { return; }
    const summary = document.createElement("p");
    summary.className = "ds-body";
    summary.textContent = localized(
      `${request.clientName} asks to sign in to your account. Check that it shows the code ${request.userCode}.`,
      `${request.clientName} vraagt om aan te melden bij je account. Controleer dat het de code ${request.userCode} toont.`);
    const code = document.createElement("p");
    code.className = "ds-data-l";
    code.textContent = request.userCode;
    const warning = dsStatusMessage("warning", localized(
      "Approve only if you just asked to sign in on your own device.",
      "Keur alleen goed als je net zelf op je eigen apparaat hebt gevraagd om aan te melden."));
    const notice = document.createElement("div");
    const approve = dsButton({
      label: localized("Approve this sign-in", "Deze aanmelding goedkeuren"), variant: "primary",
      onPress: () => {
        const working = localized("Approving…", "Goedkeuren…");
        approve.setDisabled(working);
        status.textContent = working;
        notice.replaceChildren(dsStatusMessage("info", working));
        void approveDeviceEmail(token).then(() => {
          if (disposed) { return; }
          const done = localized(
            `Approved. ${request.clientName} finishes signing in by itself; you can close this page.`,
            `Goedgekeurd. ${request.clientName} rondt het aanmelden zelf af; je kunt deze pagina sluiten.`);
          status.textContent = done;
          notice.replaceChildren(dsStatusMessage("success", done));
          approve.root.hidden = true;
        }).catch((error: unknown) => {
          if (disposed) { return; }
          const failed = error instanceof NativeEmailApprovalClientError && error.code === "expired_or_used"
            ? unusable
            : localized("Could not approve. Please retry.", "Goedkeuren is niet gelukt. Probeer het opnieuw.");
          status.textContent = failed;
          notice.replaceChildren(dsStatusMessage("error", failed));
          approve.setDisabled(null);
        });
      },
    });
    body.replaceChildren(dsPanel({
      title: localized("Sign in on your device", "Aanmelden op je apparaat"), titleLevel: 2,
      children: [summary, code, warning, approve.root, notice],
    }));
    status.textContent = localized("Review this sign-in.", "Beoordeel deze aanmelding.");
    approve.control.focus?.();
  };

  const renderNotFound = (): void => {
    setActiveNav(null);
    unmountProduct();
    clear(content);
    heading.hidden = true;
    status.hidden = true;
    const panel = document.createElement("section");
    panel.className = "ds-root ds-not-found";
    panel.setAttribute("data-spectacle", "low");
    const title = document.createElement("h1");
    title.className = "ds-display-3";
    title.textContent = localized("Page not found", "Pagina niet gevonden");
    const body = document.createElement("p");
    body.className = "ds-body";
    body.textContent = localized(
      "That address does not lead anywhere in MK8DX Time Trials. The link may be old, or part of it may be missing.",
      "Dat adres leidt nergens heen in MK8DX Time Trials. De link is misschien oud, of er ontbreekt een stuk van.",
    );
    const home = document.createElement("a");
    home.className = "ds-button ds-slant";
    home.setAttribute("data-variant", "primary");
    home.setAttribute("href", "/");
    const homeLabel = document.createElement("span");
    homeLabel.className = "ds-button__label";
    homeLabel.textContent = localized("Go to Home", "Naar Start");
    home.append(homeLabel);
    panel.append(title, body, home);
    content.append(panel);
  };

  const renderRouteForSearch = (requestedSearch: string): Promise<void> => {
    // A short address (`?lb=8&mode=150`, `?p=bas`) becomes its canonical one first, in the
    // address bar too, so every later reader and a copied link see the full form (ADR-0199).
    const shortTarget = pathname === "/" ? expandShortLink(requestedSearch) : null;
    const currentSearch = shortTarget ?? requestedSearch;
    if (shortTarget !== null) {
      const history = globalThis.window?.history;
      history?.replaceState(history.state, "", `/${shortTarget}${globalThis.window?.location?.hash ?? ""}`);
    }
    activeSearch = currentSearch;
    // The header Sign in always carries the place it was clicked from.
    shell.setSignInHref(signInHref(currentReturnIntent()));
    refreshNavSession();
    // Public routes still keep the signed-in chrome alive. The session is
    // cached for this page lifetime, so this does not become a per-route
    // request after the first resolution. Home keeps its bootstrap-first
    // ordering to avoid racing the aggregate response.
    if (currentSearch !== "") {
      void loadSession().catch(() => null);
    }
    heading.hidden = false;
    status.hidden = false;
    heading.classList.remove("ds-page-title--ranking");
    status.classList.remove("ds-page-status--ranking");
    const query = pathname === "/" ? new URLSearchParams(currentSearch) : null;
    // The page-level heading/live region sit outside each mounted view but belong to the same
    // system. Keeping these classes unconditional closes the ranking/post/not-found gap that still
    // selected the timing tower after every visible route had migrated.
    heading.classList.add("ds-root", "ds-page-title");
    status.classList.add("ds-root", "ds-page-status");
    // Ranking (W10/W11) and the Track board (W07) are on the design system, so they have no route
    // layer any more: their content carries `.ds-root`, and the 238 `.page-shell--ranking-pilot` and
    // 96 `.page-shell--track-control` rules are gone.
    // W25-W27 carry their own design-system roots. The former player-control and mastery-control
    // route palettes are retired; no profile tab needs a legacy page-shell styling switch.
    const playerReference = query?.get("player") ?? null;
    // `?ranking=...&player=x` means the ranking, seen for x - not x's profile.
    const rankingReference = query?.get("ranking") ?? null;
    const profileSurface = playerReference !== null && rankingReference === null;
    const reportTournamentId = query?.get("night-report") ?? null;
    if (reportTournamentId !== null && /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(reportTournamentId)) {
      return renderTournamentReport(reportTournamentId);
    }
    const publicTournamentId = query?.get("tournament") ?? null;
    if (publicTournamentId !== null) {
      return renderPublicTournament(publicTournamentId);
    }
    const tournamentsQuery = query?.get("tournaments") ?? null;
    if (tournamentsQuery !== null) {
      const eventId = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(tournamentsQuery)
        ? tournamentsQuery
        : null;
      return renderTournaments(eventId, (query?.get("operate") ?? null) !== null, query?.get("director") ?? null);
    }
    const publicPlayerId = profileSurface ? playerReference : null;
    if (publicPlayerId !== null) {
      const tabValue = query?.get("tab");
      return renderPublicProfile(
        publicPlayerId,
        tabValue === "timetrials" || tabValue === "mastery"
          ? tabValue
          : "overview",
      );
    }
    const postQuery = query?.get("post") ?? null;
    if (postQuery !== null) {
      return renderPostTime(postQuery, parseEngineMode(query?.get("mode") ?? null));
    }
    const leaderboardTrackId = query?.get("leaderboard") ?? null;
    if (leaderboardTrackId !== null) {
      return renderLeaderboard(
        leaderboardTrackId,
        parseEngineMode(query?.get("mode") ?? null),
        query?.get("run") ?? null,
      );
    }
    const rankingQuery = rankingReference;
    if (rankingQuery !== null) {
      const focus = parseRankTrackFocus(query?.get("focus") ?? null);
      return renderRanking(rankingQuery, {
        ...(query?.get("mode") === "150" || query?.get("mode") === "200"
          ? { mode: Number(query.get("mode")) as 150 | 200 }
          : {}),
        ...(query?.get("scope") === "base" || query?.get("scope") === "bcp" || query?.get("scope") === "all"
          ? { scope: query.get("scope") as "base" | "bcp" | "all" }
          : {}),
        ...(isRankTab(query?.get("tab") ?? null)
          ? { tab: query!.get("tab") as "total" | "medals" | "mastery" | "tracks" }
          : {}),
        ...(focus === null ? {} : { trackFocus: focus }),
      }, query?.get("player") ?? null);
    }
    if ((query?.get("cups") ?? null) !== null) {
      return renderCups(parseEngineMode(query?.get("mode") ?? null));
    }
    const compareRaw = query?.get("compare") ?? null;
    const compareIds = compareRaw === null
      ? null
      : compareRaw.split(",").slice(0, 2);
    if (compareIds !== null && compareIds.length > 0 &&
        compareIds[0] !== undefined) {
      return renderCompare(compareIds[0], compareIds[1] ?? null,
        parseEngineMode(query?.get("mode") ?? null));
    }
    const deviceEmail = query?.get("device-email") ?? null;
    if (deviceEmail !== null) {
      // The token must not linger in the address bar or history once read.
      globalThis.history?.replaceState?.(null, "", "/?device-email=1");
      return renderDeviceEmail(deviceEmail);
    }
    const buildQuery = query?.get("build") ?? null;
    if (buildQuery !== null) { return renderBuild(buildQuery); }
    if ((query?.get("apps") ?? null) !== null) {
      return renderApps();
    }
    if ((query?.get("community") ?? null) !== null) {
      return renderCommunity();
    }
    if ((query?.get("records") ?? null) !== null) {
      return renderRecords();
    }
    if ((query?.get("activity") ?? null) !== null) {
      return renderActivityPage();
    }
    if ((query?.get("signin") ?? null) !== null ||
        (query?.get("authError") ?? null) !== null) {
      // The focused sign-in route. Someone already signed in continues
      // straight to the destination the control carried.
      return loadSession().catch(() => null).then(async (session) => {
        if (disposed) { return; }
        if (session === null) { renderSignIn(); return; }
        const destination = currentReturnIntent() ?? "/";
        if (destination.startsWith("/device")) {
          globalThis.location?.assign?.(destination);
          return;
        }
        globalThis.history?.replaceState?.(null, "", destination);
        await renderForSearch(searchOfHref(destination));
      });
    }
    if ((query?.get("welcome") ?? null) !== null) {
      return renderWelcome();
    }
    if ((query?.get("settings") ?? null) !== null) {
      return renderSettingsPage();
    }
    if ((query?.get("notifications") ?? null) !== null) {
      return renderNotificationsPage();
    }
    if ((query?.get("mystats") ?? null) !== null) {
      return renderMyStatsPage();
    }
    if ((query?.get("admin") ?? null) !== null) {
      return renderAdminPage();
    }
    // An address that matches no route is not Home (W33). Home itself has no query at all, so this
    // only ever catches something that was meant to be somewhere else.
    if (!isDevice && !isKnownRoute(currentSearch)) {
      renderNotFound();
      return Promise.resolve();
    }
    // Home is the only route that wants everything at once, so it is the
    // only one that pays for the bootstrap - and it does so before the
    // navigation bar starts asking, or those requests would overtake it.
    return primeFromBootstrap(undefined, undefined, "home")
      .catch(() => null)
      .then((extras) => {
        if (extras !== null && !disposed) { primeSession(extras.authenticated); }
      })
      .then(() => loadSession()).then(async (session) => {
      if (disposed) { return; }
      if (session === null) {
        renderSignIn();
      } else if (isDevice) {
        await renderDevice();
      } else {
        await renderProduct();
      }
    }).catch(() => {
      if (!disposed) {
        status.textContent = "Could not check your session. Reload to retry.";
      }
    });
  };

  // One place where a route becomes a page the reader has arrived at: its name in the tab, the
  // announcement a screen reader hears, and the focus moved into the content (DESIGN_SYSTEM §11).
  let navigated = false;
  const renderForSearch = async (currentSearch: string): Promise<void> => {
    await renderRouteForSearch(currentSearch);
    if (disposed) { return; }
    shell.setSpectacle(routeSpectacle(activeSearch));
    shell.setGlobalAction(routeGlobalAction(activeSearch));
    // Task mode (DESIGN_SYSTEM §11): while a Player is filling in a time the tabs give way to
    // Back, the task's title and Close. Back goes to the track the task was opened on, so the
    // board is one press away and the draft survives the trip (POST_A_TIME §8).
    const postTrack = new URLSearchParams(activeSearch).get("post");
    if (postTrack === null) {
      shell.setTask(null);
    } else {
      const postMode = new URLSearchParams(activeSearch).get("mode") === "200" ? 200 : 150;
      shell.setTask({
        title: localized("Post a time", "Tijd plaatsen"),
        backHref: /^track\./.test(postTrack)
          ? `/?leaderboard=${encodeURIComponent(postTrack)}&mode=${postMode}`
          : "/",
        onClose: (): void => {
          const home = /^track\./.test(postTrack)
            ? `/?leaderboard=${encodeURIComponent(postTrack)}&mode=${postMode}`
            : "/";
          globalThis.history?.pushState?.(null, "", home);
          void renderForSearch(home.slice(1));
        },
      });
    }
    const context = routeContextBar(activeSearch);
    if (routeContextNode !== null) {
      // The route answered for a role the address cannot see (W17's operator door).
      shell.setContextBar(routeContextNode);
    } else if (context === null) {
      shell.setContextBar(null);
    } else {
      const bar = document.createElement("p");
      bar.className = "ds-micro ds-context-bar__line";
      bar.setAttribute("data-mode", context.mode);
      bar.textContent = context.label;
      shell.setContextBar(bar);
    }
    shell.enterRoute({
      title: routeDocumentTitle(activeSearch, pathname),
      announce: navigated,
      focus: navigated,
    });
    navigated = true;
  };

  // Internal navigation is client-side from anywhere in the shell, the header and the tabs
  // included: that is what makes the route announcement and the focus move mean anything.
  root.addEventListener("click", (event) => {
    if (disposed || pathname !== "/" || event.defaultPrevented ||
        event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) {
      return;
    }
    const origin = event.target as
      { closest?: (selector: string) => Element | null } | null;
    const anchor = typeof origin?.closest === "function"
      ? origin.closest("a[href]")
      : null;
    if (anchor === null || anchor === undefined) { return; }
    const href = anchor.getAttribute("href");
    if (href === null || (href !== "/" && !href.startsWith("/?"))) {
      return;
    }
    event.preventDefault();
    globalThis.history?.pushState?.(null, "", href);
    void renderForSearch(searchOfHref(href));
  });

  const onPopState = (): void => {
    if (disposed) { return; }
    const next = globalThis.location?.search ?? "";
    // Chrome fires popstate for a same-document fragment link as well, and the
    // route lives in the query, not the hash. Re-rendering there would replace
    // the very section the browser is about to scroll to, so the jump would
    // land on a node that is no longer in the document and nothing would move.
    if (next === activeSearch) { return; }
    void renderForSearch(next);
  };
  if (pathname === "/") {
    globalThis.addEventListener?.("popstate", onPopState);
  }

  const ready = renderForSearch(search);

  return {
    container,
    status,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      controller?.abort();
      globalThis.removeEventListener?.("popstate", onPopState);
      stopAppearanceWatch();
      appearanceMedia?.removeEventListener?.("change", followBrandAppearance);
      shell.dispose();
      unmountProduct();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
