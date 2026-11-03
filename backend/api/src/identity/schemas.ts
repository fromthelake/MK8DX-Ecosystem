export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
  },
} as const;

export const playerIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId"],
  properties: {
    playerId: {
      type: "string",
      minLength: 8,
      maxLength: 135,
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

export const userAccountIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userAccountId"],
  properties: {
    userAccountId: {
      type: "string",
      minLength: 14,
      maxLength: 141,
      pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

export const playerClaimIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerClaimId"],
  properties: {
    playerClaimId: {
      type: "string",
      minLength: 14,
      maxLength: 141,
      pattern: "^player_claim\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

export const publicPlayerProfileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "displayName"],
  properties: {
    playerId: {
      type: "string",
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    username: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "string", minLength: 1, maxLength: 64 } },
    },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    countryId: {
      type: "string",
      pattern: "^country\.[a-z0-9_]+$",
    },
    avatarId: {
      type: "string",
      pattern: "^character(_variant)?\.[a-z0-9_.]+$",
    },
    favoriteBodyId: { type: "string", pattern: "^body\\.[a-z0-9_]+$" },
    favoriteTireId: { type: "string", pattern: "^tire\\.[a-z0-9_]+$" },
    favoriteGliderId: { type: "string", pattern: "^glider\\.[a-z0-9_]+$" },
    timeTrialModePreference: { type: "string", enum: ["all", "150", "200"] },
  },
} as const;

export const privateUserAccountSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["userAccountId", "accountStatus"],
  properties: {
    userAccountId: {
      type: "string",
      pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    accountStatus: {
      type: "string",
      enum: ["active", "suspended", "closed"],
    },
  },
} as const;

export const privatePlayerClaimSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "playerClaimId",
    "playerId",
    "userAccountId",
    "claimStatus",
    "disputeStatus",
  ],
  properties: {
    playerClaimId: {
      type: "string",
      pattern: "^player_claim\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    playerId: {
      type: "string",
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    userAccountId: {
      type: "string",
      pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    claimStatus: {
      type: "string",
      enum: [
        "requested",
        "under_review",
        "verified",
        "rejected",
        "released",
        "revoked",
      ],
    },
    disputeStatus: {
      type: "string",
      enum: ["none", "open", "resolved"],
    },
  },
} as const;

const evidenceIdsSchema = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: {
    type: "string",
    minLength: 21,
    maxLength: 148,
    pattern: "^restricted_evidence\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
  },
} as const;

const reasonCodeSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;

/** A note between the person asking and the claim's reviewers (ADR-0216); the service trims and checks it. */
export const claimNoteSchema = { type: "string", minLength: 1, maxLength: 2000 } as const;

export const requestPlayerClaimBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "evidenceIds"],
  properties: {
    playerId: playerIdParamsSchema.properties.playerId,
    evidenceIds: evidenceIdsSchema,
    note: claimNoteSchema,
  },
} as const;

export const claimReplyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["note"],
  properties: { note: claimNoteSchema },
} as const;

export const releaseOwnClaimBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: { note: claimNoteSchema },
} as const;

export const administratorClaimActionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: [
        "start_review",
        "verify",
        "reject",
        "release",
        "revoke",
        "resolve_dispute",
        "request_information",
      ],
    },
    evidenceIds: evidenceIdsSchema,
    reasonCode: reasonCodeSchema,
    note: claimNoteSchema,
  },
} as const;

export const openClaimDisputeBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    evidenceIds: evidenceIdsSchema,
    reasonCode: reasonCodeSchema,
  },
} as const;

export const claimMutationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "playerClaimId",
    "playerId",
    "userAccountId",
    "claimStatus",
    "disputeStatus",
    "revision",
    "lastSequence",
  ],
  properties: {
    ...privatePlayerClaimSummarySchema.properties,
    revision: { type: "integer", minimum: 1 },
    lastSequence: { type: "integer", minimum: 1 },
  },
} as const;
