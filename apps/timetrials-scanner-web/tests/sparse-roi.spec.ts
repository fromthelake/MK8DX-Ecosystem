import { expect, test } from '@playwright/test';
import { AutoCardRoiSelector, Box } from '../src/engine/roi';

const width = 1920;
const height = 1080;
const badge = (y: number, score = 0.9) => ({
  label: 'lap_index', score,
  left: 1320 / width, right: 1360 / width,
  top: (y - 16) / height, bottom: (y + 16) / height,
});

test('sparse seven-lap dual recovery keeps the full lower yellow game card', () => {
  const yellow = new Box(800, 590, 1510, 900);
  const detections = [badge(510, 0.25), ...Array.from({ length: 7 }, (_, i) => badge(650 + i * 30))];
  const selected = new AutoCardRoiSelector().selectSparseDualYellowCandidate(
    detections, width, height, [yellow]);
  expect(selected?.candidate?.selectedRoute).toBe('lap_index_sparse_dual_yellow_candidate');
  expect(selected?.candidate?.playerLapIndexCount).toBe(7);
  expect(selected?.candidate?.ghostLapIndexCount).toBe(1);
  expect(selected?.roi?.top).toBeLessThan(yellow.top);
  expect(selected?.roi?.bottom).toBeGreaterThan(yellow.bottom);
});

test('sparse seven-lap dual recovery requires seven regular badges and yellow support', () => {
  const yellow = new Box(780, 300, 1510, 600);
  const player = Array.from({ length: 7 }, (_, i) => badge(350 + i * 30));
  const ghost = [badge(740, 0.25), badge(785, 0.24)];
  const selector = new AutoCardRoiSelector();
  const selected = selector.selectSparseDualYellowCandidate([...player, ...ghost], width, height, [yellow]);
  expect(selected?.candidate?.playerLapIndexCount).toBe(7);
  expect(selected?.candidate?.ghostLapIndexCount).toBe(2);
  expect(selector.selectSparseDualYellowCandidate([...player, ...ghost], width, height, [])).toBeNull();
  expect(selector.selectSparseDualYellowCandidate([...player.slice(1), ...ghost], width, height, [yellow])).toBeNull();
  expect(selector.selectSparseDualYellowCandidate([...player, ...ghost, badge(815)], width, height, [yellow])).toBeNull();
  expect(selector.selectSparseDualYellowCandidate([...player, ...ghost,
    { label: 'ghost_timetrail_box', score: 0.8, left: 0.4, top: 0.55, right: 0.8, bottom: 0.9 }],
  width, height, [yellow])).toBeNull();
});
