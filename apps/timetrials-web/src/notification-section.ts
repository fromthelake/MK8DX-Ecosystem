// Notification inbox — the recovered and evolved historical feature:
// aggregated, readable messages ("Frank beat 4 of your Time Trial
// times") with deep links into the product, unread emphasis, and
// mark-read controls. Rendered only for signed-in users.

import { leaderboardHref } from "./engine-context.js";
import { trackAsset } from "./asset-manifest.js";
import { engineMark, useDocument } from "./ds-components.js";
import { localized } from "./product-language.js";
import { trackThumb } from "./track-thumb.js";
import { createPlayerEngagementClient, type PlayerEngagementClient } from "./player-engagement-client.js";
import {
  createNotificationClient,
  type NotificationClient,
  type NotificationEventView,
  type NotificationView,
} from "./notification-client.js";

export type MountedNotificationSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function trackName(trackId: string | undefined): string | undefined {
  return trackId === undefined ? undefined : trackAsset(trackId)?.name;
}

function notificationThumb(
  document: Document,
  trackId: string,
  mode: 150 | 200 | undefined,
  href: string | null = null,
  showCupName = false,
): HTMLElement | null {
  const asset = trackAsset(trackId);
  if (asset === undefined) { return null; }
  useDocument(document);
  // The compact inbox identity keeps the recognisable art, cup icon and
  // engine mark, while the full-width lower label only names the track. The
  // cup name is useful on roomy track cards but duplicates the icon here and
  // makes this short row unnecessarily tall.
  const root = trackThumb(document, {
    trackId,
    ...(mode === undefined ? {} : { mode }),
    compact: true,
    href,
    showCupName,
  });
  if (root === null) { return null; }
  root.classList.add("ds-notifications__art");
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `${asset.name}, ${asset.cup.name}${mode === undefined ? "" : `, ${mode}cc`}`);
  return root;
}

/**
 * The line for one inbox entry.
 *
 * `withThumb` says the track artwork is already beside this line naming the
 * track, the cup and the engine class. Repeating "on Mount Wario" next to a
 * picture of Mount Wario labelled Mount Wario is noise, and it is the noise
 * that pushes the part you actually need off a narrow screen.
 */
export function notificationMessage(
  view: NotificationView, withThumb = false,
): string {
  const actor = view.actorDisplayName ?? localized("Somebody", "Iemand");
  const track = withThumb ? undefined : trackName(view.trackId);
  const on = track === undefined ? "" : localized(` on ${track}`, ` op ${track}`);
  // The artwork beside the line already names the class, so the line does
  // not repeat it - the same reason it stops naming the track there.
  const mode = withThumb || view.mode === undefined ? "" : ` · ${view.mode}cc`;
  const gap = view.deltaMs === undefined || view.deltaMs === 0
    ? null
    : localized(
      `${(Math.abs(view.deltaMs) / 1000).toFixed(3)}`,
      `${(Math.abs(view.deltaMs) / 1000).toFixed(3)}`.replace(".", ","),
    );
  switch (view.kind) {
    // The line a Player reads most, so it says the thing that happened rather
    // than a verb they have to decode: who, by how much, where, and where they
    // now stand. "Frank passed you" left out the two numbers that matter.
    case "overtaken": {
      const rank = view.recipientRank === undefined
        ? ""
        : localized(` · you are now #${view.recipientRank}`, ` · jij staat nu #${view.recipientRank}`);
      const head = gap === null
        ? localized(`${actor} beat your time${on}`, `${actor} was sneller dan jij${on}`)
        : localized(
          `${actor} beat your time${on} by ${gap}s`,
          `${actor} was ${gap}s sneller${on}`,
        );
      return `${head}${mode}${rank}`;
    }
    case "reaction_received":
      return view.count === 1
        ? localized(
          `${actor} reacted to your ${track ?? "Time Trial"} time`,
          `${actor} reageerde op je tijd${on}`,
        )
        : localized(
          `${view.count} reactions on your ${track ?? "Time Trial"} time`,
          `${view.count} reacties op je tijd${on}`,
        );
    case "claim_decided":
      return claimDecidedTitle(view.detail);
    case "claim_requested":
      if (view.detail === "reply") {
        return view.actorDisplayName === undefined
          ? localized("An answer to your question about a link request", "Antwoord op je vraag over een koppelverzoek")
          : localized(
            `An answer to your question about ${view.actorDisplayName}`,
            `Antwoord op je vraag over ${view.actorDisplayName}`,
          );
      }
      return view.actorDisplayName === undefined
        ? localized("Somebody asks to be linked to a Player", "Iemand wil aan een speler gekoppeld worden")
        : localized(
          `Somebody asks to be linked to ${view.actorDisplayName}`,
          `Iemand wil gekoppeld worden aan ${view.actorDisplayName}`,
        );
    case "result_published":
      return localized(
        `Your ${track ?? "Time Trial"} time is published`,
        `Je tijd${on} staat online`,
      );
    case "group_invited":
      return localized(
        `${actor} invited you to ${view.groupName ?? "a Group"}`,
        `${actor} nodigde je uit voor ${view.groupName ?? "een groep"}`,
      );
    case "group_joined":
      return localized(
        `${actor} joined ${view.groupName ?? "your Group"}`,
        `${actor} kwam bij ${view.groupName ?? "je groep"}`,
      );
    case "group_left":
      return localized(
        `${actor} left ${view.groupName ?? "your Group"}`,
        `${actor} verliet ${view.groupName ?? "je groep"}`,
      );
    case "group_removed":
      return view.detail === "archived"
        ? localized(
          `${view.groupName ?? "A Group"} was archived`,
          `${view.groupName ?? "Een groep"} is gearchiveerd`,
        )
        : localized(
          `You were removed from ${view.groupName ?? "a Group"}`,
          `Je bent verwijderd uit ${view.groupName ?? "een groep"}`,
        );
    case "group_role_changed":
      return localized(
        `Your role in ${view.groupName ?? "a Group"} is now ${view.detail ?? "updated"}`,
        `Je rol in ${view.groupName ?? "een groep"} is nu ${view.detail ?? "gewijzigd"}`,
      );
    case "world_record":
      // One entry counts every record broken since it was last read, so it has
      // to say how many rather than name one track as if it were the only one.
      if (withThumb) {
        return view.count > 1
          ? localized(
            `${view.count} new World Records · most recently`,
            `${view.count} nieuwe wereldrecords · laatst`,
          )
          : localized("New World Record", "Nieuw wereldrecord");
      }
      return view.count > 1
        ? localized(
          `${view.count} new World Records · most recently ${view.mode ?? ""}cc on ${track ?? "a track"}`,
          `${view.count} nieuwe wereldrecords · laatst ${view.mode ?? ""}cc op ${track ?? "een baan"}`,
        )
        : localized(
          `New ${view.mode ?? ""}cc World Record on ${track ?? "a track"}`,
          `Nieuw ${view.mode ?? ""}cc-wereldrecord op ${track ?? "een baan"}`,
        );
    case "poke":
      // One entry counts every poke since it was last read, so a Player who
      // was poked five times reads one line rather than five.
      return view.count > 1
        ? localized(`${actor} poked you ${view.count} times`, `${actor} porde je ${view.count} keer`)
        : localized(`${actor} poked you`, `${actor} gaf je een por`);
    case "rock_paper_scissors":
      return view.detail === "result"
        ? localized(`${actor} answered your rock-paper-scissors game`, `${actor} beantwoordde je steen-papier-schaarspel`)
        : localized(`${actor} invited you to rock-paper-scissors`, `${actor} nodigde je uit voor steen-papier-schaar`);
    case "dice_roll":
      return diceNotice(actor, view.detail);
    case "challenge":
      return localized(`${actor} challenged you${on}`, `${actor} daagde je uit${on}`);
    case "host_requested":
      return hostRequestedTitle(view);
    case "host_request_decided":
      return hostRequestDecidedTitle(view.detail);
    case "tournament_signup_selected":
    case "tournament_signup_moved_up":
    case "tournament_signup_removed":
      return signupTitle(view);
  }
}

