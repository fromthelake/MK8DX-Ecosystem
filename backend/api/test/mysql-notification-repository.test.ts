import { describe, expect, it } from "vitest";

import { MysqlNotificationRepository } from
  "../src/notifications/mysql-notification-repository.js";

type Response = readonly [unknown, unknown];

class SyntheticExecutor {
  public readonly writes: Readonly<{ sql: string; parameters: readonly unknown[] }>[] = [];
  public readonly reads: string[] = [];

  public constructor(
    private readonly current: readonly Record<string, unknown>[],
    private readonly previous: readonly Record<string, unknown>[],
    private readonly recipients: readonly Record<string, unknown>[],
  ) {}

  public async execute(sql: string, parameters: readonly unknown[] = []): Promise<Response> {
    this.reads.push(sql);
    if (sql.includes("INSERT INTO notifications")) {
      this.writes.push({ sql, parameters });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SELECT revision.track_id AS trackId")) return [this.current, []];
    if (sql.includes("SELECT MIN(candidate.totalTimeMs)")) return [this.previous, []];
    if (sql.includes("WITH ranked AS")) return [this.recipients, []];
    if (sql.includes("FROM players WHERE public_id = ?")) return [this.current, []];
    if (sql.includes("FROM administrator_grants AS grant_record")) return [this.recipients, []];
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  }
}

function repository(executor: SyntheticExecutor): MysqlNotificationRepository {
  return new MysqlNotificationRepository(executor as never);
}

describe("canonical overtake notification projection", () => {
  it("persists the exact Ben/Floyd consequence once with rank and delta evidence", async () => {
    const executor = new SyntheticExecutor(
      [{
        trackId: "track.mario_circuit", modeCc: 150, totalTimeMs: 116_331,
        actorInternalId: 12, actorPublicId: "player.floyd",
      }],
      [{ previousBestMs: 117_200 }],
      [{ recipientAccountId: 31, recipientBestMs: 116_942, recipientRank: 4 }],
    );

    await repository(executor).produceOvertaken(
      "user_submission.time.FLOYD01", 1_900_000_100_000,
    );

    expect(executor.writes).toHaveLength(1);
    const values = executor.writes[0]!.parameters;
    expect(values[0]).toBe(31);
    expect(values[1]).toBe("overtaken");
    expect(values[3]).toBe(12);
    expect(values[4]).toBe("track.mario_circuit");
    expect(values[5]).toBe(150);
    expect(values[7]).toBe(116_331);
    expect(values[8]).toBe(116_942);
    expect(values[9]).toBe(4);
    expect(executor.reads.join("\n")).toContain("player.player_kind = 'human'");
    expect(executor.reads.join("\n")).toContain("FROM time_trial_player_bests AS best");
    expect(executor.reads.join("\n")).toContain("best.track_id = ? AND best.mode_cc = ?");
    expect(executor.reads.join("\n")).not.toContain("notification_preferences");
  });

  it("collapses a second improvement in the same actor/track/cc window", async () => {
    const first = new SyntheticExecutor(
      [{ trackId: "track.mario_circuit", modeCc: 150, totalTimeMs: 116_331, actorInternalId: 12, actorPublicId: "player.floyd" }],
      [{ previousBestMs: 117_200 }],
      [{ recipientAccountId: 31, recipientBestMs: 116_942, recipientRank: 4 }],
    );
    const second = new SyntheticExecutor(
      [{ trackId: "track.mario_circuit", modeCc: 150, totalTimeMs: 116_200, actorInternalId: 12, actorPublicId: "player.floyd" }],
      [{ previousBestMs: 116_331 }],
      [{ recipientAccountId: 31, recipientBestMs: 116_942, recipientRank: 4 }],
    );
    await repository(first).produceOvertaken("user_submission.time.FLOYD01", 1_900_000_100_000);
    await repository(second).produceOvertaken("user_submission.time.FLOYD02", 1_900_000_160_000);
    expect(first.writes[0]!.parameters[2]).toBe(second.writes[0]!.parameters[2]);
    expect(second.writes[0]!.sql).toContain("event_count = event_count + 1");
    expect(second.writes[0]!.parameters[7]).toBe(116_200);
  });

  it("does nothing for a non-PB or non-public/non-human publication", async () => {
    const slower = new SyntheticExecutor(
      [{ trackId: "track.mario_circuit", modeCc: 150, totalTimeMs: 116_500, actorInternalId: 12, actorPublicId: "player.floyd" }],
      [{ previousBestMs: 116_331 }],
      [{ recipientAccountId: 31, recipientBestMs: 116_942, recipientRank: 4 }],
    );
    await repository(slower).produceOvertaken("user_submission.time.SLOWER01", 1_900_000_200_000);
    expect(slower.writes).toHaveLength(0);

    const withheld = new SyntheticExecutor([], [], []);
    await repository(withheld).produceOvertaken("user_submission.time.PRIVATE01", 1_900_000_200_000);
    expect(withheld.writes).toHaveLength(0);
  });
});

describe("claim requested notification projection", () => {
  it("tells every active administrator once per claim, naming the claimed Player", async () => {
    const executor = new SyntheticExecutor(
      [{ playerInternalId: 64 }],
      [],
      [{ accountInternalId: 1 }, { accountInternalId: 5 }, { accountInternalId: "junk" }],
    );

    await repository(executor).produceClaimRequested(
      "player_claim.kikker-01", "player.dd7fac5a", 1_900_000_100_000,
    );

    expect(executor.writes).toHaveLength(2);
    for (const [index, recipient] of [1, 5].entries()) {
      const values = executor.writes[index]!.parameters;
      expect(values[0]).toBe(recipient);
      expect(values[1]).toBe("claim_requested");
      expect(values[2]).toBe("claim_requested|player_claim.kikker-01");
      expect(values[3]).toBe(64);
      expect(values[6]).toBe("requested");
    }
    expect(executor.reads.join(" ")).toContain("grant_record.grant_status = 'active'");
    // The Directors of the Player's Tournaments review too; the person asking never hears their own request.
    expect(executor.reads.join(" ")).toContain("tournament.director_user_account_id");
    expect(executor.reads.join(" ")).toContain("NOT IN");
  });

  it("files a reply apart from the request, so a reviewer who read the request still sees it", async () => {
    const executor = new SyntheticExecutor([{ playerInternalId: 64 }], [], [{ accountInternalId: 7 }]);
    await repository(executor).produceClaimRequested(
      "player_claim.kikker-01", "player.dd7fac5a", 1_900_000_100_000, "reply",
    );
    const values = executor.writes[0]!.parameters;
    expect(values[2]).toBe("claim_reply|player_claim.kikker-01");
    expect(values[6]).toBe("reply");
  });
});
