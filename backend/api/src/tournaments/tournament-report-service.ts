import { reportMarkupHtml, reportMarkupText, sanitizeReportMarkup } from "./tournament-report-markup.js";
import type { ActorContext } from "../identity/types.js";
import type { TournamentDocument, TournamentOperationService } from "./tournament-operation-service.js";
import { RATING_SCORE_MULTIPLIER } from "../rating/trueskill-engine.js";

/** What the report needs from the rating store: the ranking order with mu and sigma. */
export type RatingLookup = Readonly<{
  listRatings(limit: number): Promise<readonly Readonly<{ playerId: string; mu: number; sigma: number }>[]>;
  /** How the night moved each Player per stage; absent in a store without race events. */
  stageSplit?(tournamentId: string): Promise<ReadonlyMap<string, Readonly<{ before: number; afterQualifiers: number | null; afterFinals: number | null }>>>;
}>;

export const NIGHT_REPORT_CAPABILITY = "tournament.analytics.night_report" as const;

export type TournamentReportGrant = Readonly<{
  grantId: string;
  userAccountId: string;
  capability: typeof NIGHT_REPORT_CAPABILITY;
  status: "active" | "revoked";
  revision: number;
  grantedAtMs: number;
  revokedAtMs?: number;
}>;

/**
 * Which blocks of the document a night shows. The source's export has the same
 * idea in its toolbar; ours only offers the blocks we actually draw, and every
 * one is on unless the Director turns it off.
 */
export type TournamentReportVisibility = Readonly<{
  topTracks: boolean;
  benchmark: boolean;
  duel: boolean;
  distribution: boolean;
  /** The opening paragraphs under the title. */
  intro: boolean;
  /** The report's own "Samenvatting". */
  summary: boolean;
  /** The note under every group's heading; one switch for all groups, never the Player notes. */
  groupNotes: boolean;
}>;

export const REPORT_VISIBILITY_KEYS = [
  "topTracks", "benchmark", "duel", "distribution", "intro", "summary", "groupNotes",
] as const satisfies readonly (keyof TournamentReportVisibility)[];

/**
 * What a report starts with (owner, 2026-09-28): the intro and the group notes
 * are off until the Director turns them on; the Summary is on.
 */
export const DEFAULT_REPORT_VISIBILITY: TournamentReportVisibility = {
  topTracks: true, benchmark: true, duel: true, distribution: true,
  intro: false, summary: true, groupNotes: false,
};

/**
 * A report saved before intro/summary/groupNotes existed drew those blocks, so
 * a stored flag that is absent keeps showing them: nothing published changes
 * until the Director unticks it.
 */
export const STORED_REPORT_VISIBILITY: TournamentReportVisibility = {
  ...DEFAULT_REPORT_VISIBILITY, intro: true, groupNotes: true,
};

export function reportVisibility(
  value: Readonly<Record<string, unknown>> | undefined,
  fallback: TournamentReportVisibility,
): TournamentReportVisibility {
  const flag = (key: keyof TournamentReportVisibility): boolean => {
    const given = value?.[key];
    return typeof given === "boolean" ? given : fallback[key];
  };
  return {
    topTracks: flag("topTracks"), benchmark: flag("benchmark"), duel: flag("duel"), distribution: flag("distribution"),
    intro: flag("intro"), summary: flag("summary"), groupNotes: flag("groupNotes"),
  };
}

export type TournamentReportDraft = Readonly<{
  revision: number;
  /** The heading the document opens with; empty means the night's own name. */
  titleText: string;
  introText: string;
  /** The report's own "Samenvatting", under the opening paragraphs. */
  summaryText: string;
  tracksIntroText: string;
  playerNotes: Readonly<Record<string, string>>;
  /** A note per group, keyed by the group's own identifier. */
  groupNotes: Readonly<Record<string, string>>;
  visibility: TournamentReportVisibility;
  updatedAtMs: number;
  /** The revision the community is reading, when one has been published. */
  publishedRevision?: number;
  publishedAtMs?: number;
}>;

/**
 * What a published night hands the community: the same shape the imported
 * stories of TN1-TN12 have, so the document draws it without knowing which of
 * the two it was given. Player notes are keyed by the name shown that night,
 * not by identifier: the reader matches by name, and a published report should
 * not change when somebody is renamed later.
 */
/**
 * Where every participant stands on the SP ranking once the night has been
 * applied to the rating: the rank and score the Ranking page shows at that
 * moment. Keyed by the name shown that night, like the notes. The seed the
 * night was drawn with travels with the public event already (ADR-0154), so
 * a reader can print "before -> after" per Player.
 */
export type PublicReportRatings = Readonly<{
  asOfMs: number;
  players: readonly Readonly<{
    name: string; rank: number; score: number;
    /** How much of the night's SP change came from the qualifiers and from the finals, when the races were rated per stage. */
    qualifierDelta?: number; finalDelta?: number;
  }>[];
}>;

