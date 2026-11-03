// Where a night stands, in the Director's own ten steps.
//
// A participant could see the stage ("Kwalificaties") and nothing else, so a
// night waiting for two of three groups to be scored looked exactly like a
// night that had finished its qualifiers. The console has always known the
// step; now the summary carries it, and this draws it: which steps are done,
// which one is being worked on, and which are still to come.
//
// The names are the console's own step titles, so a Director reading this on
// the Tournaments page and the same Director inside the console read the same
// words for the same step.

import { chip, el, stepChevron, useDocument } from "./ds-components.js";
import { localized } from "./product-language.js";
import type { PublicTournamentEvent } from "./tournament-operation-client.js";

/** The workflow the console runs: Step 1 starts the night, Step 10 exports. */
export const TOURNAMENT_STEP_COUNT = 10;

/**
 * The console's own name for each step, Step 0 included. The Tournaments page
 * and the console read from this one list, so a Director who sees "Stap 5 ·
 * Kwalificatiescores" on the overview sees the same words in the console.
 */
export const TOURNAMENT_STEP_LABELS = [
  [0, "Director", "Directeur"],
  [1, "Start", "Start"],
  [2, "Participants & consoles", "Deelnemers & consoles"],
  [3, "Qualifier layout", "Kwalificatie-indeling"],
  [4, "Layout export", "Indeling exporteren"],
  [5, "Qualifier scores", "Kwalificatiescores"],
  [6, "Result export", "Uitslag exporteren"],
  [7, "Final layout", "Finale-indeling"],
  [8, "Final layout export", "Finale-indeling exporteren"],
  [9, "Final scores", "Finalescores"],
  [10, "Final result export", "Einduitslag exporteren"],
] as const;

/** The console's own title for a step, short enough to sit under a chip. */
export function tournamentStepName(step: number): string {
  const found = TOURNAMENT_STEP_LABELS.find(([number]) => number === step);
  return found === undefined ? "" : localized(found[1], found[2]);
}

/**
 * What is done and what is being waited for, in one sentence. The owner's own
 * shape: "Kwalificatie-indeling gereed · wachten op scores".
 */
export function tournamentStepState(step: number): string {
  switch (step) {
    case 1: return localized("Waiting for the tournament to start", "Wachten tot het toernooi start");
    case 2: return localized("Participants known · waiting for the layout", "Deelnemers bekend · wachten op de indeling");
    case 3: return localized("Consoles known · qualifier layout being made", "Consoles bekend · kwalificatie-indeling wordt gemaakt");
    case 4: return localized("Qualifier layout ready · being shared", "Kwalificatie-indeling gereed · wordt gedeeld");
    case 5: return localized("Qualifier layout ready · waiting for scores", "Kwalificatie-indeling gereed · wachten op scores");
    case 6: return localized("Qualifier results known · being shared", "Kwalificatie-uitslag bekend · wordt gedeeld");
    case 7: return localized("Final groups being made", "Eindgroepen worden gemaakt");
    case 8: return localized("Final group layout ready · being shared", "Eindgroep-indeling gereed · wordt gedeeld");
    case 9: return localized("Final groups ready · waiting for scores", "Eindgroepen gereed · wachten op scores");
    case 10: return localized("All scores in · the result is being shared", "Alle scores binnen · de uitslag wordt gedeeld");
    default: return localized("Being prepared", "Wordt voorbereid");
  }
}

/** How far the scoring of one stage is, group by group. */
export type GroupScoringRow = Readonly<{ name: string; races: number }>;

/**
 * The groups whose scores the current step is waiting for. Steps 5 and 9 are
 * the two that wait; every other step has nothing per group to say.
 */
export function tournamentScoringGroups(
  event: PublicTournamentEvent, step: number,
): readonly GroupScoringRow[] {
  if (step !== 5 && step !== 9) { return []; }
  const stage = step === 5 ? "qualifier" : "final";
  return event.groups
    .filter((group) => group.stage === stage)
    .map((group) => ({ name: group.name, races: group.races.length }));
}

/**
 * The progress block: the sentence, the ten steps, and - while a step waits
 * for scores - a chip per group saying how many races have arrived.
 *
 * Everything here is derived; nothing is fetched. The step travels on the
 * summary the list already read, and the groups on the document the card
 * already holds.
 */
export function renderTournamentStepProgress(
  document: Document,
  step: number,
  event?: PublicTournamentEvent,
): HTMLElement {
  useDocument(document);
  const block = el("div", "ds-tournaments__progress", {});
  block.append(el("p", "ds-tournaments__progress-head ds-micro", {},
    el("strong", "", {}, localized(
      `Step ${step} of ${TOURNAMENT_STEP_COUNT}`,
      `Stap ${step} van ${TOURNAMENT_STEP_COUNT}`)),
    ` · ${tournamentStepState(step)}`));
  // The ten steps as a list, so a screen reader hears an ordered sequence and hears which one is
  // current, rather than ten unexplained numbers (§24 Operator, StepChevron).
  block.append(stepChevron({
    label: localized("Tournament steps", "Toernooistappen"),
    steps: Array.from({ length: TOURNAMENT_STEP_COUNT }, (_, index) => `${index + 1}. ${tournamentStepName(index + 1)}`),
    // `stepChevron` counts from zero; the workflow's Step 1 is its first chevron.
    current: step - 1,
    doneLabel: localized("done", "afgerond"),
    currentLabel: localized("now", "nu bezig"),
  }));

  const scoring = event === undefined ? [] : tournamentScoringGroups(event, step);
  if (scoring.length > 0) {
    // Which group has actually delivered. One group of three being scored is exactly what made the
    // night look further along than it was.
    const arrived = scoring.filter((group) => group.races > 0).length;
    const groups = el("p", "ds-tournaments__progress-groups ds-micro", {},
      el("strong", "", {}, localized(
        `${arrived} of ${scoring.length} groups scored`,
        `${arrived} van ${scoring.length} groepen ${arrived === 1 ? "heeft" : "hebben"} scores`)), " ");
    for (const group of scoring) {
      groups.append(chip(group.races > 0
        ? `${group.name}: ${group.races} race${group.races === 1 ? "" : "s"}`
        : localized(`${group.name}: no races yet`, `${group.name}: nog geen races`),
      group.races > 0 ? "success" : "neutral"));
    }
    block.append(groups);
  }
  return block;
}
