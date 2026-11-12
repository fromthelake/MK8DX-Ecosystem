import assert from "node:assert/strict";
import { it } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import {
  TournamentConnectedService,
  liveRosterMatch,
  projectTournamentLiveGroups,
  type ConnectedRaceResultService,
  type ConnectedTournamentOperationService,
  type IncomingTournamentResult,
  type StoredTournamentEvidenceRecord,
  type TournamentConnectedRepository,
} from "../src/tournaments/tournament-connected-service.js";

const administrator: ActorContext = { role: "administrator", userAccountId: "user_account.synthetic_admin" };
const captureOperator: ActorContext = { role: "account", userAccountId: "user_account.mosshm" };

function result(id: string, kind: "tournament_live_capture" | "tournament_recorded_video" = "tournament_live_capture") {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1" as const,
    raceResultId: id,
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    placements: [
      { finishPosition: 1, participantReference: { namespace: "producer_local_player" as const, value: "local.alpha" }, scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 } },
      { finishPosition: 2, participantReference: { namespace: "producer_local_player" as const, value: "local.bravo" }, scoring: { racePoints: 12, totalBeforeRace: 0, totalAfterRace: 12, rankAfterRace: 2 } },
    ],
    source: { kind, transport: "native_contract" as const },
    timestamps: { occurredAtMs: 1_800_000_000_000, createdAtMs: 1_800_000_001_000 },
  };
}

function confirmedResult(source: ReturnType<typeof result>) {
  return {
    ...source,
    verification: { status: "producer_check_passed" as const, method: "tournament_manager_human_confirmation" },
    placements: source.placements.map((placement, index) => ({
      ...placement,
      participantReference: { namespace: "player" as const, value: index === 0 ? "player.alpha" : "player.bravo" },
    })),
  };
}

it("requires several unique exact display, username or alias matches before live viewing", () => {
  const race = result("race.roster-match");
  const placements = race.placements as Array<(typeof race.placements)[number] & { observedPlayerName?: string }>;
  placements[0]!.observedPlayerName = "BenAI";
  placements[1]!.observedPlayerName = "Soudler";
  placements.push({ ...race.placements[1]!, finishPosition: 3, observedPlayerName: "Nova" });
  const entry = {
    entryKey: "race.roster-match:1", result: race,
    observedGroupLabel: "CC Groep 1", suggestedPhase: "qualifier",
    suggestedGroupId: "group.one", suggestedRaceNumber: 1, occurredAtMs: null,
  };
  const match = liveRosterMatch([entry], [
    { playerId: "player.ben", names: ["Ben", "ben", "BEnZor", "BenAI"] },
    { playerId: "player.sadler", names: ["Sadler", "Soudler"] },
    { playerId: "player.nova", names: ["Nova"] },
    { playerId: "player.evan", names: ["Evan"] },
  ]);
  assert.deepEqual(match, { matchedPlayers: 3, comparablePlayers: 3, confidence: 1, sufficient: true });
  assert.equal(liveRosterMatch([entry], [
    { playerId: "player.ben", names: ["BenAI"] },
    { playerId: "player.other", names: ["Other"] },
    { playerId: "player.third", names: ["Third"] },
  ]).sufficient, false);
  assert.equal(liveRosterMatch([entry], [
    { playerId: "player.ben", names: ["BenAI"] },
    { playerId: "player.duplicate", names: ["BenAI"] },
    { playerId: "player.sadler", names: ["Soudler"] },
  ]).matchedPlayers, 1);
});