export type PublicTournamentReport = Readonly<{
  title: string;
  intro: readonly string[];
  summary: readonly string[];
  topTracks: readonly string[];
  groups: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
  players: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
  /** The same blocks with the Director's formatting, as sanitised class-based
   * HTML (`tournament-report-markup.ts`). A client that only knows paragraphs
   * reads the plain text above; the web draws these when present. */
  introHtml?: readonly string[];
  summaryHtml?: readonly string[];
  topTracksHtml?: readonly string[];
  /** The SP ranking of the participants when the report was published. */
  ratings?: PublicReportRatings;
  visibility: TournamentReportVisibility;
  publishedAtMs: number;
  revision: number;
}>;

export type TournamentReportDocument = Readonly<{
  schemaVersion: "mk8dx.tournament-night-report.v1";
  mayManageAccess: boolean;
  tournament: TournamentDocument;
  draft: TournamentReportDraft | null;
  /** Where the participants stand on the SP ranking now; null until the night counts. */
  ratings: PublicReportRatings | null;
}>;

export interface TournamentReportRepository {
  hasCapability(userAccountId: string): Promise<boolean>;
  listActiveGrants(): Promise<readonly TournamentReportGrant[]>;
  grant(input: Readonly<{
    grantId: string; userAccountId: string; actorUserAccountId: string;
    reasonCode: string; occurredAtMs: number;
  }>): Promise<TournamentReportGrant>;
  revoke(input: Readonly<{
    userAccountId: string; actorUserAccountId: string;
    reasonCode: string; occurredAtMs: number;
  }>): Promise<TournamentReportGrant>;
  loadDraft(tournamentId: string): Promise<TournamentReportDraft | null>;
  saveDraft(input: Readonly<{
    tournamentId: string; actorUserAccountId: string; expectedRevision: number | null;
    titleText: string; introText: string; summaryText: string; tracksIntroText: string;
    playerNotes: Readonly<Record<string, string>>;
    groupNotes: Readonly<Record<string, string>>;
    visibility: TournamentReportVisibility; occurredAtMs: number;
  }>): Promise<TournamentReportDraft>;
  publish(input: Readonly<{
    tournamentId: string; actorUserAccountId: string; expectedRevision: number;
    payload: PublicTournamentReport; occurredAtMs: number;
  }>): Promise<TournamentReportDraft>;
  /** What the community reads: the copy taken when it was published. */
  loadPublished(tournamentId: string): Promise<PublicTournamentReport | null>;
}

export class TournamentReportError extends Error {
  public constructor(
    public readonly code: "forbidden" | "not_found" | "conflict" | "invalid_input",
    message: string,
  ) { super(message); this.name = "TournamentReportError"; }
}

const accountId = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const tournamentId = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const reasonCode = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function administrator(actor: ActorContext): string {
  if (actor.role !== "administrator") {
    throw new TournamentReportError("forbidden", "administrator actor required");
  }
  return actor.userAccountId;
}

function account(actor: ActorContext): string {
  if (actor.role !== "administrator" && actor.role !== "account") {
    throw new TournamentReportError("forbidden", "signed-in account required");
  }
  return actor.userAccountId;
}

function visibilityOf(value: Partial<TournamentReportVisibility> | undefined): TournamentReportVisibility {
  return reportVisibility(value, DEFAULT_REPORT_VISIBILITY);
}

/** Plain paragraphs, one per block; blank lines still separate paragraphs in a plain-text draft. */
function paragraphsOf(text: string): readonly string[] {
  return reportMarkupText(text);
}

/**
 * The copy the community reads. Player notes move from identifier to the name
 * shown that night, and a group note to the group's own name, because that is
 * what the document matches on - and because a published report should not
 * change when somebody is renamed afterwards.
 */
function publishedPayload(
  draft: TournamentReportDraft,
  tournament: TournamentDocument,
  occurredAtMs: number,
  ratings: PublicReportRatings | null = null,
): PublicTournamentReport {
  const names = new Map<string, string>();
  for (const group of tournament.groups) {
    for (const member of group.members) { names.set(member.playerId, member.displayName); }
  }
  for (const participant of tournament.participants) { names.set(participant.playerId, participant.displayName); }
  const groupNames = new Map(tournament.groups.map((group) => [group.groupId, group.name]));
  return {
    title: draft.titleText.length > 0 ? draft.titleText : tournament.summary.name,
    ...(ratings === null ? {} : { ratings }),
    intro: paragraphsOf(draft.introText),
    summary: paragraphsOf(draft.summaryText),
    topTracks: paragraphsOf(draft.tracksIntroText),
    introHtml: reportMarkupHtml(draft.introText),
    summaryHtml: reportMarkupHtml(draft.summaryText),
    topTracksHtml: reportMarkupHtml(draft.tracksIntroText),
    groups: Object.entries(draft.groupNotes).flatMap(([groupId, note]) => {
      const name = groupNames.get(groupId);
      const paragraphs = paragraphsOf(note);
      return name === undefined || paragraphs.length === 0 ? [] : [{ name, paragraphs, html: reportMarkupHtml(note) }];
    }),
    players: Object.entries(draft.playerNotes).flatMap(([playerId, note]) => {
      const name = names.get(playerId);
      const paragraphs = paragraphsOf(note);
      return name === undefined || paragraphs.length === 0 ? [] : [{ name, paragraphs, html: reportMarkupHtml(note) }];
    }),
    visibility: draft.visibility,
    publishedAtMs: occurredAtMs,
    revision: draft.revision,
  };
}

