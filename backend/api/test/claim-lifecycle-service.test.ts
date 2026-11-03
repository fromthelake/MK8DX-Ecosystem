import { describe, expect, it } from "vitest";

import {
  ClaimLifecycleError,
  ClaimLifecycleService,
  type AppendClaimEventInput,
  type ClaimIdGenerator,
  type ClaimNoteInput,
  type ClaimSnapshot,
  type ClaimWriteRepository,
  type ClaimWriteTransaction,
  type Clock,
  type CreateClaimInput,
  type EvidenceAccessActor,
} from "../src/identity/claim-lifecycle-service.js";
import type { AccountStatus, ActorContext } from "../src/identity/types.js";

const playerId = "player.synthetic_claim_target_01";
const secondPlayerId = "player.synthetic_claim_target_02";
const ownerAccountId = "user_account.synthetic_claimant_01";
const secondAccountId = "user_account.synthetic_claimant_02";
const adminAccountId = "user_account.synthetic_admin_01";
const directorAccountId = "user_account.synthetic_director_01";
const evidenceId = "restricted_evidence.synthetic_claim_01";

const owner: ActorContext = { role: "account", userAccountId: ownerAccountId };
const secondOwner: ActorContext = {
  role: "account",
  userAccountId: secondAccountId,
};
const administrator: ActorContext = {
  role: "administrator",
  userAccountId: adminAccountId,
};
const director: ActorContext = { role: "account", userAccountId: directorAccountId };

class SyntheticClock implements Clock {
  private value = 1_735_689_600_000;

  nowMs(): number {
    this.value += 1_000;
    return this.value;
  }
}

class SyntheticIdGenerator implements ClaimIdGenerator {
  private sequence = 0;
  private reviewSequence = 0;

  newPlayerClaimId(): string {
    this.sequence += 1;
    return `player_claim.synthetic_generated_${this.sequence.toString().padStart(2, "0")}`;
  }

  newRestrictedReviewId(): string {
    this.reviewSequence += 1;
    return `restricted_review.synthetic_generated_${this.reviewSequence
      .toString()
      .padStart(2, "0")}`;
  }
}

class InMemoryClaimStore implements ClaimWriteRepository, ClaimWriteTransaction {
  readonly playerStatuses = new Map<string, "active" | "archived">([
    [playerId, "active"],
    [secondPlayerId, "active"],
  ]);
  readonly accountStatuses = new Map<string, AccountStatus>([
    [ownerAccountId, "active"],
    [secondAccountId, "active"],
    [adminAccountId, "active"],
    [directorAccountId, "active"],
  ]);
  readonly claims = new Map<string, ClaimSnapshot>();
  readonly creations: CreateClaimInput[] = [];
  readonly appends: AppendClaimEventInput[] = [];
  readonly evidenceAccessActors: EvidenceAccessActor[] = [];
  readonly notes: ClaimNoteInput[] = [];
  /** "account|player" pairs where the account directs a Tournament the Player took part in. */
  readonly directorships = new Set<string>();
  transactionCount = 0;
  forcePlayerVerifiedConflict = false;
  sharedTournament: string | null = null;
  forceEvidenceDenied = false;

