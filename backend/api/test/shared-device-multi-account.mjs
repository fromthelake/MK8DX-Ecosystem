// Shared-device multi-account acceptance harness for LiveTrial Desktop.
//
// Three completely independent accounts (A, B, C) share one machine. There is no
// family/parent-child semantics anywhere: the device simply remembers an N-account
// list. The harness proves, against a real HTTPS API and a real MySQL 8.4
// database, that a run recorded by one account can never be delivered with
// another account's credential.
//
// Run from the repository root:
//   node backend/api/test/shared-device-multi-account.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, lstatSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";
import { chromium } from "playwright";

import { createPasswordlessHostedRuntime } from
  "../dist/composition/hosted-runtime.js";


const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const webRoot = resolve(repositoryRoot, "apps/timetrials-web");
const temporaryPrefix = join(resolve(tmpdir()), "mk8dx-shared-device-");
const producerVersion = "timetrials-desktop-shared-device";
const disposableDescriptorPath = process.env.MK8DX_TEST_MYSQL_DESCRIPTOR ?? join(
  resolve(tmpdir()),
  "claude",
  "C--Ai-MarioKart-MK8DX-Ecosystem",
  "5dc7fa33-85d6-4188-b601-779d478745ef",
  "scratchpad",
  "mysql-disposable.json",
);

const identities = Object.freeze([
  Object.freeze({
    label: "A",
    email: "acceptance-a@example.test",
    playerId: "player.acceptance_a",
    claimId: "player_claim.acceptance_a",
    displayName: "Acceptance A",
    username: "acceptancea",
  }),
  Object.freeze({
    label: "B",
    email: "acceptance-b@example.test",
    playerId: "player.acceptance_b",
    claimId: "player_claim.acceptance_b",
    displayName: "Acceptance B",
    username: "acceptanceb",
  }),
  Object.freeze({
    label: "C",
    email: "acceptance-c@example.test",
    playerId: "player.acceptance_c",
    claimId: "player_claim.acceptance_c",
    displayName: "Acceptance C",
    username: "acceptancec",
  }),
]);

const securityHeaders = Object.freeze({
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const stepResults = [];

function fail(message) {
  throw new Error(`Shared-device multi-account acceptance failed: ${message}`);
}

function step(number, message) {
  const line = `step ${String(number).padStart(2, "0")}  ${message}`;
  stepResults.push(line);
  console.log(line);
}

function progress(message) {
  console.log(`        ${message}`);
}

// ---------------------------------------------------------------------------
// Environment (mirrors backend/api/test/live-web-product.browser.mjs)
// ---------------------------------------------------------------------------

function applyDisposableDatabaseEnvironment() {
  let descriptor;
  try {
    descriptor = JSON.parse(readFileSync(disposableDescriptorPath, "utf8"));
  } catch {
    fail(`the disposable MySQL descriptor at ${disposableDescriptorPath} is unreadable`);
  }
  if (typeof descriptor.test !== "string" || descriptor.test.length === 0) {
    fail("the disposable MySQL descriptor has no \"test\" password");
  }
  process.env.MK8DX_MYSQL_TEST_HOST = process.env.MK8DX_MYSQL_TEST_HOST ?? "127.0.0.1";
  process.env.MK8DX_MYSQL_TEST_PORT = String(
    process.env.MK8DX_MYSQL_TEST_PORT ?? descriptor.port ?? 33318,
  );
  process.env.MK8DX_MYSQL_TEST_USER = process.env.MK8DX_MYSQL_TEST_USER ?? "mk8dx_test";
  process.env.MK8DX_MYSQL_TEST_PASSWORD = descriptor.test;
  process.env.MK8DX_MYSQL_TEST_DATABASE =
    process.env.MK8DX_MYSQL_TEST_DATABASE ?? "mk8dx_mysql84_contract";
}

function databaseConfig() {
  const database = process.env.MK8DX_MYSQL_TEST_DATABASE ?? "";
  if (database !== "mk8dx_mysql84_contract") {
    fail("a fresh disposable mk8dx_mysql84_contract database is required");
  }
  const port = Number(process.env.MK8DX_MYSQL_TEST_PORT ?? "3306");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail("the MySQL port is invalid");
  }
  return {
    host: process.env.MK8DX_MYSQL_TEST_HOST ?? "127.0.0.1",
    port,
    user: process.env.MK8DX_MYSQL_TEST_USER ?? "mk8dx_test",
    password: process.env.MK8DX_MYSQL_TEST_PASSWORD ?? "",
    database,
    timezone: "Z",
    connectionLimit: 4,
  };
}

function pinnedMigrationCount() {
  const catalog = JSON.parse(readFileSync(resolve(
    repositoryRoot,
    "infrastructure/mysql/migration-catalog-v1.json",
  ), "utf8"));
  if (!Array.isArray(catalog.migrations) || catalog.migrations.length === 0) {
    fail("the pinned MySQL migration catalog is unusable");
  }
  return catalog.migrations.length;
}

function generateCertificate(directory) {
  const executable = process.env.MK8DX_TEST_OPENSSL ?? "openssl";
  const keyPath = join(directory, "localhost.key.pem");
  const certificatePath = join(directory, "localhost.cert.pem");
  const result = spawnSync(executable, [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-keyout", keyPath,
    "-out", certificatePath,
    "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ], { shell: false, windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) { fail("temporary TLS certificate generation failed"); }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
    certificatePath,
  };
}

function setSecurityHeaders(response) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.setHeader(name, value);
  }
}

function staticFile(pathname) {
  const relativePath = pathname === "/" || pathname === "/device"
    ? "index.html"
    : pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const candidate = resolve(webRoot, relativePath);
  const permittedRoots = [resolve(webRoot, "dist"), resolve(webRoot, "styles")];
  const permitted = candidate === resolve(webRoot, "index.html") ||
    candidate === resolve(webRoot, "manifest.webmanifest") ||
    candidate === resolve(webRoot, "sw.js") ||
    permittedRoots.some((root) => candidate.startsWith(`${root}${sep}`));
  if (!permitted) { return null; }
  try {
    const metadata = lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() ? candidate : null;
  } catch {
    return null;
  }
}

