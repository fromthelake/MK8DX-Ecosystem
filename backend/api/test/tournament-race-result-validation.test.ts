import { describe, expect, it } from "vitest";

import {
  TournamentValidationError,
  tournamentAssetReferences,
  validateTournamentRaceResult,
  type TournamentRaceResultV1,
} from "../src/tournaments/race-result-validation.js";

function recordedResult(): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.synthetic_validation_001",
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    context: {
      tournamentReference: {
        namespace: "producer_local_tournament",
        value: "synthetic_tournament_01",
      },
      groupReference: {
        namespace: "producer_local_group",
        value: "group_alpha",
      },
      observedGroupLabel: "Group Alpha",
    },
    placements: [
      {
        finishPosition: 1,
        participantReference: {
          namespace: "player",
          value: "player.synthetic_tournament_01",
        },
        observedPlayerName: "Synthetic Racer",
        characterId: "character.mario",
        scoring: {
          racePoints: 15,
          totalBeforeRace: 0,
          totalAfterRace: 15,
          rankAfterRace: 1,
        },
      },
      {
        finishPosition: 2,
        participantReference: {
          namespace: "producer_local_player",
          value: "synthetic.local.player_02",
        },
        observedPlayerName: "Observed Racer",
        characterId: "character.yoshi",
        characterVariantId: "character_variant.yoshi.018_black",
        scoring: {
          racePoints: 12,
          totalBeforeRace: 0,
          totalAfterRace: 12,
          rankAfterRace: 2,
        },
        confidence: { playerName: 0.95, character: 0.9 },
      },
      {
        finishPosition: 3,
        participantReference: {
          namespace: "unresolved_observation",
          value: "synthetic.unresolved.player_03",
        },
        observedPlayerName: "Third Racer",
        scoring: {
          racePoints: 10,
          totalBeforeRace: 0,
          totalAfterRace: 10,
          rankAfterRace: 3,
        },
      },
    ],
    source: {
      kind: "tournament_recorded_video",
      transport: "native_contract",
      producerVersion: "synthetic-test",
      localRecordId: "race-001",
      sessionId: "session-001",
      sourceMediaId: "video-001",
      raceOffsetMs: 120_000,
      frameIndex: 3_600,
    },
    timestamps: { capturedAtMs: 1_900_000_000_000, createdAtMs: 1_900_000_001_000 },
    evidence: [{
      kind: "race_score_screen",
      reference: "synthetic/race-001-score.png",
      sha256: "33".repeat(32),
      mediaType: "image/png",
    }],
    verification: {
      status: "producer_check_passed",
      method: "synthetic confirmed consensus",
      confidence: 0.98,
      fieldConfidence: { track: 0.99, playerCount: 1, racePoints: 0.99 },
    },
  };
}

function validate(value: unknown): void {
  validateTournamentRaceResult(value);
}

