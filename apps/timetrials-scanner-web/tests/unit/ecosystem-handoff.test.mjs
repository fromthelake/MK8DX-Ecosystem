// The Web handoff from the central scan result (CENTRAL_RECOGNITION section 8.6, phase 4).
//   node --experimental-strip-types tests/unit/ecosystem-handoff.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../../../../packages/icon-matcher/ts/ts_resolve_hook.mjs', import.meta.url);

globalThis.__MK8_WEB_VERSION__ = 'test';
const { buildEcosystemHandoff, idTableFromFieldIndex } = await import('../../src/app/ecosystem.ts');

const request = { trackId: 'track.mario_kart_stadium', mode: 150, storageKey: 'k', returnHref: '/x', lapCount: 3, layout: null };
const result = (fields, identity = {}, layout = 'endscreen') => ({
  locked: true, acceptPath: 'direct_lap_som', layout, lockedFrameIndex: 0, fields, identity, frames: [],
});
const laps = { player_total: '1:23.456', player_lap_1: '0:27.000', player_lap_2: '0:28.000', player_lap_3: '0:28.456' };

test('closing laps, accepted parts, trimmed name', () => {
  const out = buildEcosystemHandoff(request, result(laps, { player: {
    character: { id: 'character.mario', score: 0.912345, ok: true },
    kart: { id: 'body.standard_kart', score: 0.7, ok: true },
    wheel: { index: 3, score: 0.5, ok: false },
    card_name: ' Lake ',
  } }));
  assert.equal(out.totalDigits, '123456');
  assert.deepEqual(out.laps, ['027000', '028000', '028456']);
  assert.equal(out.characterId, 'character.mario');
  assert.equal(out.bodyId, 'body.standard_kart');
  assert.equal(out.tireIndex, undefined);
  assert.equal(out.observedPlayerName, 'Lake');
  assert.deepEqual(out.confidence, { character: 0.9123, body: 0.7 });
  assert.deepEqual(out.doubt, ['loadout.bodyId']);
  assert.equal(out.lapSumMatches, true);
});

test('an open lap sum asks the player to check every lap', () => {
  const out = buildEcosystemHandoff(request, result({ ...laps, player_total: '1:23.457' }));
  assert.equal(out.lapSumMatches, false);
  assert.deepEqual(out.doubt, ['laps[0].timeDigits', 'laps[1].timeDigits', 'laps[2].timeDigits']);
});

test('a ghost panel with an unreadable middle lap keeps the lap places', () => {
  const out = buildEcosystemHandoff(request, result({ ghost_total: '1:23.456', ghost_lap_1: '0:27.000', ghost_lap_3: '0:28.456' }, {}, 'ghost_detail'));
  assert.deepEqual(out.laps, ['027000', '', '028456']);
  assert.equal(out.layout, 'ghost_detail');
  assert.equal(out.lapSumMatches, undefined);
});

test('no readable total, no handoff', () => {
  assert.equal(buildEcosystemHandoff(request, result({ player_total: '1:63.000' })), null);
});

test('tyre and flag positions become catalog IDs through the field index (ADR-0215)', () => {
  const ids = idTableFromFieldIndex({ schema: 'mk8dx.scanner-field-index.v1', tires: { 'tire.monster': 1 }, flags: { 'country.nl': 155 } });
  const out = buildEcosystemHandoff(request, result(laps, { player: {
    wheel: { index: 1, score: 0.9, ok: true }, flag: { index: 155, score: 0.95, ok: true },
  } }), ids);
  assert.equal(out.tireId, 'tire.monster');
  assert.equal(out.tireIndex, 1);
  assert.equal(out.countryId, 'country.nl');
  assert.deepEqual(out.confidence, { tire: 0.9, country: 0.95 });
  assert.equal(idTableFromFieldIndex({ schema: 'other' }), null);
});