/** A change of the viewer's own sign-up (ADR-0222), naming the night when it is known. */
function signupTitle(view: NotificationView): string {
  const night = view.tournamentName;
  if (view.kind === "tournament_signup_removed") {
    return night === undefined
      ? localized("The Director took you off the list", "De Directeur heeft je van de lijst gehaald")
      : localized(`The Director took you off the list for ${night}`, `De Directeur heeft je van de lijst voor ${night} gehaald`);
  }
  if (view.kind === "tournament_signup_moved_up") {
    return night === undefined
      ? localized("You moved up from the waiting list: you're in", "Je bent van de wachtlijst doorgeschoven: je doet mee")
      : localized(`You moved up from the waiting list: you're in for ${night}`, `Je bent van de wachtlijst doorgeschoven: je doet mee aan ${night}`);
  }
  if (view.detail === "waiting") {
    return night === undefined
      ? localized("You're on the waiting list", "Je staat op de wachtlijst")
      : localized(`You're on the waiting list for ${night}`, `Je staat op de wachtlijst voor ${night}`);
  }
  return night === undefined
    ? localized("You're in", "Je doet mee")
    : localized(`You're in for ${night}`, `Je doet mee aan ${night}`);
}

/** Somebody asked to host Tournaments (ADR-0220); the actor is their Player when they have one. */
function hostRequestedTitle(view: NotificationView): string {
  return view.actorDisplayName === undefined
    ? localized("Somebody asks to host Tournaments", "Iemand vraagt om toernooien te hosten")
    : localized(
      `${view.actorDisplayName} asks to host Tournaments`,
      `${view.actorDisplayName} vraagt om toernooien te hosten`,
    );
}

/** The answer to the person's own request to host (ADR-0220). */
function hostRequestDecidedTitle(detail: string | undefined): string {
  return detail === "approved"
    ? localized("You are now a Director: you can host Tournaments", "Je bent nu Directeur: je kunt toernooien hosten")
    : localized("Your request to host was declined", "Je verzoek om te hosten is afgewezen");
}

/**
 * A dice notification: an invitation carries the sender's face ("4"); an answer carries
 * "<their face> vs <yours>" so it also reads sensibly in older app builds.
 */
