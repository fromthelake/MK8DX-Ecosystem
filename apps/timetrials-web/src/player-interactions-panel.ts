// "You and <Player>": what the viewer can send one Player now, what is waiting for whom, and what
// happened between them (owner 2026-09-26). Pokes and challenges are once an hour; games wait for
// their answer; every refusal names its reason and every action shows up in the history at once.

import { button, chip, el } from "./ds-components.js";
import { relativeDate } from "./activity-stories.js";
import {
  PlayerEngagementClientError,
  refusalMessage,
  type Engagement,
  type EngagementAllowance,
  type EngagementConversation,
  type PlayerEngagementClient,
} from "./player-engagement-client.js";
import { localized } from "./product-language.js";
import { trackAsset } from "./asset-manifest.js";

type Hand = "rock" | "paper" | "scissors";
const HANDS: readonly (readonly [Hand, string, string, string])[] = [
  ["rock", "🪨", "Rock", "Steen"],
  ["paper", "📄", "Paper", "Papier"],
  ["scissors", "✂️", "Scissors", "Schaar"],
];
const handIcon = (hand: Hand | undefined): string => HANDS.find(([id]) => id === hand)?.[1] ?? "?";

export type TrackBestOption = Readonly<{ trackId: string; mode: 150 | 200 }>;

export type PlayerInteractionsOptions = Readonly<{
  player: Readonly<{ playerId: string; displayName: string }>;
  viewerPlayerId: string;
  client: PlayerEngagementClient;
  /** The viewer's published bests, for the challenge picker. */
  loadBests: () => Promise<readonly TrackBestOption[]>;
  nowMs?: () => number;
}>;

export type MountedPlayerInteractions = Readonly<{ root: HTMLElement; ready: Promise<void>; refresh(): Promise<void> }>;

