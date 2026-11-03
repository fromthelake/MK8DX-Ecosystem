import { WebManualContextDocumentError } from
  "./manual-context-document.js";


export const WEB_MANUAL_CONTEXT_JSON_MAX_BYTES = 16_384;

export function decodeWebManualContextJson(value: unknown): unknown {
  if (typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength >
      WEB_MANUAL_CONTEXT_JSON_MAX_BYTES) {
    throw new WebManualContextDocumentError();
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new WebManualContextDocumentError();
  }
}