function contentType(path) {
  if (path.endsWith(".html")) { return "text/html; charset=utf-8"; }
  if (path.endsWith(".css")) { return "text/css; charset=utf-8"; }
  if (path.endsWith(".js")) { return "text/javascript; charset=utf-8"; }
  if (path.endsWith(".webmanifest")) { return "application/manifest+json; charset=utf-8"; }
  if (path.endsWith(".svg")) { return "image/svg+xml"; }
  return "application/octet-stream";
}

function createGateway(tls) {
  let backendPort = null;
  const server = createHttpsServer(tls, (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? "/", "https://127.0.0.1");
    const file = staticFile(parsed.pathname);
    if (file !== null && incoming.method === "GET") {
      setSecurityHeaders(outgoing);
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", contentType(file));
      outgoing.setHeader("cache-control", "no-store");
      createReadStream(file).pipe(outgoing);
      return;
    }
    if (backendPort === null || (
      !parsed.pathname.startsWith("/api/") &&
      !parsed.pathname.startsWith("/v1/") &&
      parsed.pathname !== "/health/ready"
    )) {
      setSecurityHeaders(outgoing);
      outgoing.statusCode = backendPort === null ? 503 : 404;
      outgoing.end();
      return;
    }
    const headers = { ...incoming.headers };
    delete headers.connection;
    headers.host = incoming.headers.host;
    headers["x-real-ip"] = "203.0.113.50";
    const proxy = httpRequest({
      host: "127.0.0.1",
      port: backendPort,
      method: incoming.method,
      path: incoming.url,
      headers,
    }, (proxied) => {
      setSecurityHeaders(outgoing);
      for (const [name, value] of Object.entries(proxied.headers)) {
        if (value !== undefined && name !== "connection" &&
          name !== "transfer-encoding") {
          outgoing.setHeader(name, value);
        }
      }
      outgoing.statusCode = proxied.statusCode ?? 502;
      proxied.pipe(outgoing);
    });
    proxy.on("error", () => {
      if (!outgoing.headersSent) {
        setSecurityHeaders(outgoing);
        outgoing.statusCode = 502;
      }
      outgoing.end();
    });
    incoming.pipe(proxy);
  });
  return {
    server,
    setBackendPort(value) { backendPort = value; },
  };
}

async function listen(server) {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") { fail("listen failed"); }
  return address.port;
}

async function closeServer(server) {
  if (server === undefined || !server.listening) { return; }
  await new Promise((accept, reject) => {
    server.close((error) => error === undefined ? accept() : reject(error));
  });
}

// ---------------------------------------------------------------------------
// LiveTrial product process control
// ---------------------------------------------------------------------------

function liveTrialEnvironment(temporary, certificatePath) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("MK8DX_MYSQL")) { delete environment[name]; }
  }
  environment.LOCALAPPDATA = join(temporary, "local-app-data");
  environment.PYTHONIOENCODING = "utf-8";
  environment.SSL_CERT_FILE = certificatePath;
  return environment;
}

function startLiveTrial(arguments_, environment, onStdout = () => undefined) {
  const python = resolve(repositoryRoot, ".venv/Scripts/python.exe");
  const cli = resolve(
    repositoryRoot,
    "apps/timetrials-desktop/livetrial_product_cli.py",
  );
  if (!lstatSync(python).isFile() || !lstatSync(cli).isFile()) {
    fail("the repository Python/LiveTrial command is unavailable");
  }
  const child = spawn(python, ["-u", cli, ...arguments_], {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const completion = new Promise((accept, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > 256 * 1024) {
        child.kill();
        return;
      }
      onStdout(stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > 256 * 1024) { child.kill(); }
    });
    child.once("error", () => reject(new Error(
      `LiveTrial product process could not start: livetrial_product_cli.py ${arguments_[0]}`,
    )));
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal !== null) {
        reject(new Error(
          `LiveTrial "${arguments_[0]}" failed (code ${code}, signal ${signal}).\n` +
          `stdout: ${stdout.trim()}\nstderr: ${stderr.trim()}`,
        ));
        return;
      }
      accept({ stdout, stderr });
    });
  });
  return { child, completion };
}

async function runLiveTrial(arguments_, environment) {
  return startLiveTrial(arguments_, environment).completion;
}

// ---------------------------------------------------------------------------
// Desktop workspace
// ---------------------------------------------------------------------------

function createWorkspace(root) {
  return Object.freeze({
    root,
    profilePath: join(root, "profile.json"),
    // The legacy single-account session path. Nothing is ever written here by
    // the accounts-aware build; it exists so the adoption path stays exercised.
    legacySessionPath: join(root, "auth-session.dat"),
    accountsRoot: join(root, "accounts"),
    canonicalRoot: join(root, "canonical-outbox"),
    privateRoot: join(root, "private-evidence"),
    reportRoot: join(root, "reports"),
  });
}

function accountArguments(workspace) {
  return [
    "--session", workspace.legacySessionPath,
    "--accounts-root", workspace.accountsRoot,
  ];
}

function outboxArguments(workspace) {
  return [
    "--canonical-outbox-root", workspace.canonicalRoot,
    "--private-evidence-root", workspace.privateRoot,
  ];
}

async function listAccounts(workspace, environment) {
  const result = await runLiveTrial(
    ["accounts", ...accountArguments(workspace)],
    environment,
  );
  const listing = JSON.parse(result.stdout.trim());
  assert.ok(Array.isArray(listing), "the accounts listing must be a plain array");
  return listing;
}

async function listResults(workspace, environment) {
  const result = await runLiveTrial(
    ["list-results", ...accountArguments(workspace), ...outboxArguments(workspace)],
    environment,
  );
  return JSON.parse(result.stdout.trim());
}

async function switchTo(workspace, environment, slotId, expectedPlayerId) {
  const result = await runLiveTrial(
    ["switch", "--slot", slotId, ...accountArguments(workspace)],
    environment,
  );
  assert.equal(
    result.stdout.trim(),
    `LiveTrial active account is now ${expectedPlayerId}.`,
    `switch to ${expectedPlayerId} did not report that account as active`,
  );
  const listing = await listAccounts(workspace, environment);
  const active = listing.filter((row) => row.active === true);
  assert.equal(active.length, 1, "exactly one account may be active");
  assert.equal(active[0].slotId, slotId);
  assert.equal(active[0].playerId, expectedPlayerId);
  return active[0];
}

