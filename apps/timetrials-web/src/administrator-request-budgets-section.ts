import {
  AdministratorRequestBudgetsClientError,
  createAdministratorRequestBudgetsClient,
  type AdministratorRequestBudgets,
  type AdministratorRequestBudgetsClient,
  type RequestBudgetSubjectKind,
} from "./administrator-request-budgets-client.js";
import { localized } from "./product-language.js";

export type MountedAdministratorRequestBudgetsSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function kindLabel(kind: RequestBudgetSubjectKind | null): string {
  switch (kind) {
    case "account": return localized("per account", "per account");
    case "installation": return localized("for the whole installation", "voor de hele installatie");
    case "target": return localized("per Player or claim, counted only", "per speler of claim, alleen geteld");
    case "recipient": return localized("per e-mail recipient, counted only", "per e-mailontvanger, alleen geteld");
    case "address": return localized("per address group, counted only", "per adresgroep, alleen geteld");
    case "device": return localized("per device, counted only", "per apparaat, alleen geteld");
    case "other": return localized("per sign-in or link, counted only", "per aanmelding of link, alleen geteld");
    default: return localized("a quota, counted for the whole installation", "een quotum, geteld voor de hele installatie");
  }
}

function windowLabel(seconds: number): string {
  if (seconds === 60) { return localized("per minute", "per minuut"); }
  if (seconds === 600) { return localized("per 10 minutes", "per 10 minuten"); }
  if (seconds === 3_600) { return localized("per hour", "per uur"); }
  if (seconds === 86_400) { return localized("per day", "per dag"); }
  return `${String(seconds)} s`;
}

function clock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * What the request budgets and quotas refused lately (administrators only). It loads when the
 * section is opened and again on Refresh; it only reads. Scope names are the fixed names of the
 * operational log, accounts are the one kind of subject that is named, and everything else is a
 * count.
 */
