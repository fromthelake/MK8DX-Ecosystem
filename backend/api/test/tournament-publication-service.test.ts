import { describe, expect, it, vi } from "vitest";

import {
  TournamentPublicationService,
  TournamentPublicationServiceError,
  type TournamentPublicationRepository,
} from "../src/tournaments/tournament-publication-service.js";

const administrator = {
  role: "administrator" as const,
  userAccountId: "user_account.admin",
};
const target = {
  raceResultId: "tournament_race_result.race001",
  revision: 2,
};
const published = {
  publicationId: "tournament_publication.event001",
  eventName: "Summer Cup",
  status: "published" as const,
  revision: 1,
  resultCount: 1,
  publishedAtMs: 1_760_000_000_000,
  updatedAtMs: 1_760_000_000_000,
};

function setup() {
  const repository: TournamentPublicationRepository = {
    listReview: vi.fn(async () => ({ publications: [], candidates: [] })),
    create: vi.fn(async () => published),
    republish: vi.fn(async (input) => ({ ...published, revision: input.expectedRevision + 1 })),
    retract: vi.fn(async (input) => {
      const { publishedAtMs: _publishedAtMs, ...current } = published;
      return {
        ...current,
        status: "retracted" as const,
        revision: input.expectedRevision + 1,
        resultCount: 0,
      };
    }),
  };
  return {
    repository,
    service: new TournamentPublicationService(
      repository,
      { newPublicationId: () => published.publicationId },
      { nowMs: () => 1_760_000_000_000 },
    ),
  };
}

describe("TournamentPublicationService", () => {
  it("prepares an explicit administrator publication command", async () => {
    const { service, repository } = setup();
    await expect(service.createPublication(administrator, {
      eventName: "Summer Cup",
      targets: [target],
      reasonCode: "event_completed",
    })).resolves.toEqual(published);
    expect(repository.create).toHaveBeenCalledWith({
      publicationId: published.publicationId,
      eventName: "Summer Cup",
      targets: [target],
      actorUserAccountId: administrator.userAccountId,
      reasonCode: "event_completed",
      occurredAtMs: 1_760_000_000_000,
    });
  });

  it("rejects every non-administrator operation before repository access", async () => {
    const { service, repository } = setup();
    await expect(service.listReview({ role: "account", userAccountId: "user_account.member" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(service.createPublication({ role: "anonymous" }, {
      eventName: "Summer Cup", targets: [target], reasonCode: "event_completed",
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(repository.listReview).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate, stale-shaped, or empty result sets", async () => {
    const { service, repository } = setup();
    for (const targets of [[], [target, target], [{ ...target, revision: 0 }]]) {
      await expect(service.createPublication(administrator, {
        eventName: "Summer Cup", targets, reasonCode: "event_completed",
      })).rejects.toBeInstanceOf(TournamentPublicationServiceError);
    }
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("requires bounded deliberate public event names and reason codes", async () => {
    const { service, repository } = setup();
    await expect(service.createPublication(administrator, {
      eventName: " Summer Cup", targets: [target], reasonCode: "event_completed",
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.createPublication(administrator, {
      eventName: "Summer Cup", targets: [target], reasonCode: "Human prose",
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("forwards optimistic republish and retract transitions", async () => {
    const { service, repository } = setup();
    await service.republish(administrator, published.publicationId, {
      expectedRevision: 4,
      eventName: "Summer Cup Final",
      targets: [target],
      reasonCode: "score_correction",
    });
    await service.retract(administrator, published.publicationId, {
      expectedRevision: 5,
      reasonCode: "operator_retraction",
    });
    expect(repository.republish).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 4,
      actorUserAccountId: administrator.userAccountId,
    }));
    expect(repository.retract).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 5,
      actorUserAccountId: administrator.userAccountId,
    }));
  });

  it("redacts unexpected repository failures", async () => {
    const { service, repository } = setup();
    vi.mocked(repository.listReview).mockRejectedValueOnce(new Error("private sql detail"));
    await expect(service.listReview(administrator)).rejects.toEqual(
      expect.objectContaining({ code: "unavailable", message: expect.not.stringContaining("sql") }),
    );
  });
});
