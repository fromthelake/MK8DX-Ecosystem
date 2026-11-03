import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, lstatSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";
import { chromium } from "playwright";

import { AdministratorGrantService } from
  "../dist/administration/administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from
  "../dist/administration/mysql-administrator-grant-repository.js";
import { createPasswordlessHostedRuntime } from
  "../dist/composition/hosted-runtime.js";


const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const webRoot = resolve(repositoryRoot, "apps/timetrials-web");
const temporaryPrefix = join(resolve(tmpdir()), "mk8dx-web-product-");
const email = "browser-product@example.test";
let playerId = "player.synthetic_web_browser_01";
let claimId = "player_claim.synthetic_web_browser_01";
const tournamentRaceResultId = "tournament_race_result.synthetic_web_browser_01";
const pinnedMigrationCatalogLength = JSON.parse(readFileSync(
  resolve(repositoryRoot, "infrastructure/mysql/migration-catalog-v1.json"),
  "utf8",
)).migrations.length;
const webOnly = process.env.MK8DX_TEST_WEB_ONLY === "1";
const skipAndroid = process.env.MK8DX_TEST_SKIP_ANDROID === "1";
const securityHeaders = Object.freeze({
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});
const unavailablePrivateAssetConsoleError =
  "Failed to load resource: the server responded with a status of 404 (Not Found)";
// Chromium refuses to install a service worker from this gate's intentionally
// self-signed one-process HTTPS origin even when the page context accepts that
// certificate. Production uses a trusted certificate and is checked separately.
const unavailableSelfSignedServiceWorkerConsoleError =
  "An SSL certificate error occurred when fetching the script.";

function relevantBrowserErrors(messages) {
  return messages.filter((message) =>
    message !== unavailablePrivateAssetConsoleError &&
    message !== unavailableSelfSignedServiceWorkerConsoleError);
}

function fail(message) {
  throw new Error(`Live web product validation failed: ${message}`);
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
    connectionLimit: 2,
  };
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
      if (Buffer.byteLength(stdout, "utf8") > 64 * 1024) {
        child.kill();
        return;
      }
      onStdout(stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > 64 * 1024) { child.kill(); }
    });
    child.once("error", () => reject(
      new Error("LiveTrial product process could not start."),
    ));
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal !== null) {
        reject(new Error("LiveTrial product process failed."));
        return;
      }
      accept({ stdout, stderr });
    });
  });
  return { child, completion };
}

function runChecked(executable, arguments_, options = {}) {
  const result = spawnSync(executable, arguments_, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error !== undefined) {
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .trim()
      .slice(-8_192);
    fail(`${options.label ?? executable} failed${diagnostic ? `:\n${diagnostic}` : ""}`);
  }
  return String(result.stdout ?? "");
}

function androidEnvironment() {
  const adb = process.env.MK8DX_TEST_ANDROID_ADB ?? "";
  const project = process.env.MK8DX_TEST_ANDROID_PROJECT ?? "";
  if (!adb || !project || !lstatSync(adb).isFile() || !lstatSync(project).isDirectory()) {
    fail("the Android validation environment is unavailable");
  }
  const devices = runChecked(adb, ["devices"], { label: "adb device lookup" })
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && parts[1] === "device");
  if (devices.length !== 1 || !devices[0][0].startsWith("emulator-")) {
    fail("exactly one ready Android emulator is required");
  }
  return { adb, project, serial: devices[0][0] };
}

function buildAndInstallAndroid(android, baseUrl, certificatePath) {
  const java = resolve(process.env.JAVA_HOME ?? "", "bin/java.exe");
  const wrapper = resolve(android.project, "gradle/wrapper/gradle-wrapper.jar");
  if (!lstatSync(java).isFile() || !lstatSync(wrapper).isFile()) {
    fail("the Android Gradle JDK/wrapper is unavailable");
  }
  runChecked(java, [
    "-classpath", wrapper,
    "org.gradle.wrapper.GradleWrapperMain",
    ":app:assembleDebug",
    ":app:assembleDebugAndroidTest",
    "-PenableScanRuntime=true",
    `-Pmk8dxApiOrigin=${baseUrl}`,
    `-Pmk8dxDebugCaCertificate=${certificatePath}`,
  ], { cwd: android.project, label: "Android live product build" });
  const application = resolve(
    android.project,
    "app/build/outputs/apk/debug/app-debug.apk",
  );
  const tests = resolve(
    android.project,
    "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
  );
  if (!lstatSync(application).isFile() || !lstatSync(tests).isFile()) {
    fail("Android live product APKs were not produced");
  }
  spawnSync(android.adb, ["-s", android.serial, "shell", "pm", "clear",
    "nl.mariokart8.mk8dxtimetrials"], {
    shell: false, windowsHide: true, stdio: "ignore",
  });
  runChecked(android.adb, ["-s", android.serial, "install", "-r", application], {
    label: "Android application installation",
  });
  runChecked(android.adb, ["-s", android.serial, "install", "-r", tests], {
    label: "Android instrumentation installation",
  });
}

function startAndroidInstrumentation(android, baseUrl) {
  const child = spawn(android.adb, [
    "-s", android.serial,
    "shell", "am", "instrument", "-w", "-r",
    "-e", "class",
    "nl.mariokart8.mk8dxtimetrials.LiveHostedAndroidProductDeviceTest",
    "-e", "mk8dxLiveOrigin", baseUrl,
    "nl.mariokart8.mk8dxtimetrials.test/androidx.test.runner.AndroidJUnitRunner",
  ], {
    cwd: repositoryRoot,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const completion = new Promise((accept, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => reject(
      new Error("Android instrumentation could not start."),
    ));
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal !== null || !stdout.includes("OK (1 test)")) {
        reject(new Error(`Android instrumentation failed. ${stdout} ${stderr}`));
        return;
      }
      accept({ stdout, stderr });
    });
  });
  return { child, completion };
}

async function waitForAndroidApprovalUrl(android, instrumentation) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (instrumentation.child.exitCode !== null) {
      await instrumentation.completion;
      fail("Android instrumentation ended before device approval");
    }
    const result = spawnSync(android.adb, [
      "-s", android.serial, "shell", "run-as",
      "nl.mariokart8.mk8dxtimetrials", "cat",
      "files/live-product-approval-url.txt",
    ], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024,
    });
    const value = String(result.stdout ?? "").trim();
    if (result.status === 0 && /^https:\/\/127\.0\.0\.1:\d+\/device\?/u.test(value)) {
      return value;
    }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  instrumentation.child.kill();
  fail("Android device approval URL was not produced");
}

async function runLiveTrial(arguments_, environment) {
  return startLiveTrial(arguments_, environment).completion;
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
  if (!server.listening) { return; }
  await new Promise((accept, reject) => {
    server.close((error) => error === undefined ? accept() : reject(error));
  });
}

async function waitForAccount(pool) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [rows] = await pool.execute(
      `SELECT account.public_id AS accountId
       FROM restricted_authentication_bindings AS binding
       INNER JOIN user_accounts AS account
         ON account.user_account_id = binding.user_account_id
       WHERE binding.issuer_key = 'mk8dx_passwordless_v1'`,
    );
    if (rows.length === 1) { return String(rows[0].accountId); }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  fail("verified UserAccount provisioning did not complete");
}

