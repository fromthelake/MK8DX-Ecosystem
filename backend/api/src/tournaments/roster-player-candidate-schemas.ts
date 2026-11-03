// ADR-0218 request and response schemas, shared by the browser (CSRF) and the
// native (bearer) Tournament surfaces so Web and Android read one contract.

const tournamentIdSchema = {
  type: "string", minLength: 17, maxLength: 160,
  pattern: "^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const playerIdSchema = { type: "string", minLength: 8, maxLength: 135, pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" } as const;
const nameSchema = { type: "string", minLength: 1, maxLength: 64 } as const;

export const rosterCandidateRequestSchema = {
  type: "object", additionalProperties: false, required: ["names"],
  properties: {
    names: { type: "array", minItems: 1, maxItems: 200, items: nameSchema },
    tournamentId: tournamentIdSchema,
    partial: { type: "boolean" },
  },
} as const;

export const rosterCandidateResponseSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "entries"],
  properties: {
    schemaVersion: { const: "mk8dx.roster-player-candidates.v1" },
    entries: {
      type: "array", maxItems: 200,
      items: {
        type: "object", additionalProperties: false, required: ["name", "sameNameInOwnNights", "candidates"],
        properties: {
          name: nameSchema,
          sameNameInOwnNights: { type: "boolean" },
          candidates: {
            type: "array", maxItems: 10,
            items: {
              type: "object", additionalProperties: false,
              required: [
                "playerId", "username", "displayName", "matchedBy", "claimed", "inTournament",
                "nights", "nightsWithDirector", "directorNames",
              ],
              properties: {
                playerId: { type: "string", minLength: 8, maxLength: 135 },
                username: { type: "string", minLength: 1, maxLength: 135 },
                displayName: nameSchema,
                matchedBy: { enum: ["display_name", "alias", "username", "partial"] },
                aliasText: { type: "string", minLength: 1, maxLength: 128 },
                aliasScope: { enum: ["director", "installation"] },
                claimed: { type: "boolean" },
                inTournament: { type: "boolean" },
                nights: { type: "integer", minimum: 0 },
                nightsWithDirector: { type: "integer", minimum: 0 },
                lastNightName: { type: "string", minLength: 1, maxLength: 160 },
                lastNightDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                directorNames: { type: "array", maxItems: 5, items: nameSchema },
                characterKey: { type: "string", minLength: 1, maxLength: 96 },
                characterLabel: nameSchema,
              },
            },
          },
        },
      },
    },
  },
} as const;

export const rosterAliasRequestSchema = {
  type: "object", additionalProperties: false, required: ["aliases"],
  properties: {
    aliases: {
      type: "array", minItems: 1, maxItems: 200,
      items: {
        type: "object", additionalProperties: false, required: ["playerId", "name"],
        properties: { playerId: playerIdSchema, name: nameSchema },
      },
    },
  },
} as const;

export const rosterAliasResponseSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "created", "existing"],
  properties: {
    schemaVersion: { const: "mk8dx.roster-aliases.v1" },
    created: {
      type: "array", maxItems: 200,
      items: {
        type: "object", additionalProperties: false, required: ["playerId", "aliasText"],
        properties: { playerId: { type: "string", minLength: 8, maxLength: 135 }, aliasText: nameSchema },
      },
    },
    existing: { type: "integer", minimum: 0 },
  },
} as const;

/** ADR-0218: `tournamentId` scopes the own-nights warning; `confirmSameName` answers it. */
export const rosterPlayersRequestSchema = {
  type: "object", additionalProperties: false, required: ["players"],
  properties: {
    tournamentId: tournamentIdSchema,
    players: {
      type: "array", minItems: 1, maxItems: 512,
      items: {
        type: "object", additionalProperties: false, required: ["row", "displayName"],
        properties: {
          row: { type: "integer", minimum: 1 },
          displayName: nameSchema,
          confirmSameName: { type: "boolean" },
        },
      },
    },
  },
} as const;

export type RosterPlayersRequest = {
  tournamentId?: string;
  players: { row: number; displayName: string; confirmSameName?: boolean }[];
};