function repository(): TournamentConnectedRepository & { inserted: IncomingTournamentResult[] } {
  const inserted: IncomingTournamentResult[] = [];
  return {
    inserted,
    async listEligibleTournaments() { return []; },
    async findActiveTournamentInternalId() { return 7; },
    async canReviewTournament() { return true; },
    async upsertEvidenceRecord() { throw new Error("unused evidence-record upload"); },
    async listOwnEvidenceRecords() { return []; },
    async listEvidenceRecordsForTournament() { return []; },
    async findEvidenceRecord() { return null; },
    async approveLiveAssociation() { throw new Error("unused live association approval"); },
    async dismissLiveRequest() { throw new Error("unused live request dismissal"); },
    async markOwnEvidenceStopping() { throw new Error("unused live stopping action"); },
    async listPublicLiveRecords() { return []; },
    // The group these fixtures confirm is seated by exactly these two Players;
    // Accept refuses a race listing anyone else before it writes anything.
    async groupMemberPlayerIds() { return ["player.alpha", "player.bravo"]; },
    async materializeEvidenceRecord() { return []; },
    async insertIncomingResult(input) {
      const item: IncomingTournamentResult = {
        incomingResultId: input.incomingResultId,
        tournamentId: "tournament.synthetic_connected",
        sourceKind: input.sourceKind,
        status: "pending",
        revision: 1,
        result: input.result,
        semanticFingerprint: input.semanticFingerprint,
        suggestedPhase: input.suggestedPhase,
        suggestedGroupId: input.suggestedGroupId,
        suggestedRaceNumber: input.suggestedRaceNumber,
        occurredAtMs: input.occurredAtMs,
        capturedAtMs: input.capturedAtMs,
        duplicateWarning: false,
        evidenceRecordId: null,
        submittedByDisplayName: "Synthetic administrator",
        createdAtMs: input.nowMs,
      };
      inserted.push(item);
      return item;
    },
    async listIncomingResults() { return inserted; },
    async findIncomingResult(id) { return inserted.find((item) => item.incomingResultId === id) ?? null; },
    async findIncomingByFingerprint(_tournamentId, fingerprint) { return inserted.find((item) => item.semanticFingerprint === fingerprint) ?? null; },
    async hasAcceptedFingerprint() { return false; },
    async hasGroupRace() { return false; },
    async markAccepted() {},
    async markRejected() {},
  };
}

it("connected upload persists pending evidence and never records a race", async () => {
  const repo = repository();
  let submitted = 0;
  const service = new TournamentConnectedService(repo, {
    async submit() { submitted += 1; return { raceResultId: "tournament_race_result.unexpected" }; },
  }, {
    async attachRaces() { throw new Error("must not attach during upload"); },
  }, () => 1_800_000_002_000);

  const uploaded = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [{ result: result("tournament_race_result.synthetic_pending"), suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 }],
  });
  assert.equal(uploaded[0]?.status, "pending");
  assert.equal(submitted, 0);
});

it("repeated connected delivery returns the same pending race", async () => {
  const repo = repository();
  const service = new TournamentConnectedService(repo, {
    async submit() { throw new Error("must remain pending"); },
  }, {
    async attachRaces() { throw new Error("must remain pending"); },
  });
  const input = {
    tournamentId: "tournament.synthetic_connected",
    entries: [{ result: result("tournament_race_result.synthetic_retry"), suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 }],
  };
  const first = await service.upload(administrator, input);
  const retry = await service.upload(administrator, input);
  assert.equal(repo.inserted.length, 1);
  assert.equal(retry[0]?.incomingResultId, first[0]?.incomingResultId);
});

it("accepts confirmed Live and Processor results only after Player mapping and attaches each race once", async () => {
  const repo = repository();
  const submitted: Parameters<ConnectedRaceResultService["submit"]>[0][] = [];
  const attached: Array<{ groupId: string; raceResultIds: readonly string[]; expectedRevision: number }> = [];
  const accepted: string[] = [];
  repo.markAccepted = async ({ incomingResultId }) => { accepted.push(incomingResultId); };
  const service = new TournamentConnectedService(repo, {
    async submit(value) {
      submitted.push(value);
      return { raceResultId: value.raceResultId };
    },
  }, {
    async attachRaces(_actor, _tournamentId, input) {
      attached.push(input);
      return { summary: { revision: input.expectedRevision + 1 } };
    },
  }, () => 1_800_000_002_000);

  const live = result("tournament_race_result.synthetic_live");
  const processor = result("tournament_race_result.synthetic_processor", "tournament_recorded_video");
  const pending = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [
      { result: live, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 },
      { result: processor, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 2 },
    ],
  });
  assert.equal(pending.length, 2);
  for (const [index, incoming] of pending.entries()) {
    const corrected = confirmedResult(index === 0 ? live : processor);
    await service.accept(administrator, {
      incomingResultId: incoming.incomingResultId,
      expectedRevision: 1,
      tournamentRevision: 7 + index,
      groupId: "tournament_group.synthetic",
      raceNumber: index + 1,
      correctedResult: corrected,
      reason: "Players, track and group confirmed",
    });
  }

  assert.deepEqual(submitted.map((value) => value.source.kind), [
    "tournament_live_capture",
    "tournament_recorded_video",
  ]);
  assert.ok(submitted.every((value) => value.placements.every((placement) => placement.participantReference.namespace === "player")));
  assert.deepEqual(attached.map((value) => [value.expectedRevision, value.raceResultIds]), [
    [7, ["tournament_race_result.synthetic_live"]],
    [8, ["tournament_race_result.synthetic_processor"]],
  ]);
  assert.deepEqual(accepted, pending.map((value) => value.incomingResultId));
});

