// Several races are recorded one by one; a refused race found halfway left the earlier ones behind and made
// every retry of the group fail (2026-11-12, a misspelled track id). All races are now checked first.
import assert from "node:assert/strict";
import { it } from "vitest";

import { checkRacesBeforeRecording, TournamentOperationError } from "../src/tournaments/tournament-operation-service.js";

const race = (raceNumber: number, trackId: string) => ({ raceNumber, trackId }) as never;

it("refuses the whole batch before anything is recorded when one race is invalid", async () => {
  const checked: number[] = [];
  const store = {
    async submit() { throw new Error("must not be called"); },
    async check(document: { raceNumber: number; trackId: string }) {
      checked.push(document.raceNumber);
      if (document.trackId === "track.toad_harbor") { throw new Error("Tournament asset references are invalid"); }
    },
  };
  await assert.rejects(
    checkRacesBeforeRecording(store, [race(1, "track.mario_circuit"), race(2, "track.toad_harbor"), race(3, "track.water_park")]),
    (error: unknown) => error instanceof TournamentOperationError && error.code === "invalid_input" &&
      /race 2 is not valid.*nothing was recorded/.test(error.message),
  );
  assert.deepEqual(checked, [1, 2]);
});

it("lets a valid batch through", async () => {
  const store = { async submit() { return { raceResultId: "x", revision: 1 }; }, async check() {} };
  await checkRacesBeforeRecording(store, [race(1, "track.mario_circuit"), race(2, "track.toad_harbour")]);
});

it("keeps working with a store that cannot check", async () => {
  await checkRacesBeforeRecording({ async submit() { return { raceResultId: "x", revision: 1 }; } }, [race(1, "track.anything")]);
});
