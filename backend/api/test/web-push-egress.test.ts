import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_PUSH_PROVIDER_HOSTS,
  WebPushEgressPolicy,
  isPublicUnicastAddress,
  parseWebPushProviderHosts,
} from "../src/notifications/web-push-egress.js";
import {
  GuardedHttpsWebPushTransport,
  WebPushTransportError,
  type WebPushAddress,
} from "../src/notifications/web-push-transport.js";

// Everything here is local: DNS answers are synthetic and every socket goes to
// a loopback fixture of this test. No request leaves the machine.

const realProviderEndpoints = [
  "https://fcm.googleapis.com/fcm/send/dGVzdA:APA91bExample",
  "https://fcm.googleapis.com/wp/dGVzdA:APA91bExample",
  "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexample",
  "https://web.push.apple.com/QGexampleToken",
  "https://wns2-par02p.notify.windows.com/w/?token=BQYAAABexample",
  "https://fcm.googleapis.com:443/fcm/send/explicit-default-port",
];

describe("Web Push egress policy", () => {
  const policy = new WebPushEgressPolicy();

  it("accepts the browsers' own push services", () => {
    for (const endpoint of realProviderEndpoints) {
      expect(policy.check(endpoint), endpoint).toHaveProperty("url");
    }
  });

  it.each([
    ["https://127.0.0.1/push", "invalid_endpoint"],
    ["https://[::1]/push", "invalid_endpoint"],
    ["https://10.0.0.5/push", "invalid_endpoint"],
    ["https://192.168.1.10/push", "invalid_endpoint"],
    ["https://169.254.169.254/latest/meta-data", "invalid_endpoint"],
    ["https://[::ffff:127.0.0.1]/push", "invalid_endpoint"],
    ["https://[::ffff:7f00:1]/push", "invalid_endpoint"],
    ["https://2130706433/push", "invalid_endpoint"], // decimal 127.0.0.1
    ["https://0x7f.1/push", "invalid_endpoint"],
    ["https://fcm.googleapis.com:8443/fcm/send/x", "invalid_endpoint"],
    ["https://fcm.googleapis.com:80/fcm/send/x", "invalid_endpoint"],
    ["http://fcm.googleapis.com/fcm/send/x", "invalid_endpoint"],
    // Userinfo, assembled so the repository scan does not take it for a stored credential.
    [["https://user", "secret@fcm.googleapis.com/fcm/send/x"].join(":"), "invalid_endpoint"],
    ["https://fcm.googleapis.com/fcm/send/x#fragment", "invalid_endpoint"],
    ["https://fcm.googleapis.com./fcm/send/x", "invalid_endpoint"],
    ["https://localhost/push", "invalid_endpoint"],
    ["https://push.internal.example/push", "provider_not_allowed"],
    ["https://fcm.googleapis.com.attacker.example/fcm/send/x", "provider_not_allowed"],
    ["https://evilnotify.windows.com/w/?token=x", "provider_not_allowed"],
    ["https://notify.windows.com/w/?token=x", "provider_not_allowed"],
    ["https://metadata.google.internal/computeMetadata/v1", "provider_not_allowed"],
  ])("refuses %s", (endpoint, refusal) => {
    expect(policy.check(endpoint)).toEqual({ refusal });
  });

  it("adds operator-configured providers without widening the rest", () => {
    const extended = new WebPushEgressPolicy(["push.community.example", "*.up.example.org"]);
    expect(extended.check("https://push.community.example/up/abc")).toHaveProperty("url");
    expect(extended.check("https://eu.up.example.org/up/abc")).toHaveProperty("url");
    expect(extended.check("https://up.example.org/up/abc")).toEqual({ refusal: "provider_not_allowed" });
    expect(extended.check("https://push.community.example:8443/up")).toEqual({ refusal: "invalid_endpoint" });
    expect(new WebPushEgressPolicy().check("https://push.community.example/up/abc"))
      .toEqual({ refusal: "provider_not_allowed" });
  });

  it.each([["*.com"], ["*"], ["10.0.0.1"], ["push.example.org:8443"], ["https://push.example.org"],
    ["push.example.org/path"], ["localhost"], ["*.*.example.org"], ["exa mple.org"]])(
    "refuses the operator provider entry %s", (entry) => {
      expect(() => parseWebPushProviderHosts([entry])).toThrow();
    });

  it("lists exactly the documented default providers", () => {
    expect(DEFAULT_WEB_PUSH_PROVIDER_HOSTS).toEqual([
      "fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "*.notify.windows.com",
    ]);
    expect(parseWebPushProviderHosts(" Push.Example.org , *.up.example.net ,"))
      .toEqual(["push.example.org", "*.up.example.net"]);
  });
});

