import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLocalStackClient } from "./local-stack-http-client.mjs";

function certificate(directory, name) {
  const keyPath = join(directory, `${name}.key.pem`);
  const certPath = join(directory, `${name}.cert.pem`);
  const result = spawnSync(process.env.MK8DX_TEST_OPENSSL ?? "openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

test("local client trusts only its gateway certificate and retains cookies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mk8dx-local-stack-client-"));
  const trusted = certificate(directory, "trusted");
  const unrelated = certificate(directory, "unrelated");
  const seen = [];
  const server = createServer(trusted, (incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      seen.push({ method: incoming.method, headers: incoming.headers,
        body: Buffer.concat(chunks).toString("utf8") });
      outgoing.setHeader("content-type", "application/json");
      if (incoming.method === "GET") outgoing.setHeader("set-cookie", "session=local; HttpOnly");
      outgoing.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `https://127.0.0.1:${address.port}`;
    const client = createLocalStackClient(baseUrl, trusted);
    assert.equal((await client.call("GET", "/session")).body.ok, true);
    assert.equal(client.jar.get("session"), "local");
    assert.equal((await client.call("POST", "/write", { value: 1 }, "token", "csrf")).status, 200);
    assert.equal(seen[1].headers.cookie, "session=local");
    assert.equal(seen[1].headers.authorization, "Bearer token");
    assert.equal(seen[1].headers["x-mk8dx-csrf"], "csrf");
    assert.deepEqual(JSON.parse(seen[1].body), { value: 1 });
    await assert.rejects(createLocalStackClient(baseUrl, unrelated).call("GET", "/session"));
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  } finally {
    await new Promise((accept) => server.close(accept));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local client keeps the disposable plaintext mode", async () => {
  const server = createHttpServer((incoming, outgoing) => {
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ path: incoming.url }));
  });
  try {
    await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = createLocalStackClient(`http://127.0.0.1:${address.port}`, null);
    assert.deepEqual((await client.call("GET", "/ready")).body, { path: "/ready" });
  } finally {
    await new Promise((accept) => server.close(accept));
  }
});
