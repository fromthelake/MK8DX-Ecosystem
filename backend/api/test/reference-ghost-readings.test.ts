import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { NINTENDO_STAFF_REFERENCES } from "../src/reference-ghosts/nintendo-staff-references.js";
import {
  ReferenceGhostReadingService,
  mergeReading,
  parseReferenceGhostReading,
  type ReferenceGhostReadingRepository,
} from "../src/reference-ghosts/reference-ghost-readings.js";
import { registerReferenceGhostRoutes } from "../src/reference-ghosts/reference-ghost-routes.js";

// ADR-0212: LiveTrial sends proven Nintendo staff and World Record ghost readings.

const STAFF = {
  trackId: "track.3ds_alpine_pass", mode: 150 as const, timeMs: 144_730, name: "Nin★Fausti", countryId: "country.fr",
  loadout: { characterId: "character.morton", bodyId: "body.pipe_frame", tireId: "tire.monster", gliderId: "glider.super_glider" },
};

const panel = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "mk8dx.reference-ghost-reading.v1",
  kind: "nintendo_staff",
  trackId: STAFF.trackId,
  mode: 150,
  totalTimeMs: 144_730,
  observedName: "NIN FAUSTI",
  countryId: "country.fr",
  loadout: STAFF.loadout,
  lapTimesMs: [48_500, 48_100, 48_130],
  ...overrides,
});

const replay = (overrides: Record<string, unknown> = {}) => panel({
  coinsPerLap: [5, 3, 2],
  mushroomsPerLap: [1, 1, 1],
  events: {
    status: "available", timeBase: "race_elapsed_ms",
    coinEvents: [{ raceMs: 3_000, lap: 1, from: 0, to: 1 }],
    mushroomEvents: [{ raceMs: 2_000, lap: 1 }, { raceMs: 50_000, lap: 2 }, { raceMs: 99_000, lap: 3 }],
  },
  ...overrides,
});

function service(worldRecordMs: number | null = 100_000) {
  const recorded: unknown[] = [];
  const repository: ReferenceGhostReadingRepository = {
    record: vi.fn(async (reading) => { recorded.push(reading); return "recorded" as const; }),
    list: vi.fn(async () => []),
  };
  // Colour variants name their part: character_variant.morton.002_x is Morton.
  const catalog = {
    knowsTrack: () => true,
    baseLoadout: (loadout: { characterId: string; bodyId: string; tireId: string; gliderId: string }) =>
      loadout.gliderId === "glider.unknown" ? null : {
        ...loadout,
        characterId: loadout.characterId.replace(/^character_variant\.([a-z_]+)\..*$/, "character.$1"),
      },
  };
  return {
    recorded,
    repository,
    service: new ReferenceGhostReadingService(repository, { timeMs: async () => worldRecordMs }, catalog,
      { nowMs: () => 1_000 }, [STAFF]),
  };
}

const account = { role: "account", userAccountId: "user_account.synthetic01" } as const;