describe("public unicast address classification", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.0.1", "198.18.0.1",
    "198.51.100.7", "203.0.113.9", "224.0.0.251", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:192.168.1.1",
    "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b:1::1", "fe80::1", "fe80::1%eth0",
    "fec0::1", "fc00::1", "fd12:3456::1", "ff02::1", "ff0e::1", "2001:db8::1", "2001::1", "2002:7f00:1::1",
    "3fff::1", "100::1", "not-an-address", "",
  ])("refuses %s", (address) => {
    expect(isPublicUnicastAddress(address)).toBe(false);
  });

  it.each([
    "142.250.180.10", "17.253.144.10", "34.117.1.1", "52.97.0.1", "8.8.8.8", "172.32.0.1", "100.128.0.1",
    "2a00:1450:4001:81c::200a", "2600:1901:0:92a9::", "::ffff:142.250.180.10", "64:ff9b::8efa:b40a",
  ])("accepts %s", (address) => {
    expect(isPublicUnicastAddress(address)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The transport against loopback fixtures. The test policy treats 127.0.0.1 as
// the one "public" address; everything else keeps the production rule.

const providerName = "push.fixture.example";
const fixturePolicy = new WebPushEgressPolicy([providerName]);
const servers: Array<Server | ReturnType<typeof createTcpServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  })));
});

async function listen<T extends Server | ReturnType<typeof createTcpServer>>(server: T): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as { port: number }).port;
}

function resolverReturning(...answers: ReadonlyArray<readonly WebPushAddress[]>) {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    resolve: async (hostname: string): Promise<readonly WebPushAddress[]> => {
      calls.push(hostname);
      const answer = answers[Math.min(index, answers.length - 1)]!;
      index += 1;
      return answer;
    },
  };
}

function plainTransport(port: number, resolve: (hostname: string) => Promise<readonly WebPushAddress[]>,
  extra: Partial<ConstructorParameters<typeof GuardedHttpsWebPushTransport>[0]> = {}) {
  return new GuardedHttpsWebPushTransport({
    policy: fixturePolicy,
    resolve,
    isAllowedAddress: (address) => address === "127.0.0.1" || isPublicUnicastAddress(address),
    request: httpRequest,
    port,
    deadlineMs: 300,
    maxResponseBytes: 1024,
    ...extra,
  });
}

const push = { endpoint: `https://${providerName}/push/1`, headers: { TTL: 60 }, body: Buffer.from("cipher") };
const loopback: WebPushAddress = { address: "127.0.0.1", family: 4 };

async function failure(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) {
    if (error instanceof WebPushTransportError) return error.failure;
    throw error;
  }
  throw new Error("expected a transport failure");
}

