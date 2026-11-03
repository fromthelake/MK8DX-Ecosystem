export const playerAliasesPath = (playerId: string): string =>
  `/v1/players/${encodeURIComponent(playerId)}/aliases`;

const maximumResponseBytes = 65_536;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const aliasIdPattern = /^alias\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const aliasTypes = new Set([
  "declared",
  "legacy_handle",
  "tournament_name",
  "ocr_observation",
  "other_observation",
]);

export type PublicPlayerAlias = Readonly<{
  aliasId: string;
  playerId: string;
  aliasText: string;
  aliasType: "declared" | "legacy_handle" | "tournament_name" |
    "ocr_observation" | "other_observation";
}>;

export type PublicPlayerAliasesDocument = Readonly<{
  schemaVersion: "mk8dx.public-player-aliases.v1";
  playerId: string;
  aliases: readonly PublicPlayerAlias[];
}>;

export class PlayerAliasClientError extends Error {
  public constructor() {
    super("Public Player aliases could not be loaded.");
    this.name = "PlayerAliasClientError";
  }
}

export interface PlayerAliasClient {
  listForPlayer(
    playerId: string,
    signal?: AbortSignal,
  ): Promise<PublicPlayerAliasesDocument>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlayerAliasClientError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length ||
    expected.some((key) => !(key in value))) {
    throw new PlayerAliasClientError();
  }
}

function string(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))) {
    throw new PlayerAliasClientError();
  }
  return value;
}

function parseDocument(value: unknown, expectedPlayerId: string): PublicPlayerAliasesDocument {
  const root = object(value);
  exactKeys(root, ["schemaVersion", "playerId", "aliases"]);
  if (root["schemaVersion"] !== "mk8dx.public-player-aliases.v1" ||
    root["playerId"] !== expectedPlayerId || !Array.isArray(root["aliases"]) ||
    root["aliases"].length > 100) {
    throw new PlayerAliasClientError();
  }
  const aliases = root["aliases"].map((value): PublicPlayerAlias => {
    const alias = object(value);
    exactKeys(alias, ["aliasId", "playerId", "aliasText", "aliasType"]);
    if (alias["playerId"] !== expectedPlayerId ||
      typeof alias["aliasType"] !== "string" || !aliasTypes.has(alias["aliasType"])) {
      throw new PlayerAliasClientError();
    }
    return {
      aliasId: string(alias["aliasId"], 134, aliasIdPattern),
      playerId: string(alias["playerId"], 135, playerIdPattern),
      aliasText: string(alias["aliasText"], 128),
      aliasType: alias["aliasType"] as PublicPlayerAlias["aliasType"],
    };
  });
  return {
    schemaVersion: "mk8dx.public-player-aliases.v1",
    playerId: expectedPlayerId,
    aliases,
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null ||
    (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw new PlayerAliasClientError();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      received += chunk.value.byteLength;
      if (received > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PlayerAliasClientError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof PlayerAliasClientError) { throw error; }
    throw new PlayerAliasClientError();
  }
}

export function createPlayerAliasClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PlayerAliasClient {
  return {
    async listForPlayer(playerId, signal) {
      if (!playerIdPattern.test(playerId)) { throw new PlayerAliasClientError(); }
      let response: Response;
      try {
        response = await fetchPort(playerAliasesPath(playerId), {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "same-origin",
          cache: "no-store",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new PlayerAliasClientError();
      }
      const body = await boundedJson(response);
      if (response.status !== 200) { throw new PlayerAliasClientError(); }
      return parseDocument(body, playerId);
    },
  };
}
