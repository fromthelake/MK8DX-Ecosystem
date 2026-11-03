// Administration → Identity → Aliases: look up a Player, see their aliases,
// add a reviewed alias (declared / tournament name / legacy handle /
// observation) with explicit provenance, change its visibility or retire
// it. Aliases are never merged into identities; this is the explicit,
// audited reconciliation surface the identity rules require.

import { createPlayerClaimClient, type PlayerClaimClient } from "./player-claim-client.js";
import { createPlayerAliasClient, type PlayerAliasClient } from "./player-alias-client.js";

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
export type AliasType = "declared" | "legacy_handle" | "tournament_name" | "ocr_observation" | "other_observation";
export type AliasSourceType =
  | "player_declaration" | "tournament_manager" | "tournament_workbook" | "timetrial_firebase"
  | "ocr" | "administrator";

export type AliasSnapshot = Readonly<{
  aliasId: string;
  playerId: string;
  aliasText: string;
  aliasType: AliasType;
  visibility: "public" | "restricted";
  recordStatus: "active" | "retired";
  revision: number;
}>;

export class AliasAdministrationClientError extends Error {
  public constructor(public readonly code: "not_authorized" | "invalid_input" | "conflict" | "unavailable" | "invalid_response", public readonly detail = "") {
    super(`alias administration client error: ${code}`);
    this.name = "AliasAdministrationClientError";
  }
}

export interface AliasAdministrationClient {
  create(input: Readonly<{ playerId: string; aliasText: string; aliasType: AliasType; visibility: "public" | "restricted"; sourceType: AliasSourceType; sourceReference: string }>, signal?: AbortSignal): Promise<AliasSnapshot>;
  setVisibility(aliasId: string, visibility: "public" | "restricted", signal?: AbortSignal): Promise<AliasSnapshot>;
  retire(aliasId: string, signal?: AbortSignal): Promise<AliasSnapshot>;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { throw new AliasAdministrationClientError("invalid_response"); }
  return value as Record<string, unknown>;
}

function snapshot(value: unknown): AliasSnapshot {
  const row = object(value);
  const text = (key: string): string => {
    const candidate = row[key];
    if (typeof candidate !== "string" || candidate.length < 1 || candidate.length > 200) { throw new AliasAdministrationClientError("invalid_response"); }
    return candidate;
  };
  const revision = row["revision"];
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) { throw new AliasAdministrationClientError("invalid_response"); }
  return {
    aliasId: text("aliasId"), playerId: text("playerId"), aliasText: text("aliasText"),
    aliasType: text("aliasType") as AliasType,
    visibility: row["visibility"] === "restricted" ? "restricted" : "public",
    recordStatus: row["recordStatus"] === "retired" ? "retired" : "active",
    revision,
  };
}

async function failure(response: Response): Promise<never> {
  let detail = "";
  try {
    const body = object(await response.json());
    if (typeof body["message"] === "string") { detail = body["message"].slice(0, 240); }
  } catch { /* status decides */ }
  if (response.status === 400) { throw new AliasAdministrationClientError("invalid_input", detail); }
  if (response.status === 401 || response.status === 403) { throw new AliasAdministrationClientError("not_authorized", detail); }
  if (response.status === 404 || response.status === 409) { throw new AliasAdministrationClientError("conflict", detail); }
  throw new AliasAdministrationClientError("unavailable", detail);
}

export function createAliasAdministrationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
  nowMs: () => number = () => new Date().getTime(),
): AliasAdministrationClient {
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<AliasSnapshot> => {
    const response = await fetchPort(path, {
      method: "POST", credentials: "same-origin", mode: "same-origin", redirect: "error",
      referrerPolicy: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }),
    });
    if (response.status !== 200 && response.status !== 201) { await failure(response); }
    return snapshot(await response.json());
  };
  return {
    async create(input, signal) {
      const aliasText = input.aliasText.trim();
      if (aliasText.length < 1 || aliasText.length > 64) { throw new AliasAdministrationClientError("invalid_input", "aliasText"); }
      if (input.sourceReference.trim().length < 1) { throw new AliasAdministrationClientError("invalid_input", "sourceReference"); }
      return post("/v1/aliases", {
        playerId: input.playerId, aliasText, aliasType: input.aliasType, visibility: input.visibility,
        provenance: [{ sourceType: input.sourceType, sourceReference: input.sourceReference.trim(), observedAtMs: nowMs() }],
      }, signal);
    },
    setVisibility: (aliasId, visibility, signal) =>
      post(`/v1/aliases/${encodeURIComponent(aliasId)}/actions`, { action: "set_visibility", visibility, reasonCode: "administrator_review" }, signal),
    retire: (aliasId, signal) =>
      post(`/v1/aliases/${encodeURIComponent(aliasId)}/actions`, { action: "retire", reasonCode: "administrator_review" }, signal),
  };
}

export type MountedAdministratorAliasSection = Readonly<{ container: HTMLElement; unmount(): void }>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

