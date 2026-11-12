import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import { registerTournamentConnectedRoutes } from "../src/tournaments/tournament-connected-routes.js";
import type {
  TournamentConnectedService,
  TournamentEvidenceRecord,
} from "../src/tournaments/tournament-connected-service.js";
import { TournamentOperationError } from "../src/tournaments/tournament-operation-service.js";

const director: ActorContext = { role: "account", userAccountId: "user_account.synthetic_director" };
const path = "/v1/administrator/tournaments/tournament.synthetic/evidence-records/evidence.stale/actions/dismiss-live";

const invalidated: TournamentEvidenceRecord = {
  recordId: "evidence.stale", clientRecordId: "run-stale", revision: 4,
  status: "uploading", sourceKind: "tournament_live_capture",
  uploadedBy: { userAccountId: "user_account.capture", displayName: "Capture" },
  startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null, complete: false,
  suggestedTournamentId: "tournament.synthetic", suggestedTournamentName: "Synthetic", linkedTournamentId: null,
  groups: [], resultCount: 0, createdAtMs: 1, updatedAtMs: 2,
  live: { status: "invalidated", mappings: [], approvedAtMs: null, stoppedAtMs: null, completedAtMs: null },
};

describe("Tournament connected dismiss-live route", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  function app(dismiss: TournamentConnectedService["dismissLiveRequest"]) {
    const instance = Fastify();
    apps.push(instance);
    const calls: Parameters<TournamentConnectedService["dismissLiveRequest"]>[] = [];
    registerTournamentConnectedRoutes(instance, {
      resolveActor: async () => director,
      csrfVerifier: { verify: (_actor, token) => token === "valid-csrf" },
      tournamentConnected: {
        async dismissLiveRequest(...arguments_: Parameters<TournamentConnectedService["dismissLiveRequest"]>) {
          calls.push(arguments_);
          return dismiss(...arguments_);
        },
      } as unknown as TournamentConnectedService,
    });
    return { instance, calls };
  }

  it("requires the same-origin request proof before calling the service", async () => {
    const { instance, calls } = app(async () => invalidated);
    const missing = await instance.inject({ method: "POST", url: path, payload: { expectedRevision: 3 } });
    const wrong = await instance.inject({
      method: "POST", url: path, headers: { "x-mk8dx-csrf": "forged" }, payload: { expectedRevision: 3 },
    });
    expect([missing.statusCode, wrong.statusCode]).toEqual([403, 403]);
    expect(missing.json()).toMatchObject({ code: "tournament_forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("passes the path identifiers and body to the service and answers { record } like approve-live", async () => {
    const { instance, calls } = app(async () => invalidated);
    const response = await instance.inject({
      method: "POST", url: path, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 3, reason: "Aborted run", tournamentId: "tournament.other", recordId: "evidence.other" },
    });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json())).toEqual(["record"]);
    expect(response.json().record.live.status).toBe("invalidated");
    expect(calls[0]?.[0]).toEqual(director);
    expect(calls[0]?.[1]).toEqual({
      expectedRevision: 3, reason: "Aborted run", tournamentId: "tournament.synthetic", recordId: "evidence.stale",
    });
  });

  it("maps a refused dismissal of an already public live run to 409", async () => {
    const { instance } = app(async () => {
      throw new TournamentOperationError("conflict", "Only a live request that never went public can be dismissed.");
    });
    const response = await instance.inject({
      method: "POST", url: path, headers: { "x-mk8dx-csrf": "valid-csrf" }, payload: { expectedRevision: 3 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "tournament_conflict", message: "Only a live request that never went public can be dismissed.",
    });
  });
});
