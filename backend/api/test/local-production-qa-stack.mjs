// Loopback-only QA runtime backed by a sanitized production-domain snapshot.
// Real production authentication, claims and private/restricted tables are
// never imported. A requested public Player receives a synthetic local
// passwordless account and a canonical local-only verified PlayerClaim.

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  createReadStream,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer, request as createHttpRequest } from "node:http";

import mysql from "mysql2/promise";
import webPush from "web-push";

import { AuthenticationSubjectHmacProtector } from
  "../dist/authentication/authentication-subject-hmac-protector.js";
import { AdministratorGrantService } from
  "../dist/administration/administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from
  "../dist/administration/mysql-administrator-grant-repository.js";
import { TournamentOperatorCapabilityService } from
  "../dist/tournaments/tournament-operator-capability-service.js";
import { MysqlTournamentOperatorCapabilityRepository } from
  "../dist/tournaments/mysql-tournament-operator-capability-repository.js";
import { createPasswordlessHostedRuntime } from
  "../dist/composition/hosted-runtime.js";
import { ClaimLifecycleService } from
  "../dist/identity/claim-lifecycle-service.js";
import { MysqlClaimWriteRepository } from
  "../dist/identity/mysql-claim-write-repository.js";
import { loadStaticWebFiles } from "../dist/runtime/static-web.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const webRoot = resolve(repositoryRoot, "apps/timetrials-web");
const lookupKey = Buffer.alloc(32, 71);
const lookupKeyVersion = "local-qa-auth-v1";
const issuerKey = "mk8dx_passwordless_v1";
const magicLinks = [];
const appliedPrivateProfiles = new Set();
let qaClientSequence = 1;

const scannerContentTypes = new Map([
  // The shared recognition pack (shared-icon/**/*.bin) is raw tensor data.
  [".bin", "application/octet-stream"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".onnx", "application/octet-stream"],
  [".pack", "application/octet-stream"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".traineddata", "application/octet-stream"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);
const scannerIsolationHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

function fail(message) {
  throw new Error(`Local production QA stack failed: ${message}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function requiredAbsoluteEnvironment(name) {
  const value = process.env[name] ?? "";
  if (!value || !isAbsolute(value)) fail(`${name} must be an absolute path`);
  return resolve(value);
}

function indexScannerFiles(root) {
  const files = new Map();
  const visit = (directory, segments) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!/^[A-Za-z0-9._-]+$/u.test(entry.name) || entry.name.includes("..")) {
        fail("scanner bundle contains an unsafe file name");
      }
      const nextSegments = [...segments, entry.name];
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, nextSegments);
        continue;
      }
      if (!entry.isFile() || entry.name === ".htaccess") continue;
      const contentType = scannerContentTypes.get(extname(entry.name).toLowerCase());
      if (contentType === undefined) fail(`scanner bundle extension is not allowed: ${extname(entry.name)}`);
      const relativeUrl = nextSegments.join("/");
      const size = statSync(absolute).size;
      if (size < 1) fail("scanner bundle contains an empty file");
      files.set(relativeUrl, { absolute, contentType, size });
      if (entry.name === "index.html") {
        files.set(`${segments.join("/")}${segments.length > 0 ? "/" : ""}`, { absolute, contentType, size });
      }
    }
  };
  visit(root, []);
  if (!files.has("")) fail("scanner bundle has no root index.html");
  return files;
}

function createQaWebFront(scannerRoot, targetPort, publicPort) {
  const files = indexScannerFiles(scannerRoot);
  const send = (key, request, response) => {
    const file = files.get(key);
    if (file === undefined) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end('{"message":"Not Found"}');
      return;
    }
    const immutable = /\.(?:wasm|onnx|traineddata|pack)$/u.test(key);
    response.writeHead(200, {
      ...scannerIsolationHeaders,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "content-length": String(file.size),
      "content-type": file.contentType,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file.absolute).pipe(response);
  };
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${publicPort}`);
    if (url.pathname === "/scanner") {
      response.writeHead(302, { location: "/scanner/", "cache-control": "no-cache" });
      response.end();
      return;
    }
    if (url.pathname.startsWith("/scanner/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" });
        response.end();
        return;
      }
      send(url.pathname.slice("/scanner/".length), request, response);
      return;
    }
    const proxy = createHttpRequest({
      hostname: "127.0.0.1",
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    }, (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    });
    proxy.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("Local QA application is unavailable");
    });
    request.pipe(proxy);
  });
  return new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(publicPort, "127.0.0.1", () => accept(server));
  });
}