export function mountAdministratorAliasSection(
  root: HTMLElement,
  clients: Readonly<{ players?: PlayerClaimClient; aliases?: PlayerAliasClient; administration?: AliasAdministrationClient }> = {},
): MountedAdministratorAliasSection {
  const document = root.ownerDocument;
  const players = clients.players ?? createPlayerClaimClient();
  const aliases = clients.aliases ?? createPlayerAliasClient();
  const administration = clients.administration ?? createAliasAdministrationClient();
  const controller = new AbortController();
  let disposed = false;
  let selected: Readonly<{ playerId: string; displayName: string }> | null = null;

  const container = document.createElement("section");
  container.className = "alias-admin ds-panel";
  container.setAttribute("aria-labelledby", "alias-admin-heading");
  const heading = document.createElement("h2");
  heading.id = "alias-admin-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Aliases";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Find a Player to review their aliases (observed names, tournament names, legacy handles).";
  const search = document.createElement("form");
  search.className = "alias-admin__search";
  const query = document.createElement("input");
  query.type = "search";
  query.placeholder = "Player name…";
  query.setAttribute("aria-label", "Find a Player");
  query.maxLength = 64;
  const searchButton = document.createElement("button");
  searchButton.type = "submit";
  searchButton.className = "tt-auth__button";
  searchButton.textContent = "Search";
  search.append(query, searchButton);
  const results = document.createElement("ul");
  results.className = "alias-admin__results";
  const detail = document.createElement("div");
  detail.className = "alias-admin__detail";
  container.append(heading, status, search, results, detail);
  root.append(container);

  const say = (message: string): void => { status.textContent = message; };

  const renderDetail = async (): Promise<void> => {
    clear(detail);
    if (selected === null) { return; }
    const player = selected;
    const title = document.createElement("h3");
    title.textContent = `${player.displayName} — aliases`;
    const list = document.createElement("ul");
    list.className = "alias-admin__list";
    detail.append(title, list);
    try {
      const document_ = await aliases.listForPlayer(player.playerId, controller.signal);
      if (disposed) { return; }
      if (document_.aliases.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No public aliases.";
        list.append(empty);
      }
      for (const alias of document_.aliases) {
        const item = document.createElement("li");
        item.className = "alias-admin__item";
        const label = document.createElement("span");
        label.textContent = `${alias.aliasText} · ${alias.aliasType}`;
        const restrict = document.createElement("button");
        restrict.type = "button";
        restrict.className = "tt-auth__button";
        restrict.textContent = "Make restricted";
        restrict.addEventListener("click", () => {
          void administration.setVisibility(alias.aliasId, "restricted", controller.signal)
            .then(() => { say("Alias restricted."); return renderDetail(); })
            .catch((error: unknown) => { say(error instanceof AliasAdministrationClientError && error.detail.length > 0 ? error.detail : "The alias could not be changed."); });
        });
        const retire = document.createElement("button");
        retire.type = "button";
        retire.className = "tt-auth__button";
        retire.textContent = "Retire";
        retire.addEventListener("click", () => {
          void administration.retire(alias.aliasId, controller.signal)
            .then(() => { say("Alias retired."); return renderDetail(); })
            .catch((error: unknown) => { say(error instanceof AliasAdministrationClientError && error.detail.length > 0 ? error.detail : "The alias could not be retired."); });
        });
        item.append(label, restrict, retire);
        list.append(item);
      }
    } catch {
      if (disposed) { return; }
      const failed = document.createElement("li");
      failed.textContent = "Aliases are temporarily unavailable.";
      list.append(failed);
    }
    const form = document.createElement("form");
    form.className = "alias-admin__form";
    const aliasText = document.createElement("input");
    aliasText.placeholder = "Alias as observed (e.g. a tournament or OCR name)";
    aliasText.maxLength = 64;
    aliasText.required = true;
    const aliasType = document.createElement("select");
    for (const [value, label] of [
      ["declared", "Declared by the Player"], ["tournament_name", "Tournament name"],
      ["legacy_handle", "Legacy handle"], ["ocr_observation", "OCR observation"], ["other_observation", "Other observation"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      aliasType.append(option);
    }
    const visibility = document.createElement("select");
    for (const [value, label] of [["public", "Public"], ["restricted", "Restricted"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      visibility.append(option);
    }
    const sourceReference = document.createElement("input");
    sourceReference.placeholder = "Where you saw it (tournament, workbook, message…)";
    sourceReference.maxLength = 200;
    sourceReference.required = true;
    const add = document.createElement("button");
    add.type = "submit";
    add.className = "tt-auth__button tt-auth__button--primary";
    add.textContent = "Add reviewed alias";
    form.append(aliasText, aliasType, visibility, sourceReference, add);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void administration.create({
        playerId: player.playerId, aliasText: aliasText.value, aliasType: aliasType.value as AliasType,
        visibility: visibility.value === "restricted" ? "restricted" : "public",
        sourceType: "administrator", sourceReference: sourceReference.value,
      }, controller.signal)
        .then(() => { say("Alias added."); return renderDetail(); })
        .catch((error: unknown) => { say(error instanceof AliasAdministrationClientError && error.detail.length > 0 ? error.detail : "The alias could not be added."); });
    });
    detail.append(form);
  };

  search.addEventListener("submit", (event) => {
    event.preventDefault();
    clear(results);
    void players.search(query.value, controller.signal).then((found) => {
      if (disposed) { return; }
      if (found.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No Player matches.";
        results.append(empty);
      }
      for (const candidate of found) {
        const item = document.createElement("li");
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "tt-auth__button";
        pick.textContent = `${candidate.displayName} (@${candidate.username})`;
        pick.addEventListener("click", () => {
          selected = { playerId: candidate.playerId, displayName: candidate.displayName };
          say("");
          void renderDetail();
        });
        item.append(pick);
        results.append(item);
      }
    }).catch(() => {
      if (disposed) { return; }
      const failed = document.createElement("li");
      failed.textContent = "Search needs at least two characters.";
      results.append(failed);
    });
  });

  return {
    container,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
