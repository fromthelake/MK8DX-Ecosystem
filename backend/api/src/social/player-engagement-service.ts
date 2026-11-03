import type { ActorContext } from "../identity/types.js";
import { randomInt } from "node:crypto";

/**
 * Player-to-Player engagement: the small, deliberately silly things one Player
 * can send another.
 *
 * Pokes, rock-paper-scissors, dice and "beat my time" challenges share this
 * policy: playful actions also need a single acceptance setting and budget.
 */
export const ENGAGEMENT_KINDS = [
  "poke",
  "rock_paper_scissors",
  "dice_roll",
  "challenge",
] as const;

export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

/** Who may reach a Player at all. Their choice, not the sender's. */
export const ENGAGEMENT_ACCEPT_SCOPES = ["all", "rivals", "none"] as const;

export type EngagementAcceptScope = (typeof ENGAGEMENT_ACCEPT_SCOPES)[number];

export type EngagementDetail = Readonly<{
  /** rock_paper_scissors: what the sender threw. */
  hand?: "rock" | "paper" | "scissors";
  /** dice_roll: the face, 1-6. */
  face?: number;
  /** dice_roll: a duel the recipient answers with their own server-side roll. */
  duel?: boolean;
  /** dice_roll duel: the recipient's answering face. */
  recipientFace?: number;
  /** challenge: the time to beat, and where. */
  trackId?: string;
  mode?: 150 | 200;
  totalTimeMs?: number;
  /** challenge: how much of a taunt it is, in milliseconds. */
  deltaMs?: number;
  recipientHand?: "rock" | "paper" | "scissors";
  outcome?: "actor" | "recipient" | "draw";
  respondedAtMs?: number;
}>;

export type EngagementRequest = Readonly<{
  kind: EngagementKind;
  recipientPlayerId: string;
  detail?: EngagementDetail;
}>;

export type EngagementRecord = Readonly<{
  engagementId: string;
  kind: EngagementKind;
  actorPlayerId: string;
  recipientPlayerId: string;
  detail?: EngagementDetail;
  createdAtMs: number;
  actorDisplayName?: string;
  recipientDisplayName?: string;
}>;
export type RpsStats = Readonly<{ played: number; wins: number; losses: number; draws: number }>;
export type EngagementInbox = Readonly<{
  engagements: readonly EngagementRecord[];
  rpsStats: RpsStats;
}>;

export type EngagementFailure =
  | "not_authenticated"
  | "no_verified_player"
  | "recipient_not_found"
  | "self_engagement"
  | "not_accepted"
  | "recipient_unreachable"
  | "cooldown"
  | "awaiting_answer"
  | "recipient_limit_reached"
  | "invalid_detail"
  | "engagement_not_found"
  | "already_answered";

/** Why one action cannot be sent right now, and when it can. */
export type EngagementAllowance = Readonly<{
  available: boolean;
  reason?: "cooldown" | "awaiting_answer" | "not_accepted" | "recipient_limit" | "no_account";
  /** cooldown: the moment it frees up. */
  availableAtMs?: number;
  /** awaiting_answer: the open game. */
  engagementId?: string;
}>;

/** Everything between the viewer and one other Player, for that Player's page. */
export type EngagementConversation = Readonly<{
  playerId: string;
  accepted: boolean;
  actions: Readonly<Record<EngagementKind, EngagementAllowance>>;
  engagements: readonly EngagementRecord[];
}>;

export class PlayerEngagementError extends Error {
  public constructor(public readonly failure: EngagementFailure) {
    super(`Player engagement refused: ${failure}`);
    this.name = "PlayerEngagementError";
  }
}

