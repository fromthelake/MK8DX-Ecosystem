import { isIP } from "node:net";

/**
 * Where the delivery worker may send a Web Push request.
 *
 * A subscription endpoint is chosen by the browser, but a modified client can
 * send any URL. The server therefore only talks to the browser push services
 * (plus hosts the operator names explicitly), only on port 443, and only to a
 * public unicast address that it resolved and checked itself.
 */

/** The push services of the browsers the product supports. */
export const DEFAULT_WEB_PUSH_PROVIDER_HOSTS: readonly string[] = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Opera, Brave, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox (autopush)
  "web.push.apple.com", // Safari on macOS and iOS/iPadOS home-screen apps
  "*.notify.windows.com", // Edge on Windows (WNS)
];

export class WebPushProviderConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebPushProviderConfigurationError";
  }
}

const labelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function validHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253 || isIP(value) !== 0) return false;
  const labels = value.split(".");
  // A provider is a registered name with at least a domain and a top-level label.
  return labels.length >= 2 && labels.every((label) => labelPattern.test(label)) &&
    !/^[0-9]+$/.test(labels[labels.length - 1]!);
}

/**
 * Parses a provider host list: exact names (`push.example.org`) or a wildcard
 * for subdomains (`*.push.example.org`, which does not match the bare name).
 * Ports, paths, IP literals and too-broad wildcards such as `*.com` are refused.
 */
export function parseWebPushProviderHosts(value: string | readonly string[]): readonly string[] {
  const entries = (typeof value === "string" ? value.split(",") : [...value])
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (entries.length > 32) {
    throw new WebPushProviderConfigurationError("at most 32 extra Web Push provider hosts are allowed");
  }
  for (const entry of entries) {
    const host = entry.startsWith("*.") ? entry.slice(2) : entry;
    if (!validHostname(host) || (entry.startsWith("*.") && host.split(".").length < 2)) {
      throw new WebPushProviderConfigurationError("a Web Push provider host is invalid");
    }
  }
  return entries;
}

export type WebPushEndpointRefusal = "invalid_endpoint" | "provider_not_allowed";

export class WebPushEgressPolicy {
  private readonly exact = new Set<string>();
  private readonly suffixes: string[] = [];

  public constructor(extraProviderHosts: readonly string[] = []) {
    for (const entry of [...DEFAULT_WEB_PUSH_PROVIDER_HOSTS, ...parseWebPushProviderHosts(extraProviderHosts)]) {
      if (entry.startsWith("*.")) this.suffixes.push(entry.slice(1));
      else this.exact.add(entry);
    }
  }

  /** The parsed endpoint when the server may deliver to it, otherwise the reason it may not. */
  public check(endpoint: string): Readonly<{ url: URL }> | Readonly<{ refusal: WebPushEndpointRefusal }> {
    let url: URL;
    try { url = new URL(endpoint); } catch { return { refusal: "invalid_endpoint" }; }
    if (endpoint.length > 2048 || url.protocol !== "https:" || url.username !== "" ||
        url.password !== "" || url.hash !== "" || endpoint.includes("#") ||
        (url.port !== "" && url.port !== "443")) {
      return { refusal: "invalid_endpoint" };
    }
    const host = url.hostname;
    if (host.startsWith("[") || isIP(host) !== 0 || !validHostname(host)) {
      return { refusal: "invalid_endpoint" };
    }
    if (!this.exact.has(host) && !this.suffixes.some((suffix) => host.endsWith(suffix))) {
      return { refusal: "provider_not_allowed" };
    }
    return { url };
  }
}

// ---------------------------------------------------------------------------
// Address classification. Only public unicast destinations are permitted.

function ipv4Bits(address: string): bigint | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function ipv6Bits(input: string): bigint | null {
  let address = input.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) return null; // Zone identifiers only name link-local scopes.
  // An embedded dotted quad occupies the last two hextets.
  const lastColon = address.lastIndexOf(":");
  if (address.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4Bits(address.slice(lastColon + 1));
    if (v4 === null) return null;
    address = `${address.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

type Range = Readonly<{ base: bigint; prefix: number }>;

function range(address: string, prefix: number, bits: 32 | 128): Range {
  const base = bits === 32 ? ipv4Bits(address) : ipv6Bits(address);
  if (base === null) throw new Error(`invalid range ${address}`);
  return { base, prefix };
}

function inRange(value: bigint, bits: 32 | 128, candidate: Range): boolean {
  const shift = BigInt(bits - candidate.prefix);
  return (value >> shift) === (candidate.base >> shift);
}

// IANA special-purpose IPv4 registry, plus multicast and the reserved block.
const blockedIpv4: readonly Range[] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([address, prefix]) => range(address as string, prefix as number, 32));

const globalUnicastIpv6 = range("2000::", 3, 128);
const blockedIpv6: readonly Range[] = [
  ["2001::", 23], // IETF protocol assignments, including Teredo and ORCHID
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 relays can reach an arbitrary IPv4 address
  ["3fff::", 20], // documentation
].map(([address, prefix]) => range(address as string, prefix as number, 128));
const mappedIpv4 = range("::ffff:0:0", 96, 128);
const nat64WellKnown = range("64:ff9b::", 96, 128);

function publicIpv4(value: bigint): boolean {
  return !blockedIpv4.some((candidate) => inRange(value, 32, candidate));
}

/**
 * True only for a public unicast address. Loopback, private, shared,
 * link-local, multicast, unspecified, documentation, benchmarking and other
 * special-purpose ranges are refused, for IPv4 and IPv6. An IPv4-mapped or
 * NAT64 (64:ff9b::/96) address is judged by the IPv4 address it carries.
 */
export function isPublicUnicastAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Bits(address);
    return value !== null && publicIpv4(value);
  }
  if (family !== 6) return false;
  const value = ipv6Bits(address);
  if (value === null) return false;
  if (inRange(value, 128, mappedIpv4) || inRange(value, 128, nat64WellKnown)) {
    return publicIpv4(value & 0xffff_ffffn);
  }
  return inRange(value, 128, globalUnicastIpv6) &&
    !blockedIpv6.some((candidate) => inRange(value, 128, candidate));
}
