import assert from "node:assert/strict";
import { it } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import { TournamentRetractionService, type TournamentRetractionState } from "../src/tournaments/tournament-retraction-service.js";

const actor: ActorContext = { role: "administrator", userAccountId: "user_account.synthetic_admin" };

it("rated Tournament removal retracts publication and performs one full replay", async () => {
  let state: TournamentRetractionState = {
    tournamentId: "tournament.synthetic_rated", alreadyRetracted: false,
    publicationId: "tournament_publication.synthetic_rated", publicationRevision: 3,
    publicationStatus: "published", publicationWasPublic: true, ratingWasIncluded: true, ratingEpochId: null,
  };
  let retracts = 0;
  let decisions = 0;
  let replays = 0;
  const service = new TournamentRetractionService({
    async prepareRetraction() { const answer = state; state = { ...state, alreadyRetracted: true, publicationStatus: "retracted" }; return answer; },
    async markRatingReplayCompleted(input) { state = { ...state, ratingEpochId: input.ratingEpochId }; },
    async restoreTournament() { return null; },
    async loadRepublishPlan() { return null; },
    async isDirectorOf() { return false; },
    async prepareReopen() { throw new Error("not used"); },
  }, {
    async republish() { throw new Error("must not republish during a removal"); },
    async retract() { retracts += 1; },
  }, {
    async recordDecision() { decisions += 1; },
    async recalculate() { replays += 1; return { epoch: 42 }; },
  }, () => 1_800_000_000_000);

  const removed = await service.remove(actor, { tournamentId: state.tournamentId, reason: "Practice Tournament completed" });
  const repeated = await service.remove(actor, { tournamentId: state.tournamentId, reason: "Practice Tournament completed" });
  assert.equal(removed.ratingEpochId, 42);
  assert.equal(repeated.ratingEpochId, 42);
  assert.deepEqual({ retracts, decisions, replays }, { retracts: 1, decisions: 1, replays: 1 });
});

it("non-rated Tournament removal never recalculates ratings", async () => {
  let replayed = false;
  const service = new TournamentRetractionService({
    async prepareRetraction() {
      return {
        tournamentId: "tournament.synthetic_nonrated", alreadyRetracted: false,
        publicationId: "tournament_publication.synthetic_nonrated", publicationRevision: 1,
        publicationStatus: "published", publicationWasPublic: true, ratingWasIncluded: false, ratingEpochId: null,
      };
    },
    async markRatingReplayCompleted() { throw new Error("must not record rating epoch"); },
    async restoreTournament() { return null; },
    async loadRepublishPlan() { return null; },
    async isDirectorOf() { return false; },
    async prepareReopen() { throw new Error("not used"); },
  }, {
    async republish() { throw new Error("must not republish during a removal"); },
    async retract() {},
  }, {
    async recordDecision() { throw new Error("must not alter rating decision"); },
    async recalculate() { replayed = true; return { epoch: 1 }; },
  });
  await service.remove(actor, { tournamentId: "tournament.synthetic_nonrated", reason: "Remove practice" });
  assert.equal(replayed, false);
});

// Owner decision 2026-08-28: removal hides a Tournament rather than destroying
// it, and a restore says what the Tournament counts towards again.
function restoreHarness(
  restored: unknown,
  plan: unknown = null,
) {
  const calls: string[] = [];
  const repository = {
    async prepareRetraction() { throw new Error("not used"); },
    async markRatingReplayCompleted() { calls.push("markEpoch"); },
    async restoreTournament(input: unknown) {
      calls.push("restore");
      void input;
      return restored as never;
    },
    async loadRepublishPlan() { return plan as never; },
    async isDirectorOf() { return false; },
    async prepareReopen() { throw new Error("not used"); },
  };
  const service = new TournamentRetractionService(
    repository as never,
    {
      async republish() { calls.push("republish"); },
      async retract() { throw new Error("must not retract during a restore"); },
    } as never,
    {
      async recordDecision() { calls.push("ratingDecision"); },
      async recalculate() { calls.push("replay"); return { epoch: 77 }; },
    } as never,
    () => 1_900_000_000_000,
  );
  return { service, calls };
}

const restoreAdministrator: ActorContext = {
  role: "administrator", userAccountId: "user_account.admin",
};

const restoredState = {
  tournamentId: "tournament.demo",
  wasRetracted: true,
  publicationWasPublic: true,
  ratingWasIncluded: true,
  ratingEpochId: null,
  republished: false,
};

const publishedPlan = {
  publicationId: "tournament_publication.demo",
  expectedRevision: 4,
  eventName: "TN13",
  targets: [{ raceResultId: "tournament_race_result.one", revision: 1 }],
};