export interface PlayerEngagementRepository {
  /** The verified Player behind an account, or null when there is none. */
  verifiedPlayerId(userAccountId: string): Promise<string | null>;
  playerExists(playerId: string): Promise<boolean>;
  /** Whether an account has verified this Player, i.e. whether anyone can be notified. */
  hasVerifiedAccount(playerId: string): Promise<boolean>;
  acceptScope(playerId: string): Promise<EngagementAcceptScope>;
  isRivalOf(recipientPlayerId: string, actorPlayerId: string): Promise<boolean>;
  /** This sender's most recent engagements of one kind with this recipient since a moment. */
  recentFromActor(
    actorPlayerId: string, recipientPlayerId: string, kind: EngagementKind, sinceMs: number,
  ): Promise<readonly EngagementRecord[]>;
  /** How many this recipient has received from anyone inside the window. */
  countForRecipient(recipientPlayerId: string, sinceMs: number): Promise<number>;
  publishedBest(playerId: string, trackId: string, mode: 150 | 200): Promise<number | null>;
  listForPlayer(playerId: string): Promise<readonly EngagementRecord[]>;
  /** Both directions between two Players, newest first. */
  listBetween(playerId: string, otherPlayerId: string, limit: number): Promise<readonly EngagementRecord[]>;
  rpsStats(playerId: string): Promise<RpsStats>;
  /** Completes an open game addressed to this recipient; null when there is none. */
  answerGame(engagementId: string, recipientPlayerId: string,
    reply: GameReply, nowMs: number): Promise<EngagementRecord | null>;
  record(engagement: EngagementRecord): Promise<void>;
}

/** The recipient's answer to a game: a thrown hand, or a face the server rolled. */
export type GameReply =
  | Readonly<{ kind: "rock_paper_scissors"; hand: RpsHand }>
  | Readonly<{ kind: "dice_roll"; face: number }>;

/**
 * The rules (owner 2026-09-26). Each kind has its own: a poke or a challenge at most once an hour
 * to the same Player; a game waits for its answer before the next one. The recipient's daily cap
 * keeps the whole community from filling one inbox however many people join in.
 */
export const ENGAGEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ENGAGEMENT_MAX_PER_RECIPIENT = 20;
export const ENGAGEMENT_COOLDOWN_MS = 60 * 60 * 1000;
/** An unanswered game stops blocking the next one after a week. */
export const ENGAGEMENT_ANSWER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_KINDS: ReadonlySet<EngagementKind> = new Set(["poke", "challenge"]);
const CONVERSATION_LIMIT = 30;

/** A game still waiting for its recipient. Dice rolls before duels existed never wait. */
export function isOpenGame(engagement: EngagementRecord): boolean {
  if (engagement.detail?.respondedAtMs !== undefined) { return false; }
  if (engagement.kind === "rock_paper_scissors") { return true; }
  return engagement.kind === "dice_roll" && engagement.detail?.duel === true;
}

export function diceOutcome(actorFace: number, recipientFace: number): "actor" | "recipient" | "draw" {
  return actorFace === recipientFace ? "draw" : actorFace > recipientFace ? "actor" : "recipient";
}

/** A face is a face: six sides, whole numbers, nothing else. */
function validDetail(kind: EngagementKind, detail: EngagementDetail | undefined): boolean {
  if (kind === "poke") { return detail === undefined || Object.keys(detail).length === 0; }
  if (kind === "dice_roll") {
    return detail === undefined || Object.keys(detail).length === 0;
  }
  if (kind === "rock_paper_scissors") {
    return (detail?.hand === "rock" || detail?.hand === "paper" || detail?.hand === "scissors") &&
      Object.keys(detail).every((key) => key === "hand");
  }
  return typeof detail?.trackId === "string" && detail.trackId.length > 0 &&
    (detail.mode === 150 || detail.mode === 200) &&
    Object.keys(detail).every((key) => key === "trackId" || key === "mode");
}

/** An open rock-paper-scissors invite never shows its recipient the sender's hand. */
function hideOpenHand(engagement: EngagementRecord, viewerPlayerId: string): EngagementRecord {
  if (engagement.kind !== "rock_paper_scissors" ||
      engagement.recipientPlayerId !== viewerPlayerId ||
      engagement.detail?.recipientHand !== undefined) { return engagement; }
  const { detail: _hiddenHand, ...safe } = engagement;
  return safe;
}