function diceNotice(actor: string, detail: string | undefined): string {
  const result = /^(\d) vs (\d)$/u.exec(detail ?? "");
  if (result !== null) {
    const [theirs, yours] = [Number(result[1]), Number(result[2])];
    const verdict = theirs === yours ? localized("a draw", "gelijkspel")
      : yours > theirs ? localized("you won", "jij wint") : localized(`${actor} won`, `${actor} wint`);
    return localized(`${actor} rolled ${theirs} against your ${yours} — ${verdict}`,
      `${actor} gooide ${theirs} tegen jouw ${yours} — ${verdict}`);
  }
  return /^\d$/u.test(detail ?? "")
    ? localized(`${actor} rolled ${detail} — roll back to beat it`, `${actor} gooide ${detail} — gooi terug om te winnen`)
    : localized(`${actor} rolled a die`, `${actor} gooide een dobbelsteen`);
}

/** What happened to the person's own link request (ADR-0216 section 5). */
function claimDecidedTitle(detail: string | undefined): string {
  switch (detail) {
    case "verified": return localized("Your Player claim was approved", "Je koppelverzoek is goedgekeurd");
    case "rejected": return localized("Your Player claim was declined", "Je koppelverzoek is afgewezen");
    case "info_requested":
      return localized("A reviewer has a question about your Player claim", "Een beoordelaar heeft een vraag over je koppelverzoek");
    case "revoked": return localized("Your Player link was removed", "Je spelerkoppeling is verwijderd");
    case "released": return localized("Your Player link was closed", "Je spelerkoppeling is gesloten");
    default: return localized("Your Player claim was updated", "Je koppelverzoek is bijgewerkt");
  }
}

/** The APK puts a track image above the title, then keeps the title short. */
function notificationCardTitle(view: NotificationView, withThumb: boolean): string {
  const actor = view.actorDisplayName ?? localized("Someone", "Iemand");
  const track = withThumb ? undefined : trackName(view.trackId);
  const on = track === undefined ? "" : localized(` on ${track}`, ` op ${track}`);
  switch (view.kind) {
    case "overtaken": return localized(`${actor} passed you${on}.`, `${actor} passeerde je${on}.`);
    case "reaction_received": return localized(`${actor} reacted to your result.`, `${actor} reageerde op je resultaat.`);
    case "claim_decided": return `${claimDecidedTitle(view.detail)}.`;
    case "claim_requested": return view.detail === "reply"
      ? localized(`An answer about ${actor}.`, `Een antwoord over ${actor}.`)
      : localized(`Somebody asks to be linked to ${actor}.`, `Iemand wil gekoppeld worden aan ${actor}.`);
    case "result_published": return localized(`Your result was published${on}.`, `Je resultaat is gepubliceerd${on}.`);
    case "world_record": return withThumb
      ? view.count > 1
        ? localized(`${view.count} new World Records · most recently`, `${view.count} nieuwe wereldrecords · laatst`)
        : localized("New World Record", "Nieuw wereldrecord")
      : view.count > 1
        ? localized(
          `${view.count} new World Records · most recently ${view.mode ?? ""}cc${on}`,
          `${view.count} nieuwe wereldrecords · laatst ${view.mode ?? ""}cc${on}`,
        )
        : localized(
          `A new ${view.mode ?? ""}cc World Record was set${on}; Mastery has been recalculated.`,
          `Er is een nieuw ${view.mode ?? ""}cc-wereldrecord neergezet${on}; Mastery is opnieuw berekend.`,
        );
    case "group_invited": return localized(`${actor} invited you to ${view.groupName ?? "a group"}.`, `${actor} nodigde je uit voor ${view.groupName ?? "een groep"}.`);
    case "group_joined": return localized(`${actor} joined ${view.groupName ?? "your group"}.`, `${actor} kwam bij ${view.groupName ?? "je groep"}.`);
    case "group_left": return localized(`${actor} left ${view.groupName ?? "your group"}.`, `${actor} verliet ${view.groupName ?? "je groep"}.`);
    case "group_removed": return localized(`A membership changed in ${view.groupName ?? "your group"}.`, `Een lidmaatschap wijzigde in ${view.groupName ?? "je groep"}.`);
    case "group_role_changed": return localized(`A role changed in ${view.groupName ?? "your group"}.`, `Een rol wijzigde in ${view.groupName ?? "je groep"}.`);
    case "poke": return localized(`${actor} poked you.`, `${actor} gaf je een por.`);
    case "rock_paper_scissors": return view.detail === "result"
      ? localized(`${actor} answered your game.`, `${actor} beantwoordde je spel.`)
      : localized(`${actor} challenged you to rock-paper-scissors.`, `${actor} daagt je uit voor steen-papier-schaar.`);
    case "dice_roll": return `${diceNotice(actor, view.detail)}.`;
    case "challenge": return localized(`${actor} challenged you${on}.`, `${actor} daagde je uit${on}.`);
    case "host_requested": return `${hostRequestedTitle(view)}.`;
    case "host_request_decided": return `${hostRequestDecidedTitle(view.detail)}.`;
    case "tournament_signup_selected":
    case "tournament_signup_moved_up":
    case "tournament_signup_removed":
      return `${signupTitle(view)}.`;
  }
}