function databaseConfig() {
  const database = process.env.MK8DX_QA_MYSQL_DATABASE ?? "";
  const port = Number(process.env.MK8DX_QA_MYSQL_PORT ?? "");
  if (
    process.env.MK8DX_QA_MYSQL_HOST !== "127.0.0.1" ||
    !/^mk8dx_[a-z0-9_]*(?:qa|contract)$/u.test(database) ||
    !Number.isSafeInteger(port) || port < 1 || port > 65535
  ) fail("an explicit loopback QA/contract database is required");
  return {
    host: "127.0.0.1",
    port,
    user: process.env.MK8DX_QA_MYSQL_USER ?? "",
    password: process.env.MK8DX_QA_MYSQL_PASSWORD ?? "",
    database,
    connectionLimit: 4,
  };
}

function createClient(baseUrl) {
  const jar = new Map();
  // Every synthetic browser/provisioning client gets its own loopback address.
  // The hosted runtime trusts only the real loopback peer before consulting
  // this header, so rapid profile switches exercise per-client rate limits
  // instead of collapsing into one anonymous shared bucket.
  const clientIp = `127.0.0.${(qaClientSequence++ % 253) + 2}`;
  async function call(method, path, body) {
    const headers = {
      accept: "application/json", origin: baseUrl, referer: `${baseUrl}/`,
      "x-real-ip": clientIp,
    };
    if (jar.size > 0) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
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
    return { status: response.status, text, body: parsed };
  }
  return { call };
}

async function resolvePublicPlayer(pool, selector) {
  const [rows] = await pool.query(
    `SELECT p.public_id AS playerId, p.display_name AS displayName,
            p.visibility, p.record_status AS recordStatus,
            username.username_value AS username
     FROM players AS p
     LEFT JOIN player_username_history AS username
       ON username.player_id = p.player_id AND username.released_at_ms IS NULL
     WHERE p.player_kind = 'human'`,
  );
  const key = selector.trim().toLocaleLowerCase("en-US");
  const matches = rows.filter((row) => [row.playerId, row.displayName, row.username]
    .some((value) => typeof value === "string" && value.toLocaleLowerCase("en-US") === key));
  if (matches.length !== 1) fail(`Player selector must resolve exactly once: ${selector}`);
  const player = matches[0];
  if (player.visibility !== "public" || player.recordStatus !== "active") {
    fail("local QA login is restricted to active public Players");
  }
  return {
    playerId: String(player.playerId),
    displayName: String(player.displayName),
    username: String(player.username ?? player.displayName),
  };
}

function qaEmail(player) {
  const local = player.username.toLocaleLowerCase("en-US")
    .normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, ".").replace(/^\.+|\.+$/gu, "").slice(0, 48);
  return `qa.${local || "player"}@example.test`;
}

async function accountForAuthUser(pool, authUserId) {
  const protectedSubject = new AuthenticationSubjectHmacProtector({
    lookupHmacKey: lookupKey,
    lookupKeyVersion,
  }).protectVerifiedSubject(issuerKey, authUserId);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [rows] = await pool.execute(
      `SELECT account.public_id AS accountId
       FROM restricted_authentication_bindings AS binding
       INNER JOIN user_accounts AS account
         ON account.user_account_id = binding.user_account_id
       WHERE binding.issuer_key = ? AND binding.lookup_key_version = ?
         AND binding.subject_lookup_hmac = ? AND binding.binding_status = 'active'`,
      [issuerKey, lookupKeyVersion, Buffer.from(protectedSubject.subjectLookupHmac)],
    );
    if (rows.length === 1) return String(rows[0].accountId);
    await new Promise((accept) => setTimeout(accept, 100));
  }
  fail("local UserAccount provisioning did not complete");
}

async function ensureVerifier(pool) {
  const publicId = "user_account.local_qa_claim_verifier";
  const now = Date.now();
  await pool.execute(
    `INSERT IGNORE INTO user_accounts
       (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms,
        time_trial_mode_preference, screen_name, time_trial_track_access)
     VALUES (?, 1, 'private', 'active', ?, ?, 'all', NULL, 'unknown')`,
    [publicId, now, now],
  );
  return publicId;
}

