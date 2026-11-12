import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Which address a request comes from, for per-client rate limiting.
 *
 * A forwarded client-IP header is honoured only when the TCP peer itself is a
 * trusted proxy. Any other peer is the client, whatever headers it sends, so a
 * spoofed `X-Real-IP` from an ordinary client cannot pick someone else's (or a
 * fresh) rate-limit bucket.
 *
 * A trusted proxy is an IP address, a CIDR range, or a host name. A host name
 * exists for the Docker routes: there the gateway is the Compose service `web`
 * on the project network, whose container address is assigned by Docker and
 * changes when the container is recreated. The name is resolved through the
 * runtime's resolver (Docker's embedded DNS, which only answers for containers
 * on the same network) and re-resolved when it ages or an unknown peer shows
 * up, so a recreated gateway is recognised without restarting the API.
 */

export type HostnameResolver = (hostname: string) => Promise<readonly string[]>;

export type ClientAddressHeaders = Readonly<Record<string, string | string[] | undefined>>;

export interface ClientAddressResolver {
  /** Header names the resolved client address is handed on in, first one preferred. */
  readonly headerNames: readonly string[];
  /** The client address, or null when the request has no usable peer address. */
  resolve(peerAddress: string | undefined, headers: ClientAddressHeaders): Promise<string | null>;
}

const hostnamePattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** A DNS host name that is not an IP literal (an all-digit last label would read like one). */
export function isTrustedProxyHostname(value: string): boolean {
  if (isIP(value) !== 0 || !hostnamePattern.test(value)) return false;
  const labels = value.split(".");
  return !/^[0-9]+$/.test(labels[labels.length - 1]!);
}

/** An IP address or an `address/prefix` CIDR range with a prefix valid for its family. */
export function isTrustedProxyNetwork(value: string): boolean {
  const separator = value.lastIndexOf("/");
  if (separator === -1) return isIP(value) !== 0;
  const family = isIP(value.slice(0, separator));
  const prefix = value.slice(separator + 1);
  const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= maximum;
}

export function isValidTrustedProxy(value: string): boolean {
  return isTrustedProxyNetwork(value) || isTrustedProxyHostname(value);
}

/** Plain textual form: IPv4-mapped IPv6 (`::ffff:192.0.2.1`) becomes IPv4, IPv6 lower-case. */
export function normalizeAddress(value: string | undefined): string | null {
  if (value === undefined) return null;
  let address = value.trim();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const mapped = /^::ffff:([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/i.exec(address);
  if (mapped !== null) address = mapped[1]!;
  const family = isIP(address);
  if (family === 0) return null;
  return family === 6 ? address.toLowerCase() : address;
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 4 ? "ipv4" : "ipv6";
}

const defaultResolver: HostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export function createClientAddressResolver(options: Readonly<{
  headerNames: readonly string[];
  trustedProxies: readonly string[];
  resolveHostname?: HostnameResolver;
  nowMs?: () => number;
  /** How long a resolved host name is reused before it is looked up again. */
  hostnameTtlMs?: number;
  /** An unknown peer re-resolves the host names at most this often. */
  unknownPeerRefreshMs?: number;
}>): ClientAddressResolver {
  const invalid = options.trustedProxies.filter((value) => !isValidTrustedProxy(value));
  if (invalid.length > 0) throw new Error("trusted proxy addresses are invalid");
  const headerNames = options.headerNames.map((name) => name.toLowerCase());
  const networks = new BlockList();
  const hostnames: string[] = [];
  for (const entry of options.trustedProxies) {
    if (isTrustedProxyHostname(entry)) {
      hostnames.push(entry);
      continue;
    }
    const separator = entry.lastIndexOf("/");
    if (separator === -1) {
      const address = normalizeAddress(entry)!;
      networks.addAddress(address, familyOf(address));
    } else {
      const address = normalizeAddress(entry.slice(0, separator))!;
      networks.addSubnet(address, Number(entry.slice(separator + 1)), familyOf(address));
    }
  }
  const resolveHostname = options.resolveHostname ?? defaultResolver;
  const nowMs = options.nowMs ?? Date.now;
  const ttlMs = options.hostnameTtlMs ?? 30_000;
  const unknownPeerRefreshMs = options.unknownPeerRefreshMs ?? 1_000;
  let resolved = new Set<string>();
  let resolvedAtMs = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    pending ??= (async () => {
      const next = new Set<string>();
      for (const hostname of hostnames) {
        try {
          for (const address of await resolveHostname(hostname)) {
            const normalized = normalizeAddress(address);
            if (normalized !== null) next.add(normalized);
          }
        } catch {
          // Fail closed: an unresolvable gateway name trusts nobody; the peer
          // address is then used as the client address.
        }
      }
      resolved = next;
      resolvedAtMs = nowMs();
    })().finally(() => { pending = null; });
    return pending;
  };

  const staticallyTrusted = (address: string): boolean =>
    networks.check(address, familyOf(address));

  const trusted = async (address: string): Promise<boolean> => {
    if (staticallyTrusted(address)) return true;
    if (hostnames.length === 0) return false;
    const age = nowMs() - resolvedAtMs;
    if (age >= ttlMs) await refresh();
    if (resolved.has(address)) return true;
    // A recreated gateway container gets a new address: look again, but only
    // occasionally, so untrusted peers cannot turn every request into a lookup.
    if (nowMs() - resolvedAtMs >= unknownPeerRefreshMs) {
      await refresh();
      return resolved.has(address);
    }
    return false;
  };

  const forwardedAddress = (headers: ClientAddressHeaders): string | null => {
    for (const name of headerNames) {
      const raw = headers[name];
      if (raw === undefined) continue;
      const value = Array.isArray(raw) ? raw.join(",") : raw;
      const hops = value.split(",").map((hop) => hop.trim()).filter((hop) => hop.length > 0);
      // Walk from the proxy side: the rightmost hop that is not itself a
      // trusted proxy is the client. A malformed hop ends the chain.
      for (let index = hops.length - 1; index >= 0; index -= 1) {
        const hop = normalizeAddress(hops[index]);
        if (hop === null) return null;
        if (!staticallyTrusted(hop)) return hop;
      }
      return null;
    }
    return null;
  };

  return {
    headerNames,
    async resolve(peerAddress, headers) {
      const peer = normalizeAddress(peerAddress);
      if (peer === null) return null;
      if (!(await trusted(peer))) return peer;
      return forwardedAddress(headers) ?? peer;
    },
  };
}
