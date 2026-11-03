import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";

import {
  createAdministratorAwareActorResolver,
  createBoundAccountActorResolver,
  createProvisioningBoundAccountActorResolver,
  createRotatingProvisioningBoundAccountActorResolver,
  type AuthenticationBindingRepository,
  type RotatingAuthenticationBindingRepository,
  type VerifiedAuthenticationSubject,
} from "../src/authentication/authentication-binding-resolver.js";

const subject: VerifiedAuthenticationSubject = {
  issuerKey: "synthetic_issuer",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: new Uint8Array(32).fill(7),
};

class SyntheticBindingRepository implements AuthenticationBindingRepository {
  readonly lookups: VerifiedAuthenticationSubject[] = [];
  accountId: string | null = "user_account.synthetic_bound_01";

  async resolveActiveAccount(
    candidate: VerifiedAuthenticationSubject,
  ): Promise<{ userAccountId: string } | null> {
    this.lookups.push(candidate);
    return this.accountId === null ? null : { userAccountId: this.accountId };
  }
}

class SyntheticRotatingRepository
  extends SyntheticBindingRepository
  implements RotatingAuthenticationBindingRepository {
  readonly rotations: Array<readonly [VerifiedAuthenticationSubject, VerifiedAuthenticationSubject]> = [];

  async rotateActiveSubject(
    previous: VerifiedAuthenticationSubject,
    active: VerifiedAuthenticationSubject,
  ): Promise<void> {
    this.rotations.push([previous, active]);
  }
}

const request = {} as FastifyRequest;

describe("provider-neutral authentication binding actor resolver", () => {
  it("resolves a verified bound subject to a UserAccount actor only", async () => {
    const repository = new SyntheticBindingRepository();
    const resolveActor = createBoundAccountActorResolver(
      async () => subject,
      repository,
    );

    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_bound_01",
    });
    expect(repository.lookups).toEqual([subject]);
    expect(JSON.stringify(await resolveActor(request))).not.toMatch(
      /player|administrator/i,
    );
  });

  it("returns anonymous when no provider subject was verified", async () => {
    const repository = new SyntheticBindingRepository();
    const resolveActor = createBoundAccountActorResolver(
      async () => null,
      repository,
    );

    await expect(resolveActor(request)).resolves.toEqual({ role: "anonymous" });
    expect(repository.lookups).toHaveLength(0);
  });

  it("returns anonymous for an unbound or inactive subject", async () => {
    const repository = new SyntheticBindingRepository();
    repository.accountId = null;
    const resolveActor = createBoundAccountActorResolver(
      async () => subject,
      repository,
    );

    await expect(resolveActor(request)).resolves.toEqual({ role: "anonymous" });
  });

  it("provisions one separate UserAccount binding for a verified new subject", async () => {
    const repository = new SyntheticBindingRepository();
    repository.accountId = null;
    const provisions: VerifiedAuthenticationSubject[] = [];
    const resolveActor = createProvisioningBoundAccountActorResolver(
      async () => subject,
      repository,
      {
        async provision(candidate) {
          provisions.push(candidate);
          return { userAccountId: "user_account.synthetic_new_01" };
        },
      },
    );

    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_new_01",
    });
    expect(provisions).toEqual([subject]);
  });

  it("resolves the winner's binding when a concurrent first call loses provisioning", async () => {
    // A new account's first page fires several product calls at once; only
    // one insert can win. The losers must answer with the committed binding,
    // not with a 503 on the welcome screen.
    const repository = new SyntheticBindingRepository();
    repository.accountId = null;
    const resolveActor = createProvisioningBoundAccountActorResolver(
      async () => subject,
      repository,
      {
        async provision() {
          // The concurrent winner committed between our lookup and insert.
          repository.accountId = "user_account.synthetic_concurrent_winner";
          throw new Error("duplicate authentication binding");
        },
      },
    );

    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_concurrent_winner",
    });
  });

  it("still fails when provisioning loses without a committed winner", async () => {
    const repository = new SyntheticBindingRepository();
    repository.accountId = null;
    const resolveActor = createProvisioningBoundAccountActorResolver(
      async () => subject,
      repository,
      {
        async provision() {
          throw new Error("synthetic provisioning outage");
        },
      },
    );

    await expect(resolveActor(request)).rejects.toThrow(
      "synthetic provisioning outage",
    );
  });

  it("does not provision an existing binding or an anonymous request", async () => {
    const repository = new SyntheticBindingRepository();
    const provision = async () => {
      throw new Error("provisioning must not run");
    };
    const existing = createProvisioningBoundAccountActorResolver(
      async () => subject,
      repository,
      { provision },
    );
    const anonymous = createProvisioningBoundAccountActorResolver(
      async () => null,
      repository,
      { provision },
    );

    await expect(existing(request)).resolves.toMatchObject({ role: "account" });
    await expect(anonymous(request)).resolves.toEqual({ role: "anonymous" });
  });

  it("re-keys a retained lookup binding after verified subject resolution", async () => {
    const active = { ...subject, lookupKeyVersion: "lookup_key_v2", subjectLookupHmac: new Uint8Array(32).fill(8) };
    const retained = subject;
    const repository = new SyntheticRotatingRepository();
    repository.accountId = null;
    repository.resolveActiveAccount = async (candidate) => {
      repository.lookups.push(candidate);
      return candidate.lookupKeyVersion === retained.lookupKeyVersion
        ? { userAccountId: "user_account.synthetic_bound_01" } : null;
    };
    const resolveActor = createRotatingProvisioningBoundAccountActorResolver(
      async () => [active, retained],
      repository,
      { async provision() { throw new Error("existing binding must not provision"); } },
    );

    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_bound_01",
    });
    expect(repository.lookups).toEqual([active, retained]);
    expect(repository.rotations).toEqual([[retained, active]]);
  });
});

describe("database-backed administrator actor resolution", () => {
  it("resolves and revokes administrator authority from fresh grant state", async () => {
    let active = true;
    const lookups: string[] = [];
    const resolveActor = createAdministratorAwareActorResolver(
      async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_bound_01",
      }),
      {
        async isActiveAdministrator(userAccountId) {
          lookups.push(userAccountId);
          return active;
        },
      },
    );

    await expect(resolveActor(request)).resolves.toEqual({
      role: "administrator",
      userAccountId: "user_account.synthetic_bound_01",
    });
    active = false;
    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_bound_01",
    });
    expect(lookups).toHaveLength(2);
  });

  it("fails closed to account authority when grant lookup is unavailable", async () => {
    const resolveActor = createAdministratorAwareActorResolver(
      async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_bound_01",
      }),
      {
        async isActiveAdministrator() {
          throw new Error("synthetic database failure");
        },
      },
    );
    await expect(resolveActor(request)).resolves.toEqual({
      role: "account",
      userAccountId: "user_account.synthetic_bound_01",
    });
  });

  it("does not query grants for anonymous or migration actors", async () => {
    for (const actor of [
      { role: "anonymous" as const },
      { role: "migration_operator" as const },
    ]) {
      const resolveActor = createAdministratorAwareActorResolver(
        async () => actor,
        {
          async isActiveAdministrator() {
            throw new Error("grant lookup must not run");
          },
        },
      );
      await expect(resolveActor(request)).resolves.toEqual(actor);
    }
  });
});