/**
 * The snapshot rewrites every imported user account into an anonymised shadow
 * account, so the retained Tournaments end up directed by an account nobody can
 * sign in as. The Web hid that - its operate list is administrator-scoped and
 * showed them anyway - but the APK asks for
 * `/v1/native/tournaments?director=…` and correctly answered "Geen toernooien
 * beschikbaar", which reads like an APK defect and is not one.
 *
 * On production the owner is the director and sees them, so the mirror is what
 * has to match: every Tournament still directed by an imported shadow account
 * is handed to the local account of the mirror's initial Player. Local,
 * disposable database only; nothing here reaches production, and a Tournament
 * that already belongs to a local account is left alone.
 */
async function adoptImportedTournamentDirectors(pool, accountId) {
  const accountInternalId = await internalId(
    pool, "user_accounts", "public_id", accountId, "user_account_id",
  );
  const [result] = await pool.execute(
    `UPDATE tournaments AS tournament
       INNER JOIN user_accounts AS director
         ON director.user_account_id = tournament.director_user_account_id
     SET tournament.director_user_account_id = ?
     WHERE director.public_id LIKE 'user_account.qa_shadow_%'`,
    [accountInternalId],
  );
  return Number(result?.affectedRows ?? 0);
}

/**
 * Capability grants are security material and are deliberately not exported in
 * the snapshot, so a restored mirror has none and every account is told "Dit
 * account mag geen toernooi bedienen". The Web hid that too, because its
 * operate surfaces are administrator-scoped.
 *
 * The mirror exists so the owner can see what the products actually do, so the
 * initial Player's local account is granted the Tournament operator capability
 * through the product's own service - the same path an administrator uses -
 * rather than by writing the grant table directly. Local, disposable database
 * only.
 */
async function grantTournamentOperator(pool, accountId, verifierAccountId) {
  const service = new TournamentOperatorCapabilityService(
    new MysqlTournamentOperatorCapabilityRepository(pool),
    { newGrantId() { return `account_capability_grant.local_qa_${randomUUID()}`; } },
    { nowMs: () => Date.now() },
  );
  if (await service.has(accountId)) { return false; }
  await service.grant(
    { role: "administrator", userAccountId: verifierAccountId },
    accountId,
    "local_qa_mirror",
  );
  return true;
}

async function bootstrapVerifierAdministrator(pool, verifierAccountId) {
  try {
    await new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId() { return "administrator_grant.local_qa_verifier"; } },
      { nowMs: () => Date.now() },
    ).bootstrapFirstAdministrator(verifierAccountId);
  } catch (error) {
    if (error?.code !== "conflict") throw error;
  }
}

function scalar(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  fail("private profile snapshot contains a non-scalar value");
}

async function internalId(pool, table, publicColumn, publicId, internalColumn) {
  const [rows] = await pool.execute(
    `SELECT \`${internalColumn}\` AS internalId FROM \`${table}\` WHERE \`${publicColumn}\` = ?`,
    [publicId],
  );
  if (rows.length !== 1) fail(`private profile reference is absent: ${publicId}`);
  return rows[0].internalId;
}

