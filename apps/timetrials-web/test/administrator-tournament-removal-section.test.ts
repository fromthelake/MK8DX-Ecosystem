import { describe, expect, it, vi } from "vitest";

import { mountAdministratorTournamentRemovalSection } from
  "../src/administrator-tournament-removal-section.js";
import { useDocument } from "../src/ds-components.js";
import type { TournamentSummary } from "../src/tournament-operation-client.js";
import { FakeDocument, type FakeNode, descendants } from "./dom-double.js";

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const tournaments: readonly TournamentSummary[] = [
  {
    tournamentId: "tournament.showtime_one",
    name: "Showtime Night",
    eventDate: "2026-09-19",
    stage: "finalized",
    workflowStep: 11,
    qualifierRounds: true,
    revision: 9,
    participantCount: 24,
    presentCount: 24,
    publicResults: true,
    affectsRating: true,
    updatedAtMs: 1_800_000_000_000,
    seedingSource: "community_rating",
    verifiedOnly: false,
  },
  {
    tournamentId: "tournament.club_two",
    name: "Club Qualifier",
    eventDate: "2026-10-10",
    stage: "qualifiers",
    workflowStep: 6,
    qualifierRounds: true,
    revision: 4,
    participantCount: 16,
    presentCount: 14,
    publicResults: false,
    affectsRating: false,
    updatedAtMs: 1_800_000_000_001,
    seedingSource: "community_rating",
    verifiedOnly: false,
  },
];

describe("administrator Tournament removal section", () => {
  it("constrains a destructive action to a searched Tournament choice", async () => {
    const document = new FakeDocument();
    useDocument(document as never);
    const root = document.createElement("div");
    const remove = vi.fn(async () => undefined);
    const mounted = mountAdministratorTournamentRemovalSection(root as never, {
      directory: { async listForAdministrator() { return tournaments; } },
      removal: {
        remove,
        async restore() {
          return { wasRetracted: false, republished: false, ratingEpochId: null };
        },
      },
    });
    await settle();

    const controls = descendants(root);
    const search = controls.find((node) => node.attributes.get("aria-label") === "Find a Tournament")!;
    const choice = controls.find((node) => node.attributes.get("aria-label") === "Tournament")!;
    const reason = controls.find((node) => node.attributes.get("aria-label") === "Reason")!;
    const removeButton = controls.find((node) => node.textContent === "Remove")!;
    expect(controls.some((node) => node.attributes.get("aria-label") === "Tournament id"))
      .toBe(false);
    expect(choice.children.map((option) => option.textContent)).toEqual([
      "Choose a Tournament",
      "Showtime Night · 2026-09-19 · finalized · step 11",
      "Club Qualifier · 2026-10-10 · qualifiers · step 6",
    ]);
    expect(removeButton.attributes.get("data-variant")).toBe("danger");

    search.value = "club";
    search.dispatch("input");
    expect(choice.children.map((option) => option.textContent)).toEqual([
      "Choose a Tournament",
      "Club Qualifier · 2026-10-10 · qualifiers · step 6",
    ]);
    choice.value = "tournament.club_two";
    reason.value = "duplicate event";
    removeButton.dispatch("click");
    const dialog = document.body.children[0]!;
    expect(dialog.tagName).toBe("dialog");
    expect(dialog.attributes.has("aria-describedby")).toBe(true);
    const confirm = descendants(dialog).find((node) => node.textContent === "Remove Tournament")!;
    expect(confirm.attributes.get("data-variant")).toBe("danger");
    confirm.dispatch("click");
    await settle();
    expect(remove).toHaveBeenCalledWith(
      "tournament.club_two",
      "duplicate event",
      expect.any(AbortSignal),
    );

    mounted.dispose();
    expect((root as FakeNode).children).toHaveLength(0);
  });
});
