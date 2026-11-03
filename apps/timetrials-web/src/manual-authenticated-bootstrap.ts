import {
  parseWebManualContextDocument,
} from "./manual-context-document.js";
import type { WebManualAuthenticatedSessionBoundary } from
  "./post-time-session.js";


export const WEB_MANUAL_BOOTSTRAP_PATH =
  "/v1/time-trial-submissions/manual-bootstrap";
export const WEB_MANUAL_CSRF_PATH = "/v1/session/csrf";
export const WEB_MANUAL_BOOTSTRAP_RESPONSE_MAX_BYTES = 32_768;
export const WEB_MANUAL_CSRF_RESPONSE_MAX_BYTES = 4_096;

export type WebManualBootstrapErrorCode =
  | "invalid_track"
  | "network_unavailable"
  | "not_authenticated"
  | "not_authorized"
  | "service_unavailable"
  | "invalid_response";

export class WebManualBootstrapError extends Error {
  public constructor(
    public readonly code: WebManualBootstrapErrorCode,
    public readonly retryable: boolean,
  ) {
    super("The authenticated web manual session could not be established.");
    this.name = "WebManualBootstrapError";
  }
}

export interface WebManualAuthenticatedBootstrapClient {
  bootstrap(
    trackId: string,
    signal?: AbortSignal,
  ): Promise<WebManualAuthenticatedSessionBoundary>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(
  code: WebManualBootstrapErrorCode,
  retryable = false,
): never {
  throw new WebManualBootstrapError(code, retryable);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const requiredSet = new Set(required);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => requiredSet.has(key));
}

function mapStatus(status: number): never {
  if (status === 401) { fail("not_authenticated"); }
  if (status === 403) { fail("not_authorized"); }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    fail("service_unavailable", true);
  }
  fail("invalid_response");
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  if (response.status !== 200) { mapStatus(response.status); }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) ||
    (declaredLength !== null &&
      (!/^[0-9]+$/.test(declaredLength) ||
        Number(declaredLength) > maximumBytes)) ||
    response.body === null) {
    fail("invalid_response");
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
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        fail("invalid_response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof WebManualBootstrapError) { throw error; }
    fail("invalid_response");
  }
}

async function sameOriginJson(
  fetchPort: FetchPort,
  path: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchPort(path, {
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
    fail("network_unavailable", true);
  }
  return boundedJson(response, maximumBytes);
}

function csrfProof(document: unknown): Readonly<{
  headerName: string;
  value: string;
}> {
  if (!isObject(document) ||
    !exactKeys(document, ["schemaVersion", "headerName", "value"]) ||
    document.schemaVersion !== "mk8dx.web-csrf.v1" ||
    typeof document.headerName !== "string" ||
    !/^x-[a-z0-9-]{1,62}$/i.test(document.headerName) ||
    typeof document.value !== "string" ||
    document.value.length < 1 || document.value.length > 4_096 ||
    !/^[\x21-\x7e]+$/.test(document.value)) {
    fail("invalid_response");
  }
  return { headerName: document.headerName, value: document.value };
}

export function createWebManualAuthenticatedBootstrapClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): WebManualAuthenticatedBootstrapClient {
  return {
    async bootstrap(trackId, signal) {
      if (!/^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(trackId) ||
        trackId.length > 255) {
        fail("invalid_track");
      }
      const path = `${WEB_MANUAL_BOOTSTRAP_PATH}?trackId=${
        encodeURIComponent(trackId)
      }`;
      const document = await sameOriginJson(
        fetchPort,
        path,
        WEB_MANUAL_BOOTSTRAP_RESPONSE_MAX_BYTES,
        signal,
      );
      if (!isObject(document) ||
        !exactKeys(document, ["schemaVersion", "context"]) ||
        document.schemaVersion !== "mk8dx.web-manual-bootstrap.v1") {
        fail("invalid_response");
      }

      let context;
      try {
        context = parseWebManualContextDocument(document.context);
      } catch {
        fail("invalid_response");
      }
      if (context.trackId !== trackId ||
        context.playerReference.namespace !== "player") {
        fail("invalid_response");
      }
      const contextJson = JSON.stringify(document.context);

      return {
        contextJson: () => contextJson,
        async csrfProof(csrfSignal) {
          const csrfDocument = await sameOriginJson(
            fetchPort,
            WEB_MANUAL_CSRF_PATH,
            WEB_MANUAL_CSRF_RESPONSE_MAX_BYTES,
            csrfSignal,
          );
          return csrfProof(csrfDocument);
        },
      };
    },
  };
}