it("rejects connected Tournament discovery without server-side operator authority", async () => {
  const repo = repository();
  const service = new TournamentConnectedService(repo, {
    async submit() { throw new Error("unreachable"); },
  }, {
    async attachRaces() { throw new Error("unreachable"); },
  });
  await assert.rejects(
    service.listEligible({ role: "anonymous" }),
    /signed-in account is required/i,
  );
});

it("uploads an independent complete evidence record from an ordinary signed-in account", async () => {
  const repo = repository();
  const stored: Parameters<TournamentConnectedRepository["upsertEvidenceRecord"]>[0][] = [];
  repo.upsertEvidenceRecord = async (input) => {
    stored.push(input);
    return {
      recordId: input.recordId, clientRecordId: input.clientRecordId, revision: 1,
      status: "available", sourceKind: input.sourceKind,
      uploadedBy: { userAccountId: input.uploadedByUserAccountId, displayName: "MossHM" },
      startedAtMs: input.startedAtMs, stoppedAtMs: input.stoppedAtMs,
      analysisCompletedAtMs: input.analysisCompletedAtMs, complete: input.complete,
      suggestedTournamentId: input.suggestedTournamentId,
      suggestedTournamentName: "Summer Tournament", linkedTournamentId: null,
      groups: input.summary, resultCount: input.entries.length,
      createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
    };
  };
  const service = new TournamentConnectedService(repo, {
    async submit() { throw new Error("record upload must never score"); },
  }, {
    async attachRaces() { throw new Error("record upload must never attach"); },
  }, () => 1_800_000_100_000);
  const first = result("tournament_race_result.record_one");
  const second = { ...result("tournament_race_result.record_two"), raceNumber: 2 };
  const uploaded = await service.uploadEvidenceRecord(captureOperator, {
    clientRecordId: "run-20260830-140200",
    suggestedTournamentId: "tournament.summer",
    startedAtMs: 1_800_000_000_000,
    stoppedAtMs: 1_800_000_090_000,
    analysisCompletedAtMs: 1_800_000_099_000,
    complete: true,
    entries: [
      { entryKey: "feed-1:race:1", observedGroupLabel: "Groep 1", result: first },
      { entryKey: "feed-1:race:2", observedGroupLabel: "Groep 1", result: second },
    ],
  });
  assert.equal(uploaded.uploadedBy.displayName, "MossHM");
  assert.equal(uploaded.groups[0]?.races, 2);
  assert.deepEqual(uploaded.groups[0]?.topThree, [
    { observedPlayer: "local.alpha", points: 30 },
    { observedPlayer: "local.bravo", points: 24 },
  ]);
  assert.equal(stored[0]?.uploadedByUserAccountId, "user_account.mosshm");
});

it("registers a mapped live run before its first race and requires director approval before publication", async () => {
  const repo = repository();
  const stored: Parameters<TournamentConnectedRepository["upsertEvidenceRecord"]>[0][] = [];
  const approved: Parameters<TournamentConnectedRepository["approveLiveAssociation"]>[0][] = [];
  repo.upsertEvidenceRecord = async (input) => {
    stored.push(input);
    return {
      recordId: input.recordId, clientRecordId: input.clientRecordId, revision: 1,
      status: "uploading", sourceKind: input.sourceKind,
      uploadedBy: { userAccountId: input.uploadedByUserAccountId, displayName: "Capture" },
      startedAtMs: input.startedAtMs, stoppedAtMs: null, analysisCompletedAtMs: null,
      complete: false, suggestedTournamentId: input.suggestedTournamentId,
      suggestedTournamentName: "Live Tournament", linkedTournamentId: null,
      groups: [], resultCount: 0, createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
      live: { status: "requested", mappings: input.liveRegistration!.mappings, approvedAtMs: null, stoppedAtMs: null, completedAtMs: null },
    };
  };
  repo.approveLiveAssociation = async (input) => {
    approved.push(input);
    return {
      recordId: input.recordId, clientRecordId: "run-live", revision: 2,
      status: "uploading", sourceKind: "tournament_live_capture",
      uploadedBy: { userAccountId: captureOperator.userAccountId!, displayName: "Capture" },
      startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null,
      complete: false, suggestedTournamentId: input.tournamentId,
      suggestedTournamentName: "Live Tournament", linkedTournamentId: null,
      groups: [], resultCount: 0, createdAtMs: 1, updatedAtMs: input.nowMs,
      live: { status: "active", mappings: input.mappings, approvedAtMs: input.nowMs, stoppedAtMs: null, completedAtMs: null },
    };
  };
  const service = new TournamentConnectedService(repo, { async submit() { throw new Error("unreachable"); } }, {
    async attachRaces() { throw new Error("unreachable"); },
  }, () => 1_800_000_200_000);
  const requested = await service.uploadEvidenceRecord(captureOperator, {
    clientRecordId: "run-live", sourceKind: "tournament_live_capture",
    suggestedTournamentId: "tournament.synthetic_connected", startedAtMs: 1,
    complete: false, entries: [],
    liveMappings: [{ observedGroupLabel: "Capture Card 1", groupId: "group.one", phase: "qualifier" }],
  });
  assert.equal(requested.live?.status, "requested");
  assert.equal(stored[0]?.entries.length, 0);
  const active = await service.approveLiveAssociation(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: requested.recordId,
    expectedRevision: requested.revision,
    mappings: [{ observedGroupLabel: "Capture Card 1", groupId: "group.one", phase: "qualifier" }],
    reason: "Sticker and group checked",
  });
  assert.equal(active.live?.status, "active");
  assert.equal(approved[0]?.reviewedByUserAccountId, administrator.userAccountId);
});

