// Disposable local Tournament stack for the source-faithful Step 0-10 parity
// iteration.
//
// It starts the real hosted passwordless runtime behind a temporary HTTPS
// origin on loopback, provisions one synthetic administrator/director, seeds
// synthetic Players and one Tournament parked at the step under review, and
// then stays alive so a debug Android build can be pointed at it with
// `-Pmk8dxApiOrigin` / `-Pmk8dxDebugCaCertificate`.
//
// Everything it creates is synthetic and lives only in the explicitly
// disposable local MySQL schema. It must never be pointed at production.
//
// The debug build pins this stack's certificate at build time. Regenerating it
// therefore silently breaks an already installed APK: the device opens no
// connection at all, so nothing appears in this gateway's trace and every
// screen simply reports that it cannot reach the server. Rebuild and reinstall
// the APK whenever the certificate under <handoff>.tls changes.

import { spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { AdministratorGrantService } from
  "../dist/administration/administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from
  "../dist/administration/mysql-administrator-grant-repository.js";
import { createPasswordlessHostedRuntime } from
  "../dist/composition/hosted-runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const webRoot = resolve(repositoryRoot, "apps/timetrials-web");
const handoffPath = process.env.MK8DX_STACK_HANDOFF ?? "";
const directorEmail = "step-parity-director@example.test";
const defaultRacers = [
  ["matteo", "Matteo"], ["gideon", "Gideon"], ["moss_hm", "Moss HM"],
  ["ben", "Ben"], ["evan", "Evan"], ["valerio", "Valerio"],
  ["merle", "Merle"], ["clementine", "Clementine"], ["jethro", "Jethro"],
  ["sadler", "Sadler"], ["thomas", "Thomas"], ["wilbur", "Wilbur"],
];

function sourceRacers() {
  const rosterPath = process.env.MK8DX_STACK_ROSTER_CSV ?? "";
  if (rosterPath === "") return defaultRacers;
  const lines = readFileSync(rosterPath, "utf8").replace(/^\uFEFF/u, "").split(/\r?\n/u).filter(Boolean);
  if (lines.shift() !== "Naam;Status;NS1;NS2") fail("the source roster CSV header is not recognized");
  const used = new Set();
  return lines.map((line, index) => {
    const [displayName] = line.split(";");
    if (!displayName) fail(`source roster row ${index + 2} has no name`);
    let username = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase().replace(/[^a-z0-9]/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 13);
    if (username.length < 3) username = `racer_${index + 1}`;
    const base = username;
    let suffix = 2;
    while (used.has(username)) { username = `${base.slice(0, 13)}_${suffix}`; suffix += 1; }
    used.add(username);
    return [username, displayName];
  });
}

const racers = sourceRacers();

// The stack deliberately serves a one-process self-signed certificate on
// loopback. Android trusts it through `mk8dxDebugCaCertificate`; this process
// trusts it here because it talks to itself.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function fail(message) {
  throw new Error(`Local Tournament step stack failed: ${message}`);
}

function databaseConfig() {
  const database = process.env.MK8DX_MYSQL_TEST_DATABASE ?? "";
  if (!/^mk8dx_[a-z0-9_]*(test|contract)[a-z0-9_]*$/u.test(database)) {
    fail("an explicitly disposable test/contract database is required");
  }
  return {
    host: process.env.MK8DX_MYSQL_TEST_HOST ?? "127.0.0.1",
    port: Number(process.env.MK8DX_MYSQL_TEST_PORT ?? "3306"),
    user: process.env.MK8DX_MYSQL_TEST_USER ?? "mk8dx_test",
    password: process.env.MK8DX_MYSQL_TEST_PASSWORD ?? "",
    database,
    connectionLimit: 4,
  };
}

