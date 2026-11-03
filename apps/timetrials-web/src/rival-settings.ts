// Private Player-list preferences (never a social graph): RIVALS feed
// competitive comparisons and challenges, FOLLOWS raise the personal
// relevance of a Player's public activity. In both cases the chosen
// Player is not asked and not notified; the selection is not public,
// and there are no follower counts or public graphs.

import { avatarAppearance } from "./avatar-manifest.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import {
  createRatingClient,
  type RatingClient,
} from "./rating-view.js";

export type MountedRivalSettings = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

type Rival = Readonly<{
  playerId: string;
  displayName: string;
  avatarId?: string;
}>;

export interface RivalClient {
  list(signal?: AbortSignal): Promise<readonly Rival[]>;
  add(rivalPlayerId: string, signal?: AbortSignal): Promise<void>;
  remove(rivalPlayerId: string, signal?: AbortSignal): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

type ListClientConfig = Readonly<{
  path: string;
  bodyKey: string;
  schemaVersion: string;
  listKey: string;
}>;

function createListClient(
  config: ListClientConfig,
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): RivalClient {
  const csrf = async (signal?: AbortSignal): Promise<
    Readonly<{ headerName: string; value: string }>
  > => {
    const response = await fetchPort("/v1/session/csrf", {
      ...baseInit,
      method: "GET",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status !== 200) { throw new Error("csrf unavailable"); }
    const document = await response.json() as Record<string, unknown>;
    if (typeof document["headerName"] !== "string" ||
        typeof document["value"] !== "string") {
      throw new Error("csrf invalid");
    }
    return { headerName: document["headerName"], value: document["value"] };
  };
  const write = async (
    method: "PUT" | "DELETE",
    playerId: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    const proof = await csrf(signal);
    const response = await fetchPort(config.path, {
      ...baseInit,
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [proof.headerName]: proof.value,
      },
      body: JSON.stringify({ [config.bodyKey]: playerId }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status !== 200) { throw new Error("list write failed"); }
  };
  return {
    async list(signal) {
      const response = await fetchPort(config.path, {
        ...baseInit,
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 200) { throw new Error("list unavailable"); }
      const body = await response.json() as Record<string, unknown>;
      if (body["schemaVersion"] !== config.schemaVersion ||
          !Array.isArray(body[config.listKey])) {
        throw new Error("list invalid");
      }
      return body[config.listKey] as readonly Rival[];
    },
    add: (playerId, signal) => write("PUT", playerId, signal),
    remove: (playerId, signal) => write("DELETE", playerId, signal),
  };
}

export function createRivalClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): RivalClient {
  return createListClient({
    path: "/v1/account/rivals",
    bodyKey: "rivalPlayerId",
    schemaVersion: "mk8dx.player-rivals.v1",
    listKey: "rivals",
  }, fetchPort);
}

export function createFollowClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): RivalClient {
  return createListClient({
    path: "/v1/account/follows",
    bodyKey: "playerId",
    schemaVersion: "mk8dx.player-follows.v1",
    listKey: "follows",
  }, fetchPort);
}

type ListSettingsConfig = Readonly<{
  heading: string;
  note: string;
  addLabel: string;
}>;

function mountListSettings(
  root: HTMLElement,
  config: ListSettingsConfig,
  client: RivalClient,
  ratingClient: RatingClient,
): MountedRivalSettings {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let rivals: readonly Rival[] = [];

  const container = document.createElement("section");
  container.className = "ds-panel rival-settings";
  container.setAttribute("aria-label", config.heading);
  const heading = document.createElement("h3");
  heading.className = "ds-title";
  heading.textContent = config.heading;
  const note = document.createElement("p");
  note.className = "ds-panel__note rival-settings__note";
  note.textContent = config.note;
  const list = document.createElement("ul");
  list.className = "rival-settings__list";
  const addRow = document.createElement("div");
  addRow.className = "rival-settings__add";
  const select = document.createElement("select");
  select.className = "ds-select country-settings__select";
  select.setAttribute("aria-label", "Choose a Player");
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ds-button";
  addButton.setAttribute("data-variant", "secondary");
  addButton.textContent = config.addLabel;
  addRow.append(select, addButton);
  const status = document.createElement("p");
  status.className = "ds-body-s country-settings__status";
  status.setAttribute("role", "status");
  container.append(heading, note, list, addRow, status);
  root.append(container);

  const renderRivals = (): void => {
    while (list.firstChild !== null) { list.removeChild(list.firstChild); }
    if (rivals.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No rivals chosen yet.";
      list.append(empty);
      return;
    }
    for (const rival of rivals) {
      const row = document.createElement("li");
      row.className = "rival-settings__rival";
      const appearance = avatarAppearance(rival.avatarId);
      if (appearance !== undefined) {
        const avatar = document.createElement("img");
        avatar.className = "rival-settings__avatar";
        avatar.src = `${GAME_ASSET_BASE}${appearance.iconPath}`;
        avatar.alt = "";
        row.append(avatar);
      }
      const name = document.createElement("span");
      name.textContent = rival.displayName;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ds-button rival-settings__remove";
      remove.setAttribute("data-variant", "quiet");
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        remove.disabled = true;
        client.remove(rival.playerId, controller.signal).then(
          () => {
            if (disposed) { return; }
            rivals = rivals.filter(
              (candidate) => candidate.playerId !== rival.playerId,
            );
            renderRivals();
          },
          () => {
            if (!disposed) {
              status.textContent = "Could not remove the rival. Retry later.";
              remove.disabled = false;
            }
          },
        );
      });
      row.append(name, remove);
      list.append(row);
    }
  };

  addButton.addEventListener("click", () => {
    const rivalPlayerId = select.value;
    if (rivalPlayerId === "") { return; }
    addButton.disabled = true;
    status.textContent = "Adding…";
    client.add(rivalPlayerId, controller.signal).then(
      async () => {
        if (disposed) { return; }
        status.textContent = "";
        rivals = await client.list(controller.signal).catch(() => rivals);
        if (!disposed) { renderRivals(); }
      },
      () => {
        if (!disposed) {
          status.textContent = "Could not add the rival. Retry later.";
        }
      },
    ).then(() => { addButton.disabled = false; });
  });

  const ready = Promise.all([
    client.list(controller.signal).catch(() => [] as readonly Rival[]),
    ratingClient.leaderboard(controller.signal).catch(() => []),
  ]).then(([mine, ranking]) => {
    if (disposed) { return; }
    rivals = mine;
    renderRivals();
    for (const entry of ranking) {
      const option = document.createElement("option");
      option.value = entry.playerId;
      option.textContent = entry.displayName;
      select.append(option);
    }
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

export function mountRivalSettings(
  root: HTMLElement,
  client: RivalClient = createRivalClient(),
  ratingClient: RatingClient = createRatingClient(),
): MountedRivalSettings {
  return mountListSettings(root, {
    heading: "My rivals",
    note: "Rivals personalise your Home challenges and comparisons. " +
      "Your selection is private — the other Player is not notified.",
    addLabel: "Add rival",
  }, client, ratingClient);
}

export function mountFollowSettings(
  root: HTMLElement,
  client: RivalClient = createFollowClient(),
  ratingClient: RatingClient = createRatingClient(),
): MountedRivalSettings {
  return mountListSettings(root, {
    heading: "Following",
    note: "Followed Players appear more prominently in your Home " +
      "activity. Your selection is private — the other Player is not " +
      "notified, and there are no follower counts.",
    addLabel: "Follow",
  }, client, ratingClient);
}