function clockTime(atMs: number): string {
  const date = new Date(atMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function timeText(totalMs: number | undefined): string {
  if (totalMs === undefined) { return ""; }
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`;
}

/** Open: a game still waiting for its recipient. A roll from before duels never waits. */
export function isOpenGame(entry: Engagement): boolean {
  if (entry.detail?.respondedAtMs !== undefined || entry.detail?.recipientHand !== undefined) { return false; }
  if (entry.kind === "rock_paper_scissors") { return true; }
  return entry.kind === "dice_roll" && entry.detail?.duel === true;
}

/** Wins, losses and draws between the two, from the viewer's side. */
export function headToHead(entries: readonly Engagement[], viewerPlayerId: string,
  kind: "rock_paper_scissors" | "dice_roll"): Readonly<{ wins: number; losses: number; draws: number }> {
  let wins = 0; let losses = 0; let draws = 0;
  for (const entry of entries) {
    const outcome = entry.kind === kind ? entry.detail?.outcome : undefined;
    if (outcome === undefined) { continue; }
    if (outcome === "draw") { draws += 1; continue; }
    const viewerWon = (outcome === "actor") === (entry.actorPlayerId === viewerPlayerId);
    if (viewerWon) { wins += 1; } else { losses += 1; }
  }
  return { wins, losses, draws };
}

type Line = Readonly<{ icon: string; text: string; status?: Readonly<{ label: string; tone: "neutral" | "success" | "warning" | "error" | "info" }>; link?: Readonly<{ href: string; label: string }> }>;

const sentStatus = (): NonNullable<Line["status"]> => ({ label: localized("Sent", "Verstuurd"), tone: "neutral" });
const receivedStatus = (): NonNullable<Line["status"]> => ({ label: localized("Received", "Ontvangen"), tone: "info" });
const waitingStatus = (): NonNullable<Line["status"]> => ({ label: localized("Waiting", "Wacht"), tone: "neutral" });
const yourTurnStatus = (): NonNullable<Line["status"]> => ({ label: localized("Your turn", "Jouw beurt"), tone: "warning" });

/** "Big Blue · 150cc · 1:26.950": the time a challenge carries. */
function challengeTarget(entry: Engagement): string {
  const track = trackAsset(entry.detail?.trackId ?? "")?.name ?? entry.detail?.trackId ?? "";
  return `${track} · ${entry.detail?.mode ?? "?"}cc · ${timeText(entry.detail?.totalTimeMs)}`;
}

/**
 * One history entry in words, from the viewer's side. Every line has the same shape (owner
 * 2026-09-26): who did what, then a status label - Waiting, Your turn, the winner, Sent or Received.
 */
export function describeEngagement(entry: Engagement, viewerPlayerId: string, otherName: string): Line {
  const mine = entry.actorPlayerId === viewerPlayerId;
  const outcomeStatus = (outcome: "actor" | "recipient" | "draw"): NonNullable<Line["status"]> => {
    if (outcome === "draw") { return { label: localized("Draw", "Gelijk"), tone: "neutral" }; }
    const viewerWon = (outcome === "actor") === mine;
    return viewerWon
      ? { label: localized("You won", "Jij won"), tone: "success" }
      : { label: localized(`${otherName} won`, `${otherName} won`), tone: "error" };
  };
  switch (entry.kind) {
    case "poke":
      return mine
        ? { icon: "👋", text: localized(`You poked ${otherName}`, `Jij gaf ${otherName} een por`), status: sentStatus() }
        : { icon: "👋", text: localized(`${otherName} poked you`, `${otherName} gaf jou een por`), status: receivedStatus() };
    case "dice_roll": {
      const face = entry.detail?.face ?? "?";
      const answer = entry.detail?.recipientFace;
      if (answer !== undefined && entry.detail?.outcome !== undefined) {
        const viewerFace = mine ? face : answer;
        const otherFace = mine ? answer : face;
        return { icon: "🎲", text: localized(`You rolled ${viewerFace} · ${otherName} rolled ${otherFace}`,
          `Jij gooide ${viewerFace} · ${otherName} gooide ${otherFace}`), status: outcomeStatus(entry.detail.outcome) };
      }
      if (entry.detail?.duel === true) {
        return mine
          ? { icon: "🎲", text: localized(`You rolled ${face} · ${otherName} still has to roll back`,
            `Jij gooide ${face} · ${otherName} moet nog terug gooien`), status: waitingStatus() }
          : { icon: "🎲", text: localized(`${otherName} rolled ${face} · roll back to beat it`,
            `${otherName} gooide ${face} · gooi terug om te winnen`), status: yourTurnStatus() };
      }
      // A roll from before duels (before 2026-09-26) was one-way: nobody could answer it.
      return { icon: "🎲", text: mine
        ? localized(`You rolled ${face} · one-way roll from before duels`, `Jij gooide ${face} · losse worp van vóór de duels`)
        : localized(`${otherName} rolled ${face} · one-way roll from before duels`, `${otherName} gooide ${face} · losse worp van vóór de duels`),
      status: { label: localized("Old roll", "Oude worp"), tone: "neutral" } };
    }
    case "rock_paper_scissors": {
      if (entry.detail?.recipientHand !== undefined && entry.detail.outcome !== undefined) {
        const viewerHand = mine ? entry.detail.hand : entry.detail.recipientHand;
        const otherHand = mine ? entry.detail.recipientHand : entry.detail.hand;
        return { icon: "✊", text: localized(`You threw ${handIcon(viewerHand)} · ${otherName} threw ${handIcon(otherHand)}`,
          `Jij koos ${handIcon(viewerHand)} · ${otherName} koos ${handIcon(otherHand)}`), status: outcomeStatus(entry.detail.outcome) };
      }
      return mine
        ? { icon: "✊", text: localized(`You threw ${handIcon(entry.detail?.hand)} · ${otherName} still has to answer`,
          `Jij koos ${handIcon(entry.detail?.hand)} · ${otherName} moet nog antwoorden`), status: waitingStatus() }
        : { icon: "✊", text: localized(`${otherName} threw a hidden hand · pick yours`,
          `${otherName} koos een verborgen zet · kies de jouwe`), status: yourTurnStatus() };
    }
    case "challenge": {
      const link = entry.detail?.trackId === undefined ? {} : { link: {
        href: `/?leaderboard=${encodeURIComponent(entry.detail.trackId)}&mode=${entry.detail.mode ?? 150}`,
        label: localized("Open track", "Open circuit"),
      } };
      return mine
        ? { icon: "🏁", text: localized(`You challenged ${otherName} to beat ${challengeTarget(entry)}`,
          `Jij daagde ${otherName} uit om ${challengeTarget(entry)} te verbeteren`), status: sentStatus(), ...link }
        : { icon: "🏁", text: localized(`${otherName} challenged you to beat ${challengeTarget(entry)}`,
          `${otherName} daagde jou uit om ${challengeTarget(entry)} te verbeteren`), status: receivedStatus(), ...link };
    }
  }
}

/**
 * What the viewer last sent of this kind and where it stands, on the action's own card (owner
 * 2026-09-26): the die that is waiting, the hand that was thrown, the time that was sent.
 */
export function currentStateNote(kind: Engagement["kind"], conversation: EngagementConversation,
  viewerPlayerId: string, otherName: string, nowMs: number): string | null {
  const allowance = conversation.actions[kind];
  const mineOfKind = conversation.engagements.filter((entry) => entry.kind === kind && entry.actorPlayerId === viewerPlayerId);
  const when = (entry: Engagement): string => relativeDate(entry.createdAtMs, nowMs);
  const next = allowance.availableAtMs === undefined ? ""
    : localized(` · next one at ${clockTime(allowance.availableAtMs)}`, ` · volgende om ${clockTime(allowance.availableAtMs)}`);
  if (allowance.reason === "awaiting_answer") {
    const open = mineOfKind.filter(isOpenGame);
    const latest = open[0];
    if (latest === undefined) { return null; }
    const more = open.length > 1 ? localized(` (${open.length} games open)`, ` (${open.length} spellen open)`) : "";
    return kind === "dice_roll"
      ? localized(`You rolled ${latest.detail?.face ?? "?"} ${when(latest)} — waiting for ${otherName} to roll back${more}.`,
        `Jij gooide ${latest.detail?.face ?? "?"} ${when(latest)} — wacht tot ${otherName} terug gooit${more}.`)
      : localized(`You threw ${handIcon(latest.detail?.hand)} ${when(latest)} — waiting for ${otherName}'s hand${more}.`,
        `Jij koos ${handIcon(latest.detail?.hand)} ${when(latest)} — wacht op de zet van ${otherName}${more}.`);
  }
  if (allowance.reason === "cooldown") {
    const latest = mineOfKind[0];
    if (latest === undefined) { return null; }
    return kind === "challenge"
      ? localized(`You sent ${challengeTarget(latest)} ${when(latest)}${next}.`,
        `Jij stuurde ${challengeTarget(latest)} ${when(latest)}${next}.`)
      : localized(`You poked ${otherName} ${when(latest)}${next}.`, `Jij gaf ${otherName} ${when(latest)} een por${next}.`);
  }
  return null;
}