function cleanText(value: string, maximum: number, field: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length > maximum) {
    throw new TournamentReportError("invalid_input", `${field} is too long`);
  }
  return normalized;
}

/** A story field: sanitised markup in its canonical form, bounded after sanitising. */
function cleanMarkup(value: string, maximum: number, field: string): string {
  if (typeof value !== "string") { throw new TournamentReportError("invalid_input", `${field} must be text`); }
  return cleanText(sanitizeReportMarkup(value), maximum, field);
}

export class TournamentReportService {
  public constructor(
    private readonly repository: TournamentReportRepository,
    private readonly tournaments: Pick<TournamentOperationService, "loadForReport">,
    private readonly ids: Readonly<{ newGrantId(): string }>,
    private readonly clock: Readonly<{ nowMs(): number }>,
    /** The same ranking the Ranking page serves; absent in a runtime without ratings. */
    private readonly ratings: RatingLookup | null = null,
  ) {}

  /**
   * The participants' place on the SP ranking, once the night counts for the
   * rating. Before that moment there is no "after" to show, and a night that
   * does not affect TrueSkill has none either. Named by the name shown that
   * night, so private Players are not identified beyond what the page shows.
   */
  private async ratingSnapshot(tournament: TournamentDocument): Promise<PublicReportRatings | null> {
    if (this.ratings === null || tournament.summary.stage !== "finalized" || !tournament.summary.affectsRating) { return null; }
    // Only who played: the report prints the groups, and an absent participant has no line.
    const names = new Map(tournament.groups.flatMap((group) => group.members.map((member) => [member.playerId, member.displayName] as const)));
    const listed = await this.ratings.listRatings(500);
    const split = this.ratings.stageSplit === undefined ? new Map() : await this.ratings.stageSplit(tournament.summary.tournamentId);
    const players = listed.flatMap((entry, index) => {
      const name = names.get(entry.playerId);
      if (name === undefined) { return []; }
      const moved = split.get(entry.playerId);
      const qualifierDelta = moved?.afterQualifiers === null || moved?.afterQualifiers === undefined ? undefined : moved.afterQualifiers - moved.before;
      const finalDelta = moved?.afterFinals === null || moved?.afterFinals === undefined ? undefined : moved.afterFinals - (moved.afterQualifiers ?? moved.before);
      return [{
        name, rank: index + 1, score: entry.mu - RATING_SCORE_MULTIPLIER * entry.sigma,
        ...(qualifierDelta === undefined ? {} : { qualifierDelta }),
        ...(finalDelta === undefined ? {} : { finalDelta }),
      }];
    });
    return { asOfMs: this.now(), players };
  }

  public async listGrants(actor: ActorContext): Promise<readonly TournamentReportGrant[]> {
    administrator(actor);
    return this.repository.listActiveGrants();
  }

  public async grant(actor: ActorContext, userAccountId: string, reason: string): Promise<TournamentReportGrant> {
    const actorUserAccountId = administrator(actor);
    if (!accountId.test(userAccountId) || !reasonCode.test(reason) || reason.length > 64) {
      throw new TournamentReportError("invalid_input", "grant command is invalid");
    }
    return this.repository.grant({
      grantId: this.ids.newGrantId(), userAccountId, actorUserAccountId,
      reasonCode: reason, occurredAtMs: this.now(),
    });
  }

  public async revoke(actor: ActorContext, userAccountId: string, reason: string): Promise<TournamentReportGrant> {
    const actorUserAccountId = administrator(actor);
    if (!accountId.test(userAccountId) || !reasonCode.test(reason) || reason.length > 64) {
      throw new TournamentReportError("invalid_input", "revocation command is invalid");
    }
    return this.repository.revoke({
      userAccountId, actorUserAccountId, reasonCode: reason, occurredAtMs: this.now(),
    });
  }

