import { describe, expect, it, vi } from "vitest";
import {
  STORED_REPORT_VISIBILITY, TournamentReportError, TournamentReportService, reportVisibility, type TournamentReportRepository,
} from "../src/tournaments/tournament-report-service.js";

function repository(): TournamentReportRepository {
  return { hasCapability: vi.fn(async () => false), listActiveGrants: vi.fn(async () => []), grant: vi.fn(async (input) => ({ grantId: input.grantId, userAccountId: input.userAccountId, capability: "tournament.analytics.night_report", status: "active", revision: 1, grantedAtMs: input.occurredAtMs })), revoke: vi.fn(), loadDraft: vi.fn(async () => null), saveDraft: vi.fn() } as never;
}

describe("TournamentReportService", () => {
  it("allows Admin without a named-account special case and denies an ordinary account without the grant", async () => {
    const repo = repository(); const tournaments = { loadForReport: vi.fn(async () => ({ summary: { tournamentId: "tournament.synthetic01" } })) };
    const service = new TournamentReportService(repo, tournaments as never, { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 42 });
    await expect(service.load({ role: "account", userAccountId: "user_account.ordinary" } as never, "tournament.synthetic01")).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.load({ role: "administrator", userAccountId: "user_account.ben" } as never, "tournament.synthetic01")).resolves.toMatchObject({ schemaVersion: "mk8dx.tournament-night-report.v1" });
  });
  it("requires Admin for grant and records an explicit account capability", async () => {
    const repo = repository(); const service = new TournamentReportService(repo, { loadForReport: vi.fn() } as never, { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 42 });
    await expect(service.grant({ role: "account", userAccountId: "user_account.ordinary" } as never, "user_account.evan", "report_author_access")).rejects.toBeInstanceOf(TournamentReportError);
    await expect(service.grant({ role: "administrator", userAccountId: "user_account.ben" } as never, "user_account.evan", "report_author_access")).resolves.toMatchObject({ userAccountId: "user_account.evan", status: "active" });
  });
});

/** A night with one final group, two Players, finalized unless told otherwise. */
function night(stage: "finals" | "finalized" = "finalized", affectsRating = true) {
  return {
    summary: { tournamentId: "tournament.synthetic01", name: "Friday night", stage, affectsRating },
    participants: [
      { playerId: "player.ben", displayName: "Ben" },
      { playerId: "player.evan", displayName: "Evan" },
    ],
    groups: [{
      groupId: "tournament_group.kampioen",
      name: "Kampioen",
      members: [
        { playerId: "player.ben", displayName: "Ben" },
        { playerId: "player.evan", displayName: "Evan" },
      ],
    }],
  };
}

const DRAFT = {
  revision: 3,
  titleText: "",
  introText: "Een lange avond.\n\nEn nog een alinea.",
  summaryText: "Kort samengevat.",
  tracksIntroText: "Baby Park weer.",
  playerNotes: { "player.ben": "Ben reed sterk.", "player.evan": "   " },
  groupNotes: { "tournament_group.kampioen": "De kampioenengroep." },
  visibility: { topTracks: true, benchmark: false, duel: true, distribution: true },
  updatedAtMs: 10,
};

function publishing(stage: "finals" | "finalized" = "finalized", draft: unknown = DRAFT) {
  const published: { payload?: unknown } = {};
  const repo = {
    ...repository(),
    hasCapability: vi.fn(async () => true),
    loadDraft: vi.fn(async () => draft),
    publish: vi.fn(async (input: { payload: unknown; expectedRevision: number; occurredAtMs: number }) => {
      published.payload = input.payload;
      return { ...(draft as Record<string, unknown>), publishedRevision: input.expectedRevision, publishedAtMs: input.occurredAtMs };
    }),
  } as unknown as TournamentReportRepository;
  const service = new TournamentReportService(
    repo, { loadForReport: vi.fn(async () => night(stage)) } as never,
    { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 },
  );
  return { service, published, repo };
}

const DIRECTOR = { role: "account", userAccountId: "user_account.evan" } as never;

