import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ActorContext, ActorResolver } from "../identity/types.js";
import { PlayerOnboardingError } from "../identity/player-onboarding-service.js";
import type { TournamentConnectedService } from "./tournament-connected-service.js";
import {
  TournamentOperationError,
  type TournamentOperationService,
} from "./tournament-operation-service.js";
import { type TournamentRaceMode } from "./race-result-validation.js";
import {
  rosterAliasRequestSchema,
  rosterCandidateRequestSchema,
  rosterPlayersRequestSchema,
  type RosterPlayersRequest,
} from "./roster-player-candidate-schemas.js";

type NativeTournamentOperations = Pick<TournamentOperationService,
  "listForAdministrator" | "loadForAdministrator" | "setParticipant" |
  "updateGroups" | "recordIncident"> & Partial<Pick<
  TournamentOperationService, "create" | "update" | "removeParticipant" |
  "listSelectableDirectors" | "addRecentParticipants" | "addHistoricalParticipants" | "importParticipants" | "generateGroups" | "importGroupLayout" | "enterRace" | "enterRaces" | "lockGroups" | "setManualScores" | "setTieBreakOrder" | "setWorkflowStep" | "advanceWorkflow" | "rollbackWorkflow" | "finalize" |
  "deleteDraft" | "rosterPlayerCandidates" | "rememberRosterAliases">>;

const idParams = {
  type: "object", additionalProperties: false, required: ["tournamentId"],
  properties: {
    tournamentId: {
      type: "string", minLength: 17, maxLength: 160,
      pattern: "^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
    },
  },
} as const;

const incomingParams = {
  type: "object", additionalProperties: false, required: ["incomingResultId"],
  properties: { incomingResultId: { type: "string", minLength: 1, maxLength: 160 } },
} as const;

function requireNativeBearer(request: FastifyRequest): void {
  // Better Auth exposes the signed session cookie as `payload.signature`.
  // Shape-check only; resolveActor remains authoritative for signature,
  // expiry, revocation, Player linkage, and administrator policy.
  if (!/^Bearer [^\s]{20,512}$/i.test(request.headers.authorization ?? "")) {
    throw new TournamentOperationError("forbidden", "A native-app bearer token is required.");
  }
}

function failure(error: unknown): { status: number; body: { code: string; message: string } } {
  if (error instanceof TournamentOperationError) {
    const status = error.code === "forbidden" ? 403
      : error.code === "not_found" ? 404
      : error.code === "conflict" ? 409
      : 400;
    return { status, body: { code: `native_tournament_${error.code}`, message: error.message } };
  }
  throw error;
}

/**
 * Narrow native operator boundary for a phone used during an event.
 *
 * Bearer authentication and the operation service's audited administrator or
 * explicit tournament.operation capability replace browser-only CSRF;
 * canonical scoring and optimistic revisions remain server-owned.
 */