/** Why an action is closed, in the words the button's note shows. */
function allowanceNote(allowance: EngagementAllowance, otherName: string, kind: Engagement["kind"]): string | null {
  if (allowance.available) { return null; }
  switch (allowance.reason) {
    case "cooldown":
      return allowance.availableAtMs === undefined
        ? localized("Once an hour per Player.", "Eén keer per uur per speler.")
        : localized(`Next one at ${clockTime(allowance.availableAtMs)}.`, `Volgende om ${clockTime(allowance.availableAtMs)}.`);
    case "awaiting_answer":
      return kind === "dice_roll"
        ? localized(`Waiting for ${otherName} to roll back.`, `Wacht tot ${otherName} terug gooit.`)
        : localized(`Waiting for ${otherName}'s hand.`, `Wacht op de zet van ${otherName}.`);
    case "no_account":
      return localized(`${otherName} has no account yet, so they would not be notified.`,
        `${otherName} heeft nog geen account en zou geen melding krijgen.`);
    case "recipient_limit":
      return localized(`${otherName} has had the most interactions allowed today.`,
        `${otherName} heeft vandaag het maximum aantal interacties gehad.`);
    default:
      return localized(`${otherName} does not accept this from you.`, `${otherName} ontvangt dit niet van jou.`);
  }
}

