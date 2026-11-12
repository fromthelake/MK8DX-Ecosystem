import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountTournamentIncomingSection,
  provisionalIncomingGroupSummaries,
} from "../src/tournament-incoming-section.js";
import type { IncomingTournamentResult } from "../src/tournament-incoming-client.js";
import { FakeDocument, descendants, type FakeNode } from "./dom-double.js";

function race(id: string, segment: number, ben: number, evan: number): IncomingTournamentResult {
  return {
    incomingResultId: id,
    tournamentId: "tournament.synthetic_feed",
    sourceKind: "tournament_live_capture",
    status: "pending",
    revision: 1,
    result: {
      scoringSegment: segment,
      placements: [
        { observedPlayerName: "Ben", scoring: { racePoints: ben }, participantReference: { namespace: "producer_local_player", value: "ben" } },
        { observedPlayerName: "Evan", scoring: { racePoints: evan }, participantReference: { namespace: "producer_local_player", value: "evan" } },
      ],
    },
    suggestedPhase: "qualifier",
    suggestedGroupId: "tournament_group.feed_a",
    suggestedRaceNumber: 1,
    occurredAtMs: null,
    capturedAtMs: 1,
    duplicateWarning: false,
    evidenceRecordId: "evidence-1",
    submittedByDisplayName: "Capture operator",
    createdAtMs: 1,
  };
}

describe("provisional Tournament desktop feed", () => {
  it("aggregates part totals and derives connection errors from the highest segment", () => {
    expect(provisionalIncomingGroupSummaries([
      race("incoming.1", 1, 15, 12),
      race("incoming.2", 2, 10, 15),
      race("incoming.3", 2, 12, 10),
    ])).toEqual([{
      groupId: "tournament_group.feed_a",
      races: 3,
      connectionErrors: 1,
      blocked: false,
      totals: [
        { observedPlayer: "Ben", points: 37 },
        { observedPlayer: "Evan", points: 37 },
      ],
    }]);
  });

  it("blocks more than three resets instead of truncating the feed", () => {
    expect(provisionalIncomingGroupSummaries([race("incoming.5", 5, 15, 12)])[0]).toMatchObject({
      connectionErrors: 4,
      blocked: true,
    });
  });
});

function liveRecord(recordId: string, status: "requested" | "active" | "stopping", approvedAtMs: number | null) {
  return {
    recordId, clientRecordId: `run-${recordId}`, revision: 3, status: "uploading",
    sourceKind: "tournament_live_capture",
    uploadedBy: { userAccountId: "user_account.capture", displayName: "Capture operator" },
    startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null, complete: false,
    suggestedTournamentId: "tournament.synthetic_live", suggestedTournamentName: "Live night",
    linkedTournamentId: null, groups: [], resultCount: 0, createdAtMs: 1, updatedAtMs: 2,
    live: {
      status, approvedAtMs, stoppedAtMs: null, completedAtMs: null,
      mappings: [{ observedGroupLabel: "Capture Card A", groupId: "tournament_group.live_a", phase: "qualifier" }],
    },
  };
}

describe("stale Tournament Live requests", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  async function mount(records: readonly unknown[], dismiss: (body: unknown) => Response) {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/v1/session/csrf") return Response.json({ headerName: "x-mk8dx-csrf", value: "proof" });
      if (url.endsWith("/evidence-records")) return Response.json({ records });
      if (url.endsWith("/incoming-results")) return Response.json({ results: [] });
      if (url.includes("/actions/dismiss-live")) {
        const body = JSON.parse(String(init?.body)) as unknown;
        posted.push({ url, body });
        return dismiss(body);
      }
      throw new Error(`unexpected ${url}`);
    }));
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onChanged = vi.fn(async () => undefined);
    await mountTournamentIncomingSection({
      document: document as never,
      container: container as never,
      tournament: {
        summary: { tournamentId: "tournament.synthetic_live", workflowStep: 5 },
        groups: [{ groupId: "tournament_group.live_a", stage: "qualifier", name: "Group 1", tierKey: null, members: [], races: [] }],
        participants: [],
      } as never,
      onChanged,
    });
    return { container: container as unknown as FakeNode, posted, onChanged };
  }

  const settle = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
  const dismissButtons = (root: FakeNode) => descendants(root).filter((node) =>
    node.textContent === "Dismiss this live request" || node.textContent === "Click again to dismiss");

  it("offers dismissal only for requests that never went public, after a second click", async () => {
    const { container, posted, onChanged } = await mount([
      liveRecord("evidence.requested", "requested", null),
      liveRecord("evidence.active", "active", 5),
      liveRecord("evidence.stopping_approved", "stopping", 5),
      liveRecord("evidence.stopping_unapproved", "stopping", null),
    ], () => Response.json({ record: { ...liveRecord("evidence.requested", "requested", null), revision: 4,
      live: { status: "invalidated", mappings: [], approvedAtMs: null, stoppedAtMs: null, completedAtMs: null } } }));
    const buttons = dismissButtons(container);
    expect(buttons).toHaveLength(2);
    const first = buttons[0]!;
    first.click();
    await settle();
    expect(posted).toHaveLength(0);
    expect(first.textContent).toBe("Click again to dismiss");
    first.click();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([{
      url: "/v1/administrator/tournaments/tournament.synthetic_live/evidence-records/evidence.requested/actions/dismiss-live",
      body: { expectedRevision: 3, reason: "Stale live request dismissed by Tournament director" },
    }]);
  });

  it("re-arms the button and shows the refusal when the API refuses", async () => {
    const { container, onChanged } = await mount([liveRecord("evidence.requested", "requested", null)],
      () => Response.json({ code: "tournament_conflict", message: "refused" }, { status: 409 }));
    const button = dismissButtons(container)[0]!;
    button.click();
    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(onChanged).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Dismiss this live request");
  });
});