export async function registerTournamentNativeOperationRoutes(
  app: FastifyInstance,
  dependencies: Readonly<{
    resolveActor: ActorResolver;
    operations: NativeTournamentOperations;
    connected: TournamentConnectedService;
    hasOperationCapability?: (userAccountId: string) => Promise<boolean>;
    /**
   * Removing a Tournament hides it rather than destroying it (ADR-0178 work,
   * owner decision 2026-08-28), and its own director may do it - so it belongs
   * on the race-day surface, not only in the administrator web.
   */
  removeTournament?: (
    actor: ActorContext,
    input: { tournamentId: string; reason: string },
  ) => Promise<unknown>;
  createRosterPlayers?: (
      actor: { role: string; userAccountId: string },
      requests: readonly Readonly<{ row: number; displayName: string; confirmSameName?: boolean }>[],
      options?: Readonly<{ tournamentId?: string }>,
    ) => Promise<readonly Readonly<{
      playerId: string; username: string; displayName: string;
    }>[]>;
  }>,
): Promise<void> {
  const handle = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      const mapped = failure(error);
      return reply.code(mapped.status).send(mapped.body) as T;
    }
  };
  const actor = async (request: FastifyRequest) => {
    requireNativeBearer(request);
    const resolved = await dependencies.resolveActor(request);
    if (resolved.role === "administrator") return resolved;
    if (resolved.role === "account" && await dependencies.hasOperationCapability?.(resolved.userAccountId) === true) {
      // Downstream operation services retain their administrator-shaped actor
      // port; the audited capability check above is the native authorization.
      return { ...resolved, role: "administrator" as const };
    }
    throw new TournamentOperationError("forbidden", "Tournament operator capability required");
  };

  app.post<{ Body: { name: string; seriesLabel?: string | null; editionNumber?: number | null; eventDate?: string | null; startAtMs?: number; timezone?: string; placementStrategy?: "balanced" | "minimal_move"; qualifierRounds?: boolean; maxParticipants?: number | null;
    seedingSource?: "community_rating" | "director_nights" | "manual" | "random"; verifiedOnly?: boolean;
    directorUserAccountId?: string } }>(
    "/v1/native/tournaments",
    async (request, reply) => handle(reply, async () => dependencies.operations.create!(await actor(request), request.body)),
  );

  // The source Manager's Step 3 and Step 7 layout file: switch owner, console,
  // the two seats and the group. It rearranges the groups that already exist.
  app.post<{
    Params: { tournamentId: string };
    Body: {
      expectedRevision: number;
      stage: "qualifier" | "final";
      groups: { name: string; seats: { playerId: string; stationOwnerPlayerId: string | null; switchType: "ns1" | "ns2" | null; seatNumber: 1 | 2 | null }[] }[];
    };
  }>(
    "/v1/native/tournaments/:tournamentId/actions/import-group-layout",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "stage", "groups"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        stage: { type: "string", enum: ["qualifier", "final"] },
        groups: {
          type: "array", minItems: 1, maxItems: 8,
          items: {
            type: "object", additionalProperties: false, required: ["name", "seats"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 64 },
              seats: {
                type: "array", maxItems: 12,
                items: {
                  type: "object", additionalProperties: false, required: ["playerId"],
                  properties: {
                    playerId: { type: "string", minLength: 1, maxLength: 128 },
                    stationOwnerPlayerId: { type: ["string", "null"], maxLength: 128 },
                    switchType: { type: ["string", "null"], enum: ["ns1", "ns2", null] },
                    seatNumber: { type: ["integer", "null"], enum: [1, 2, null] },
                  },
                },
              },
              stations: {
                type: "array", maxItems: 6,
                items: {
                  type: "object", additionalProperties: false, required: ["stationOwnerPlayerId", "switchType"],
                  properties: {
                    stationOwnerPlayerId: { type: "string", minLength: 8, maxLength: 135 },
                    switchType: { type: "string", enum: ["ns1", "ns2"] },
                  },
                },
              },
            },
          },
        },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.importGroupLayout!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: { reason: string } }>(
    "/v1/native/tournaments/:tournamentId/actions/remove",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["reason"],
      properties: { reason: { type: "string", minLength: 3, maxLength: 512 } },
    } } },
    async (request, reply) => handle(reply, async () => {
      if (dependencies.removeTournament === undefined) {
        throw new TournamentOperationError("unavailable");
      }
      // Deliberately not the upgraded administrator shape used elsewhere on
      // this surface: removal authorizes on the Tournament's own director, so
      // the real actor has to reach the service.
      const actor = await dependencies.resolveActor(request);
      return dependencies.removeTournament(actor, {
        tournamentId: request.params.tournamentId,
        reason: request.body.reason,
      });
    }),
  );

  // A recorded race, the canonical unit the rating is applied from. Until now
  // the service could take one but nothing could offer it, which is why a night
  // scored on the phone could only ever be manual totals - and manual totals
  // never reach TrueSkill.
  app.post<{
    Params: { tournamentId: string };
    Body: {
      expectedRevision: number;
      groupId: string;
      raceNumber?: number;
      trackId: string;
      mode?: TournamentRaceMode;
      mirror?: true;
      finishOrder: string[];
    };
  }>(
    "/v1/native/tournaments/:tournamentId/actions/enter-race",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "trackId", "finishOrder"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        groupId: { type: "string", minLength: 1, maxLength: 128 },
        raceNumber: { type: "integer", minimum: 1, maximum: 64 },
        trackId: { type: "string", minLength: 1, maxLength: 128 },
        mode: { type: "integer", enum: [50, 100, 150, 200] },
        mirror: { type: "boolean", const: true },
        finishOrder: {
          type: "array", minItems: 2, maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.enterRace!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  // The races of one group in one request, as a score workbook hands them over.
  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number; groupId: string;
    races: { raceNumber?: number; trackId: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: string[] }[];
  } }>(
    "/v1/native/tournaments/:tournamentId/actions/enter-races",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "races"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        groupId: { type: "string", minLength: 1, maxLength: 128 },
        races: {
          type: "array", minItems: 1, maxItems: 64,
          items: {
            type: "object", additionalProperties: false, required: ["trackId", "finishOrder"],
            properties: {
              raceNumber: { type: "integer", minimum: 1, maximum: 64 },
              trackId: { type: "string", minLength: 1, maxLength: 128 },
              mode: { type: "integer", enum: [50, 100, 150, 200] },
              mirror: { type: "boolean", const: true },
              finishOrder: {
                type: "array", minItems: 2, maxItems: 12,
                items: { type: "string", minLength: 1, maxLength: 128 },
              },
            },
          },
        },
        // The character each Player drove, as the workbook named it. The Web
        // console has sent these since 2026-09-15; without them here a phone
        // import silently drops every character, which is exactly how TN13's
        // final groups ended up empty (owner, 2026-09-16).
        characters: {
          type: "array", maxItems: 12,
          items: {
            type: "object", additionalProperties: false, required: ["playerId", "characterLabel"],
            properties: {
              playerId: { type: "string", minLength: 1, maxLength: 128 },
              characterKey: { type: "string", minLength: 1, maxLength: 96 },
              characterLabel: { type: "string", minLength: 1, maxLength: 64 },
              characterRoster: { type: "string", minLength: 1, maxLength: 64 },
            },
          },
        },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.enterRaces!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number; targetStep: number } }>(
    "/v1/native/tournaments/:tournamentId/actions/set-workflow-step",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "targetStep"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        targetStep: { type: "integer", minimum: 2, maximum: 10 },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.setWorkflowStep!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  for (const [action, operationName] of [
    ["advance-current-step", "advanceWorkflow"],
    ["rollback-current-step", "rollbackWorkflow"],
  ] as const) {
    app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number } }>(
      `/v1/native/tournaments/:tournamentId/actions/${action}`,
      { schema: { params: idParams, body: {
        type: "object", additionalProperties: false, required: ["expectedRevision"],
        properties: { expectedRevision: { type: "integer", minimum: 1 } },
      } } },
      async (request, reply) => handle(reply, async () => dependencies.operations[operationName]!(
        await actor(request), request.params.tournamentId, request.body,
      )),
    );
  }

  app.get<{ Querystring: { director?: string } }>(
    "/v1/native/tournaments",
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.native-tournaments.v1",
      tournaments: await dependencies.operations.listForAdministrator(await actor(request), {
        ...(request.query.director === undefined
          ? {}
          : { directorUserAccountId: request.query.director }),
      }),
    })),
  );

  // ADR-0177 decisions 8 to 12: a roster import may create canonical Players
  // from reviewed display names. The actor gate above is the authorization;
  // any collision rejects the whole batch and writes nothing.
  // ADR-0218: the Players a typed name may mean, with context; never a link.
  app.post<{ Body: { names: string[]; tournamentId?: string; partial?: boolean } }>(
    "/v1/native/roster-player-candidates",
    { schema: { body: rosterCandidateRequestSchema } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.roster-player-candidates.v1",
      entries: await dependencies.operations.rosterPlayerCandidates!(await actor(request), {
        names: request.body.names,
        ...(request.body.tournamentId === undefined ? {} : { tournamentId: request.body.tournamentId }),
        ...(request.body.partial === undefined ? {} : { partial: request.body.partial }),
      }),
    })),
  );

  // ADR-0218: names the Director chose a Player for become their own aliases.
  app.post<{ Params: { tournamentId: string }; Body: { aliases: { playerId: string; name: string }[] } }>(
    "/v1/native/tournaments/:tournamentId/roster-aliases",
    { schema: { params: idParams, body: rosterAliasRequestSchema } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.roster-aliases.v1",
      ...await dependencies.operations.rememberRosterAliases!(await actor(request), request.params.tournamentId, request.body),
    })),
  );

  app.post<{ Body: RosterPlayersRequest }>(
    "/v1/native/roster-players",
    { schema: { body: rosterPlayersRequestSchema } },
    async (request, reply) => {
      try {
        const acting = await actor(request);
        const created = await dependencies.createRosterPlayers!(
          acting, request.body.players,
          request.body.tournamentId === undefined ? {} : { tournamentId: request.body.tournamentId },
        );
        return reply.code(201).send({
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

  app.get("/v1/native/tournament-directors", async (request, reply) => handle(reply, async () => {
    const selectable = await dependencies.operations.listSelectableDirectors!(await actor(request));
    return { schemaVersion: "mk8dx.native-tournament-directors.v1", ...selectable };
  }));

  app.get<{ Params: { tournamentId: string } }>(
    "/v1/native/tournaments/:tournamentId",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => dependencies.operations.loadForAdministrator(
      await actor(request), request.params.tournamentId,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number; playerId: string; attendance?: "present" | "waiting" | "absent";
    hasSwitch1?: boolean; hasSwitch2?: boolean;
  } }>(
    "/v1/native/tournaments/:tournamentId/participants",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "playerId"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        playerId: { type: "string", minLength: 8, maxLength: 135 },
        attendance: { type: "string", enum: ["present", "waiting", "absent"] },
        hasSwitch1: { type: "boolean" }, hasSwitch2: { type: "boolean" },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.setParticipant(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  // ADR-0177 decision 7: the Step 2 qualification layout stays editable while
  // no groups exist. The service owns that guard; this route only exposes it,
  // and answers with the whole document so the phone keeps one revision source.
  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number;
    seedingSource?: "community_rating" | "director_nights" | "manual" | "random";
    verifiedOnly?: boolean;
    placementStrategy?: "balanced" | "minimal_move";
    ownerSeatingMode?: "owner_strict" | "owner_soft";
    qualifierTieBreakMode?: "sp" | "lottery" | "manual";
    finalTieBreakMode?: "sp" | "lottery" | "manual";
    maxParticipants?: number | null;
  } }>(
    "/v1/native/tournaments/:tournamentId/actions/update-settings",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        // ADR-0221: the one seeding field.
        seedingSource: { type: "string", enum: ["community_rating", "director_nights", "manual", "random"] },
        verifiedOnly: { type: "boolean" },
        placementStrategy: { type: "string", enum: ["balanced", "minimal_move"] },
        ownerSeatingMode: { type: "string", enum: ["owner_strict", "owner_soft"] },
        qualifierTieBreakMode: { type: "string", enum: ["sp", "lottery", "manual"] },
        finalTieBreakMode: { type: "string", enum: ["sp", "lottery", "manual"] },
        maxParticipants: { type: ["integer", "null"], minimum: 1 },
      },
    } } },
    async (request, reply) => handle(reply, async () => {
      const acting = await actor(request);
      await dependencies.operations.update!(acting, request.params.tournamentId, request.body);
      return dependencies.operations.loadForAdministrator(acting, request.params.tournamentId);
    }),
  );

  // A roster file in one request: the phone's CSV import and its bulk
  // attendance and Switch actions pay one round trip instead of one per row.
  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number;
    rows: { playerId: string; attendance?: "present" | "waiting" | "absent"; hasSwitch1?: boolean; hasSwitch2?: boolean }[];
  } }>(
    "/v1/native/tournaments/:tournamentId/participants/actions/import",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "rows"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        rows: {
          type: "array", minItems: 1, maxItems: 200,
          items: {
            type: "object", additionalProperties: false, required: ["playerId"],
            properties: {
              playerId: { type: "string", minLength: 8, maxLength: 135 },
              attendance: { type: "string", enum: ["present", "waiting", "absent"] },
              hasSwitch1: { type: "boolean" }, hasSwitch2: { type: "boolean" },
            },
          },
        },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.importParticipants!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number } }>(
    "/v1/native/tournaments/:tournamentId/participants/actions/add-historical",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { expectedRevision: { type: "integer", minimum: 1 } },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.addHistoricalParticipants!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number } }>(
    "/v1/native/tournaments/:tournamentId/participants/actions/add-recent",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { expectedRevision: { type: "integer", minimum: 1 } },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.addRecentParticipants!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number; playerId: string } }>(
    "/v1/native/tournaments/:tournamentId/participants/actions/remove",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => dependencies.operations.removeParticipant!(await actor(request), request.params.tournamentId, request.body)),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number; stage: "qualifier" | "final" } }>(
    "/v1/native/tournaments/:tournamentId/actions/generate-groups",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => dependencies.operations.generateGroups!(await actor(request), request.params.tournamentId, request.body)),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number; stage: "qualifier" | "final"; locked: boolean } }>(
    "/v1/native/tournaments/:tournamentId/actions/lock-groups",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => dependencies.operations.lockGroups!(await actor(request), request.params.tournamentId, request.body)),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number; publicResults: boolean; affectsRating: boolean; reasonCode: string } }>(
    "/v1/native/tournaments/:tournamentId/actions/finalize",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => {
      await dependencies.operations.finalize!(await actor(request), request.params.tournamentId, request.body);
      return dependencies.operations.loadForAdministrator(await actor(request), request.params.tournamentId);
    }),
  );

  app.post<{ Params: { tournamentId: string }; Body: { expectedRevision: number } }>(
    "/v1/native/tournaments/:tournamentId/actions/delete",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => { await dependencies.operations.deleteDraft!(await actor(request), request.params.tournamentId, request.body); return { deleted: true }; }),
  );

  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number; stage: "qualifier" | "final";
    groups: { groupId: string; members: string[] }[];
  } }>(
    "/v1/native/tournaments/:tournamentId/groups",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "stage", "groups"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        stage: { type: "string", enum: ["qualifier", "final"] },
        groups: {
          type: "array", minItems: 1, maxItems: 5,
          items: {
            type: "object", additionalProperties: false, required: ["groupId", "members"],
            properties: {
              groupId: { type: "string", minLength: 23, maxLength: 160 },
              members: {
                type: "array", maxItems: 12, uniqueItems: true,
                items: { type: "string", minLength: 8, maxLength: 135 },
              },
            },
          },
        },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.updateGroups(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number; groupId: string; points: number; playerIds: string[];
  } }>(
    "/v1/native/tournaments/:tournamentId/tie-breaks",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "points", "playerIds"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        groupId: { type: "string", minLength: 23, maxLength: 160 },
        points: { type: "integer", minimum: 0, maximum: 60000 },
        playerIds: { type: "array", minItems: 2, maxItems: 12, uniqueItems: true,
          items: { type: "string", minLength: 8, maxLength: 135 } },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.setTieBreakOrder!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number; groupId: string; segments: number;
    scores: { playerId: string; segmentPoints: (number | null)[] }[];
  } }>(
    "/v1/native/tournaments/:tournamentId/manual-scores",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "groupId", "segments", "scores"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        groupId: { type: "string", minLength: 23, maxLength: 160 },
        segments: { type: "integer", minimum: 1, maximum: 6 },
        scores: { type: "array", minItems: 1, maxItems: 12, items: {
          type: "object", additionalProperties: false, required: ["playerId", "segmentPoints"],
          properties: {
            playerId: { type: "string", minLength: 8, maxLength: 135 },
            segmentPoints: { type: "array", minItems: 1, maxItems: 6, items: { type: ["integer", "null"], minimum: 0, maximum: 10000 } },
          },
        } },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.setManualScores!(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.post<{ Params: { tournamentId: string }; Body: {
    expectedRevision: number;
    category: "attendance" | "replacement" | "equipment" | "scoring" | "conduct" | "other";
    note: string; playerId?: string;
  } }>(
    "/v1/native/tournaments/:tournamentId/incidents",
    { schema: { params: idParams, body: {
      type: "object", additionalProperties: false,
      required: ["expectedRevision", "category", "note"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        category: { type: "string", enum: ["attendance", "replacement", "equipment", "scoring", "conduct", "other"] },
        note: { type: "string", minLength: 1, maxLength: 160 },
        playerId: { type: "string", minLength: 8, maxLength: 135 },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.operations.recordIncident(
      await actor(request), request.params.tournamentId, request.body,
    )),
  );

  app.get<{ Params: { tournamentId: string } }>(
    "/v1/native/tournaments/:tournamentId/evidence-records",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.native-tournament-evidence-records.v1",
      records: await dependencies.connected.listEvidenceRecords(await actor(request), request.params.tournamentId),
    })),
  );

  app.post<{ Params: { tournamentId: string; recordId: string }; Body: {
    expectedRevision: number;
    mappings: { observedGroupLabel: string; groupId: string; phase: string }[];
    reason: string;
  } }>(
    "/v1/native/tournaments/:tournamentId/evidence-records/:recordId/actions/link",
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.native-tournament-incoming.v1",
      results: await dependencies.connected.linkEvidenceRecord(await actor(request), {
        tournamentId: request.params.tournamentId,
        recordId: request.params.recordId,
        ...request.body,
      }),
    })),
  );

  app.post<{ Params: { tournamentId: string; recordId: string }; Body: {
    expectedRevision: number;
    mappings: { observedGroupLabel: string; groupId: string; phase: string }[];
    reason: string;
  } }>(
    "/v1/native/tournaments/:tournamentId/evidence-records/:recordId/actions/approve-live",
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.native-tournament-live-association.v1",
      record: await dependencies.connected.approveLiveAssociation(await actor(request), {
        tournamentId: request.params.tournamentId,
        recordId: request.params.recordId,
        ...request.body,
      }),
    })),
  );

  app.get<{ Params: { tournamentId: string } }>(
    "/v1/native/tournaments/:tournamentId/incoming-results",
    { schema: { params: idParams } },
    async (request, reply) => handle(reply, async () => ({
      schemaVersion: "mk8dx.native-tournament-incoming.v1",
      results: await dependencies.connected.listIncoming(await actor(request), request.params.tournamentId),
    })),
  );

  app.post<{ Params: { incomingResultId: string }; Body: {
    expectedRevision: number; tournamentRevision: number; groupId: string; raceNumber: number;
    correctedResult: unknown; occurredAtMs?: number; reason: string;
  } }>(
    "/v1/native/tournament-incoming-results/:incomingResultId/actions/accept",
    { schema: { params: incomingParams, body: {
      type: "object", required: ["expectedRevision", "tournamentRevision", "groupId", "raceNumber", "correctedResult", "reason"],
      additionalProperties: false,
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        tournamentRevision: { type: "integer", minimum: 1 },
        groupId: { type: "string", minLength: 23, maxLength: 160 },
        raceNumber: { type: "integer", minimum: 1, maximum: 64 },
        correctedResult: { type: "object" },
        occurredAtMs: { type: "integer", minimum: 0 },
        reason: { type: "string", minLength: 1, maxLength: 240 },
      },
    } } },
    async (request, reply) => handle(reply, async () => dependencies.connected.accept(
      await actor(request), { ...request.body, incomingResultId: request.params.incomingResultId },
    )),
  );

  app.post<{ Body: Parameters<TournamentConnectedService["acceptGroup"]>[1] }>(
    "/v1/native/tournament-incoming-results/actions/accept-group",
    async (request, reply) => handle(reply, async () => dependencies.connected.acceptGroup(
      await actor(request), request.body,
    )),
  );

  app.post<{ Params: { incomingResultId: string }; Body: { expectedRevision: number; reason: string } }>(
    "/v1/native/tournament-incoming-results/:incomingResultId/actions/reject",
    { schema: { params: incomingParams, body: {
      type: "object", additionalProperties: false, required: ["expectedRevision", "reason"],
      properties: {
        expectedRevision: { type: "integer", minimum: 1 },
        reason: { type: "string", minLength: 1, maxLength: 240 },
      },
    } } },
    async (request, reply) => handle(reply, async () => {
      await dependencies.connected.reject(
        await actor(request), { ...request.body, incomingResultId: request.params.incomingResultId },
      );
      return { status: "rejected" };
    }),
  );
}
