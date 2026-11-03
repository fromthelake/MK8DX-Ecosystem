import {
  createPlayerEngagementClient,
  type PlayerEngagementClient,
} from "./player-engagement-client.js";
import { mountPlayerInteractions } from "./player-interactions-panel.js";
import {
  createPlayerAliasClient,
  type PlayerAliasClient,
} from "./player-alias-client.js";
import {
  GAME_ASSET_BASE,
  COUNTRY_ASSET_MANIFEST,
  countryFlagPath,
} from "./asset-manifest.js";
import { avatarAppearance } from "./avatar-manifest.js";
import { BODY_PARTS, GLIDER_PARTS, TIRE_PARTS } from "./loadout-manifest.js";
import { matchedLoadoutVariant } from "./loadout-variants.js";
import { mountCareerSection } from "./career-section.js";
import { mountRatingGraph } from "./rating-graph.js";
import { mountTournamentCareer } from "./tournament-career.js";
import { mountTrackMastery } from "./mastery-view.js";
import { fetchTrackBestsFor } from "./mastery-view.js";
import { localized } from "./product-language.js";
import { tournamentTierByRank, tournamentTierLabel } from "./tournament-tiers.js";
import {
  createRatingClient,
  type RatingClient,
} from "./rating-view.js";
import {
  createPublicPlayerClient,
  PublicPlayerClientError,
  type PublicPlayerClient,
} from "./public-player-client.js";
import {
  createPublicTimeTrialClient,
  type PublicTimeTrialClient,
} from "./public-time-trial-client.js";
import {
  appendPublicPlayerTimeTrials,
  type PublicPlayerTimeTrialsOptions,
} from "./public-time-trial-view.js";
import { attachOwnerTimeTrialManagement } from "./time-trial-management.js";
import {
  createTournamentPublicationClient,
  type TournamentPublicationClient,
} from "./tournament-publication-client.js";
import { appendPublicPlayerTournaments } from "./ds-public-tournament.js";
import {
  artHero,
  button,
  panel,
  tabs,
  tierChip,
  useDocument,
} from "./ds-components.js";

export type MountedPublicPlayerProfile = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function aliasType(value: string): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    declared: ["Declared by the Player", "Door de speler opgegeven"],
    legacy_handle: ["In-game name", "In-game naam"],
    tournament_name: ["Tournament name", "Toernooinaam"],
    ocr_observation: ["Seen in a scan", "Waargenomen bij scan"],
    other_observation: ["Observed", "Waargenomen"],
  };
  const label = labels[value];
  return label === undefined
    ? value.replaceAll("_", " ")
    : localized(label[0], label[1]);
}

export type PublicProfileTab = "overview" | "timetrials" | "mastery";