function notificationCardDetail(view: NotificationView): string {
  if (view.kind === "rock_paper_scissors") {
    return view.detail === "result"
      ? localized("Open to see who won.", "Open om te zien wie won.")
      : localized("Open to choose your hand.", "Open om je zet te kiezen.");
  }
  if (view.kind === "dice_roll") {
    return /^\d$/u.test(view.detail ?? "")
      ? localized("Open to roll back.", "Open om terug te gooien.")
      : localized("Open to see your duels.", "Open om je duels te zien.");
  }
  if (view.kind === "challenge") {
    return [view.mode === undefined ? null : `${view.mode}cc`,
      view.actorTimeMs === undefined ? null : localized(`Beat ${timeText(view.actorTimeMs)}`, `Verbeter ${timeText(view.actorTimeMs)}`)]
      .filter((part): part is string => part !== null).join(" · ");
  }
  if (view.kind === "overtaken") {
    return [
      view.mode === undefined ? null : `${view.mode}cc`,
      view.deltaMs === undefined || view.deltaMs === 0 ? null : localized(
        `${(Math.abs(view.deltaMs) / 1000).toFixed(3)}s faster`,
        `${(Math.abs(view.deltaMs) / 1000).toFixed(3)}s sneller`,
      ),
      view.recipientRank === undefined ? null : localized(`you are now #${view.recipientRank}`, `je staat nu #${view.recipientRank}`),
    ].filter((part): part is string => part !== null).join(" · ");
  }
  return view.detail?.trim() ?? "";
}

export function notificationLink(
  view: NotificationView,
  _ownPlayerId: string | null,
): string | null {
  switch (view.kind) {
    case "overtaken":
      return view.trackId === undefined
        ? "/?notifications=1"
        : leaderboardHref(view.trackId, view.mode, { notification: String(view.notificationId) });
    case "reaction_received":
    case "result_published":
      return view.trackId === undefined
        ? null
        : leaderboardHref(view.trackId, view.mode);
    case "claim_decided":
      return "/?settings=1";
    // Administrators and Directors both review link requests there (ADR-0216).
    case "claim_requested":
      return "/?admin=1";
    case "group_invited":
    case "group_joined":
    case "group_left":
    case "group_removed":
    case "group_role_changed":
      return "/?settings=1&section=groups";
    case "world_record":
      return view.trackId === undefined
        ? "/?ranking=timetrials"
        : leaderboardHref(view.trackId, view.mode);
    case "rock_paper_scissors":
    case "dice_roll":
    case "poke":
      // Straight to "You and <sender>" on their profile: answer the game, roll back or poke back
      // there, beside everything else between the two (owner 2026-09-26).
      return view.actorPlayerId === undefined
        ? "/?notifications=1#player-games"
        : `/?player=${encodeURIComponent(view.actorPlayerId)}#interactions`;
    case "challenge":
      // A challenge names a track, and the point of it is the leaderboard.
      return view.trackId === undefined
        ? (view.actorPlayerId === undefined
          ? null
          : `/?player=${encodeURIComponent(view.actorPlayerId)}`)
        : leaderboardHref(view.trackId, view.mode);
    // ADR-0220: administrators answer in the Directors section; the person reads it on Tournaments.
    case "host_requested":
      return "/?admin=tournaments";
    case "host_request_decided":
      return "/?tournaments=1";
    // ADR-0222: the night's own page, where the status line says what happens next.
    case "tournament_signup_selected":
    case "tournament_signup_moved_up":
    case "tournament_signup_removed":
      return view.tournamentId === undefined
        ? "/?tournaments=1"
        : `/?tournaments=${encodeURIComponent(view.tournamentId)}`;
  }
}

/** "1:59.317", or nothing when there is no time to show. */
function timeText(totalMs: number | undefined): string {
  if (totalMs === undefined) { return ""; }
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${
    String(totalMs % 1000).padStart(3, "0")}`;
}

/**
 * One line of what an entry counted.
 *
 * The aggregate says "49 new World Records"; a member says which one. The
 * phrasing follows the kind, because the same three columns mean different
 * things: a track and a mode for a World Record, a Player and a gap for
 * somebody passing you, a Player and a name for a poke.
 */
export function notificationEventMessage(
  kind: NotificationView["kind"],
  event: NotificationEventView,
): string {
  const track = trackName(event.trackId) ?? event.trackId;
  const mode = event.mode === undefined ? "" : `${event.mode}cc`;
  switch (kind) {
    case "world_record": {
      const where = track === undefined ? "a track" : track;
      return mode === "" ? `New World Record on ${where}` : `${mode} · ${where}`;
    }
    case "overtaken": {
      const gap = event.actorTimeMs !== undefined && event.recipientTimeMs !== undefined
        ? ` · ${((event.recipientTimeMs - event.actorTimeMs) / 1000).toFixed(3)}s faster`
        : "";
      const rank = event.recipientRank === undefined
        ? "" : ` · you are now #${event.recipientRank}`;
      const time = timeText(event.actorTimeMs);
      return `${event.actorDisplayName ?? "Someone"}${
        track === undefined ? "" : ` on ${track}`}${
        mode === "" ? "" : ` (${mode})`}${time === "" ? "" : ` · ${time}`}${gap}${rank}`;
    }
    case "reaction_received":
      return `${event.actorDisplayName ?? "A Player"} reacted${
        track === undefined ? "" : ` on ${track}`}${mode === "" ? "" : ` (${mode})`}`;
    case "poke":
    case "rock_paper_scissors":
    case "dice_roll":
    case "challenge":
      return `${event.actorDisplayName ?? "Someone"}${
        event.detail === undefined ? "" : ` · ${event.detail}`}${
        track === undefined ? "" : ` · ${track}`}`;
    default:
      return [event.actorDisplayName, track, mode, event.detail]
        .filter((part): part is string => typeof part === "string" && part !== "")
        .join(" · ") || "One event";
  }
}

