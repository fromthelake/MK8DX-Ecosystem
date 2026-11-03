export const aliasIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["aliasId"],
  properties: {
    aliasId: {
      type: "string",
      minLength: 7,
      maxLength: 134,
      pattern: "^alias\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

const provenanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceType", "sourceReference", "observedAtMs"],
  properties: {
    sourceType: {
      type: "string",
      enum: [
        "player_declaration",
        "tournament_manager",
        "tournament_workbook",
        "timetrial_firebase",
        "ocr",
        "administrator",
      ],
    },
    sourceReference: {
      type: "string",
      maxLength: 255,
      pattern: "^source\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    observedAtMs: { type: "integer", minimum: 0 },
  },
} as const;

const aliasTypeSchema = {
  type: "string",
  enum: [
    "declared",
    "legacy_handle",
    "tournament_name",
    "ocr_observation",
    "other_observation",
  ],
} as const;

const visibilitySchema = {
  type: "string",
  enum: ["public", "restricted"],
} as const;

const reasonCodeSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;

export const createAliasBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "aliasText", "aliasType", "visibility", "provenance"],
  properties: {
    playerId: {
      type: "string",
      minLength: 8,
      maxLength: 135,
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    aliasText: { type: "string", minLength: 1, maxLength: 128 },
    aliasType: aliasTypeSchema,
    visibility: visibilitySchema,
    provenance: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: provenanceSchema,
    },
  },
} as const;

export const updateAliasBodySchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "visibility"],
      properties: {
        action: { const: "set_visibility" },
        visibility: visibilitySchema,
        reasonCode: reasonCodeSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { const: "retire" },
        reasonCode: reasonCodeSchema,
      },
    },
  ],
} as const;

export const publicAliasProfileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["aliasId", "playerId", "aliasText", "aliasType"],
  properties: {
    aliasId: aliasIdParamsSchema.properties.aliasId,
    playerId: createAliasBodySchema.properties.playerId,
    aliasText: createAliasBodySchema.properties.aliasText,
    aliasType: aliasTypeSchema,
  },
} as const;

export const publicPlayerAliasesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerId", "aliases"],
  properties: {
    schemaVersion: { const: "mk8dx.public-player-aliases.v1" },
    playerId: createAliasBodySchema.properties.playerId,
    aliases: {
      type: "array",
      maxItems: 100,
      items: publicAliasProfileSchema,
    },
  },
} as const;

export const aliasMutationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "aliasId",
    "playerId",
    "aliasText",
    "aliasType",
    "visibility",
    "recordStatus",
    "revision",
    "lastSequence",
  ],
  properties: {
    ...publicAliasProfileSchema.properties,
    visibility: visibilitySchema,
    recordStatus: { type: "string", enum: ["active", "retired"] },
    revision: { type: "integer", minimum: 1 },
    lastSequence: { type: "integer", minimum: 1 },
  },
} as const;
