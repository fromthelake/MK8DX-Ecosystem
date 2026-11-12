import { describe, expect, it } from "vitest";

import {
  createClientAddressResolver,
  isValidTrustedProxy,
  normalizeAddress,
} from "../src/security/client-address.js";

const headers = (value: string) => ({ "x-real-ip": value });

describe("client address resolution", () => {
  it("validates trusted proxy entries: IPs, CIDRs and Compose-style host names only", () => {
    for (const valid of ["127.0.0.1", "::1", "172.27.0.0/16", "fd00::/8", "web", "gateway.internal"]) {
      expect(isValidTrustedProxy(valid)).toBe(true);
    }
    for (const invalid of ["", "127.0.0.1/99", "10.0.0.0/x", "1.2.3", "web_1", "-web", "a b", "*", "0.0.0.0/0x",
      "http://web", "web:80"]) {
      expect(isValidTrustedProxy(invalid)).toBe(false);
    }
    expect(() => createClientAddressResolver({ headerNames: ["x-real-ip"], trustedProxies: ["web:80"] }))
      .toThrow();
  });

  it("normalizes IPv4-mapped IPv6 peers", () => {
    expect(normalizeAddress("::ffff:172.27.0.5")).toBe("172.27.0.5");
    expect(normalizeAddress("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeAddress("not-an-ip")).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
  });

  it("ignores a spoofed header from an untrusted peer and honours a trusted one", async () => {
    const resolver = createClientAddressResolver({ headerNames: ["x-real-ip"], trustedProxies: ["127.0.0.1"] });
    expect(await resolver.resolve("192.168.0.50", headers("203.0.113.9"))).toBe("192.168.0.50");
    expect(await resolver.resolve("127.0.0.1", headers("203.0.113.9"))).toBe("203.0.113.9");
    expect(await resolver.resolve("::ffff:127.0.0.1", headers("203.0.113.9"))).toBe("203.0.113.9");
    // Trusted peer without (or with a malformed) header: the peer is the client.
    expect(await resolver.resolve("127.0.0.1", {})).toBe("127.0.0.1");
    expect(await resolver.resolve("127.0.0.1", headers("garbage"))).toBe("127.0.0.1");
    expect(await resolver.resolve(undefined, headers("203.0.113.9"))).toBeNull();
  });

  it("takes the rightmost untrusted hop of a forwarded chain", async () => {
    const resolver = createClientAddressResolver({ headerNames: ["x-real-ip"], trustedProxies: ["10.0.0.0/8"] });
    expect(await resolver.resolve("10.1.1.1", headers("198.51.100.1, 203.0.113.9, 10.2.2.2"))).toBe("203.0.113.9");
    expect(await resolver.resolve("10.1.1.1", headers("203.0.113.9, junk"))).toBe("10.1.1.1");
    expect(await resolver.resolve("10.1.1.1", headers("10.3.3.3"))).toBe("10.1.1.1");
  });

  it("trusts exactly the address a gateway host name resolves to, never its neighbours", async () => {
    const lookups: string[] = [];
    const resolver = createClientAddressResolver({
      headerNames: ["x-real-ip"],
      trustedProxies: ["web"],
      resolveHostname: async (name) => { lookups.push(name); return ["172.27.0.5"]; },
    });
    expect(await resolver.resolve("172.27.0.5", headers("192.168.0.20"))).toBe("192.168.0.20");
    // Another container (or the bridge gateway) on the same network is not the proxy.
    expect(await resolver.resolve("172.27.0.3", headers("192.168.0.21"))).toBe("172.27.0.3");
    expect(await resolver.resolve("172.27.0.1", headers("192.168.0.21"))).toBe("172.27.0.1");
    expect(lookups.length).toBeGreaterThanOrEqual(1);
  });

  it("follows a recreated gateway to its new address, with bounded lookups", async () => {
    let now = 0;
    let address = "172.27.0.5";
    let lookups = 0;
    const resolver = createClientAddressResolver({
      headerNames: ["x-real-ip"],
      trustedProxies: ["web"],
      nowMs: () => now,
      resolveHostname: async () => { lookups += 1; return [address]; },
    });
    expect(await resolver.resolve("172.27.0.5", headers("192.168.0.20"))).toBe("192.168.0.20");
    expect(lookups).toBe(1);
    address = "172.27.0.9";
    // Within the unknown-peer refresh interval nothing is looked up again.
    expect(await resolver.resolve("172.27.0.9", headers("192.168.0.20"))).toBe("172.27.0.9");
    expect(lookups).toBe(1);
    now = 1_500;
    expect(await resolver.resolve("172.27.0.9", headers("192.168.0.20"))).toBe("192.168.0.20");
    expect(lookups).toBe(2);
    expect(await resolver.resolve("172.27.0.5", headers("192.168.0.20"))).toBe("172.27.0.5");
  });

  it("fails closed when the gateway name cannot be resolved", async () => {
    const resolver = createClientAddressResolver({
      headerNames: ["x-real-ip"],
      trustedProxies: ["web"],
      resolveHostname: async () => { throw new Error("ENOTFOUND"); },
    });
    expect(await resolver.resolve("172.27.0.5", headers("192.168.0.20"))).toBe("172.27.0.5");
  });
});
