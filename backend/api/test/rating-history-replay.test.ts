import assert from "node:assert/strict";
import { it } from "vitest";

import { createHistoryReplay } from "../src/rating/rating-history-replay.js";

it("replays the history with the measured parameters and decay, then applies every counting result set oldest first", async () => {
  const calls: string[] = [];
  const replay = createHistoryReplay(
    {} as never,
    {
      async listIncludedPublications() { calls.push("list"); return ["tournament_publication.older", "tournament_publication.newer"]; },
      async applyPublication(id) { calls.push(`apply:${id}`); return { appliedRaces: id.endsWith("older") ? 40 : 130, skippedRaces: id.endsWith("older") ? 1 : 0 }; },
    },
    async (_pool, run) => {
      calls.push(`recompute:${run.parameters}:${run.decay ? "decay" : "no-decay"}:${run.dryRun ? "dry" : "write"}:${run.operator}:${run.reasonCode}`);
      calls.push(`eligible:${run.eligiblePlayerIds === null ? "everyone" : [...run.eligiblePlayerIds!].join(",")}`);
      return { parameters: run.parameters, decay: run.decay, dryRun: run.dryRun, racesRead: 1, racesRated: 1, racesSkipped: 2, decayApplications: 0, playersRated: 61, epoch: 9, biggestScoreMove: 0 };
    },
    async () => null,
  );
  const result = await replay({ administratorAccountId: "user_account.synthetic_admin", reasonCode: "tournament_reopened" });
  assert.deepEqual(result, { epoch: 9, includedPublications: 2, appliedRaces: 170, skippedRaces: 3, ratedPlayers: 61 });
  assert.deepEqual(calls, [
    "recompute:measured:decay:write:user_account.synthetic_admin:tournament_reopened",
    "eligible:everyone",
    "list",
    "apply:tournament_publication.older",
    "apply:tournament_publication.newer",
  ]);
});

it("does not apply anything when the history cannot be replayed", async () => {
  let applied = 0;
  const replay = createHistoryReplay(
    {} as never,
    { async listIncludedPublications() { return ["tournament_publication.x"]; }, async applyPublication() { applied += 1; return { appliedRaces: 1, skippedRaces: 0 }; } },
    async () => { throw new Error("the corrected history is empty - build it first"); },
    async () => null,
  );
  await assert.rejects(replay({ administratorAccountId: "user_account.synthetic_admin", reasonCode: "tournament_reopened" }), /history is empty/);
  assert.equal(applied, 0);
});

it("replays the history with only the claimed Players when the installation counts only them (ADR-0221)", async () => {
  let seen: ReadonlySet<number> | null | undefined;
  const replay = createHistoryReplay(
    {} as never,
    { async listIncludedPublications() { return []; }, async applyPublication() { return { appliedRaces: 0, skippedRaces: 0 }; } },
    async (_pool, run) => {
      seen = run.eligiblePlayerIds;
      return { parameters: run.parameters, decay: run.decay, dryRun: run.dryRun, racesRead: 1, racesRated: 1, racesSkipped: 0, decayApplications: 0, playersRated: 2, epoch: 3, biggestScoreMove: 0 };
    },
    async () => new Set([7, 9]),
  );
  await replay({ administratorAccountId: "user_account.synthetic_admin", reasonCode: "installation_rating_eligibility" });
  assert.deepEqual([...seen!], [7, 9]);
});
