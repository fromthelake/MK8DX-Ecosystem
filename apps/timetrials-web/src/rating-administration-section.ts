// Administration → Rating (ADR-0155 over HTTP): which pinned tournament
// result sets count for TrueSkill, the audited include/exclude decision,
// and the deterministic recalculation that opens a new rating epoch. No
// history is edited here - decisions and recalculations only append.

import { confirmDialog } from "./ds-components.js";

export type RatingPublicationOverview = Readonly<{
  publicationId: string;
  eventName: string;
  publicationStatus: string;
  publicVisibility: string;
  publishedAtMs?: number;
  ratingIncluded: boolean;
  decidedAtMs?: number;
  appliedRaces: number;
}>;

export type RatingOverview = Readonly<{
  currentEpoch: number;
  ratedPlayers: number;
  publications: readonly RatingPublicationOverview[];
  recalculations: readonly Readonly<{
    epoch: number;
    reasonCode: string;
    includedPublications: number;
    appliedRaces: number;
    skippedRaces: number;
    occurredAtMs: number;
  }>[];
}>;

export class RatingAdministrationClientError extends Error {
  public constructor(
    public readonly code: "not_authorized" | "invalid_input" | "conflict" | "unavailable" | "invalid_response",
    public readonly detail = "",
  ) {
    super(`rating administration client error: ${code}`);
    this.name = "RatingAdministrationClientError";
  }
}

export interface RatingAdministrationClient {
  overview(signal?: AbortSignal): Promise<RatingOverview>;
  decide(input: Readonly<{ publicationId: string; ratingIncluded: boolean; reasonCode: string }>, signal?: AbortSignal): Promise<void>;
  recalculate(reasonCode: string, signal?: AbortSignal): Promise<Readonly<{ epoch: number; includedPublications: number; appliedRaces: number; skippedRaces: number; ratedPlayers: number }>>;
  applyPublication(publicationId: string, signal?: AbortSignal): Promise<Readonly<{ appliedRaces: number; alreadyApplied: boolean }>>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RatingAdministrationClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new RatingAdministrationClientError("invalid_response");
  }
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new RatingAdministrationClientError("invalid_response");
  }
  return value;
}

async function json(response: Response): Promise<unknown> {
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new RatingAdministrationClientError("invalid_response");
  }
  const body = await response.text();
  if (body.length > 262_144) { throw new RatingAdministrationClientError("invalid_response"); }
  try { return JSON.parse(body) as unknown; } catch { throw new RatingAdministrationClientError("invalid_response"); }
}

function send(fetchPort: FetchPort, path: string, init: RequestInit): Promise<Response> {
  return fetchPort(path, {
    credentials: "same-origin", mode: "same-origin", redirect: "error",
    referrerPolicy: "same-origin", cache: "no-store", ...init,
  });
}

async function failure(response: Response): Promise<never> {
  let detail = "";
  try {
    const body = object(await json(response));
    if (typeof body["message"] === "string") { detail = body["message"].slice(0, 240); }
  } catch { /* status decides */ }
  if (response.status === 400) { throw new RatingAdministrationClientError("invalid_input", detail); }
  if (response.status === 401 || response.status === 403) { throw new RatingAdministrationClientError("not_authorized", detail); }
  if (response.status === 404 || response.status === 409) { throw new RatingAdministrationClientError("conflict", detail); }
  throw new RatingAdministrationClientError("unavailable", detail);
}