export function mountAdministratorRequestBudgetsSection(
  root: HTMLElement,
  options: Readonly<{ client?: AdministratorRequestBudgetsClient }> = {},
): MountedAdministratorRequestBudgetsSection {
  const document = root.ownerDocument;
  const client = options.client ?? createAdministratorRequestBudgetsClient();
  let controller = new AbortController();
  let disposed = false;

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (content !== undefined) { node.textContent = content; }
    return node;
  };

  const container = element("section", "admin-request-budgets ds-panel ds-stack");
  const heading = element("h2", "ds-panel__title", localized("Request limits", "Verzoeklimieten"));
  const intro = element("p", "ds-body", localized(
    "What the request budgets and quotas refused in about the last hour and day, and how much of each installation budget is used now. Only accounts are named; other targets are counted.",
    "Wat de verzoekbudgetten en quota ongeveer het laatste uur en de laatste dag weigerden, en hoeveel van elk installatiebudget nu is gebruikt. Alleen accounts worden genoemd; andere doelen worden alleen geteld.",
  ));
  const refresh = element("button", "tt-auth__button", localized("Refresh", "Vernieuwen"));
  refresh.type = "button";
  const status = element("p", "admin-overview__status", localized("Loading…", "Laden…"));
  status.setAttribute("role", "status");
  const refusals = element("div", "ds-stack");
  const headroom = element("div", "ds-stack");
  const settings = element("details", "ds-panel");
  container.append(heading, intro, refresh, status, refusals, headroom, settings);
  root.append(container);

  const clear = (node: HTMLElement): void => { while (node.firstChild !== null) { node.removeChild(node.firstChild); } };

  const tile = (figure: string, label: string, notes: readonly string[], extra?: HTMLElement): HTMLElement => {
    const item = element("article", "admin-overview__tile ds-stat");
    item.append(element("p", "admin-overview__figure ds-stat__value", figure));
    item.append(element("h4", "admin-overview__label ds-stat__label ds-combined__breakdown", label));
    // Scope and setting names are long single words: they wrap anywhere instead of widening the grid.
    for (const note of notes) { item.append(element("p", "admin-overview__note ds-stat__note ds-combined__breakdown", note)); }
    if (extra !== undefined) { item.append(extra); }
    return item;
  };

  const render = (report: AdministratorRequestBudgets): void => {
    clear(refusals);
    refusals.append(element("h3", "ds-title", localized("Refused in the last day", "Geweigerd in de laatste dag")));
    if (report.refusals.length === 0) {
      refusals.append(element("p", "ds-body", localized(
        "Nothing was refused in the last day.", "Er is de laatste dag niets geweigerd.")));
    } else {
      const grid = element("div", "admin-overview__grid ds-stat-grid");
      for (const scope of report.refusals) {
        let accounts: HTMLElement | undefined;
        if (scope.topAccounts.length > 0) {
          accounts = element("ul", "ds-manage__history");
          for (const account of scope.topAccounts) {
            accounts.append(element("li", "ds-combined__breakdown",
              `${account.screenName ?? account.accountId} · ${String(account.refusedLastDay)}`));
          }
        }
        grid.append(tile(String(scope.lastDay), scope.scope, [
          localized(`${scope.lastHour} in the last hour · ${scope.subjectsLastDay} affected`,
            `${scope.lastHour} in het laatste uur · ${scope.subjectsLastDay} getroffen`),
          kindLabel(scope.subjectKind),
        ], accounts));
      }
      refusals.append(grid);
    }
    if (report.refusalsTruncated) {
      refusals.append(element("p", "ds-body", localized(
        "More was refused than this list shows.", "Er is meer geweigerd dan deze lijst toont.")));
    }

    clear(headroom);
    headroom.append(element("h3", "ds-title", localized(
      "Installation budgets in the current window", "Installatiebudgetten in het huidige venster")));
    const grid = element("div", "admin-overview__grid ds-stat-grid");
    for (const item of report.headroom) {
      grid.append(tile(`${String(item.used)} / ${String(item.maximum)}`, item.scope, [
        `${windowLabel(item.windowSeconds)} · ${localized(`starts again at ${clock(item.windowEndsAtMs)}`,
          `begint opnieuw om ${clock(item.windowEndsAtMs)}`)}`,
        ...(item.refused > 0 ? [localized(`${item.refused} refused in this window`,
          `${item.refused} geweigerd in dit venster`)] : []),
        item.setting ?? localized("built-in limit", "ingebouwde limiet"),
      ]));
    }
    headroom.append(grid);

    clear(settings);
    settings.append(element("summary", "", localized("Current settings", "Huidige instellingen")));
    settings.append(element("p", "ds-body", localized(
      "Change a setting in the installation's private settings and restart the API; a setting that is not present keeps its default.",
      "Wijzig een instelling in de privé-instellingen van de installatie en herstart de API; een instelling die ontbreekt houdt de standaardwaarde.",
    )));
    const facts = element("dl", "ds-manage__facts");
    for (const setting of report.settings) {
      facts.append(element("dt", "", String(setting.value)));
      facts.append(element("dd", "", `${setting.setting} · ${windowLabel(setting.windowSeconds)} · ${
        localized(`default ${setting.defaultValue}`, `standaard ${setting.defaultValue}`)}`));
    }
    settings.append(facts);
    status.textContent = localized(
      `Counted until ${clock(report.generatedAtMs)}.`, `Geteld tot ${clock(report.generatedAtMs)}.`);
  };

  const load = (): Promise<void> => {
    controller.abort();
    controller = new AbortController();
    status.textContent = localized("Loading…", "Laden…");
    refresh.disabled = true;
    return client.report(controller.signal).then((report) => {
      if (disposed) { return; }
      render(report);
    }).catch((error: unknown) => {
      if (disposed) { return; }
      if (error instanceof DOMException && error.name === "AbortError") { return; }
      if (error instanceof AdministratorRequestBudgetsClientError && error.code === "not_authorized") {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = localized(
        "The request limits could not be loaded.", "De verzoeklimieten konden niet worden geladen.");
    }).finally(() => { if (!disposed) { refresh.disabled = false; } });
  };
  refresh.addEventListener("click", () => { void load(); });
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
