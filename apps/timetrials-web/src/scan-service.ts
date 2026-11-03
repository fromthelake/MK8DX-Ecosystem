// The scan service: the one place that turns what a producer read into a fill for the canonical
// Post-a-Time draft (POST_A_TIME_ARCHITECTURE §11, ADR-0206).
//
// There is exactly one mapping. The task uses it for a returning scan, and the mapping cases in
// tooling/design-system/fixtures/scan-mapping-cases.json are run against this function, so the
// scanner and the form cannot drift apart quietly. It is pure: no DOM, no storage, no fetch.

import type { ScanFill } from "./post-time-model.js";
import type { WebScanHandoff } from "./scan-handoff.js";

/** The two screens a producer can read, as the Player is asked to choose between them. */
export type ScanSource = "endscreen" | "ghost_detail";

export const SCAN_SOURCES: readonly ScanSource[] = ["endscreen", "ghost_detail"];

/** Where the Player's last choice is remembered, so the picker can offer it first. */
export const SCAN_SOURCE_STORAGE_KEY = "mk8dx.scan-source.v1";

export function rememberScanSource(source: ScanSource, store?: Storage | null): void {
  const storage = store === undefined ? localStorageOrNull() : store;
  try { storage?.setItem(SCAN_SOURCE_STORAGE_KEY, source); } catch { /* blocked storage */ }
}

/** The source the Player used last, or null when they have not scanned on this browser yet. */
export function lastScanSource(store?: Storage | null): ScanSource | null {
  const storage = store === undefined ? localStorageOrNull() : store;
  let value: string | null = null;
  try { value = storage?.getItem(SCAN_SOURCE_STORAGE_KEY) ?? null; } catch { return null; }
  return value === "endscreen" || value === "ghost_detail" ? value : null;
}

function localStorageOrNull(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * What a returning scan fills into the draft.
 *
 * The track and the engine class are never taken from the producer: they are the task's context
 * (ENGINE_CONTEXT_INVENTORY R12). An unreadable value is left empty rather than guessed, and the
 * producer's own doubt travels with it so the form can ask the Player to confirm that field.
 */
export function scanFillFromHandoff(handoff: WebScanHandoff): ScanFill {
  return {
    totalDigits: handoff.totalDigits,
    laps: handoff.laps,
    ...(handoff.characterId === undefined ? {} : { characterId: handoff.characterId }),
    ...(handoff.bodyId === undefined ? {} : { bodyId: handoff.bodyId }),
    ...(handoff.tireId === undefined ? {} : { tireId: handoff.tireId }),
    ...(handoff.gliderId === undefined ? {} : { gliderId: handoff.gliderId }),
    ...(handoff.countryId === undefined ? {} : { countryId: handoff.countryId }),
    ...(handoff.observedPlayerName === undefined
      ? {} : { observedPlayerName: handoff.observedPlayerName }),
    ...(handoff.layout === undefined ? {} : { source: handoff.layout }),
    ...(handoff.producerVersion === undefined
      ? {} : { producerVersion: handoff.producerVersion }),
    ...(handoff.confidence === undefined ? {} : { confidence: handoff.confidence }),
    ...(handoff.lapSumMatches === undefined ? {} : { lapSumMatches: handoff.lapSumMatches }),
    ...(handoff.doubt === undefined ? {} : { doubt: handoff.doubt }),
    ...(handoff.variants === undefined ? {} : { variants: handoff.variants }),
  };
}