it("dismisses a stale live request through the reviewer's repository call with a bounded reason", async () => {
  const repo = repository();
  const dismissed: Parameters<TournamentConnectedRepository["dismissLiveRequest"]>[0][] = [];
  repo.dismissLiveRequest = async (input) => {
    dismissed.push(input);
    return {
      recordId: input.recordId, clientRecordId: "run-stale", revision: input.expectedRevision + 1,
      status: "uploading", sourceKind: "tournament_live_capture",
      uploadedBy: { userAccountId: captureOperator.userAccountId!, displayName: "Capture" },
      startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null,
      complete: false, suggestedTournamentId: input.tournamentId,
      suggestedTournamentName: "Live Tournament", linkedTournamentId: null,
      groups: [], resultCount: 0, createdAtMs: 1, updatedAtMs: input.nowMs,
      live: { status: "invalidated", mappings: [], approvedAtMs: null, stoppedAtMs: null, completedAtMs: null },
    };
  };
  const service = new TournamentConnectedService(repo, { async submit() { throw new Error("unreachable"); } }, {
    async attachRaces() { throw new Error("unreachable"); },
  }, () => 1_800_000_300_000);
  const record = await service.dismissLiveRequest(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 3,
    reason: "  Aborted run  ",
  });
  assert.equal(record.live?.status, "invalidated");
  assert.deepEqual(dismissed[0], {
    recordId: "evidence.stale", expectedRevision: 3, tournamentId: "tournament.synthetic_connected",
    reviewedByUserAccountId: administrator.userAccountId, reason: "Aborted run", nowMs: 1_800_000_300_000,
  });
  await service.dismissLiveRequest(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 3,
  });
  assert.equal(dismissed[1]?.reason, "Stale live request dismissed by Tournament director");

  await assert.rejects(service.dismissLiveRequest(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 0,
  }), /expectedRevision is invalid/);
  await assert.rejects(service.dismissLiveRequest(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 3,
    reason: "x".repeat(513),
  }), /reason is invalid/);
  await assert.rejects(service.dismissLiveRequest(administrator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 3,
    reason: 42 as unknown as string,
  }), /reason is invalid/);
  repo.canReviewTournament = async () => false;
  await assert.rejects(service.dismissLiveRequest(captureOperator, {
    tournamentId: "tournament.synthetic_connected", recordId: "evidence.stale", expectedRevision: 3,
  }), /cannot review/);
  assert.equal(dismissed.length, 2);
});

