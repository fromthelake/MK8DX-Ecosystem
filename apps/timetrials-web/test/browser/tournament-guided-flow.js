import { mountTournamentOperation } from "../../dist/tournament-operation-view.js";

const networkFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => String(input).includes("/incoming-results")
  ? Promise.resolve(new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }))
  : networkFetch(input, init);

const names = ["Ace", "Ben", "Floyd", "Nova", "Evan", "Daisy", "Luigi", "Mario"];
const directory = names.map((displayName) => ({
  playerId: `player.visual_${displayName.toLowerCase()}`,
  username: displayName.toLowerCase(),
  displayName,
}));
const participants = directory.map((player, index) => ({
  ...player,
  attendance: "absent",
  hasSwitch1: false,
  hasSwitch2: false,
  inactive: index >= 5,
  seedRank: index + 1,
  seedScore: 40 - index,
}));
let state = {
  summary: {
    tournamentId: "tournament.visual_guided_0001",
    name: "MK8DX Community Cup",
    eventDate: "2026-08-26",
    stage: "setup",
    workflowStep: 2,
    qualifierRounds: true,
    maxParticipants: 32,
    revision: 2,
    participantCount: participants.length,
    presentCount: 0,
    publicResults: false,
    affectsRating: false,
    updatedAtMs: Date.now(),
    seedingSource: "community_rating",
    verifiedOnly: false,
  },
  participants,
  stations: [],
  groups: [],
  overall: [],
  lifecycle: [{ sequence: 1, eventType: "created", detail: "MK8DX Community Cup", occurredAtMs: Date.now() }],
};

const revise = (patch) => {
  state = { ...state, ...patch, summary: { ...state.summary, ...patch.summary, revision: state.summary.revision + 1 } };
  return Promise.resolve(state);
};
const group = (locked = false) => {
  const activePlayers = state.participants.filter((player) => player.attendance === "present");
  return ({
  groupId: "tournament_group.visual_guided_0001",
  stage: "qualifier",
  sequence: 1,
  name: "Groep 1",
  locked,
  manualScoreSegments: 1,
  members: activePlayers.map((player, index) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    seatOrder: index + 1,
    station: {
      ownerPlayerId: activePlayers[index < 2 ? 0 : 2].playerId,
      ownerDisplayName: activePlayers[index < 2 ? 0 : 2].displayName,
      switchType: "ns1",
      seatNumber: index % 2 + 1,
    },
  })),
  races: [],
  manualScores: [],
  standings: { source: "none", rows: [] },
  });
};
const unused = async () => { throw new Error("Not part of this visual gate"); };
const client = {
  listPublic: unused,
  loadPublic: unused,
  listForAdministrator: unused,
  load: async () => state,
  create: unused,
  update: unused,
  setParticipant: async (_tournamentId, input) => {
    const nextParticipants = state.participants.map((player) => player.playerId === input.playerId
      ? { ...player, ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "expectedRevision" && key !== "playerId")) }
      : player);
    return revise({
      participants: nextParticipants,
      summary: {
        presentCount: nextParticipants.filter((player) => player.attendance === "present").length,
        participantCount: nextParticipants.length,
      },
      stations: nextParticipants.flatMap((player) => [
        ...(player.hasSwitch1 ? [{ ownerPlayerId: player.playerId, ownerDisplayName: player.displayName, switchType: "ns1" }] : []),
        ...(player.hasSwitch2 ? [{ ownerPlayerId: player.playerId, ownerDisplayName: player.displayName, switchType: "ns2" }] : []),
      ]),
    });
  },
  addHistoricalParticipants: async () => state,
  addRecentParticipants: async () => state,
  removeParticipant: unused,
  generateGroups: async () => revise({
    summary: { stage: "qualifiers", workflowStep: 3 },
    groups: [group(false)],
  }),
  updateGroups: async () => state,
  lockGroups: async () => revise({
    summary: { stage: "qualifiers", workflowStep: 4 },
    groups: [group(true)],
  }),
  setWorkflowStep: async (_id, input) => revise({ summary: { workflowStep: input.targetStep } }),
  enterRace: unused,
  attachRaces: unused,
  setManualScores: unused,
  finalizationPreview: unused,
  finalize: unused,
  setResultsVisibility: unused,
  recordIncident: async () => state,
  createPlayer: unused,
  deleteDraft: unused,
  removeTournament: unused,
};
const players = {
  listMine: unused,
  listAll: async () => directory,
  search: async (query) => directory.filter((player) => player.displayName.toLowerCase().includes(query.toLowerCase())),
  request: unused,
  createOwnPlayer: unused,
};

mountTournamentOperation(document.querySelector("#app"), {
  tournamentId: state.summary.tournamentId,
  client,
  players,
  confirm: () => true,
});
