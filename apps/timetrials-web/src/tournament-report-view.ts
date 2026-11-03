// Step 11 in spirit: after Step 10 has exported the result, the Director
// writes the night's report and publishes it. The community's own original report page
// does the same with an inline editor over its export; this does it over the
// real document, so what the Director reads while typing is the page the
// community will get. Every text block of that page opens in place, with the
// formatting toolbar the source editor had (`tournament-report-editor.ts`).
//
// Saving and publishing are deliberately two acts. The Director saves as often
// as they like; the page the community reads only changes when they publish.

import { localized } from "./product-language.js";
import { buildTournamentInsights } from "./tournament-insights.js";
import { readReportStage, renderTournamentReport, writeReportStage, type ReportBlockKey } from "./tournament-night-report-view.js";
import {
  createTournamentOperationClient,
  type PublicTournamentEvent,
} from "./tournament-operation-client.js";
import {
  createTournamentReportClient,
  TournamentReportClientError,
  type TournamentReportDocument,
  type TournamentReportDraft,
  NEW_REPORT_VISIBILITY,
  type TournamentReportVisibility,
} from "./tournament-report-client.js";
import { mountInlineReportEditor } from "./tournament-report-editor.js";
import { reportMarkupHtml, reportMarkupText, sanitizeReportMarkup } from "./tournament-report-markup.js";
import { tournamentReport } from "./tournament-report.js";
import {
  buildReportTemplate,
  parseReportTemplate,
  reportTemplateFileName,
} from "./tournament-report-template.js";
import { tournamentStoryFromReport } from "./tournament-stories.js";

export type MountedTournamentReport = Readonly<{ container: HTMLElement; ready: Promise<void>; unmount(): void }>;

/** The texts of the draft as the editor holds them: sanitised markup per field. */
export type ReportTexts = {
  introText: string;
  summaryText: string;
  tracksIntroText: string;
  groupNotes: Record<string, string>;
  playerNotes: Record<string, string>;
};

const VISIBILITY_LABELS: readonly [keyof TournamentReportVisibility, string, string][] = [
  ["intro", "Intro", "Intro"],
  ["summary", "Summary of the tournament", "Samenvatting van het toernooi"],
  ["groupNotes", "Group notes (all groups)", "Groepsteksten (alle groepen)"],
  ["topTracks", "Top 5 tracks driven", "Top 5 gereden banen"],
  ["benchmark", "Top 3 total benchmark", "Top 3 totaalbenchmark"],
  ["duel", "Duel with the place above", "Duel met de plek erboven"],
  ["distribution", "Position distribution", "Positieverdeling"],
];

/** The written blocks of an imported text file that the switches keep off the page, as [English, Dutch]. */
export function importedButHidden(
  fields: Readonly<{ introText: string; summaryText: string; tracksIntroText: string; groupNotes: Readonly<Record<string, string>> }>,
  shown: (key: keyof TournamentReportVisibility) => boolean,
): readonly (readonly [string, string])[] {
  const off: (readonly [string, string])[] = [];
  if (fields.introText.length > 0 && !shown("intro")) { off.push(["Intro", "Intro"]); }
  if (fields.summaryText.length > 0 && !shown("summary")) { off.push(["Summary", "Samenvatting"]); }
  if (fields.tracksIntroText.length > 0 && !shown("topTracks")) { off.push(["Top 5 tracks", "Top 5 banen"]); }
  if (Object.values(fields.groupNotes).some((note) => note.length > 0) && !shown("groupNotes")) {
    off.push(["Group notes", "Groepsteksten"]);
  }
  return off;
}