async function csrf(fetchPort: FetchPort, signal?: AbortSignal): Promise<Readonly<{ name: string; value: string }>> {
  const response = await send(fetchPort, "/v1/session/csrf", {
    method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) { await failure(response); }
  const row = object(await json(response));
  if (row["schemaVersion"] !== "mk8dx.web-csrf.v1") { throw new RatingAdministrationClientError("invalid_response"); }
  return { name: text(row["headerName"], 64), value: text(row["value"], 4096) };
}

export function createRatingAdministrationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): RatingAdministrationClient {
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    const proof = await csrf(fetchPort, signal);
    const response = await send(fetchPort, path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) { await failure(response); }
    return json(response);
  };
  return {
    async overview(signal) {
      const response = await send(fetchPort, "/v1/administrator/rating/overview", {
        method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) { await failure(response); }
      const row = object(await json(response));
      if (row["schemaVersion"] !== "mk8dx.rating-administration.v1" ||
        !Array.isArray(row["publications"]) || !Array.isArray(row["recalculations"])) {
        throw new RatingAdministrationClientError("invalid_response");
      }
      return {
        currentEpoch: integer(row["currentEpoch"]),
        ratedPlayers: integer(row["ratedPlayers"]),
        publications: row["publications"].map((entry) => {
          const publication = object(entry);
          return {
            publicationId: text(publication["publicationId"], 160),
            eventName: text(publication["eventName"], 128),
            publicationStatus: text(publication["publicationStatus"], 32),
            publicVisibility: text(publication["publicVisibility"], 16),
            ...(publication["publishedAtMs"] === undefined ? {} : { publishedAtMs: integer(publication["publishedAtMs"]) }),
            ratingIncluded: publication["ratingIncluded"] === true,
            ...(publication["decidedAtMs"] === undefined ? {} : { decidedAtMs: integer(publication["decidedAtMs"]) }),
            appliedRaces: integer(publication["appliedRaces"]),
          } as RatingPublicationOverview;
        }),
        recalculations: row["recalculations"].map((entry) => {
          const recalculation = object(entry);
          return {
            epoch: integer(recalculation["epoch"], 1),
            reasonCode: text(recalculation["reasonCode"], 64),
            includedPublications: integer(recalculation["includedPublications"]),
            appliedRaces: integer(recalculation["appliedRaces"]),
            skippedRaces: integer(recalculation["skippedRaces"]),
            occurredAtMs: integer(recalculation["occurredAtMs"]),
          };
        }),
      };
    },
    async decide(input, signal) {
      if (!reasonPattern.test(input.reasonCode)) { throw new RatingAdministrationClientError("invalid_input", "reasonCode"); }
      await post("/v1/administrator/rating/decisions", input, signal);
    },
    async recalculate(reasonCode, signal) {
      if (!reasonPattern.test(reasonCode)) { throw new RatingAdministrationClientError("invalid_input", "reasonCode"); }
      const row = object(await post("/v1/administrator/rating/actions/recalculate", { reasonCode, confirmRecalculation: true }, signal));
      return {
        epoch: integer(row["epoch"], 1),
        includedPublications: integer(row["includedPublications"]),
        appliedRaces: integer(row["appliedRaces"]),
        skippedRaces: integer(row["skippedRaces"]),
        ratedPlayers: integer(row["ratedPlayers"]),
      };
    },
    async applyPublication(publicationId, signal) {
      const row = object(await post("/v1/administrator/rating/actions/apply-publication", { publicationId }, signal));
      return { appliedRaces: integer(row["appliedRaces"]), alreadyApplied: row["alreadyApplied"] === true };
    },
  };
}

export type MountedRatingAdministrationSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

