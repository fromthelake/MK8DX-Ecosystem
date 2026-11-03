import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import { PlayerOnboardingError } from "../identity/player-onboarding-service.js";
import {
  TournamentOperationError,
  type FinalizationPreview,
  type FinalizationResult,
  type PublicTournamentEvent,
  type PublicTournamentEventSummary,
  type PublicTournamentPlacementSnapshot,
  type TournamentDocument,
  type TournamentOperationService,
  type TournamentSummary,
} from "./tournament-operation-service.js";
import { parseScoreWorkbookBase64, type ScoreWorkbookVideo } from "./score-workbook-import.js";
import { buildScoreWorkbook } from "./score-workbook-export.js";
import type { TournamentStatisticsService } from "./tournament-statistics.js";
import { type TournamentRaceMode } from "./race-result-validation.js";
import {
  rosterAliasRequestSchema,
  rosterAliasResponseSchema,
  rosterCandidateRequestSchema,
  rosterCandidateResponseSchema,
  rosterPlayersRequestSchema,
  type RosterPlayersRequest,
} from "./roster-player-candidate-schemas.js";

type ErrorResponse = { code: string; message: string };
type CsrfHeaders = { "x-mk8dx-csrf": string };
type TournamentParams = { tournamentId: string };
type TournamentPlacementsQuery = { ids: string };