describe("a reference ghost reading", () => {
  it("is bounded: laps add up, coins and mushrooms come together from a replay", () => {
    expect(parseReferenceGhostReading(panel()).source).toBe("ghost_panel");
    expect(parseReferenceGhostReading(replay()).source).toBe("ghost_replay");
    expect(() => parseReferenceGhostReading(panel({ lapTimesMs: [48_500, 48_100, 48_131] }))).toThrow(/add up/);
    expect(() => parseReferenceGhostReading(panel({ coinsPerLap: [1, 1, 1] }))).toThrow(/come together/);
    expect(() => parseReferenceGhostReading(replay({ mushroomsPerLap: [2, 1, 1] }))).toThrow(/three mushrooms/);
    expect(() => parseReferenceGhostReading(replay({ coinsPerLap: [11, 0, 0] }))).toThrow(/coinsPerLap/);
    expect(() => parseReferenceGhostReading(panel({ extra: 1 }))).toThrow(/not allowed/);
    expect(() => parseReferenceGhostReading(panel({ events: (replay() as Record<string, unknown>)["events"] }))).toThrow(/from a replay/);
  });

  it("is kept only when it is that Nintendo staff ghost: time, name and kart setup", async () => {
    const { service: staff, recorded } = service();
    await expect(staff.record(account, panel())).resolves.toBe("recorded");
    expect(recorded).toHaveLength(1);
    await expect(staff.record(account, panel({ totalTimeMs: 144_731, lapTimesMs: [48_500, 48_100, 48_131] })))
      .rejects.toMatchObject({ code: "not_a_reference" });
    await expect(staff.record(account, panel({ observedName: "Somebody" }))).rejects.toMatchObject({ code: "not_a_reference" });
    await expect(staff.record(account, panel({ loadout: { ...STAFF.loadout, tireId: "tire.roller" } })))
      .rejects.toMatchObject({ code: "not_a_reference" });
    await expect(staff.record({ role: "anonymous" }, panel())).rejects.toMatchObject({ code: "not_authenticated" });
    // The same kart in another colour is still that staff ghost; an unknown part is refused.
    await expect(staff.record(account, panel({ loadout: { ...STAFF.loadout, characterId: "character_variant.morton.002_red" } })))
      .resolves.toBe("recorded");
    await expect(staff.record(account, panel({ loadout: { ...STAFF.loadout, gliderId: "glider.unknown" } })))
      .rejects.toMatchObject({ code: "invalid_assets" });
  });

  it("is kept only when it is the current World Record, the v4.0.0 one the website follows", async () => {
    const { service: current } = service(144_730);
    await expect(current.record(account, panel({ kind: "world_record", observedName: "Anyone", loadout: null })))
      .resolves.toBe("recorded");
    const { service: newer } = service(144_000);
    await expect(newer.record(account, panel({ kind: "world_record", observedName: "Anyone" })))
      .rejects.toMatchObject({ code: "not_a_reference" });
  });

  it("is never overwritten: a replay completes the panel, agreement confirms, a difference conflicts", () => {
    const first = mergeReading(null, parseReferenceGhostReading(panel()));
    expect(first.outcome).toBe("recorded");
    const completed = mergeReading(first.next, parseReferenceGhostReading(replay()));
    expect(completed.outcome).toBe("completed");
    expect(completed.next?.coinsPerLap).toEqual([5, 3, 2]);
    expect(mergeReading(completed.next, parseReferenceGhostReading(replay())).outcome).toBe("confirmed");
    expect(mergeReading(completed.next, parseReferenceGhostReading(panel())).outcome).toBe("confirmed");
    expect(mergeReading(completed.next, parseReferenceGhostReading(replay({ coinsPerLap: [4, 4, 2] }))).outcome)
      .toBe("conflict");
    expect(mergeReading(first.next, parseReferenceGhostReading(panel({ lapTimesMs: [48_400, 48_200, 48_130] }))).outcome)
      .toBe("conflict");
  });

  it("names the staff the web's track board names: 192 entries, every one with a kart setup", async () => {
    expect(NINTENDO_STAFF_REFERENCES).toHaveLength(192);
    expect(NINTENDO_STAFF_REFERENCES.every((entry) =>
      entry.loadout.characterId !== null && entry.loadout.gliderId !== null)).toBe(true);
    // Regenerate with tooling/web/generate_api_staff_references.mjs when this fails.
    // Outside this package's rootDir, so imported by a computed path.
    const path = new URL("../../../apps/timetrials-web/src/benchmark-manifest.ts", import.meta.url).href;
    const manifest = await import(/* @vite-ignore */ path) as {
      benchmarksByKind(kind: string, mode: 150 | 200): readonly Readonly<{ trackId: string; mode: number }>[];
    };
    const web = [150, 200].flatMap((mode) => manifest.benchmarksByKind("nintendo_staff", mode as 150 | 200));
    for (const entry of NINTENDO_STAFF_REFERENCES) {
      const twin = web.find((candidate) => candidate.trackId === entry.trackId && candidate.mode === entry.mode);
      expect(twin, `${entry.trackId} ${entry.mode}`).toMatchObject({
        timeMs: entry.timeMs, name: entry.name, countryId: entry.countryId, loadout: entry.loadout,
      });
    }
  });
});

describe("the reference ghost routes", () => {
  async function app(role: "account" | "anonymous") {
    const { service: readings, repository } = service();
    // As the product's app: query values are not coerced (app.ts).
    const server = Fastify({ ajv: { customOptions: { coerceTypes: false } } });
    await registerReferenceGhostRoutes(server, {
      resolveActor: async () => role === "account" ? account : { role: "anonymous" },
      service: readings,
    });
    return { server, repository };
  }

  it("takes a reading only from a signed-in native client", async () => {
    const signedIn = await app("account");
    const cookieOnly = await signedIn.server.inject({ method: "POST", url: "/v1/reference-ghost-readings", payload: panel() });
    expect(cookieOnly.statusCode).toBe(403);
    const native = await signedIn.server.inject({
      method: "POST", url: "/v1/reference-ghost-readings", payload: panel(),
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(native.statusCode).toBe(200);
    expect(native.json()).toEqual({ schemaVersion: "mk8dx.reference-ghost-reading-result.v1", outcome: "recorded" });
    const refused = await signedIn.server.inject({
      method: "POST", url: "/v1/reference-ghost-readings", payload: panel({ observedName: "Somebody" }),
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("reference_ghost_not_a_reference");
    const anonymous = await app("anonymous");
    expect((await anonymous.server.inject({ method: "POST", url: "/v1/reference-ghost-readings", payload: panel() })).statusCode)
      .toBe(401);
  });

  it("lists the readings publicly, for one track and class when asked", async () => {
    const { server, repository } = await app("anonymous");
    const response = await server.inject({ method: "GET", url: `/v1/public/reference-ghost-readings?trackId=${STAFF.trackId}&mode=150` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: "mk8dx.reference-ghost-readings.v1", readings: [] });
    expect(repository.list).toHaveBeenCalledWith({ trackId: STAFF.trackId, mode: 150 });
  });
});