it("activates only the provisional public view after every feed has a strong exact roster match", async () => {
  const repo = repository();
  let stored: StoredTournamentEvidenceRecord | null = null;
  const approvals: Parameters<TournamentConnectedRepository["approveLiveAssociation"]>[0][] = [];
  repo.groupMemberMatchNames = async (_tournamentId, groupId) => [
    { playerId: `${groupId}.player.1`, names: ["Ben", "BenAI"] },
    { playerId: `${groupId}.player.2`, names: ["Sadler", "Soudler"] },
    { playerId: `${groupId}.player.3`, names: ["Nova"] },
  ];
  repo.findEvidenceRecord = async () => stored;
  repo.upsertEvidenceRecord = async (input) => {
    const live = input.liveRegistration
      ? { status: "requested" as const, mappings: input.liveRegistration.mappings, approvedAtMs: null, stoppedAtMs: null, completedAtMs: null }
      : stored?.live;
    const next: StoredTournamentEvidenceRecord = {
      recordId: stored?.recordId ?? input.recordId,
      clientRecordId: input.clientRecordId,
      revision: (stored?.revision ?? 0) + 1,
      status: "uploading", sourceKind: input.sourceKind,
      uploadedBy: { userAccountId: input.uploadedByUserAccountId, displayName: "Capture" },
      startedAtMs: input.startedAtMs, stoppedAtMs: input.stoppedAtMs,
      analysisCompletedAtMs: input.analysisCompletedAtMs, complete: input.complete,
      suggestedTournamentId: input.suggestedTournamentId,
      suggestedTournamentName: "Live Tournament", linkedTournamentId: null,
      groups: input.summary, resultCount: input.entries.length,
      createdAtMs: 1, updatedAtMs: input.nowMs,
      entries: input.entries,
      ...(live === undefined ? {} : { live }),
    };
    stored = next;
    const { entries: _entries, ...summary } = next;
    return summary;
  };
  repo.approveLiveAssociation = async (input) => {
    approvals.push(input);
    const active = { ...stored!, revision: stored!.revision + 1, live: { ...stored!.live!, status: "active" as const, approvedAtMs: input.nowMs } };
    stored = active;
    const { entries: _entries, ...summary } = active;
    return summary;
  };
  const service = new TournamentConnectedService(repo, { async submit() { throw new Error("unreachable"); } }, {
    async attachRaces() { throw new Error("unreachable"); },
  }, () => 1_800_000_300_000);
  const mappings = [
    { observedGroupLabel: "CC Groep 1", groupId: "group.one", phase: "qualifier" },
    { observedGroupLabel: "CC Groep 2", groupId: "group.two", phase: "qualifier" },
  ];
  const requested = await service.uploadEvidenceRecord(captureOperator, {
    clientRecordId: "run-roster-live", sourceKind: "tournament_live_capture",
    suggestedTournamentId: "tournament.synthetic_connected", complete: false,
    entries: [], liveMappings: mappings,
  });
  assert.equal(requested.live?.status, "requested");
  const matching = (id: string) => {
    const value = result(id);
    const placements = value.placements as Array<(typeof value.placements)[number] & { observedPlayerName?: string }>;
    placements[0]!.observedPlayerName = "BenAI";
    placements[1]!.observedPlayerName = "Soudler";
    placements.push({
      ...value.placements[1]!, finishPosition: 3, observedPlayerName: "Nova",
      participantReference: { namespace: "producer_local_player", value: "local.charlie" },
    });
    return value;
  };
  const active = await service.uploadEvidenceRecord(captureOperator, {
    clientRecordId: "run-roster-live", sourceKind: "tournament_live_capture",
    suggestedTournamentId: "tournament.synthetic_connected", complete: false,
    entries: [
      { entryKey: "one:1", result: matching("tournament_race_result.roster_one"), observedGroupLabel: "CC Groep 1" },
      { entryKey: "two:1", result: matching("tournament_race_result.roster_two"), observedGroupLabel: "CC Groep 2" },
    ],
  });
  assert.equal(active.live?.status, "active");
  assert.equal(approvals[0]?.authorization, "roster_match");
  assert.equal(approvals[0]?.reviewedByUserAccountId, captureOperator.userAccountId);
});

it("prevents two live feeds from being assigned to the same group", async () => {
  const service = new TournamentConnectedService(repository(), { async submit() { throw new Error("unreachable"); } }, {
    async attachRaces() { throw new Error("unreachable"); },
  });
  await assert.rejects(service.uploadEvidenceRecord(captureOperator, {
    clientRecordId: "run-live-duplicate", sourceKind: "tournament_live_capture",
    suggestedTournamentId: "tournament.synthetic_connected", complete: false, entries: [],
    liveMappings: [
      { observedGroupLabel: "Capture Card 1", groupId: "group.one", phase: "qualifier" },
      { observedGroupLabel: "Capture Card 2", groupId: "group.one", phase: "qualifier" },
    ],
  }), /cannot use two live feeds/);
});