const tournamentIdSchema = {
  type: "string", minLength: 17, maxLength: 160,
  pattern: "^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const groupIdSchema = {
  type: "string", minLength: 23, maxLength: 160,
  pattern: "^tournament_group\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const playerIdSchema = {
  type: "string", minLength: 8, maxLength: 135,
  pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const directorUserAccountIdSchema = {
  type: "string", minLength: 14, maxLength: 141,
  pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const raceResultIdSchema = {
  type: "string", minLength: 30, maxLength: 151,
  pattern: "^tournament_race_result\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const publicationIdSchema = {
  type: "string", minLength: 30, maxLength: 160,
  pattern: "^tournament_publication\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const reasonCodeSchema = {
  type: "string", minLength: 1, maxLength: 64,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const nameSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const displayNameSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const stageSchema = { type: "string", enum: ["setup", "qualifiers", "finals", "finalized"] } as const;
const groupStageSchema = { type: "string", enum: ["qualifier", "final"] } as const;
const attendanceSchema = { type: "string", enum: ["present", "waiting", "absent"] } as const;
const switchTypeSchema = { type: "string", enum: ["ns1", "ns2"] } as const;
const tieBreakModeSchema = { type: "string", enum: ["sp", "lottery", "manual"] } as const;
const timestampSchema = { type: "integer", minimum: 0 } as const;
const revisionSchema = { type: "integer", minimum: 1 } as const;
const csrfHeadersSchema = {
  type: "object",
  required: ["x-mk8dx-csrf"],
  properties: { "x-mk8dx-csrf": { type: "string", minLength: 1, maxLength: 1024 } },
} as const;
const paramsSchema = {
  type: "object", additionalProperties: false, required: ["tournamentId"],
  properties: { tournamentId: tournamentIdSchema },
} as const;

// ADR-0221: where the qualifier draw takes its order from (the one seeding field).
const seedingSourceSchema = {
  type: "string", enum: ["community_rating", "director_nights", "manual", "random"],
} as const;

const summarySchema = {
  type: "object", additionalProperties: false,
  required: [
    "tournamentId", "name", "stage", "workflowStep", "qualifierRounds", "revision", "participantCount", "presentCount",
    "qualifierTieBreakMode", "finalTieBreakMode", "publicResults", "affectsRating", "updatedAtMs",
    "seedingSource", "verifiedOnly",
  ],
  properties: {
    tournamentId: tournamentIdSchema,
    name: nameSchema,
    seriesLabel: { type: "string", minLength: 1, maxLength: 64 },
    editionNumber: { type: "integer", minimum: 1, maximum: 9999 },
    eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    startAtMs: timestampSchema,
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    stage: stageSchema,
    workflowStep: { type: "integer", minimum: 2, maximum: 10 },
    qualifierRounds: { type: "boolean" },
    seedingSource: seedingSourceSchema,
    verifiedOnly: { type: "boolean" },
    placementStrategy: { type: "string", enum: ["balanced", "minimal_move"] },
    ownerSeatingMode: { type: "string", enum: ["owner_strict", "owner_soft"] },
    qualifierTieBreakMode: tieBreakModeSchema,
    finalTieBreakMode: tieBreakModeSchema,
    maxParticipants: { type: "integer", minimum: 1, maximum: 60 },
    revision: revisionSchema,
    participantCount: { type: "integer", minimum: 0 },
    presentCount: { type: "integer", minimum: 0 },
    publicResults: { type: "boolean" },
    affectsRating: { type: "boolean" },
    publicationId: publicationIdSchema,
    finalizedAtMs: timestampSchema,
    updatedAtMs: timestampSchema,
  },
} as const;

const standingRowSchema = {
  type: "object", additionalProperties: false,
  required: ["rank", "playerId", "displayName", "points", "races", "wins", "bestRace", "complete"],
  properties: {
    rank: { type: "integer", minimum: 1 },
    playerId: playerIdSchema,
    displayName: displayNameSchema,
    points: { type: "integer", minimum: 0 },
    races: { type: "integer", minimum: 0 },
    wins: { type: "integer", minimum: 0 },
    bestRace: { type: "integer", minimum: 0 },
    complete: { type: "boolean" },
    // Present only where the Director corrected the total the races add up to.
    correctedFromRaces: { type: "integer", minimum: 0 },
  },
} as const;

/** The character a score workbook recorded for a Player in a group. */
const characterSchema = {
  type: "object", additionalProperties: false, required: ["label"],
  properties: {
    key: { type: "string", minLength: 1, maxLength: 96 },
    label: { type: "string", minLength: 1, maxLength: 64 },
    roster: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

const groupSchema = {
  type: "object", additionalProperties: false,
  required: [
    "groupId", "stage", "sequence", "name", "locked", "manualScoreSegments",
    "members", "stations", "races", "manualScores", "standings",
  ],
  properties: {
    groupId: groupIdSchema,
    stage: groupStageSchema,
    sequence: { type: "integer", minimum: 1, maximum: 5 },
    name: { type: "string", minLength: 1, maxLength: 64 },
    tierKey: { type: "string", minLength: 1, maxLength: 16 },
    locked: { type: "boolean" },
    manualScoreSegments: { type: "integer", minimum: 1, maximum: 6 },
    members: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        required: ["playerId", "displayName", "seatOrder"],
        properties: {
          playerId: playerIdSchema,
          displayName: displayNameSchema,
          seatOrder: { type: "integer", minimum: 1, maximum: 12 },
          character: characterSchema,
          station: {
            type: "object", additionalProperties: false,
            required: ["ownerPlayerId", "ownerDisplayName", "switchType", "seatNumber"],
            properties: {
              ownerPlayerId: playerIdSchema,
              ownerDisplayName: displayNameSchema,
              switchType: switchTypeSchema,
              seatNumber: { type: "integer", minimum: 1, maximum: 2 },
              utpCableNumber: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
    stations: {
      type: "array", maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["slotIndex", "ownerPlayerId", "ownerDisplayName", "switchType"],
        properties: {
          slotIndex: { type: "integer", minimum: 1, maximum: 6 },
          ownerPlayerId: playerIdSchema,
          ownerDisplayName: displayNameSchema,
          switchType: switchTypeSchema,
          utpCableNumber: { type: "integer", minimum: 1 },
        },
      },
    },
    races: {
      type: "array", maxItems: 64,
      items: {
        type: "object", additionalProperties: false,
        required: ["raceNumber", "raceResultId", "revision", "scoringSegment", "sourceKind", "trackId", "countsTowardStandings", "placements"],
        properties: {
          raceNumber: { type: "integer", minimum: 1, maximum: 64 },
          raceResultId: raceResultIdSchema,
          revision: revisionSchema,
          scoringSegment: { type: "integer", minimum: 1 },
          sourceKind: { type: "string", minLength: 1, maxLength: 64 },
          scoringNote: { type: "string", minLength: 1, maxLength: 240 },
          trackId: { type: "string", minLength: 1, maxLength: 255 },
          mode: { type: "integer", enum: [50, 100, 150, 200] },
          mirror: { type: "boolean", const: true },
          countsTowardStandings: { type: "boolean" },
          placements: {
            type: "array", maxItems: 12,
            items: {
              type: "object", additionalProperties: false,
              required: ["finishPosition", "playerId", "displayName", "racePoints"],
              properties: {
                finishPosition: { type: "integer", minimum: 1, maximum: 12 },
                playerId: { type: "string", minLength: 1, maxLength: 135 },
                displayName: displayNameSchema,
                racePoints: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
    },
    manualScores: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        required: ["playerId", "segmentPoints"],
        properties: {
          playerId: playerIdSchema,
          segmentPoints: {
            type: "array", maxItems: 6,
            items: { type: ["integer", "null"], minimum: 0 },
          },
        },
      },
    },
    standings: {
      type: "object", additionalProperties: false,
      required: ["source", "rows", "tieGroups"],
      properties: {
        source: { type: "string", enum: ["races", "manual", "none"] },
        rows: { type: "array", maxItems: 12, items: standingRowSchema },
        tieGroups: { type: "array", maxItems: 12, items: {
          type: "object", additionalProperties: false, required: ["points", "resolved", "players"],
          properties: {
            points: { type: "integer", minimum: 0 },
            resolved: { type: "boolean" },
            players: { type: "array", minItems: 2, maxItems: 12, items: {
              type: "object", additionalProperties: false,
              required: ["playerId", "displayName", "wins", "bestRace"],
              properties: {
                playerId: playerIdSchema, displayName: displayNameSchema,
                wins: { type: "integer", minimum: 0 }, bestRace: { type: "integer", minimum: 0 },
              },
            } },
          },
        } },
      },
    },
  },
} as const;

const overallRowSchema = {
  type: "object", additionalProperties: false,
  required: ["placement", "playerId", "displayName", "groupName", "groupRank", "points"],
  properties: {
    placement: { type: "integer", minimum: 1 },
    playerId: playerIdSchema,
    displayName: displayNameSchema,
    groupName: { type: "string", minLength: 1, maxLength: 64 },
    groupRank: { type: "integer", minimum: 1 },
    points: { type: "integer", minimum: 0 },
  },
} as const;

const documentSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "summary", "participants", "stations", "groups", "overall", "lifecycle"],
  properties: {
    schemaVersion: { const: "mk8dx.tournament-operation.v1" },
    summary: summarySchema,
    participants: {
      type: "array", maxItems: 5000,
      items: {
        type: "object", additionalProperties: false,
        required: ["playerId", "username", "displayName", "attendance", "hasSwitch1", "hasSwitch2", "inactive", "isNew"],
        properties: {
          playerId: playerIdSchema,
          username: { type: "string", minLength: 1, maxLength: 135 },
          displayName: displayNameSchema,
          attendance: attendanceSchema,
          hasSwitch1: { type: "boolean" },
          hasSwitch2: { type: "boolean" },
          inactive: { type: "boolean" },
          isNew: { type: "boolean" },
          seedScore: { type: "number" },
          seedRank: { type: "integer", minimum: 1 },
        },
      },
    },
    stations: {
      type: "array", maxItems: 120,
      items: {
        type: "object", additionalProperties: false,
        required: ["ownerPlayerId", "ownerDisplayName", "switchType"],
        properties: {
          ownerPlayerId: playerIdSchema,
          ownerDisplayName: displayNameSchema,
          switchType: switchTypeSchema,
          utpCableNumber: { type: "integer", minimum: 1 },
        },
      },
    },
    groups: { type: "array", maxItems: 10, items: groupSchema },
    overall: { type: "array", maxItems: 60, items: overallRowSchema },
    lifecycle: {
      type: "array", maxItems: 200,
      items: {
        type: "object", additionalProperties: false,
        required: ["sequence", "eventType", "occurredAtMs"],
        properties: {
          sequence: { type: "integer", minimum: 1 },
          eventType: { type: "string", minLength: 1, maxLength: 32 },
          detail: { type: "string", maxLength: 255 },
          occurredAtMs: timestampSchema,
        },
      },
    },
  },
} as const;

const previewSchema = {
  type: "object", additionalProperties: false,
  required: [
    "schemaVersion", "tournamentId", "name", "revision", "presentCount", "qualifierGroups",
    "finalGroups", "raceCount", "rateableRaceCount", "manualOnlyGroups", "incompleteGroups",
    "publicResults", "affectsRating", "alreadyFinalized", "warnings", "overall",
  ],
  properties: {
    schemaVersion: { const: "mk8dx.tournament-finalization-preview.v1" },
    tournamentId: tournamentIdSchema,
    name: nameSchema,
    revision: revisionSchema,
    presentCount: { type: "integer", minimum: 0 },
    qualifierGroups: { type: "integer", minimum: 0 },
    finalGroups: { type: "integer", minimum: 0 },
    raceCount: { type: "integer", minimum: 0 },
    rateableRaceCount: { type: "integer", minimum: 0 },
    manualOnlyGroups: { type: "integer", minimum: 0 },
    incompleteGroups: { type: "integer", minimum: 0 },
    publicResults: { type: "boolean" },
    affectsRating: { type: "boolean" },
    alreadyFinalized: { type: "boolean" },
    warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 240 } },
    overall: { type: "array", maxItems: 60, items: overallRowSchema },
  },
} as const;

const finalizationResultSchema = {
  type: "object", additionalProperties: false,
  required: ["tournamentId", "revision", "publicResults", "affectsRating"],
  properties: {
    tournamentId: tournamentIdSchema,
    revision: revisionSchema,
    publicationId: publicationIdSchema,
    publicResults: { type: "boolean" },
    affectsRating: { type: "boolean" },
    rating: {
      type: "object", additionalProperties: false,
      required: ["appliedRaces", "skippedRaces", "alreadyApplied"],
      properties: {
        appliedRaces: { type: "integer", minimum: 0 },
        skippedRaces: { type: "integer", minimum: 0 },
        alreadyApplied: { type: "boolean" },
      },
    },
  },
} as const;

const publicSummarySchema = {
  type: "object", additionalProperties: false,
  required: ["tournamentId", "name", "stage", "participantCount", "updatedAtMs"],
  properties: {
    tournamentId: tournamentIdSchema,
    name: nameSchema,
    editionNumber: { type: "integer", minimum: 1, maximum: 9999 },
    eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    stage: stageSchema,
    finalizedAtMs: timestampSchema,
    participantCount: { type: "integer", minimum: 0 },
    updatedAtMs: timestampSchema,
    startAtMs: timestampSchema,
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    workflowStep: { type: "integer", minimum: 2, maximum: 10 },
    directorDisplayName: nameSchema,
    viewerParticipated: { type: "boolean" },
    // Only on a finished night that was never published, and only for a
    // viewer who may see such a row at all.
    published: { type: "boolean" },
    affectsRating: { type: "boolean" },
    removed: { type: "boolean" },
  },
} as const;

/** The Director's own report, published. Plain paragraphs for every reader,
 * plus the same blocks as sanitised class-based markup for the web
 * (`tournament-report-markup.ts`); a reader that only knows paragraphs is
 * not affected by the html fields. */
const reportHtmlSchema = { type: "array", maxItems: 40, items: { type: "string", maxLength: 8000 } } as const;
const publicReportSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "intro", "summary", "topTracks", "groups", "players", "visibility", "publishedAtMs", "revision"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    intro: { type: "array", maxItems: 40, items: { type: "string", maxLength: 8000 } },
    summary: { type: "array", maxItems: 40, items: { type: "string", maxLength: 8000 } },
    topTracks: { type: "array", maxItems: 40, items: { type: "string", maxLength: 8000 } },
    introHtml: reportHtmlSchema,
    summaryHtml: reportHtmlSchema,
    topTracksHtml: reportHtmlSchema,
    ratings: {
      type: "object", additionalProperties: false, required: ["asOfMs", "players"],
      properties: {
        asOfMs: { type: "integer", minimum: 0 },
        players: {
          type: "array", maxItems: 200,
          items: {
            type: "object", additionalProperties: false, required: ["name", "rank", "score"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 64 },
              rank: { type: "integer", minimum: 1 },
              score: { type: "number" },
              qualifierDelta: { type: "number" },
              finalDelta: { type: "number" },
            },
          },
        },
      },
    },
    groups: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false, required: ["name", "paragraphs"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          paragraphs: { type: "array", maxItems: 40, items: { type: "string", maxLength: 4000 } },
          html: { type: "array", maxItems: 40, items: { type: "string", maxLength: 4000 } },
        },
      },
    },
    players: {
      type: "array", maxItems: 60,
      items: {
        type: "object", additionalProperties: false, required: ["name", "paragraphs"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          paragraphs: { type: "array", maxItems: 40, items: { type: "string", maxLength: 2000 } },
          html: { type: "array", maxItems: 40, items: { type: "string", maxLength: 2000 } },
        },
      },
    },
    visibility: {
      type: "object", additionalProperties: false,
      required: ["topTracks", "benchmark", "duel", "distribution"],
      properties: {
        topTracks: { type: "boolean" }, benchmark: { type: "boolean" },
        duel: { type: "boolean" }, distribution: { type: "boolean" },
        // Absent in a report published before these switches existed.
        intro: { type: "boolean" }, summary: { type: "boolean" }, groupNotes: { type: "boolean" },
      },
    },
    publishedAtMs: timestampSchema,
    revision: { type: "integer", minimum: 1 },
  },
} as const;

const publicEventSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "tournamentId", "name", "stage", "publicResults", "participantCount", "groups", "overall"],
  properties: {
    schemaVersion: { const: "mk8dx.public-tournament-event.v1" },
    tournamentId: tournamentIdSchema,
    name: nameSchema,
    editionNumber: { type: "integer", minimum: 1, maximum: 9999 },
    eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    stage: stageSchema,
    startAtMs: timestampSchema,
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    finalizedAtMs: timestampSchema,
    publicationId: publicationIdSchema,
    report: publicReportSchema,
    publicResults: { type: "boolean" },
    participantCount: { type: "integer", minimum: 0 },
    workflowStep: { type: "integer", minimum: 2, maximum: 10 },
    groups: {
      type: "array", maxItems: 10,
      items: {
        type: "object", additionalProperties: false,
        required: ["groupId", "stage", "sequence", "name", "standings", "races"],
        properties: {
          groupId: groupIdSchema,
          stage: groupStageSchema,
          sequence: { type: "integer", minimum: 1, maximum: 5 },
          name: { type: "string", minLength: 1, maxLength: 64 },
          tierKey: { type: "string", minLength: 1, maxLength: 16 },
          tieBreakMode: { type: "string", enum: ["sp", "lottery", "manual"] },
          seating: {
            type: "array", maxItems: 12,
            items: {
              type: "object", additionalProperties: false,
              required: [
                "displayName", "seatOrder", "stationOwnerDisplayName",
                "switchType", "seatNumber",
              ],
              properties: {
                playerId: playerIdSchema,
                displayName: displayNameSchema,
                seatOrder: { type: "integer", minimum: 0, maximum: 12 },
                stationOwnerPlayerId: playerIdSchema,
                stationOwnerDisplayName: displayNameSchema,
                switchType: { type: "string", enum: ["ns1", "ns2"] },
                seatNumber: { type: "integer", minimum: 1, maximum: 2 },
                seedRank: { type: "integer", minimum: 1 },
                seedScore: { type: "number" },
                character: characterSchema,
              },
            },
          },
          standings: {
            type: "array", maxItems: 12,
            items: {
              type: "object", additionalProperties: false,
              required: ["rank", "displayName", "points", "races", "wins", "complete"],
              properties: {
                rank: { type: "integer", minimum: 1 },
                playerId: playerIdSchema,
                displayName: displayNameSchema,
                points: { type: "integer", minimum: 0 },
                races: { type: "integer", minimum: 0 },
                wins: { type: "integer", minimum: 0 },
                complete: { type: "boolean" },
                seedRank: { type: "integer", minimum: 1 },
                seedScore: { type: "number" },
                character: characterSchema,
              },
            },
          },
          races: {
            type: "array", maxItems: 64,
            items: {
              type: "object", additionalProperties: false,
              required: ["raceNumber", "countsTowardStandings", "placements"],
              properties: {
                raceNumber: { type: "integer", minimum: 1, maximum: 64 },
                trackId: { type: "string", minLength: 1, maxLength: 255 },
                mode: { type: "integer", enum: [50, 100, 150, 200] },
                mirror: { type: "boolean", const: true },
                countsTowardStandings: { type: "boolean" },
                placements: {
                  type: "array", maxItems: 12,
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["finishPosition", "displayName", "racePoints"],
                    properties: {
                      finishPosition: { type: "integer", minimum: 1, maximum: 12 },
                      playerId: playerIdSchema,
                      displayName: displayNameSchema,
                      racePoints: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    overall: {
      type: "array", maxItems: 60,
      items: {
        type: "object", additionalProperties: false,
        required: ["placement", "displayName", "groupName", "groupRank", "points"],
        properties: {
          placement: { type: "integer", minimum: 1 },
          playerId: playerIdSchema,
          displayName: displayNameSchema,
          groupName: { type: "string", minLength: 1, maxLength: 64 },
          groupRank: { type: "integer", minimum: 1 },
          points: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

const responses = (success: object) => ({
  200: success,
  400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema,
  409: errorResponseSchema, 503: errorResponseSchema,
});

function failure(error: unknown): Readonly<{ status: 400 | 403 | 404 | 409 | 503; body: ErrorResponse }> {
  if (error instanceof TournamentOperationError) {
    switch (error.code) {
      case "invalid_input":
        return { status: 400, body: { code: "invalid_tournament_operation", message: error.message } };
      case "forbidden":
        return { status: 403, body: { code: "tournament_operation_forbidden", message: "The Tournament operation is not authorized." } };
      case "not_found":
        return { status: 404, body: { code: "tournament_not_found", message: error.message } };
      case "conflict":
        return { status: 409, body: { code: "tournament_operation_conflict", message: error.message } };
      default:
        break;
    }
  }
  return { status: 503, body: { code: "tournament_operation_unavailable", message: "Tournament operation is temporarily unavailable." } };
}

export type TournamentOperationRouteDependencies = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<
    TournamentOperationService,
    | "listForAdministrator" | "listSelectableDirectors" | "loadForAdministrator" | "create" | "update" | "setWorkflowStep"
    | "setParticipant" | "addHistoricalParticipants" | "addRecentParticipants" | "removeParticipant" | "generateGroups" | "updateGroups" | "importGroupLayout"
    | "lockGroups" | "attachRaces" | "enterRace" | "enterRaces" | "importParticipants" | "setManualScores" | "setTieBreakOrder"
    | "finalizationPreview" | "finalize" | "setResultsVisibility" | "recordIncident" | "deleteDraft"
  > & Partial<Pick<TournamentOperationService,
    "advanceWorkflow" | "rollbackWorkflow" | "rosterPlayerCandidates" | "rememberRosterAliases">>;
  csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  /** ADR-0177 decisions 8-10 with ADR-0218: reviewed display names may create
   * canonical Players in one all-or-nothing batch; usernames get a suffix and
   * a name already in the Director's own nights needs `confirmSameName`. */
  createRosterPlayers?: (
    actor: ActorContext,
    requests: readonly Readonly<{ row: number; displayName: string; confirmSameName?: boolean }>[],
    options?: Readonly<{ tournamentId?: string }>,
  ) => Promise<readonly Readonly<{
    playerId: string; username: string; displayName: string;
  }>[]>;
}>;

export async function registerTournamentOperationRoutes(
  app: FastifyInstance,
  dependencies: TournamentOperationRouteDependencies,
): Promise<void> {
  const proven = async (
    request: Parameters<ActorResolver>[0],
    token: string,
  ): Promise<ActorContext> => {
    const actor = await dependencies.resolveActor(request);
    if (!dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden");
    }
    return actor;
  };
  const handle = async <T>(
    reply: FastifyReply,
    work: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const mapped = failure(error);
      return reply.code(mapped.status).send(mapped.body) as unknown as T;
    }
  };

  app.get<{ Querystring: { director?: string }; Reply: { schemaVersion: string; tournaments: readonly TournamentSummary[] } | ErrorResponse }>(
    "/v1/administrator/tournaments",
    { schema: { querystring: {
      type: "object", additionalProperties: false,
      properties: { director: directorUserAccountIdSchema },
    }, response: { ...responses({
      type: "object", additionalProperties: false, required: ["schemaVersion", "tournaments"],
      properties: {
        schemaVersion: { const: "mk8dx.administrator-tournaments.v1" },
        tournaments: { type: "array", maxItems: 200, items: summarySchema },
      },
    }) } } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.administrator-tournaments.v1",
      tournaments: await dependencies.service.listForAdministrator(
        await dependencies.resolveActor(request),
        request.query.director === undefined
          ? undefined
          : { directorUserAccountId: request.query.director },
      ),
    })),
  );

  // ADR-0177 decision 3: Step 0 offers only the accounts that may direct a
  // Tournament. The service returns every director to an administrator and
  // only the acting account to anyone else.
  app.get<{ Reply: {
    schemaVersion: string;
    canActForOthers: boolean;
    directors: readonly { userAccountId: string; displayName: string; isAdministrator: boolean }[];
  } | ErrorResponse }>(
    "/v1/administrator/tournament-directors",
    { schema: { response: { ...responses({
      type: "object", additionalProperties: false,
      required: ["schemaVersion", "canActForOthers", "directors"],
      properties: {
        schemaVersion: { const: "mk8dx.administrator-tournament-directors.v1" },
        canActForOthers: { type: "boolean" },
        directors: { type: "array", maxItems: 200, items: {
          type: "object", additionalProperties: false,
          required: ["userAccountId", "displayName", "isAdministrator"],
          properties: {
            userAccountId: directorUserAccountIdSchema,
            displayName: { type: "string", minLength: 1, maxLength: 141 },
            isAdministrator: { type: "boolean" },
          },
        } },
      },
    }) } } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.administrator-tournament-directors.v1",
      ...await dependencies.service.listSelectableDirectors(await dependencies.resolveActor(request)),
    })),
  );

  app.get<{ Params: TournamentParams; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/administrator/tournaments/:tournamentId",
    { schema: { params: paramsSchema, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.loadForAdministrator(
      await dependencies.resolveActor(request), request.params.tournamentId,
    )),
  );

  app.get<{ Params: TournamentParams; Reply: FinalizationPreview | ErrorResponse }>(
    "/v1/administrator/tournaments/:tournamentId/finalization-preview",
    { schema: { params: paramsSchema, response: responses(previewSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.finalizationPreview(
      await dependencies.resolveActor(request), request.params.tournamentId,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: { workbookBase64: string }; Reply: {
    schemaVersion: "mk8dx.score-workbook-preview.v1";
    videos: readonly ScoreWorkbookVideo[];
  } | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/score-workbook-preview",
    { bodyLimit: 12_000_000, schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["workbookBase64"],
      properties: { workbookBase64: { type: "string", minLength: 1, maxLength: 14_000_000 } },
    }, response: responses({
      type: "object", additionalProperties: false, required: ["schemaVersion", "videos"],
      properties: {
        schemaVersion: { const: "mk8dx.score-workbook-preview.v1" },
        videos: { type: "array", minItems: 1, maxItems: 100, items: {
          type: "object", additionalProperties: false, required: ["videoName", "rows", "races"],
          properties: {
            videoName: { type: "string", minLength: 1, maxLength: 255 },
            rows: { type: "array", minItems: 1, maxItems: 60, items: {
              type: "object", additionalProperties: false, required: ["playerName", "totalPoints", "pointSegments"],
              properties: {
                playerName: displayNameSchema, totalPoints: { type: "integer", minimum: 0, maximum: 10000 },
                position: { type: "integer", minimum: 0, maximum: 60 },
                pointSegments: { type: "array", maxItems: 4, items: { type: "integer", minimum: 0, maximum: 10000 } },
                character: { type: "string", minLength: 1, maxLength: 64 },
                characterRoster: { type: "string", minLength: 1, maxLength: 64 },
              },
            } },
            races: { type: "array", maxItems: 64, items: {
              type: "object", additionalProperties: false,
              required: ["raceNumber", "trackName", "finishOrder"],
              properties: {
                raceNumber: { type: "integer", minimum: 1, maximum: 64 },
                trackName: { type: "string", maxLength: 128 },
                mode: { type: "integer", enum: [50, 100, 150, 200] },
                mirror: { type: "boolean", const: true },
                finishOrder: { type: "array", minItems: 2, maxItems: 12, items: displayNameSchema },
              },
            } },
            carriedPoints: { type: "array", minItems: 1, maxItems: 12, items: {
              type: "object", additionalProperties: false, required: ["playerName", "points"],
              properties: { playerName: displayNameSchema, points: { type: "integer", minimum: 1, maximum: 10000 } },
            } },
          },
        } },
      },
    }) } },
    async (request, reply) => handle(reply, async () => {
      const actor = await proven(request, request.headers["x-mk8dx-csrf"]);
      await dependencies.service.loadForAdministrator(actor, request.params.tournamentId);
      try {
        return { schemaVersion: "mk8dx.score-workbook-preview.v1" as const, videos: await parseScoreWorkbookBase64(request.body.workbookBase64) };
      } catch (error) {
        throw new TournamentOperationError("invalid_input", error instanceof Error ? error.message : "Excel-bestand kon niet worden gelezen.");
      }
    }),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; step: 5 | 6 | 9 | 10;
    trackLabels: { trackId: string; displayName: string; cupName?: string }[];
  }; Reply: {
    schemaVersion: "mk8dx.score-workbook-export.v1";
    fileName: string;
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    workbookBase64: string;
  } | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/score-workbook-export",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "step", "trackLabels"],
      properties: {
        expectedRevision: revisionSchema,
        step: { type: "integer", enum: [5, 6, 9, 10] },
        trackLabels: { type: "array", maxItems: 96, items: {
          type: "object", additionalProperties: false, required: ["trackId", "displayName"],
          properties: {
            trackId: { type: "string", minLength: 7, maxLength: 128, pattern: "^track\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
            displayName: displayNameSchema,
            cupName: { type: "string", minLength: 1, maxLength: 64 },
          },
        } },
      },
    }, response: responses({
      type: "object", additionalProperties: false,
      required: ["schemaVersion", "fileName", "mediaType", "workbookBase64"],
      properties: {
        schemaVersion: { const: "mk8dx.score-workbook-export.v1" },
        fileName: { type: "string", minLength: 1, maxLength: 160 },
        mediaType: { const: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        workbookBase64: { type: "string", minLength: 1, maxLength: 14_000_000, pattern: "^[A-Za-z0-9+/=]+$" },
      },
    }) } },
    async (request, reply) => handle(reply, async () => {
      const actor = await proven(request, request.headers["x-mk8dx-csrf"]);
      const document = await dependencies.service.loadForAdministrator(actor, request.params.tournamentId);
      if (document.summary.revision !== request.body.expectedRevision) {
        throw new TournamentOperationError("conflict", "the tournament changed; reload and retry");
      }
      return {
        schemaVersion: "mk8dx.score-workbook-export.v1" as const,
        ...await buildScoreWorkbook(document, request.body.step, request.body.trackLabels),
      };
    }),
  );

  app.post<{ Headers: CsrfHeaders; Body: {
    name: string; seriesLabel?: string | null; editionNumber?: number | null; eventDate?: string | null;
    startAtMs: number; timezone: string;
    placementStrategy?: "balanced" | "minimal_move";
    seedingSource?: "community_rating" | "director_nights" | "manual" | "random"; verifiedOnly?: boolean;
    qualifierTieBreakMode?: "sp" | "lottery" | "manual";
    finalTieBreakMode?: "sp" | "lottery" | "manual";
    qualifierRounds?: boolean; maxParticipants?: number | null;
    directorUserAccountId?: string;
  }; Reply: TournamentSummary | ErrorResponse }>(
    "/v1/tournaments",
    { schema: { headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["name"],
      properties: {
        name: nameSchema,
        seriesLabel: { type: ["string", "null"], minLength: 1, maxLength: 64 },
        editionNumber: { type: ["integer", "null"], minimum: 1, maximum: 9999 },
        eventDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        startAtMs: timestampSchema,
        timezone: { type: "string", minLength: 1, maxLength: 64 },
        seedingSource: seedingSourceSchema,
        verifiedOnly: { type: "boolean" },
        placementStrategy: { type: "string", enum: ["balanced", "minimal_move"] },
        qualifierTieBreakMode: tieBreakModeSchema,
        finalTieBreakMode: tieBreakModeSchema,
        qualifierRounds: { type: "boolean" },
        maxParticipants: { type: ["integer", "null"], minimum: 1, maximum: 60 },
        directorUserAccountId: directorUserAccountIdSchema,
      },
    }, response: responses(summarySchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.create(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; name?: string; seriesLabel?: string | null;
    editionNumber?: number | null; eventDate?: string | null; startAtMs?: number; timezone?: string;
    placementStrategy?: "balanced" | "minimal_move";
    seedingSource?: "community_rating" | "director_nights" | "manual" | "random"; verifiedOnly?: boolean;
    qualifierTieBreakMode?: "sp" | "lottery" | "manual";
    finalTieBreakMode?: "sp" | "lottery" | "manual";
    ownerSeatingMode?: "owner_strict" | "owner_soft";
    qualifierRounds?: boolean; maxParticipants?: number | null;
    publicResults?: boolean; affectsRating?: boolean;
  }; Reply: TournamentSummary | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/update",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: {
        expectedRevision: revisionSchema,
        name: nameSchema,
        seriesLabel: { type: ["string", "null"], minLength: 1, maxLength: 64 },
        editionNumber: { type: ["integer", "null"], minimum: 1, maximum: 9999 },
        eventDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        startAtMs: timestampSchema,
        timezone: { type: "string", minLength: 1, maxLength: 64 },
        seedingSource: seedingSourceSchema,
        verifiedOnly: { type: "boolean" },
        placementStrategy: { type: "string", enum: ["balanced", "minimal_move"] },
        ownerSeatingMode: { type: "string", enum: ["owner_strict", "owner_soft"] },
        qualifierTieBreakMode: tieBreakModeSchema,
        finalTieBreakMode: tieBreakModeSchema,
        qualifierRounds: { type: "boolean" },
        maxParticipants: { type: ["integer", "null"], minimum: 1, maximum: 60 },
        publicResults: { type: "boolean" },
        affectsRating: { type: "boolean" },
      },
    }, response: responses(summarySchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.update(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; groupId: string; raceNumber?: number; trackId: string;
    mode?: TournamentRaceMode; mirror?: true; finishOrder: string[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/enter-race",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "trackId", "finishOrder"],
      properties: {
        expectedRevision: revisionSchema,
        groupId: groupIdSchema,
        raceNumber: { type: "integer", minimum: 1, maximum: 64 },
        trackId: { type: "string", minLength: 7, maxLength: 128, pattern: "^track\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
        mode: { type: "integer", enum: [50, 100, 150, 200] },
        mirror: { type: "boolean", const: true },
        finishOrder: { type: "array", minItems: 2, maxItems: 12, uniqueItems: true, items: playerIdSchema },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.enterRace(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  // The races of one group in one request, as a score workbook hands them over.
  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; groupId: string;
    races: { raceNumber?: number; trackId: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: string[] }[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/enter-races",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "races"],
      properties: {
        expectedRevision: revisionSchema,
        groupId: groupIdSchema,
        races: {
          type: "array", minItems: 1, maxItems: 64,
          items: {
            type: "object", additionalProperties: false, required: ["trackId", "finishOrder"],
            properties: {
              raceNumber: { type: "integer", minimum: 1, maximum: 64 },
              trackId: { type: "string", minLength: 7, maxLength: 128, pattern: "^track\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
              mode: { type: "integer", enum: [50, 100, 150, 200] },
              mirror: { type: "boolean", const: true },
              finishOrder: { type: "array", minItems: 2, maxItems: 12, uniqueItems: true, items: playerIdSchema },
            },
          },
        },
        characters: {
          type: "array", maxItems: 12,
          items: {
            type: "object", additionalProperties: false, required: ["playerId", "characterLabel"],
            properties: {
              playerId: playerIdSchema,
              characterKey: { type: "string", minLength: 1, maxLength: 96 },
              characterLabel: { type: "string", minLength: 1, maxLength: 64 },
              characterRoster: { type: "string", minLength: 1, maxLength: 64 },
            },
          },
        },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.enterRaces(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  // ADR-0218: a typed name never links by itself. This lists the Players it
  // may mean, with context, for the Director's explicit choice.
  app.post<{ Headers: CsrfHeaders; Body: { names: string[]; tournamentId?: string; partial?: boolean } }>(
    "/v1/administrator/roster-player-candidates",
    { schema: { headers: csrfHeadersSchema, body: rosterCandidateRequestSchema, response: { ...responses(rosterCandidateResponseSchema) } } },
    async (request, reply) => handle(reply, async () => {
      if (dependencies.service.rosterPlayerCandidates === undefined) { throw new TournamentOperationError("unavailable"); }
      return {
        schemaVersion: "mk8dx.roster-player-candidates.v1" as const,
        entries: await dependencies.service.rosterPlayerCandidates(
          await proven(request, request.headers["x-mk8dx-csrf"]),
          {
            names: request.body.names,
            ...(request.body.tournamentId === undefined ? {} : { tournamentId: request.body.tournamentId }),
            ...(request.body.partial === undefined ? {} : { partial: request.body.partial }),
          },
        ),
      };
    }),
  );

  // ADR-0218: a name the Director chose a Player for becomes that Director's
  // own alias of the Player.
  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: { aliases: { playerId: string; name: string }[] } }>(
    "/v1/tournaments/:tournamentId/roster-aliases",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: rosterAliasRequestSchema, response: { ...responses(rosterAliasResponseSchema) } } },
    async (request, reply) => handle(reply, async () => {
      if (dependencies.service.rememberRosterAliases === undefined) { throw new TournamentOperationError("unavailable"); }
      return {
        schemaVersion: "mk8dx.roster-aliases.v1" as const,
        ...await dependencies.service.rememberRosterAliases(
          await proven(request, request.headers["x-mk8dx-csrf"]),
          request.params.tournamentId,
          request.body,
        ),
      };
    }),
  );

  app.post<{ Headers: CsrfHeaders; Body: RosterPlayersRequest }>(
    "/v1/administrator/roster-players",
    { schema: { headers: csrfHeadersSchema, body: rosterPlayersRequestSchema } },
    async (request, reply) => {
      try {
        if (dependencies.createRosterPlayers === undefined) {
          throw new TournamentOperationError("forbidden");
        }
        const acting = await proven(request, request.headers["x-mk8dx-csrf"]);
        const created = await dependencies.createRosterPlayers(
          acting, request.body.players,
          request.body.tournamentId === undefined ? {} : { tournamentId: request.body.tournamentId },
        );
        return await reply.code(201).send({
          schemaVersion: "mk8dx.native-roster-players.v1",
          created,
        });
      } catch (error) {
        // ADR-0221: the installation lets only self sign-up create Players.
        if (error instanceof PlayerOnboardingError && error.code === "player_creation_disabled") {
          return reply.code(403).send({ code: "player_creation_directors_disabled", message: error.message });
        }
        const rejections = (error as { rejections?: unknown }).rejections;
        if (Array.isArray(rejections)) {
          return reply.code(409).send({
            schemaVersion: "mk8dx.native-roster-players-rejected.v1",
            code: "roster_rejected",
            rejections,
          });
        }
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  for (const [action, operationName] of [
    ["advance-current-step", "advanceWorkflow"],
    ["rollback-current-step", "rollbackWorkflow"],
  ] as const) {
    app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: { expectedRevision: number }; Reply: TournamentDocument | ErrorResponse }>(
      `/v1/tournaments/:tournamentId/actions/${action}`,
      { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
        type: "object", additionalProperties: false, required: ["expectedRevision"],
        properties: { expectedRevision: revisionSchema },
      }, response: responses(documentSchema) } },
      async (request, reply) => handle(reply, async () => dependencies.service[operationName]!(
        await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
      )),
    );
  }

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; targetStep: number;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/set-workflow-step",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "targetStep"],
      properties: {
        expectedRevision: revisionSchema,
        targetStep: { type: "integer", minimum: 2, maximum: 10 },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.setWorkflowStep(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; groupId: string; points: number; playerIds: string[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/tie-breaks",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "points", "playerIds"],
      properties: {
        expectedRevision: revisionSchema,
        groupId: groupIdSchema,
        points: { type: "integer", minimum: 0, maximum: 60000 },
        playerIds: { type: "array", minItems: 2, maxItems: 12, uniqueItems: true, items: playerIdSchema },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.setTieBreakOrder(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; playerId: string; attendance?: "present" | "waiting" | "absent";
    hasSwitch1?: boolean; hasSwitch2?: boolean;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/participants",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "playerId"],
      properties: {
        expectedRevision: revisionSchema,
        playerId: playerIdSchema,
        attendance: attendanceSchema,
        hasSwitch1: { type: "boolean" },
        hasSwitch2: { type: "boolean" },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.setParticipant(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  // A roster file in one request (ADR-0177 decision 8 as one transaction):
  // the same rules as one participant at a time, one revision, one document.
  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number;
    rows: { playerId: string; attendance?: "present" | "waiting" | "absent"; hasSwitch1?: boolean; hasSwitch2?: boolean }[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/participants/actions/import",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "rows"],
      properties: {
        expectedRevision: revisionSchema,
        rows: {
          type: "array", minItems: 1, maxItems: 200,
          items: {
            type: "object", additionalProperties: false, required: ["playerId"],
            properties: {
              playerId: playerIdSchema,
              attendance: attendanceSchema,
              hasSwitch1: { type: "boolean" },
              hasSwitch2: { type: "boolean" },
            },
          },
        },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.importParticipants(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/participants/actions/add-historical",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { expectedRevision: revisionSchema },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.addHistoricalParticipants(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/participants/actions/add-recent",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { expectedRevision: revisionSchema },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.addRecentParticipants(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; playerId: string;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/participants/actions/remove",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "playerId"],
      properties: { expectedRevision: revisionSchema, playerId: playerIdSchema },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.removeParticipant(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; stage: "qualifier" | "final";
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/generate-groups",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "stage"],
      properties: { expectedRevision: revisionSchema, stage: groupStageSchema },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.generateGroups(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; stage: "qualifier" | "final";
    groups: { groupId: string; members: string[] }[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/update-groups",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "stage", "groups"],
      properties: {
        expectedRevision: revisionSchema,
        stage: groupStageSchema,
        groups: { type: "array", minItems: 1, maxItems: 5, items: {
          type: "object", additionalProperties: false, required: ["groupId", "members"],
          properties: {
            groupId: groupIdSchema,
            members: { type: "array", maxItems: 12, items: playerIdSchema },
          },
        } },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.updateGroups(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; stage: "qualifier" | "final";
    equipmentCorrectionReason?: string;
    groups: { name: string; seats: {
      playerId: string; stationOwnerPlayerId: string | null;
      switchType: "ns1" | "ns2" | null; seatNumber: 1 | 2 | null;
    }[] }[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/import-group-layout",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "stage", "groups"],
      properties: {
        expectedRevision: revisionSchema,
        stage: groupStageSchema,
        equipmentCorrectionReason: { type: "string", minLength: 3, maxLength: 160 },
        groups: { type: "array", minItems: 1, maxItems: 8, items: {
          type: "object", additionalProperties: false, required: ["name", "seats"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 64 },
            seats: { type: "array", maxItems: 12, items: {
              type: "object", additionalProperties: false, required: ["playerId"],
              properties: {
                playerId: playerIdSchema,
                stationOwnerPlayerId: { ...playerIdSchema, type: ["string", "null"] },
                switchType: { type: ["string", "null"], enum: ["ns1", "ns2", null] },
                seatNumber: { type: ["integer", "null"], enum: [1, 2, null] },
              },
            } },
            stations: { type: "array", maxItems: 6, items: {
              type: "object", additionalProperties: false, required: ["stationOwnerPlayerId", "switchType"],
              properties: { stationOwnerPlayerId: playerIdSchema, switchType: switchTypeSchema },
            } },
          },
        } },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.importGroupLayout(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; stage: "qualifier" | "final"; locked: boolean;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/lock-groups",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "stage", "locked"],
      properties: { expectedRevision: revisionSchema, stage: groupStageSchema, locked: { type: "boolean" } },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.lockGroups(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; groupId: string; raceResultIds: string[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/attach-races",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "groupId", "raceResultIds"],
      properties: {
        expectedRevision: revisionSchema,
        groupId: groupIdSchema,
        raceResultIds: { type: "array", minItems: 1, maxItems: 64, items: raceResultIdSchema },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.attachRaces(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; groupId: string; segments: number;
    scores: { playerId: string; segmentPoints: (number | null)[] }[];
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/manual-scores",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "groupId", "segments", "scores"],
      properties: {
        expectedRevision: revisionSchema,
        groupId: groupIdSchema,
        segments: { type: "integer", minimum: 1, maximum: 6 },
        scores: { type: "array", maxItems: 12, items: {
          type: "object", additionalProperties: false, required: ["playerId", "segmentPoints"],
          properties: {
            playerId: playerIdSchema,
            segmentPoints: { type: "array", maxItems: 6, items: { type: ["integer", "null"], minimum: 0, maximum: 10000 } },
          },
        } },
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.setManualScores(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; publicResults: boolean; affectsRating: boolean; reasonCode: string;
  }; Reply: FinalizationResult | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/finalize",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "publicResults", "affectsRating", "reasonCode"],
      properties: {
        expectedRevision: revisionSchema,
        publicResults: { type: "boolean" },
        affectsRating: { type: "boolean" },
        reasonCode: reasonCodeSchema,
      },
    }, response: responses(finalizationResultSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.finalize(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: { expectedRevision: number };
    Reply: { deleted: true } | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/delete",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { expectedRevision: revisionSchema },
    }, response: responses({
      type: "object", additionalProperties: false, required: ["deleted"],
      properties: { deleted: { type: "boolean", const: true } },
    }) } },
    async (request, reply) => handle(reply, async () => {
      await dependencies.service.deleteDraft(
        await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
      );
      return { deleted: true as const };
    }),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number; publicResults: boolean; reasonCode: string;
  }; Reply: TournamentSummary | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/actions/set-results-visibility",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "publicResults", "reasonCode"],
      properties: {
        expectedRevision: revisionSchema,
        publicResults: { type: "boolean" },
        reasonCode: reasonCodeSchema,
      },
    }, response: responses(summarySchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.setResultsVisibility(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: TournamentParams; Headers: CsrfHeaders; Body: {
    expectedRevision: number;
    category: "attendance" | "replacement" | "equipment" | "scoring" | "conduct" | "other";
    note: string;
    playerId?: string;
  }; Reply: TournamentDocument | ErrorResponse }>(
    "/v1/tournaments/:tournamentId/incidents",
    { schema: { params: paramsSchema, headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "category", "note"],
      properties: {
        expectedRevision: revisionSchema,
        category: { type: "string", enum: ["attendance", "replacement", "equipment", "scoring", "conduct", "other"] },
        note: { type: "string", minLength: 1, maxLength: 160, pattern: "^[^|]+$" },
        playerId: playerIdSchema,
      },
    }, response: responses(documentSchema) } },
    async (request, reply) => handle(reply, async () => dependencies.service.recordIncident(
      await proven(request, request.headers["x-mk8dx-csrf"]), request.params.tournamentId, request.body,
    )),
  );
}

export async function registerPublicTournamentEventRoutes(
  app: FastifyInstance,
  dependencies: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<TournamentOperationService, "listPublic" | "loadPublic" | "loadPublicPlacements">;
    /**
     * What the community has raced over every finished night. Optional: a
     * deployment without the corrected history simply does not answer it.
     */
    statistics?: Pick<TournamentStatisticsService, "load" | "loadTrack">;
  }>,
): Promise<void> {
  const statistics = dependencies.statistics;
  if (statistics !== undefined) {
    app.get(
      "/v1/public/tournament-statistics",
      { schema: { response: {
        200: {
          type: "object", additionalProperties: false,
          required: ["schemaVersion", "editions", "tracks", "totals"],
          properties: {
            schemaVersion: { const: "mk8dx.public-tournament-statistics.v1" },
            editions: { type: "array", maxItems: 200, items: {
              type: "object", additionalProperties: false,
              required: ["editionNumber", "participantCount", "races", "cumulativePlayers"],
              properties: {
                editionNumber: { type: "integer", minimum: 1 },
                eventDate: { type: ["string", "null"], maxLength: 10 },
                heldAtMs: { type: ["integer", "null"], minimum: 0 },
                participantCount: { type: "integer", minimum: 0 },
                races: { type: "integer", minimum: 0 },
                cumulativePlayers: { type: "integer", minimum: 0 },
              },
            } },
            tracks: { type: "array", maxItems: 300, items: {
              type: "object", additionalProperties: false,
              required: ["trackId", "races", "placements", "nights", "firstEdition",
                "lastEdition", "bestPlayerId", "bestPlayerName", "bestScore"],
              properties: {
                trackId: { type: "string", maxLength: 160 },
                races: { type: "integer", minimum: 0 },
                placements: { type: "integer", minimum: 0 },
                nights: { type: "integer", minimum: 0 },
                firstEdition: { type: "integer", minimum: 0 },
                lastEdition: { type: "integer", minimum: 0 },
                bestPlayerId: { type: ["string", "null"], maxLength: 160 },
                bestPlayerName: { type: ["string", "null"], maxLength: 128 },
                bestPlayerUsername: { type: "string", minLength: 1, maxLength: 135 },
                bestScore: { type: ["number", "null"] },
              },
            } },
            totals: {
              type: "object", additionalProperties: false,
              required: ["editions", "races", "racesWithTrack", "placements", "players", "tracksRaced"],
              properties: {
                editions: { type: "integer", minimum: 0 },
                races: { type: "integer", minimum: 0 },
                racesWithTrack: { type: "integer", minimum: 0 },
                placements: { type: "integer", minimum: 0 },
                players: { type: "integer", minimum: 0 },
                tracksRaced: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        503: errorResponseSchema,
      } } },
      async (_request, reply) => {
        try {
          const answer = await statistics.load();
          return {
            schemaVersion: "mk8dx.public-tournament-statistics.v1",
            editions: answer.editions,
            tracks: answer.tracks,
            totals: answer.totals,
          };
        } catch {
          return reply.code(503).send({
            code: "public_tournament_statistics_unavailable",
            message: "Tournament statistics are temporarily unavailable.",
          });
        }
      },
    );

    // One track's own rating: the site's TrueSkill run over that track's
    // races alone, everybody from a Score of zero.
    app.get<{ Params: { trackId: string } }>(
      "/v1/public/tournament-statistics/tracks/:trackId",
      { schema: {
        params: {
          type: "object", additionalProperties: false, required: ["trackId"],
          properties: { trackId: {
            type: "string", minLength: 7, maxLength: 160,
            pattern: "^track\.[a-z0-9][a-z0-9_]{1,150}$",
          } },
        },
        response: {
          200: {
            type: "object", additionalProperties: false,
            required: ["schemaVersion", "trackId", "races", "racesSkipped", "players"],
            properties: {
              schemaVersion: { const: "mk8dx.public-track-skill.v1" },
              trackId: { type: "string", maxLength: 160 },
              races: { type: "integer", minimum: 0 },
              racesSkipped: { type: "integer", minimum: 0 },
              players: { type: "array", maxItems: 300, items: {
                type: "object", additionalProperties: false,
                required: ["rank", "playerId", "displayName", "score", "mu", "sigma",
                  "races", "wins", "top3", "bestFinish", "averageFinish"],
                properties: {
                  rank: { type: "integer", minimum: 1 },
                  playerId: { type: "string", maxLength: 160 },
                  displayName: { type: "string", maxLength: 128 },
                  username: { type: "string", minLength: 1, maxLength: 135 },
                  score: { type: "number" },
                  mu: { type: "number" },
                  sigma: { type: "number" },
                  races: { type: "integer", minimum: 0 },
                  wins: { type: "integer", minimum: 0 },
                  top3: { type: "integer", minimum: 0 },
                  bestFinish: { type: "integer", minimum: 0 },
                  averageFinish: { type: "number" },
                },
              } },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      } },
      async (request, reply) => {
        try {
          const answer = await statistics.loadTrack(request.params.trackId);
          return { schemaVersion: "mk8dx.public-track-skill.v1", ...answer };
        } catch {
          return reply.code(503).send({
            code: "public_track_skill_unavailable",
            message: "This track's rating is temporarily unavailable.",
          });
        }
      },
    );
  }
  app.get<{ Reply: { schemaVersion: string; tournaments: readonly PublicTournamentEventSummary[] } | ErrorResponse }>(
    "/v1/public/tournament-events",
    { schema: { response: {
      200: {
        type: "object", additionalProperties: false, required: ["schemaVersion", "tournaments"],
        properties: {
          schemaVersion: { const: "mk8dx.public-tournament-events.v1" },
          tournaments: { type: "array", maxItems: 200, items: publicSummarySchema },
        },
      },
      503: errorResponseSchema,
    } } },
    async (request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-tournament-events.v1",
          tournaments: await dependencies.service.listPublic(await dependencies.resolveActor(request)),
        };
      } catch {
        return reply.code(503).send({ code: "public_tournaments_unavailable", message: "Tournaments are temporarily unavailable." });
      }
    },
  );

  app.get<{
    Querystring: TournamentPlacementsQuery;
    Reply: { schemaVersion: string; tournaments: readonly PublicTournamentPlacementSnapshot[] } | ErrorResponse;
  }>(
    "/v1/public/tournament-placements",
    { schema: {
      querystring: {
        type: "object", additionalProperties: false, required: ["ids"],
        properties: { ids: { type: "string", minLength: 17, maxLength: 1287 } },
      },
      response: {
        200: {
          type: "object", additionalProperties: false, required: ["schemaVersion", "tournaments"],
          properties: {
            schemaVersion: { const: "mk8dx.public-tournament-placements.v1" },
            tournaments: {
              type: "array", maxItems: 8,
              items: {
                type: "object", additionalProperties: false,
                required: ["tournamentId", "fieldSize", "placements"],
                properties: {
                  tournamentId: tournamentIdSchema,
                  fieldSize: { type: "integer", minimum: 0 },
                  placements: {
                    type: "array", maxItems: 200,
                    items: {
                      type: "object", additionalProperties: false,
                      required: ["playerId", "placement"],
                      properties: {
                        playerId: playerIdSchema,
                        placement: { type: "integer", minimum: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: errorResponseSchema,
        503: errorResponseSchema,
      },
    } },
    async (request, reply) => {
      try {
        const ids = request.query.ids.split(",");
        return {
          schemaVersion: "mk8dx.public-tournament-placements.v1",
          tournaments: await dependencies.service.loadPublicPlacements(
            await dependencies.resolveActor(request), ids,
          ),
        };
      } catch (error) {
        if (error instanceof TournamentOperationError && error.code === "invalid_input") {
          return reply.code(400).send({ code: "invalid_public_tournament_query", message: "The Tournament query is invalid." });
        }
        return reply.code(503).send({ code: "public_tournaments_unavailable", message: "Tournaments are temporarily unavailable." });
      }
    },
  );

  app.get<{ Params: TournamentParams; Reply: PublicTournamentEvent | ErrorResponse }>(
    "/v1/public/tournament-events/:tournamentId",
    { schema: { params: paramsSchema, response: {
      200: publicEventSchema, 400: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => {
      try {
        const event = await dependencies.service.loadPublic(
          await dependencies.resolveActor(request), request.params.tournamentId,
        );
        return event ?? reply.code(404).send({ code: "public_tournament_not_found", message: "The Tournament was not found." });
      } catch (error) {
        if (error instanceof TournamentOperationError && error.code === "invalid_input") {
          return reply.code(400).send({ code: "invalid_public_tournament_query", message: "The Tournament query is invalid." });
        }
        return reply.code(503).send({ code: "public_tournaments_unavailable", message: "Tournaments are temporarily unavailable." });
      }
    },
  );
}
