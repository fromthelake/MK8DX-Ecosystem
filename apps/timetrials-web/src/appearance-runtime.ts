// Live appearance state for the running page (ADR-0205). The pure rules are in `appearance.ts`;
// this module owns the device record, the document attributes and the account round trip.

import {
  applyAppearance,
  currentEnvironment,
  hydrateAppearance,
  readAppearance,
  resolveAppearance,
  writeAppearance,
  type AppearanceChoice,
  type AppearanceState,
  type MotionChoice,
  type ResolvedAppearance,
  type TextScale,
} from "./appearance.js";
import {
  createAppearancePreferenceClient,
  type AppearancePreferenceClient,
} from "./appearance-client.js";

let state: AppearanceState = readAppearance();
const listeners = new Set<(next: AppearanceState) => void>();

export function appearanceState(): AppearanceState { return state; }

export function resolvedAppearance(): ResolvedAppearance {
  return resolveAppearance(state.choice, currentEnvironment());
}

export function onAppearanceChange(listener: (next: AppearanceState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function commit(next: AppearanceState, options: Readonly<{ persist: boolean }> = { persist: true }): void {
  state = next;
  if (options.persist) { writeAppearance(next); }
  const documentRef = globalThis.document;
  if (documentRef !== undefined) { applyAppearance(documentRef, next); }
  for (const listener of [...listeners]) { listener(next); }
}

/** Applies the record the boot script already used, so later reads and the DOM cannot drift apart. */
export function startAppearance(): void { commit(state, { persist: false }); }

/**
 * An explicit change on this device. The page changes at once and the account is told; a failed
 * write stays `synced: false` so the next bootstrap sends it (last explicit change wins).
 */
export function chooseAppearance(
  choice: AppearanceChoice,
  options: Readonly<{ client?: AppearancePreferenceClient; signedIn?: boolean; nowMs?: number }> = {},
): Promise<void> {
  const nowMs = options.nowMs ?? Date.now();
  commit({ ...state, choice, updatedAt: nowMs, synced: false });
  if (options.signedIn === false) {
    // Signed out is local only; there is nothing to sync, so the record is not left "pending".
    commit({ ...state, synced: true });
    return Promise.resolve();
  }
  const client = options.client ?? createAppearancePreferenceClient();
  return client.save(choice).then(() => {
    if (state.choice === choice) { commit({ ...state, synced: true }); }
  }).catch(() => undefined);
}

/** Device-local by decision (DESIGN_SYSTEM §19): text size and reduced motion are never synced. */
export function chooseTextScale(textScale: TextScale): void {
  commit({ ...state, textScale });
}

export function chooseReducedMotion(reducedMotion: MotionChoice): void {
  commit({ ...state, reducedMotion });
}

/**
 * After the session is known: the account value is canonical, unless this device holds a newer
 * explicit change that has not been accepted yet. Applied without a transition - the DOM attribute
 * simply changes, and no component animates its colours.
 */
export async function syncAppearanceWithAccount(
  options: Readonly<{ client?: AppearancePreferenceClient }> = {},
): Promise<void> {
  const client = options.client ?? createAppearancePreferenceClient();
  const accountChoice = await client.read().catch(() => undefined);
  if (accountChoice === undefined) { return; }
  const result = hydrateAppearance(state, accountChoice);
  commit(result.next);
  if (result.upload !== null) {
    await client.save(result.upload).then(() => {
      if (state.choice === result.upload) { commit({ ...state, synced: true }); }
    }).catch(() => undefined);
  }
}

/** Signing out keeps the local record (ADR-0205 §6) but stops it counting as account state. */
export function forgetAppearanceSync(): void {
  commit({ ...state, synced: true });
}