  public async load(actor: ActorContext, requestedTournamentId: string): Promise<TournamentReportDocument> {
    const userAccountId = account(actor);
    if (!tournamentId.test(requestedTournamentId)) {
      throw new TournamentReportError("invalid_input", "tournamentId is invalid");
    }
    if (actor.role !== "administrator" && !await this.repository.hasCapability(userAccountId)) {
      throw new TournamentReportError("forbidden", "Night report capability required");
    }
    const [tournament, draft] = await Promise.all([
      this.tournaments.loadForReport(requestedTournamentId),
      this.repository.loadDraft(requestedTournamentId),
    ]);
    return {
      schemaVersion: "mk8dx.tournament-night-report.v1",
      mayManageAccess: actor.role === "administrator",
      tournament,
      draft,
      ratings: await this.ratingSnapshot(tournament),
    };
  }

  public async saveDraft(
    actor: ActorContext,
    requestedTournamentId: string,
    command: Readonly<{
      expectedRevision: number | null; titleText?: string; introText: string;
      summaryText?: string; tracksIntroText: string;
      playerNotes: Readonly<Record<string, string>>;
      groupNotes?: Readonly<Record<string, string>>;
      visibility?: Partial<TournamentReportVisibility>;
    }>,
  ): Promise<TournamentReportDraft> {
    const userAccountId = account(actor);
    if (!tournamentId.test(requestedTournamentId) ||
        (actor.role !== "administrator" && !await this.repository.hasCapability(userAccountId))) {
      throw new TournamentReportError("forbidden", "Night report capability required");
    }
    if (command.expectedRevision !== null &&
        (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1)) {
      throw new TournamentReportError("invalid_input", "expectedRevision is invalid");
    }
    const notes: Record<string, string> = {};
    const entries = Object.entries(command.playerNotes);
    if (entries.length > 60) { throw new TournamentReportError("invalid_input", "too many player notes"); }
    for (const [playerId, note] of entries) {
      if (!/^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(playerId)) {
        throw new TournamentReportError("invalid_input", "player note key is invalid");
      }
      notes[playerId] = cleanMarkup(note, 2000, "player note");
    }
    const groupNotes: Record<string, string> = {};
    const groupEntries = Object.entries(command.groupNotes ?? {});
    if (groupEntries.length > 12) { throw new TournamentReportError("invalid_input", "too many group notes"); }
    for (const [groupId, note] of groupEntries) {
      if (!/^tournament_group\.[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$/.test(groupId)) {
        throw new TournamentReportError("invalid_input", "group note key is invalid");
      }
      groupNotes[groupId] = cleanMarkup(note, 4000, "group note");
    }
    await this.tournaments.loadForReport(requestedTournamentId);
    return this.repository.saveDraft({
      tournamentId: requestedTournamentId, actorUserAccountId: userAccountId,
      expectedRevision: command.expectedRevision,
      titleText: cleanText(command.titleText ?? "", 160, "titleText"),
      introText: cleanMarkup(command.introText, 8000, "introText"),
      summaryText: cleanMarkup(command.summaryText ?? "", 8000, "summaryText"),
      tracksIntroText: cleanMarkup(command.tracksIntroText, 8000, "tracksIntroText"),
      playerNotes: notes, groupNotes,
      visibility: visibilityOf(command.visibility), occurredAtMs: this.now(),
    });
  }

  /**
   * Fix the report as the community's copy. The Director goes on editing the
   * draft afterwards; the page they published keeps reading what was published
   * until they publish again. A night that is not finalized cannot be
   * published: the document prints its final standing.
   */
  public async publish(
    actor: ActorContext,
    requestedTournamentId: string,
    expectedRevision: number,
  ): Promise<TournamentReportDraft> {
    const userAccountId = account(actor);
    if (!tournamentId.test(requestedTournamentId) ||
        (actor.role !== "administrator" && !await this.repository.hasCapability(userAccountId))) {
      throw new TournamentReportError("forbidden", "Night report capability required");
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new TournamentReportError("invalid_input", "expectedRevision is invalid");
    }
    const [tournament, draft] = await Promise.all([
      this.tournaments.loadForReport(requestedTournamentId),
      this.repository.loadDraft(requestedTournamentId),
    ]);
    if (draft === null) { throw new TournamentReportError("not_found", "there is no report to publish"); }
    if (draft.revision !== expectedRevision) {
      throw new TournamentReportError("conflict", "report draft changed concurrently");
    }
    if (tournament.summary.stage !== "finalized") {
      throw new TournamentReportError("invalid_input", "finalize the tournament before publishing its report");
    }
    const occurredAtMs = this.now();
    return this.repository.publish({
      tournamentId: requestedTournamentId, actorUserAccountId: userAccountId,
      expectedRevision, occurredAtMs,
      payload: publishedPayload(draft, tournament, occurredAtMs, await this.ratingSnapshot(tournament)),
    });
  }

  private now(): number {
    const value = this.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TournamentReportError("conflict", "clock is invalid");
    }
    return value;
  }
}