/** Which field of the draft a block of the page edits, and how long it may be. */
export function reportBlockTarget(
  key: ReportBlockKey,
  names: Readonly<{ groups: ReadonlyMap<string, string>; players: ReadonlyMap<string, string> }>,
): Readonly<{ field: "introText" | "summaryText" | "tracksIntroText"; maximum: number } | { field: "groupNotes" | "playerNotes"; id: string; maximum: number }> | null {
  if (key === "intro") { return { field: "introText", maximum: 8000 }; }
  if (key === "summary") { return { field: "summaryText", maximum: 8000 }; }
  if (key === "topTracks") { return { field: "tracksIntroText", maximum: 8000 }; }
  if (key.startsWith("group:")) {
    const id = names.groups.get(key.slice("group:".length));
    return id === undefined ? null : { field: "groupNotes", id, maximum: 4000 };
  }
  if (key.startsWith("player:")) {
    const id = names.players.get(key.slice("player:".length));
    return id === undefined ? null : { field: "playerNotes", id, maximum: 2000 };
  }
  return null;
}

export function reportTextOf(texts: ReportTexts, target: NonNullable<ReturnType<typeof reportBlockTarget>>): string {
  return "id" in target ? texts[target.field][target.id] ?? "" : texts[target.field];
}

export function withReportText(texts: ReportTexts, target: NonNullable<ReturnType<typeof reportBlockTarget>>, markup: string): ReportTexts {
  const clean = sanitizeReportMarkup(markup);
  if ("id" in target) {
    const notes = { ...texts[target.field] };
    if (clean.length === 0) { delete notes[target.id]; } else { notes[target.id] = clean; }
    return { ...texts, [target.field]: notes };
  }
  return { ...texts, [target.field]: clean };
}

function field(document: Document, label: string, hint: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "tournament-report-edit__field";
  const name = document.createElement("span");
  name.className = "tournament-report-edit__label";
  name.textContent = label;
  wrap.append(name);
  if (hint.length > 0) {
    const note = document.createElement("span");
    note.className = "tournament-report-edit__hint";
    note.textContent = hint;
    wrap.append(note);
  }
  wrap.append(control);
  return wrap;
}