const hands = ["rock", "paper", "scissors"] as const;
export type RpsHand = (typeof hands)[number];
export function rpsOutcome(actorHand: RpsHand, recipientHand: RpsHand):
  "actor" | "recipient" | "draw" {
  if (actorHand === recipientHand) { return "draw"; }
  return (actorHand === "rock" && recipientHand === "scissors") ||
    (actorHand === "paper" && recipientHand === "rock") ||
    (actorHand === "scissors" && recipientHand === "paper")
    ? "actor" : "recipient";
}

export class PlayerEngagementService {
  public constructor(
    private readonly repository: PlayerEngagementRepository,
    private readonly clock: Readonly<{ nowMs(): number }>,
    private readonly identifiers: Readonly<{ newEngagementId(): string }>,
    private readonly dice: Readonly<{ roll(): number }> = { roll: () => randomInt(1, 7) },
  ) {}

  public async send(
    actor: ActorContext,
    request: EngagementRequest,
  ): Promise<EngagementRecord> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerEngagementError("not_authenticated");
    }
    if (!validDetail(request.kind, request.detail)) {
      throw new PlayerEngagementError("invalid_detail");
    }
    const actorPlayerId = await this.repository.verifiedPlayerId(actor.userAccountId);
    if (actorPlayerId === null) {
      throw new PlayerEngagementError("no_verified_player");
    }
    if (actorPlayerId === request.recipientPlayerId) {
      throw new PlayerEngagementError("self_engagement");
    }
    if (!await this.repository.playerExists(request.recipientPlayerId)) {
      throw new PlayerEngagementError("recipient_not_found");
    }
    // Nobody would ever be told: say so instead of pretending it was delivered.
    if (!await this.repository.hasVerifiedAccount(request.recipientPlayerId)) {
      throw new PlayerEngagementError("recipient_unreachable");
    }
    if (!await this.accepts(request.recipientPlayerId, actorPlayerId)) {
      throw new PlayerEngagementError("not_accepted");
    }
    const nowMs = this.clock.nowMs();
    // The sender's own rule first: it is the one they can do something about.
    const allowance = await this.allowance(actorPlayerId, request.recipientPlayerId, request.kind, nowMs);
    if (!allowance.available) {
      throw new PlayerEngagementError(allowance.reason === "awaiting_answer" ? "awaiting_answer"
        : allowance.reason === "recipient_limit" ? "recipient_limit_reached" : "cooldown");
    }
    let detail = request.detail;
    if (request.kind === "dice_roll") {
      const face = this.dice.roll();
      if (!Number.isInteger(face) || face < 1 || face > 6) {
        throw new PlayerEngagementError("invalid_detail");
      }
      // A roll is a duel now: the recipient rolls back and the higher face wins.
      detail = { face, duel: true };
    }
    if (request.kind === "challenge") {
      const trackId = request.detail?.trackId;
      const mode = request.detail?.mode;
      if (trackId === undefined || mode === undefined) {
        throw new PlayerEngagementError("invalid_detail");
      }
      const totalTimeMs = await this.repository.publishedBest(actorPlayerId, trackId, mode);
      if (totalTimeMs === null) { throw new PlayerEngagementError("invalid_detail"); }
      detail = { trackId, mode, totalTimeMs };
    }
    const engagement: EngagementRecord = {
      engagementId: this.identifiers.newEngagementId(),
      kind: request.kind,
      actorPlayerId,
      recipientPlayerId: request.recipientPlayerId,
      ...(detail === undefined ? {} : { detail }),
      createdAtMs: nowMs,
    };
    await this.repository.record(engagement);
    return engagement;
  }

  public async list(actor: ActorContext): Promise<EngagementInbox> {
    const playerId = await this.actorPlayerId(actor);
    const [records, rpsStats] = await Promise.all([
      this.repository.listForPlayer(playerId), this.repository.rpsStats(playerId),
    ]);
    return { rpsStats, engagements: records.map((engagement) => hideOpenHand(engagement, playerId)) };
  }

  /**
   * The viewer's history with one other Player and what they can send them now. The page shows
   * this beside the buttons, so the rules and the refusals can never disagree.
   */
  public async conversation(actor: ActorContext, otherPlayerId: string): Promise<EngagementConversation> {
    const playerId = await this.actorPlayerId(actor);
    if (playerId === otherPlayerId) { throw new PlayerEngagementError("self_engagement"); }
    if (!await this.repository.playerExists(otherPlayerId)) {
      throw new PlayerEngagementError("recipient_not_found");
    }
    const nowMs = this.clock.nowMs();
    const reachable = await this.repository.hasVerifiedAccount(otherPlayerId);
    const accepted = reachable && await this.accepts(otherPlayerId, playerId);
    const actions = Object.fromEntries(await Promise.all(ENGAGEMENT_KINDS.map(async (kind) =>
      [kind, !reachable ? { available: false, reason: "no_account" as const }
        : accepted ? await this.allowance(playerId, otherPlayerId, kind, nowMs)
        : { available: false, reason: "not_accepted" as const }] as const,
    ))) as Record<EngagementKind, EngagementAllowance>;
    const history = await this.repository.listBetween(playerId, otherPlayerId, CONVERSATION_LIMIT);
    return {
      playerId: otherPlayerId,
      accepted,
      actions,
      engagements: history.map((engagement) => hideOpenHand(engagement, playerId)),
    };
  }

  /** Answers an open game: a thrown hand for rock-paper-scissors, a server roll for dice. */
  public async answer(actor: ActorContext, engagementId: string,
    hand?: RpsHand): Promise<EngagementRecord> {
    if (hand !== undefined && !hands.includes(hand)) { throw new PlayerEngagementError("invalid_detail"); }
    const playerId = await this.actorPlayerId(actor);
    const reply: GameReply = hand === undefined
      ? { kind: "dice_roll", face: this.dice.roll() }
      : { kind: "rock_paper_scissors", hand };
    if (reply.kind === "dice_roll" && (!Number.isInteger(reply.face) || reply.face < 1 || reply.face > 6)) {
      throw new PlayerEngagementError("invalid_detail");
    }
    const result = await this.repository.answerGame(engagementId, playerId, reply, this.clock.nowMs());
    if (result === null) { throw new PlayerEngagementError("engagement_not_found"); }
    return result;
  }

  private async accepts(recipientPlayerId: string, actorPlayerId: string): Promise<boolean> {
    const scope = await this.repository.acceptScope(recipientPlayerId);
    if (scope === "none") { return false; }
    return scope !== "rivals" || await this.repository.isRivalOf(recipientPlayerId, actorPlayerId);
  }

  private async allowance(actorPlayerId: string, recipientPlayerId: string,
    kind: EngagementKind, nowMs: number): Promise<EngagementAllowance> {
    if (COOLDOWN_KINDS.has(kind)) {
      const [latest] = await this.repository.recentFromActor(
        actorPlayerId, recipientPlayerId, kind, nowMs - ENGAGEMENT_COOLDOWN_MS);
      if (latest !== undefined) {
        return { available: false, reason: "cooldown", availableAtMs: latest.createdAtMs + ENGAGEMENT_COOLDOWN_MS };
      }
    } else {
      const recent = await this.repository.recentFromActor(
        actorPlayerId, recipientPlayerId, kind, nowMs - ENGAGEMENT_ANSWER_WINDOW_MS);
      const open = recent.find(isOpenGame);
      if (open !== undefined) {
        return { available: false, reason: "awaiting_answer", engagementId: open.engagementId };
      }
    }
    if (await this.repository.countForRecipient(recipientPlayerId, nowMs - ENGAGEMENT_WINDOW_MS) >=
      ENGAGEMENT_MAX_PER_RECIPIENT) {
      return { available: false, reason: "recipient_limit" };
    }
    return { available: true };
  }

  private async actorPlayerId(actor: ActorContext): Promise<string> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerEngagementError("not_authenticated");
    }
    const playerId = await this.repository.verifiedPlayerId(actor.userAccountId);
    if (playerId === null) { throw new PlayerEngagementError("no_verified_player"); }
    return playerId;
  }
}
