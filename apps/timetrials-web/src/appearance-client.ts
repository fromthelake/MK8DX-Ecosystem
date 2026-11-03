// The account side of the appearance choice (ADR-0205). The same request shape as the other
// account preferences (ADR-0172): same-origin, no store, a CSRF proof on the write.

import type { AppearanceChoice } from "./appearance.js";

export interface AppearancePreferenceClient {
  /** null = this account never chose; every device keeps its own local choice. */
  read(signal?: AbortSignal): Promise<AppearanceChoice | null>;
  save(choice: AppearanceChoice, signal?: AbortSignal): Promise<AppearanceChoice>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
const base = {
  credentials: "same-origin", mode: "same-origin", redirect: "error",
  referrerPolicy: "same-origin", cache: "no-store",
} as const;
const ROUTE = "/v1/account/appearance-preference";

function parsed(body: Record<string, unknown>, status: number): AppearanceChoice | null {
  const appearance = body["appearance"];
  if (status !== 200 || body["schemaVersion"] !== "mk8dx.account-appearance-preference.v1" ||
      (appearance !== null && appearance !== "system" &&
        appearance !== "light" && appearance !== "dark")) {
    throw new Error("appearance unavailable");
  }
  return appearance;
}

export function createAppearancePreferenceClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): AppearancePreferenceClient {
  return {
    async read(signal) {
      const response = await fetchPort(ROUTE, {
        ...base, method: "GET", headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      return parsed(await response.json() as Record<string, unknown>, response.status);
    },
    async save(choice, signal) {
      const csrf = await fetchPort("/v1/session/csrf", {
        ...base, method: "GET", headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (csrf.status !== 200) { throw new Error("appearance unavailable"); }
      const proof = await csrf.json() as Record<string, unknown>;
      if (typeof proof["headerName"] !== "string" || typeof proof["value"] !== "string") {
        throw new Error("appearance unavailable");
      }
      const response = await fetchPort(ROUTE, {
        ...base, method: "PUT",
        headers: {
          Accept: "application/json", "Content-Type": "application/json",
          [proof["headerName"]]: proof["value"],
        },
        body: JSON.stringify({ appearance: choice }),
        ...(signal === undefined ? {} : { signal }),
      });
      const value = parsed(await response.json() as Record<string, unknown>, response.status);
      if (value === null) { throw new Error("appearance unavailable"); }
      return value;
    },
  };
}