it("projects live totals through opening balance reset excluded race and a shorter field", () => {
  const first = result("race.live.one");
  first.placements[0]!.scoring.totalBeforeRace = 20;
  first.placements[0]!.scoring.totalAfterRace = 35;
  const excluded = {
    ...result("race.live.excluded"), raceNumber: 2, scoringSegment: 2,
    countsTowardStandings: false,
    verification: { status: "producer_check_passed" as const, method: "tournament_manager_human_confirmation" as const },
    placements: [
      { ...first.placements[0]!, scoring: { racePoints: 15, totalBeforeRace: 35, totalAfterRace: 35, rankAfterRace: 1 } },
    ],
  };
  const corrected = {
    ...excluded, revision: 2,
    placements: [
      { ...excluded.placements[0]!, observedPlayerName: "Alpha" },
    ],
  };
  const record: StoredTournamentEvidenceRecord = {
    recordId: "record.live", clientRecordId: "run.live", revision: 7,
    status: "uploading", sourceKind: "tournament_live_capture",
    uploadedBy: { userAccountId: "user_account.capture", displayName: "Capture" },
    startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null, complete: false,
    suggestedTournamentId: "tournament.live", suggestedTournamentName: "Live",
    linkedTournamentId: null, groups: [], resultCount: 3, createdAtMs: 1, updatedAtMs: 99,
    entries: [
      { entryKey: "one:1", result: first, observedGroupLabel: "Feed 1", suggestedPhase: "qualifier", suggestedGroupId: null, suggestedRaceNumber: 1, occurredAtMs: 10 },
      { entryKey: "two:1", result: excluded, observedGroupLabel: "Feed 1", suggestedPhase: "qualifier", suggestedGroupId: null, suggestedRaceNumber: 2, occurredAtMs: 20 },
      { entryKey: "two:2", result: corrected, observedGroupLabel: "Feed 1", suggestedPhase: "qualifier", suggestedGroupId: null, suggestedRaceNumber: 2, occurredAtMs: 30 },
    ],
    live: {
      status: "active", approvedAtMs: 5, stoppedAtMs: null, completedAtMs: null,
      mappings: [{ observedGroupLabel: "Feed 1", groupId: "group.one", phase: "qualifier" }],
    },
  };

  const [group] = projectTournamentLiveGroups(record);
  assert.equal(group?.status, "live");
  assert.equal(group?.streamRevision, 7);
  assert.equal(group?.receivedRaces, 2);
  assert.equal(group?.countedRaces, 1);
  assert.deepEqual(group?.standings.map((row) => [row.observedPlayerName, row.total]), [["Alpha", 35], ["local.bravo", 12]]);
  assert.deepEqual(group?.controlPoints, ["1 connection reset", "1 excluded race", "1 race awaiting recognition review"]);
});

it("keeps one live standing per observed player when every race brings new observation references", () => {
  const race = (n: number, gianni: number, ivar: number) => ({
    ...result(`race.live.${n}`), raceNumber: n,
    verification: { status: "producer_check_passed" as const, method: "tournament_manager_human_confirmation" as const },
    placements: [
      { finishPosition: 1, observedPlayerName: "Gianni", participantReference: { namespace: "unresolved_observation" as const, value: `observation.g${n}` },
        scoring: { racePoints: 15, totalBeforeRace: gianni - 15, totalAfterRace: gianni, rankAfterRace: 1 } },
      { finishPosition: 2, observedPlayerName: "Ivar", participantReference: { namespace: "unresolved_observation" as const, value: `observation.i${n}` },
        scoring: { racePoints: 12, totalBeforeRace: ivar - 12, totalAfterRace: ivar, rankAfterRace: 2 } },
    ],
  });
  const record: StoredTournamentEvidenceRecord = {
    recordId: "record.tn13", clientRecordId: "run.tn13", revision: 3,
    status: "uploading", sourceKind: "tournament_live_capture",
    uploadedBy: { userAccountId: "user_account.capture", displayName: "Capture" },
    startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null, complete: false,
    suggestedTournamentId: "tournament.live", suggestedTournamentName: "Live",
    linkedTournamentId: null, groups: [], resultCount: 3, createdAtMs: 1, updatedAtMs: 99,
    entries: [1, 2, 3].map((n) => ({ entryKey: `race:${n}`, result: race(n, 15 * n, 12 * n), observedGroupLabel: "Groep 1",
      suggestedPhase: "qualifier", suggestedGroupId: null, suggestedRaceNumber: n, occurredAtMs: n })),
    live: {
      status: "active", approvedAtMs: 5, stoppedAtMs: null, completedAtMs: null,
      mappings: [{ observedGroupLabel: "Groep 1", groupId: "group.one", phase: "qualifier" }],
    },
  };
  const [group] = projectTournamentLiveGroups(record);
  assert.equal(group?.countedRaces, 3);
  assert.deepEqual(group?.standings.map((row) => [row.rank, row.observedPlayerName, row.total]), [[1, "Gianni", 45], [2, "Ivar", 36]]);
});

