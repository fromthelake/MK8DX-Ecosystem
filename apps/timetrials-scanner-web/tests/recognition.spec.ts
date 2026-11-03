// Herkenningstests (eis §50): RESULT 3 / RESULT 7 / single-owner tegen de
// native referentie (testkit/reference), GHOST 3 / GHOST 7 tegen de native
// ghost-detail-uitkomsten (web/results/native_ghost_detail, APK op emulator).
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { decisionSummary, manifestFrames, openParity, referenceFor, runFrame, testkit, webRoot } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

// `present` lists the owners whose card is really in the frame. The native
// reference also holds icon guesses for an absent owner's empty card; the
// shared field reader (default since 0.2.0) must accept nothing there.
async function expectSameDecisions(page: any, id: string, file: string, present?: string[]) {
  const ref = await referenceFor(id);
  const web = await runFrame(page, file, 'endscreen');
  expect(web.status, web.message).toBe('valid_decode');
  expect(web.fields).toEqual(ref.fields);
  expect(web.lapSumOk).toBe(ref.lap_sum_ok);
  const refSum = decisionSummary(ref);
  const webSum = decisionSummary(web);
  for (const key of Object.keys(refSum)) {
    if (key === 'fields' || key === 'lap_sum_ok') continue;
    const r = refSum[key] as any;
    const w = webSum[key] as any;
    if (present && !present.includes(key.split('.')[0])) {
      expect(w?.ok ?? false, `${key} accepted on an absent card`).toBe(false);
      continue;
    }
    // The native reference numbers flags in its own, older table (there the Netherlands is 156, in
    // the current Clean Assets table 155), so a flag is compared by the country it names.
    if (key.endsWith('.flag') && r.name && w.name) {
      expect(w.name, `${key} name`).toBe(r.name);
      continue;
    }
    expect(w.id ?? w.index, `${key} id`).toBe(r.id ?? r.index);
  }
}

test('RESULT 3 laps (both owners): times + identities match native reference', async ({ page }) => {
  const frames = (await manifestFrames()).filter((f) => f.category === '3laps_both').slice(0, 2);
  for (const f of frames) await expectSameDecisions(page, f.id, path.join(testkit, 'frames', `${f.id}.jpg`));
});

test('RESULT 7 laps (Baby Park): times + identities match native reference', async ({ page }) => {
  const frames = (await manifestFrames()).filter((f) => f.category === '7laps_both').slice(0, 2);
  for (const f of frames) await expectSameDecisions(page, f.id, path.join(testkit, 'frames', `${f.id}.jpg`));
});

test('RESULT single owner (player only): no phantom ghost', async ({ page }) => {
  const frames = (await manifestFrames()).filter((f) => f.category === 'single_owner').slice(0, 1);
  for (const f of frames) {
    await expectSameDecisions(page, f.id, path.join(testkit, 'frames', `${f.id}.jpg`), f.owners);
    const web = await runFrame(page, path.join(testkit, 'frames', `${f.id}.jpg`), 'endscreen');
    expect(Object.keys(web.fields).some((k) => k.startsWith('ghost_'))).toBe(false);
  }
});

async function nativeGhost(name: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(webRoot, 'results', 'native_ghost_detail', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

test('GHOST 3 laps (Select-a-Ghost detail panel): total, laps, character, kart, tires, glider, flag, name', async ({ page }) => {
  const file = path.join(webRoot, 'testkit', 'frames_ghost', 'vlcsnap-2026-09-02-09h04m34s410.png');
  const web = await runFrame(page, file, 'ghost_detail');
  expect(web.status, web.message).toBe('valid_decode');
  expect(web.lapSumOk).toBe(true);
  expect(web.raceProfile).toBe('race3');
  // gedocumenteerde native uitkomst (docs/scanner-layouts.md §8)
  expect(web.fields).toEqual({ ghost_lap_1: '0:30.310', ghost_lap_2: '0:29.022', ghost_lap_3: '0:27.242', ghost_total: '1:26.574' });
  const g = web.kartConfig.owners.ghost;
  expect(g.character.id).toBe('character.dry_bowser');
  expect(g.kart.name).toBe('Mach 8');
  expect(g.wheel.name).toMatch(/Wood|Hout/);
  expect(g.glider.name).toMatch(/Cloud Glider|Wolkballonnen/);
  expect(g.flag.name).toBe('Netherlands');
  expect(web.kartConfig.owners.player).toBeUndefined();
  const native = await nativeGhost('vlcsnap-2026-09-02-09h04m34s410');
  if (native) {
    expect(web.fields).toEqual(native.fields);
    for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag']) {
      const n = native.kart_config.ghost[kind];
      expect(g[kind].id ?? g[kind].index).toBe(n.id ?? n.index);
    }
  }
});

test('GHOST 7 laps (Baby Park detail panel): 7 laps, race7 grid, identity', async ({ page }) => {
  const file = path.join(webRoot, 'testkit', 'frames_ghost', 'vlcsnap-2026-09-02-09h30m47s336.png');
  const web = await runFrame(page, file, 'ghost_detail');
  expect(web.status, web.message).toBe('valid_decode');
  expect(web.lapSumOk).toBe(true);
  expect(web.raceProfile).toBe('race7');
  expect(Object.keys(web.fields).filter((k) => k.startsWith('ghost_lap_')).length).toBe(7);
  expect(web.fields.ghost_total).toBe('0:50.566');
  const g = web.kartConfig.owners.ghost;
  expect(g.character.id).toBe('character.baby_luigi');
  expect(g.flag.name).toBe('Netherlands');
  const native = await nativeGhost('vlcsnap-2026-09-02-09h30m47s336');
  if (native) {
    expect(web.fields).toEqual(native.fields);
    for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag']) {
      const n = native.kart_config.ghost[kind];
      expect(g[kind].id ?? g[kind].index).toBe(n.id ?? n.index);
    }
  }
});

test('result validation: lap sum closes exactly for a locked result', async ({ page }) => {
  const frames = (await manifestFrames()).filter((f) => f.category === '3laps_both').slice(0, 1);
  const web = await runFrame(page, path.join(testkit, 'frames', `${frames[0].id}.jpg`), 'endscreen');
  const ms = (v: string) => parseInt(v[0], 10) * 60000 + parseInt(v.slice(2, 4), 10) * 1000 + parseInt(v.slice(5, 8), 10);
  for (const owner of ['player', 'ghost']) {
    const laps = [1, 2, 3].map((i) => ms(web.fields[`${owner}_lap_${i}`]));
    expect(laps.reduce((a, b) => a + b, 0)).toBe(ms(web.fields[`${owner}_total`]));
  }
  expect(web.lapSumOk).toBe(true);
});