export function mountPublicPlayerProfile(
  root: HTMLElement,
  playerId: string,
  tab: PublicProfileTab = "overview",
  playerClient: PublicPlayerClient = createPublicPlayerClient(),
  aliasClient: PlayerAliasClient = createPlayerAliasClient(),
  timeTrialClient: PublicTimeTrialClient = createPublicTimeTrialClient(),
  tournamentClient: TournamentPublicationClient = createTournamentPublicationClient(),
  ratingClient: RatingClient = createRatingClient(),
  timeTrialOptions: PublicPlayerTimeTrialsOptions = {
    // The viewer's own results become manageable in place; every other
    // profile stays exactly the public profile.
    attachManagement: (actions, submissionId, applied) =>
      attachOwnerTimeTrialManagement(actions, submissionId, {
        onChanged: (result) => applied(
          result.current.totalTimeMs,
          result.retirementState === "retired",
        ),
      }),
  },
  /**
   * Who is looking, and how to reach somebody. The viewer is a promise on
   * purpose: the profile is public and must never wait on a session to render,
   * so the poke appears a moment later rather than holding the page.
   */
  engagement: Readonly<{
    viewerPlayerId?: Promise<string | null>;
    client?: PlayerEngagementClient;
  }> = {},
): MountedPublicPlayerProfile {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("section");
  container.className = "public-player ds-root ds-profile ds-stack";
  container.setAttribute("aria-labelledby", "public-player-heading");
  const status = document.createElement("p");
  status.className = "ds-page-status";
  status.setAttribute("role", "status");
  status.textContent = localized(
    "Loading public Player profile…", "Openbaar spelersprofiel laden…");
  container.append(status);
  root.append(container);

  const ready = playerClient.load(playerId, controller.signal).then(async (player) => {
    if (disposed) { return; }
    status.className = "ds-profile__handle";
    status.textContent = `@${player.username}`;
    const eyebrow: (Node | string)[] = [status];
    const flagPath = countryFlagPath(player.countryId);
    if (flagPath !== undefined) {
      const flag = document.createElement("img");
      flag.className = "ds-profile__flag";
      flag.src = `${GAME_ASSET_BASE}${flagPath}`;
      flag.alt = "";
      eyebrow.push(flag);
    }
    const appearance = avatarAppearance(player.avatarId);
    const rating = document.createElement("p");
    rating.className = "ds-profile__rating ds-data-m";
    rating.hidden = true;
    const actions = document.createElement("div");
    actions.className = "ds-cluster";
    actions.setAttribute("data-gap", "sm");
    const share = button({
      label: localized("Share profile", "Profiel delen"),
      variant: "secondary",
    });
    share.control.addEventListener("click", () => {
      // Share the name, never the internal identifier.
      const url = `${globalThis.location.origin}/?player=${
        encodeURIComponent(player.username)}`;
      const navigatorShare =
        (globalThis.navigator as Partial<Navigator> | undefined)?.share;
      if (typeof navigatorShare === "function") {
        navigatorShare.call(globalThis.navigator, {
          title: `${player.displayName} on MK8DX`,
          url,
        }).catch(() => undefined);
        return;
      }
      globalThis.navigator?.clipboard?.writeText(url).then(
        () => {
          const label = share.control.querySelector(".ds-button__label");
          if (label !== null) {
            label.textContent = localized("Link copied", "Link gekopieerd");
          }
        },
        () => undefined,
      );
    });
    actions.append(share.root);
    const art = appearance === undefined
      ? undefined
      : `${GAME_ASSET_BASE}${appearance.iconPath}`;
    const hero = artHero({
      spectacle: "medium",
      title: player.displayName,
      titleId: "public-player-heading",
      // This is the route's visible page title. Keeping the same display step preserves the visual
      // hierarchy while giving the shell and assistive technology one real page-level heading.
      titleLevel: 1,
      titleStep: "display-3",
      eyebrow,
      ...(art === undefined ? {} : { thumb: { src: art, shape: "square" as const } }),
      children: [rating],
      aside: [actions],
    });
    container.replaceChildren(hero);
    // Put the destination switch directly below the identity. Preferences are overview content,
    // not a toll gate in front of every profile subpage.
    const reference = encodeURIComponent(player.username);
    const sectionTabs = tabs({
      label: localized("Profile sections", "Profielonderdelen"),
      items: [
        { label: localized("Overview", "Overzicht"), href: `/?player=${reference}`, current: tab === "overview" },
        { label: "Time Trials", href: `/?player=${reference}&tab=timetrials`, current: tab === "timetrials" },
        { label: "Mastery", href: `/?player=${reference}&tab=mastery`, current: tab === "mastery" },
      ],
    });
    // Filled with "You and <Player>" once the viewer is known; empty (and hidden) for visitors.
    const interactionsSlot = document.createElement("div");
    interactionsSlot.className = "ds-profile__interactions-slot";
    container.append(sectionTabs, interactionsSlot);
    // "You and <Player>" (owner 2026-09-26): what the viewer can send this Player now, what is
    // waiting for whom and everything between them. Only for a signed-in viewer on another
    // Player's Overview; notifications open it at #interactions.
    void engagement.viewerPlayerId?.then((viewerPlayerId) => {
      if (disposed) { return; }
      if (viewerPlayerId === null || viewerPlayerId === player.playerId || tab !== "overview") { return; }
      const interactions = mountPlayerInteractions(document, {
        player: { playerId: player.playerId, displayName: player.displayName },
        viewerPlayerId,
        client: engagement.client ?? createPlayerEngagementClient(),
        loadBests: async () => (await fetchTrackBestsFor([viewerPlayerId], controller.signal)).get(viewerPlayerId)
          ?.map((best) => ({ trackId: best.trackId, mode: best.mode })) ?? [],
      });
      // Directly below the section tabs, before the Overview content.
      interactionsSlot.append(interactions.root);
      void interactions.ready.then(() => {
        if (!disposed && globalThis.location?.hash === "#interactions") {
          interactions.root.scrollIntoView?.({ block: "start" });
        }
      });
    });

    const preferenceParts = [
      appearance,
      BODY_PARTS.find((part) => part.id === player.favoriteBodyId),
      TIRE_PARTS.find((part) => part.id === player.favoriteTireId),
      GLIDER_PARTS.find((part) => part.id === player.favoriteGliderId),
    ].filter((part): part is NonNullable<typeof part> => part !== undefined);
    if (tab === "overview" && (preferenceParts.length > 0 || player.countryId !== undefined || player.timeTrialModePreference !== undefined)) {
      const countryName = COUNTRY_ASSET_MANIFEST.find((country) => country.id === player.countryId)?.name;
      const summary = [
        countryName === undefined ? null : localized(`Country: ${countryName}`, `Land: ${countryName}`),
        player.timeTrialModePreference === undefined ? null : `Time Trials: ${player.timeTrialModePreference === "all" ? "150cc + 200cc" : `${player.timeTrialModePreference}cc`}`,
      ].filter((value): value is string => value !== null).join(" · ");
      const icons = document.createElement("div"); icons.className = "ds-profile__loadout";
      for (const part of preferenceParts) {
        const item = document.createElement("figure");
        item.className = "ds-profile__loadout-item";
        const presentedIconPath = appearance === undefined
          ? part.iconPath
          : matchedLoadoutVariant(part.id, appearance.id)?.iconPath ?? part.iconPath;
        const image = document.createElement("img"); image.src = `${GAME_ASSET_BASE}${presentedIconPath}`; image.alt = part.name;
        const caption = document.createElement("figcaption"); caption.textContent = part.name;
        item.append(image, caption); icons.append(item);
      }
      container.append(panel({
        title: localized("Player preferences", "Spelersvoorkeuren"),
        titleLevel: 2,
        ...(summary === "" ? {} : { note: summary }),
        children: preferenceParts.length === 0 ? [] : [icons],
      }));
    }

    const ratingLoad = ratingClient.leaderboard(controller.signal).then(
      (entries) => {
        if (disposed) { return; }
        const entry = entries.find((candidate) =>
          candidate.playerId === player.playerId);
        if (entry !== undefined) {
          rating.hidden = false;
          rating.textContent = localized(
            `#${entry.rank} of ${entries.length} · Rating ${entry.score.toFixed(2)}`,
            `#${entry.rank} van ${entries.length} · Rating ${entry.score.toFixed(2)}`,
          );
          const tier = tournamentTierByRank(entry.rank);
          if (tier !== null) {
            rating.append(" · ", tierChip(tournamentTierLabel(tier.key) ?? tier.name, tier.color));
          }
        }
      },
      () => undefined,
    );
    if (tab === "mastery") {
      const masteryRoot = document.createElement("div");
      container.append(masteryRoot);
      try {
        // An auxiliary section must never break the profile core.
        mountTrackMastery(masteryRoot, player.playerId);
      } catch {
        if (masteryRoot.parentNode === container) {
          container.removeChild(masteryRoot);
        }
      }
      await ratingLoad;
      return;
    }
    if (tab === "timetrials") {
      await Promise.all([
        ratingLoad,
        appendPublicPlayerTimeTrials(
          container,
          player.playerId,
          timeTrialClient,
          controller.signal,
          timeTrialOptions,
        ),
        appendPublicPlayerTournaments(
          container,
          player.playerId,
          tournamentClient,
          controller.signal,
        ),
      ]);
      return;
    }
    const graphRoot = document.createElement("div");
    container.append(graphRoot);
    try {
      // An auxiliary section must never break the profile core.
      mountRatingGraph(graphRoot, player.playerId);
    } catch {
      if (graphRoot.parentNode === container) {
        container.removeChild(graphRoot);
      }
    }
    const tournamentCareerRoot = document.createElement("div");
    container.append(tournamentCareerRoot);
    try {
      // An auxiliary section must never break the profile core.
      mountTournamentCareer(tournamentCareerRoot, player.playerId, player.username);
    } catch {
      if (tournamentCareerRoot.parentNode === container) {
        container.removeChild(tournamentCareerRoot);
      }
    }
    const careerRoot = document.createElement("div");
    container.append(careerRoot);
    try {
      // An auxiliary section must never break the profile core.
      mountCareerSection(careerRoot, player.playerId);
    } catch {
      if (careerRoot.parentNode === container) {
        container.removeChild(careerRoot);
      }
    }
    const aliases = document.createElement("ul");
    aliases.className = "ds-profile__aliases";
    container.append(panel({
      title: localized("Also known as", "Ook bekend als"),
      titleLevel: 2,
      children: [aliases],
    }));
    const aliasLoad = aliasClient.listForPlayer(player.playerId, controller.signal).then(
      (aliasDocument) => {
        if (disposed) { return; }
        for (const alias of aliasDocument.aliases) {
          const row = document.createElement("li");
          const name = document.createElement("strong");
          name.textContent = alias.aliasText;
          const type = document.createElement("span");
          type.textContent = aliasType(alias.aliasType);
          row.append(name, type);
          aliases.append(row);
        }
        if (aliasDocument.aliases.length === 0) {
          const empty = document.createElement("li");
          empty.textContent = localized(
            "No reviewed public aliases.", "Geen gecontroleerde openbare aliassen.");
          aliases.append(empty);
        }
      },
      () => {
        if (!disposed) {
          const unavailable = document.createElement("li");
          unavailable.textContent = localized(
            "Public aliases are temporarily unavailable.",
            "Openbare aliassen zijn tijdelijk niet beschikbaar.");
          aliases.append(unavailable);
        }
      },
    );
    await Promise.all([ratingLoad, aliasLoad]);
  }).catch((error) => {
    if (disposed) { return; }
    status.className = "ds-page-status";
    status.textContent = error instanceof PublicPlayerClientError && error.code === "not_found"
      ? localized("This public Player profile was not found.", "Dit openbare spelersprofiel is niet gevonden.")
      : localized(
        "This public Player profile could not be loaded. Retry from the Player Hub.",
        "Dit openbare spelersprofiel kon niet worden geladen. Probeer het opnieuw via de spelershub.");
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

/**
 * The route's way in: the profile, plus who is looking. The clients keep their
 * places in the full signature for the tests that supply them.
 */
export function mountPublicPlayerProfileForViewer(
  root: HTMLElement,
  playerId: string,
  tab: PublicProfileTab = "overview",
  viewerPlayerId?: Promise<string | null>,
): MountedPublicPlayerProfile {
  return mountPublicPlayerProfile(
    root, playerId, tab,
    createPublicPlayerClient(), createPlayerAliasClient(),
    createPublicTimeTrialClient(), createTournamentPublicationClient(),
    createRatingClient(), undefined,
    viewerPlayerId === undefined ? {} : { viewerPlayerId },
  );
}
