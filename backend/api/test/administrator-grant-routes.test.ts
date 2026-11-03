import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerAdministratorGrantRoutes } from
  "../src/administration/administrator-grant-routes.js";
import { AdministratorGrantServiceError } from
  "../src/administration/administrator-grant-service.js";
import type { ActorContext } from "../src/identity/types.js";

const administrator: ActorContext = {
  role: "administrator",
  userAccountId: "user_account.synthetic_owner",
};
const snapshot = {
  administratorGrantId: "administrator_grant.synthetic_operator",
  userAccountId: "user_account.synthetic_operator",
  status: "active" as const,
  origin: "administrator" as const,
  revision: 1,
  lastSequence: 1,
  grantedAtMs: 1_900_000_000_000,
};

describe("administrator grant routes", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  function app(
    actor: ActorContext = administrator,
    csrfValid = true,
  ) {
    const instance = Fastify();
    apps.push(instance);
    const calls: unknown[][] = [];
    void registerAdministratorGrantRoutes(instance, {
      resolveActor: async () => actor,
      csrfVerifier: { verify: (_actor, token) => csrfValid && token === "valid-csrf" },
      service: {
        async grantAdministrator(...arguments_) {
          if (arguments_[0].role !== "administrator") {
            throw new AdministratorGrantServiceError("forbidden", "synthetic forbidden");
          }
          calls.push(arguments_);
          return snapshot;
        },
        async revokeAdministrator(...arguments_) {
          if (arguments_[0].role !== "administrator") {
            throw new AdministratorGrantServiceError("forbidden", "synthetic forbidden");
          }
          calls.push(arguments_);
          return {
            ...snapshot,
            status: "revoked",
            revision: 2,
            lastSequence: 2,
            revokedAtMs: 1_900_000_000_100,
          };
        },
      },
    });
    return { instance, calls };
  }

  it("grants through authenticated CSRF-protected administrator composition", async () => {
    const { instance, calls } = app();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/administrator-grants",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        userAccountId: "user_account.synthetic_operator",
        reasonCode: "owner_approved_operator",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(snapshot);
    expect(calls).toEqual([[
      administrator,
      "user_account.synthetic_operator",
      "owner_approved_operator",
    ]]);
  });

  it("revokes through the explicit account-target action", async () => {
    const { instance, calls } = app();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/administrator-grants/user_account.synthetic_operator/actions/revoke",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { reasonCode: "operator_access_ended" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "revoked", revision: 2 });
    expect(calls[0]).toEqual([
      administrator,
      "user_account.synthetic_operator",
      "operator_access_ended",
    ]);
  });

  it.each([
    { actor: administrator, token: undefined },
    { actor: administrator, token: "invalid" },
    { actor: { role: "account", userAccountId: "user_account.synthetic_owner" } as const,
      token: "valid-csrf" },
  ])("rejects missing authority or CSRF without mutation", async ({ actor, token }) => {
    const { instance, calls } = app(actor, token !== "invalid");
    const response = await instance.inject({
      method: "POST",
      url: "/v1/administrator-grants",
      ...(token === undefined ? {} : { headers: { "x-mk8dx-csrf": token } }),
      payload: {
        userAccountId: "user_account.synthetic_operator",
        reasonCode: "owner_approved_operator",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed account identifiers and reason codes at the schema boundary", async () => {
    const { instance, calls } = app();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/administrator-grants",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { userAccountId: "owner@example.test", reasonCode: "free text" },
    });
    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