async function main() {
  const temporary = await mkdtemp(temporaryPrefix);
  const resolvedTemporary = resolve(temporary);
  if (!resolvedTemporary.startsWith(temporaryPrefix)) {
    fail("temporary TLS directory escaped the OS temporary root");
  }
  let gateway;
  let runtime;
  let pool;
  let browser;
  let android;
  let androidReversePort;
  const delivered = [];
  const browserErrors = [];
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
    assert.equal(migrations.length, pinnedMigrationCatalogLength);

    runtime = await createPasswordlessHostedRuntime({
      core: {
        mysql: mysqlConfig,
        schema9CatalogPath: resolve(
          repositoryRoot,
          "packages/assets/schema9-asset-catalog-v1.json",
        ),
        authenticationKeys: {
          lookupHmacKey: Buffer.alloc(32, 21),
          lookupKeyVersion: "browser-auth-v1",
        },
        timeTrialKeys: {
          encryptionKey: Buffer.alloc(32, 22),
          encryptionKeyVersion: "browser-tt-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 23),
          lookupKeyVersion: "browser-tt-lookup-v1",
        },
        timeTrialDecryptionKeys: {
          "browser-tt-enc-v1": Buffer.alloc(32, 22),
        },
        tournamentKeys: {
          encryptionKey: Buffer.alloc(32, 24),
          encryptionKeyVersion: "browser-tournament-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 25),
          lookupKeyVersion: "browser-tournament-lookup-v1",
        },
        tournamentDecryptionKeys: {
          "browser-tournament-enc-v1": Buffer.alloc(32, 24),
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
        host: "smtp.example.test",
        port: 465,
        secure: true,
        username: "synthetic-user",
        password: "synthetic-password",
        fromAddress: "auth@example.test",
        allowedLinkOrigin: baseUrl,
      },
      webManual: {
        producerVersion: "timetrials-web-browser-product",
        csrfKeys: {
          activeKeyVersion: "browser-csrf-v1",
          keys: { "browser-csrf-v1": Buffer.alloc(32, 26) },
        },
      },
      tournamentSubmissionAuthorizer: {
        async authorize(context) {
          return context.actor.role === "administrator";
        },
      },
    }, () => ({
      async verify() {},
      async sendMagicLink(message) { delivered.push(message); },
      close() {},
    }));
    const backendAddress = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    gateway.setBackendPort(Number(new URL(backendAddress).port));

    const channel = process.env.MK8DX_TEST_BROWSER_CHANNEL ?? "msedge";
    if (!new Set(["msedge", "chrome"]).has(channel)) {
      fail("browser channel must be msedge or chrome");
    }
    browser = await chromium.launch({ channel, headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") { browserErrors.push(message.text()); }
    });
    page.on("pageerror", () => browserErrors.push("page"));

    const landing = await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert.equal(landing?.status(), 200);
    for (const [name, expected] of Object.entries(securityHeaders)) {
      assert.equal((await landing.allHeaders())[name], expected);
    }
    // Return destinations must not be able to escape the product. A request
    // carrying external callbacks is either refused outright, or its link
    // still lands on this origin — never on the attacker's.
    const beforeTamper = delivered.length;
    const tampered = await context.request.post(
      `${baseUrl}/api/auth/sign-in/magic-link`,
      {
        data: {
          email: "tamper@example.test",
          callbackURL: "https://evil.example/",
          newUserCallbackURL: "https://evil.example/new",
          errorCallbackURL: "https://evil.example/error",
        },
        headers: { origin: baseUrl, referer: `${baseUrl}/` },
      },
    );
    if (tampered.status() === 200 && delivered.length > beforeTamper) {
      const tamperPage = await context.newPage();
      try {
        await tamperPage.goto(delivered.at(-1).url).catch(() => undefined);
        assert.equal(
          new URL(tamperPage.url()).origin,
          new URL(baseUrl).origin,
          "a tampered external callback escaped the product origin",
        );
      } finally {
        await tamperPage.close();
      }
      await context.clearCookies();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
    } else {
      // Refused outright, or answered without sending anything: either way
      // no link carrying an external destination exists.
      assert.equal(delivered.length, beforeTamper);
    }

    const beforeFirst = delivered.length;
    await page.locator('input[type="email"]').fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await page.getByText("If that address can receive mail").waitFor();
    assert.equal(delivered.length, beforeFirst + 1);
    const firstSignInUrl = delivered.at(-1).url;
    await page.goto(firstSignInUrl, { waitUntil: "networkidle" });
    // A brand-new account lands on the focused welcome route (ADR-0180).
    assert.ok(new URL(page.url()).search.includes("welcome=1"));
    await page.getByRole("link", { name: "Settings" }).waitFor();
    assert.equal((await page.locator("body").textContent()).includes(email), false);
    const cookies = await context.cookies();
    assert.ok(cookies.some((cookie) => cookie.secure && cookie.httpOnly &&
      cookie.sameSite === "Lax"));

    const provisioningProof = await context.request.get(`${baseUrl}/v1/session/csrf`);
    assert.equal(provisioningProof.status(), 200);
    const accountId = await waitForAccount(pool);
    // One unrelated Player proves that a colliding display name is explained
    // on the exact field instead of becoming a generic onboarding failure.
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES ('player.synthetic_onboarding_existing', 1, 'human',
               'Existing Test Racer', 'active', 1, 1)`,
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1, 'existing_racer', ?, 1
       FROM players WHERE public_id = 'player.synthetic_onboarding_existing'`,
      [Buffer.from("existing_racer")],
    );

    // The welcome route loads the Player directory once at mount, so the
    // collision seeded above becomes visible after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "What should we call you?" }).waitFor();
    const racingName = page.getByLabel("Your racing name");
    const createPlayer = page.getByRole("button", { name: "Create my Player" });
    await createPlayer.click();
    await page.getByText("Tell us what to call you.", { exact: true }).waitFor();
    await racingName.fill("Existing Test Racer");
    await createPlayer.click();
    await page.getByText("A Player already races under that name").first().waitFor();
    await racingName.fill("Synthetic Browser Product Racer");
    // The handle is derived and disclosed; choosing one by hand stays one
    // click away, and this gate's later queries expect browser_racer.
    await page.getByText("You'll be @synthetic_browse", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Choose my @handle myself" }).click();
    await page.getByLabel("Your @handle").fill("browser_racer");
    await page.getByText("You'll be @browser_racer", { exact: true }).waitFor();
    await page.locator('.welcome input[value="private"]').check();
    await createPlayer.click();
    await page.getByRole("heading", {
      name: "You're in, Synthetic Browser Product Racer",
    }).waitFor();

    const [createdPlayers] = await pool.execute(
      `SELECT player.public_id AS playerId, claim.public_id AS claimId,
              player.visibility AS visibility
       FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id
       INNER JOIN player_claims AS claim ON claim.player_id = player.player_id
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE username.comparison_key = ? AND account.public_id = ?
         AND claim.claim_status = 'verified'`,
      [Buffer.from("browser_racer"), accountId],
    );
    assert.equal(createdPlayers.length, 1);
    playerId = String(createdPlayers[0].playerId);
    claimId = String(createdPlayers[0].claimId);
    assert.equal(createdPlayers[0].visibility, "private");

    // Step 2: three optional preferences behind one Save, landing on the new
    // Player's profile.
    await page.getByLabel("Country").selectOption("country.nl");
    await page.getByLabel("Favourite character").selectOption("character.yoshi");
    await page.getByLabel("Which engine class do you care about?").selectOption("200");
    await page.getByRole("button", { name: "Save and finish" }).click();
    await page.waitForURL((url) => url.search.includes("player=browser_racer"));
    await page.getByRole("heading", { name: "Player profile", level: 1 }).waitFor();
    const [onboardedProfile] = await pool.execute(
      `SELECT country_id AS countryId, avatar_id AS favoriteCharacterId
       FROM players WHERE public_id = ?`,
      [playerId],
    );
    assert.deepEqual(onboardedProfile.map((row) => ({
      countryId: row.countryId,
      favoriteCharacterId: row.favoriteCharacterId,
    })), [{ countryId: "country.nl", favoriteCharacterId: "character.yoshi" }]);

    // Everything else stays in Settings, which is Settings again.
    await page.goto(`${baseUrl}/?settings=1`, { waitUntil: "networkidle" });
    const visibilitySection = page.locator(".player-visibility");
    await visibilitySection.getByLabel("Public Player").check();
    await visibilitySection.getByRole("button", { name: "Save" }).click();
    await visibilitySection.getByText(
      "Saved. You are a Public Player.",
      { exact: true },
    ).waitFor();

    // Each visible Save button changes only its own field. Unsaved siblings
    // stay in the controls and do not leak into the atomic API document.
    const mode = page.getByLabel("Relevant engine classes (optional)");
    const screenName = page.getByLabel("Screen name (optional)");
    await screenName.fill("Unsaved Screen");
    await mode.selectOption("200");
    await page.getByRole("button", {
      name: "Save Time Trial preference",
    }).click();
    await page.getByText(
      "Saved. Home and notifications now use this preference.",
      { exact: true },
    ).waitFor();
    let [accountPreferences] = await pool.execute(
      `SELECT time_trial_mode_preference AS modePreference,
              screen_name AS screenName
       FROM user_accounts WHERE public_id = ?`,
      [accountId],
    );
    assert.deepEqual(accountPreferences.map((row) => ({
      modePreference: row.modePreference,
      screenName: row.screenName,
    })), [{ modePreference: "200", screenName: null }]);
    await mode.selectOption("150");
    await screenName.fill("Saved Screen");
    await page.getByRole("button", { name: "Save screen name" }).click();
    await page.getByText(
      "Screen name saved. The engine-class field was not changed.",
      { exact: true },
    ).waitFor();
    [accountPreferences] = await pool.execute(
      `SELECT time_trial_mode_preference AS modePreference,
              screen_name AS screenName
       FROM user_accounts WHERE public_id = ?`,
      [accountId],
    );
    assert.deepEqual(accountPreferences.map((row) => ({
      modePreference: row.modePreference,
      screenName: row.screenName,
    })), [{ modePreference: "200", screenName: "Saved Screen" }]);

    // Country is a real dropdown (ADR-0180): an invalid value such as the
    // old "Atlantis" free-text case is no longer representable at all.
    const country = page.getByLabel("Country (optional)");
    await country.selectOption("country.nl");
    await page.getByRole("button", { name: "Save country" }).click();
    await page.getByText(
      "Country saved. Other fields were not changed.",
      { exact: true },
    ).waitFor();
    await page.getByLabel("Character (optional)").selectOption("character.yoshi");
    await page.getByRole("button", { name: "Save character" }).click();
    await page.getByText(
      "Character saved. Other fields were not changed.",
      { exact: true },
    ).waitFor();
    const [savedProfile] = await pool.execute(
      `SELECT country_id AS countryId,
              avatar_id AS favoriteCharacterId,
              favorite_body_id AS favoriteBodyId
       FROM players WHERE public_id = ?`,
      [playerId],
    );
    assert.deepEqual(savedProfile.map((row) => ({
      countryId: row.countryId,
      favoriteCharacterId: row.favoriteCharacterId,
      favoriteBodyId: row.favoriteBodyId,
    })), [{
      countryId: "country.nl",
      favoriteCharacterId: "character.yoshi",
      favoriteBodyId: null,
    }]);

    const additionalContext = async () => {
      const created = await browser.newContext({ ignoreHTTPSErrors: true });
      const createdPage = await created.newPage();
      createdPage.on("console", (message) => {
        if (message.type() === "error") { browserErrors.push(message.text()); }
      });
      createdPage.on("pageerror", () => browserErrors.push("page"));
      return { context: created, page: createdPage };
    };

    // B: a brand-new person intercepted by the protected Apps download. The
    // sign-in control carries the destination, onboarding keeps it, and the
    // errand finishes back on Apps — not on the fresh profile.
    {
      const { context: bContext, page: bPage } = await additionalContext();
      try {
        await bPage.goto(`${baseUrl}/?apps=1`, { waitUntil: "networkidle" });
        const deliveredBefore = delivered.length;
        await bPage.locator("section.app-downloads a").click();
        await bPage.waitForURL((url) =>
          url.search.includes("signin=1") &&
          url.search.includes("return=%2F%3Fapps%3D1"));
        await bPage.locator('input[type="email"]')
          .fill("browser-onboarding-b@example.test");
        await bPage.getByRole("button", { name: "Email me a link" }).click();
        await bPage.getByText("If that address can receive mail").waitFor();
        assert.equal(delivered.length, deliveredBefore + 1);
        await bPage.goto(delivered.at(-1).url, { waitUntil: "networkidle" });
        await bPage.waitForURL((url) => url.search.includes("welcome=1"));
        await bPage.getByLabel("Your racing name").fill("Browser Racer B");
        await bPage.getByText("You'll be @browser_racer_b", { exact: true }).waitFor();
        await bPage.getByRole("button", { name: "Create my Player" }).click();
        await bPage.getByRole("heading", { name: "You're in, Browser Racer B" }).waitFor();
        await bPage.getByRole("button", { name: "Skip for now" }).click();
        await bPage.waitForURL((url) => url.search === "?apps=1");
        // The interrupted download offer is now open, not asking again.
        await bPage.getByRole("heading", { name: "Apps" }).waitFor();
        assert.equal(
          (await bPage.locator("body").textContent())
            .includes("Sign in to download the MK8DX apps."),
          false,
        );
      } finally {
        await bContext.close();
      }
    }

    // C: a new account that belongs to an existing Player uses the explicit
    // find-and-claim path; nothing is merged automatically.
    {
      const { context: cContext, page: cPage } = await additionalContext();
      try {
        await cPage.goto(baseUrl, { waitUntil: "networkidle" });
        const deliveredBefore = delivered.length;
        await cPage.locator('input[type="email"]')
          .fill("browser-onboarding-c@example.test");
        await cPage.getByRole("button", { name: "Email me a link" }).click();
        await cPage.getByText("If that address can receive mail").waitFor();
        assert.equal(delivered.length, deliveredBefore + 1);
        await cPage.goto(delivered.at(-1).url, { waitUntil: "networkidle" });
        await cPage.waitForURL((url) => url.search.includes("welcome=1"));
        await cPage.getByRole("button", {
          name: "I've raced at these tournaments before",
        }).click();
        // The typeahead only re-renders on input, so wait for the directory.
        await cPage.getByText("Loading the Player list…")
          .waitFor({ state: "hidden" });
        await cPage.getByLabel("Your name").fill("Existing");
        await cPage.getByRole("option", { name: /Existing Test Racer/u }).click();
        await cPage.getByRole("button", { name: "Yes, that's me" }).click();
        await cPage.getByRole("heading", { name: "Request sent" }).waitFor();
      } finally {
        await cContext.close();
      }
    }

    const [syntheticOnboardingAccounts] = await pool.execute(
      `SELECT COUNT(*) AS matches
       FROM mk8dx_auth_user
       WHERE email IN (?, ?, ?)`,
      [email, "browser-onboarding-b@example.test", "browser-onboarding-c@example.test"],
    );
    assert.equal(Number(syntheticOnboardingAccounts[0].matches), 3);
    const [syntheticVerifiedClaims] = await pool.execute(
      `SELECT COUNT(*) AS matches
       FROM player_claims
       WHERE claim_status = 'verified'`,
    );
    assert.equal(Number(syntheticVerifiedClaims[0].matches), 2);
    const [syntheticRequestedClaims] = await pool.execute(
      `SELECT COUNT(*) AS matches
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       WHERE claim.claim_status = 'requested'
         AND player.public_id = 'player.synthetic_onboarding_existing'`,
    );
    assert.equal(Number(syntheticRequestedClaims[0].matches), 1);

    // A dead link says so. The first link was consumed above; opening it
    // again while signed out must land on the explanation, not silently on
    // the marketing page.
    await page.goto(`${baseUrl}/?settings=1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByText("Sign in, or start racing with us").waitFor();
    await page.goto(firstSignInUrl, { waitUntil: "networkidle" });
    await page.waitForURL((url) => url.search.includes("authError=1"));
    await page.getByText("That link did not work").waitFor();

    // A returning Player interrupted at a track page comes back to that
    // exact track and mode, where the entry field now exists.
    await page.goto(
      `${baseUrl}/?leaderboard=track.mario_kart_stadium&mode=150`,
      { waitUntil: "networkidle" },
    );
    const deliveredBeforeReturn = delivered.length;
    await page.getByRole("link", {
      name: "Sign in to record your own time on this track",
    }).click();
    await page.waitForURL((url) => url.search.includes("signin=1"));
    await page.getByText("After signing in you continue where you left off.").waitFor();
    await page.locator('input[type="email"]').fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await page.getByText("If that address can receive mail").waitFor();
    assert.equal(delivered.length, deliveredBeforeReturn + 1);
    await page.goto(delivered.at(-1).url, { waitUntil: "networkidle" });
    await page.waitForURL((url) =>
      url.search.includes("leaderboard=track.mario_kart_stadium") &&
      url.search.includes("mode=150"));
    await page.locator('input[aria-label="Time digits"]').waitFor();

    const administratorService = new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      {
        newAdministratorGrantId() {
          return "administrator_grant.synthetic_web_browser_01";
        },
      },
      { nowMs: () => 1_899_999_998_000 },
    );
    await administratorService.bootstrapFirstAdministrator(accountId);
    // Initial signed-in rendering occurs before this synthetic Player/claim setup
    // and may legitimately receive not-yet-eligible product responses. From this
    // point onward the complete Phase 6 product must stay console-clean.
    browserErrors.length = 0;

    await page.goto(`${baseUrl}/?submit=1`, { waitUntil: "networkidle" });
    await page.getByRole("searchbox", { name: "Search tracks" })
      .fill("Mario Kart Stadium");
    await page.getByRole("link", { name: "Mario Kart Stadium" }).click();
    const timeInput = page.locator('input[aria-label="Time digits"]');
    await timeInput.waitFor();
    await timeInput.fill("123456");
    await page.getByText("Optional lap, coins, mushrooms and kart details", { exact: true })
      .click();
    await page.getByLabel("Lap 1 time digits").fill("027000");
    await page.getByLabel("Lap 2 time digits").fill("027500");
    await page.getByLabel("Lap 3 time digits").fill("028956");
    await page.getByLabel("Lap 1 coins").fill("4");
    await page.getByLabel("Lap 2 coins").fill("3");
    await page.getByLabel("Lap 3 coins").fill("3");
    await page.getByLabel("Lap 1 mushrooms").selectOption("1");
    await page.getByLabel("Lap 2 mushrooms").selectOption("0");
    await page.getByLabel("Lap 3 mushrooms").selectOption("2");
    await page.getByLabel("Character").selectOption("character.yoshi");
    await page.getByLabel("Body").selectOption("body.mr_scooty");
    await page.getByLabel("Tires").selectOption("tire.roller");
    await page.getByLabel("Glider").selectOption("glider.cloud_glider");
    await page.getByRole("button", { name: "Submit 150cc" }).click();
    await page.getByRole("button", { name: "Tap again" }).click();
    await page.getByRole("status").filter({
      hasText: /Canonical submission published|Publication failed|not accepted|Complete every lap/u,
    }).first().waitFor();
    const manualStatuses = await page.getByRole("status").allTextContents();
    assert.ok(
      manualStatuses.includes("Canonical submission published."),
      `manual publication did not succeed: ${manualStatuses.join(" | ")}`,
    );
    const [submissionRows] = await pool.execute(
      `SELECT submission.public_id AS submissionId,
              revision.track_id AS trackId,
              revision.mode_cc AS mode,
              revision.total_time_ms AS totalTimeMs,
              revision.source_kind AS sourceKind,
              player.public_id AS playerId
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_id = submission.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE player.public_id = ? AND revision.producer_version = ?`,
      [playerId, "timetrials-web-browser-product"],
    );
    assert.deepEqual(submissionRows.map((row) => ({
      submissionId: String(row.submissionId),
      trackId: row.trackId,
      mode: row.mode,
      totalTimeMs: row.totalTimeMs,
      sourceKind: row.sourceKind,
      playerId: row.playerId,
    })), [{
      submissionId: submissionRows[0]?.submissionId,
      trackId: "track.mario_kart_stadium",
      mode: 150,
      totalTimeMs: 83_456,
      sourceKind: "web_manual",
      playerId,
    }]);
    assert.match(String(submissionRows[0].submissionId), /^user_submission\.time\./);

    const activityResponse = await context.request.get(
      `${baseUrl}/v1/public/activity-stories`,
    );
    assert.equal(activityResponse.status(), 200);
    const activity = await activityResponse.json();
    const browserStory = activity.stories.find(
      (story) => story.player.playerId === playerId,
    );
    assert.deepEqual(browserStory.runDetails[0].laps, [
      { lapNumber: 1, timeMs: 27_000, coinsCollected: 4, mushroomsUsed: 1 },
      { lapNumber: 2, timeMs: 27_500, coinsCollected: 7, mushroomsUsed: 0 },
      { lapNumber: 3, timeMs: 28_956, coinsCollected: 10, mushroomsUsed: 2 },
    ]);
    assert.deepEqual(browserStory.runDetails[0].loadout, {
      characterId: "character.yoshi",
      bodyId: "body.mr_scooty",
      tireId: "tire.roller",
      gliderId: "glider.cloud_glider",
    });

    const tournamentResponse = await context.request.post(
      `${baseUrl}/v1/tournament-race-results`,
      { data: {
        schemaVersion: "mk8dx.tournament-race-result.v1",
        raceResultId: tournamentRaceResultId,
        revision: 1,
        raceNumber: 1,
        scoringSegment: 1,
        mode: 150,
        trackId: "track.mario_kart_stadium",
        countsTowardStandings: true,
        placements: [{
          finishPosition: 1,
          participantReference: { namespace: "player", value: playerId },
          scoring: {
            racePoints: 15,
            totalBeforeRace: 0,
            totalAfterRace: 15,
            rankAfterRace: 1,
          },
        }],
        source: {
          kind: "tournament_recorded_video",
          transport: "native_contract",
          producerVersion: "phase6-browser-product",
        },
        timestamps: { createdAtMs: 1_899_999_999_000 },
      } },
    );
    assert.equal(tournamentResponse.status(), 201);
    assert.deepEqual(await tournamentResponse.json(), {
      raceResultId: tournamentRaceResultId,
      revision: 1,
    });

    await page.goto(`${baseUrl}/?admin=1`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Tournaments" }).click();
    const publication = page.locator(".tournament-publication");
    await publication.getByText(
      "1 current canonical race result available for review.",
      { exact: true },
    ).waitFor();
    await publication.getByLabel("Public event name").fill("Synthetic Browser Cup");
    await publication.getByLabel("Audit reason code").fill("event_completed");
    await publication.locator('input[type="checkbox"]').check();
    await publication.getByRole("button", { name: "Publish selected results" }).click();
    await publication.getByRole("option", {
      name: "Synthetic Browser Cup · published · revision 1",
    }).waitFor({ state: "attached" });
    const [publicationRows] = await pool.execute(
      `SELECT public_id AS publicationId FROM tournament_publications
       WHERE event_name = 'Synthetic Browser Cup' AND publication_status = 'published'`,
    );
    assert.equal(publicationRows.length, 1);
    const publicationId = String(publicationRows[0].publicationId);

    await page.goto(`${baseUrl}/?player=${encodeURIComponent(playerId)}&tab=timetrials`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "Verified Time Trials" }).waitFor();
    await page.getByRole("heading", { name: "Published Tournaments" }).waitFor();
    await page.getByRole("link", { name: "Synthetic Browser Cup" }).waitFor();
    const publicProfileText = await page.locator("body").textContent();
    assert.equal(publicProfileText.includes(email), false);
    assert.equal(publicProfileText.includes("initial_owner_bootstrap"), false);
    await page.getByRole("link", { name: "Synthetic Browser Cup" }).click();
    await page.waitForURL(`${baseUrl}/?tournament=${encodeURIComponent(publicationId)}`);
    await page.getByRole("heading", { name: "Segment 1 standings" }).waitFor();
    await page.getByRole("link", {
      name: "Synthetic Browser Product Racer",
      exact: true,
    }).waitFor();

    // ADR-0177 Step 0 on the Web: the administrator picks the acting
    // director from the capability-filtered list. The list must not be the
    // Player directory, free text and the PIN affordance are gone, and the
    // choice gates Step 1.
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES ('user_account.synthetic_director_evan', 1, 'private', 'active', 1, 1)`,
    );
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES ('player.synthetic_director_evan', 1, 'human', 'Evan Director',
               'active', 1, 1)`,
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1, 'evan_director', ?, 1
       FROM players WHERE public_id = 'player.synthetic_director_evan'`,
      [Buffer.from("evan_director")],
    );
    await pool.execute(
      `INSERT INTO player_claims (
         public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms
       )
       SELECT 'player_claim.synthetic_director_evan', 1, 'private',
              player.player_id, account.user_account_id, 'verified', 'none', 1, 1
       FROM players AS player
       CROSS JOIN user_accounts AS account
       WHERE player.public_id = 'player.synthetic_director_evan'
         AND account.public_id = 'user_account.synthetic_director_evan'`,
    );
    // The capability itself is granted through the audited administrator
    // route, not by writing the grant row directly.
    const capabilityProof = await (await context.request.get(`${baseUrl}/v1/session/csrf`)).json();
    const capabilityGrant = await context.request.post(
      `${baseUrl}/v1/administrator/tournament-operation-capabilities`,
      {
        headers: { [capabilityProof.headerName]: capabilityProof.value },
        data: {
          userAccountId: "user_account.synthetic_director_evan",
          reasonCode: "step0_browser_gate",
        },
      },
    );
    assert.equal(capabilityGrant.ok(), true);

    await page.goto(`${baseUrl}/?tournaments=all&operate=1`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Stap 0: Toernooi Directeur", level: 2 }).waitFor();
    await page.getByText(
      "Toegang tot toernooibediening hangt aan je ingelogde account, niet aan een PIN.",
      { exact: true },
    ).waitFor();
    const directorSelect = page.getByRole("combobox", { name: "Kies directeur" });
    const offeredDirectors = await directorSelect.locator("option").allTextContents();
    // Exactly the placeholder plus the two accounts that may direct; no
    // Player-directory names, no "Nieuwe directeur…" free-text entry.
    assert.deepEqual(
      offeredDirectors.sort(),
      ["Evan Director", "Kies directeur", "Synthetic Browser Product Racer"].sort(),
    );
    const stepForward = page.getByRole("button", { name: "Verder naar Stap 1" });
    assert.equal(await stepForward.isDisabled(), true);
    await directorSelect.selectOption({ label: "Evan Director" });
    await page.getByText(
      "Actieve directeur: Evan Director. Stap 1 toont alleen toernooien van deze directeur.",
      { exact: true },
    ).waitFor();
    await stepForward.click();
    // Step 1, APK-shaped: two routes, the load chooser holds only this
    // director's tournaments, and a blank date/time defaults to today 00:00.
    await page.getByRole("heading", { name: "Stap 1: Toernooi starten", level: 2 }).waitFor();
    await page.getByText("Actieve directeur: Evan Director.", { exact: true }).waitFor();
    await page.getByRole("option", { name: "Geen toernooien beschikbaar" })
      .waitFor({ state: "attached" });
    const newTournamentName = page.getByLabel("ToernooiNaam");
    const startCreate = page.getByRole("button", { name: "Nieuw toernooi starten" });
    assert.equal(await startCreate.isDisabled(), true);
    await newTournamentName.fill("Evan Test Avond");
    await startCreate.click();
    await page.waitForURL((url) =>
      url.search.includes("tournaments=tournament.") &&
      url.search.includes("director=user_account.synthetic_director_evan"));
    await page.getByRole("heading", { name: "Evan Test Avond" }).waitFor();
    const [createdTournaments] = await pool.execute(
      `SELECT account.public_id AS directorAccountId
       FROM tournaments AS tournament
       INNER JOIN user_accounts AS account
         ON account.user_account_id = tournament.director_user_account_id
       WHERE tournament.name = 'Evan Test Avond'`,
    );
    assert.deepEqual(
      createdTournaments.map((row) => row.directorAccountId),
      ["user_account.synthetic_director_evan"],
    );

    // Step 2, APK-shaped: the readiness gate opens only when the roster is
    // genuinely ready, and an unknown name becomes a canonical Player after
    // exactly one confirmation showing the derived username (ADR-0177).
    await page.getByText(
      "Nog niet klaar: markeer minimaal 1 deelnemer als Aanwezig.",
    ).waitFor();
    const blockedGate = page.getByRole("button", {
      name: "Maak kwalificatiegroepen (nog niet klaar)",
    });
    assert.equal(await blockedGate.isDisabled(), true);
    await page.getByLabel("Deelnemer toevoegen").fill("Test Racer Web");
    await page.getByRole("button", { name: "Deelnemer toevoegen" }).click();
    await page.getByText('"Test Racer Web" is nog geen speler.', { exact: true }).waitFor();
    await page.getByText(
      "Aanmaken geeft de gebruikersnaam @test_racer_web. De speler blijft claimbaar door de persoon zelf.",
      { exact: true },
    ).waitFor();
    await page.getByRole("button", { name: "Aanmaken en toevoegen" }).click();
    const testRacerPresent = page.getByRole("button", { name: "Test Racer Web naar Aanwezig" });
    await testRacerPresent.waitFor();
    await testRacerPresent.click();
    // The board re-renders after every server confirmation; interacting with
    // the stale card would be swallowed by the busy guard.
    await page.getByText(
      "Aanwezig 1 · Wachtlijst 0 · Afwezig 0 · Nintendo Switches: 0/1",
      { exact: true },
    ).waitFor();
    // The APK row identity: RANK pill and the conservative SP score. The
    // fresh Player carries the ADR-0177 prior, so SP is exactly 0,00; the
    // rank number depends on how many rated Players this run created.
    await page.getByText(/^RANK #/u).first().waitFor();
    await page.getByText("SP: 0,00", { exact: true }).first().waitFor();
    await page.locator('input[aria-label="Test Racer Web neemt NS1 mee"]:visible').check();
    const openGate = page.getByRole("button", { name: "Maak kwalificatiegroepen", exact: true });
    await openGate.waitFor();
    assert.equal(await openGate.isEnabled(), true);
    const [rosterCreated] = await pool.execute(
      `SELECT claim.player_claim_id AS claimId
       FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id
       LEFT JOIN player_claims AS claim ON claim.player_id = player.player_id
       WHERE username.comparison_key = ?`,
      [Buffer.from("test_racer_web")],
    );
    assert.equal(rosterCreated.length, 1);
    assert.equal(rosterCreated[0].claimId, null);

    // Step 3, APK-shaped: the group board with the APK stats, the status
    // line, and confirm-by-locking (the server advances the step). The back
    // checkpoint from Step 4 reopens the lock with the canonical warning.
    await openGate.click();
    await page.getByText("Stap 3 · Kwalificatie-indeling maken", { exact: true }).waitFor();
    await page.getByText("Nin: 1/6  Deeln: 1/2", { exact: true }).waitFor();
    await page.getByText("Gem. SP: 0,00 · Spreiding: +0,00 / -0,00", { exact: true }).waitFor();
    await page.getByText(
      "Alle 1 deelnemers ingedeeld - klaar om door te gaan.",
      { exact: true },
    ).waitFor();
    // The source board interactions: park the seated Player with the card
    // button, then drag them from Deelnemersparking back onto the seat.
    await page.locator(".tournament-board__seat .tournament-board__park").click();
    await page.getByText(
      "Nog 1 deelnemers niet ingedeeld. Controleer de groepen voordat je doorgaat.",
      { exact: true },
    ).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Indeling bevestigen en doorgaan" }).isDisabled(),
      true,
    );
    // The station left the group with its only occupant, so the return
    // drop targets the group itself: the board brings the parked Switch
    // back along with its owner.
    // Drive the HTML5 drag through real DragEvents: since the card carries
    // buttons, Playwright's synthetic pointer drag grabs them unreliably.
    // This exercises exactly the dragstart/dragover/drop listener wiring.
    await page.evaluate(() => {
      const card = document.querySelector(".tournament-board__parking-zone .tournament-board__player");
      const header = document.querySelector(".tournament-board__group-header");
      const dataTransfer = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      header.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      header.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      card.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    });
    await page.getByText(
      "Alle 1 deelnemers ingedeeld - klaar om door te gaan.",
      { exact: true },
    ).waitFor();
    // The tap interaction (the mobile path): the ⇄ badge and hint are
    // visible, selecting the seated player parks through the source-style
    // group -> exact-seat sheet, then uses that same path to return.
    await page.getByText(
      "Tik ⇄ op een kaart om in te delen, te wisselen of te parkeren; slepen kan ook.",
      { exact: true },
    ).waitFor();
    await page.locator(".tournament-board__swap-badge").first().waitFor();
    await page.locator(".tournament-board__seat .tournament-board__player").click();
    await page.getByText("Verplaats Test Racer Web", { exact: true }).waitFor();
    await page.locator(".tournament-move-sheet").getByRole("button", { name: /Groep/u }).first().click();
    await page.locator(".tournament-move-sheet").getByRole("button", { name: "Lege plek · plaats" }).first().click();
    await page.getByText(
      "Alle 1 deelnemers ingedeeld - klaar om door te gaan.",
      { exact: true },
    ).waitFor();
    await page.locator(".tournament-board__seat .tournament-board__player").click();
    await page.getByText("Verplaats Test Racer Web", { exact: true }).waitFor();
    await page.locator(".tournament-move-sheet").getByRole("button", { name: "Parkeer" }).click();
    await page.getByText(
      "Nog 1 deelnemers niet ingedeeld. Controleer de groepen voordat je doorgaat.",
      { exact: true },
    ).waitFor();
    await page.evaluate(() => {
      const card = document.querySelector(".tournament-board__parking-zone .tournament-board__player");
      const header = document.querySelector(".tournament-board__group-header");
      const dataTransfer = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      header.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      header.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      card.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    });
    await page.getByText(
      "Alle 1 deelnemers ingedeeld - klaar om door te gaan.",
      { exact: true },
    ).waitFor();
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.getByRole("button", { name: "Indeling bevestigen en doorgaan" }).click();
    // Step 4 is the source Manager's visual layout-export checkpoint, with
    // its board preview and the movement audit before scores can begin.
    await page.getByRole("heading", {
      name: "Stap 4 · Kwalificatie-indeling exporteren",
    }).waitFor();
    await page.getByText("Toont: Kwalificatie-indeling", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Verplaatsingsaudit Stap 4" }).waitFor();
    await page.getByRole("button", {
      name: "Ga door naar Stap 5: Kwalificatiescores",
    }).waitFor();
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.getByRole("button", { name: "← Stap 3" }).click();
    await page.getByText("Stap 3 · Kwalificatie-indeling maken", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Indeling bevestigen en doorgaan" }).waitFor();

    // Reconfirm Step 3 and then exercise every remaining Manager checkpoint
    // in one real, server-backed operation. Review happens after the whole
    // 0→10 route exists; no later step is accepted by source inspection.
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.getByRole("button", { name: "Indeling bevestigen en doorgaan" }).click();
    await page.getByRole("heading", { name: "Stap 4 · Kwalificatie-indeling exporteren" }).waitFor();
    await page.getByRole("button", { name: "Ga door naar Stap 5: Kwalificatiescores" }).click();

    // Step 5: source-shaped score settings, optional Excel route and manual
    // table. Saving totals must open the sticky Step 6 checkpoint.
    await page.getByText("Stap 5 · Kwalificatiescores invullen", { exact: true }).waitFor();
    await page.getByText("▣ Scores importeren uit Excel (optioneel)", { exact: true }).waitFor();
    await page.getByLabel("Connection errors Groep 1").waitFor();
    await page.getByLabel("Test Racer Web deel 1").fill("40");
    await page.getByRole("button", { name: "Update tabel nu" }).click();
    const step6 = page.getByRole("button", { name: "Scores bevestigen en ga naar Stap 6" });
    await step6.waitFor();
    await step6.click();

    // Step 6: cumulative layout/results hub plus current-stage Excel.
    await page.getByRole("heading", { name: "Stap 6 · Kwalificatie-uitslag exporteren" }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-indeling", exact: true }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-uitslag", exact: true }).waitFor();
    await page.getByText("Toont: Kwalificatie-uitslag", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Download Excel Stap 6" }).waitFor();
    await page.getByRole("button", { name: "Maak eindgroepen en ga naar Stap 7" }).click();

    // Step 7 is the same specialized station board as Step 3, now carrying
    // tiered final groups and the final-specific confirmation copy.
    await page.getByText("Stap 7 · Eindgroepen controleren", { exact: true }).waitFor();
    await page.getByText("Alle 1 deelnemers ingedeeld - klaar om door te gaan.", { exact: true }).waitFor();
    await page.locator(".tournament-board__swap-badge").first().waitFor();
    page.once("dialog", (dialog) => { void dialog.accept(); });
    await page.getByRole("button", { name: "Indeling bevestigen en ga naar Stap 8" }).click();

    // Step 8: three cumulative exports and the complete move/UTP audit.
    await page.getByRole("heading", { name: "Stap 8 · Eindgroepen exporteren" }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-indeling", exact: true }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-uitslag", exact: true }).waitFor();
    await page.getByRole("button", { name: "Eindgroep-indeling", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Verplaatsingsaudit Stap 8" }).waitFor();
    await page.getByRole("heading", { name: "UTP-wisselplan" }).waitFor();
    await page.getByRole("button", { name: "Ga door naar Stap 9: Eindgroepscores" }).click();

    // Step 9 mirrors Step 5 for finals and gates Step 10 on complete totals.
    await page.getByText("Stap 9 · Eindgroepscores invullen", { exact: true }).waitFor();
    await page.getByLabel("Test Racer Web deel 1").fill("50");
    await page.getByRole("button", { name: "Update tabel nu" }).click();
    const step10 = page.getByRole("button", { name: "Uitslagen bevestigen en ga naar Stap 10" });
    await step10.waitFor();
    await step10.click();

    // Step 10 retains all four source exports, both score workbooks and the
    // ecosystem's deliberate finalization extension beneath the result hub.
    await page.getByRole("heading", { name: "Stap 10 · Einduitslag exporteren" }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-indeling", exact: true }).waitFor();
    await page.getByRole("button", { name: "Kwalificatie-uitslag", exact: true }).waitFor();
    await page.getByRole("button", { name: "Eindgroep-indeling", exact: true }).waitFor();
    await page.getByRole("button", { name: "Eindgroep-uitslag", exact: true }).waitFor();
    await page.getByText("Toont: Eindgroep-uitslag", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Download Excel Stap 10" }).waitFor();
    await page.getByRole("button", { name: "Download Excel Stap 6" }).waitFor();
    await page.getByRole("heading", { name: /^(Finalize|Afronden)$/u }).waitFor();
    await page.getByRole("button", { name: /^(Preview finalization|Afronding controleren)$/u }).click();
    await page.getByText(/(1 qualifier group\(s\), 1 final group\(s\)|1 kwalificatiegroep\(en\), 1 eindgroep\(en\))/u).waitFor();

    if (webOnly) {
      assert.deepEqual(
        relevantBrowserErrors(browserErrors),
        [],
      );
      console.log("Live Phase 6 web product validation passed: HTTPS magic link, audited administrator publication, public history, and the full source-shaped Tournament operation from Step 0 through Step 10.");
      return;
    }
    const desktopRoot = join(resolvedTemporary, "livetrial-product");
    const profilePath = join(desktopRoot, "profile.json");
    const sessionPath = join(desktopRoot, "auth-session.dat");
    const accountsRoot = join(desktopRoot, "accounts");
    const canonicalRoot = join(desktopRoot, "canonical-outbox");
    const privateRoot = join(desktopRoot, "private-evidence");
    const reportPath = join(resolvedTemporary, "synthetic-report.json");
    const fixture = JSON.parse(readFileSync(resolve(
      repositoryRoot,
      "apps/timetrials-desktop/tests/fixtures/livetrial-finished-run-3lap.json",
    ), "utf8"));
    fixture.closedAt = 1_787_040_000.125;
    await writeFile(reportPath, JSON.stringify({
      video: "live:synthetic browser product capture",
      fps: 0,
      framesAnalyzed: 1234,
      runs: [fixture],
    }), { encoding: "utf8", flag: "wx" });
    const desktopEnvironment = liveTrialEnvironment(
      resolvedTemporary,
      tls.certificatePath,
    );
    await runLiveTrial([
      "init-profile",
      "--profile", profilePath,
      "--producer-version", "timetrials-desktop-browser-product",
    ], desktopEnvironment);

    let resolveApproval;
    const approval = new Promise((accept) => { resolveApproval = accept; });
    let approvalFound = false;
    const signIn = startLiveTrial([
      "sign-in",
      "--api-origin", baseUrl,
      "--session", sessionPath,
      "--accounts-root", accountsRoot,
      "--no-browser",
    ], desktopEnvironment, (stdout) => {
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
        reject(new Error("LiveTrial device approval URL was not produced."));
      }, 15_000);
    });
    const approvalUrl = await Promise.race([
      approval,
      approvalTimeout,
      signIn.completion.then(() => {
        throw new Error("LiveTrial sign-in ended before device approval.");
      }),
    ]);
    clearTimeout(approvalTimer);
    assert.equal(approvalUrl.startsWith(`${baseUrl}/device?`), true);
    await page.goto(approvalUrl, { waitUntil: "networkidle" });
    await page.getByText(
      "Windows desktop app requests access to your account.",
      { exact: true },
    ).waitFor();
    await page.getByRole("button", { name: "Approve device" }).click();
    await page.getByText("Device approved. Go back to the app to finish signing in.", { exact: true })
      .waitFor();
    const signedIn = await signIn.completion;
    assert.equal(signedIn.stderr, "");
    assert.match(signedIn.stdout, /synchronization session established/);
    const accountSession = (await readdir(accountsRoot)).find(
      (name) => name.endsWith(".session.dat"),
    );
    assert.notEqual(accountSession, undefined);
    assert.equal(
      readFileSync(join(accountsRoot, accountSession)).includes(Buffer.from(playerId)),
      false,
    );

    await runLiveTrial([
      "save-run",
      "--report", reportPath,
      "--source-kind", "livetrial_capture",
      "--run-number", "7",
      "--profile", profilePath,
      "--session", sessionPath,
      "--accounts-root", accountsRoot,
      "--canonical-outbox-root", canonicalRoot,
      "--private-evidence-root", privateRoot,
    ], desktopEnvironment);
    const listed = await runLiveTrial([
      "list-results",
      "--canonical-outbox-root", canonicalRoot,
      "--private-evidence-root", privateRoot,
    ], desktopEnvironment);
    const results = JSON.parse(listed.stdout);
    assert.equal(results.length, 1);
    assert.equal(results[0].playerNamespace, "player");
    assert.equal(listed.stdout.includes("Observed Driver"), false);
    assert.equal(listed.stdout.includes("Private Ghost"), false);
    const synchronized = await runLiveTrial([
      "sync",
      "--entry-key", results[0].entryKey,
      "--api-origin", baseUrl,
      "--session", sessionPath,
      "--accounts-root", accountsRoot,
      "--canonical-outbox-root", canonicalRoot,
      "--private-evidence-root", privateRoot,
    ], desktopEnvironment);
    assert.equal(JSON.parse(synchronized.stdout).state, "synced");
    assert.equal((await readdir(privateRoot)).length, 1);
    const [desktopRows] = await pool.execute(
      `SELECT revision.source_kind AS sourceKind,
              revision.total_time_ms AS totalTimeMs,
              player.public_id AS playerId,
              COUNT(evidence.time_trial_evidence_id) AS evidenceCount
       FROM time_trial_submission_revisions AS revision
       INNER JOIN players AS player ON player.player_id = revision.player_id
       LEFT JOIN restricted_time_trial_evidence AS evidence
         ON evidence.time_trial_submission_revision_id =
            revision.time_trial_submission_revision_id
       WHERE revision.producer_version = ?
       GROUP BY revision.time_trial_submission_revision_id,
                revision.source_kind, revision.total_time_ms, player.public_id`,
      ["timetrials-desktop-browser-product"],
    );
    assert.deepEqual(desktopRows, [{
      sourceKind: "livetrial_capture",
      totalTimeMs: 60_000,
      playerId,
      evidenceCount: 1,
    }]);
    const signedOut = await runLiveTrial([
      "sign-out",
      "--api-origin", baseUrl,
      "--session", sessionPath,
      "--accounts-root", accountsRoot,
    ], desktopEnvironment);
    assert.match(signedOut.stdout, /synchronization session revoked/);
    const status = await runLiveTrial([
      "session-status",
      "--session", sessionPath,
      "--accounts-root", accountsRoot,
    ], desktopEnvironment);
    assert.match(status.stdout, /signed out; local capture remains available/);

    if (skipAndroid) {
      assert.deepEqual(
        relevantBrowserErrors(browserErrors),
        [],
      );
      console.log("Live web and LiveTrial product validation passed; Android was outside this gate's blast radius.");
      return;
    }

    android = androidEnvironment();
    buildAndInstallAndroid(android, baseUrl, tls.certificatePath);
    androidReversePort = gatewayPort;
    runChecked(android.adb, [
      "-s", android.serial, "reverse",
      `tcp:${gatewayPort}`, `tcp:${gatewayPort}`,
    ], { label: "Android emulator HTTPS reverse mapping" });
    const androidInstrumentation = startAndroidInstrumentation(android, baseUrl);
    const androidApprovalUrl = await waitForAndroidApprovalUrl(
      android,
      androidInstrumentation,
    );
    assert.equal(androidApprovalUrl.startsWith(`${baseUrl}/device?`), true);
    await page.goto(androidApprovalUrl, { waitUntil: "networkidle" });
    await page.getByText(
      "MK8DX Time Trials for Android requests access to your account.",
      { exact: true },
    ).waitFor();
    await page.getByRole("button", { name: "Approve device" }).click();
    await page.getByText("Device approved. Go back to the app to finish signing in.", { exact: true })
      .waitFor();
    await androidInstrumentation.completion;
    const [androidRows] = await pool.execute(
      `SELECT revision.source_kind AS sourceKind,
              revision.track_id AS trackId,
              revision.mode_cc AS mode,
              revision.total_time_ms AS totalTimeMs,
              player.public_id AS playerId,
              COUNT(evidence.time_trial_evidence_id) AS evidenceCount
       FROM time_trial_submission_revisions AS revision
       INNER JOIN players AS player ON player.player_id = revision.player_id
       LEFT JOIN restricted_time_trial_evidence AS evidence
         ON evidence.time_trial_submission_revision_id =
            revision.time_trial_submission_revision_id
       WHERE revision.producer_version = ?
       GROUP BY revision.time_trial_submission_revision_id,
                revision.source_kind, revision.track_id, revision.mode_cc,
                revision.total_time_ms, player.public_id`,
      ["timetrials-android-live-product"],
    );
    assert.deepEqual(androidRows, [{
      sourceKind: "android_manual",
      trackId: "track.mario_kart_stadium",
      mode: 150,
      totalTimeMs: 83_456,
      playerId,
      evidenceCount: 0,
    }]);
    assert.deepEqual(
      relevantBrowserErrors(browserErrors),
      [],
    );
    console.log("Live web/desktop/Android product validation passed: HTTPS magic link, claimed Player, CSRF, canonical MySQL writes, protected native sessions, explicit sync, and revocation.");
  } finally {
    if (android !== undefined) {
      if (androidReversePort !== undefined) {
        spawnSync(android.adb, [
          "-s", android.serial, "reverse", "--remove", `tcp:${androidReversePort}`,
        ], { shell: false, windowsHide: true, stdio: "ignore" });
      }
      spawnSync(android.adb, [
        "-s", android.serial, "shell", "am", "force-stop",
        "nl.mariokart8.mk8dxtimetrials",
      ], { shell: false, windowsHide: true, stdio: "ignore" });
      spawnSync(android.adb, [
        "-s", android.serial, "shell", "pm", "clear",
        "nl.mariokart8.mk8dxtimetrials",
      ], { shell: false, windowsHide: true, stdio: "ignore" });
    }
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