it("lets the Tournament director map a complete record before pending evidence is materialized", async () => {
  const repo = repository();
  const source = result("tournament_race_result.record_link");
  const record: StoredTournamentEvidenceRecord = {
    recordId: "evidence.record", clientRecordId: "run-record", revision: 3,
    status: "available", sourceKind: "tournament_live_capture",
    uploadedBy: { userAccountId: "user_account.mosshm", displayName: "MossHM" },
    startedAtMs: 1, stoppedAtMs: 2, analysisCompletedAtMs: 3, complete: true,
    suggestedTournamentId: "tournament.synthetic_connected", suggestedTournamentName: "Tournament",
    linkedTournamentId: null,
    groups: [{ observedGroupLabel: "Kampioen", races: 1, connectionErrors: 0, topThree: [] }],
    resultCount: 1, createdAtMs: 1, updatedAtMs: 3,
    entries: [{
      entryKey: "kampioen:race:1", result: source, observedGroupLabel: "Kampioen",
      suggestedPhase: "final", suggestedGroupId: null, suggestedRaceNumber: 1, occurredAtMs: null,
    }],
  };
  repo.findEvidenceRecord = async () => record;
  const materialized: Parameters<TournamentConnectedRepository["materializeEvidenceRecord"]>[0][] = [];
  repo.materializeEvidenceRecord = async (input) => { materialized.push(input); return []; };
  const service = new TournamentConnectedService(repo, {
    async submit() { throw new Error("linking remains pending"); },
  }, {
    async attachRaces() { throw new Error("linking remains pending"); },
  });
  await service.linkEvidenceRecord(administrator, {
    tournamentId: "tournament.synthetic_connected",
    recordId: record.recordId,
    expectedRevision: 3,
    mappings: [{ observedGroupLabel: "Kampioen", groupId: "group.champion", phase: "final" }],
    reason: "Record and group checked",
  });
  assert.equal(materialized[0]?.reviewedByUserAccountId, administrator.userAccountId);
  assert.equal(materialized[0]?.entries[0]?.suggestedGroupId, "group.champion");
  assert.match(materialized[0]?.entries[0]?.semanticFingerprint ?? "", /^[a-f0-9]{64}$/);
});

it("duplicate group race is blocked before canonical submission", async () => {
  const repo = repository();
  const uploaded = await new TournamentConnectedService(repo, { async submit() { return { raceResultId: "x" }; } }, {
    async attachRaces() { return { summary: { revision: 2 } }; },
  }).upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [{ result: result("tournament_race_result.synthetic_duplicate"), suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 }],
  });
  repo.hasGroupRace = async () => true;
  const service = new TournamentConnectedService(repo, { async submit() { throw new Error("must not submit duplicate"); } }, {
    async attachRaces() { throw new Error("must not attach duplicate"); },
  });
  await assert.rejects(service.accept(administrator, {
    incomingResultId: uploaded[0]!.incomingResultId,
    expectedRevision: 1,
    tournamentRevision: 1,
    groupId: "tournament_group.synthetic",
    raceNumber: 1,
    correctedResult: result("tournament_race_result.synthetic_duplicate"),
    reason: "confirmed",
  }), /already has an accepted contribution/);
});

it("allows a delegated Tournament operator to upload pending evidence without administrator access", async () => {
  const repo = repository();
  const service = new TournamentConnectedService(repo, {
    async submit() { throw new Error("upload must remain pending"); },
  }, {
    async attachRaces() { throw new Error("upload must remain pending"); },
  }, Date.now, undefined, async (userAccountId) => userAccountId === captureOperator.userAccountId);
  const input = { tournamentId: "tournament.synthetic_connected", entries: [{ result: result("tournament_race_result.delegated") }] };
  await assert.rejects(
    new TournamentConnectedService(repo, { async submit() { throw new Error("unused"); } },
      { async attachRaces() { throw new Error("unused"); } }).upload(captureOperator, input),
    /authority is required/,
  );
  const pending = await service.upload(captureOperator, input);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.status, "pending");
});