export function mountTournamentReport(root: HTMLElement, tournamentId: string): MountedTournamentReport {
  const document = root.ownerDocument;
  const client = createTournamentReportClient();
  const events = createTournamentOperationClient();
  const controller = new AbortController();
  let disposed = false;

  const container = document.createElement("section");
  container.className = "ds-root ds-report-editor ds-stack tournament-report-edit";
  container.setAttribute("data-spectacle", "minimal");
  const status = document.createElement("p");
  status.className = "ds-body-s tournament-report-edit__status";
  status.setAttribute("role", "status");
  status.textContent = localized("Loading report…", "Verslag laden…");
  container.append(status);
  root.append(container);

  const ready = Promise.all([
    client.load(tournamentId, controller.signal),
    events.loadPublic(tournamentId, controller.signal).catch(() => null),
  ]).then(([report, event]) => {
    if (disposed) { return; }
    status.textContent = "";
    render(report, event, report.draft);
  }, (error: unknown) => {
    status.textContent = error instanceof TournamentReportClientError && error.status === 403
      ? localized("This account may not write Tournament reports.", "Dit account mag geen toernooiverslagen schrijven.")
      : localized("The Tournament report is unavailable.", "Het toernooiverslag is niet beschikbaar.");
  });

  function render(
    report: TournamentReportDocument,
    event: PublicTournamentEvent | null,
    initial: TournamentReportDraft | null,
  ): void {
    let draft = initial;
    let dirty = false;
    let editing: { key: ReportBlockKey; destroy(): void } | null = null;
    // Which stage the Director is reading; the writing is on the finals either way.
    let readerStage = readReportStage(document);
    const insights = buildTournamentInsights(report.tournament);
    const finalized = report.tournament.summary.stage === "finalized";
    let texts: ReportTexts = {
      introText: sanitizeReportMarkup(draft?.introText ?? ""),
      summaryText: sanitizeReportMarkup(draft?.summaryText ?? ""),
      tracksIntroText: sanitizeReportMarkup(draft?.tracksIntroText ?? ""),
      groupNotes: Object.fromEntries(Object.entries(draft?.groupNotes ?? {}).map(([id, note]) => [id, sanitizeReportMarkup(note)])),
      playerNotes: Object.fromEntries(Object.entries(draft?.playerNotes ?? {}).map(([id, note]) => [id, sanitizeReportMarkup(note)])),
    };

    const head = document.createElement("header");
    head.className = "tournament-report-edit__head";
    const title = document.createElement("h1");
    title.className = "ds-display-4";
    title.textContent = localized(
      `${report.tournament.summary.name} · Final report`,
      `${report.tournament.summary.name} · Eindverslag`,
    );
    const back = document.createElement("a");
    back.className = "ds-button";
    back.setAttribute("data-variant", "quiet");
    back.setAttribute("href", `/?tournaments=${encodeURIComponent(tournamentId)}&operate=1`);
    back.textContent = localized("← Back to Step 10", "← Terug naar Stap 10");
    head.append(back, title);

    const state = document.createElement("p");
    state.className = "ds-body-m tournament-report-edit__state";

    const form = document.createElement("form");
    form.className = "ds-panel ds-stack tournament-report-edit__form";

    const titleInput = document.createElement("input");
    titleInput.className = "ds-input tournament-report-edit__title";
    titleInput.type = "text";
    titleInput.maxLength = 160;
    titleInput.value = draft?.titleText ?? "";
    titleInput.placeholder = report.tournament.summary.name;

    // Only the groups the document actually shows. It prints the final groups
    // when the night has them, so offering a note for a qualifier group would
    // be writing into a page nobody will see.
    const shownGroups = event === null
      ? report.tournament.groups.map((group) => ({ groupId: group.groupId, name: group.name }))
      : tournamentReport(event).groups.map((group) => ({ groupId: group.groupId, name: group.name }));
    const groupIds = new Map(shownGroups.map((group) => [group.name, group.groupId]));
    const groupNames = new Map(shownGroups.map((group) => [group.groupId, group.name]));
    const playerIds = new Map<string, string>();
    const playerNames = new Map<string, string>();
    for (const group of report.tournament.groups) {
      for (const member of group.members) { playerIds.set(member.displayName, member.playerId); playerNames.set(member.playerId, member.displayName); }
    }
    for (const row of insights.players) { playerIds.set(row.displayName, row.playerId); playerNames.set(row.playerId, row.displayName); }

    const visibility = new Map<keyof TournamentReportVisibility, HTMLInputElement>();
    const visibilityBlock = document.createElement("div");
    visibilityBlock.className = "tournament-report-edit__flags";
    for (const [key, en, nl] of VISIBILITY_LABELS) {
      const row = document.createElement("label");
      row.className = "tournament-report-edit__flag";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = (draft?.visibility ?? NEW_REPORT_VISIBILITY)[key];
      const text = document.createElement("span");
      text.textContent = localized(en, nl);
      row.append(box, text);
      visibility.set(key, box);
      visibilityBlock.append(row);
    }

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "ds-button";
    save.setAttribute("data-variant", "secondary");
    save.textContent = localized("Save draft", "Concept opslaan");
    const publish = document.createElement("button");
    publish.type = "button";
    publish.className = "ds-button";
    publish.setAttribute("data-variant", "primary");
    publish.textContent = localized("Publish report", "Verslag publiceren");

    // The writing as one file, so the report writer can start before a race is entered and
    // the Director can rebuild the night without losing a word. Groups and
    // Players are matched by name, so new identifiers do not matter.
    const heading = `${event?.editionNumber === undefined ? "" : `TN${event.editionNumber} · `}${report.tournament.summary.name}`;
    const templateFields = (): Parameters<typeof buildReportTemplate>[0]["fields"] => ({
      titleText: titleInput.value,
      introText: texts.introText,
      summaryText: texts.summaryText,
      tracksIntroText: texts.tracksIntroText,
      groupNotes: Object.fromEntries([...groupIds].map(([name, id]) => [name, texts.groupNotes[id] ?? ""])),
      playerNotes: Object.fromEntries([...playerIds].map(([name, id]) => [name, texts.playerNotes[id] ?? ""])),
    });
    const download = document.createElement("button");
    download.type = "button";
    download.className = "ds-button";
    download.setAttribute("data-variant", "secondary");
    download.textContent = localized("Download the text", "Tekst downloaden");
    download.title = localized(
      "One file with every text block of this night and how to write in it.",
      "Eén bestand met elk tekstblok van deze avond en hoe je erin schrijft.",
    );
    download.addEventListener("click", () => {
      const now = new Date();
      const file = buildReportTemplate({
        heading, fields: templateFields(),
        groupNames: [...groupIds.keys()],
        playerNames: [...playerIds.keys()],
        generatedAt: now,
      });
      const blob = new Blob([file], { type: "text/markdown;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = reportTemplateFileName(heading, now);
      anchor.click();
      URL.revokeObjectURL(href);
      status.textContent = localized(
        "The text file was downloaded. It explains its own markup at the top.",
        "Het tekstbestand is gedownload. Bovenaan staat hoe de opmaak werkt.",
      );
    });

    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".md,.txt,text/markdown,text/plain";
    uploadInput.className = "tournament-report-edit__upload";
    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "ds-button";
    upload.setAttribute("data-variant", "secondary");
    upload.textContent = localized("Read a text file", "Tekstbestand inlezen");
    upload.title = localized(
      "Fill this draft from a downloaded text file. Nothing is saved until you press Save draft.",
      "Vul dit concept met een gedownload tekstbestand. Er wordt niets opgeslagen tot je Concept opslaan drukt.",
    );
    upload.addEventListener("click", () => { uploadInput.click(); });
    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files?.[0];
      if (file === undefined) { return; }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        uploadInput.value = "";
        const parsed = parseReportTemplate(String(reader.result ?? ""));
        if (parsed.fields.titleText.length > 0) { titleInput.value = parsed.fields.titleText; }
        texts.introText = parsed.fields.introText;
        texts.summaryText = parsed.fields.summaryText;
        texts.tracksIntroText = parsed.fields.tracksIntroText;
        // Count every block that came back with writing in it, the report's
        // own three included, or the line reads as if they were skipped.
        let filled = [parsed.fields.introText, parsed.fields.summaryText, parsed.fields.tracksIntroText]
          .filter((value) => value.length > 0).length;
        const missing: string[] = [...parsed.unknownSections];
        for (const [name, note] of Object.entries(parsed.fields.groupNotes)) {
          const id = groupIds.get(name);
          if (id === undefined) { missing.push(name); continue; }
          texts.groupNotes[id] = note;
          if (note.length > 0) { filled += 1; }
        }
        for (const [name, note] of Object.entries(parsed.fields.playerNotes)) {
          const id = playerIds.get(name);
          if (id === undefined) { missing.push(name); continue; }
          texts.playerNotes[id] = note;
          if (note.length > 0) { filled += 1; }
        }
        refresh();
        const parts = [localized(
          `Text file read: ${filled} block(s) with writing. Nothing is saved yet.`,
          `Tekstbestand ingelezen: ${filled} blok(ken) met tekst. Er is nog niets opgeslagen.`,
        )];
        if (missing.length > 0) {
          parts.push(localized(
            `Not in this night, so skipped: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}.`,
            `Niet in deze avond, dus overgeslagen: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}.`,
          ));
        }
        // The file carries text, never the switches: say which written block
        // stays out of the page until its box is ticked.
        const off = importedButHidden(parsed.fields, (key) => visibility.get(key)?.checked ?? NEW_REPORT_VISIBILITY[key]);
        if (off.length > 0) {
          parts.push(localized(
            `Switched off under Which blocks the report shows, so not on the page: ${off.map(([en]) => en).join(", ")}.`,
            `Uitgezet onder Welke blokken het verslag toont, dus niet op de pagina: ${off.map(([, nl]) => nl).join(", ")}.`,
          ));
        }
        if (parsed.strayLines.length > 0) {
          parts.push(localized(
            `${parsed.strayLines.length} line(s) stood outside a heading and were left out (first at line ${parsed.strayLines[0]!.line}).`,
            `${parsed.strayLines.length} regel(s) stonden buiten een kop en zijn niet overgenomen (eerste op regel ${parsed.strayLines[0]!.line}).`,
          ));
        }
        status.textContent = parts.join(" ");
      });
      reader.addEventListener("error", () => {
        uploadInput.value = "";
        status.textContent = localized("The file could not be read.", "Het bestand kon niet worden gelezen.");
      });
      reader.readAsText(file);
    });

    const actions = document.createElement("div");
    actions.className = "tournament-report-edit__actions";
    actions.append(save, publish, download, upload, uploadInput);

    const flagsTitle = document.createElement("h2");
    flagsTitle.textContent = localized("Which blocks the report shows", "Welke blokken het verslag toont");
    const howTo = document.createElement("p");
    howTo.className = "tournament-report-edit__hint";
    howTo.textContent = localized(
      "Write in the page below: every text block has an Edit button and opens in place with a formatting toolbar. Apply keeps the text in this draft; Save draft stores it; Publish gives it to the community.",
      "Schrijf in de pagina hieronder: elk tekstblok heeft een knop Bewerken en opent ter plekke met een opmaakbalk. Toepassen houdt de tekst in dit concept; Concept opslaan bewaart het; Publiceren geeft het aan de community.",
    );
    form.append(
      field(document, localized("Title", "Titel"),
        localized("The heading the report opens with. Empty keeps the night's own name.",
          "De kop waarmee het verslag opent. Leeg houdt de naam van de avond aan."), titleInput),
      flagsTitle, visibilityBlock, howTo, actions,
    );

    const previewTitle = document.createElement("h2");
    previewTitle.className = "ds-display-6 tournament-report-edit__preview-title";
    previewTitle.textContent = localized("What the community will read — click a block to write", "Wat de community te lezen krijgt — klik op een blok om te schrijven");
    const preview = document.createElement("div");
    preview.className = "tournament-report-edit__preview tournament-report-edit__preview--editable";

    const body = (): Readonly<{
      titleText: string; introText: string; summaryText: string; tracksIntroText: string;
      playerNotes: Record<string, string>; groupNotes: Record<string, string>;
      visibility: TournamentReportVisibility;
    }> => ({
      titleText: titleInput.value,
      introText: texts.introText,
      summaryText: texts.summaryText,
      tracksIntroText: texts.tracksIntroText,
      playerNotes: { ...texts.playerNotes }, groupNotes: { ...texts.groupNotes },
      visibility: Object.fromEntries(VISIBILITY_LABELS.map(([key]) =>
        [key, visibility.get(key)?.checked ?? NEW_REPORT_VISIBILITY[key]])) as TournamentReportVisibility,
    });

    const blocksOf = (markup: string): Readonly<{ paragraphs: readonly string[]; html: readonly string[] }> =>
      ({ paragraphs: reportMarkupText(markup), html: reportMarkupHtml(markup) });

    /** The real document, from what is in the draft right now, with every block openable. */
    /** Redraw the page from the draft. The redraw replaces the whole preview,
     * so the block that was just written is brought back into view and its
     * button focused: the writer stays where they were. */
    let drawnOnce = false;
    const refresh = (focusKey: ReportBlockKey | null = null): void => {
      // Where the written block sits in the window before the redraw: after Apply it goes back to exactly that
      // place, so the page does not jump (owner feedback 02-11: "I want to stay where I am").
      const anchorTop = focusKey === null ? null
        : preview.querySelector<HTMLElement>(`[data-report-block="${CSS.escape(focusKey)}"]`)?.getBoundingClientRect().top ?? null;
      if (editing !== null) { editing.destroy(); editing = null; }
      const scrollY = document.defaultView?.scrollY ?? 0;
      if (event === null) {
        preview.textContent = localized(
          "The preview appears once the night has races to show.",
          "De voorbeeldweergave verschijnt zodra de avond races heeft.",
        );
        return;
      }
      const command = body();
      const intro = blocksOf(command.introText);
      const summary = blocksOf(command.summaryText);
      const topTracks = blocksOf(command.tracksIntroText);
      const story = tournamentStoryFromReport({
        title: command.titleText.length > 0 ? command.titleText : report.tournament.summary.name,
        intro: intro.paragraphs, introHtml: intro.html,
        summary: summary.paragraphs, summaryHtml: summary.html,
        topTracks: topTracks.paragraphs, topTracksHtml: topTracks.html,
        groups: Object.entries(command.groupNotes).flatMap(([groupId, note]) => {
          const name = groupNames.get(groupId);
          const blocks = blocksOf(note);
          return name === undefined || blocks.paragraphs.length === 0 ? [] : [{ name, paragraphs: blocks.paragraphs, html: blocks.html }];
        }),
        players: Object.entries(command.playerNotes).flatMap(([playerId, note]) => {
          const name = playerNames.get(playerId);
          const blocks = blocksOf(note);
          return name === undefined || blocks.paragraphs.length === 0 ? [] : [{ name, paragraphs: blocks.paragraphs, html: blocks.html }];
        }),
      });
      // The preview is the page itself, drawn from the same code, with the
      // blocks the Director has ticked, and every text block openable.
      const shown: PublicTournamentEvent = {
        ...event,
        report: {
          title: story.title, intro: story.intro, summary: story.summary, topTracks: story.topTracks,
          groups: story.groups.map((group) => ({ name: group.name, paragraphs: group.paragraphs })),
          players: story.players.map((player) => ({ name: player.name, paragraphs: player.paragraphs })),
          visibility: command.visibility, publishedAtMs: 0, revision: draft?.revision ?? 1,
          ...(report.ratings === undefined || report.ratings === null ? {} : { ratings: report.ratings }),
        },
      };
      preview.replaceChildren(...renderTournamentReport(document, shown, story, {
        standalone: true, editable: true, followFragment: !drawnOnce,
        ...(readerStage === undefined ? {} : { stage: readerStage }),
        onStage: (next) => { readerStage = next; writeReportStage(document, next); refresh(); },
      }));
      const firstDraw = !drawnOnce;
      drawnOnce = true;
      decorate();
      if (focusKey !== null) {
        const again = preview.querySelector<HTMLElement>(`[data-report-block="${CSS.escape(focusKey)}"]`);
        if (again !== null) {
          again.querySelector<HTMLElement>(".tournament-report-edit__open")?.focus({ preventScroll: true });
          if (anchorTop !== null) {
            const selector = `[data-report-block="${CSS.escape(focusKey)}"]`;
            keepInPlace(() => {
              const block = preview.querySelector<HTMLElement>(selector);
              return block === null ? 0 : block.getBoundingClientRect().top - anchorTop;
            });
          } else {
            again.scrollIntoView({ block: "center" });
          }
          return;
        }
      }
      // The first draw may follow the address's #fragment; later redraws keep the window where it was.
      if (!firstDraw) { keepInPlace(() => scrollY - (document.defaultView?.scrollY ?? scrollY)); }
    };

    /** The redraw lays the report out in pieces: right after it the page is shorter than before, so one scrollTo
     * is cut short and the page then grows back under the writer. Correct the drift every frame until the layout
     * has settled (about a second at most), and stop at once when the writer scrolls, clicks or types. */
    let settling: (() => void) | null = null;
    const keepInPlace = (drift: () => number): void => {
      settling?.();
      const view = document.defaultView;
      if (view === null) { return; }
      let frame = 0;
      let still = 0;
      let handle = 0;
      const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
      const stop = (): void => {
        view.cancelAnimationFrame(handle);
        for (const name of inputs) { view.removeEventListener(name, stop); }
        if (settling === stop) { settling = null; }
      };
      settling = stop;
      for (const name of inputs) { view.addEventListener(name, stop, { passive: true }); }
      const step = (): void => {
        const off = drift();
        if (Math.abs(off) > 1) { view.scrollBy({ top: off }); still = 0; } else { still += 1; }
        frame += 1;
        if (still >= 10 || frame >= 90) { stop(); return; }
        handle = view.requestAnimationFrame(step);
      };
      step();
    };
    controller.signal.addEventListener("abort", () => settling?.());

    const decorate = (): void => {
      for (const wrapper of preview.querySelectorAll<HTMLElement>("[data-report-block]")) {
        // A block swapped in by a Player's own stage switch arrives undecorated; one already dressed is left alone.
        if (wrapper.querySelector(":scope > .tournament-report-edit__open") !== null) { continue; }
        const key = wrapper.getAttribute("data-report-block") as ReportBlockKey;
        const target = reportBlockTarget(key, { groups: groupIds, players: playerIds });
        if (target === null) { continue; }
        const current = reportTextOf(texts, target);
        if (current.length === 0) {
          const placeholder = document.createElement("p");
          placeholder.className = "tournament-report__copy tournament-report-edit__placeholder";
          placeholder.textContent = localized("Nothing written here yet.", "Hier is nog niets geschreven.");
          wrapper.append(placeholder);
        }
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "tournament-report-edit__open";
        edit.textContent = current.length === 0 ? localized("Write", "Schrijven") : localized("Edit", "Bewerken");
        edit.setAttribute("aria-label", localized(`Edit: ${key}`, `Bewerken: ${key}`));
        edit.addEventListener("click", () => open(wrapper, key));
        wrapper.append(edit);
      }
    };

    // The page swaps a Player's section in place when the reader switches its
    // stage; the fresh blocks get their buttons the moment they land.
    if (typeof MutationObserver === "function") {
      const watcher = new MutationObserver((records) => {
        if (editing !== null) { return; }
        if (records.some((record) => [...record.addedNodes].some((node) => node instanceof HTMLElement && (node.matches("[data-report-block]") || node.querySelector("[data-report-block]") !== null)))) { decorate(); }
      });
      watcher.observe(preview, { childList: true, subtree: true });
      controller.signal.addEventListener("abort", () => watcher.disconnect());
    }

    const open = (wrapper: HTMLElement, key: ReportBlockKey): void => {
      const target = reportBlockTarget(key, { groups: groupIds, players: playerIds });
      if (target === null) { return; }
      if (editing !== null) { refresh(); const again = preview.querySelector<HTMLElement>(`[data-report-block="${CSS.escape(key)}"]`); if (again === null) { return; } wrapper = again; }
      const label = key === "intro" ? localized("Introduction", "Introductie")
        : key === "summary" ? localized("Summary", "Samenvatting")
          : key === "topTracks" ? localized("Top 5 tracks introduction", "Introductie Top 5 banen")
            : key.startsWith("group:") ? localized(`Note for ${key.slice(6)}`, `Notitie voor ${key.slice(6)}`)
              : localized(`Note for ${key.slice(7)}`, `Notitie voor ${key.slice(7)}`);
      const mounted = mountInlineReportEditor(wrapper, {
        markup: reportTextOf(texts, target), label, maximum: target.maximum,
        onApply: (markup) => { texts = withReportText(texts, target, markup); dirty = true; editing = null; refresh(key); showState(); },
        onApplyAndSave: (markup) => { texts = withReportText(texts, target, markup); dirty = true; editing = null; refresh(key); showState(); form.requestSubmit(); },
        onCancel: () => { editing = null; refresh(key); },
      });
      editing = { key, destroy: mounted.destroy };
      mounted.surface.scrollIntoView({ block: "nearest" });
    };

    const showState = (): void => {
      if (draft === null) {
        state.textContent = dirty ? localized("Unsaved text. Save the draft to keep it.", "Niet-opgeslagen tekst. Sla het concept op om het te bewaren.") : localized("Nothing written yet.", "Nog niets geschreven.");
        publish.disabled = true;
        return;
      }
      const published = draft.publishedRevision;
      publish.disabled = !finalized || published === draft.revision || dirty;
      state.textContent = dirty
        ? localized("Unsaved changes. Save the draft before publishing.", "Niet-opgeslagen wijzigingen. Sla het concept op voordat je publiceert.")
        : published === undefined
          ? finalized
            ? localized("Draft saved, never published.", "Concept opgeslagen, nog niet gepubliceerd.")
            : localized("Draft saved. Finalize the night before publishing.",
              "Concept opgeslagen. Rond de avond af voordat je publiceert.")
          : published === draft.revision
            ? localized(`Published: revision ${published}.`, `Gepubliceerd: revisie ${published}.`)
            : localized(
              `The draft is ahead of what the community reads (revision ${published}).`,
              `Het concept loopt voor op wat de community leest (revisie ${published}).`,
            );
    };

    titleInput.addEventListener("input", () => { dirty = true; refresh(); showState(); });
    for (const box of visibility.values()) { box.addEventListener("change", () => { dirty = true; refresh(); showState(); }); }
    form.addEventListener("submit", (submitted) => {
      submitted.preventDefault();
      save.disabled = true;
      void client.save(tournamentId, { expectedRevision: draft?.revision ?? null, ...body() }, controller.signal)
        .then((saved) => {
          draft = saved;
          dirty = false;
          status.textContent = localized("Draft saved.", "Concept opgeslagen.");
          showState();
        }, (error: unknown) => {
          status.textContent = error instanceof Error ? error.message : localized("Saving failed.", "Opslaan mislukt.");
        }).finally(() => { save.disabled = false; });
    });
    publish.addEventListener("click", () => {
      if (draft === null) { return; }
      publish.disabled = true;
      void client.publish(tournamentId, draft.revision, controller.signal)
        .then((published) => {
          draft = published;
          status.textContent = localized("Report published.", "Verslag gepubliceerd.");
          showState();
        }, (error: unknown) => {
          status.textContent = error instanceof Error ? error.message : localized("Publishing failed.", "Publiceren mislukt.");
          showState();
        });
    });

    // The WordPress export is one file of the published report, made in Step 10 part 5 of the
    // operator's page (tournament-report-wordpress.ts). This points there rather than offering a
    // second, older export that leaves out the charts and the writing per group.
    const wordpress = document.createElement("p");
    wordpress.className = "tournament-report-edit__wordpress";
    const wordpressLink = document.createElement("a");
    wordpressLink.setAttribute("href", `/?tournaments=${encodeURIComponent(report.tournament.summary.tournamentId)}&operate=1`);
    wordpressLink.textContent = localized("Step 10, part 5", "Stap 10, onderdeel 5");
    wordpress.append(
      localized("WordPress export: publish the report, then download it under ", "WordPress-export: publiceer het verslag en download het daarna onder "),
      wordpressLink,
      localized(" as one file with everything embedded.", " als één bestand met alles ingesloten."),
    );

    container.append(head, state, form, previewTitle, preview, wordpress);
    showState();
    refresh();
  }

  return {
    container,
    ready,
    unmount: () => { disposed = true; controller.abort(); container.remove(); },
  };
}
