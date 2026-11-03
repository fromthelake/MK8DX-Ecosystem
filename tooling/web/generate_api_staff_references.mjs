#!/usr/bin/env node
// The API's copy of the Nintendo staff times, for proving a staff ghost reading (ADR-0212).
//
// Source: the web's generated benchmark manifest (itself generated from the schema-9 asset
// database with the corrected staff countries), so the API and the track board agree on every
// staff time, name, flag and kart setup. Regenerate whenever the manifest is regenerated:
//
//   node tooling/web/generate_api_staff_references.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = await import(new URL("../../apps/timetrials-web/src/benchmark-manifest.ts", import.meta.url).href);
const staff = [150, 200].flatMap((mode) => manifest.benchmarksByKind("nintendo_staff", mode))
  .map((entry) => ({
    trackId: entry.trackId,
    mode: entry.mode,
    timeMs: entry.timeMs,
    name: entry.name,
    countryId: entry.countryId,
    loadout: {
      characterId: entry.loadout?.characterId ?? null,
      bodyId: entry.loadout?.bodyId ?? null,
      tireId: entry.loadout?.tireId ?? null,
      gliderId: entry.loadout?.gliderId ?? null,
    },
  }))
  .sort((a, b) => a.mode - b.mode || a.trackId.localeCompare(b.trackId));
if (staff.length !== 192) { throw new Error(`expected 192 staff times, found ${staff.length}`); }
const body = `// GENERATED FILE — do not edit by hand.
// Source: apps/timetrials-web/src/benchmark-manifest.ts (the Nintendo staff entries).
// Regenerate with tooling/web/generate_api_staff_references.mjs.

export type NintendoStaffReference = Readonly<{
  trackId: string;
  mode: 150 | 200;
  timeMs: number;
  name: string;
  countryId: string | null;
  loadout: Readonly<{ characterId: string | null; bodyId: string | null; tireId: string | null; gliderId: string | null }>;
}>;

export const NINTENDO_STAFF_REFERENCES: readonly NintendoStaffReference[] = ${JSON.stringify(staff, null, 1)};
`;
writeFileSync(`${root}backend/api/src/reference-ghosts/nintendo-staff-references.ts`, body);
console.log(`wrote ${staff.length} staff references`);