export function mountRatingAdministrationSection(
  root: HTMLElement,
  client: RatingAdministrationClient = createRatingAdministrationClient(),
): MountedRatingAdministrationSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("section");
  container.className = "rating-admin ds-panel";
  container.setAttribute("aria-labelledby", "rating-admin-heading");
  const heading = document.createElement("h2");
  heading.id = "rating-admin-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Rating";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading rating overview…";
  const content = document.createElement("div");
  container.append(heading, status, content);
  root.append(container);

  const render = (overview: RatingOverview): void => {
    clear(content);
    status.textContent = `Epoch ${overview.currentEpoch} · ${overview.ratedPlayers} rated Players · ${overview.publications.length} pinned result set${overview.publications.length === 1 ? "" : "s"}.`;
    const explain = document.createElement("p");
    explain.className = "rating-admin__hint";
    explain.textContent = "Each pinned tournament result set either counts for TrueSkill or not. Changing a decision never edits history: it is appended, and a recalculation replays every included set from the seed into a new epoch.";
    content.append(explain);
    const list = document.createElement("ul");
    list.className = "rating-admin__list";
    for (const publication of overview.publications) {
      const item = document.createElement("li");
      item.className = "rating-admin__item";
      const title = document.createElement("span");
      title.className = "rating-admin__title";
      title.textContent = publication.eventName;
      const meta = document.createElement("span");
      meta.className = "rating-admin__meta";
      meta.textContent = `${publication.publicationStatus} · results ${publication.publicVisibility} · ${publication.ratingIncluded ? "counts for TrueSkill" : "excluded from TrueSkill"} · ${publication.appliedRaces} race${publication.appliedRaces === 1 ? "" : "s"} applied in this epoch`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tt-auth__button";
      toggle.textContent = publication.ratingIncluded ? "Exclude from TrueSkill" : "Include in TrueSkill";
      toggle.addEventListener("click", () => {
        confirmDialog({
          title: publication.ratingIncluded ? "Exclude this result set?" : "Include this result set?",
          description: `${publication.eventName} will ${publication.ratingIncluded ? "stop counting" : "count"} toward TrueSkill after the next recalculation. This records a new decision; it does not edit history.`,
          confirmLabel: publication.ratingIncluded ? "Exclude from TrueSkill" : "Include in TrueSkill",
          tone: publication.ratingIncluded ? "danger" : "default",
          onConfirm: () => {
            void client.decide({ publicationId: publication.publicationId, ratingIncluded: !publication.ratingIncluded, reasonCode: "administrator_decision" }, controller.signal)
              .then(() => load())
              .catch((error: unknown) => { if (!disposed) { status.textContent = error instanceof RatingAdministrationClientError && error.detail.length > 0 ? error.detail : "The decision could not be recorded."; } });
          },
        }).open();
      });
      item.append(title, meta, toggle);
      if (publication.ratingIncluded && publication.appliedRaces === 0 && publication.publicationStatus === "published") {
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "tt-auth__button";
        apply.textContent = "Apply now";
        apply.addEventListener("click", () => {
          void client.applyPublication(publication.publicationId, controller.signal)
            .then((result) => { status.textContent = result.alreadyApplied ? "Already applied." : `${result.appliedRaces} race(s) applied.`; return load(); })
            .catch((error: unknown) => { if (!disposed) { status.textContent = error instanceof RatingAdministrationClientError && error.detail.length > 0 ? error.detail : "The result set could not be applied."; } });
        });
        item.append(apply);
      }
      list.append(item);
    }
    content.append(list);
    const recalc = document.createElement("button");
    recalc.type = "button";
    recalc.className = "tt-auth__button tt-auth__button--primary";
    recalc.textContent = "Recalculate all ratings (new epoch)";
    recalc.addEventListener("click", () => {
      confirmDialog({
        title: "Recalculate every rating?",
        description: "A new epoch will replay every included result set from the seed baseline. Earlier epochs stay stored for audit.",
        confirmLabel: "Start recalculation",
        onConfirm: () => {
          status.textContent = "Recalculating…";
          void client.recalculate("administrator_recalculation", controller.signal)
            .then((result) => { status.textContent = `Epoch ${result.epoch}: ${result.includedPublications} set(s), ${result.appliedRaces} races applied, ${result.skippedRaces} skipped, ${result.ratedPlayers} rated Players.`; return load(); })
            .catch((error: unknown) => { if (!disposed) { status.textContent = error instanceof RatingAdministrationClientError && error.detail.length > 0 ? error.detail : "The recalculation could not be started."; } });
        },
      }).open();
    });
    content.append(recalc);
    if (overview.recalculations.length > 0) {
      const history = document.createElement("details");
      const summaryElement = document.createElement("summary");
      summaryElement.textContent = `Recalculations (${overview.recalculations.length})`;
      const historyList = document.createElement("ul");
      for (const entry of overview.recalculations) {
        const item = document.createElement("li");
        item.textContent = `Epoch ${entry.epoch} · ${new Date(entry.occurredAtMs).toISOString().slice(0, 16).replace("T", " ")} · ${entry.reasonCode} · ${entry.includedPublications} set(s), ${entry.appliedRaces} races, ${entry.skippedRaces} skipped`;
        historyList.append(item);
      }
      history.append(summaryElement, historyList);
      content.append(history);
    }
  };

  const load = async (): Promise<void> => {
    try {
      const overview = await client.overview(controller.signal);
      if (disposed) { return; }
      render(overview);
    } catch (error) {
      if (disposed) { return; }
      if (error instanceof RatingAdministrationClientError && error.code === "not_authorized") {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = "The rating overview is temporarily unavailable.";
    }
  };

  const ready = load();
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
