import { mountTournamentOperation } from "../../dist/tournament-operation-view.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "manual";
const scoreStep = params.get("step") === "9" ? 9 : 5;
const scoreStage = scoreStep === 9 ? "final" : "qualifier";
const participants = [
  { playerId: "player.ben", username: "ben", displayName: "Ben", attendance: "present", hasSwitch1: true, hasSwitch2: false, inactive: false, seedRank: 1, seedScore: 40 },
  { playerId: "player.evan", username: "evan", displayName: "Evan", attendance: "present", hasSwitch1: false, hasSwitch2: false, inactive: false, seedRank: 2, seedScore: 39 },
];
const members = participants.map((player, index) => ({
  playerId: player.playerId,
  displayName: player.displayName,
  seatOrder: index + 1,
  station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns1", seatNumber: index + 1 },
}));
const emptyStandings = { source: "none", rows: [] };
let group = {
  groupId: "tournament_group.score_acceptance",
  stage: scoreStage,
  sequence: 1,
  name: scoreStep === 9 ? "Champion" : "Qualifier A",
  locked: true,
  manualScoreSegments: 1,
  members,
  races: [],
  manualScores: [],
  standings: emptyStandings,
};
let state = {
  summary: {
    tournamentId: "tournament.score_acceptance",
    name: `Score acceptance · ${mode}`,
    stage: scoreStep === 9 ? "finals" : "qualifiers",
    workflowStep: scoreStep,
    qualifierRounds: true,
    maxParticipants: 12,
    revision: 5,
    participantCount: 2,
    presentCount: 2,
    publicResults: false,
    affectsRating: false,
    updatedAtMs: Date.now(),
    seedingSource: "community_rating",
    verifiedOnly: false,
  },
  participants,
  stations: [{ ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns1" }],
  groups: [group],
  overall: [],
  lifecycle: [],
};
let incomingStatus = "pending";
let acceptedBody = null;
const manualScoreBodies = [];
const incomingResult = {
  incomingResultId: "incoming.score_acceptance",
  tournamentId: state.summary.tournamentId,
  sourceKind: "tournament_live_capture",
  status: incomingStatus,
  revision: 1,
  result: {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.score_acceptance",
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    source: { kind: "tournament_live_capture", transport: "native_contract" },
    timestamps: { createdAtMs: Date.now() },
    placements: [
      { finishPosition: 1, participantReference: { namespace: "producer_local_player", value: "local.ben" }, observedPlayerName: "Ben" },
      { finishPosition: 2, participantReference: { namespace: "producer_local_player", value: "local.evan" }, observedPlayerName: "Evan" },
    ],
  },
  suggestedPhase: scoreStage,
  suggestedGroupId: group.groupId,
  suggestedRaceNumber: 1,
  occurredAtMs: null,
  capturedAtMs: Date.now(),
  duplicateWarning: false,
  createdAtMs: Date.now(),
};

const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
}));
globalThis.fetch = async (input, init = {}) => {
  const path = String(input);
  if (path === "/v1/session/csrf") return response({ headerName: "x-mk8dx-csrf", value: "score-gate-proof" });
  if (path.endsWith("/evidence-records") && init.method === "GET") return response({ records: [] });
  if (path.endsWith("/incoming-results") && init.method === "GET") {
    return response({ results: mode === "desktop" ? [{ ...incomingResult, status: incomingStatus }] : [] });
  }
  if (path.endsWith("/actions/accept-group") && init.method === "POST") {
    acceptedBody = JSON.parse(String(init.body));
    const mapped = acceptedBody.entries.every((entry) => entry.correctedResult.placements.every(
      (placement) => placement.participantReference.namespace === "player",
    ));
    if (!mapped) return response({ message: "Every desktop observation must be mapped to a Player." }, 400);
    incomingStatus = "accepted";
    group = {
      ...group,
      races: [{
        raceNumber: 1,
        raceResultId: incomingResult.result.raceResultId,
        revision: 1,
        scoringSegment: 1,
        sourceKind: incomingResult.sourceKind,
        trackId: incomingResult.result.trackId,
        countsTowardStandings: true,
        placements: [
          { finishPosition: 1, playerId: "player.ben", displayName: "Ben", racePoints: 15 },
          { finishPosition: 2, playerId: "player.evan", displayName: "Evan", racePoints: 12 },
        ],
      }],
      standings: { source: "races", rows: [
        { rank: 1, playerId: "player.ben", displayName: "Ben", points: 15, races: 1, wins: 1, bestRace: 15, complete: true },
        { rank: 2, playerId: "player.evan", displayName: "Evan", points: 12, races: 1, wins: 0, bestRace: 12, complete: true },
      ] },
    };
    state = { ...state, summary: { ...state.summary, revision: 6 }, groups: [group] };
    return response({ raceResultIds: [incomingResult.result.raceResultId], tournamentRevision: 6 });
  }
  throw new Error(`Unexpected score-gate request: ${init.method ?? "GET"} ${path}`);
};