it("puts everything back when the restore asks for both", async () => {
  const { service, calls } = restoreHarness(restoredState, publishedPlan);
  const state = await service.restore(restoreAdministrator, {
    tournamentId: "tournament.demo",
    reason: "removed by mistake",
    publicResults: true,
    affectsRating: true,
  });
  assert.equal(state.republished, true);
  // Counting for TrueSkill again is a replay from the seed baseline, not a
  // local edit, so a fresh epoch must have been produced and recorded.
  assert.equal(state.ratingEpochId, 77);
  assert.deepEqual(calls, ["restore", "republish", "ratingDecision", "replay", "markEpoch"]);
});

it("restores the results without touching TrueSkill when asked", async () => {
  const { service, calls } = restoreHarness(restoredState, publishedPlan);
  const state = await service.restore(restoreAdministrator, {
    tournamentId: "tournament.demo",
    reason: "results only",
    publicResults: true,
    affectsRating: false,
  });
  assert.equal(state.republished, true);
  assert.equal(state.ratingEpochId, null);
  assert.ok(!calls.includes("replay"));
});

it("counts it for TrueSkill again without republishing the results", async () => {
  const { service, calls } = restoreHarness(restoredState, publishedPlan);
  const state = await service.restore(restoreAdministrator, {
    tournamentId: "tournament.demo",
    reason: "rating only",
    publicResults: false,
    affectsRating: true,
  });
  assert.equal(state.republished, false);
  assert.equal(state.ratingEpochId, 77);
  assert.ok(!calls.includes("republish"));
});

it("brings a Tournament back that was never published without inventing one", async () => {
  const { service, calls } = restoreHarness(restoredState, null);
  const state = await service.restore(restoreAdministrator, {
    tournamentId: "tournament.demo",
    reason: "never published",
    publicResults: true,
    affectsRating: true,
  });
  assert.equal(state.republished, false);
  assert.ok(!calls.includes("republish"));
  assert.ok(!calls.includes("ratingDecision"));
  // The replay still runs: the Tournament now counts, so the ratings must.
  assert.equal(state.ratingEpochId, 77);
});

it("refuses a restore to anybody but an administrator", async () => {
  const { service, calls } = restoreHarness(null);
  await assert.rejects(
    service.restore(
      { role: "account", userAccountId: "user_account.director" },
      {
        tournamentId: "tournament.demo", reason: "please",
        publicResults: true, affectsRating: true,
      },
    ),
    (error: unknown) => (error as { code?: string }).code === "forbidden",
  );
  assert.equal(calls.length, 0);
});

it("requires a restore reason, like the removal it reverses", async () => {
  const { service, calls } = restoreHarness(null);
  await assert.rejects(
    service.restore(restoreAdministrator, {
      tournamentId: "tournament.demo", reason: "x",
      publicResults: false, affectsRating: false,
    }),
    (error: unknown) => (error as { code?: string }).code === "invalid_input",
  );
  assert.equal(calls.length, 0);
});

it("reports a Tournament that does not exist", async () => {
  const { service } = restoreHarness(null);
  await assert.rejects(
    service.restore(restoreAdministrator, {
      tournamentId: "tournament.missing", reason: "removed by mistake",
      publicResults: false, affectsRating: false,
    }),
    (error: unknown) => (error as { code?: string }).code === "not_found",
  );
});

// Owner decision 2026-08-28: a Tournament's own director may remove it, because
// removal hides rather than destroys and an administrator can restore it.
it("lets the Tournament's own director remove it", async () => {
  let removed = false;
  const service = new TournamentRetractionService(
    {
      async prepareRetraction() {
        removed = true;
        return {
          tournamentId: "tournament.demo", alreadyRetracted: false,
          publicationId: null, publicationRevision: null, publicationStatus: null,
          publicationWasPublic: false, ratingWasIncluded: false, ratingEpochId: null,
        };
      },
      async markRatingReplayCompleted() {},
      async restoreTournament() { return null; },
      async loadRepublishPlan() { return null; },
      async isDirectorOf() { return true; },
    } as never,
    {
      async republish() { throw new Error("must not republish"); },
      async retract() { throw new Error("must not retract"); },
    } as never,
    {
      async recordDecision() { throw new Error("must not touch rating"); },
      async recalculate() { throw new Error("must not replay"); },
    } as never,
    () => 1_900_000_000_000,
  );
  await service.remove(
    { role: "account", userAccountId: "user_account.director" },
    { tournamentId: "tournament.demo", reason: "wrong night" },
  );
  assert.equal(removed, true);
});