// ---------------------------------------------------------------------------
// Synthetic finished-run reports
// ---------------------------------------------------------------------------

const fixtureRun = JSON.parse(readFileSync(resolve(
  repositoryRoot,
  "apps/timetrials-desktop/tests/fixtures/livetrial-finished-run-3lap.json",
), "utf8"));

async function writeReport(workspace, runNumber) {
  // A distinct run number and a distinct total time per entry keep the
  // deterministic submission digest distinct, and give every entry a stable
  // key that can be located again in MySQL.
  const run = JSON.parse(JSON.stringify(fixtureRun));
  const totalTimeMs = 60_000 + runNumber;
  run.run = runNumber;
  run.closedAt = 1_787_040_000.125 + runNumber;
  run.results.player.totalMs = totalTimeMs;
  run.results.player.lapTimesMs = [20_000, 19_500, 20_500 + runNumber];
  run.results.ghost.totalMs = totalTimeMs + 1_000;
  run.results.ghost.lapTimesMs = [20_300, 20_100, 20_600 + runNumber];
  const reportPath = join(workspace.reportRoot, `report-${runNumber}.json`);
  await writeFile(reportPath, JSON.stringify({
    video: `live:shared-device acceptance capture ${runNumber}`,
    fps: 0,
    framesAnalyzed: 1234,
    runs: [run],
  }), { encoding: "utf8", flag: "wx" });
  return { reportPath, totalTimeMs };
}

async function saveRun(workspace, environment, runNumber) {
  const { reportPath, totalTimeMs } = await writeReport(workspace, runNumber);
  await runLiveTrial([
    "save-run",
    "--report", reportPath,
    "--source-kind", "livetrial_capture",
    "--run-number", String(runNumber),
    "--profile", workspace.profilePath,
    "--catalog", resolve(repositoryRoot, "packages/assets/schema9-asset-catalog-v1.json"),
    ...accountArguments(workspace),
    ...outboxArguments(workspace),
  ], environment);
  const listing = await listResults(workspace, environment);
  const saved = listing.filter((row) => row.totalTimeMs === totalTimeMs);
  assert.equal(saved.length, 1, `run ${runNumber} did not produce exactly one entry`);
  return { ...saved[0], totalTimeMs, runNumber };
}

async function syncAll(workspace, environment, baseUrl) {
  const result = await runLiveTrial([
    "sync-all",
    "--api-origin", baseUrl,
    ...accountArguments(workspace),
    ...outboxArguments(workspace),
  ], environment);
  return JSON.parse(result.stdout.trim());
}

function outcomeFor(summary, entryKey) {
  const found = summary.results.filter((row) => row.entryKey === entryKey);
  assert.equal(found.length, 1, "each entry must appear exactly once in sync-all");
  return found[0];
}

// ---------------------------------------------------------------------------
// MySQL evidence
// ---------------------------------------------------------------------------

async function submittedRevisions(pool) {
  const [rows] = await pool.execute(
    `SELECT revision.total_time_ms AS totalTimeMs,
            revision.source_kind AS sourceKind,
            player.public_id AS playerId,
            submission.public_id AS submissionId
     FROM time_trial_submission_revisions AS revision
     INNER JOIN players AS player ON player.player_id = revision.player_id
     INNER JOIN time_trial_submissions AS submission
       ON submission.time_trial_submission_id = revision.time_trial_submission_id
     WHERE revision.producer_version = ?`,
    [producerVersion],
  );
  const byTotalTime = new Map();
  for (const row of rows) {
    byTotalTime.set(Number(row.totalTimeMs), {
      playerId: String(row.playerId),
      submissionId: String(row.submissionId),
      sourceKind: String(row.sourceKind),
    });
  }
  assert.equal(byTotalTime.size, rows.length, "total times must stay unique per entry");
  return byTotalTime;
}

function assertOwnedInMysql(byTotalTime, entry, identity) {
  const row = byTotalTime.get(entry.totalTimeMs);
  assert.ok(
    row !== undefined,
    `entry for ${identity.playerId} (total ${entry.totalTimeMs}ms) is missing from MySQL`,
  );
  assert.equal(
    row.playerId,
    identity.playerId,
    `CONTAMINATION: entry recorded by ${identity.label} landed under ${row.playerId}`,
  );
  assert.equal(row.sourceKind, "livetrial_capture");
  return row.submissionId;
}

async function accountPublicIds(pool) {
  const [rows] = await pool.execute(
    `SELECT account.public_id AS accountId
     FROM restricted_authentication_bindings AS binding
     INNER JOIN user_accounts AS account
       ON account.user_account_id = binding.user_account_id
     WHERE binding.issuer_key = 'mk8dx_passwordless_v1'`,
  );
  return rows.map((row) => String(row.accountId));
}

// Adapted waitForAccount: three accounts now exist, so the one just provisioned
// is identified as the account that was not there before this sign-in.
async function waitForNewAccount(pool, known) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await accountPublicIds(pool);
    const fresh = current.filter((value) => !known.has(value));
    if (fresh.length === 1) {
      known.add(fresh[0]);
      return fresh[0];
    }
    if (fresh.length > 1) { fail("more than one UserAccount was provisioned at once"); }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  fail("verified UserAccount provisioning did not complete");
}