const unused = async () => { throw new Error("Not part of this score-path gate"); };
const client = {
  listPublic: unused, loadPublic: unused, listForAdministrator: unused,
  load: async () => state, create: unused, update: unused, setParticipant: unused,
  addHistoricalParticipants: async () => state, addRecentParticipants: unused,
  removeParticipant: unused,
  generateGroups: async () => {
    const finalGroup = {
      ...group,
      groupId: "tournament_group.score_acceptance_final",
      stage: "final",
      sequence: 1,
      name: "Champion",
      tierKey: "champion",
      locked: false,
      races: [],
      manualScores: [],
      standings: emptyStandings,
    };
    state = {
      ...state,
      summary: { ...state.summary, stage: "finals", workflowStep: 7, revision: state.summary.revision + 1 },
      groups: [group, finalGroup],
    };
    return state;
  },
  updateGroups: unused,
  lockGroups: async (_id, input) => {
    state = {
      ...state,
      summary: { ...state.summary, workflowStep: input.stage === "final" && input.locked ? 8 : state.summary.workflowStep, revision: state.summary.revision + 1 },
      groups: state.groups.map((entry) => entry.stage === input.stage ? { ...entry, locked: input.locked } : entry),
    };
    return state;
  },
  attachRaces: unused,
  enterRaces: async (_id, input) => {
    // Two-Player races: 15 for the winner, 12 for second, as the server scores them.
    const target = state.groups.find((entry) => entry.groupId === input.groupId) ?? group;
    const points = new Map();
    const races = input.races.map((race, index) => ({
      raceNumber: race.raceNumber ?? index + 1, raceResultId: `tournament_race_result.harness_${index + 1}`, revision: 1,
      scoringSegment: 1, sourceKind: "workbook_import", trackId: race.trackId, countsTowardStandings: true,
      placements: race.finishOrder.map((playerId, position) => {
        const racePoints = position === 0 ? 15 : 12;
        points.set(playerId, (points.get(playerId) ?? 0) + racePoints);
        return { finishPosition: position + 1, playerId, displayName: members.find((member) => member.playerId === playerId).displayName, racePoints };
      }),
    }));
    const rows = [...points].sort((left, right) => right[1] - left[1]).map(([playerId, total], index) => ({
      rank: index + 1, playerId, displayName: members.find((member) => member.playerId === playerId).displayName,
      points: total, races: races.length, wins: 0, bestRace: 15, complete: true,
    }));
    const updated = { ...target, races, manualScores: [], standings: { source: "races", rows } };
    if (updated.stage === "qualifier") { group = updated; }
    state = {
      ...state,
      summary: { ...state.summary, revision: state.summary.revision + 1 },
      groups: state.groups.map((entry) => entry.groupId === updated.groupId ? updated : entry),
    };
    return state;
  },
  setManualScores: async (_id, input) => {
    manualScoreBodies.push(input);
    const target = state.groups.find((entry) => entry.groupId === input.groupId) ?? group;
    const totals = input.scores.map((score) => ({
      playerId: score.playerId,
      displayName: members.find((member) => member.playerId === score.playerId).displayName,
      points: score.segmentPoints.reduce((sum, value) => sum + (value ?? 0), 0),
    })).sort((left, right) => right.points - left.points);
    const updated = {
      ...target,
      manualScoreSegments: input.segments,
      manualScores: input.scores,
      standings: { source: "manual", rows: totals.map((row, index) => ({
        rank: index + 1, ...row, races: 0, wins: 0, bestRace: 0,
        complete: input.scores.find((score) => score.playerId === row.playerId).segmentPoints.every((value) => value !== null),
      })) },
    };
    if (updated.stage === "qualifier") { group = updated; }
    state = {
      ...state,
      summary: { ...state.summary, revision: state.summary.revision + 1 },
      groups: state.groups.map((entry) => entry.groupId === updated.groupId ? updated : entry),
    };
    return state;
  },
  previewScoreWorkbook: async () => [{ videoName: "Qualifier A", rows: [
    { playerName: "Ben", totalPoints: 82, position: 1, pointSegments: [40, 42] },
    { playerName: "Evan", totalPoints: 75, position: 2, pointSegments: [35, 40] },
  ], races: mode === "track-placeholder" ? [
    // The recording started after race 1's track card: the extractor's placeholder.
    { raceNumber: 1, trackName: "UNKNOWN", finishOrder: ["Ben", "Evan"] },
    { raceNumber: 2, trackName: "Toad Harbour", finishOrder: ["Evan", "Ben"] },
  ] : mode === "late-start" ? [
    { raceNumber: 1, trackName: "Toad Harbour", finishOrder: ["Ben", "Evan"] },
    { raceNumber: 2, trackName: "Big Blue", finishOrder: ["Evan", "Ben"] },
  ] : [], ...(mode === "late-start" ? {
    // The recording started after race 1: the first recorded race already shows these totals.
    carriedPoints: [{ playerName: "Ben", points: 30 }, { playerName: "Evan", points: 20 }],
  } : {}) }],
  setWorkflowStep: async (_id, input) => {
    state = { ...state, summary: { ...state.summary, workflowStep: input.targetStep, revision: state.summary.revision + 1 } };
    return state;
  },
  finalizationPreview: unused, finalize: unused, setResultsVisibility: unused,
  recordIncident: async () => state, createPlayer: unused, deleteDraft: unused, removeTournament: unused,
};
const players = { listMine: unused, listAll: async () => participants, search: async () => participants, request: unused, createOwnPlayer: unused };

globalThis.__scoreHarness = { getState: () => state, getAcceptedBody: () => acceptedBody, getManualScoreBodies: () => manualScoreBodies };
mountTournamentOperation(document.querySelector("#app"), {
  tournamentId: state.summary.tournamentId,
  client,
  players,
  confirm: () => true,
});