it("refuses an account that does not direct that Tournament", async () => {
  let reached = false;
  const service = new TournamentRetractionService(
    {
      async prepareRetraction() { reached = true; throw new Error("must not reach"); },
      async markRatingReplayCompleted() {},
      async restoreTournament() { return null; },
      async loadRepublishPlan() { return null; },
      async isDirectorOf() { return false; },
    } as never,
    {
      async republish() { throw new Error("must not republish"); },
      async retract() { throw new Error("must not retract"); },
    } as never,
    {
      async recordDecision() { throw new Error("must not touch rating"); },
      async recalculate() { throw new Error("must not replay"); },
    } as never,
    () => 1_900_000_000_000,
  );
  await assert.rejects(
    service.remove(
      { role: "account", userAccountId: "user_account.stranger" },
      { tournamentId: "tournament.demo", reason: "not mine" },
    ),
    (error: unknown) => (error as { code?: string }).code === "forbidden",
  );
  assert.equal(reached, false);
});

// Owner decision 2026-09-15: a finalized night can be reopened to correct a
// mistake found late, typically while writing the report.
function reopenHarness(state: unknown) {
  const calls: string[] = [];
  const repository = {
    async prepareRetraction() { throw new Error("not used"); },
    async markRatingReplayCompleted() { throw new Error("not used"); },
    async restoreTournament() { return null; },
    async loadRepublishPlan() { return null; },
    async isDirectorOf() { return false; },
    async prepareReopen() { calls.push("reopen"); return state as never; },
  };
  const publications = {
    async republish() { throw new Error("must not republish"); },
    async retract() { calls.push("retract"); },
  };
  const ratings = {
    async recordDecision(input: { ratingIncluded: boolean; reasonCode: string }) { calls.push(`decision:${input.ratingIncluded}:${input.reasonCode}`); },
    async recalculate(input: { reasonCode: string }) { calls.push(`replay:${input.reasonCode}`); return { epoch: 7 }; },
  };
  const reports = { async unpublish() { calls.push("unpublish"); } };
  return { calls, service: new TournamentRetractionService(repository, publications, ratings, () => 1_800_000_000_000, reports) };
}

it("reopening a rated, published night retracts the result set, replays the rating without it and puts the report back to draft", async () => {
  const { calls, service } = reopenHarness({
    tournamentId: "tournament.synthetic_rated", wasFinalized: true,
    publicationId: "tournament_publication.synthetic_rated", publicationRevision: 2,
    publicationStatus: "published", publicationWasPublic: true, ratingWasIncluded: true, ratingEpochId: null,
  });
  const reopened = await service.reopen(actor, { tournamentId: "tournament.synthetic_rated", reason: "Scores of the Wild group were swapped" });
  assert.equal(reopened.ratingEpochId, 7);
  assert.deepEqual(calls, ["reopen", "retract", "unpublish", "decision:false:tournament_reopened", "replay:tournament_reopened"]);
});

it("reopening a night that did not count leaves the rating alone, and refuses a night that is not finalized", async () => {
  const quiet = reopenHarness({
    tournamentId: "tournament.synthetic_quiet", wasFinalized: true,
    publicationId: "tournament_publication.synthetic_quiet", publicationRevision: 1,
    publicationStatus: "published", publicationWasPublic: false, ratingWasIncluded: false, ratingEpochId: null,
  });
  await quiet.service.reopen(actor, { tournamentId: "tournament.synthetic_quiet", reason: "Wrong seating" });
  assert.deepEqual(quiet.calls, ["reopen", "retract", "unpublish"]);
  // A replay that cannot run leaves the night reopened and says what to do next.
  const broken = reopenHarness({
    tournamentId: "tournament.synthetic_broken", wasFinalized: true,
    publicationId: "tournament_publication.synthetic_broken", publicationRevision: 1,
    publicationStatus: "published", publicationWasPublic: true, ratingWasIncluded: true, ratingEpochId: null,
  });
  (broken.service as unknown as { ratings: { recalculate(): Promise<never> } }).ratings.recalculate = async () => { throw new Error("the corrected history is empty - build it first"); };
  await assert.rejects(broken.service.reopen(actor, { tournamentId: "tournament.synthetic_broken", reason: "History missing" }), /reopened, but the rating could not be replayed.*history is empty.*recompute/);
  assert.deepEqual(broken.calls, ["reopen", "retract", "unpublish", "decision:false:tournament_reopened"]);
  const open = reopenHarness({
    tournamentId: "tournament.synthetic_open", wasFinalized: false,
    publicationId: null, publicationRevision: null, publicationStatus: null,
    publicationWasPublic: true, ratingWasIncluded: true, ratingEpochId: null,
  });
  await assert.rejects(open.service.reopen(actor, { tournamentId: "tournament.synthetic_open", reason: "Nothing to undo" }), /not finalized/);
  const director: ActorContext = { role: "account", userAccountId: "user_account.synthetic_director" };
  await assert.rejects(open.service.reopen(director, { tournamentId: "tournament.synthetic_open", reason: "Not mine to undo" }), /Administrator/);
});
