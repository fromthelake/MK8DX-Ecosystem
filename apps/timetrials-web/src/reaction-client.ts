// Closed bounded client for the lightweight social reaction layer:
// public counts for a set of Time Trial results, plus authenticated
// react/unreact writes proven with the session CSRF document.

const maximumResponseBytes = 32_768;
const resultIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;

// The owner-approved curated vocabulary; the server enforces the same
// allowlist (migration 0020) so nothing outside it can ever persist.
export const REACTION_KINDS = [
  "laugh", "very_funny", "crying", "nervous", "wow",
  "unbelievable", "cool", "competitive", "watching", "fire",
  "fast", "rocket", "strong", "clap", "thumbs_up",
  "trophy", "gold", "crown", "target", "heart",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export type ReactionSummary = Readonly<{
  resultId: string;
  counts: Readonly<Partial<Record<ReactionKind, number>>>;
  mine?: ReactionKind;
}>;

export class ReactionClientError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "own_result"
      | "unavailable"
      | "invalid_response",
  ) {
    super("Reactions could not be processed.");
    this.name = "ReactionClientError";
  }
}

export interface ReactionClient {
  summary(
    resultIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ReactionSummary[]>;
  react(resultId: string, kind: ReactionKind, signal?: AbortSignal): Promise<void>;
  remove(resultId: string, signal?: AbortSignal): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function isKind(value: unknown): value is ReactionKind {
  return typeof value === "string" &&
    (REACTION_KINDS as readonly string[]).includes(value);
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new ReactionClientError("invalid_response");
  }
  const body = await response.text();
  if (body.length > maximumResponseBytes) {
    throw new ReactionClientError("invalid_response");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ReactionClientError("invalid_response");
  }
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ReactionClientError("invalid_response");
  }
  return value;
}

function parseSummaries(value: unknown): readonly ReactionSummary[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReactionClientError("invalid_response");
  }
  const document = value as Record<string, unknown>;
  if (document["schemaVersion"] !== "mk8dx.public-time-trial-reactions.v1" ||
      !Array.isArray(document["reactions"]) ||
      document["reactions"].length > 20) {
    throw new ReactionClientError("invalid_response");
  }
  return document["reactions"].map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ReactionClientError("invalid_response");
    }
    const row = entry as Record<string, unknown>;
    const counts = row["counts"] as Record<string, unknown> | undefined;
    if (typeof row["resultId"] !== "string" ||
        !resultIdPattern.test(row["resultId"]) ||
        typeof counts !== "object" || counts === null ||
        ("mine" in row && !isKind(row["mine"]))) {
      throw new ReactionClientError("invalid_response");
    }
    const parsedCounts: Partial<Record<ReactionKind, number>> = {};
    for (const [key, value] of Object.entries(counts)) {
      if (!isKind(key)) {
        throw new ReactionClientError("invalid_response");
      }
      parsedCounts[key] = count(value);
    }
    return {
      resultId: row["resultId"],
      counts: parsedCounts,
      ...(isKind(row["mine"]) ? { mine: row["mine"] } : {}),
    };
  });
}

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

export function createReactionClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): ReactionClient {
  const csrfProof = async (signal?: AbortSignal): Promise<
    Readonly<{ headerName: string; value: string }>
  > => {
    let response: Response;
    try {
      response = await fetchPort("/v1/session/csrf", {
        ...baseInit,
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new ReactionClientError("unavailable");
    }
    if (response.status === 401) {
      throw new ReactionClientError("not_authenticated");
    }
    if (response.status !== 200) {
      throw new ReactionClientError("unavailable");
    }
    const document = await boundedJson(response) as Record<string, unknown>;
    if (document["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
        typeof document["headerName"] !== "string" ||
        !/^x-[a-z0-9-]{1,62}$/i.test(document["headerName"]) ||
        typeof document["value"] !== "string" ||
        document["value"].length < 1 || document["value"].length > 4_096) {
      throw new ReactionClientError("invalid_response");
    }
    return { headerName: document["headerName"], value: document["value"] };
  };

  const write = async (
    method: "PUT" | "DELETE",
    payload: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<void> => {
    const proof = await csrfProof(signal);
    let response: Response;
    try {
      response = await fetchPort("/v1/time-trial-reactions", {
        ...baseInit,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.headerName]: proof.value,
        },
        body: JSON.stringify(payload),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new ReactionClientError("unavailable");
    }
    if (response.status === 401) {
      throw new ReactionClientError("not_authenticated");
    }
    if (response.status === 403) {
      throw new ReactionClientError("own_result");
    }
    if (response.status !== 200) {
      throw new ReactionClientError("unavailable");
    }
  };

  return {
    async summary(resultIds, signal) {
      if (resultIds.length === 0 || resultIds.length > 20 ||
          resultIds.some((resultId) => !resultIdPattern.test(resultId))) {
        throw new ReactionClientError("invalid_input");
      }
      let response: Response;
      try {
        response = await fetchPort(
          `/v1/public/time-trial-reactions?resultIds=${
            encodeURIComponent(resultIds.join(","))}`,
          {
            ...baseInit,
            method: "GET",
            headers: { Accept: "application/json" },
            ...(signal === undefined ? {} : { signal }),
          },
        );
      } catch {
        throw new ReactionClientError("unavailable");
      }
      if (response.status !== 200) {
        throw new ReactionClientError("unavailable");
      }
      return parseSummaries(await boundedJson(response));
    },
    async react(resultId, kind, signal) {
      if (!resultIdPattern.test(resultId) || !isKind(kind)) {
        throw new ReactionClientError("invalid_input");
      }
      await write("PUT", { resultId, kind }, signal);
    },
    async remove(resultId, signal) {
      if (!resultIdPattern.test(resultId)) {
        throw new ReactionClientError("invalid_input");
      }
      await write("DELETE", { resultId }, signal);
    },
  };
}
