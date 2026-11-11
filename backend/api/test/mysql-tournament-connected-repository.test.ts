import { describe, expect, it } from "vitest";

import { liveRequestIsDismissible, liveStatusAfterStop, MysqlTournamentConnectedRepository } from
  "../src/tournaments/mysql-tournament-connected-repository.js";

describe("MySQL connected Tournament eligibility", () => {
  it("keeps a below-confidence stopped run private and available for director review", () => {
    expect(liveStatusAfterStop("requested")).toBe("requested");
    expect(liveStatusAfterStop("active")).toBe("stopping");
    expect(liveStatusAfterStop("stopping")).toBe("stopping");
  });

  it("allows dismissing only a live request that never went public", () => {
    expect(liveRequestIsDismissible("requested", null)).toBe(true);
    expect(liveRequestIsDismissible("requested", 5)).toBe(true);
    expect(liveRequestIsDismissible("stopping", null)).toBe(true);
    expect(liveRequestIsDismissible("stopping", 5)).toBe(false);
    for (const status of ["none", "active", "complete", "invalidated"]) {
      expect(liveRequestIsDismissible(status, null)).toBe(false);
    }
  });

  it("offers active workflow Tournaments and only the groups relevant to their current phase", async () => {
    const calls: string[] = [];
    const pool = {
      async execute() { return [[{ active: 1 }], []]; },
      async query(sql: string) {
        calls.push(sql);
        if (calls.length === 1) {
          return [[
            {
              internal_id: 41, public_id: "tournament.qualifier", name: "Qualifier night",
              series_label: "TN", edition_number: 41, start_at_ms: 1, timezone_name: "Europe/Amsterdam",
              stage: "qualifiers", workflow_step: 5,
            },
            {
              internal_id: 42, public_id: "tournament.final", name: "Final night",
              series_label: "TN", edition_number: 42, start_at_ms: 2, timezone_name: "Europe/Amsterdam",
              stage: "finals", workflow_step: 9,
            },
          ], []];
        }
        return [[
          { tournament_id: 41, public_id: "group.q", name: "Group A", phase: "qualifier" },
          { tournament_id: 41, public_id: "group.q-old-final", name: "Champion", phase: "final" },
          { tournament_id: 42, public_id: "group.f-old-q", name: "Group A", phase: "qualifier" },
          { tournament_id: 42, public_id: "group.f", name: "Champion", phase: "final" },
        ], []];
      },
    };

    const tournaments = await new MysqlTournamentConnectedRepository(pool as never)
      .listEligibleTournaments("user_account.director");

    expect(calls[0]).toContain("workflow_step BETWEEN 2 AND 9");
    expect(tournaments.map((item) => [item.workflowStep, item.groups.map((group) => group.groupId)])).toEqual([
      [5, ["group.q"]],
      [9, ["group.f"]],
    ]);
  });

  it("fails closed for connected uploads outside Manager Steps 5 and 9", async () => {
    let sql = "";
    const pool = {
      async execute(statement: string) {
        sql = statement;
        return [[], []];
      },
    };
    const id = await new MysqlTournamentConnectedRepository(pool as never)
      .findActiveTournamentInternalId("tournament.not-on-score-step");
    expect(id).toBeNull();
    expect(sql).toContain("workflow_step IN (5, 9)");
  });
});