it("confirms one mapped group feed with a single Tournament revision", async () => {
  const repo = repository();
  const attached: string[][] = [];
  const accepted: string[] = [];
  repo.markAccepted = async ({ incomingResultId }) => { accepted.push(incomingResultId); };
  const service = new TournamentConnectedService(repo, {
    async submit(value) { return { raceResultId: value.raceResultId }; },
  }, {
    async attachRaces(_actor, _tournamentId, input) {
      attached.push([...input.raceResultIds]);
      return { summary: { revision: input.expectedRevision + 1 } };
    },
  });
  const first = result("tournament_race_result.batch_one");
  const second = { ...result("tournament_race_result.batch_two"), raceNumber: 2 };
  const pending = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [
      { result: first, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 },
      { result: second, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 2 },
    ],
  });
  const confirmed = await service.acceptGroup(administrator, {
    tournamentRevision: 11,
    groupId: "tournament_group.synthetic",
    reason: "Complete group feed reviewed",
    entries: [
      { incomingResultId: pending[0]!.incomingResultId, expectedRevision: 1, raceNumber: 1, correctedResult: confirmedResult(first) },
      { incomingResultId: pending[1]!.incomingResultId, expectedRevision: 1, raceNumber: 2, correctedResult: confirmedResult(second) },
    ],
  });
  assert.deepEqual(attached, [[first.raceResultId, second.raceResultId]]);
  assert.deepEqual(accepted, pending.map((item) => item.incomingResultId));
  assert.equal(confirmed.tournamentRevision, 12);
});

it("replaces an overlapping group only after an explicit complete-feed confirmation", async () => {
  const repo = repository();
  repo.hasAcceptedFingerprint = async () => true;
  repo.hasGroupRace = async () => true;
  const attached: Parameters<ConnectedTournamentOperationService["attachRaces"]>[2][] = [];
  const service = new TournamentConnectedService(repo, {
    async submit(value) { return { raceResultId: value.raceResultId }; },
  }, {
    async attachRaces(_actor, _tournamentId, input) {
      attached.push(input);
      return { summary: { revision: input.expectedRevision + 1 } };
    },
  });
  const first = result("tournament_race_result.replacement_one");
  const second = { ...result("tournament_race_result.replacement_two"), raceNumber: 2 };
  const pending = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [
      { result: first, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 },
      { result: second, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 2 },
    ],
  });
  await service.acceptGroup(administrator, {
    tournamentRevision: 20,
    groupId: "tournament_group.synthetic",
    replaceExisting: true,
    reason: "Complete replacement reviewed",
    entries: [
      { incomingResultId: pending[0]!.incomingResultId, expectedRevision: 1, raceNumber: 1, correctedResult: confirmedResult(first) },
      { incomingResultId: pending[1]!.incomingResultId, expectedRevision: 1, raceNumber: 2, correctedResult: confirmedResult(second) },
    ],
  });
  assert.deepEqual(attached, [{
    expectedRevision: 20,
    groupId: "tournament_group.synthetic",
    raceResultIds: [first.raceResultId, second.raceResultId],
    replaceExisting: true,
  }]);
});

it("refuses a gapped replacement feed before canonical submission", async () => {
  const repo = repository();
  let submitted = 0;
  const service = new TournamentConnectedService(repo, {
    async submit(value) { submitted += 1; return { raceResultId: value.raceResultId }; },
  }, {
    async attachRaces() { throw new Error("must not attach a gapped replacement"); },
  });
  const second = { ...result("tournament_race_result.replacement_gap"), raceNumber: 2 };
  const [pending] = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [{ result: second, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 2 }],
  });
  await assert.rejects(service.acceptGroup(administrator, {
    tournamentRevision: 1,
    groupId: "tournament_group.synthetic",
    replaceExisting: true,
    reason: "Incomplete replacement",
    entries: [{ incomingResultId: pending!.incomingResultId, expectedRevision: 1, raceNumber: 2, correctedResult: confirmedResult(second) }],
  }), /every race from race 1 without gaps/);
  assert.equal(submitted, 0);
});

it("blocks a group feed with more than three resets before canonical submission", async () => {
  const repo = repository();
  let submitted = 0;
  const excessive = { ...result("tournament_race_result.too_many_resets"), scoringSegment: 5 };
  const service = new TournamentConnectedService(repo, {
    async submit(value) { submitted += 1; return { raceResultId: value.raceResultId }; },
  }, {
    async attachRaces() { throw new Error("must not attach blocked feed"); },
  });
  const [pending] = await service.upload(administrator, {
    tournamentId: "tournament.synthetic_connected",
    entries: [{ result: excessive, suggestedGroupId: "tournament_group.synthetic", suggestedRaceNumber: 1 }],
  });
  await assert.rejects(service.acceptGroup(administrator, {
    tournamentRevision: 1,
    groupId: "tournament_group.synthetic",
    reason: "reviewed",
    entries: [{ incomingResultId: pending!.incomingResultId, expectedRevision: 1, raceNumber: 1, correctedResult: confirmedResult(excessive) }],
  }), /More than three connection resets/);
  assert.equal(submitted, 0);
});
