import type { ActorContext } from "../identity/types.js";

// The owner-approved curated vocabulary (server-controlled allowlist;
// migration 0020). Emoji rendering is a client concern.
export const REACTION_KINDS = [
  "laugh", "very_funny", "crying", "nervous", "wow",
  "unbelievable", "cool", "competitive", "watching", "fire",
  "fast", "rocket", "strong", "clap", "thumbs_up",
  "trophy", "gold", "crown", "target", "heart",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export type ReactionSummary = Readonly<{
  resultId: string;
  counts: Readonly<Partial<Record<ReactionKind, number>>>;
  mine?: ReactionKind;
}>;

export class ReactionError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "not_found"
      | "own_result"
      | "unavailable",
  ) {
    super("The reaction could not be processed.");
    this.name = "ReactionError";
  }
}

export interface ReactionRepository {
  summarize(
    resultIds: readonly string[],
    userAccountId: string | null,
  ): Promise<readonly ReactionSummary[]>;
  react(
    resultId: string,
    userAccountId: string,
    kind: ReactionKind,
    nowMs: number,
  ): Promise<"reacted_new" | "reacted" | "not_found" | "own_result">;
  remove(resultId: string, userAccountId: string): Promise<void>;
}

export type ReactionServiceDependencies = Readonly<{
  repository: ReactionRepository;
  now?: () => number;
  // Called after a brand-new reaction lands (not for replacements), so
  // the owner can be notified exactly once per reacting account.
  onNewReaction?: (resultId: string) => Promise<void>;
}>;

const resultIdPattern = /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const maximumSummaryIds = 20;

function accountId(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new ReactionError("not_authenticated");
  }
  return actor.userAccountId;
}

function validResultId(resultId: string): string {
  if (!resultIdPattern.test(resultId)) {
    throw new ReactionError("invalid_input");
  }
  return resultId;
}

export class ReactionService {
  private readonly repository: ReactionRepository;
  private readonly now: () => number;
  private readonly onNewReaction:
    ((resultId: string) => Promise<void>) | undefined;

  public constructor(dependencies: ReactionServiceDependencies) {
    this.repository = dependencies.repository;
    this.now = dependencies.now ?? ((): number => Date.now());
    this.onNewReaction = dependencies.onNewReaction;
  }

  public async summarize(
    actor: ActorContext,
    resultIds: readonly string[],
  ): Promise<readonly ReactionSummary[]> {
    if (resultIds.length === 0 || resultIds.length > maximumSummaryIds) {
      throw new ReactionError("invalid_input");
    }
    const unique = [...new Set(resultIds.map(validResultId))];
    const viewer = actor.role === "account" || actor.role === "administrator"
      ? actor.userAccountId
      : null;
    try {
      return await this.repository.summarize(unique, viewer);
    } catch {
      throw new ReactionError("unavailable");
    }
  }

  public async react(
    actor: ActorContext,
    resultId: string,
    kind: ReactionKind,
  ): Promise<void> {
    const viewer = accountId(actor);
    if (!(REACTION_KINDS as readonly string[]).includes(kind)) {
      throw new ReactionError("invalid_input");
    }
    let outcome: "reacted_new" | "reacted" | "not_found" | "own_result";
    try {
      outcome = await this.repository.react(
        validResultId(resultId),
        viewer,
        kind,
        this.now(),
      );
    } catch {
      throw new ReactionError("unavailable");
    }
    if (outcome === "not_found") {
      throw new ReactionError("not_found");
    }
    if (outcome === "own_result") {
      throw new ReactionError("own_result");
    }
    if (outcome === "reacted_new" && this.onNewReaction !== undefined) {
      try {
        await this.onNewReaction(resultId);
      } catch {
        // Notifying must never fail the accepted reaction.
      }
    }
  }

  public async remove(actor: ActorContext, resultId: string): Promise<void> {
    const viewer = accountId(actor);
    try {
      await this.repository.remove(validResultId(resultId), viewer);
    } catch {
      throw new ReactionError("unavailable");
    }
  }
}
