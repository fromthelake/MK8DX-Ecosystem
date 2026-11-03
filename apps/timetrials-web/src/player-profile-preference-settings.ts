import { COUNTRY_ASSET_MANIFEST, GAME_ASSET_BASE, countryFlagPath } from "./asset-manifest.js";
import { AVATAR_GROUPS } from "./avatar-manifest.js";
import { pickerCharacterName } from "./character-picker-names.js";
import { BODY_PARTS, GLIDER_PARTS, TIRE_PARTS, type LoadoutPart } from "./loadout-manifest.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { localized } from "./product-language.js";

export type PlayerProfilePreferences = Readonly<{
  countryId: string | null;
  favoriteCharacterId: string | null;
  favoriteBodyId: string | null;
  favoriteTireId: string | null;
  favoriteGliderId: string | null;
}>;

export interface PlayerProfilePreferenceClient {
  read(signal?: AbortSignal): Promise<PlayerProfilePreferences>;
  save(value: PlayerProfilePreferences, signal?: AbortSignal): Promise<PlayerProfilePreferences>;
}

export function profilePreferenceFieldUpdate(
  persisted: PlayerProfilePreferences,
  field: keyof PlayerProfilePreferences,
  value: string | null,
): PlayerProfilePreferences {
  return { ...persisted, [field]: value };
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
const base = { credentials: "same-origin", mode: "same-origin", redirect: "error", referrerPolicy: "same-origin", cache: "no-store" } as const;
const fields = ["countryId", "favoriteCharacterId", "favoriteBodyId", "favoriteTireId", "favoriteGliderId"] as const;

async function parse(response: Response): Promise<PlayerProfilePreferences> {
  const body = await response.json() as Record<string, unknown>;
  if (response.status !== 200 || body["schemaVersion"] !== "mk8dx.player-profile-preferences.v1" ||
      fields.some((field) => body[field] !== null && typeof body[field] !== "string")) {
    throw new Error("profile preferences unavailable");
  }
  return Object.fromEntries(fields.map((field) => [field, body[field]])) as PlayerProfilePreferences;
}

export function createPlayerProfilePreferenceClient(fetchPort: FetchPort = globalThis.fetch.bind(globalThis)): PlayerProfilePreferenceClient {
  return {
    read: async (signal) => parse(await fetchPort("/v1/account/player-profile-preferences", {
      ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }),
    })),
    async save(value, signal) {
      const csrf = await fetchPort("/v1/session/csrf", { ...base, method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
      if (csrf.status !== 200) throw new Error("profile preferences unavailable");
      const proof = await csrf.json() as Record<string, unknown>;
      if (typeof proof["headerName"] !== "string" || typeof proof["value"] !== "string") throw new Error("profile preferences unavailable");
      return parse(await fetchPort("/v1/account/player-profile-preferences", {
        ...base, method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", [proof["headerName"]]: proof["value"] },
        body: JSON.stringify(value), ...(signal === undefined ? {} : { signal }),
      }));
    },
  };
}

const characters: readonly LoadoutPart[] = AVATAR_GROUPS.flatMap((group) => {
  const basePart = { id: group.id, name: pickerCharacterName(group.id, group.name), iconPath: group.iconPath, stats: {} };
  return [basePart, ...group.variants.map((variant) => ({ ...basePart, ...variant }))];
});

export function mountPlayerProfilePreferenceSettings(
  root: HTMLElement,
  client: PlayerProfilePreferenceClient = createPlayerProfilePreferenceClient(),
): Readonly<{ ready: Promise<void>; unmount(): void }> {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let persisted: PlayerProfilePreferences | null = null;
  let countryId: string | null = null;
  const section = document.createElement("section"); section.className = "ds-panel country-settings profile-preferences";
  const title = document.createElement("h3"); title.className = "ds-title"; title.textContent = "Public Player preferences";
  const note = document.createElement("p"); note.className = "ds-panel__note country-settings__note";
  note.textContent = "All fields below are optional and save independently. They are shown on your public Player profile.";

  const countryLabel = document.createElement("label"); countryLabel.textContent = "Country (optional)";
  const countryRow = document.createElement("div"); countryRow.className = "profile-preferences__row";
  const flag = document.createElement("img"); flag.className = "country-settings__flag"; flag.alt = ""; flag.hidden = true;
  const countrySearch = document.createElement("select"); countrySearch.className = "ds-select country-settings__select";
  const noCountry = document.createElement("option"); noCountry.value = "";
  noCountry.textContent = localized("Prefer not to say", "Liever niet zeggen");
  countrySearch.append(noCountry);
  for (const country of COUNTRY_ASSET_MANIFEST) {
    const option = document.createElement("option"); option.value = country.id;
    option.textContent = localized(country.name, dutchPresentation(country.name));
    countrySearch.append(option);
  }
  const countrySave = document.createElement("button"); countrySave.type = "button"; countrySave.className = "ds-button"; countrySave.setAttribute("data-variant", "secondary"); countrySave.textContent = "Save country"; countrySave.disabled = true;
  const countryStatus = document.createElement("p"); countryStatus.className = "ds-body-s country-settings__status"; countryStatus.setAttribute("role", "status");
  countryRow.append(flag, countrySearch, countrySave); countryLabel.append(countryRow, countryStatus);

  const selected = new Map<string, string | null>();
  const selectors = new Map<string, HTMLSelectElement>();
  const partRows: HTMLElement[] = [];
  const partButtons = new Map<string, HTMLButtonElement>();
  const partStatuses = new Map<string, HTMLElement>();
  const addPart = (key: string, label: string, parts: readonly LoadoutPart[]): void => {
    const wrapper = document.createElement("label"); wrapper.textContent = `${label} (optional)`; wrapper.className = "ds-field profile-preferences__part";
    const row = document.createElement("div"); row.className = "profile-preferences__row";
    const image = document.createElement("img"); image.className = "profile-preferences__icon"; image.alt = ""; image.hidden = true;
    const select = document.createElement("select"); select.className = "ds-select country-settings__select";
    const none = document.createElement("option"); none.value = ""; none.textContent = `No favorite ${label.toLowerCase()}`; select.append(none);
    for (const part of parts) { const option = document.createElement("option"); option.value = part.id; option.textContent = localized(part.name, dutchPresentation(part.name)); select.append(option); }
    const update = (): void => {
      const value = select.value || null; selected.set(key, value);
      const part = parts.find((candidate) => candidate.id === value);
      image.hidden = part === undefined;
      if (part !== undefined) image.src = `${GAME_ASSET_BASE}${part.iconPath}`;
    };
    const save = document.createElement("button"); save.type = "button"; save.className = "ds-button"; save.setAttribute("data-variant", "secondary"); save.textContent = `Save ${label.toLowerCase()}`; save.disabled = true;
    const status = document.createElement("p"); status.className = "ds-body-s country-settings__status"; status.setAttribute("role", "status");
    select.addEventListener("change", update); row.append(image, select, save); wrapper.append(row, status); partRows.push(wrapper); selectors.set(key, select); partButtons.set(key, save); partStatuses.set(key, status);
  };
  addPart("favoriteCharacterId", "Character", characters);
  addPart("favoriteBodyId", "Body", BODY_PARTS);
  addPart("favoriteTireId", "Tires", TIRE_PARTS);
  addPart("favoriteGliderId", "Glider", GLIDER_PARTS);

  // A dropdown can only hold valid values, so there is nothing left to
  // validate and nothing to reject.
  const updateCountry = (): boolean => {
    countryId = countrySearch.value.length === 0 ? null : countrySearch.value;
    const path = countryFlagPath(countryId);
    flag.hidden = path === undefined;
    if (path !== undefined) flag.src = `${GAME_ASSET_BASE}${path}`;
    return true;
  };
  countrySearch.addEventListener("change", () => {
    updateCountry();
    countryStatus.textContent = "";
  });
  section.append(title, note, countryLabel, ...partRows); root.append(section);

  const apply = (value: PlayerProfilePreferences): void => {
    countryId = value.countryId;
    const country = COUNTRY_ASSET_MANIFEST.find((candidate) => candidate.id === countryId);
    countrySearch.value = country === undefined ? "" : country.id; updateCountry();
    for (const field of fields.slice(1)) { const select = selectors.get(field); if (select !== undefined) { select.value = value[field] ?? ""; select.dispatchEvent(new Event("change")); } }
  };
  const saveField = (
    field: keyof PlayerProfilePreferences,
    value: string | null,
    button: HTMLButtonElement,
    status: HTMLElement,
    label: string,
  ): void => {
    if (persisted === null) {
      status.textContent = `Wait until the saved ${label} has loaded.`;
      return;
    }
    button.disabled = true;
    status.textContent = "Saving…";
    void client.save(
      profilePreferenceFieldUpdate(persisted, field, value),
      controller.signal,
    ).then((saved) => {
      if (disposed) { return; }
      persisted = saved;
      status.textContent = `${label[0]?.toUpperCase() ?? ""}${label.slice(1)} saved. Other fields were not changed.`;
    }).catch(() => {
      if (!disposed) {
        status.textContent = `${label[0]?.toUpperCase() ?? ""}${label.slice(1)} could not be saved. Your selection is preserved.`;
      }
    }).finally(() => { if (!disposed) button.disabled = false; });
  };
  countrySave.addEventListener("click", () => {
    updateCountry();
    saveField("countryId", countryId, countrySave, countryStatus, "country");
  });
  for (const [field, button] of partButtons) {
    const status = partStatuses.get(field);
    if (status === undefined) { continue; }
    const label = field === "favoriteCharacterId" ? "character" :
      field === "favoriteBodyId" ? "body" :
      field === "favoriteTireId" ? "tires" : "glider";
    button.addEventListener("click", () => saveField(
      field as keyof PlayerProfilePreferences,
      selected.get(field) ?? null,
      button,
      status,
      label,
    ));
  }
  const ready = client.read(controller.signal).then((value) => {
    if (disposed) { return; }
    persisted = value;
    apply(value);
    countrySave.disabled = false;
    for (const button of partButtons.values()) { button.disabled = false; }
  }).catch(() => {
    if (!disposed) {
      countryStatus.textContent = "Player preferences could not be loaded. Link a Player or reload before saving.";
    }
  });
  return { ready, unmount() { if (disposed) return; disposed = true; controller.abort(); if (section.parentNode === root) root.removeChild(section); } };
}
