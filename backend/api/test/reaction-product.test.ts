import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  ReactionService,
  REACTION_KINDS,
  type ReactionKind,
  type ReactionRepository,
  type ReactionSummary,
} from "../src/timetrials/reaction-service.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";
import { MutationRateLimitExceeded } from
  "../src/security/mysql-mutation-rate-limiter.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const RESULT_ID = "user_submission.time.SYNTHETICREACT01";

class FakeReactionRepository implements ReactionRepository {
  readonly reactions = new Map<string, ReactionKind>();
  published = new Set<string>([RESULT_ID]);
  ownedBy = new Map<string, string>();

  async summarize(
    resultIds: readonly string[],
    userAccountId: string | null,
  ): Promise<readonly ReactionSummary[]> {
    return resultIds.map((resultId) => {
      const counts: Partial<Record<ReactionKind, number>> = {};
      let mine: ReactionKind | undefined;
      for (const [key, kind] of this.reactions) {
        const [account, target] = key.split("|");
        if (target !== resultId) { continue; }
        counts[kind] = (counts[kind] ?? 0) + 1;
        if (account === userAccountId) { mine = kind; }
      }
      return { resultId, counts, ...(mine === undefined ? {} : { mine }) };
    });
  }

  async react(
    resultId: string,
    userAccountId: string,
    kind: ReactionKind,
  ): Promise<"reacted_new" | "reacted" | "not_found" | "own_result"> {
    if (!this.published.has(resultId)) { return "not_found"; }
    if (this.ownedBy.get(resultId) === userAccountId) { return "own_result"; }
    const key = `${userAccountId}|${resultId}`;
    const fresh = !this.reactions.has(key);
    this.reactions.set(key, kind);
    return fresh ? "reacted_new" : "reacted";
  }

  async remove(resultId: string, userAccountId: string): Promise<void> {
    this.reactions.delete(`${userAccountId}|${resultId}`);
  }
}

async function appWith(
  repository: FakeReactionRepository,
  actor: ActorContext,
  rateLimiter?: Readonly<{
    consume(subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void>;
  }>,
): Promise<ReturnType<typeof buildApp>> {
  return buildApp({
    identityRepository,
    reactions: {
      service: new ReactionService({ repository }),
      ...(rateLimiter === undefined ? {} : { rateLimiter }),
    },
    resolveActor: async () => actor,
  });
}

describe("time trial reactions product", () => {
  it("enforces the curated twenty-kind vocabulary", () => {
    expect(REACTION_KINDS).toHaveLength(20);
    for (const excluded of ["ok_hand", "point", "eggplant", "peach"]) {
      expect(REACTION_KINDS).not.toContain(excluded);
    }
  });

  it("lets an account react with curated kinds and replaces the kind", async () => {
    const repository = new FakeReactionRepository();
    const app = await appWith(
      repository,
      { role: "account", userAccountId: "user_account.synthetic" },
    );
    const put = await app.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "rocket" },
    });
    expect(put.statusCode).toBe(200);
    const replace = await app.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "crown" },
    });
    expect(replace.statusCode).toBe(200);
    const summary = await app.inject({
      method: "GET",
      url: `/v1/public/time-trial-reactions?resultIds=${RESULT_ID}`,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({
      schemaVersion: "mk8dx.public-time-trial-reactions.v1",
      reactions: [{
        resultId: RESULT_ID,
        counts: { crown: 1 },
        mine: "crown",
      }],
    });
    const remove = await app.inject({
      method: "DELETE",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID },
    });
    expect(remove.statusCode).toBe(200);
    expect(repository.reactions.size).toBe(0);
    await app.close();
  });

  it("refuses anonymous writes, own results, unknown kinds, and unpublished targets", async () => {
    const repository = new FakeReactionRepository();
    const anonymous = await appWith(repository, { role: "anonymous" });
    const put = await anonymous.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "fire" },
    });
    expect(put.statusCode).toBe(401);
    const counts = await anonymous.inject({
      method: "GET",
      url: `/v1/public/time-trial-reactions?resultIds=${RESULT_ID}`,
    });
    expect(counts.statusCode).toBe(200);
    expect(counts.json().reactions[0].mine).toBeUndefined();
    await anonymous.close();

    const account = await appWith(
      repository,
      { role: "account", userAccountId: "user_account.synthetic" },
    );
    repository.ownedBy.set(RESULT_ID, "user_account.synthetic");
    const own = await account.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "fire" },
    });
    expect(own.statusCode).toBe(403);
    expect(own.json().code).toBe("own_result");
    const badKind = await account.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "eggplant" },
    });
    expect(badKind.statusCode).toBe(400);
    repository.published.clear();
    const missing = await account.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "fire" },
    });
    expect(missing.statusCode).toBe(404);
    await account.close();
  });

  it("returns a bounded retry response before a rate-limited write", async () => {
    const repository = new FakeReactionRepository();
    const app = await appWith(
      repository,
      { role: "account", userAccountId: "user_account.synthetic" },
      {
        async consume(subject, scope, windowSeconds, maximum) {
          expect({ subject, scope, windowSeconds, maximum }).toEqual({
            subject: "user_account.synthetic",
            scope: "time-trial-reactions-hour",
            windowSeconds: 3_600,
            maximum: 600,
          });
          throw new MutationRateLimitExceeded(27);
        },
      },
    );
    const response = await app.inject({
      method: "PUT",
      url: "/v1/time-trial-reactions",
      payload: { resultId: RESULT_ID, kind: "rocket" },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("27");
    expect(response.json().code).toBe("reaction_rate_limited");
    expect(repository.reactions.size).toBe(0);
    await app.close();
  });
});
