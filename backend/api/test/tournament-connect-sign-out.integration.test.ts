// The Tournament connection client (packages/tournament-connected) against the real hosted API over
// loopback HTTP with a disposable MySQL schema: browser device sign-in on the chosen community, then a
// confirmed sign-out that ends only that session. A second session of the same account keeps working.
// Synthetic account and keys only; the bearer never leaves the client process (it reports a hash).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";
import { createPasswordlessHostedRuntime } from "../src/composition/hosted-runtime.js";

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const python = process.env["MK8DX_TEST_PYTHON"] ?? (process.platform === "win32" ? "python" : "python3");

// Signs in with the real client (no browser), reports the user code and address, waits for "sign-out",
// then signs out with the real CLI and reports only a hash of the session it held.
const CLIENT_SCRIPT = String.raw`
import hashlib, json, sys
from mk8dx_tournament_connected import cli, client
from mk8dx_tournament_connected.session import SessionStore
store = SessionStore()
client.sign_in(store, open_browser=False,
               on_authorization=lambda code, url: print(json.dumps({"code": code, "url": url}), flush=True))
token = store.load()
print(json.dumps({"signedIn": hashlib.sha256(token.encode()).hexdigest()}), flush=True)
sys.stdin.readline()
status = cli.main(["sign-out"])
print(json.dumps({"exit": status, "stored": SessionStore().load() is not None}), flush=True)
`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

