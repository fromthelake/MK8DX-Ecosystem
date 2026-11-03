// Country self-service: public profile metadata, never identity
// evidence. The Player picks from the canonical schema-9 catalog (or no
// country at all) and may change or clear it at any time.

import {
  COUNTRY_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  countryFlagPath,
} from "./asset-manifest.js";
import { dutchPresentation } from "./dutch-ui-copy.js";

export type MountedCountrySettings = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export interface CountryClient {
  setCountry(countryId: string | null, signal?: AbortSignal): Promise<void>;
}

export class CountryClientError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "no_verified_player"
      | "unavailable",
  ) {
    super("The country could not be saved.");
    this.name = "CountryClientError";
  }
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

export function createCountryClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): CountryClient {
  return {
    async setCountry(countryId, signal) {
      let proofResponse: Response;
      try {
        proofResponse = await fetchPort("/v1/session/csrf", {
          ...baseInit,
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new CountryClientError("unavailable");
      }
      if (proofResponse.status === 401) {
        throw new CountryClientError("not_authenticated");
      }
      if (proofResponse.status !== 200) {
        throw new CountryClientError("unavailable");
      }
      const proof = await proofResponse.json() as Record<string, unknown>;
      if (proof["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
          typeof proof["headerName"] !== "string" ||
          typeof proof["value"] !== "string") {
        throw new CountryClientError("unavailable");
      }
      let response: Response;
      try {
        response = await fetchPort("/v1/account/player-country", {
          ...baseInit,
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [proof["headerName"]]: proof["value"],
          },
          body: JSON.stringify({ countryId }),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new CountryClientError("unavailable");
      }
      if (response.status === 401) {
        throw new CountryClientError("not_authenticated");
      }
      if (response.status === 409) {
        throw new CountryClientError("no_verified_player");
      }
      if (response.status !== 200) {
        throw new CountryClientError("unavailable");
      }
    },
  };
}

export function mountCountrySettings(
  root: HTMLElement,
  client: CountryClient = createCountryClient(),
  currentCountryId: string | null = null,
): MountedCountrySettings {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;

  const container = document.createElement("section");
  container.className = "country-settings";
  container.setAttribute("aria-label", "Country");
  const heading = document.createElement("h3");
  heading.textContent = "Country";
  const explanation = document.createElement("p");
  explanation.className = "country-settings__note";
  explanation.textContent =
    "Shown publicly next to your name on leaderboards and your profile. " +
    "Optional — pick “No country” to keep it hidden.";
  const row = document.createElement("div");
  row.className = "country-settings__row";
  const flag = document.createElement("img");
  flag.className = "country-settings__flag";
  flag.alt = "";
  flag.hidden = true;
  const select = document.createElement("select");
  select.className = "country-settings__select";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No country";
  select.append(none);
  for (const country of COUNTRY_ASSET_MANIFEST) {
    const option = document.createElement("option");
    option.value = country.id;
    option.textContent = dutchPresentation(country.name);
    select.append(option);
  }
  select.value = currentCountryId ?? "";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "tt-auth__button";
  save.textContent = "Save";
  const status = document.createElement("p");
  status.className = "country-settings__status";
  status.setAttribute("role", "status");
  row.append(flag, select, save);
  container.append(heading, explanation, row, status);
  root.append(container);

  const updateFlag = (): void => {
    const path = countryFlagPath(select.value === "" ? null : select.value);
    if (path === undefined) {
      flag.hidden = true;
    } else {
      flag.src = `${GAME_ASSET_BASE}${path}`;
      flag.hidden = false;
    }
  };
  updateFlag();
  select.addEventListener("change", updateFlag);

  save.addEventListener("click", () => {
    save.disabled = true;
    status.textContent = "Saving…";
    client.setCountry(
      select.value === "" ? null : select.value,
      controller.signal,
    ).then(
      () => {
        if (!disposed) { status.textContent = "Saved."; }
      },
      (error: unknown) => {
        if (disposed) { return; }
        status.textContent =
          error instanceof CountryClientError &&
          error.code === "no_verified_player"
            ? "Claim your Player first, then set a country."
            : "The country could not be saved. Retry later.";
      },
    ).then(() => { save.disabled = false; });
  });

  return {
    container,
    ready: Promise.resolve(),
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