function generateCertificate(directory) {
  const executable = process.env.MK8DX_TEST_OPENSSL ?? "openssl";
  const keyPath = join(directory, "localhost.key.pem");
  const certificatePath = join(directory, "localhost.cert.pem");
  // A debug build pins this certificate, so reuse it across restarts instead of
  // silently invalidating an already installed APK.
  try {
    return {
      key: readFileSync(keyPath),
      cert: readFileSync(certificatePath),
      certificatePath,
    };
  } catch { /* generate below */ }
  const result = spawnSync(executable, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath,
    "-out", certificatePath,
    "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ], { encoding: "utf8", shell: false, windowsHide: true });
  if (result.status !== 0) {
    fail(`temporary TLS certificate generation failed: ${result.stderr ?? ""}`);
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
    certificatePath,
  };
}

function createGateway(tls) {
  let backendPort = 0;
  const traceDeviceAuth = process.env.MK8DX_STACK_TRACE_DEVICE_AUTH === "1";
  // Owner-private production artwork is intentionally absent from the public
  // repository. The isolated acceptance stack still needs a decodable image
  // response so missing private art cannot obscure real application console
  // failures or render a browser's broken-image marker.
  const privateArtworkFallback = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  );
  const privateArtworkPaths = new Set([
    "/assets/images/misc/site_background.jpg",
    "/assets/branding/mk8dx-timetrials-app.png",
  ]);
  const handler = (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? "/", "https://127.0.0.1");
    const relative = parsed.pathname === "/" || parsed.pathname === "/device"
      ? "index.html" : parsed.pathname.replace(/^\//u, "");
    const candidate = resolve(webRoot, relative);
    const permittedRoots = [resolve(webRoot, "dist"), resolve(webRoot, "styles")];
    const permitted = candidate === resolve(webRoot, "index.html") ||
      candidate === resolve(webRoot, "manifest.webmanifest") ||
      candidate === resolve(webRoot, "sw.js") ||
      permittedRoots.some((root) => candidate.startsWith(`${root}${sep}`));
    try {
      if (incoming.method === "GET" && permitted && lstatSync(candidate).isFile()) {
        outgoing.setHeader("content-type", candidate.endsWith(".js") ? "text/javascript; charset=utf-8" :
          candidate.endsWith(".css") ? "text/css; charset=utf-8" :
            candidate.endsWith(".webmanifest") ? "application/manifest+json; charset=utf-8" : "text/html; charset=utf-8");
        outgoing.setHeader("cache-control", "no-store");
        createReadStream(candidate).pipe(outgoing);
        return;
      }
    } catch { /* API proxy or 404 below */ }
    if (incoming.method === "GET" && privateArtworkPaths.has(parsed.pathname)) {
      outgoing.setHeader("content-type", "image/png");
      outgoing.setHeader("cache-control", "no-store");
      outgoing.end(privateArtworkFallback);
      return;
    }
    if (!parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/v1/") && parsed.pathname !== "/health/ready") {
      outgoing.statusCode = 404;
      outgoing.end();
      return;
    }
    const traced = traceDeviceAuth;
    const proxy = httpRequest({
      host: "127.0.0.1",
      port: backendPort,
      method: incoming.method,
      path: incoming.url,
      headers: { ...incoming.headers, "x-real-ip": "127.0.0.1" },
    }, (response) => {
      if (traced) {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => console.log(
          `[device-auth] ${incoming.method} ${incoming.url} -> ${response.statusCode} ` +
          Buffer.concat(chunks).toString("utf8").slice(0, 400)));
      }
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    proxy.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(proxy);
  };
  const server = tls === null ? createHttpServer(handler) : createHttpsServer(tls, handler);
  return { server, setBackendPort(value) { backendPort = value; } };
}

async function listen(server) {
  // A pinned port keeps an already installed debug build valid across restarts.
  const requested = Number(process.env.MK8DX_STACK_PORT ?? "0");
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(requested, "127.0.0.1", () => { server.off("error", reject); accept(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") fail("listen failed");
  return address.port;
}

/** Minimal cookie-jar client, so no browser is needed for the local stack. */
function createClient(baseUrl) {
  const jar = new Map();
  async function call(method, path, body, bearer, csrf) {
    const headers = { accept: "application/json", origin: baseUrl, referer: `${baseUrl}/` };
    if (jar.size > 0) {
      headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
    if (csrf !== undefined) headers["x-mk8dx-csrf"] = csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    let parsed;
    try { parsed = text === "" ? undefined : JSON.parse(text); } catch { parsed = undefined; }
    return { status: response.status, headers: response.headers, text, body: parsed };
  }
  return { call, jar };
}

async function waitForAccount(pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [rows] = await pool.execute(
      `SELECT account.public_id AS accountId
       FROM restricted_authentication_bindings AS binding
       INNER JOIN user_accounts AS account
         ON account.user_account_id = binding.user_account_id
       WHERE binding.issuer_key = 'mk8dx_passwordless_v1'`,
    );
    if (rows.length >= 1) return String(rows[0].accountId);
    await new Promise((accept) => setTimeout(accept, 100));
  }
  fail("verified UserAccount provisioning did not complete");
}

async function seedPlayers(pool) {
  let index = 0;
  for (const [username, displayName] of racers) {
    index += 1;
    const publicId = `player.synthetic_step_parity_${username}`;
    await pool.execute(
      `INSERT IGNORE INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', ?, 'active', ?, ?)`,
      [publicId, displayName, 1_700_000_000_000 + index, 1_700_000_000_000 + index],
    );
    await pool.execute(
      `INSERT IGNORE INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1, ?, ?, ?
       FROM players WHERE public_id = ?`,
      [username, Buffer.from(username), 1_700_000_000_000 + index, publicId],
    );
  }
  const [rows] = await pool.execute(
    "SELECT public_id AS playerId FROM players WHERE public_id LIKE 'player.synthetic_step_parity_%' ORDER BY player_id",
  );
  return rows.map((row) => String(row.playerId));
}

async function main() {
  if (handoffPath === "") fail("MK8DX_STACK_HANDOFF must name a writable file");
  // Certificate material lives beside the handoff so restarts stay compatible
  // with an installed debug build.
  const temporary = `${handoffPath}.tls`;
  await mkdir(temporary, { recursive: true });
  const magicLinkLog = `${handoffPath}.magic-links.jsonl`;
  writeFileSync(magicLinkLog, "");

  const plaintext = process.env.MK8DX_STACK_PLAINTEXT === "1";
  const tls = plaintext ? null : generateCertificate(temporary);
  const gateway = createGateway(tls);
  const gatewayPort = await listen(gateway.server);
  const baseUrl = `${plaintext ? "http" : "https"}://127.0.0.1:${gatewayPort}`;
  const mysqlConfig = databaseConfig();
  const pool = mysql.createPool(mysqlConfig);

  const runtime = await createPasswordlessHostedRuntime({
    core: {
      mysql: mysqlConfig,
      schema9CatalogPath: resolve(
        repositoryRoot,
        "packages/assets/schema9-asset-catalog-v1.json",
      ),
      authenticationKeys: {
        lookupHmacKey: Buffer.alloc(32, 31),
        lookupKeyVersion: "step-auth-v1",
      },
      timeTrialKeys: {
        encryptionKey: Buffer.alloc(32, 32),
        encryptionKeyVersion: "step-tt-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 33),
        lookupKeyVersion: "step-tt-lookup-v1",
      },
      timeTrialDecryptionKeys: { "step-tt-enc-v1": Buffer.alloc(32, 32) },
      tournamentKeys: {
        encryptionKey: Buffer.alloc(32, 34),
        encryptionKeyVersion: "step-tournament-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 35),
        lookupKeyVersion: "step-tournament-lookup-v1",
      },
      tournamentDecryptionKeys: { "step-tournament-enc-v1": Buffer.alloc(32, 34) },
    },
    authentication: {
      baseUrl,
      production: !plaintext,
      trustedOrigins: [baseUrl],
      secrets: [{ version: 1, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" }],
      nativeClientIds: ["mk8dx.timetrials.android.v1", "mk8dx.timetrials.desktop.v1", "mk8dx.tournament.desktop.v1"],
      clientIpHeaders: ["x-real-ip"],
      trustedProxyAddresses: ["127.0.0.1"],
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      username: "synthetic-user",
      password: "synthetic-password",
      fromAddress: "auth@example.test",
      allowedLinkOrigin: baseUrl,
    },
    webManual: {
      producerVersion: "timetrials-step-parity-stack",
      csrfKeys: {
        activeKeyVersion: "step-csrf-v1",
        keys: { "step-csrf-v1": Buffer.alloc(32, 36) },
      },
    },
    tournamentSubmissionAuthorizer: {
      async authorize(context) { return context.actor.role === "administrator"; },
    },
  }, () => ({
    async verify() {},
    async sendMagicLink(message) {
      appendFileSync(magicLinkLog, `${JSON.stringify({ url: message.url })}\n`);
    },
    close() {},
  }));

  const backendAddress = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  gateway.setBackendPort(Number(new URL(backendAddress).port));

  const client = createClient(baseUrl);
  const requested = await client.call("POST", "/api/auth/sign-in/magic-link", {
    email: directorEmail,
    callbackURL: "/",
  });
  if (requested.status !== 200) fail(`magic link request returned ${requested.status}`);
  const links = readFileSync(magicLinkLog, "utf8").trim().split("\n").filter(Boolean);
  if (links.length !== 1) fail("exactly one magic link was expected");
  const verifyUrl = JSON.parse(links[0]).url;
  const verified = await client.call("GET", verifyUrl.slice(baseUrl.length));
  if (verified.status >= 400) fail(`magic link verification returned ${verified.status}`);

  // The verified session provisions its canonical UserAccount on the first
  // authenticated product call, exactly as the Web client does after landing.
  const provisioning = await client.call("GET", "/v1/session/csrf");
  if (provisioning.status >= 400) {
    fail(`session provisioning returned ${provisioning.status}: ${provisioning.text.slice(0, 300)}`);
  }
  const accountId = await waitForAccount(pool);
  // Restarting the stack against an existing disposable schema must not fail:
  // the first administrator is bootstrapped once and stays bootstrapped.
  try {
    await new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId() { return "administrator_grant.synthetic_step_parity"; } },
      { nowMs: () => 1_899_999_998_000 },
    ).bootstrapFirstAdministrator(accountId);
  } catch (error) {
    if (error?.code !== "conflict") throw error;
  }

  // The Android native bootstrap resolves the signed-in account's claimed
  // Player, so the director needs one before a device session can be
  // established. Creating it once is idempotent for later stack restarts.
  const csrf = await client.call("GET", "/v1/session/csrf");
  const csrfToken = csrf.body?.value;
  const ownPlayer = await client.call("POST", "/v1/me/player", {
    username: "stepdirector",
    displayName: "Step Parity Director",
  }, undefined, csrfToken);
  if (ownPlayer.status >= 400 && ownPlayer.status !== 409) {
    fail(`director Player creation returned ${ownPlayer.status}: ${ownPlayer.text.slice(0, 300)}`);
  }

  const playerIds = await seedPlayers(pool);

  // The native Tournament routes deliberately require a native-app bearer
  // token. The stack mints one through the real device-authorization flow
  // rather than weakening that boundary for seeding.
  const deviceCode = await client.call("POST", "/api/auth/device/code", {
    client_id: "mk8dx.timetrials.desktop.v1",
  });
  if (deviceCode.status !== 200) {
    fail(`device code returned ${deviceCode.status}: ${deviceCode.text.slice(0, 300)}`);
  }
  const userCode = String(deviceCode.body?.user_code ?? "");
  const claimed = await client.call(
    "GET", `/api/auth/device?user_code=${encodeURIComponent(userCode)}`);
  if (claimed.status >= 400) fail(`device claim returned ${claimed.status}`);
  const approvedDevice = await client.call("POST", "/api/auth/device/approve", { userCode });
  if (approvedDevice.status >= 400) {
    fail(`device approval returned ${approvedDevice.status}: ${approvedDevice.text.slice(0, 300)}`);
  }
  const token = await client.call("POST", "/api/auth/device/token", {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: String(deviceCode.body?.device_code ?? ""),
    client_id: "mk8dx.timetrials.desktop.v1",
  });
  if (token.status !== 200) {
    fail(`device token returned ${token.status}: ${token.text.slice(0, 300)}`);
  }
  const bearer = String(token.body?.access_token ?? "");
  if (bearer === "") fail("device token response carried no access token");

  let tournamentId = process.env.MK8DX_STACK_REUSE_TOURNAMENT_ID ?? "";
  if (tournamentId === "") {
    const created = await client.call("POST", "/v1/native/tournaments", {
      name: process.env.MK8DX_STACK_TOURNAMENT_NAME ?? "TestToernooi",
      eventDate: process.env.MK8DX_STACK_EVENT_DATE ?? "2026-08-29",
      startAtMs: Date.parse(process.env.MK8DX_STACK_START_AT ?? "2026-08-29T19:00:00Z"),
      timezone: "Europe/Amsterdam",
      seedingSource: "community_rating",
      placementStrategy: "balanced",
      qualifierRounds: true,
    }, bearer);
    if (created.status >= 400) {
      fail(`Tournament creation returned ${created.status}: ${created.text.slice(0, 400)}`);
    }
    tournamentId = created.body?.tournamentId ?? created.body?.summary?.tournamentId;
    if (typeof tournamentId !== "string") fail("Tournament creation returned no id");
    let revision = Number(created.body?.revision ?? created.body?.summary?.revision ?? 1);
    for (const playerId of playerIds) {
      const added = await client.call(
        "POST", `/v1/native/tournaments/${encodeURIComponent(tournamentId)}/participants`,
        { expectedRevision: revision, playerId, attendance: "absent", hasSwitch1: false, hasSwitch2: false },
        bearer,
      );
      if (added.status >= 400) {
        fail(`participant ${playerId} returned ${added.status}: ${added.text.slice(0, 300)}`);
      }
      revision = Number(added.body?.summary?.revision ?? revision + 1);
    }
  }

  const handoff = {
    baseUrl,
    port: gatewayPort,
    certificatePath: tls?.certificatePath ?? null,
    magicLinkLog,
    directorEmail,
    tournamentId,
    participantCount: playerIds.length,
  };
  writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  console.log(`Local Tournament step stack ready on ${baseUrl}`);
  console.log(`Tournament ${tournamentId} has ${playerIds.length} Absent participants at Step 2.`);
  console.log(`Handoff written to ${handoffPath}`);

  // A control file lets an operator approve an Android device-authorization
  // code without a browser: write the user code, read the written result.
  const approvalRequestPath = `${handoffPath}.approve-user-code.txt`;
  const approvalResultPath = `${handoffPath}.approve-result.txt`;
  writeFileSync(approvalRequestPath, "");
  setInterval(async () => {
    let userCode = "";
    try { userCode = readFileSync(approvalRequestPath, "utf8").trim(); } catch { return; }
    if (userCode === "") return;
    writeFileSync(approvalRequestPath, "");
    try {
      const claimed = await client.call(
        "GET", `/api/auth/device?user_code=${encodeURIComponent(userCode)}`);
      const approved = await client.call("POST", "/api/auth/device/approve", { userCode });
      writeFileSync(approvalResultPath,
        `claim=${claimed.status} approve=${approved.status} ${approved.text.slice(0, 300)}\n`);
    } catch (error) {
      writeFileSync(approvalResultPath, `error ${String(error).slice(0, 300)}\n`);
    }
  }, 500);

  process.on("SIGINT", async () => {
    await runtime.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  await new Promise(() => {});
}

await main();