integration("Tournament connection sign-out against the real API", () => {
  let pool: Pool;
  const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
  const mysqlOptions = {
    host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
    port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
    user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
    password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
    database,
  };

  beforeAll(async () => {
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    pool = mysql.createPool({ ...mysqlOptions, timezone: "Z", connectionLimit: 2 });
  });

  afterAll(async () => {
    if (pool !== undefined) {
      for (const table of ["mk8dx_auth_audit_event", "mk8dx_auth_rate_limit", "mk8dx_auth_device_code",
        "mk8dx_auth_verification", "mk8dx_auth_account", "mk8dx_auth_session", "mk8dx_auth_user"]) {
        await pool.execute(`DELETE FROM ${table}`);
      }
      await pool.end();
    }
  });

  it("ends only the client's own session and reports it as confirmed", async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const delivered: PasswordlessMagicLink[] = [];
    const hosted = await createPasswordlessHostedRuntime({
      core: {
        mysql: { ...mysqlOptions, connectionLimit: 2 },
        schema9CatalogPath: `${repoRoot}packages/assets/schema9-asset-catalog-v1.json`,
        authenticationKeys: { lookupHmacKey: Buffer.alloc(32, 21), lookupKeyVersion: "s5-auth-v1" },
        timeTrialKeys: {
          encryptionKey: Buffer.alloc(32, 22), encryptionKeyVersion: "s5-tt-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 23), lookupKeyVersion: "s5-tt-lookup-v1",
        },
        timeTrialDecryptionKeys: { "s5-tt-enc-v1": Buffer.alloc(32, 22) },
        tournamentKeys: {
          encryptionKey: Buffer.alloc(32, 24), encryptionKeyVersion: "s5-tournament-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 25), lookupKeyVersion: "s5-tournament-lookup-v1",
        },
        tournamentDecryptionKeys: { "s5-tournament-enc-v1": Buffer.alloc(32, 24) },
      },
      authentication: {
        baseUrl,
        production: false,
        trustedOrigins: [baseUrl],
        secrets: [{ version: 1, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" }],
        nativeClientIds: [MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: [],
      },
      smtp: {
        host: "smtp.example.test", port: 465, secure: true, username: "synthetic-user",
        password: "synthetic-password", fromAddress: "auth@example.test", allowedLinkOrigin: baseUrl,
      },
      webManual: {
        producerVersion: "s5-sign-out-integration",
        csrfKeys: { activeKeyVersion: "s5-csrf-v1", keys: { "s5-csrf-v1": Buffer.alloc(32, 26) } },
      },
    }, () => ({
      async verify() {},
      async sendMagicLink(message) { delivered.push(message); },
      close() {},
    }));
    const home = mkdtempSync(join(tmpdir(), "mk8dx-s5-signout-"));
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      await hosted.app.listen({ host: "127.0.0.1", port });
      const json = { "content-type": "application/json" };
      const requested = await hosted.app.inject({
        method: "POST", url: "/api/auth/sign-in/magic-link",
        headers: { ...json, origin: baseUrl },
        payload: { email: "s5-director@example.test", callbackURL: "/" },
      });
      expect(requested.statusCode).toBe(200);
      const magic = new URL(delivered.at(-1)?.url ?? "");
      const redeemed = await hosted.app.inject({ method: "GET", url: `${magic.pathname}${magic.search}` });
      const setCookie = redeemed.headers["set-cookie"];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";
      expect(cookie).not.toBe("");
      const approve = async (userCode: string): Promise<void> => {
        const verify = await hosted.app.inject({
          method: "GET", url: `/api/auth/device?user_code=${encodeURIComponent(userCode)}`, headers: { cookie },
        });
        expect(verify.statusCode).toBe(200);
        const approved = await hosted.app.inject({
          method: "POST", url: "/api/auth/device/approve",
          headers: { ...json, origin: baseUrl, cookie }, payload: { userCode },
        });
        expect(approved.statusCode).toBe(200);
      };

      child = spawn(python, ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(
        join(repoRoot, "packages", "tournament-connected", "python", "src"))}); exec(${JSON.stringify(CLIENT_SCRIPT)})`], {
        env: {
          ...process.env,
          MK8DX_TOURNAMENT_API_ORIGIN: baseUrl,
          LOCALAPPDATA: home,
          HOME: home,
          NO_PROXY: "127.0.0.1,localhost",
          HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "",
        },
      });
      const stderr: string[] = [];
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      const nextJson = async (): Promise<Record<string, unknown>> => {
        for (;;) {
          const line = await lines.next();
          if (line.done) { throw new Error(`client ended early: ${stderr.join("")}`); }
          if (line.value.startsWith("{")) { return JSON.parse(line.value) as Record<string, unknown>; }
        }
      };

      // 1. The real device answer passes the client's validation: exact origin, /device, ?user_code.
      const shown = await nextJson();
      expect(shown["url"]).toBe(`${baseUrl}/device?user_code=${String(shown["code"])}`);
      await approve(String(shown["code"]));
      const signedIn = await nextJson();
      const clientHash = String(signedIn["signedIn"]);

      // 2. A second session of the same account (another device).
      const device = await hosted.app.inject({
        method: "POST", url: "/api/auth/device/code", headers: json,
        payload: { client_id: MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID },
      });
      const codes = device.json<{ device_code: string; user_code: string }>();
      await approve(codes.user_code);
      const token = await hosted.app.inject({
        method: "POST", url: "/api/auth/device/token", headers: json,
        payload: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: codes.device_code, client_id: MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
        },
      });
      const other = token.json<{ access_token: string }>().access_token;

      const [sessions] = await pool.execute<RowDataPacket[]>("SELECT token FROM mk8dx_auth_session");
      const clientToken = sessions.map((row) => String(row["token"]))
        .find((value) => createHash("sha256").update(value).digest("hex") === clientHash);
      if (clientToken === undefined) { throw new Error("client session not found"); }
      const bootstrap = async (bearer: string): Promise<number> => (await hosted.app.inject({
        method: "GET", url: "/v1/time-trial-submissions/native-bootstrap-v2",
        headers: { authorization: `Bearer ${bearer}` },
      })).statusCode;
      // 403 = authenticated without a Player; 401 = no session.
      expect(await bootstrap(clientToken)).toBe(403);
      expect(await bootstrap(other)).toBe(403);

      // 3. The real CLI signs out over HTTP and reports a confirmed result.
      child.stdin.write("sign-out\n");
      const result = await nextJson();
      expect(result).toEqual({ exit: 0, stored: false });
      expect(await bootstrap(clientToken)).toBe(401);
      expect(await bootstrap(other)).toBe(403);
      const [remaining] = await pool.execute<RowDataPacket[]>("SELECT token FROM mk8dx_auth_session");
      const tokens = remaining.map((row) => String(row["token"]));
      expect(tokens).toContain(other);
      expect(tokens).not.toContain(clientToken);
    } finally {
      child?.kill();
      await hosted.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
