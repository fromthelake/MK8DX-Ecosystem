// ADR-0218 against a disposable MySQL/MariaDB with the whole catalog applied
// (migration 0079): two Players may share a display name, usernames take a
// suffix, the own-nights warning is scoped to one Director, the picker's
// context is read from real rows, and a Director's alias stays theirs.

import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlPlayerOnboardingRepository } from "../src/identity/mysql-player-onboarding-repository.js";
import { PlayerOnboardingService, RosterPlayerCreationRejected } from "../src/identity/player-onboarding-service.js";
import { MysqlTournamentOperationRepository } from "../src/tournaments/mysql-tournament-operation-repository.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  (database.endsWith("_test") || database.endsWith("_contract"))
  ? describe
  : describe.skip;

integration("roster picking with repeatable names (ADR-0218)", () => {
  let pool: Pool;
  const tag = randomBytes(3).toString("hex");
  const malName = `Mal ${tag}`;
  const base = `mal_${tag}`;
  const directorA = `user_account.roster_director_a_${tag}`;
  const directorB = `user_account.roster_director_b_${tag}`;
  const tournamentA = `tournament.roster_night_a_${tag}`;
  const tournamentB = `tournament.roster_night_b_${tag}`;
  const now = 1_900_000_000_000;
  let directorAInternal = 0;
  let directorBInternal = 0;
  let tournamentAInternal = 0;
  let malAInternal = 0;
  let malBInternal = 0;
  let sequence = 0;
  const onboarding = (): PlayerOnboardingService => new PlayerOnboardingService(
    new MysqlPlayerOnboardingRepository(pool),
    {
      newPlayerId: () => `player.roster_${tag}_${(sequence += 1)}`,
      newPlayerClaimId: () => `player_claim.roster_${tag}_${(sequence += 1)}`,
    },
    { nowMs: () => now },
  );

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 2,
    });
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', ?, ?), (?, 1, 'private', 'active', ?, ?)`,
      [directorA, now, now, directorB, now, now],
    );
    const [accounts] = await pool.execute<RowDataPacket[]>(
      "SELECT public_id AS publicId, user_account_id AS internalId FROM user_accounts WHERE public_id IN (?, ?)",
      [directorA, directorB],
    );
    directorAInternal = Number(accounts.find((row) => row["publicId"] === directorA)!["internalId"]);
    directorBInternal = Number(accounts.find((row) => row["publicId"] === directorB)!["internalId"]);
  });

  afterAll(async () => { await pool?.end(); });

  it("creates two Players with one display name, each with its own username", async () => {
    const repository = new MysqlPlayerOnboardingRepository(pool);
    const outcomes = await repository.transaction(async (transaction) => [
      await transaction.createPlayerWithUsername({ playerId: `player.roster_${tag}_a`, username: base, displayName: malName, nowMs: now }),
      await transaction.createPlayerWithUsername({ playerId: `player.roster_${tag}_b`, username: `${base}-x`, displayName: malName, nowMs: now }),
      await transaction.createPlayerWithUsername({ playerId: `player.roster_${tag}_c`, username: base, displayName: "Somebody else", nowMs: now }),
      await transaction.usernameTaken!(base),
      await transaction.usernameTaken!(`${base}-9`),
    ]);
    expect(outcomes).toEqual(["created", "created", "username_taken", true, false]);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT public_id AS publicId, player_id AS internalId FROM players WHERE public_id LIKE ? ORDER BY public_id",
      [`player.roster_${tag}_%`],
    );
    // A taken username leaves no Player row behind.
    expect(rows.map((row) => row["publicId"])).toEqual([`player.roster_${tag}_a`, `player.roster_${tag}_b`]);
    malAInternal = Number(rows[0]!["internalId"]);
    malBInternal = Number(rows[1]!["internalId"]);
  });

  it("puts Mal A on Director A's night and Mal B on Director B's", async () => {
    const repository = new MysqlTournamentOperationRepository(pool);
    await repository.transaction(async (transaction) => {
      const night = (tournamentId: string, director: number) => transaction.insertTournament({
        tournamentId, name: `Roster night ${tag}`, seriesLabel: null, editionNumber: null, eventDate: "2026-10-04",
        startAtMs: now, timezone: "Europe/Amsterdam", directorInternalId: director, seedOrder: "ranked",
        placementStrategy: "balanced", ownerSeatingMode: "owner_strict", qualifierTieBreakMode: "sp",
        finalTieBreakMode: "sp", qualifierRounds: true, maxParticipants: null, nowMs: now,
      });
      tournamentAInternal = await night(tournamentA, directorAInternal);
      const tournamentBInternal = await night(tournamentB, directorBInternal);
      for (const [tournament, player] of [[tournamentAInternal, malAInternal], [tournamentBInternal, malBInternal]] as const) {
        await transaction.upsertParticipant({
          tournamentInternalId: tournament, playerInternalId: player, attendance: "present",
          hasSwitch1: false, hasSwitch2: false, seedScore: null, seedRank: null, nowMs: now,
        });
      }
      const group = await transaction.insertGroup({
        tournamentInternalId: tournamentAInternal, groupId: `tournament_group.roster_${tag}_q1`, stage: "qualifier",
        sequence: 1, name: "Groep 1", tierKey: null, nowMs: now,
      });
      await transaction.replaceGroupMembers(group, [{
        playerInternalId: malAInternal, seatOrder: 1, stationOwnerInternalId: null, stationSwitchType: null, seatNumber: null,
      }]);
    });
    // The character a score workbook recorded for Mal A (migration 0061).
    await pool.execute(
      "UPDATE tournament_group_members SET character_key = 'character.yoshi', character_label = 'Yoshi' WHERE player_id = ?",
      [malAInternal],
    );
  });

  it("warns only inside the Director's own nights", async () => {
    const repository = new MysqlPlayerOnboardingRepository(pool);
    const key = malName.toLowerCase();
    const scoped = await repository.transaction(async (transaction) => [
      [...await transaction.displayNamesInDirectorNights!({ actorUserAccountId: directorA, tournamentId: null, displayNames: [malName, "Nobody"] })],
      [...await transaction.displayNamesInDirectorNights!({ actorUserAccountId: directorB, tournamentId: null, displayNames: [` ${malName.toUpperCase()} `] })],
      [...await transaction.displayNamesInDirectorNights!({ actorUserAccountId: `user_account.nobody_${tag}`, tournamentId: null, displayNames: [malName] })],
      [...await transaction.displayNamesInDirectorNights!({ actorUserAccountId: `user_account.nobody_${tag}`, tournamentId: tournamentA, displayNames: [malName] })],
    ]);
    expect(scoped).toEqual([[key], [key], [], [key]]);

    const administrator = { role: "administrator" as const, userAccountId: directorA };
    const refused = await onboarding().createRosterPlayers(
      administrator, [{ row: 4, displayName: malName }], undefined, { tournamentId: tournamentA },
    ).catch((error: unknown) => error);
    expect((refused as RosterPlayerCreationRejected).rejections).toEqual([
      { row: 4, displayName: malName, reason: "display_name_taken" },
    ]);
    const created = await onboarding().createRosterPlayers(
      administrator, [{ row: 4, displayName: malName, confirmSameName: true }], undefined, { tournamentId: tournamentA },
    );
    expect(created).toEqual([expect.objectContaining({ username: `${base}-2`, displayName: malName })]);
  });

  it("reads the picker's context from the rows and keeps a Director's alias theirs", async () => {
    const repository = new MysqlTournamentOperationRepository(pool);
    const before = await repository.transaction((transaction) =>
      transaction.listRosterCandidateContext!(directorAInternal, tournamentAInternal));
    const malA = before.find((entry) => entry.player.playerId === `player.roster_${tag}_a`)!;
    const malB = before.find((entry) => entry.player.playerId === `player.roster_${tag}_b`)!;
    expect(malA).toMatchObject({
      claimed: false, nights: 1, nightsWithDirector: 1, knownToDirector: true, inTournament: true,
      lastNightDate: "2026-10-04",
    });
    expect(malB).toMatchObject({ nights: 1, nightsWithDirector: 0, knownToDirector: false, inTournament: false });
    expect([malA.characterKey, malA.characterLabel]).toEqual(["character.yoshi", "Yoshi"]);

    const outcomes = await repository.transaction(async (transaction) => [
      await transaction.insertDirectorAlias!({
        playerInternalId: malAInternal, directorInternalId: directorAInternal, actorInternalId: directorAInternal,
        aliasText: `Malie ${tag}`, nowMs: now,
      }),
      await transaction.insertDirectorAlias!({
        playerInternalId: malAInternal, directorInternalId: directorAInternal, actorInternalId: directorAInternal,
        aliasText: `MALIE ${tag.toUpperCase()}`, nowMs: now,
      }),
    ]);
    expect(outcomes).toEqual(["created", "exists"]);
    const [aliasRows] = await pool.execute<RowDataPacket[]>(
      `SELECT alias.visibility AS visibility, alias.alias_type AS aliasType, provenance.source_reference AS reference,
              lifecycle.event_type AS eventType
       FROM aliases AS alias
       INNER JOIN alias_provenance AS provenance ON provenance.alias_id = alias.alias_id
       INNER JOIN alias_lifecycle AS lifecycle ON lifecycle.alias_id = alias.alias_id
       WHERE alias.player_id = ? AND alias.director_user_account_id = ?`,
      [malAInternal, directorAInternal],
    );
    expect(aliasRows.map((row) => ({ ...row }))).toEqual([{
      visibility: "restricted", aliasType: "tournament_name", reference: "source.director_roster_choice", eventType: "alias_created",
    }]);
    const seenByA = await repository.transaction((transaction) => transaction.listRosterCandidateContext!(directorAInternal, null));
    const seenByB = await repository.transaction((transaction) => transaction.listRosterCandidateContext!(directorBInternal, null));
    const aliasesOf = (contexts: typeof seenByA) =>
      contexts.find((entry) => entry.player.playerId === `player.roster_${tag}_a`)!.aliases;
    expect(aliasesOf(seenByA)).toEqual([{ text: `Malie ${tag}`, directorScoped: true }]);
    expect(aliasesOf(seenByB)).toEqual([]);
  });
});