async function provisionPlayer(pool, identity, accountId) {
  await pool.execute(
    `INSERT INTO players
     (public_id, revision, player_kind, display_name, record_status,
      created_at_ms, updated_at_ms)
     VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
    [identity.playerId, identity.displayName],
  );
  await pool.execute(
    `INSERT INTO player_username_history
     (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
     SELECT player_id, 1, ?, ?, 1
     FROM players WHERE public_id = ?`,
    [identity.username, Buffer.from(identity.username), identity.playerId],
  );
  await pool.execute(
    `INSERT INTO player_claims (
       public_id, revision, privacy_class, player_id, user_account_id,
       claim_status, dispute_status, created_at_ms, updated_at_ms
     )
     SELECT ?, 1, 'private', player.player_id, account.user_account_id,
            'verified', 'none', 1, 1
     FROM players AS player
     CROSS JOIN user_accounts AS account
     WHERE player.public_id = ? AND account.public_id = ?`,
    [identity.claimId, identity.playerId, accountId],
  );
}

// ---------------------------------------------------------------------------
// Browser identities and the real device authorization flow
// ---------------------------------------------------------------------------

async function signInIdentity(browser, baseUrl, identity, delivered) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const before = delivered.length;
  const landing = await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(landing?.status(), 200);
  await page.locator('input[type="email"]').fill(identity.email);
  await page.getByRole("button", {
    name: "Email me a sign-in / registration link",
  }).click();
  await page.getByText(
    "Link requested. Check your inbox and spam folder. " +
      "First-time users continue directly to Player setup.",
    { exact: true },
  ).waitFor();
  assert.equal(
    delivered.length,
    before + 1,
    `identity ${identity.label} did not produce exactly one captured magic link`,
  );
  const message = delivered[delivered.length - 1];
  assert.ok(
    String(message.url).startsWith(baseUrl),
    "the captured magic link must point at the harness gateway",
  );
  await page.goto(message.url, { waitUntil: "networkidle" });
  await page.getByText("Signed in.", { exact: true }).waitFor();
  const cookies = await context.cookies();
  assert.ok(
    cookies.some((cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite === "Lax"),
    "a protected session cookie is required",
  );
  // Force account provisioning exactly as the product does on first use.
  const proof = await context.request.get(`${baseUrl}/v1/session/csrf`);
  assert.equal(proof.status(), 200);
  return { context, page };
}

async function authorizeDevice(workspace, environment, baseUrl, identity, session) {
  let resolveApproval;
  const approval = new Promise((accept) => { resolveApproval = accept; });
  let approvalFound = false;
  const signIn = startLiveTrial([
    "sign-in",
    "--api-origin", baseUrl,
    "--no-browser",
    ...accountArguments(workspace),
  ], environment, (stdout) => {
    if (approvalFound) { return; }
    const match = stdout.match(
      /Approve LiveTrial in your browser: (https:\/\/\S+\/device\?user_code=[^\s]+) \(code /,
    );
    if (match !== null) {
      approvalFound = true;
      resolveApproval(match[1]);
    }
  });
  let approvalTimer;
  const approvalTimeout = new Promise((_, reject) => {
    approvalTimer = setTimeout(() => {
      signIn.child.kill();
      reject(new Error(
        `LiveTrial device approval URL was not produced for identity ${identity.label}.`,
      ));
    }, 30_000);
  });
  const approvalUrl = await Promise.race([
    approval,
    approvalTimeout,
    signIn.completion.then(() => {
      throw new Error(
        `LiveTrial sign-in ended before device approval for identity ${identity.label}.`,
      );
    }),
  ]);
  clearTimeout(approvalTimer);
  assert.equal(approvalUrl.startsWith(`${baseUrl}/device?`), true);
  // Approval happens in this identity's own browser context only.
  await session.page.goto(approvalUrl, { waitUntil: "networkidle" });
  await session.page.getByText(
    "LiveTrial desktop requests access to your account.",
    { exact: true },
  ).waitFor();
  await session.page.getByRole("button", { name: "Approve device" }).click();
  await session.page.getByText("Device approved. You may return to it.", { exact: true })
    .waitFor();
  const signedIn = await signIn.completion;
  assert.equal(signedIn.stderr, "");
  assert.match(signedIn.stdout, /synchronization session established/);
}

// ---------------------------------------------------------------------------
// Local credential-hygiene evidence
// ---------------------------------------------------------------------------

async function collectFiles(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(path); continue; }
      if (entry.isFile()) { found.push(path); }
    }
  }
  return found;
}

async function assertNoLooseCredentials(workspace) {
  const files = await collectFiles(workspace.root);
  const forbidden = [
    "accesstoken", "refreshtoken", "bearer ", "\"token\"", "sessiontoken",
    "authorization:", "access_token", "refresh_token",
  ];
  const inspected = [];
  for (const path of files) {
    if (path.endsWith(".session.dat")) { continue; }
    const payload = (await readFile(path)).toString("latin1").toLowerCase();
    for (const needle of forbidden) {
      assert.equal(
        payload.includes(needle),
        false,
        `a credential-looking value appeared outside the protected store: ${path}`,
      );
    }
    inspected.push(path);
  }
  assert.ok(inspected.length > 0, "no local product files were inspected");
  const index = JSON.parse(await readFile(
    join(workspace.accountsRoot, "index.json"),
    "utf8",
  ));
  assert.deepEqual(
    Object.keys(index).sort(),
    ["accounts", "activeSlotId", "schemaVersion"],
    "the accounts index must stay a token-free listing",
  );
  for (const row of index.accounts) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ["addedAtMs", "lastUsedAtMs", "playerId", "slotId"],
      "an accounts index row carried an unexpected field",
    );
  }
  return inspected.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  applyDisposableDatabaseEnvironment();
  const temporary = await mkdtemp(temporaryPrefix);
  const resolvedTemporary = resolve(temporary);
  if (!resolvedTemporary.startsWith(temporaryPrefix)) {
    fail("temporary directory escaped the OS temporary root");
  }
  let gateway;
  let runtime;
  let pool;
  let browser;
  const delivered = [];
  const mailer = { factoryCalls: 0, verifyCalls: 0, sendCalls: 0, closeCalls: 0 };
  const summary = { accounts: {}, entries: [], contamination: [] };
  try {
    const tls = generateCertificate(resolvedTemporary);
    gateway = createGateway(tls);
    const gatewayPort = await listen(gateway.server);
    const baseUrl = `https://127.0.0.1:${gatewayPort}`;
    const mysqlConfig = databaseConfig();
    pool = mysql.createPool(mysqlConfig);
    const [migrations] = await pool.execute(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    const expectedMigrations = pinnedMigrationCount();
    assert.equal(
      migrations.length,
      expectedMigrations,
      "the disposable database is not at the pinned catalog schema",
    );
    progress(`isolated MySQL 8.4 at ${mysqlConfig.host}:${mysqlConfig.port} ` +
      `is migrated to the pinned catalog (${expectedMigrations} migrations)`);

    runtime = await createPasswordlessHostedRuntime({
      core: {
        mysql: mysqlConfig,
        schema9CatalogPath: resolve(
          repositoryRoot,
          "packages/assets/schema9-asset-catalog-v1.json",
        ),
        authenticationKeys: {
          lookupHmacKey: Buffer.alloc(32, 31),
          lookupKeyVersion: "shared-device-auth-v1",
        },
        timeTrialKeys: {
          encryptionKey: Buffer.alloc(32, 32),
          encryptionKeyVersion: "shared-device-tt-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 33),
          lookupKeyVersion: "shared-device-tt-lookup-v1",
        },
        timeTrialDecryptionKeys: {
          "shared-device-tt-enc-v1": Buffer.alloc(32, 32),
        },
        tournamentKeys: {
          encryptionKey: Buffer.alloc(32, 34),
          encryptionKeyVersion: "shared-device-tournament-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 35),
          lookupKeyVersion: "shared-device-tournament-lookup-v1",
        },
        tournamentDecryptionKeys: {
          "shared-device-tournament-enc-v1": Buffer.alloc(32, 34),
        },
      },
      authentication: {
        baseUrl,
        production: true,
        trustedOrigins: [baseUrl],
        secrets: [{
          version: 1,
          value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=",
        }],
        nativeClientIds: [
          "mk8dx.timetrials.android.v1",
          "mk8dx.timetrials.desktop.v1",
        ],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: ["127.0.0.1"],
      },
      smtp: {
        host: "smtp.invalid.test",
        port: 465,
        secure: true,
        username: "never-used",
        password: "never-used",
        fromAddress: "auth@example.test",
        allowedLinkOrigin: baseUrl,
      },
      webManual: {
        producerVersion: "timetrials-web-shared-device",
        csrfKeys: {
          activeKeyVersion: "shared-device-csrf-v1",
          keys: { "shared-device-csrf-v1": Buffer.alloc(32, 36) },
        },
      },
    }, () => {
      // Stubbed mailer: every magic link is captured in-process. No SMTP
      // connection is ever opened and no email is ever sent.
      mailer.factoryCalls += 1;
      return {
        async verify() { mailer.verifyCalls += 1; },
        async sendMagicLink(message) {
          mailer.sendCalls += 1;
          delivered.push(message);
        },
        close() { mailer.closeCalls += 1; },
      };
    });
    const backendAddress = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    gateway.setBackendPort(Number(new URL(backendAddress).port));
    assert.equal(mailer.factoryCalls, 1, "exactly one stubbed mailer must be built");
    assert.equal(mailer.verifyCalls, 1, "the stubbed mailer must be the verified one");
    progress("hosted runtime started with a stubbed in-process mailer (no email is sent)");

    const channel = process.env.MK8DX_TEST_BROWSER_CHANNEL ?? "msedge";
    if (!new Set(["msedge", "chrome"]).has(channel)) {
      fail("browser channel must be msedge or chrome");
    }
    browser = await chromium.launch({ channel, headless: true });

    // --- three independent identities -------------------------------------
    const known = new Set();
    const sessions = new Map();
    for (const identity of identities) {
      const session = await signInIdentity(browser, baseUrl, identity, delivered);
      sessions.set(identity.label, session);
      const accountId = await waitForNewAccount(pool, known);
      await provisionPlayer(pool, identity, accountId);
      summary.accounts[identity.label] = {
        email: identity.email,
        playerId: identity.playerId,
        userAccountId: accountId,
      };
      progress(`identity ${identity.label} signed in and claimed ${identity.playerId}`);
    }
    assert.equal(delivered.length, 3);
    assert.equal(mailer.sendCalls, 3);
    assert.equal(new Set(delivered.map((value) => value.url)).size, 3);
    // Three independent contexts: no cookie is shared between the identities.
    for (const [label, session] of sessions) {
      const cookies = await session.context.cookies();
      for (const [otherLabel, other] of sessions) {
        if (otherLabel === label) { continue; }
        const otherCookies = await other.context.cookies();
        for (const cookie of cookies) {
          assert.equal(
            otherCookies.some((value) =>
              value.name === cookie.name && value.value === cookie.value),
            false,
            "browser contexts must not share session cookies",
          );
        }
      }
    }

    // --- desktop workspace and real device authorization -------------------
    const workspace = createWorkspace(join(resolvedTemporary, "livetrial"));
    const environment = liveTrialEnvironment(resolvedTemporary, tls.certificatePath);
    await runLiveTrial([
      "init-profile",
      "--profile", workspace.profilePath,
      "--producer-version", producerVersion,
    ], environment);
    await mkdir(workspace.reportRoot, { recursive: true });

    for (const identity of identities) {
      await authorizeDevice(
        workspace, environment, baseUrl, identity, sessions.get(identity.label),
      );
      progress(`identity ${identity.label} authorized the LiveTrial device`);
    }

    const initialListing = await listAccounts(workspace, environment);
    const slots = new Map();
    for (const identity of identities) {
      const row = initialListing.find((value) => value.playerId === identity.playerId);
      assert.ok(row !== undefined, `${identity.playerId} is not remembered`);
      slots.set(identity.label, row.slotId);
      summary.accounts[identity.label].slotId = row.slotId;
    }

    // ------------------------------------------------------------------ 1
    assert.equal(initialListing.length, 3);
    assert.equal(new Set(initialListing.map((row) => row.slotId)).size, 3);
    assert.deepEqual(
      initialListing.map((row) => row.expired).sort(),
      [false, false, false],
    );
    step(1, "all three accounts are remembered simultaneously and all are usable");

    // ------------------------------------------------------------------ 2
    assert.ok(Array.isArray(initialListing));
    assert.equal(initialListing.length, 3);
    for (const row of initialListing) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ["active", "addedAtMs", "expired", "lastUsedAtMs", "playerId", "slotId"],
      );
    }
    step(2, "the listing is a plain N-account list of 3 uniform rows (no two-account shape)");

    // ------------------------------------------------------------------ 3
    const cycle = ["A", "B", "C"];
    for (let round = 0; round < 2; round += 1) {
      for (const label of cycle) {
        const identity = identities.find((value) => value.label === label);
        await switchTo(workspace, environment, slots.get(label), identity.playerId);
      }
    }
    await switchTo(workspace, environment, slots.get("A"), "player.acceptance_a");
    step(3, "two full A->B->C cycles plus a return to A: the active account is correct every time");

    // ------------------------------------------------------------------ 4
    const activeBefore = (await listAccounts(workspace, environment))
      .find((row) => row.active === true);
    assert.equal(activeBefore.playerId, "player.acceptance_a");
    assert.equal(activeBefore.expired, false);
    const statusBefore = await runLiveTrial(
      ["session-status", ...accountArguments(workspace)], environment,
    );
    assert.match(statusBefore.stdout, /protected synchronization session is available/);
    assert.deepEqual(await listResults(workspace, environment), []);
    step(4, "the product reports player.acceptance_a as the active Player before anything is created");

    // ------------------------------------------------------------------ 5
    const firstA = await saveRun(workspace, environment, 11);
    assert.equal(firstA.playerId, "player.acceptance_a");
    assert.equal(firstA.ownerSlotId, slots.get("A"));
    assert.equal(firstA.state, "pending");
    step(5, `A created a pending entry owned by A (${firstA.entryKey.slice(0, 12)}...)`);

    // ------------------------------------------------------------------ 6
    await switchTo(workspace, environment, slots.get("B"), "player.acceptance_b");
    const firstB = await saveRun(workspace, environment, 12);
    assert.equal(firstB.playerId, "player.acceptance_b");
    assert.equal(firstB.ownerSlotId, slots.get("B"));
    assert.equal(firstB.state, "pending");
    step(6, `B created a pending entry owned by B (${firstB.entryKey.slice(0, 12)}...)`);

    // ------------------------------------------------------------------ 7
    await switchTo(workspace, environment, slots.get("C"), "player.acceptance_c");
    const firstC = await saveRun(workspace, environment, 13);
    assert.equal(firstC.playerId, "player.acceptance_c");
    assert.equal(firstC.ownerSlotId, slots.get("C"));
    assert.equal(firstC.state, "pending");
    step(7, `C created a pending entry owned by C (${firstC.entryKey.slice(0, 12)}...)`);

    // ------------------------------------------------------------------ 8
    await switchTo(workspace, environment, slots.get("A"), "player.acceptance_a");
    const beforeSync = await listResults(workspace, environment);
    assert.equal(beforeSync.length, 3);
    assert.deepEqual(
      beforeSync.map((row) => row.state).sort(),
      ["pending", "pending", "pending"],
    );
    step(8, "the active account was switched back to A while B's and C's entries were still pending");

    // ------------------------------------------------------------------ 9
    const firstSync = await syncAll(workspace, environment, baseUrl);
    assert.equal(firstSync.attempted, 3);
    assert.equal(firstSync.synced, 3, `sync-all did not deliver all three entries: ${JSON.stringify(firstSync)}`);
    assert.equal(firstSync.failed, 0);
    assert.equal(firstSync.skipped, 0);
    step(9, "sync-all ran once with A active and delivered all three entries");

    // ----------------------------------------------------------------- 10
    for (const [entry, label] of [[firstA, "A"], [firstB, "B"], [firstC, "C"]]) {
      const outcome = outcomeFor(firstSync, entry.entryKey);
      assert.equal(outcome.outcome, "synced");
      assert.equal(
        outcome.slotId,
        slots.get(label),
        `entry of ${label} was delivered by slot ${outcome.slotId}`,
      );
    }
    const firstRevisions = await submittedRevisions(pool);
    assert.equal(firstRevisions.size, 3, "MySQL must hold exactly three revisions so far");
    for (const [entry, label] of [[firstA, "A"], [firstB, "B"], [firstC, "C"]]) {
      const identity = identities.find((value) => value.label === label);
      const submissionId = assertOwnedInMysql(firstRevisions, entry, identity);
      summary.entries.push({
        batch: 1, account: label, entryKey: entry.entryKey,
        totalTimeMs: entry.totalTimeMs, playerId: identity.playerId, submissionId,
      });
      summary.contamination.push(
        `batch1 ${label}: revision player_id === ${identity.playerId}`,
      );
    }
    step(10, "MySQL confirms each revision's player_id: A->acceptance_a, B->acceptance_b, C->acceptance_c (no contamination)");

    // ----------------------------------------------------------------- 11
    // Prepared first, while B is still signed in: a player-bound B entry that is
    // deliberately left pending. After the expiry it is the entry that A and C
    // would have to be prevented from delivering.
    await switchTo(workspace, environment, slots.get("B"), "player.acceptance_b");
    const strandedB = await saveRun(workspace, environment, 20);
    assert.equal(strandedB.playerId, "player.acceptance_b");
    assert.equal(strandedB.ownerSlotId, slots.get("B"));
    assert.equal(strandedB.state, "pending");
    const expiredSlotPath = join(
      workspace.accountsRoot, `${slots.get("B")}.session.dat`,
    );
    await stat(expiredSlotPath);
    // Filesystem-only expiry: the product source is untouched.
    await writeFile(expiredSlotPath, Buffer.alloc(64, 0));
    const afterExpiry = await listAccounts(workspace, environment);
    assert.equal(afterExpiry.length, 3, "expiring a session must not forget the account");
    assert.equal(
      afterExpiry.find((row) => row.playerId === "player.acceptance_b").expired,
      true,
    );
    assert.equal(
      afterExpiry.find((row) => row.playerId === "player.acceptance_a").expired,
      false,
    );
    assert.equal(
      afterExpiry.find((row) => row.playerId === "player.acceptance_c").expired,
      false,
    );
    step(11, "B's protected session was destroyed on disk (B holds one player-bound pending entry); A and C are untouched and B is still remembered");

    // ----------------------------------------------------------------- 12
    await switchTo(workspace, environment, slots.get("A"), "player.acceptance_a");
    const secondA = await saveRun(workspace, environment, 21);
    assert.equal(secondA.playerId, "player.acceptance_a");
    // B can still record locally while signed out: capture stays local-first.
    await switchTo(workspace, environment, slots.get("B"), "player.acceptance_b");
    const statusB = await runLiveTrial(
      ["session-status", ...accountArguments(workspace)], environment,
    );
    assert.match(statusB.stdout, /signed out; local capture remains available/);
    const secondB = await saveRun(workspace, environment, 22);
    assert.equal(secondB.playerId, null, "a signed-out account records against its local profile");
    assert.equal(secondB.playerNamespace, "producer_local_profile");
    await switchTo(workspace, environment, slots.get("C"), "player.acceptance_c");
    const secondC = await saveRun(workspace, environment, 23);
    assert.equal(secondC.playerId, "player.acceptance_c");
    const secondSync = await syncAll(workspace, environment, baseUrl);
    assert.equal(outcomeFor(secondSync, secondA.entryKey).outcome, "synced");
    assert.equal(outcomeFor(secondSync, secondA.entryKey).slotId, slots.get("A"));
    assert.equal(outcomeFor(secondSync, secondC.entryKey).outcome, "synced");
    assert.equal(outcomeFor(secondSync, secondC.entryKey).slotId, slots.get("C"));
    step(12, "with B's session gone, sync-all delivered A's and C's new entries only");

    // ----------------------------------------------------------------- 13
    // The player-bound B entry: known owner, unusable credential.
    const strandedOutcome = outcomeFor(secondSync, strandedB.entryKey);
    assert.equal(strandedOutcome.outcome, "skipped");
    assert.equal(strandedOutcome.state, "pending");
    assert.equal(strandedOutcome.slotId, slots.get("B"));
    assert.equal(strandedOutcome.failureCode, "account.reauthorization_required");
    // The entry recorded while B was signed out: no owner may be inferred at all.
    const skippedB = outcomeFor(secondSync, secondB.entryKey);
    assert.equal(skippedB.outcome, "skipped");
    assert.equal(skippedB.state, "pending");
    assert.equal(skippedB.slotId, null);
    assert.equal(skippedB.failureCode, "account.local_profile_entry");
    const pendingAfterSecond = await listResults(workspace, environment);
    for (const entry of [strandedB, secondB]) {
      const surviving = pendingAfterSecond.find((row) => row.entryKey === entry.entryKey);
      assert.ok(surviving !== undefined, "a B entry disappeared from the local outbox");
      assert.equal(surviving.state, "pending");
    }
    const secondRevisions = await submittedRevisions(pool);
    assert.equal(secondRevisions.size, 5, "exactly five revisions may exist after batch two");
    for (const entry of [strandedB, secondB]) {
      assert.equal(
        secondRevisions.has(entry.totalTimeMs),
        false,
        "CONTAMINATION: a B entry reached MySQL while B's credential was unusable",
      );
    }
    const [rowsForB] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM time_trial_submission_revisions AS revision
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE revision.producer_version = ? AND player.public_id = ?`,
      [producerVersion, "player.acceptance_b"],
    );
    assert.equal(
      Number(rowsForB[0].total),
      1,
      "player.acceptance_b must still have only its first-batch submission",
    );
    summary.contamination.push(
      "batch2 B: both B entries stayed pending; no submission reached MySQL under A's or C's credential",
    );
    step(13, "B's entries stayed pending and retryable; MySQL holds no second-batch submission for player.acceptance_b");

    // ----------------------------------------------------------------- 14
    await authorizeDevice(
      workspace, environment, baseUrl,
      identities[1], sessions.get("B"),
    );
    const reauthorized = await listAccounts(workspace, environment);
    assert.equal(reauthorized.length, 3, "re-authorizing must replace, not duplicate");
    assert.equal(
      reauthorized.find((row) => row.playerId === "player.acceptance_b").expired,
      false,
    );
    assert.equal(
      reauthorized.find((row) => row.playerId === "player.acceptance_b").slotId,
      slots.get("B"),
    );
    step(14, "B re-authenticated through the same real device-authorization flow into the same slot");

    // ----------------------------------------------------------------- 15
    const thirdSync = await syncAll(workspace, environment, baseUrl);
    const recoveredOutcome = outcomeFor(thirdSync, strandedB.entryKey);
    assert.equal(
      recoveredOutcome.outcome,
      "synced",
      `B's entry did not synchronize after re-authentication: ${JSON.stringify(thirdSync)}`,
    );
    assert.equal(recoveredOutcome.slotId, slots.get("B"));
    // The run recorded while B was signed out is still not attributable, and the
    // product still refuses to attribute it to whoever is signed in now.
    const stillLocal = outcomeFor(thirdSync, secondB.entryKey);
    assert.equal(stillLocal.outcome, "skipped");
    assert.equal(stillLocal.failureCode, "account.local_profile_entry");
    const thirdRevisions = await submittedRevisions(pool);
    const recoveredSubmissionId = assertOwnedInMysql(
      thirdRevisions, strandedB, identities[1],
    );
    summary.entries.push({
      batch: 2, account: "B", entryKey: strandedB.entryKey,
      totalTimeMs: strandedB.totalTimeMs, playerId: "player.acceptance_b",
      submissionId: recoveredSubmissionId,
    });
    summary.contamination.push(
      "post-reauth B: revision player_id === player.acceptance_b",
    );
    for (const [entry, label] of [[secondA, "A"], [secondC, "C"]]) {
      const identity = identities.find((value) => value.label === label);
      const submissionId = assertOwnedInMysql(thirdRevisions, entry, identity);
      summary.entries.push({
        batch: 2, account: label, entryKey: entry.entryKey,
        totalTimeMs: entry.totalTimeMs, playerId: identity.playerId, submissionId,
      });
      summary.contamination.push(
        `batch2 ${label}: revision player_id === ${identity.playerId}`,
      );
    }
    step(15, "B's entry synced after re-authentication and landed under player.acceptance_b");

    // ----------------------------------------------------------------- 16
    await switchTo(workspace, environment, slots.get("C"), "player.acceptance_c");
    const orphanC = await saveRun(workspace, environment, 31);
    assert.equal(orphanC.playerId, "player.acceptance_c");
    assert.equal(orphanC.ownerSlotId, slots.get("C"));
    const removal = await runLiveTrial([
      "sign-out",
      "--api-origin", baseUrl,
      "--slot", slots.get("C"),
      ...accountArguments(workspace),
    ], environment);
    assert.match(removal.stdout, /synchronization session revoked/);
    step(16, "C was removed from the device through the product's own sign-out path");

    // ----------------------------------------------------------------- 17
    const afterRemoval = await listAccounts(workspace, environment);
    assert.equal(afterRemoval.length, 2);
    assert.deepEqual(
      afterRemoval.map((row) => row.playerId).sort(),
      ["player.acceptance_a", "player.acceptance_b"],
    );
    for (const row of afterRemoval) {
      assert.equal(row.expired, false, `${row.playerId} lost its session when C was removed`);
    }
    assert.equal(
      afterRemoval.some((row) => row.active === true),
      false,
      "removing the active account must not silently promote another account",
    );
    await switchTo(workspace, environment, slots.get("A"), "player.acceptance_a");
    const statusAfterRemoval = await runLiveTrial(
      ["session-status", ...accountArguments(workspace)], environment,
    );
    assert.match(
      statusAfterRemoval.stdout,
      /protected synchronization session is available/,
    );
    step(17, "A and B remain remembered with intact sessions after C was removed");

    // ----------------------------------------------------------------- 18
    const afterRemovalResults = await listResults(workspace, environment);
    const orphan = afterRemovalResults.find((row) => row.entryKey === orphanC.entryKey);
    assert.ok(orphan !== undefined, "C's pending entry was destroyed by removing C");
    assert.equal(orphan.state, "pending");
    assert.equal(orphan.playerId, "player.acceptance_c");
    assert.equal(orphan.ownerSlotId, slots.get("C"));
    const orphanSync = await syncAll(workspace, environment, baseUrl);
    const orphanOutcome = outcomeFor(orphanSync, orphanC.entryKey);
    assert.equal(orphanOutcome.outcome, "skipped");
    assert.equal(orphanOutcome.state, "pending");
    assert.equal(orphanOutcome.failureCode, "account.unknown_owner");
    const orphanRevisions = await submittedRevisions(pool);
    assert.equal(
      orphanRevisions.has(orphanC.totalTimeMs),
      false,
      "CONTAMINATION: C's orphaned entry was delivered while C was not on the device",
    );
    summary.contamination.push(
      "removed C: orphaned entry stayed owner-bound and was never delivered by A or B",
    );
    step(18, "C's pending entry survived the removal, stayed bound to C, and refused delivery by A or B");

    // ----------------------------------------------------------------- 19
    await authorizeDevice(
      workspace, environment, baseUrl,
      identities[2], sessions.get("C"),
    );
    const readded = await listAccounts(workspace, environment);
    assert.equal(readded.length, 3);
    assert.equal(
      readded.find((row) => row.playerId === "player.acceptance_c").slotId,
      slots.get("C"),
      "re-adding C must reuse C's deterministic slot",
    );
    assert.equal(
      readded.find((row) => row.playerId === "player.acceptance_c").expired,
      false,
    );
    step(19, "C was re-authorized through the real device flow and reoccupies its own slot");

    // ----------------------------------------------------------------- 20
    const finalSync = await syncAll(workspace, environment, baseUrl);
    const finalOutcome = outcomeFor(finalSync, orphanC.entryKey);
    assert.equal(
      finalOutcome.outcome,
      "synced",
      `C's entry did not synchronize after re-authorization: ${JSON.stringify(finalSync)}`,
    );
    assert.equal(finalOutcome.slotId, slots.get("C"));
    const finalRevisions = await submittedRevisions(pool);
    const orphanSubmissionId = assertOwnedInMysql(
      finalRevisions, orphanC, identities[2],
    );
    summary.entries.push({
      batch: 3, account: "C", entryKey: orphanC.entryKey,
      totalTimeMs: orphanC.totalTimeMs, playerId: "player.acceptance_c",
      submissionId: orphanSubmissionId,
    });
    summary.contamination.push(
      "post-readd C: revision player_id === player.acceptance_c",
    );
    const finalResults = await listResults(workspace, environment);
    assert.equal(
      finalResults.filter((row) => row.state === "pending" && row.playerId !== null).length,
      0,
      "every owner-bound entry must be delivered by now",
    );
    step(20, "C's pending entry synchronized normally after re-authorization and landed under player.acceptance_c");

    // --- closing evidence --------------------------------------------------
    const [ownership] = await pool.execute(
      `SELECT player.public_id AS playerId, COUNT(*) AS total
       FROM time_trial_submission_revisions AS revision
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE revision.producer_version = ?
       GROUP BY player.public_id
       ORDER BY player.public_id`,
      [producerVersion],
    );
    assert.deepEqual(
      ownership.map((row) => ({ playerId: String(row.playerId), total: Number(row.total) })),
      [
        { playerId: "player.acceptance_a", total: 2 },
        { playerId: "player.acceptance_b", total: 2 },
        { playerId: "player.acceptance_c", total: 3 },
      ],
      "final per-Player submission ownership is wrong",
    );
    assert.equal(mailer.sendCalls, delivered.length);
    assert.equal(mailer.sendCalls, 3, "only the three in-process magic links were produced");
    const inspectedFiles = await assertNoLooseCredentials(workspace);

    summary.mailer = {
      stubbed: true,
      emailsSent: 0,
      magicLinksCapturedInProcess: delivered.length,
    };
    summary.localCredentialHygiene = {
      filesInspectedOutsideProtectedStore: inspectedFiles,
      bearerTokensFoundOutsideProtectedStore: 0,
    };
    summary.entriesCreated = summary.entries.length + 1; // + the local-profile entry
    summary.entriesSynced = summary.entries.length;
    summary.pinnedMigrations = expectedMigrations;
    summary.steps = stepResults.length;

    console.log("");
    console.log("SHARED-DEVICE MULTI-ACCOUNT ACCEPTANCE SUMMARY");
    console.log(JSON.stringify(summary, null, 2));
    console.log("");
    console.log("Shared-device multi-account isolation proved for LiveTrial Desktop.");
  } finally {
    await browser?.close().catch(() => undefined);
    await runtime?.close().catch(() => undefined);
    await closeServer(gateway?.server).catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (resolvedTemporary.startsWith(temporaryPrefix)) {
      await rm(resolvedTemporary, { recursive: true, force: true });
    }
  }
}

await main();