describe("publishing a night's own report", () => {
  it("refuses until the night is finalized: the document prints its final standing", async () => {
    const { service } = publishing("finals");
    await expect(service.publish(DIRECTOR, "tournament.synthetic01", 3))
      .rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses a revision that is not the one on the table", async () => {
    const { service } = publishing();
    await expect(service.publish(DIRECTOR, "tournament.synthetic01", 2))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses when nothing has been written", async () => {
    const { service } = publishing("finalized", null);
    await expect(service.publish(DIRECTOR, "tournament.synthetic01", 1))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("copies the draft into what the community reads, keyed by name", async () => {
    const { service, published } = publishing();
    await expect(service.publish(DIRECTOR, "tournament.synthetic01", 3)).resolves.toMatchObject({
      publishedRevision: 3, publishedAtMs: 4242,
    });
    expect(published.payload).toEqual({
      // No title written, so the night's own name stands.
      title: "Friday night",
      // A blank line is a paragraph break.
      intro: ["Een lange avond.", "En nog een alinea."],
      summary: ["Kort samengevat."],
      topTracks: ["Baby Park weer."],
      // The same blocks with the formatting, for the web.
      introHtml: ["<p>Een lange avond.</p>", "<p>En nog een alinea.</p>"],
      summaryHtml: ["<p>Kort samengevat.</p>"],
      topTracksHtml: ["<p>Baby Park weer.</p>"],
      // The group note travels under the group's own name.
      groups: [{ name: "Kampioen", paragraphs: ["De kampioenengroep."], html: ["<p>De kampioenengroep.</p>"] }],
      // Evan's note is only spaces, so he gets none; Ben is named, not keyed.
      players: [{ name: "Ben", paragraphs: ["Ben reed sterk."], html: ["<p>Ben reed sterk.</p>"] }],
      visibility: { topTracks: true, benchmark: false, duel: true, distribution: true },
      publishedAtMs: 4242,
      revision: 3,
    });
  });

  it("freezes where the participants stand on the SP ranking, by name, when the night counts", async () => {
    // The Ranking page's order, mu and sigma; the score is mu - 3 sigma and the rank the position.
    const ratings = {
      listRatings: vi.fn(async () => [
        { playerId: "player.matteo", mu: 30, sigma: 1 },
        { playerId: "player.ben", mu: 28, sigma: 1.5 },
        { playerId: "player.evan", mu: 27, sigma: 1 },
      ]),
      // Ben rose 1 in the qualifiers and 0.5 in the finals; Evan's night had rated finals only.
      stageSplit: vi.fn(async () => new Map([
        ["player.ben", { before: 22, afterQualifiers: 23, afterFinals: 23.5 }],
        ["player.evan", { before: 25, afterQualifiers: null, afterFinals: 24 }],
      ])),
    };
    const repo = {
      ...repository(), hasCapability: vi.fn(async () => true), loadDraft: vi.fn(async () => DRAFT),
      publish: vi.fn(async (input: { payload: unknown }) => ({ ...DRAFT, publishedRevision: 3, publishedAtMs: 4242, payload: input.payload })),
    } as unknown as TournamentReportRepository;
    const service = new TournamentReportService(
      repo, { loadForReport: vi.fn(async () => night("finalized", true)) } as never,
      { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 }, ratings,
    );
    const published = await service.publish(DIRECTOR, "tournament.synthetic01", 3) as unknown as { payload: { ratings: unknown } };
    expect(published.payload.ratings).toEqual({
      asOfMs: 4242,
      // Matteo did not play: only the night's own participants, named as shown that night.
      players: [{ name: "Ben", rank: 2, score: 23.5, qualifierDelta: 1, finalDelta: 0.5 }, { name: "Evan", rank: 3, score: 24, finalDelta: -1 }],
    });
    const document = await service.load(DIRECTOR, "tournament.synthetic01");
    expect(document.ratings).toEqual({ asOfMs: 4242, players: [{ name: "Ben", rank: 2, score: 23.5, qualifierDelta: 1, finalDelta: 0.5 }, { name: "Evan", rank: 3, score: 24, finalDelta: -1 }] });
  });

  it("carries no ranking before the night is finalized, when it does not count, or without a rating store", async () => {
    const ratings = { listRatings: vi.fn(async () => [{ playerId: "player.ben", mu: 28, sigma: 1.5 }]) };
    for (const [stage, affects, store] of [["finals", true, ratings], ["finalized", false, ratings], ["finalized", true, null]] as const) {
      const service = new TournamentReportService(
        { ...repository(), hasCapability: vi.fn(async () => true), loadDraft: vi.fn(async () => DRAFT) } as unknown as TournamentReportRepository,
        { loadForReport: vi.fn(async () => night(stage, affects)) } as never,
        { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 }, store,
      );
      expect((await service.load(DIRECTOR, "tournament.synthetic01")).ratings).toBeNull();
    }
    expect(ratings.listRatings).not.toHaveBeenCalled();
  });

  it("takes the Director's own title when they wrote one", async () => {
    const { service, published } = publishing("finalized", { ...DRAFT, titleText: "TN13 'Full Send'" });
    await service.publish(DIRECTOR, "tournament.synthetic01", 3);
    expect((published.payload as { title: string }).title).toBe("TN13 'Full Send'");
  });

  it("keeps a group note out when its group is gone", async () => {
    const { service, published } = publishing("finalized", {
      ...DRAFT, groupNotes: { "tournament_group.removed": "Over een groep die er niet meer is." },
    });
    await service.publish(DIRECTOR, "tournament.synthetic01", 3);
    expect((published.payload as { groups: unknown[] }).groups).toEqual([]);
  });
});

describe("formatted report text", () => {
  it("stores the sanitised markup and publishes plain paragraphs beside the formatted blocks", async () => {
    const saved: { input?: Record<string, unknown> } = {};
    const repo = {
      ...repository(), hasCapability: vi.fn(async () => true),
      saveDraft: vi.fn(async (input: Record<string, unknown>) => { saved.input = input; return { ...DRAFT, ...input }; }),
    } as unknown as TournamentReportRepository;
    const service = new TournamentReportService(
      repo, { loadForReport: vi.fn(async () => night("finals")) } as never,
      { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 },
    );
    await service.saveDraft(DIRECTOR, "tournament.synthetic01", {
      expectedRevision: null,
      introText: "<div style=\"color:#d64b2a\"><b>Valerio</b> wint</div><script>x()</script><p>tweede</p>",
      tracksIntroText: "gewoon tekst\n\ntweede alinea",
      playerNotes: { "player.ben": "<ul><li onclick=\"x()\">sterk</li></ul>" },
    });
    expect(saved.input).toMatchObject({
      introText: "<p><strong>Valerio</strong> wint</p><p>tweede</p>",
      tracksIntroText: "<p>gewoon tekst</p><p>tweede alinea</p>",
      playerNotes: { "player.ben": "<ul><li>sterk</li></ul>" },
    });
    const { service: publisher, published } = publishing("finalized", {
      ...DRAFT, introText: "<p class=\"rt-align-center\"><em>Midden</em></p>", playerNotes: { "player.ben": "<ol><li>een</li><li>twee</li></ol>" },
    });
    await publisher.publish(DIRECTOR, "tournament.synthetic01", 3);
    expect(published.payload).toMatchObject({
      intro: ["Midden"], introHtml: ["<p class=\"rt-align-center\"><em>Midden</em></p>"],
      players: [{ name: "Ben", paragraphs: ["1. een\n2. twee"], html: ["<ol><li>een</li><li>twee</li></ol>"] }],
    });
  });
  it("rejects a note that is still too long after sanitising", async () => {
    const repo = { ...repository(), hasCapability: vi.fn(async () => true) } as unknown as TournamentReportRepository;
    const service = new TournamentReportService(
      repo, { loadForReport: vi.fn(async () => night("finals")) } as never,
      { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 },
    );
    await expect(service.saveDraft(DIRECTOR, "tournament.synthetic01", {
      expectedRevision: null, introText: "x", tracksIntroText: "", playerNotes: { "player.ben": `<p>${"a".repeat(2001)}</p>` },
    })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("which blocks a report shows", () => {
  it("starts a new report with the intro and the group notes off and the Summary on", async () => {
    const saved: { input?: Record<string, unknown> } = {};
    const repo = {
      ...repository(), hasCapability: vi.fn(async () => true),
      saveDraft: vi.fn(async (input: Record<string, unknown>) => { saved.input = input; return { ...DRAFT, ...input }; }),
    } as unknown as TournamentReportRepository;
    const service = new TournamentReportService(
      repo, { loadForReport: vi.fn(async () => night("finals")) } as never,
      { newGrantId: () => "account_capability_grant.synthetic01" }, { nowMs: () => 4242 },
    );
    await service.saveDraft(DIRECTOR, "tournament.synthetic01", {
      expectedRevision: null, introText: "", tracksIntroText: "", playerNotes: {},
      visibility: { benchmark: false },
    });
    expect(saved.input?.["visibility"]).toEqual({
      topTracks: true, benchmark: false, duel: true, distribution: true,
      intro: false, summary: true, groupNotes: false,
    });
  });

  it("keeps every block of a report stored before the switches existed", () => {
    const stored = { topTracks: true, benchmark: false, duel: true, distribution: true };
    expect(reportVisibility(stored, STORED_REPORT_VISIBILITY)).toEqual({ ...stored, intro: true, summary: true, groupNotes: true });
    expect(reportVisibility({ ...stored, intro: false, groupNotes: false }, STORED_REPORT_VISIBILITY))
      .toMatchObject({ intro: false, summary: true, groupNotes: false });
  });
});
