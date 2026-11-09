import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerNotificationRoutes } from "../src/notifications/notification-routes.js";
import { registerAccountAppearancePreferenceRoutes } from
  "../src/profiles/account-appearance-preference.js";
import { registerAccountTimeTrialPreferenceRoutes } from
  "../src/profiles/account-time-trial-preferences.js";
import { registerPlayerAvatarRoutes } from "../src/profiles/player-avatar-routes.js";
import { registerPlayerCountryRoutes } from "../src/profiles/player-country-routes.js";
import { registerPlayerProfilePreferenceRoutes } from
  "../src/profiles/player-profile-preferences.js";
import { MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";

const actor = { role: "account", userAccountId: "user_account.synthetic_owner" } as const;
const preferences = {
  countryId: null,
  favoriteCharacterId: null,
  favoriteBodyId: null,
  favoriteTireId: null,
  favoriteGliderId: null,
};

describe("shared account setting mutation budget", () => {
  it("counts six routes together, refuses excess and never charges invalid CSRF", async () => {
    const app = Fastify();
    const writes: string[] = [];
    const consumed: unknown[][] = [];
    const common = {
      resolveActor: async () => actor,
      csrfVerifier: { verify: (_actor: unknown, proof: string) => proof === "valid" },
      rateLimiter: {
        async consume(...arguments_: [string, string, number, number]) {
          consumed.push(arguments_);
          if (consumed.length > 6) throw new MutationRateLimitExceeded(17);
        },
      },
    };
    await registerNotificationRoutes(app, { ...common, service: {
      async listMine() { return { unreadCount: 0, notifications: [] }; },
      async listEvents() { return []; },
      async markRead() { writes.push("notification"); },
    } });
    await registerAccountAppearancePreferenceRoutes(app, { ...common, service: {
      async readMine() { return "dark" as const; },
      async updateMine() { writes.push("appearance"); return "dark" as const; },
    } });
    await registerAccountTimeTrialPreferenceRoutes(app, { ...common, service: {
      async readMine() { return { modePreference: "all" as const, screenName: null, trackAccess: "unknown" as const }; },
      async updateMine() {
        writes.push("time-trial");
        return { modePreference: "all" as const, screenName: null, trackAccess: "unknown" as const };
      },
    } });
    await registerPlayerAvatarRoutes(app, { ...common, service: {
      async setOwnAvatar() { writes.push("avatar"); },
    } });
    await registerPlayerCountryRoutes(app, { ...common, service: {
      async setOwnCountry() { writes.push("country"); },
    } });
    await registerPlayerProfilePreferenceRoutes(app, { ...common, service: {
      async readMine() { return preferences; },
      async updateMine() { writes.push("profile"); return preferences; },
    } });

    const requests = [
      { method: "POST" as const, url: "/v1/notifications/read", payload: { all: true } },
      { method: "PUT" as const, url: "/v1/account/appearance-preference", payload: { appearance: "dark" } },
      { method: "PUT" as const, url: "/v1/account/time-trial-preferences", payload: {
        modePreference: "all", screenName: null, trackAccess: "unknown",
      } },
      { method: "PUT" as const, url: "/v1/account/player-avatar", payload: { avatarId: null } },
      { method: "PUT" as const, url: "/v1/account/player-country", payload: { countryId: null } },
      { method: "PUT" as const, url: "/v1/account/player-profile-preferences", payload: preferences },
    ];
    try {
      const rejectedCsrf = await app.inject(requests[0]!);
      expect(rejectedCsrf.statusCode).toBe(401);
      expect(consumed).toHaveLength(0);
      for (const request of requests) {
        const response = await app.inject({ ...request, headers: { "x-mk8dx-csrf": "valid" } });
        expect(response.statusCode, request.url).toBe(200);
      }
      expect(writes).toEqual(["notification", "appearance", "time-trial", "avatar", "country", "profile"]);
      expect(consumed).toEqual(Array.from({ length: 6 }, () => [
        actor.userAccountId, "account-settings-hour", 3_600, 120,
      ]));
      for (const request of requests) {
        const denied = await app.inject({ ...request, headers: { "x-mk8dx-csrf": "valid" } });
        expect(denied.statusCode, request.url).toBe(429);
        expect(denied.headers["retry-after"]).toBe("17");
        expect(denied.json()).toMatchObject({ code: "account_settings_rate_limited" });
      }
      expect(writes).toHaveLength(6);
    } finally {
      await app.close();
    }
  });

  it("blocks a setting write when the durable counter is unavailable", async () => {
    const app = Fastify();
    let writes = 0;
    await registerAccountAppearancePreferenceRoutes(app, {
      resolveActor: async () => actor,
      csrfVerifier: { verify: () => true },
      rateLimiter: { async consume() { throw new Error("synthetic database failure"); } },
      service: {
        async readMine() { return null; },
        async updateMine() { writes += 1; return "dark"; },
      },
    });
    try {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/account/appearance-preference",
        headers: { "x-mk8dx-csrf": "valid" },
        payload: { appearance: "dark" },
      });
      expect(response.statusCode).toBe(503);
      expect(writes).toBe(0);
    } finally {
      await app.close();
    }
  });
});