/**
 * What the thumb cannot say.
 *
 * The artwork already carries the track, the cup and the engine class, so
 * repeating "200cc · Big Blue" beside a picture of Big Blue labelled 200cc is
 * noise. A World Record member has nothing left to add and says nothing; an
 * overtake still owes you who, by how much and where you stand now.
 */
export function notificationEventMemberDetail(
  kind: NotificationView["kind"],
  event: NotificationEventView,
): string {
  switch (kind) {
    case "world_record":
      return "";
    case "overtaken": {
      const gap = event.actorTimeMs !== undefined && event.recipientTimeMs !== undefined
        ? `${((event.recipientTimeMs - event.actorTimeMs) / 1000).toFixed(3)}s faster`
        : "";
      const time = timeText(event.actorTimeMs);
      return [
        event.actorDisplayName ?? "Someone",
        time,
        gap,
        event.recipientRank === undefined ? "" : `you are now #${event.recipientRank}`,
      ].filter((part) => part !== "").join(" · ");
    }
    case "reaction_received":
      return `${event.actorDisplayName ?? "A Player"} reacted`;
    default:
      return [event.actorDisplayName, event.detail]
        .filter((part): part is string => typeof part === "string" && part !== "")
        .join(" · ");
  }
}

function relativeDate(timestampMs: number, nowMs: number): string {
  const difference = Math.max(0, nowMs - timestampMs);
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) { return minutes <= 1 ? "just now" : `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) { return `${hours}h ago`; }
  const days = Math.floor(hours / 24);
  if (days < 60) { return `${days}d ago`; }
  return `${Math.floor(days / 30)}mo ago`;
}

function notificationDate(timestampMs: number): string {
  if (timestampMs <= 0) { return ""; }
  const date = new Date(timestampMs);
  const locale = typeof navigator === "undefined" ? "nl-NL" : navigator.language;
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric",
  }).format(date).replace(/\.$/u, "");
  return `${day} · ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function mountNotificationSection(
  root: HTMLElement,
  ownPlayerId: string | null = null,
  client: NotificationClient = createNotificationClient(),
  nowMs: () => number = () => new Date().getTime(),
  previewLimit: number | null = null,
  engagementClient: PlayerEngagementClient = createPlayerEngagementClient(),
): MountedNotificationSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;

  const container = document.createElement("section");
  container.className = previewLimit === null
    ? "ds-root ds-notifications notifications"
    : "notifications";
  container.setAttribute("aria-label", "Notifications");
  const header = document.createElement("div");
  header.className = "notifications__header ds-panel__header";
  const titleBlock = document.createElement("div");
  titleBlock.className = "notifications__title-block";
  const heading = document.createElement(previewLimit === null ? "h1" : "h2");
  heading.className = previewLimit === null ? "ds-display-3" : "ds-title";
  heading.textContent = localized("Notifications", "Meldingen");
  titleBlock.append(heading);
  if (previewLimit === null) {
    const intro = document.createElement("p");
    intro.className = "notifications__intro ds-body-s";
    intro.textContent = localized(
      "Times beaten, reactions, results and required app updates.",
      "Verslagen tijden, reacties, resultaten en vereiste app-updates.",
    );
    titleBlock.append(intro);
  }
  const summary = document.createElement("div");
  summary.className = "notifications__summary";
  const badge = document.createElement("span");
  badge.className = "notifications__badge ds-chip ds-num";
  badge.setAttribute("data-tone", "info");
  const markAll = document.createElement("button");
  markAll.type = "button";
  markAll.className = "ds-button notifications__mark-all";
  markAll.setAttribute("data-variant", "quiet");
  markAll.textContent = localized("Mark all read", "Alles gelezen");
  markAll.hidden = true;
  summary.append(badge, markAll);
  header.append(titleBlock, summary);
  const status = document.createElement("p");
  status.className = "notifications__status ds-body-s";
  status.setAttribute("role", "status");
  status.textContent = "Loading notifications…";
  const list = document.createElement("ul");
  list.className = "notifications__list ds-stack";
  container.append(header, status, list);
  const games = document.createElement("section");
  games.id = "player-games";
  games.className = "notifications__games ds-stack";
  if (previewLimit === null) { container.append(games); }
  // A Home preview earns its space only when something is unread; the
  // topbar bell is the permanent entrance to the full inbox.
  if (previewLimit !== null) { container.hidden = true; }
  root.append(container);

  /** The cluster underneath a grouped entry, opened on demand. */
  const groupDetail = (view: NotificationView): HTMLElement => {
    const details = document.createElement("details");
    details.className = "notifications__group";
    const summary = document.createElement("summary");
    summary.className = "notifications__group-summary";
    summary.textContent = localized(
      `Show all ${view.count}`, `Toon alle ${view.count}`,
    );
    const body = document.createElement("div");
    body.className = "notifications__group-body";
    details.append(summary, body);
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) { return; }
      loaded = true;
      const loading = document.createElement("p");
      loading.className = "notifications__group-note";
      loading.textContent = localized("Loading…", "Laden…");
      body.append(loading);
      client.events(view.notificationId, controller.signal)
        .then((events) => {
          if (disposed) { return; }
          while (body.firstChild !== null) { body.removeChild(body.firstChild); }
          if (events.length === 0) {
            // Honest rather than empty: entries counted before the members
            // were kept still show a truthful count and have nothing to open.
            const none = document.createElement("p");
            none.className = "notifications__group-note";
            none.textContent = localized(
              "This entry was counted before the individual events were kept.",
              "Deze melding is geteld voordat de afzonderlijke gebeurtenissen werden bewaard.",
            );
            body.append(none);
            return;
          }
          const inner = document.createElement("ul");
          inner.className = "notifications__group-list";
          const now = nowMs();
          for (const event of events) {
            const item = document.createElement("li");
            // A member is a track too, and this is where recognising it
            // matters most: forty-nine lines of prose is a list, forty-nine
            // thumbs is the answer to "which ones".
            const link = notificationLink(
              {
                ...view,
                ...(event.trackId === undefined ? {} : { trackId: event.trackId }),
                ...(event.mode === undefined ? {} : { mode: event.mode }),
                ...(event.actorPlayerId === undefined
                  ? {} : { actorPlayerId: event.actorPlayerId }),
              },
              ownPlayerId,
            );
            const memberThumb = event.trackId === undefined
              ? null
              : notificationThumb(document, event.trackId, event.mode, link);
            const detail = document.createElement("span");
            detail.textContent = memberThumb === null
              ? notificationEventMessage(view.kind, event)
              : notificationEventMemberDetail(view.kind, event);
            const when = document.createElement("span");
            when.className = "notifications__when ds-notice__when";
            when.textContent = relativeDate(event.occurredAtMs, now);
            if (memberThumb !== null) {
              item.append(memberThumb, detail, when);
            } else if (link === null) {
              item.append(detail, when);
            } else {
              const anchor = document.createElement("a");
              anchor.className = "notifications__link ds-notice__copy";
              anchor.setAttribute("href", link);
              anchor.append(detail);
              item.append(anchor, when);
            }
            inner.append(item);
          }
          body.append(inner);
          if (events.length < view.count) {
            const partial = document.createElement("p");
            partial.className = "notifications__group-note";
            partial.textContent = localized(
              `Showing the most recent ${events.length} of ${view.count}.`,
              `De ${events.length} meest recente van ${view.count} worden getoond.`,
            );
            body.append(partial);
          }
        })
        .catch(() => {
          if (disposed) { return; }
          while (body.firstChild !== null) { body.removeChild(body.firstChild); }
          const failed = document.createElement("p");
          failed.className = "notifications__group-note";
          failed.textContent = localized(
            "These could not be loaded.", "Deze konden niet worden geladen.",
          );
          body.append(failed);
          loaded = false;
        });
    });
    return details;
  };

  const renderInbox = (
    unreadCount: number,
    notifications: readonly NotificationView[],
  ): void => {
    const badgeNavigator = document.defaultView?.navigator as
      | (Navigator & { setAppBadge?: (value: number) => Promise<void>; clearAppBadge?: () => Promise<void> })
      | undefined;
    if (unreadCount > 0) {
      void badgeNavigator?.setAppBadge?.(unreadCount).catch(() => undefined);
    } else {
      void badgeNavigator?.clearAppBadge?.().catch(() => undefined);
    }
    while (list.firstChild !== null) { list.removeChild(list.firstChild); }
    if (previewLimit !== null) {
      container.hidden = unreadCount === 0;
      if (container.hidden) { return; }
    }
    badge.textContent = previewLimit !== null
      ? (unreadCount > 0 ? String(unreadCount) : "")
      : unreadCount === 0
        ? localized("You're all caught up", "Je bent helemaal bijgewerkt")
        : localized(`${unreadCount} unread`, `${unreadCount} ongelezen`);
    badge.setAttribute("data-tone", unreadCount === 0 ? "success" : "warning");
    markAll.hidden = unreadCount === 0;
    if (notifications.length === 0) {
      status.textContent = previewLimit === null
        ? localized("No notifications yet.", "Nog geen meldingen.")
        : "Nothing yet — drive some times and the community will respond.";
      return;
    }
    status.textContent = "";
    const now = nowMs();
    const shown = previewLimit === null
      ? notifications
      : notifications.slice(0, previewLimit);
    for (const view of shown) {
      const row = document.createElement("li");
      row.className = view.read
        ? "notifications__item ds-notice"
        : "notifications__item ds-notice notifications__item--unread";
      if (!view.read) { row.setAttribute("data-unread", ""); }
      const link = notificationLink(view, ownPlayerId);
      // Most of what arrives here happened on a track, and Activity already
      // proved you recognise Mount Wario before you have read the word. The
      // same thumb, so the inbox reads like the rest of the product rather
      // than like a log.
      const thumb = view.trackId === undefined
        ? null
        : notificationThumb(document, view.trackId, view.mode, null, previewLimit === null);
      if (thumb !== null) { row.append(thumb); }
      const message = previewLimit === null
        ? notificationCardTitle(view, thumb !== null)
        : notificationMessage(view, thumb !== null);
      const text = document.createElement("div");
      text.className = "notifications__body";
      const markRead = (): HTMLButtonElement => {
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "notifications__mark-read ds-button";
        dismiss.setAttribute("data-variant", "quiet");
        dismiss.textContent = localized("Mark as read", "Markeer als gelezen");
        dismiss.setAttribute("aria-label", localized(
          `Mark as read: ${message}`, `Markeer als gelezen: ${message}`,
        ));
        dismiss.addEventListener("click", () => {
          dismiss.disabled = true;
          client.markRead([view.notificationId], controller.signal)
            .then(async () => { if (!disposed) { await reload(); } })
            .catch(() => { if (!disposed) { dismiss.disabled = false; } });
        });
        return dismiss;
      };
      if (previewLimit !== null) {
        if (!view.read) {
          const unread = document.createElement("span");
          unread.className = "ds-visually-hidden";
          unread.textContent = localized("Unread: ", "Ongelezen: ");
          text.append(unread);
        }
        if (link === null) {
          const plain = document.createElement("span");
          plain.textContent = message;
          text.append(plain);
        } else {
          const anchor = document.createElement("a");
          anchor.className = "notifications__link ds-notice__copy";
          anchor.setAttribute("href", link);
          anchor.textContent = message;
          if (!view.read) { anchor.addEventListener("click", () => { void client.markRead([view.notificationId]).catch(() => undefined); }); }
          text.append(anchor);
        }
        const when = document.createElement("span");
        when.className = "notifications__when ds-notice__when";
        when.textContent = relativeDate(view.lastEventAtMs, now);
        text.append(when);
        if (!view.read) { text.append(markRead()); }
        row.append(text);
        list.append(row);
        continue;
      }

      const titleRow = document.createElement("div");
      titleRow.className = "notifications__title-row";
      const title = document.createElement("strong");
      title.className = "notifications__title ds-notice__copy";
      title.textContent = message;
      titleRow.append(title);
      if (!view.read) {
        const unread = document.createElement("span");
        unread.className = "notifications__unread ds-chip";
        unread.setAttribute("data-tone", "warning");
        unread.textContent = localized("Unread", "Ongelezen");
        titleRow.append(unread);
      }
      text.append(titleRow);
      if (thumb === null && view.mode !== undefined) {
        useDocument(document);
        const mode = engineMark(view.mode);
        mode.classList.add("notifications__engine");
        text.append(mode);
      }
      const detailCopy = notificationCardDetail(view);
      if (detailCopy !== "") {
        const detail = document.createElement("p");
        detail.className = "notifications__detail ds-body";
        detail.textContent = detailCopy;
        text.append(detail);
      }
      const actions = document.createElement("div");
      actions.className = "notifications__actions";
      if (link !== null) {
        const open = document.createElement("a");
        open.className = "notifications__link notifications__open ds-button";
        open.setAttribute("data-variant", "secondary");
        open.setAttribute("href", link);
        open.textContent = view.trackId === undefined
          ? localized("Open", "Open")
          : localized("Open track", "Open circuit");
        if (!view.read) { open.addEventListener("click", () => { void client.markRead([view.notificationId]).catch(() => undefined); }); }
        actions.append(open);
      }
      if (!view.read) { actions.append(markRead()); }
      if (actions.children.length > 0) { text.append(actions); }
      // An entry that counted more than one thing can be opened. The forty-eight
      // World Records it did not name are the point of it; the summary alone
      // used to be the end of the road. Loaded when opened, not before: an inbox
      // of twenty aggregates should still be one request.
      if (view.count > 1 && previewLimit === null) {
        text.append(groupDetail(view));
      }
      const when = document.createElement("span");
      when.className = "notifications__when ds-notice__when";
      when.textContent = notificationDate(view.lastEventAtMs);
      text.append(when);
      row.append(text);
      list.append(row);
    }
    if (previewLimit !== null && notifications.length > shown.length) {
      const more = document.createElement("li");
      const viewAll = document.createElement("a");
      viewAll.className = "notifications__link ds-button";
      viewAll.setAttribute("data-variant", "quiet");
      viewAll.setAttribute("href", "/?notifications=1");
      viewAll.textContent = "View all notifications";
      more.append(viewAll);
      list.append(more);
    }
  };

  const reload = async (): Promise<void> => {
    const inbox = await client.inbox(controller.signal);
    if (disposed) { return; }
    renderInbox(inbox.unreadCount, inbox.notifications);
  };

  const reloadGames = async (): Promise<void> => {
    if (previewLimit !== null) { return; }
    let inbox: Awaited<ReturnType<PlayerEngagementClient["list"]>>;
    try { inbox = await engagementClient.list(); }
    catch { return; }
    if (disposed) { return; }
    const visible = inbox.engagements.filter((entry) => entry.kind !== "poke").slice(0, 20);
    games.replaceChildren();
    if (visible.length === 0) { return; }
    const heading = document.createElement("h2");
    heading.className = "ds-title";
    heading.textContent = localized("Player games and challenges", "Spelletjes en uitdagingen");
    games.append(heading);
    const stats = document.createElement("p");
    stats.className = "ds-body-s";
    stats.textContent = localized(
      `Rock-paper-scissors: ${inbox.rpsStats.wins} wins · ${inbox.rpsStats.losses} losses · ${inbox.rpsStats.draws} draws`,
      `Steen-papier-schaar: ${inbox.rpsStats.wins} winst · ${inbox.rpsStats.losses} verlies · ${inbox.rpsStats.draws} gelijk`,
    );
    games.append(stats);
    for (const entry of visible) {
      const card = document.createElement("article");
      card.className = "notifications__game ds-panel";
      const title = document.createElement("strong");
      title.className = "ds-title-s";
      const detail = document.createElement("p");
      detail.className = "ds-body-s";
      const extras = document.createElement("div");
      extras.className = "ds-cluster";
      if (entry.kind === "rock_paper_scissors") {
        title.textContent = localized("Rock, paper, scissors", "Steen, papier, schaar");
        if (entry.detail?.outcome !== undefined) {
          const winner = entry.detail.outcome === "draw"
            ? localized("Draw", "Gelijkspel")
            : entry.detail.outcome === "actor" ? entry.actorDisplayName : entry.recipientDisplayName;
          detail.textContent = `${entry.actorDisplayName ?? entry.actorPlayerId}: ${entry.detail.hand} · ` +
            `${entry.recipientDisplayName ?? entry.recipientPlayerId}: ${entry.detail.recipientHand} · ` +
            localized(`Winner: ${winner}`, `Winnaar: ${winner}`);
        } else if (entry.detail === undefined) {
          detail.textContent = localized(`${entry.actorDisplayName ?? "A Player"} is waiting for your hand.`,
            `${entry.actorDisplayName ?? "Een speler"} wacht op jouw zet.`);
          const hands = document.createElement("div");
          hands.className = "ds-cluster";
          for (const [hand, en, nl] of [
            ["rock", "🪨 Rock", "🪨 Steen"],
            ["paper", "📄 Paper", "📄 Papier"],
            ["scissors", "✂️ Scissors", "✂️ Schaar"],
          ] as const) {
            const answer = document.createElement("button");
            answer.type = "button";
            answer.className = "ds-button";
            answer.setAttribute("data-variant", "secondary");
            answer.textContent = localized(en, nl);
            answer.addEventListener("click", () => {
              for (const child of Array.from(hands.querySelectorAll("button"))) { child.disabled = true; }
              void engagementClient.answer(entry.engagementId, hand).then(() => reloadGames()).catch(() => {
                detail.textContent = localized("Could not answer this game.", "Kon dit spel niet beantwoorden.");
                for (const child of Array.from(hands.querySelectorAll("button"))) { child.disabled = false; }
              });
            });
            hands.append(answer);
          }
          extras.append(hands);
        } else {
          detail.textContent = localized(`Waiting for ${entry.recipientDisplayName ?? "the other Player"}.`,
            `Wachten op ${entry.recipientDisplayName ?? "de andere speler"}.`);
        }
      } else if (entry.kind === "dice_roll") {
        title.textContent = entry.detail?.duel === true ? localized("Dice duel", "Dobbelduel") : localized("Dice roll", "Dobbelsteenworp");
        const actorName = entry.actorDisplayName ?? entry.actorPlayerId;
        const recipientName = entry.recipientDisplayName ?? entry.recipientPlayerId;
        if (entry.detail?.recipientFace !== undefined) {
          const winner = entry.detail.outcome === "draw" ? localized("Draw", "Gelijkspel")
            : entry.detail.outcome === "actor" ? actorName : recipientName;
          detail.textContent = `${actorName}: 🎲 ${entry.detail.face ?? "?"} · ${recipientName}: 🎲 ${entry.detail.recipientFace} · ` +
            localized(`Winner: ${winner}`, `Winnaar: ${winner}`);
        } else if (entry.detail?.duel === true && entry.actorPlayerId !== ownPlayerId) {
          detail.textContent = localized(`${actorName} rolled ${entry.detail.face ?? "?"} — roll back to beat it.`,
            `${actorName} gooide ${entry.detail.face ?? "?"} — gooi terug om te winnen.`);
          const rollBack = document.createElement("button");
          rollBack.type = "button";
          rollBack.className = "ds-button";
          rollBack.setAttribute("data-variant", "secondary");
          rollBack.textContent = localized("🎲 Roll back", "🎲 Gooi terug");
          rollBack.addEventListener("click", () => {
            rollBack.disabled = true;
            void engagementClient.answer(entry.engagementId).then(() => reloadGames()).catch(() => {
              detail.textContent = localized("Could not roll back.", "Kon niet terug gooien.");
              rollBack.disabled = false;
            });
          });
          extras.append(rollBack);
        } else if (entry.detail?.duel === true) {
          detail.textContent = localized(`You rolled ${entry.detail.face ?? "?"} — waiting for ${recipientName}.`,
            `Jij gooide ${entry.detail.face ?? "?"} — wacht op ${recipientName}.`);
        } else {
          detail.textContent = `${actorName} → ${recipientName}: 🎲 ${entry.detail?.face ?? "?"}`;
        }
      } else {
        title.textContent = localized("Beat my time", "Versla mijn tijd");
        const track = trackName(entry.detail?.trackId) ?? entry.detail?.trackId ?? "";
        detail.textContent = `${entry.actorDisplayName ?? entry.actorPlayerId}: ${track} · ` +
          `${entry.detail?.mode ?? "?"}cc · ${timeText(entry.detail?.totalTimeMs)}`;
        if (entry.detail?.trackId !== undefined) {
          const link = document.createElement("a");
          link.href = leaderboardHref(entry.detail.trackId, entry.detail.mode);
          link.textContent = localized("Open track", "Open circuit");
          extras.append(link);
        }
      }
      card.append(title, detail, extras);
      games.append(card);
    }
  };

  markAll.addEventListener("click", () => {
    markAll.disabled = true;
    client.markRead("all", controller.signal)
      .then(async () => {
        if (!disposed) { await reload(); }
      })
      .catch(() => undefined)
      .then(() => { markAll.disabled = false; });
  });

  const ready = reload().catch(() => {
    if (!disposed) {
      status.textContent = "Notifications are temporarily unavailable.";
    }
  });
  void reloadGames();

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