describe("Tournament race result V1 runtime validation", () => {
  it("accepts a confirmed recorded-video result and exposes only typed assets", () => {
    const result = recordedResult();
    expect(() => validate(result)).not.toThrow();
    expect(tournamentAssetReferences(result)).toEqual({
      trackId: "track.mario_kart_stadium",
      placements: [
        { characterId: "character.mario" },
        {
          characterId: "character.yoshi",
          characterVariantId: "character_variant.yoshi.018_black",
        },
        {},
      ],
    });
  });

  it.each([
    ["live", "tournament_live_capture", "native_contract"],
    ["workbook", "tournament_spreadsheet_import", "excel_workbook"],
    ["csv", "tournament_spreadsheet_import", "csv"],
  ])("accepts confirmed %s producer/transport provenance", (_label, kind, transport) => {
    const result: any = structuredClone(recordedResult());
    result.source.kind = kind;
    result.source.transport = transport;
    expect(() => validate(result)).not.toThrow();
  });

  it.each([
    ["unknown top-level field", (value: any) => { value.firebaseIndex = 1; }],
    ["numeric track", (value: any) => { value.trackId = 0; }],
    ["provisional source", (value: any) => { value.source.kind = "provisional_live_display"; }],
    ["UserAccount participant", (value: any) => {
      value.placements[0].participantReference = {
        namespace: "user_account",
        value: "user_account.synthetic_01",
      };
    }],
    ["system identity", (value: any) => {
      value.placements[0].participantReference = {
        namespace: "player",
        value: "NintendoStaff",
      };
    }],
  ])("rejects %s instead of coercing source/identity values", (_label, mutate) => {
    const result: any = structuredClone(recordedResult());
    mutate(result);
    expect(() => validate(result)).toThrow(TournamentValidationError);
  });

  it("keeps case-distinct observed names valid and non-identifying", () => {
    const result: any = structuredClone(recordedResult());
    result.placements[0].observedPlayerName = "SameName";
    result.placements[1].observedPlayerName = "samename";
    expect(() => validate(result)).not.toThrow();
  });

  it.each([
    ["duplicate finish", (value: any) => { value.placements[1].finishPosition = 1; }],
    ["gap", (value: any) => { value.placements[2].finishPosition = 4; }],
    ["out of order", (value: any) => {
      value.placements[0].finishPosition = 2;
      value.placements[1].finishPosition = 1;
    }],
    ["duplicate participant", (value: any) => {
      value.placements[1].participantReference =
        structuredClone(value.placements[0].participantReference);
    }],
  ])("rejects placement %s", (_label, mutate) => {
    const result: any = structuredClone(recordedResult());
    mutate(result);
    expect(() => validate(result)).toThrow(expect.objectContaining({
      code: "invalid_placements",
    }));
  });

  it("enforces counted and excluded scoring equations and exclusion notes", () => {
    const counted: any = structuredClone(recordedResult());
    counted.placements[0].scoring.totalAfterRace += 1;
    expect(() => validate(counted)).toThrow(expect.objectContaining({
      code: "invalid_scoring",
    }));

    const excluded: any = structuredClone(recordedResult());
    excluded.countsTowardStandings = false;
    delete excluded.scoringNote;
    for (const placement of excluded.placements) {
      placement.scoring.totalAfterRace = placement.scoring.totalBeforeRace;
      placement.scoring.rankAfterRace = 1;
    }
    expect(() => validate(excluded)).toThrow(expect.objectContaining({
      code: "invalid_result",
    }));
    excluded.scoringNote = "Synthetic retained race excluded from totals";
    expect(() => validate(excluded)).not.toThrow();
  });

  it("enforces competition ranks and accepts shared ranks for ties", () => {
    const tie: any = structuredClone(recordedResult());
    tie.placements[1].scoring.totalBeforeRace = 3;
    tie.placements[1].scoring.totalAfterRace = 15;
    tie.placements[1].scoring.rankAfterRace = 1;
    expect(() => validate(tie)).not.toThrow();

    tie.placements[1].scoring.rankAfterRace = 2;
    expect(() => validate(tie)).toThrow(expect.objectContaining({
      code: "invalid_scoring",
    }));
  });

  it("requires structured issues for failed or needs-review producer checks", () => {
    const result: any = structuredClone(recordedResult());
    result.verification.status = "needs_review";
    expect(() => validate(result)).toThrow(expect.objectContaining({
      code: "invalid_result",
    }));
    result.verification.issues = [{
      code: "scoring.synthetic_review",
      message: "Synthetic scoring review is required.",
    }];
    expect(() => validate(result)).not.toThrow();
  });

  it("supports one through twelve participants without imposing producer limits", () => {
    const one: any = structuredClone(recordedResult());
    one.placements = one.placements.slice(0, 1);
    expect(() => validate(one)).not.toThrow();

    const twelve: any = structuredClone(recordedResult());
    const template = twelve.placements[2];
    for (let position = 4; position <= 12; position += 1) {
      twelve.placements.push({
        ...structuredClone(template),
        finishPosition: position,
        participantReference: {
          namespace: "unresolved_observation",
          value: `synthetic.unresolved.player_${position}`,
        },
        scoring: {
          racePoints: 0,
          totalBeforeRace: 0,
          totalAfterRace: 0,
          rankAfterRace: 4,
        },
      });
    }
    expect(() => validate(twelve)).not.toThrow();
  });
  it("accepts every LAN class and a Mirror race only as a 150cc race (ADR-0217)", () => {
    for (const mode of [50, 100, 150, 200] as const) {
      expect(() => validateTournamentRaceResult({ ...recordedResult(), mode })).not.toThrow();
    }
    expect(() => validateTournamentRaceResult({ ...recordedResult(), mode: 150, mirror: true })).not.toThrow();
    for (const bad of [
      { mode: 125 },
      { mode: 200, mirror: true },
      { mode: 150, mirror: false },
    ]) {
      expect(() => validateTournamentRaceResult({ ...recordedResult(), ...bad }), JSON.stringify(bad))
        .toThrow(TournamentValidationError);
    }
    const { mode: _mode, ...withoutMode } = recordedResult();
    expect(() => validateTournamentRaceResult({ ...withoutMode, mirror: true })).toThrow(TournamentValidationError);
  });
});