  async transaction<T>(
    work: (transaction: ClaimWriteTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async findHumanPlayerStatus(
    requestedPlayerId: string,
  ): Promise<"active" | "archived" | null> {
    return this.playerStatuses.get(requestedPlayerId) ?? null;
  }

  async findUserAccountStatus(
    requestedAccountId: string,
  ): Promise<AccountStatus | null> {
    return this.accountStatuses.get(requestedAccountId) ?? null;
  }

  async findClaimForUpdate(requestedClaimId: string): Promise<ClaimSnapshot | null> {
    return this.claims.get(requestedClaimId) ?? null;
  }

  async hasVerifiedClaimForPlayer(requestedPlayerId: string): Promise<boolean> {
    return (
      this.forcePlayerVerifiedConflict ||
      [...this.claims.values()].some(
        (claim) =>
          claim.playerId === requestedPlayerId && claim.claimStatus === "verified",
      )
    );
  }

  async findTournamentSharedWithAccountPlayers(): Promise<string | null> {
    return this.sharedTournament;
  }

  async isDirectorForPlayer(account: string, player: string): Promise<boolean> {
    return this.directorships.has(`${account}|${player}`);
  }

  async addClaimNote(input: ClaimNoteInput): Promise<void> {
    this.notes.push(input);
  }

  async canUseEvidenceReferences(
    actor: EvidenceAccessActor,
    _evidenceIds: readonly string[],
  ): Promise<boolean> {
    this.evidenceAccessActors.push(actor);
    return !this.forceEvidenceDenied;
  }

  async createClaim(input: CreateClaimInput): Promise<void> {
    if (this.claims.has(input.snapshot.playerClaimId)) {
      throw new Error("synthetic duplicate claim ID");
    }
    this.creations.push(input);
    this.claims.set(input.snapshot.playerClaimId, input.snapshot);
  }

  async appendClaimEvent(input: AppendClaimEventInput): Promise<void> {
    const current = this.claims.get(input.playerClaimId);
    if (current === undefined || current.revision !== input.expectedRevision) {
      throw new Error("synthetic optimistic concurrency conflict");
    }
    this.appends.push(input);
    this.claims.set(input.playerClaimId, input.nextSnapshot);
  }
}

function service(store = new InMemoryClaimStore()) {
  return {
    store,
    service: new ClaimLifecycleService(
      store,
      new SyntheticIdGenerator(),
      new SyntheticClock(),
    ),
  };
}

async function requestedClaim(
  lifecycle: ClaimLifecycleService,
  actor: ActorContext = owner,
): Promise<ClaimSnapshot> {
  return lifecycle.requestClaim(actor, { playerId, evidenceIds: [evidenceId] });
}

async function verifiedClaim(
  lifecycle: ClaimLifecycleService,
): Promise<ClaimSnapshot> {
  const requested = await requestedClaim(lifecycle);
  await lifecycle.administratorAction(administrator, {
    playerClaimId: requested.playerClaimId,
    action: "start_review",
  });
  return lifecycle.administratorAction(administrator, {
    playerClaimId: requested.playerClaimId,
    action: "verify",
    evidenceIds: [evidenceId],
    reasonCode: "evidence_confirmed",
  });
}

describe("claim request", () => {
  it("creates a requested claim and append-only claimant audit event", async () => {
    const { service: lifecycle, store } = service();
    const claim = await requestedClaim(lifecycle);

    expect(claim).toEqual({
      playerClaimId: "player_claim.synthetic_generated_01",
      playerId,
      userAccountId: ownerAccountId,
      claimStatus: "requested",
      disputeStatus: "none",
      revision: 1,
      lastSequence: 1,
    });
    expect(store.creations).toHaveLength(1);
    expect(store.creations[0]).toMatchObject({
      snapshot: claim,
      evidenceIds: [evidenceId],
      initialEvent: {
        sequence: 1,
        eventType: "claim_requested",
        actorType: "requesting_account",
        actorUserAccountId: ownerAccountId,
        evidenceIds: [evidenceId],
      },
    });
    expect(store.evidenceAccessActors).toEqual([
      { actorType: "requesting_account", userAccountId: ownerAccountId },
    ]);
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "migration_operator" },
  ])("rejects non-account requester $role", async (actor) => {
    const { service: lifecycle, store } = service();
    await expect(requestedClaim(lifecycle, actor)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.transactionCount).toBe(0);
  });

  it("lets an administrator request a claim bound to their own account", async () => {
    // The first owner-administrator links their Player through the same
    // self-service claim flow, so the administrator role must not be locked
    // out of requesting a claim for their own user account.
    const { service: lifecycle } = service();
    const snapshot = await requestedClaim(lifecycle, administrator);
    expect(snapshot.claimStatus).toBe("requested");
    expect(snapshot.userAccountId).toBe(administrator.userAccountId);
  });

  it.each([
    ["NintendoStaff", [evidenceId]],
    [playerId, ["raw firebase uid"]],
    [playerId, [evidenceId, evidenceId]],
  ])("rejects system/raw/duplicate command data", async (target, evidenceIds) => {
    const { service: lifecycle, store } = service();
    await expect(
      lifecycle.requestClaim(owner, { playerId: target, evidenceIds }),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(store.transactionCount).toBe(0);
  });

  it("does not accept names, handles, or account IDs as claim proof", async () => {
    const { service: lifecycle, store } = service();
    await lifecycle.requestClaim(owner, { playerId, evidenceIds: [] });
    const serialized = JSON.stringify(store.creations[0]);
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("username");
    expect(serialized).not.toContain("firebase");
    expect(serialized).not.toContain("email");
  });

  it("rejects inaccessible restricted evidence inside the transaction", async () => {
    const { service: lifecycle, store } = service();
    store.forceEvidenceDenied = true;
    await expect(requestedClaim(lifecycle)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.creations).toHaveLength(0);
  });

  it.each(["player", "shared Tournament"])(
    "rejects a request when the %s check fails",
    async (conflict) => {
      const { service: lifecycle, store } = service();
      store.forcePlayerVerifiedConflict = conflict === "player";
      store.sharedTournament = conflict === "player" ? null : "TN12";
      await expect(requestedClaim(lifecycle)).rejects.toMatchObject({
        code: "conflict",
      });
      expect(store.creations).toHaveLength(0);
    },
  );

  it("lets one account own a second Player that never met the first (ADR-0178)", async () => {
    const { service: lifecycle } = service();
    await verifiedClaim(lifecycle);
    const second = await lifecycle.requestClaim(owner, { playerId: secondPlayerId, evidenceIds: [evidenceId] });
    await lifecycle.administratorAction(administrator, { playerClaimId: second.playerClaimId, action: "start_review" });
    const verified = await lifecycle.administratorAction(administrator, {
      playerClaimId: second.playerClaimId, action: "verify", evidenceIds: [evidenceId], reasonCode: "evidence_confirmed",
    });
    expect(verified.claimStatus).toBe("verified");
  });

  it("names the Tournament where the two Players met", async () => {
    const { service: lifecycle, store } = service();
    store.sharedTournament = "TN12";
    await expect(requestedClaim(lifecycle)).rejects.toThrow("raced against this Player in TN12");
  });

  it("rejects archived Players and suspended accounts", async () => {
    const archived = service();
    archived.store.playerStatuses.set(playerId, "archived");
    await expect(requestedClaim(archived.service)).rejects.toMatchObject({
      code: "conflict",
    });

    const suspended = service();
    suspended.store.accountStatuses.set(ownerAccountId, "suspended");
    await expect(requestedClaim(suspended.service)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

describe("administrator review lifecycle", () => {
  it("requires ordered administrator review before verification", async () => {
    const { service: lifecycle, store } = service();
    const requested = await requestedClaim(lifecycle);

    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: requested.playerClaimId,
        action: "verify",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const reviewing = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "start_review",
    });
    const verified = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "verify",
      evidenceIds: [evidenceId],
      reasonCode: "evidence_confirmed",
    });

    expect(reviewing).toMatchObject({
      claimStatus: "under_review",
      revision: 2,
      lastSequence: 2,
    });
    expect(verified).toMatchObject({
      claimStatus: "verified",
      revision: 3,
      lastSequence: 3,
    });
    expect(store.appends.map((item) => item.event.eventType)).toEqual([
      "review_started",
      "claim_verified",
    ]);
    expect(store.appends.map((item) => item.event.actorUserAccountId)).toEqual([
      adminAccountId,
      adminAccountId,
    ]);
    expect(store.appends.map((item) => item.event.privateReviewReference)).toEqual([
      "restricted_review.synthetic_generated_01",
      "restricted_review.synthetic_generated_02",
    ]);
    expect(store.evidenceAccessActors.slice(-2)).toEqual([
      { actorType: "administrator", userAccountId: adminAccountId },
      { actorType: "administrator", userAccountId: adminAccountId },
    ]);
  });

  it("forbids claimant review and verification", async () => {
    const { service: lifecycle } = service();
    const requested = await requestedClaim(lifecycle);
    await expect(
      lifecycle.administratorAction(owner, {
        playerClaimId: requested.playerClaimId,
        action: "start_review",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it.each(["player", "shared Tournament"])(
    "rechecks the %s rule inside the review transaction",
    async (conflict) => {
      const { service: lifecycle, store } = service();
      const requested = await requestedClaim(lifecycle);
      await lifecycle.administratorAction(administrator, {
        playerClaimId: requested.playerClaimId,
        action: "start_review",
      });
      store.forcePlayerVerifiedConflict = conflict === "player";
      store.sharedTournament = conflict === "player" ? null : "TN12";
      await expect(
        lifecycle.administratorAction(administrator, {
          playerClaimId: requested.playerClaimId,
          action: "verify",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(store.claims.get(requested.playerClaimId)?.claimStatus).toBe(
        "under_review",
      );
    },
  );

  it("release retains the old claim and permits an explicit later claim", async () => {
    const { service: lifecycle, store } = service();
    const verified = await verifiedClaim(lifecycle);
    const released = await lifecycle.administratorAction(administrator, {
      playerClaimId: verified.playerClaimId,
      action: "release",
      reasonCode: "administrator_assisted_release",
    });
    expect(released).toMatchObject({ claimStatus: "released", revision: 4, reviewerRole: "administrator" });
    const { reviewerRole: _role, ...releasedClaim } = released;
    expect(store.claims.get(verified.playerClaimId)).toEqual(releasedClaim);
    expect(store.appends.map((item) => item.event.sequence)).toEqual([2, 3, 4]);

    const replacement = await lifecycle.requestClaim(secondOwner, {
      playerId,
      evidenceIds: [],
    });
    expect(replacement.playerClaimId).not.toBe(verified.playerClaimId);
    expect(replacement.userAccountId).toBe(secondAccountId);
    expect(store.claims).toHaveLength(2);
  });

  it("rejects malformed reason codes before opening a transaction", async () => {
    const { service: lifecycle, store } = service();
    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: "player_claim.synthetic_claim_01",
        action: "release",
        reasonCode: "raw private review text is not a code",
      }),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(store.transactionCount).toBe(0);
  });
});

describe("claim disputes", () => {
  it("allows the owner to open and an administrator to resolve a dispute", async () => {
    const { service: lifecycle, store } = service();
    const verified = await verifiedClaim(lifecycle);
    const disputed = await lifecycle.openDispute(owner, {
      playerClaimId: verified.playerClaimId,
      evidenceIds: [evidenceId],
      reasonCode: "ownership_disputed",
    });
    expect(disputed).toMatchObject({
      claimStatus: "verified",
      disputeStatus: "open",
      revision: 4,
    });

    const resolved = await lifecycle.administratorAction(administrator, {
      playerClaimId: verified.playerClaimId,
      action: "resolve_dispute",
      reasonCode: "administrator_resolution",
    });
    expect(resolved).toMatchObject({
      claimStatus: "verified",
      disputeStatus: "resolved",
      revision: 5,
    });
    expect(store.appends.slice(-2).map((item) => item.event.eventType)).toEqual([
      "dispute_opened",
      "dispute_resolved",
    ]);
  });

  it("forbids another account from opening the dispute", async () => {
    const { service: lifecycle } = service();
    const verified = await verifiedClaim(lifecycle);
    await expect(
      lifecycle.openDispute(secondOwner, {
        playerClaimId: verified.playerClaimId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not resolve a dispute that is not open", async () => {
    const { service: lifecycle } = service();
    const verified = await verifiedClaim(lifecycle);
    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: verified.playerClaimId,
        action: "resolve_dispute",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("requires explicit dispute resolution before release or revocation", async () => {
    const { service: lifecycle } = service();
    const verified = await verifiedClaim(lifecycle);
    await lifecycle.openDispute(owner, {
      playerClaimId: verified.playerClaimId,
    });
    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: verified.playerClaimId,
        action: "release",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

it("uses typed lifecycle errors without embedding evidence values", () => {
  const error = new ClaimLifecycleError("conflict", "verified claim slot occupied");
  expect(error).toMatchObject({
    name: "ClaimLifecycleError",
    code: "conflict",
    message: "verified claim slot occupied",
  });
  expect(JSON.stringify(error)).not.toContain(evidenceId);
});

describe("Director review and the claim conversation (ADR-0216)", () => {
  it("lets the Director of the Player's nights approve, recorded as a Director", async () => {
    const { service: lifecycle, store } = service();
    store.directorships.add(`${directorAccountId}|${playerId}`);
    const requested = await lifecycle.requestClaim(owner, {
      playerId,
      evidenceIds: [],
      note: "  I played TN12 as Mal from Utrecht  ",
    });
    await lifecycle.administratorAction(director, {
      playerClaimId: requested.playerClaimId,
      action: "start_review",
    });
    const verified = await lifecycle.administratorAction(director, {
      playerClaimId: requested.playerClaimId,
      action: "verify",
      note: "Welcome back",
    });
    expect(verified).toMatchObject({ claimStatus: "verified", reviewerRole: "director" });
    expect(store.appends.map((item) => [item.event.actorType, item.event.reasonCode])).toEqual([
      ["director", undefined],
      ["director", "identity_confirmed"],
    ]);
    expect(store.notes.map((item) => [item.authorRole, item.noteKind, item.body])).toEqual([
      ["requester", "request", "I played TN12 as Mal from Utrecht"],
      ["reviewer", "decision", "Welcome back"],
    ]);
  });

  it("refuses a Director of other nights, a Director deciding their own claim, and Director evidence", async () => {
    const { service: lifecycle, store } = service();
    const requested = await requestedClaim(lifecycle);
    await expect(
      lifecycle.administratorAction(director, { playerClaimId: requested.playerClaimId, action: "start_review" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    store.directorships.add(`${directorAccountId}|${playerId}`);
    await expect(
      lifecycle.administratorAction(director, {
        playerClaimId: requested.playerClaimId,
        action: "start_review",
        evidenceIds: [evidenceId],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const own = await lifecycle.requestClaim(director, { playerId: secondPlayerId, evidenceIds: [] });
    store.directorships.add(`${directorAccountId}|${secondPlayerId}`);
    await expect(
      lifecycle.administratorAction(director, { playerClaimId: own.playerClaimId, action: "start_review" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("asks for more information: moves a request under review once, then only adds the question", async () => {
    const { service: lifecycle, store } = service();
    const requested = await requestedClaim(lifecycle);
    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: requested.playerClaimId,
        action: "request_information",
      }),
    ).rejects.toMatchObject({ code: "invalid_command" });

    const asked = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "request_information",
      note: "Which nights did you play?",
    });
    const askedAgain = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "request_information",
      note: "And with which character?",
    });
    expect(asked).toMatchObject({ claimStatus: "under_review", revision: 2 });
    expect(askedAgain).toMatchObject({ claimStatus: "under_review", revision: 2 });
    expect(store.appends.map((item) => item.event.eventType)).toEqual(["review_started"]);

    await lifecycle.replyToClaim(owner, { playerClaimId: requested.playerClaimId, note: "TN10 to TN12, Yoshi" });
    expect(store.notes.map((item) => [item.authorRole, item.noteKind])).toEqual([
      ["reviewer", "question"],
      ["reviewer", "question"],
      ["requester", "reply"],
    ]);
    await expect(
      lifecycle.replyToClaim(secondOwner, { playerClaimId: requested.playerClaimId, note: "me too" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("limits notes to 500 characters and strips control characters", async () => {
    const { service: lifecycle, store } = service();
    const requested = await requestedClaim(lifecycle);
    await expect(
      lifecycle.replyToClaim(owner, { playerClaimId: requested.playerClaimId, note: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "invalid_command" });
    await lifecycle.replyToClaim(owner, {
      playerClaimId: requested.playerClaimId,
      note: "line one\r\nline\u0007 two",
    });
    expect(store.notes.at(-1)?.body).toBe("line one\nline two");
  });

  it("lets an account unlink itself, keeping the claim's history", async () => {
    const { service: lifecycle, store } = service();
    const verified = await verifiedClaim(lifecycle);
    await expect(
      lifecycle.releaseOwnClaim(secondOwner, { playerClaimId: verified.playerClaimId }),
    ).rejects.toMatchObject({ code: "not_found" });
    const released = await lifecycle.releaseOwnClaim(owner, {
      playerClaimId: verified.playerClaimId,
      note: "This is my brother",
    });
    expect(released).toMatchObject({ claimStatus: "released", revision: 4 });
    expect(store.appends.at(-1)?.event).toMatchObject({
      eventType: "claim_released",
      actorType: "requesting_account",
      reasonCode: "account_released",
    });
    await expect(
      lifecycle.releaseOwnClaim(owner, { playerClaimId: verified.playerClaimId }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("revokes with one of the offered reasons, by an administrator or the Player's Director", async () => {
    const { service: lifecycle, store } = service();
    const verified = await verifiedClaim(lifecycle);
    await expect(
      lifecycle.administratorAction(administrator, {
        playerClaimId: verified.playerClaimId,
        action: "revoke",
        reasonCode: "some_other_reason",
      }),
    ).rejects.toMatchObject({ code: "invalid_command" });
    store.directorships.add(`${directorAccountId}|${playerId}`);
    const revoked = await lifecycle.administratorAction(director, {
      playerClaimId: verified.playerClaimId,
      action: "revoke",
      reasonCode: "person_asked",
      note: "Mal asked us to undo this",
    });
    expect(revoked).toMatchObject({ claimStatus: "revoked", reviewerRole: "director" });
    expect(store.appends.at(-1)?.event).toMatchObject({ actorType: "director", reasonCode: "person_asked" });
  });
});