async function applyPrivateProfile(pool, profile, accountId, verifierAccountId) {
  if (appliedPrivateProfiles.has(accountId)) return;
  const accountInternalId = await internalId(pool, "user_accounts", "public_id", accountId, "user_account_id");
  const playerInternalId = await internalId(pool, "players", "public_id", profile.playerId, "player_id");
  const verifierInternalId = await internalId(pool, "user_accounts", "public_id", verifierAccountId, "user_account_id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const preferences = profile.preferences ?? {};
    await connection.execute(
      `UPDATE user_accounts SET time_trial_mode_preference = ?, screen_name = ?,
              time_trial_track_access = ?,
              revision = revision + 1, updated_at_ms = ? WHERE user_account_id = ?`,
      [preferences.timeTrialModePreference ?? "all", preferences.screenName ?? null,
        preferences.timeTrialTrackAccess ?? "unknown", Date.now(), accountInternalId],
    );
    for (const group of profile.socialGroups ?? []) {
      await connection.execute(
        `INSERT INTO social_groups (public_id, name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name),
           record_status = VALUES(record_status), updated_at_ms = VALUES(updated_at_ms)`,
        [group.groupId, group.name, group.recordStatus, scalar(group.createdAtMs), scalar(group.updatedAtMs)],
      );
    }
    for (const membership of profile.socialMemberships ?? []) {
      const groupInternalId = await internalId(connection, "social_groups", "public_id", membership.groupId, "social_group_id");
      const memberInternalId = await internalId(connection, "players", "public_id", membership.playerId, "player_id");
      const inviterInternalId = membership.invitedByPlayerId === null ? null :
        await internalId(connection, "players", "public_id", membership.invitedByPlayerId, "player_id");
      await connection.execute(
        `INSERT INTO social_group_memberships
           (social_group_id, player_id, member_role, membership_status,
            invited_by_player_id, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
           member_role = VALUES(member_role), membership_status = VALUES(membership_status),
           invited_by_player_id = VALUES(invited_by_player_id), updated_at_ms = VALUES(updated_at_ms)`,
        [groupInternalId, memberInternalId, membership.memberRole, membership.membershipStatus,
          inviterInternalId, scalar(membership.createdAtMs), scalar(membership.updatedAtMs)],
      );
    }
    for (const rival of profile.rivals ?? []) {
      const target = await internalId(connection, "players", "public_id", rival.playerId, "player_id");
      await connection.execute(
        "INSERT IGNORE INTO player_rivals (user_account_id, rival_player_id, created_at_ms) VALUES (?, ?, ?)",
        [accountInternalId, target, scalar(rival.createdAtMs)],
      );
    }
    for (const follow of profile.follows ?? []) {
      const target = await internalId(connection, "players", "public_id", follow.playerId, "player_id");
      await connection.execute(
        "INSERT IGNORE INTO player_follows (user_account_id, followed_player_id, created_at_ms) VALUES (?, ?, ?)",
        [accountInternalId, target, scalar(follow.createdAtMs)],
      );
    }
    for (const snapshot of profile.homeSnapshots ?? []) {
      await connection.execute(
        `INSERT INTO home_snapshots (user_account_id, generation, tt_standing, snapshot_at_ms)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tt_standing = VALUES(tt_standing),
           snapshot_at_ms = VALUES(snapshot_at_ms)`,
        [accountInternalId, snapshot.generation, snapshot.ttStanding, scalar(snapshot.snapshotAtMs)],
      );
    }
    for (const rival of profile.homeSnapshotRivals ?? []) {
      const target = await internalId(connection, "players", "public_id", rival.playerId, "player_id");
      await connection.execute(
        `INSERT INTO home_snapshot_rivals
           (user_account_id, generation, rival_player_id, tracks_ahead, tracks_behind,
            shared_combos, total_delta_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tracks_ahead = VALUES(tracks_ahead),
           tracks_behind = VALUES(tracks_behind), shared_combos = VALUES(shared_combos),
           total_delta_ms = VALUES(total_delta_ms)`,
        [accountInternalId, rival.generation, target, rival.tracksAhead, rival.tracksBehind,
          rival.sharedCombos, scalar(rival.totalDeltaMs)],
      );
    }
    for (const notification of profile.notifications ?? []) {
      const actor = notification.actorPlayerId === null ? null :
        await internalId(connection, "players", "public_id", notification.actorPlayerId, "player_id");
      const group = notification.groupId === null ? null :
        await internalId(connection, "social_groups", "public_id", notification.groupId, "social_group_id");
      await connection.execute(
        `INSERT INTO notifications
           (user_account_id, notification_kind, aggregation_key, actor_player_id, track_id,
            mode_cc, social_group_id, detail, actor_time_ms, recipient_time_ms,
            recipient_rank, event_count, first_event_at_ms, last_event_at_ms, read_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [accountInternalId, notification.notificationKind, notification.aggregationKey,
          actor, notification.trackId, notification.modeCc, group, notification.detail,
          notification.actorTimeMs, notification.recipientTimeMs, notification.recipientRank,
          notification.eventCount, scalar(notification.firstEventAtMs),
          scalar(notification.lastEventAtMs), notification.readAtMs],
      );
    }
    if (profile.notificationPreferences != null) {
      const value = profile.notificationPreferences;
      await connection.execute(
        `INSERT INTO notification_preferences
           (user_account_id, competitive_overtaken, activity_reactions, updated_at_ms)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
           competitive_overtaken = VALUES(competitive_overtaken),
           activity_reactions = VALUES(activity_reactions), updated_at_ms = VALUES(updated_at_ms)`,
        [accountInternalId, value.competitiveOvertaken, value.activityReactions, scalar(value.updatedAtMs)],
      );
    }
    if (profile.rankScope != null) {
      await connection.execute(
        `INSERT INTO rank_scope_preferences
           (user_account_id, include_global, include_rivals, updated_at_ms)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE include_global = VALUES(include_global),
           include_rivals = VALUES(include_rivals), updated_at_ms = VALUES(updated_at_ms)`,
        [accountInternalId, profile.rankScope.includeGlobal, profile.rankScope.includeRivals,
          scalar(profile.rankScope.updatedAtMs)],
      );
      for (const selected of profile.selectedRankGroups ?? []) {
        const group = await internalId(connection, "social_groups", "public_id", selected.groupId, "social_group_id");
        await connection.execute(
          "INSERT IGNORE INTO rank_scope_group_preferences (user_account_id, social_group_id) VALUES (?, ?)",
          [accountInternalId, group],
        );
      }
    }
    for (const capability of profile.capabilities ?? []) {
      const suffix = randomUUID().replaceAll("-", "");
      const [result] = await connection.execute(
        `INSERT INTO account_capability_grants
           (public_id, revision, user_account_id, capability_code, grant_status,
            granted_by_user_account_id, granted_at_ms, revoked_at_ms, updated_at_ms)
         VALUES (?, 1, ?, ?, 'active', ?, ?, NULL, ?)`,
        [`account_capability_grant.local_qa_${suffix}`, accountInternalId, capability,
          verifierInternalId, Date.now(), Date.now()],
      );
      await connection.execute(
        `INSERT INTO account_capability_grant_lifecycle
           (account_capability_grant_id, sequence_number, event_type, actor_user_account_id,
            grant_status_after, reason_code, occurred_at_ms)
         VALUES (?, 1, 'granted', ?, 'active', 'local_qa', ?)`,
        [result.insertId, verifierInternalId, Date.now()],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (profile.administrator) {
    const service = new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId() {
        return `administrator_grant.local_qa_${randomUUID().replaceAll("-", "")}`;
      } },
      { nowMs: () => Date.now() },
    );
    await service.grantAdministrator(
      { role: "administrator", userAccountId: verifierAccountId },
      accountId,
      "local_qa",
    );
  }
  appliedPrivateProfiles.add(accountId);
}

async function ensureClaim(pool, player, accountId, verifierAccountId) {
  const [existing] = await pool.execute(
    `SELECT claim.public_id AS claimId, claim.claim_status AS claimStatus,
            account.public_id AS accountId
     FROM player_claims AS claim
     INNER JOIN players AS player ON player.player_id = claim.player_id
     INNER JOIN user_accounts AS account ON account.user_account_id = claim.user_account_id
     WHERE player.public_id = ? AND claim.claim_status = 'verified'`,
    [player.playerId],
  );
  if (existing.length === 1) {
    if (String(existing[0].accountId) !== accountId) fail("Player already has another local claim");
    return String(existing[0].claimId);
  }
  const suffix = randomUUID().replaceAll("-", "");
  let claimSequence = 0;
  const service = new ClaimLifecycleService(
    new MysqlClaimWriteRepository(pool),
    {
      newPlayerClaimId() { return `player_claim.local_qa_${suffix}`; },
      newRestrictedReviewId() {
        claimSequence += 1;
        return `restricted_review.local_qa_${suffix}_${claimSequence}`;
      },
    },
    { nowMs: () => Date.now() },
  );
  const requested = await service.requestClaim(
    { role: "account", userAccountId: accountId },
    { playerId: player.playerId, evidenceIds: [] },
  );
  await service.administratorAction(
    { role: "administrator", userAccountId: verifierAccountId },
    { playerClaimId: requested.playerClaimId, action: "start_review", reasonCode: "local_qa" },
  );
  await service.administratorAction(
    { role: "administrator", userAccountId: verifierAccountId },
    { playerClaimId: requested.playerClaimId, action: "verify", reasonCode: "local_qa" },
  );
  return requested.playerClaimId;
}

async function requestMagicLink(client, baseUrl, email) {
  const before = magicLinks.length;
  const requested = await client.call("POST", "/api/auth/sign-in/magic-link", {
    email,
    callbackURL: "/",
  });
  if (requested.status !== 200 || magicLinks.length !== before + 1) {
    fail(`magic-link request failed for ${email} (${requested.status})`);
  }
  const url = magicLinks.at(-1)?.url;
  if (typeof url !== "string" || !url.startsWith(baseUrl)) fail("local magic link is invalid");
  return url;
}

async function issuePlayerLogin(pool, baseUrl, selector, verifierAccountId, profiles) {
  const player = await resolvePublicPlayer(pool, selector);
  const profile = profiles.find((entry) => entry.playerId === player.playerId);
  if (profile === undefined) fail(`Player was not included in this QA snapshot: ${selector}`);
  const email = qaEmail(player);
  const provisioningClient = createClient(baseUrl);
  const provisioningUrl = await requestMagicLink(provisioningClient, baseUrl, email);
  const verified = await provisioningClient.call("GET", provisioningUrl.slice(baseUrl.length));
  if (verified.status >= 400) fail(`local account verification failed (${verified.status})`);
  const csrf = await provisioningClient.call("GET", "/v1/session/csrf");
  if (csrf.status >= 400) fail(`local account provisioning failed (${csrf.status})`);
  const [authUsers] = await pool.execute("SELECT id FROM mk8dx_auth_user WHERE email = ?", [email]);
  if (authUsers.length !== 1) fail("local auth user did not resolve exactly once");
  const accountId = await accountForAuthUser(pool, String(authUsers[0].id));
  const claimId = await ensureClaim(pool, player, accountId, verifierAccountId);
  await applyPrivateProfile(pool, profile, accountId, verifierAccountId);
  const browserClient = createClient(baseUrl);
  const loginUrl = await requestMagicLink(browserClient, baseUrl, email);
  return { ...player, email, accountId, claimId, loginUrl, issuedAt: new Date().toISOString() };
}

async function main() {
  const handoffPath = requiredAbsoluteEnvironment("MK8DX_QA_STACK_HANDOFF");
  const gameAssetRoot = requiredAbsoluteEnvironment("MK8DX_QA_GAME_ASSET_ROOT");
  const scannerRoot = requiredAbsoluteEnvironment("MK8DX_QA_SCANNER_ROOT");
  const initialPlayer = process.env.MK8DX_QA_INITIAL_PLAYER ?? "Ben";
  const snapshotPath = requiredAbsoluteEnvironment("MK8DX_QA_SNAPSHOT_PATH");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  if (snapshot.kind !== "mk8dx.production-qa-snapshot.v1" || !Array.isArray(snapshot.profiles)) {
    fail("QA snapshot contract is invalid");
  }
  const profiles = snapshot.profiles;
  const port = Number(process.env.MK8DX_QA_WEB_PORT ?? "65260");
  if (!Number.isSafeInteger(port) || port < 1024 || port + 3 > 65535) fail("web port is invalid");
  const applicationPort = port + 3;
  const baseUrl = `http://127.0.0.1:${port}`;
  // Native clients refuse a plain-HTTP origin, so the mirror may also be
  // reachable over TLS on loopback. When it is, that origin is trusted and is
  // where device codes are approved from a native client's point of view; the
  // Web keeps its own HTTP origin and behaves exactly as before.
  const nativeOrigin = (process.env.MK8DX_QA_NATIVE_ORIGIN ?? "").trim();
  if (nativeOrigin !== "" && !/^https:\/\/127\.0\.0\.1:[0-9]{4,5}$/u.test(nativeOrigin)) {
    fail("MK8DX_QA_NATIVE_ORIGIN must be an exact loopback HTTPS origin");
  }
  // Disposable per start; never written to disk, never production's.
  let webPushKeys = null;
  if ((process.env.MK8DX_QA_WEB_PUSH ?? "1") !== "0") {
    const generated = webPush.generateVAPIDKeys();
    webPushKeys = {
      subject: "mailto:qa@example.test",
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };
  }
  const mysqlConfig = databaseConfig();
  if (!mysqlConfig.user || !mysqlConfig.password) fail("local database credentials are required");
  const pool = mysql.createPool(mysqlConfig);
  const verifierAccountId = await ensureVerifier(pool);
  await bootstrapVerifierAdministrator(pool, verifierAccountId);
  const selectorToken = randomUUID().replaceAll("-", "");
  const magicLinkLog = `${handoffPath}.magic-links.jsonl`;
  writeFileSync(magicLinkLog, "", { flag: "wx" });

  const runtime = await createPasswordlessHostedRuntime({
    core: {
      mysql: mysqlConfig,
      schema9CatalogPath: resolve(repositoryRoot, "packages/assets/schema9-asset-catalog-v1.json"),
      authenticationKeys: { lookupHmacKey: lookupKey, lookupKeyVersion },
      timeTrialKeys: {
        encryptionKey: Buffer.alloc(32, 72), encryptionKeyVersion: "local-qa-tt-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 73), lookupKeyVersion: "local-qa-tt-lookup-v1",
      },
      timeTrialDecryptionKeys: { "local-qa-tt-enc-v1": Buffer.alloc(32, 72) },
      tournamentKeys: {
        encryptionKey: Buffer.alloc(32, 74), encryptionKeyVersion: "local-qa-tournament-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 75), lookupKeyVersion: "local-qa-tournament-lookup-v1",
      },
      tournamentDecryptionKeys: { "local-qa-tournament-enc-v1": Buffer.alloc(32, 74) },
    },
    authentication: {
      baseUrl,
      production: false,
      trustedOrigins: nativeOrigin === "" ? [baseUrl] : [baseUrl, nativeOrigin],
      ...(nativeOrigin === "" ? {} : { nativeVerificationOrigin: nativeOrigin }),
      secrets: [{ version: 1, value: "v9sJKIroN0VPRa7m1/9ItfxuMJoDEG1HL7gX0KwJyKQ=" }],
      nativeClientIds: [
        "mk8dx.timetrials.android.v1", "mk8dx.timetrials.desktop.v1",
        "mk8dx.tournament.desktop.v1",
      ],
      clientIpHeaders: ["x-real-ip"],
      trustedProxyAddresses: ["127.0.0.1"],
    },
    smtp: {
      host: "smtp.example.test", port: 465, secure: true,
      username: "local-qa", password: "local-qa", fromAddress: "qa@example.test",
      allowedLinkOrigin: baseUrl,
    },
    webManual: {
      producerVersion: "local-production-qa-mirror",
      csrfKeys: { activeKeyVersion: "local-qa-csrf-v1", keys: { "local-qa-csrf-v1": Buffer.alloc(32, 76) } },
    },
    // Web Push needs an operator VAPID pair to be offered at all. The mirror
    // mints a disposable one per start, kept beside the rest of the restricted
    // runtime handoff, so the QA notification surface can be exercised without
    // ever borrowing production's keys.
    ...(webPushKeys === null ? {} : { webPush: webPushKeys }),
    staticWeb: { files: await loadStaticWebFiles(webRoot) },
    gameAssets: { rootDirectory: gameAssetRoot },
  }, () => ({
    async verify() {},
    async sendMagicLink(message) {
      const entry = { email: message.email, url: message.url, createdAt: new Date().toISOString() };
      magicLinks.push(entry);
      appendFileSync(magicLinkLog, `${JSON.stringify(entry)}\n`);
    },
    // ADR-0209: a native client's sign-in email (link + code) lands in the same local log.
    async sendNativeSignIn(message) {
      const entry = { kind: "native-sign-in", email: message.email, url: message.url, code: message.code, userCode: message.userCode, createdAt: new Date().toISOString() };
      appendFileSync(magicLinkLog, `${JSON.stringify(entry)}\n`);
    },
    close() {},
  }));

  await runtime.app.listen({ host: "127.0.0.1", port: applicationPort });
  const webFront = await createQaWebFront(scannerRoot, applicationPort, port);
  const selectorPort = port + 1;
  if (selectorPort > 65535) fail("profile-selector port is invalid");
  const selectorServer = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${selectorPort}`);
      if (request.headers.host === `127.0.0.1:${selectorPort}` && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" }).end(); return;
      }
      const authorized = request.headers.host === `127.0.0.1:${selectorPort}` &&
        url.searchParams.get("token") === selectorToken;
      if (!authorized || request.method !== "GET") {
        response.writeHead(404).end(); return;
      }
      if (url.pathname === "/") {
        const choices = profiles.map((profile) =>
          `<li><a href="/select?token=${selectorToken}&player=${encodeURIComponent(profile.playerId)}">` +
          `${escapeHtml(profile.displayName)} <small>@${escapeHtml(profile.username)}</small></a></li>`).join("");
        const body = `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
          `<title>MK8DX lokale QA-profielkiezer</title><style>` +
          `body{font:16px system-ui;background:#10151b;color:#f3f6f8;max-width:720px;margin:48px auto;padding:24px}` +
          `h1{font-size:1.6rem}p{color:#aebdca}ul{padding:0;display:grid;gap:12px}li{list-style:none}` +
          `a{display:block;padding:16px 18px;border:1px solid #344553;border-radius:12px;color:#8de8ff;background:#18222b;text-decoration:none}` +
          `a:hover{border-color:#36d4f2}small{color:#9babb7}</style>` +
          `<h1>Kies een lokaal QA-profiel</h1><p>De selectie opent een echte lokale sessie met gespiegelde rechten en persoonlijke view.</p>` +
          `<ul>${choices}</ul></html>`;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(body); return;
      }
      if (url.pathname === "/select" && url.searchParams.get("player")) {
        const issued = await issuePlayerLogin(
          pool, baseUrl, url.searchParams.get("player"), verifierAccountId, profiles,
        );
        response.writeHead(302, { location: issued.loginUrl, "cache-control": "no-store" });
        response.end(); return;
      }
      response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error?.message ?? "profile selection failed"));
    }
  });
  await new Promise((accept, reject) => {
    selectorServer.once("error", reject);
    selectorServer.listen(selectorPort, "127.0.0.1", accept);
  });
  const login = await issuePlayerLogin(pool, baseUrl, initialPlayer, verifierAccountId, profiles);
  const adoptedTournaments = await adoptImportedTournamentDirectors(pool, login.accountId);
  const grantedTournamentOperator = await grantTournamentOperator(
    pool, login.accountId, verifierAccountId,
  );
  const issueRequestPath = `${handoffPath}.issue-player.txt`;
  const issueResultPath = `${handoffPath}.issue-result.json`;
  writeFileSync(issueRequestPath, "", { flag: "wx" });
  const handoff = {
    kind: "mk8dx.local-production-qa-stack.v1",
    dockerProject: process.env.MK8DX_QA_DOCKER_PROJECT ?? "mk8dx-local-qa",
    processId: process.pid,
    baseUrl,
    initialLogin: login,
    adoptedTournaments,
    grantedTournamentOperator,
    issueRequestPath,
    issueResultPath,
    profileSelectorUrl: `http://127.0.0.1:${selectorPort}/?token=${selectorToken}`,
    profileSwitchUrls: profiles.map((profile) => ({
      playerId: profile.playerId,
      displayName: profile.displayName,
      username: profile.username,
      url: `http://127.0.0.1:${selectorPort}/select?token=${selectorToken}` +
        `&player=${encodeURIComponent(profile.username)}`,
    })),
    magicLinkLog,
    sourceCapturedAt: snapshot.capturedAt,
    availableProfiles: profiles.map((profile) => ({
      playerId: profile.playerId, displayName: profile.displayName, username: profile.username,
    })),
    startedAt: new Date().toISOString(),
  };
  writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Local QA mirror ready on ${baseUrl} as ${login.displayName}\n`);
  process.stdout.write(`Login URL: ${login.loginUrl}\n`);

  let issuing = false;
  setInterval(async () => {
    if (issuing) return;
    let selector = "";
    try { selector = readFileSync(issueRequestPath, "utf8").trim(); } catch { return; }
    if (!selector) return;
    issuing = true;
    writeFileSync(issueRequestPath, "");
    try {
      const result = await issuePlayerLogin(pool, baseUrl, selector, verifierAccountId, profiles);
      writeFileSync(issueResultPath, `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    } catch (error) {
      writeFileSync(issueResultPath, `${JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2)}\n`);
    } finally {
      issuing = false;
    }
  }, 400);

  async function close() {
    await new Promise((accept) => selectorServer.close(() => accept())).catch(() => undefined);
    await new Promise((accept) => webFront.close(() => accept())).catch(() => undefined);
    await runtime.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
  process.on("SIGINT", () => void close().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void close().finally(() => process.exit(0)));
  await new Promise(() => {});
}

await main();
