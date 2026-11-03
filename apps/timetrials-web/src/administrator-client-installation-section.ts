// Who runs which build, and who has never opened the app at all.
//
// The download page says what is on offer and `client-support` says what is
// allowed; neither knew what is installed. A client says so itself now, once a
// pass, and this reads the list back: per device, with the versions it has run
// under it, so an update reads as a new line beside the old one.
//
// It is deliberately plain. This is an operator's list, not a dashboard: who,
// what, which build, when it was last seen.

import { localized } from "./product-language.js";

export type ClientInstallation = Readonly<{
  userAccountId: string;
  playerId?: string;
  displayName?: string;
  installationId: string;
  client: "android" | "web" | "livetrial";
  version: string;
  build?: number;
  deviceModel?: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  checkinCount: number;
}>;

export class ClientInstallationClientError extends Error {
  public constructor(public readonly code: string) {
    super(`client installation client error: ${code}`);
    this.name = "ClientInstallationClientError";
  }
}

export type ClientInstallationReader = Readonly<{
  list(signal?: AbortSignal): Promise<readonly ClientInstallation[]>;
}>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientInstallationClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) {
    throw new ClientInstallationClientError("invalid_response");
  }
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ClientInstallationClientError("invalid_response");
  }
  return value;
}

export function parseClientInstallations(value: unknown): readonly ClientInstallation[] {
  const row = object(value);
  if (row["schemaVersion"] !== "mk8dx.client-installations.v1" ||
    !Array.isArray(row["installations"])) {
    throw new ClientInstallationClientError("invalid_response");
  }
  return row["installations"].map((entry) => {
    const installation = object(entry);
    const client = installation["client"];
    if (client !== "android" && client !== "web" && client !== "livetrial") {
      throw new ClientInstallationClientError("invalid_response");
    }
    const playerId = installation["playerId"];
    const displayName = installation["displayName"];
    const build = installation["build"];
    const deviceModel = installation["deviceModel"];
    return {
      userAccountId: text(installation["userAccountId"], 200),
      ...(typeof playerId === "string" ? { playerId } : {}),
      ...(typeof displayName === "string" ? { displayName } : {}),
      installationId: text(installation["installationId"], 64),
      client,
      version: text(installation["version"], 64),
      ...(typeof build === "number" ? { build: count(build) } : {}),
      ...(typeof deviceModel === "string" ? { deviceModel } : {}),
      firstSeenAtMs: count(installation["firstSeenAtMs"]),
      lastSeenAtMs: count(installation["lastSeenAtMs"]),
      checkinCount: count(installation["checkinCount"]),
    };
  });
}

export function createClientInstallationReader(
  fetchPort: typeof fetch = fetch,
): ClientInstallationReader {
  return {
    list: async (signal) => {
      const response = await fetchPort("/v1/administration/client-installations", {
        credentials: "same-origin",
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        throw new ClientInstallationClientError(
          response.status === 401 ? "not_authenticated" : "unavailable",
        );
      }
      return parseClientInstallations(await response.json());
    },
  };
}

/** "just now", "2 hours ago", "13 September" - short, and never a guess. */
export function installationAge(lastSeenAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - lastSeenAtMs) / 60_000));
  if (minutes < 2) { return localized("just now", "zojuist"); }
  if (minutes < 90) { return localized(`${minutes} min ago`, `${minutes} min geleden`); }
  const hours = Math.round(minutes / 60);
  if (hours < 36) { return localized(`${hours} h ago`, `${hours} u geleden`); }
  const days = Math.round(hours / 24);
  return localized(`${days} days ago`, `${days} dagen geleden`);
}

export type MountedClientInstallationSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export function mountAdministratorClientInstallationSection(
  root: HTMLElement,
  options: Readonly<{
    reader?: ClientInstallationReader;
    now?: () => number;
  }> = {},
): MountedClientInstallationSection {
  const document = root.ownerDocument;
  const reader = options.reader ?? createClientInstallationReader();
  const now = options.now ?? (() => Date.now());
  const controller = new AbortController();
  let disposed = false;

  const container = document.createElement("section");
  container.className = "admin-installations ds-panel";
  const heading = document.createElement("h2");
  heading.className = "ds-panel__title";
  heading.textContent = localized("Apps in use", "Apps in gebruik");
  const note = document.createElement("p");
  note.className = "admin-installations__note ds-panel__note";
  note.textContent = localized(
    "One line per copy of an app, per version it has run. A client says so "
      + "itself when it checks in; a line nobody has touched for eighteen "
      + "months is removed.",
    "Eén regel per exemplaar van een app, per versie die het draaide. Een "
      + "client meldt het zelf; een regel die achttien maanden onaangeroerd "
      + "blijft, verdwijnt.",
  );
  const status = document.createElement("p");
  status.className = "admin-installations__status";
  status.setAttribute("role", "status");
  status.textContent = localized("Reading…", "Lezen…");
  const scroller = document.createElement("div");
  scroller.className = "admin-installations__scroller";
  container.append(heading, note, status, scroller);
  root.append(container);

  const paint = (installations: readonly ClientInstallation[]): void => {
    scroller.replaceChildren();
    if (installations.length === 0) {
      status.textContent = localized(
        "No client has checked in yet.", "Nog geen enkele client heeft zich gemeld.",
      );
      return;
    }
    // The newest build in use, so "who is behind" reads off the list itself.
    const newest = installations
      .filter((row) => row.client === "android" && row.build !== undefined)
      .reduce((top, row) => Math.max(top, row.build ?? 0), 0);
    status.textContent = localized(
      `${installations.length} installations · newest Android build in use: ${newest || "—"}`,
      `${installations.length} installaties · nieuwste Android-build in gebruik: ${newest || "—"}`,
    );
    const table = document.createElement("table");
    table.className = "admin-installations__table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of [
      localized("Player", "Speler"),
      localized("App", "App"),
      localized("Version", "Versie"),
      localized("Device", "Apparaat"),
      localized("First seen", "Eerst gezien"),
      localized("Last seen", "Laatst gezien"),
      localized("Check-ins", "Meldingen"),
    ]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const row of installations) {
      const line = document.createElement("tr");
      if (row.client === "android" && newest > 0 && (row.build ?? 0) < newest) {
        line.className = "admin-installations__row--behind";
      }
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = row.displayName ?? row.userAccountId;
      const cells = [
        row.client,
        row.build === undefined ? row.version : `${row.version} (build ${row.build})`,
        row.deviceModel ?? "—",
        new Date(row.firstSeenAtMs).toISOString().slice(0, 10),
        installationAge(row.lastSeenAtMs, now()),
        String(row.checkinCount),
      ];
      line.append(name);
      for (const value of cells) {
        const cell = document.createElement("td");
        cell.textContent = value;
        line.append(cell);
      }
      body.append(line);
    }
    table.append(head, body);
    scroller.append(table);
  };

  const ready = (async () => {
    try {
      const installations = await reader.list(controller.signal);
      if (disposed) { return; }
      paint(installations);
    } catch (error) {
      if (disposed) { return; }
      status.textContent = error instanceof ClientInstallationClientError &&
        error.code === "not_authenticated"
        ? localized(
          "Sign in as an administrator to read this.",
          "Meld je aan als beheerder om dit te lezen.",
        )
        : localized(
          "The installation list is temporarily unavailable.",
          "De installatielijst is tijdelijk niet beschikbaar.",
        );
    }
  })();

  return {
    container,
    ready,
    unmount: () => {
      disposed = true;
      controller.abort();
      container.remove();
    },
  };
}
