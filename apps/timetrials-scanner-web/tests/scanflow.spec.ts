// Scan-flow-tests (eis §50): schone scan, lastig beeld/deep loop, falen,
// STOP, voortgangssemantiek, realignPartColors, lokalisatie.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { manifestFrames, openParity, scanFrames, testkit, webRoot } from './helpers';

test.describe.configure({ mode: 'serial' });

const scratch = path.join(webRoot, 'test-results', 'scratch');

async function blackFrame(): Promise<string> {
  await fs.mkdir(scratch, { recursive: true });
  const file = path.join(scratch, 'black.png');
  // 1x1 zwarte PNG (geen kaart, geen detecties) -> geen lock
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(file, png);
  return file;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

test('clean scan: lock on first frame via direct_lap_som, identity-only extra frames, Finish', async ({ page }) => {
  const f = (await manifestFrames()).filter((x) => x.category === '3laps_both')[0];
  const file = path.join(testkit, 'frames', `${f.id}.jpg`);
  const { result, events } = await scanFrames(page, [file, file, file, file, file], 'endscreen');
  expect(result.locked).toBe(true);
  expect(result.acceptPath).toBe('direct_lap_som');
  expect(result.lockedFrameIndex).toBe(0);
  expect(result.fields).toEqual(f.gt.player ? expect.objectContaining({ player_total: f.gt.player.total }) : result.fields);
  // stemframes: na de lock identity-only, vroege stop bij unanimiteit (max 1+3)
  expect(result.frames.length).toBeGreaterThanOrEqual(2);
  expect(result.frames.length).toBeLessThanOrEqual(4);
  expect(result.frames[1].kartConfig).not.toBeNull();
  // voortgang: hoofdbalk monotoon, eindigt op finish=1.0 met success
  let last = 0;
  for (const e of events) {
    expect(e.overallProgress).toBeGreaterThanOrEqual(last - 1e-9);
    last = e.overallProgress;
  }
  const finish = events[events.length - 1];
  expect(finish.phase).toBe('finish');
  expect(finish.success).toBe(true);
  expect(finish.overallProgress).toBe(1);
  // fase-volgorde zoals de APK: card -> slots -> read -> setup -> confirm
  const phases = [...new Set(events.map((e) => e.phase))];
  expect(phases.slice(0, 4)).toEqual(['card', 'slots', 'read', 'setup']);
  expect(phases).toContain('confirm');
  // per-frame voortgang reset per poging en telt naar 100
  const frame1 = events.filter((e) => e.attemptIndex === 1 && !e.identityOnly).map((e) => e.frameProgress);
  expect(frame1[0]).toBe(0);
  expect(Math.max(...frame1)).toBeGreaterThanOrEqual(90);
  const frame2 = events.filter((e) => e.attemptIndex === 2);
  expect(frame2[0].frameProgress).toBe(0);
  expect(frame2[0].identityOnly).toBe(true);
});

test('difficult image / deep loop: unreadable first frame is reported, second frame locks', async ({ page }) => {
  const f = (await manifestFrames()).filter((x) => x.category === '3laps_both')[0];
  const good = path.join(testkit, 'frames', `${f.id}.jpg`);
  const bad = await blackFrame();
  const { result, events } = await scanFrames(page, [bad, good, good, good, good], 'endscreen');
  expect(result.locked).toBe(true);
  expect(result.lockedFrameIndex).toBe(1);
  expect(result.frames[0].status).toBe('blocked');
  expect(result.frames[0].firstBlockingStage).toBe('01_AutoCardROI');
  // vanaf poging 2 draagt de voortgang de "beeld is lastig"-vlag (poging x/y)
  const attempt2 = events.filter((e) => e.attemptIndex === 2 && !e.identityOnly);
  expect(attempt2.length).toBeGreaterThan(0);
  expect(attempt2.every((e) => e.difficultFrame)).toBe(true);
  expect(attempt2[0].attemptCount).toBe(5);
  expect(events.filter((e) => e.attemptIndex === 1).every((e) => !e.difficultFrame)).toBe(true);
});

test('failure: no lock after all frames -> honest failure, no guessed values', async ({ page }) => {
  const bad = await blackFrame();
  const { result, events } = await scanFrames(page, [bad, bad, bad, bad, bad], 'endscreen');
  expect(result.locked).toBe(false);
  expect(result.fields).toEqual({});
  expect(result.identity).toEqual({});
  const last = events[events.length - 1];
  expect(last.phase).toBe('failed');
  expect(last.failure).toBe(true);
  expect(last.success).toBe(false);
  expect(result.framesAnalyzed).toBe(5);
});

test('STOP cancels: no result after stop, next scan works', async ({ page }) => {
  const f = (await manifestFrames()).filter((x) => x.category === '3laps_both')[0];
  const file = path.join(testkit, 'frames', `${f.id}.jpg`);
  const stopped = await scanFrames(page, [file, file, file, file, file], 'endscreen', 300);
  expect(stopped.result.stopped).toBe(true);
  expect(stopped.result.locked).toBe(false);
  expect(stopped.result.fields).toEqual({});
  expect(stopped.events.some((e) => e.success)).toBe(false);
  // scan -> stop -> scan opnieuw
  const again = await scanFrames(page, [file, file, file, file, file], 'endscreen');
  expect(again.result.stopped).toBe(false);
  expect(again.result.locked).toBe(true);
});

test('realignPartColors: kart/glider colour variant follows the corrected character (v0.4.1)', async ({ page }) => {
  const realign = (owner: any, charId: string) => page.evaluate(({ owner, charId }) => (window as any).mk8Parity.realign(owner, charId), { owner, charId });
  // referentiegeval 2025062717541000: Toad + City Tripper -> orange variant moet blauw worden
  const out1 = await realign({ kart: { id: 'body_variant.city_tripper.005_orange', name: 'City Tripper (orange)', ok: true, evidence: 'clean_assets+text_ocr' } }, 'character.toad');
  expect((out1 as any).kart.id).toBe('body_variant.city_tripper.001_blue');
  expect((out1 as any).kart.color_realigned_from).toBe('body_variant.city_tripper.005_orange');
  expect((out1 as any).kart.evidence).toBe('clean_assets+text_ocr+char_color_realign');
  // al de juiste variant -> no-op
  const out2 = await realign({ kart: { id: 'body_variant.city_tripper.001_blue', ok: true } }, 'character.toad');
  expect((out2 as any).kart.color_realigned_from).toBeUndefined();
  // niet-variant (geen kleurset) -> no-op
  const out3 = await realign({ kart: { id: 'body.master_cycle_zero', ok: true } }, 'character.toad');
  expect((out3 as any).kart.id).toBe('body.master_cycle_zero');
  // glider volgt ook (pack: character.toad -> glider_variant.super_glider.035_toad)
  const out4 = await realign({ glider: { id: 'glider_variant.super_glider.000_black', ok: true } }, 'character.toad');
  expect((out4 as any).glider.id).toBe('glider_variant.super_glider.035_toad');
  expect((out4 as any).glider.color_realigned_from).toBe('glider_variant.super_glider.000_black');
  // character zonder glider-kleurset (Mario) -> variant blijft staan (rid == base -> no-op)
  const out5 = await realign({ glider: { id: 'glider_variant.super_glider.000_black', ok: true } }, 'character.mario');
  expect((out5 as any).glider.id).toBe('glider_variant.super_glider.000_black');
});

test('localization: EN and NL strings, no mixed UI keys', async ({ page }) => {
  const keys = ['aim', 'burst', 'no_lock', 'ph_card', 'ph_slots', 'ph_read', 'ph_setup', 'ph_confirm', 'ph_finish', 'ph_attempt', 'ph_hard', 'won_by', 'lost_by', 'lap', 'you', 'ghost', 'checked_sum', 'captured', 'layout_endscreen', 'layout_ghost', 'stopped'];
  const en = await page.evaluate((keys) => { const i = (window as any).mk8Parity.i18n; i.setLanguage('en'); return Object.fromEntries(keys.map((k: string) => [k, i.t(k)])); }, keys);
  const nl = await page.evaluate((keys) => { const i = (window as any).mk8Parity.i18n; i.setLanguage('nl'); return Object.fromEntries(keys.map((k: string) => [k, i.t(k)])); }, keys);
  expect(en.ph_attempt).toBe('attempt');
  expect(nl.ph_attempt).toBe('poging');
  expect(nl.ph_hard).toBe('beeld is lastig');
  expect(en.ph_hard).toBe('tricky image');
  expect(nl.ph_card).toBe('Kaart zoeken…');
  expect(en.no_lock).toContain('scan again');
  expect(nl.no_lock).toContain('scan opnieuw');
  for (const k of keys) {
    expect(en[k], k).not.toBe(k); // geen ontbrekende sleutel
    expect(nl[k], k).not.toBe(k);
  }
  const others = await page.evaluate((keys) => { const i = (window as any).mk8Parity.i18n; const out: any = {}; for (const c of ['de', 'fr', 'es', 'it']) { i.setLanguage(c); out[c] = keys.map((k: string) => i.t(k)); } return out; }, keys);
  for (const c of ['de', 'fr', 'es', 'it']) expect(others[c].every((v: string) => v && v.length > 0)).toBe(true);
});
