import {
  createWebManualSubmission,
  type WebManualSubmissionInput,
} from "./manual-submission.js";

/** Everything the submission builder needs except the values the form supplies. */
export type WebManualSubmissionContext = Omit<
  WebManualSubmissionInput,
  "mode" | "timeDigits"
>;


const contextSchemaVersion = "mk8dx.web-manual-context.v1";

export class WebManualContextDocumentError extends Error {
  public constructor() {
    super("Web manual context document is invalid.");
    this.name = "WebManualContextDocumentError";
  }
}

function fail(): never {
  throw new WebManualContextDocumentError();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

export function parseWebManualContextDocument(
  document: unknown,
): WebManualSubmissionContext {
  if (!isObject(document) || !exactKeys(document, [
    "schemaVersion",
    "submissionId",
    "revision",
    "trackId",
    "playerReference",
    "producer",
    "timestamps",
  ], ["countryId", "observedPlayerName"]) ||
    document.schemaVersion !== contextSchemaVersion ||
    !isObject(document.producer) ||
    !exactKeys(document.producer, ["version"], ["localRecordId"]) ||
    !isObject(document.timestamps) ||
    !exactKeys(document.timestamps, ["createdAtMs"], ["occurredAtMs"])) {
    fail();
  }

  try {
    const submission = createWebManualSubmission({
      submissionId: document.submissionId,
      revision: document.revision,
      mode: 150,
      trackId: document.trackId,
      timeDigits: "100000",
      playerReference: document.playerReference,
      ...(Object.hasOwn(document, "countryId")
        ? { countryId: document.countryId }
        : {}),
      ...(Object.hasOwn(document, "observedPlayerName")
        ? { observedPlayerName: document.observedPlayerName }
        : {}),
      ...(Object.hasOwn(document.timestamps, "occurredAtMs")
        ? { occurredAtMs: document.timestamps.occurredAtMs }
        : {}),
      createdAtMs: document.timestamps.createdAtMs,
      producerVersion: document.producer.version,
      ...(Object.hasOwn(document.producer, "localRecordId")
        ? { localRecordId: document.producer.localRecordId }
        : {}),
    });

    return {
      submissionId: submission.submissionId,
      revision: submission.revision,
      trackId: submission.trackId,
      playerReference: {
        ...submission.playerReference,
      },
      ...(submission.countryId === undefined
        ? {}
        : { countryId: submission.countryId }),
      ...(submission.observedPlayerName === undefined
        ? {}
        : { observedPlayerName: submission.observedPlayerName }),
      ...(submission.timestamps.occurredAtMs === undefined
        ? {}
        : { occurredAtMs: submission.timestamps.occurredAtMs }),
      createdAtMs: submission.timestamps.createdAtMs,
      producerVersion: submission.source.producerVersion,
      ...(submission.source.localRecordId === undefined
        ? {}
        : { localRecordId: submission.source.localRecordId }),
    };
  } catch {
    fail();
  }
}
