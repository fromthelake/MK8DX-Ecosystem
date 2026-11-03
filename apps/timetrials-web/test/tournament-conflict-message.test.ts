import { afterEach, describe, expect, it, vi } from "vitest";

import { tournamentConflictMessage } from "../src/tournament-operation-view.js";

afterEach(() => vi.unstubAllGlobals());

describe("Tournament conflict explanations", () => {
  it("distinguishes protected entered races from a stale revision", () => {
    const locked = tournamentConflictMessage("groups with entered races stay locked");
    expect(locked).toContain("stays locked");
    expect(locked).toContain("No results were removed");
    expect(locked).not.toContain("changed in the meantime");
  });

  it("explains a true stale revision as a fresh-read action", () => {
    expect(tournamentConflictMessage("the tournament changed; reload and retry")).toContain(
      "latest data was loaded",
    );
  });

  it("provides the same distinction in Dutch", () => {
    vi.stubGlobal("localStorage", { getItem: () => "nl" });
    const locked = tournamentConflictMessage("groups with entered races stay locked");
    expect(locked).toContain("blijft vergrendeld");
    expect(locked).toContain("geen uitslagen verwijderd");
    expect(tournamentConflictMessage("the tournament changed; reload and retry")).toContain(
      "nieuwste gegevens zijn geladen",
    );
  });
});
