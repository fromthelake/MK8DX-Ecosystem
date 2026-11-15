import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";

import { isPublicUnicastAddress, type WebPushEgressPolicy } from "./web-push-egress.js";

/** One prepared Web Push request: the encrypted body and its headers. */
export type WebPushRequest = Readonly<{
  endpoint: string;
  headers: Readonly<Record<string, string | number>>;
  body: Uint8Array | null;
}>;

export type WebPushTransportFailure =
  | "provider_not_allowed" | "invalid_endpoint" | "destination_refused" | "dns_failed"
  | "timeout" | "tls_failed" | "transport_failed";

export class WebPushTransportError extends Error {
  public constructor(public readonly failure: WebPushTransportFailure) {
    super("The Web Push request was not completed.");
    this.name = "WebPushTransportError";
  }
}

export interface WebPushTransport {
  /** Resolves with the provider's HTTP status; rejects with WebPushTransportError. */
  send(request: WebPushRequest): Promise<Readonly<{ statusCode: number }>>;
}

export type WebPushAddress = Readonly<{ address: string; family: 4 | 6 }>;
export type WebPushResolver = (hostname: string) => Promise<readonly WebPushAddress[]>;

export const defaultWebPushResolver: WebPushResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));

export type GuardedHttpsTransportOptions = Readonly<{
  policy: WebPushEgressPolicy;
  resolve?: WebPushResolver;
  /** Whole-request deadline: DNS, connect, TLS, upload and response. */
  deadlineMs?: number;
  /** Response bytes read before the connection is closed. */
  maxResponseBytes?: number;
  /**
   * Test seams. `isAllowedAddress` lets a loopback fixture stand in for a
   * provider and `request`/`ca` let it use a local server; production never
   * sets them.
   */
  isAllowedAddress?: (address: string) => boolean;
  request?: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  ca?: string | Buffer;
  port?: number;
}>;

export const WEB_PUSH_REQUEST_DEADLINE_MS = 10_000;
export const WEB_PUSH_MAX_RESPONSE_BYTES = 16 * 1024;

const tlsErrorCodes = new Set([
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
]);

/**
 * Sends a Web Push request without trusting the endpoint's DNS twice.
 *
 * The host must pass the egress policy. Its name is resolved once, inside the
 * socket's own lookup, every returned address must be public unicast, and the
 * socket connects to exactly those checked addresses. TLS keeps the original
 * name for SNI and certificate verification, so a rebinding answer can neither
 * slip a private address in after the check nor present another certificate.
 * Redirects are never followed, every request has one hard deadline that
 * destroys the socket, and only a bounded number of response bytes is read.
 */
export class GuardedHttpsWebPushTransport implements WebPushTransport {
  private readonly resolve: WebPushResolver;
  private readonly deadlineMs: number;
  private readonly maxResponseBytes: number;
  private readonly allowed: (address: string) => boolean;

  public constructor(private readonly options: GuardedHttpsTransportOptions) {
    this.resolve = options.resolve ?? defaultWebPushResolver;
    this.deadlineMs = options.deadlineMs ?? WEB_PUSH_REQUEST_DEADLINE_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? WEB_PUSH_MAX_RESPONSE_BYTES;
    this.allowed = options.isAllowedAddress ?? isPublicUnicastAddress;
  }

  public send(request: WebPushRequest): Promise<Readonly<{ statusCode: number }>> {
    const checked = this.options.policy.check(request.endpoint);
    if ("refusal" in checked) {
      return Promise.reject(new WebPushTransportError(checked.refusal));
    }
    const url = checked.url;
    if (isIP(url.hostname) !== 0) {
      return Promise.reject(new WebPushTransportError("invalid_endpoint"));
    }
    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let refusal: WebPushTransportFailure | null = null;
      const controller = new AbortController();
      const finish = (outcome: Readonly<{ statusCode: number }> | WebPushTransportError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (outcome instanceof WebPushTransportError) rejectPromise(outcome);
        else resolvePromise(outcome);
      };
      const deadline = setTimeout(() => {
        refusal ??= "timeout";
        controller.abort();
        pending.destroy();
        finish(new WebPushTransportError("timeout"));
      }, this.deadlineMs);

      const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
        this.resolve(hostname).then((addresses) => {
          const family = typeof lookupOptions === "object" ? lookupOptions.family : undefined;
          const candidates = addresses.filter((entry) =>
            family === undefined || family === 0 || entry.family === family);
          if (candidates.length === 0) {
            refusal = "dns_failed";
            callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), "", 4);
            return;
          }
          // Every answer must be public: a mixed answer is a rebinding signal.
          if (!candidates.every((entry) => this.allowed(entry.address))) {
            refusal = "destination_refused";
            callback(Object.assign(new Error("destination refused"), { code: "EADDRNOTAVAIL" }), "", 4);
            return;
          }
          if (typeof lookupOptions === "object" && lookupOptions.all === true) {
            (callback as unknown as (error: null, addresses: WebPushAddress[]) => void)(
              null, candidates.map((entry) => ({ address: entry.address, family: entry.family })));
          } else {
            callback(null, candidates[0]!.address, candidates[0]!.family);
          }
        }, () => {
          refusal = "dns_failed";
          callback(Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" }), "", 4);
        });
      };

      const send = this.options.request ?? httpsRequest;
      const pending = send({
        hostname: url.hostname,
        port: this.options.port ?? 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...request.headers },
        lookup,
        servername: url.hostname,
        rejectUnauthorized: true,
        // A fresh connection per request: no pooled socket outlives its check.
        agent: false,
        signal: controller.signal,
        ...(this.options.ca === undefined ? {} : { ca: this.options.ca }),
      }, (response) => {
        const statusCode = response.statusCode ?? 0;
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > this.maxResponseBytes) {
            // The status is all the worker needs; stop reading and close.
            finish({ statusCode });
            controller.abort();
            response.destroy();
            pending.destroy();
          }
        });
        response.on("end", () => { finish({ statusCode }); });
        response.on("error", () => {
          finish(new WebPushTransportError(refusal ?? "transport_failed"));
        });
        response.on("close", () => {
          if (!response.complete) finish(new WebPushTransportError(refusal ?? "transport_failed"));
        });
      });
      pending.on("error", (error: NodeJS.ErrnoException) => {
        const code = typeof error.code === "string" ? error.code : "";
        finish(new WebPushTransportError(
          refusal ?? (tlsErrorCodes.has(code) || code.startsWith("ERR_TLS") ||
            code.startsWith("ERR_SSL") ? "tls_failed" : "transport_failed"),
        ));
      });
      if (request.body !== null) pending.write(request.body);
      pending.end();
    });
  }
}