describe("guarded Web Push transport", () => {
  it("resolves once, connects to that checked address and keeps the provider's name", async () => {
    const seen: Array<{ host: string | undefined; path: string | undefined; length: number }> = [];
    const port = await listen(createHttpServer((request, response) => {
      let length = 0;
      request.on("data", (chunk: Buffer) => { length += chunk.byteLength; });
      request.on("end", () => {
        seen.push({ host: request.headers.host, path: request.url, length });
        response.writeHead(201).end();
      });
    }));
    const dns = resolverReturning([loopback]);
    await expect(plainTransport(port, dns.resolve).send(push)).resolves.toEqual({ statusCode: 201 });
    expect(dns.calls).toEqual([providerName]);
    expect(seen).toEqual([{ host: `${providerName}:${port}`, path: "/push/1", length: 6 }]);
  });

  it.each([
    [[{ address: "10.0.0.7", family: 4 }]],
    [[{ address: "169.254.169.254", family: 4 }]],
    [[{ address: "::1", family: 6 }]],
    [[{ address: "::ffff:127.0.0.2", family: 6 }]],
    [[{ address: "64:ff9b::a00:1", family: 6 }]],
    [[{ address: "fd00::1", family: 6 }]],
    [[loopback, { address: "192.168.1.1", family: 4 }]],
  ] as Array<[WebPushAddress[]]>)("refuses a name resolving to %j before any connection", async (answer) => {
    let connections = 0;
    const port = await listen(createTcpServer((socket) => { connections += 1; socket.destroy(); }));
    const dns = resolverReturning(answer);
    expect(await failure(plainTransport(port, dns.resolve).send(push))).toBe("destination_refused");
    expect(connections).toBe(0);
    expect(dns.calls).toHaveLength(1);
  });

  it("checks the answer of every request, so a DNS change to a private address is refused", async () => {
    let requests = 0;
    const port = await listen(createHttpServer((_request, response) => {
      requests += 1;
      response.writeHead(201).end();
    }));
    const dns = resolverReturning([loopback], [{ address: "10.0.0.1", family: 4 }]);
    const transport = plainTransport(port, dns.resolve);
    await expect(transport.send(push)).resolves.toEqual({ statusCode: 201 });
    expect(await failure(transport.send(push))).toBe("destination_refused");
    expect(requests).toBe(1);
    expect(dns.calls).toHaveLength(2);
  });

  it("refuses endpoints outside the policy without resolving them", async () => {
    const dns = resolverReturning([loopback]);
    const transport = plainTransport(1, dns.resolve);
    expect(await failure(transport.send({ ...push, endpoint: "https://127.0.0.1/push" }))).toBe("invalid_endpoint");
    expect(await failure(transport.send({ ...push, endpoint: "https://internal.example/push" })))
      .toBe("provider_not_allowed");
    expect(await failure(transport.send({ ...push, endpoint: `https://${providerName}:8443/push` })))
      .toBe("invalid_endpoint");
    expect(dns.calls).toEqual([]);
  });

  it("aborts a hanging endpoint at the deadline and closes its socket", async () => {
    const closed: Promise<void>[] = [];
    const port = await listen(createTcpServer((socket: Socket) => {
      // Read (and discard) so the fixture notices when the client closes.
      socket.resume();
      closed.push(new Promise((resolve) => socket.on("close", () => resolve())));
    }));
    const started = Date.now();
    expect(await failure(plainTransport(port, resolverReturning([loopback]).resolve).send(push))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
    await Promise.race([Promise.all(closed), new Promise((_, reject) => setTimeout(() => reject(new Error("socket left open")), 2_000))]);
    expect(closed).toHaveLength(1);
  });

  it("aborts a slow chunked response at the same deadline", async () => {
    let socketClosed = false;
    const port = await listen(createHttpServer((request, response) => {
      request.socket.on("close", () => { socketClosed = true; });
      response.writeHead(201, { "content-type": "text/plain" });
      const timer = setInterval(() => { response.write("x"); }, 50);
      response.on("close", () => clearInterval(timer));
    }));
    expect(await failure(plainTransport(port, resolverReturning([loopback]).resolve).send(push))).toBe("timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(socketClosed).toBe(true);
  });

  it("reads only a bounded part of a large error body", async () => {
    let written = 0;
    let socketClosed = false;
    const port = await listen(createHttpServer((request, response) => {
      request.socket.on("close", () => { socketClosed = true; });
      response.writeHead(500, { "content-type": "text/plain" });
      const chunk = Buffer.alloc(16 * 1024, 120);
      const pump = (): void => {
        while (written < 64 * 1024 * 1024) {
          written += chunk.byteLength;
          if (!response.write(chunk)) { response.once("drain", pump); return; }
        }
        response.end();
      };
      response.on("close", () => { written = Math.max(written, 0); });
      pump();
    }));
    await expect(plainTransport(port, resolverReturning([loopback]).resolve, { deadlineMs: 5_000 }).send(push))
      .resolves.toEqual({ statusCode: 500 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(socketClosed).toBe(true);
    expect(written).toBeLessThan(64 * 1024 * 1024);
  });

  it("never follows a redirect", async () => {
    let requests = 0;
    const port = await listen(createHttpServer((_request, response) => {
      requests += 1;
      response.writeHead(307, { location: "http://127.0.0.1:1/internal" }).end();
    }));
    await expect(plainTransport(port, resolverReturning([loopback]).resolve).send(push))
      .resolves.toEqual({ statusCode: 307 });
    expect(requests).toBe(1);
  });

  it("reports a failed lookup", async () => {
    const transport = plainTransport(1, async () => { throw new Error("NXDOMAIN"); });
    expect(await failure(transport.send(push))).toBe("dns_failed");
    expect(await failure(plainTransport(1, async () => []).send(push))).toBe("dns_failed");
  });
});

// Real TLS against a throwaway certificate, generated per run (never stored).
let openssl = true;
try { execFileSync("openssl", ["version"], { stdio: "ignore" }); } catch { openssl = false; }

describe.skipIf(!openssl)("guarded Web Push transport over TLS", () => {
  function certificate(name: string): { directory: string; key: string; cert: string } {
    const directory = mkdtempSync(join(tmpdir(), "mk8dx-push-tls-"));
    const config = join(directory, "openssl.cnf");
    writeFileSync(config, `[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ext\n[dn]\nCN=${name}\n[ext]\nsubjectAltName=DNS:${name}\nbasicConstraints=critical,CA:TRUE\n`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", "1", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
      "-config", config], { stdio: "ignore" });
    return {
      directory,
      key: readFileSync(join(directory, "key.pem"), "utf8"),
      cert: readFileSync(join(directory, "cert.pem"), "utf8"),
    };
  }

  it("verifies the certificate for the provider's name, sent as SNI", async () => {
    const tls = certificate(providerName);
    const wrong = certificate("other.fixture.example");
    try {
      const names: Array<string | false> = [];
      const port = await listen(createHttpsServer({ key: tls.key, cert: tls.cert }, (request, response) => {
        names.push((request.socket as { servername?: string | false }).servername ?? false);
        response.writeHead(201).end();
      }) as unknown as Server);
      const base = {
        policy: fixturePolicy,
        resolve: resolverReturning([loopback]).resolve,
        isAllowedAddress: (address: string) => address === "127.0.0.1",
        port,
        deadlineMs: 3_000,
      };
      // No trust in the fixture's certificate: strict verification refuses it.
      expect(await failure(new GuardedHttpsWebPushTransport(base).send(push))).toBe("tls_failed");
      // A trusted certificate issued for another name is refused too.
      const otherPort = await listen(createHttpsServer({ key: wrong.key, cert: wrong.cert }, (_request, response) => {
        response.writeHead(201).end();
      }) as unknown as Server);
      expect(await failure(new GuardedHttpsWebPushTransport({ ...base, port: otherPort, ca: wrong.cert }).send(push)))
        .toBe("tls_failed");
      await expect(new GuardedHttpsWebPushTransport({ ...base, ca: tls.cert }).send(push))
        .resolves.toEqual({ statusCode: 201 });
      expect(names).toEqual([providerName]);
    } finally {
      rmSync(tls.directory, { recursive: true, force: true });
      rmSync(wrong.directory, { recursive: true, force: true });
    }
  });
});