export function mountPlayerInteractions(_document: Document, options: PlayerInteractionsOptions): MountedPlayerInteractions {
  const { player, viewerPlayerId, client } = options;
  const now = options.nowMs ?? ((): number => new Date().getTime());
  const other = player.displayName;
  const root = el("section", "ds-panel ds-interactions", { id: "interactions", "aria-labelledby": "interactions-heading" });
  const heading = el("h2", "ds-title", { id: "interactions-heading" }, localized(`You and ${other}`, `Jij en ${other}`));
  const record = el("p", "ds-body-s ds-interactions__record", {});
  const status = el("p", "ds-body-s ds-interactions__status", { role: "status", "aria-live": "polite" });
  const turn = el("div", "ds-interactions__turn", {});
  const actions = el("div", "ds-interactions__actions", {});
  const history = el("ol", "ds-interactions__history", { "aria-label": localized("History", "Geschiedenis") });
  root.append(heading, record, status, turn, actions,
    el("h3", "ds-kicker ds-interactions__history-title", {}, localized("History", "Geschiedenis")), history);
  let bests: readonly TrackBestOption[] | null = null;
  let busy = false;

  const act = async (work: () => Promise<string>): Promise<void> => {
    if (busy) { return; }
    busy = true;
    status.textContent = localized("Sending…", "Versturen…");
    root.setAttribute("aria-busy", "true");
    try {
      status.textContent = await work();
    } catch (error) {
      status.textContent = error instanceof PlayerEngagementClientError
        ? refusalMessage(error.refusal, localized) : refusalMessage("unavailable", localized);
    }
    busy = false;
    root.removeAttribute("aria-busy");
    await refresh().catch(() => undefined);
  };
  const notified = localized(`${other} gets a notification.`, `${other} krijgt een melding.`);

  const actionCard = (icon: string, title: string, explain: string, conversation: EngagementConversation,
    controls: readonly HTMLElement[], kind: Engagement["kind"]): HTMLElement => {
    const allowance = conversation.actions[kind];
    const note = currentStateNote(kind, conversation, viewerPlayerId, other, now()) ?? allowanceNote(allowance, other, kind);
    if (!allowance.available) {
      for (const control of controls) {
        // The control itself (a <select>) and anything interactive inside it (a button's root).
        const tag = control.tagName.toLowerCase();
        if (tag === "button" || tag === "select") { control.setAttribute("disabled", ""); }
        for (const node of [...control.querySelectorAll("button"), ...control.querySelectorAll("select")]) {
          node.setAttribute("disabled", "");
        }
      }
    }
    return el("div", "ds-interactions__action", { "data-available": allowance.available ? "true" : "false" },
      el("p", "ds-interactions__action-title", {}, el("span", "", { "aria-hidden": "true" }, icon), " ", title),
      el("p", "ds-micro ds-interactions__action-explain", {}, explain),
      el("div", "ds-cluster ds-interactions__action-controls", { "data-gap": "xs" }, ...controls),
      note === null ? null : el("p", "ds-micro ds-interactions__action-note", {}, note));
  };

  const paintActions = (conversation: EngagementConversation): void => {
    if (!conversation.accepted) {
      const noAccount = conversation.actions.poke.reason === "no_account";
      actions.replaceChildren(el("p", "ds-body-s", {}, noAccount
        ? localized(`${other} has no account yet, so there is nobody to notify. Interactions open once they sign in.`,
          `${other} heeft nog geen account, dus niemand krijgt een melding. Interacties kunnen zodra ${other} zich aanmeldt.`)
        : localized(`${other} does not accept interactions from you right now.`,
          `${other} ontvangt nu geen interacties van jou.`)));
      return;
    }
    const poke = button({ label: localized("Poke", "Porren"), variant: "secondary", size: "sm", onPress: () => {
      void act(async () => { await client.send(player.playerId, "poke"); return `${localized("Poke sent.", "Por verstuurd.")} ${notified}`; });
    } });
    const dice = button({ label: localized("Roll the dice", "Gooi de dobbelsteen"), variant: "secondary", size: "sm", onPress: () => {
      void act(async () => {
        const sent = await client.send(player.playerId, "dice_roll");
        return `${localized(`You rolled ${sent.detail?.face ?? "?"}.`, `Je gooide ${sent.detail?.face ?? "?"}.`)} ${notified}`;
      });
    } });
    const hands = HANDS.map(([hand, icon, english, dutch]) => button({
      label: `${icon} ${localized(english, dutch)}`, variant: "secondary", size: "sm", onPress: () => {
        void act(async () => {
          await client.send(player.playerId, "rock_paper_scissors", { hand });
          return `${localized(`You threw ${icon}.`, `Je koos ${icon}.`)} ${notified}`;
        });
      },
    }).root);
    const select = el("select", "ds-interactions__select", { "aria-label": localized("Your published time to send", "Jouw gepubliceerde tijd om te sturen") });
    const sendChallenge = button({ label: localized("Send challenge", "Uitdaging versturen"), variant: "secondary", size: "sm", onPress: () => {
      const [trackId, modeValue] = (select as HTMLSelectElement).value.split("|");
      const mode = Number(modeValue);
      if (trackId === undefined || (mode !== 150 && mode !== 200)) { return; }
      void act(async () => {
        await client.send(player.playerId, "challenge", { trackId, mode });
        return `${localized("Challenge sent with your published best.", "Uitdaging verstuurd met jouw gepubliceerde beste tijd.")} ${notified}`;
      });
    } });
    const fillBests = (): void => {
      select.replaceChildren(...(bests ?? []).map((best) => el("option", "", { value: `${best.trackId}|${best.mode}` },
        `${trackAsset(best.trackId)?.name ?? best.trackId} · ${best.mode}cc`)));
      if ((bests ?? []).length === 0) {
        select.setAttribute("disabled", "");
        sendChallenge.control.setAttribute("disabled", "");
      }
    };
    fillBests();
    actions.replaceChildren(
      actionCard("👋", localized("Poke", "Por"), localized("Say hi. Once an hour.", "Zeg hallo. Eén keer per uur."),
        conversation, [poke.root], "poke"),
      actionCard("🎲", localized("Dice duel", "Dobbelduel"),
        localized(`You roll now, ${other} rolls back. Highest wins.`, `Jij gooit nu, ${other} gooit terug. Hoogste wint.`),
        conversation, [dice.root], "dice_roll"),
      actionCard("✊", localized("Rock, paper, scissors", "Steen, papier, schaar"),
        localized(`Pick your hand; ${other} answers without seeing it.`, `Kies je zet; ${other} antwoordt zonder hem te zien.`),
        conversation, hands, "rock_paper_scissors"),
      actionCard("🏁", localized("Beat my time", "Versla mijn tijd"),
        (bests ?? []).length === 0 && bests !== null
          ? localized("Publish a time first, then challenge with it.", "Publiceer eerst een tijd en daag daarmee uit.")
          : localized("Send one of your published times to beat. Once an hour.", "Stuur een van je gepubliceerde tijden om te verbeteren. Eén keer per uur."),
        conversation, [select, sendChallenge.root], "challenge"),
    );
  };

  const paintTurn = (conversation: EngagementConversation): void => {
    const waiting = conversation.engagements.filter((entry) => entry.recipientPlayerId === viewerPlayerId && isOpenGame(entry));
    if (waiting.length === 0) { turn.replaceChildren(); return; }
    turn.replaceChildren(el("h3", "ds-kicker", {}, localized("Your turn", "Jouw beurt")), ...waiting.map((entry) => {
      const controls = entry.kind === "dice_roll"
        ? [button({ label: localized("🎲 Roll back", "🎲 Gooi terug"), variant: "primary", size: "sm", onPress: () => {
          void act(async () => {
            const result = await client.answer(entry.engagementId);
            const line = describeEngagement(result, viewerPlayerId, other);
            return `${line.text}${line.status === undefined ? "" : ` — ${line.status.label}`}`;
          });
        } }).root]
        : HANDS.map(([hand, icon, english, dutch]) => button({
          label: `${icon} ${localized(english, dutch)}`, variant: "primary", size: "sm", onPress: () => {
            void act(async () => {
              const result = await client.answer(entry.engagementId, hand);
              const line = describeEngagement(result, viewerPlayerId, other);
              return `${line.text}${line.status === undefined ? "" : ` — ${line.status.label}`}`;
            });
          },
        }).root);
      const line = describeEngagement(entry, viewerPlayerId, other);
      return el("div", "ds-interactions__turn-item", {},
        el("p", "ds-body-s", {}, `${line.icon} ${line.text}`),
        el("div", "ds-cluster", { "data-gap": "xs" }, ...controls));
    }));
  };

  const paintHistory = (conversation: EngagementConversation): void => {
    const rps = headToHead(conversation.engagements, viewerPlayerId, "rock_paper_scissors");
    const dice = headToHead(conversation.engagements, viewerPlayerId, "dice_roll");
    const parts = [
      rps.wins + rps.losses + rps.draws === 0 ? null
        : localized(`Rock-paper-scissors ${rps.wins}–${rps.losses}${rps.draws > 0 ? ` (${rps.draws} draw${rps.draws === 1 ? "" : "s"})` : ""}`,
          `Steen-papier-schaar ${rps.wins}–${rps.losses}${rps.draws > 0 ? ` (${rps.draws} gelijk)` : ""}`),
      dice.wins + dice.losses + dice.draws === 0 ? null
        : localized(`Dice duels ${dice.wins}–${dice.losses}${dice.draws > 0 ? ` (${dice.draws} draw${dice.draws === 1 ? "" : "s"})` : ""}`,
          `Dobbelduels ${dice.wins}–${dice.losses}${dice.draws > 0 ? ` (${dice.draws} gelijk)` : ""}`),
    ].filter((part): part is string => part !== null);
    record.textContent = parts.length > 0
      ? `${localized("You vs", "Jij vs")} ${other}: ${parts.join(" · ")}`
      : conversation.engagements.length > 0
        ? localized("No finished games yet.", "Nog geen afgeronde spelletjes.")
        : localized(`Nothing between you and ${other} yet.`, `Nog niets tussen jou en ${other}.`);
    if (conversation.engagements.length === 0) {
      history.replaceChildren(el("li", "ds-micro", {}, localized("Your interactions will appear here.", "Je interacties verschijnen hier.")));
      return;
    }
    history.replaceChildren(...conversation.engagements.map((entry) => {
      const line = describeEngagement(entry, viewerPlayerId, other);
      return el("li", "ds-interactions__entry", { "data-direction": entry.actorPlayerId === viewerPlayerId ? "sent" : "received" },
        el("span", "ds-interactions__icon", { "aria-hidden": "true" }, line.icon),
        el("span", "ds-interactions__text", {}, line.text,
          line.link === undefined ? null : el("a", "ds-interactions__link", { href: line.link.href }, line.link.label)),
        line.status === undefined ? null : chip(line.status.label, line.status.tone),
        el("span", "ds-micro ds-interactions__when", {}, relativeDate(entry.createdAtMs, now())));
    }));
  };

  async function refresh(): Promise<void> {
    const conversation = await client.conversation(player.playerId);
    paintTurn(conversation);
    paintActions(conversation);
    paintHistory(conversation);
  }

  const ready = (async (): Promise<void> => {
    status.textContent = localized("Loading…", "Laden…");
    try {
      bests = await options.loadBests().catch(() => []);
      await refresh();
      status.textContent = "";
    } catch (error) {
      status.textContent = error instanceof PlayerEngagementClientError
        ? refusalMessage(error.refusal, localized) : refusalMessage("unavailable", localized);
    }
  })();
  return { root, ready, refresh };
}
