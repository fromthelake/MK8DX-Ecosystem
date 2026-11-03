// Privacy-safe structured operational logging for shared-hosting production.
//
// Events carry only fixed event names, route PATTERNS (never raw URLs, query
// strings, headers, or bodies), status codes, durations, correlation request
// ids, and error CLASS names. Tokens, magic links, identifiers, evidence
// content, and error message text never enter the sink.

export type OperationalEvent = Readonly<{
  event: string;
  category: "lifecycle" | "request" | "readiness";
  requestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  errorName?: string;
  detail?: string;
}>;

export interface OperationalLogSink {
  log(event: OperationalEvent): void;
}

const eventNamePattern = /^[a-z0-9_]{1,64}$/;
const boundedDetailPattern = /^[A-Za-z0-9 ._:\/-]{1,160}$/;

export class JsonLineOperationalLog implements OperationalLogSink {
  public constructor(
    private readonly stream: Readonly<{ write(chunk: string): unknown }>,
    private readonly clock: Readonly<{ nowMs(): number }> = {
      nowMs: () => Date.now(),
    },
  ) {}

  public log(event: OperationalEvent): void {
    if (!eventNamePattern.test(event.event)) {
      return;
    }
    const record: Record<string, unknown> = {
      timeMs: this.clock.nowMs(),
      event: event.event,
      category: event.category,
    };
    if (event.requestId !== undefined && /^[A-Za-z0-9_-]{1,32}$/.test(event.requestId)) {
      record["requestId"] = event.requestId;
    }
    if (event.method !== undefined && /^[A-Z]{1,10}$/.test(event.method)) {
      record["method"] = event.method;
    }
    if (event.route !== undefined && boundedDetailPattern.test(event.route)) {
      record["route"] = event.route;
    }
    if (event.statusCode !== undefined && Number.isSafeInteger(event.statusCode)) {
      record["statusCode"] = event.statusCode;
    }
    if (event.durationMs !== undefined && Number.isFinite(event.durationMs)) {
      record["durationMs"] = Math.round(event.durationMs);
    }
    if (event.errorName !== undefined &&
      /^[A-Za-z0-9_]{1,64}$/.test(event.errorName)) {
      record["errorName"] = event.errorName;
    }
    if (event.detail !== undefined && boundedDetailPattern.test(event.detail)) {
      record["detail"] = event.detail;
    }
    try {
      this.stream.write(`${JSON.stringify(record)}\n`);
    } catch {
      // Logging must never break request handling.
    }
  }
}

export const noopOperationalLog: OperationalLogSink = {
  log(): void {
    // Deliberately silent.
  },
};
