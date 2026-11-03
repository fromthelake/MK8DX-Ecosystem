import { expect, test } from '@playwright/test';
import { matchOwnerLapRows } from '../../../packages/icon-matcher/ts/sharedLapGrid';
import { removeWeakDuplicateLapIndex, removeWeakLapIndexOutlier, removeWeakOffLatticeLapIndex } from '../src/engine/lapIndexOutlier';

test('a duplicate seven-lap badge cannot shift the time rows', () => {
  const width = 1280;
  const height = 720;
  const grid = {
    anchor: { x: 0, y: 0 },
    lap_index_boxes_rel: [135.5, 167.5, 199.5, 231.5, 263.5, 295.5, 327.5]
      .map(y => [1014, y - 12, 1044, y + 12]),
  };
  const centers = [115, 149, 183, 217, 251, 251.8, 285, 319];
  const detections = centers.map((y, index) => ({
    label: 'lap_index',
    score: index === 5 ? 0.92 : 0.96,
    left: 1014 / width,
    right: 1044 / width,
    top: (y - 16) / height,
    bottom: (y + 16) / height,
  }));
  const used: number[] = [];
  const matches = matchOwnerLapRows(detections, grid, width, height, used);
  expect(matches.map(match => match.rowIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(matches.map(match => match.detIndex)).toEqual([0, 1, 2, 3, 4, 6, 7]);
  expect(used).not.toContain(5);
});

test('one weak duplicate lap badge is removed only for two complete three-row cards', () => {
  const ghost = { label: 'ghost_timetrail_box', score: 0.98,
    left: 0.2, right: 0.8, top: 0.1, bottom: 0.46 };
  const player = { label: 'player_timetrail_box', score: 0.99,
    left: 0.2, right: 0.8, top: 0.52, bottom: 0.9 };
  const badges = [0.22, 0.30, 0.38, 0.62, 0.70, 0.78].map((y) => ({
    label: 'lap_index', score: y === 0.38 ? 0.68 : 0.94,
    left: 0.62, right: 0.65, top: y - 0.02, bottom: y + 0.02,
  }));
  const duplicate = { ...badges[2], score: 0.39,
    top: badges[2].top + 0.001, bottom: badges[2].bottom + 0.001 };
  const input = [ghost, player, ...badges, duplicate];
  const result = removeWeakDuplicateLapIndex(input);
  expect(result.removed).toBe(duplicate);
  expect(result.detections).toEqual(input.filter((d) => d !== duplicate));
  expect(removeWeakDuplicateLapIndex(input.filter((d) => d !== ghost)).removed).toBeNull();
  expect(removeWeakDuplicateLapIndex([...input, badges[0]]).removed).toBeNull();
});

test('weak off-column seventh badge is excluded from a strong six-row screen', () => {
  const strong = [0.26, 0.34, 0.42, 0.65, 0.73, 0.81].map((y) => ({
    label: 'lap_index', score: 0.94, left: 0.62, right: 0.65,
    top: y - 0.02, bottom: y + 0.02,
  }));
  const weak = { label: 'lap_index', score: 0.33, left: 0.645, right: 0.665,
    top: 0.19, bottom: 0.23 };
  const owner = { label: 'player_timetrail_box', score: 0.99, left: 0.16,
    right: 0.84, top: 0.5, bottom: 0.9 };
  const result = removeWeakLapIndexOutlier([owner, ...strong, weak]);
  expect(result.removed).toBe(weak);
  expect(result.detections).toEqual([owner, ...strong]);

  const aligned = { ...weak, left: 0.625, right: 0.645 };
  expect(removeWeakLapIndexOutlier([owner, ...strong, aligned]).removed).toBeNull();
  expect(removeWeakLapIndexOutlier([owner, ...strong, { ...weak, score: 0.7 }]).removed).toBeNull();
});

test('two regular in-game three-lap rows reject one weak extra badge', () => {
  const player = { label: 'player_timetrail_box', score: 0.98,
    left: 0.18, right: 0.82, top: 0.10, bottom: 0.50 };
  const ghost = { label: 'ghost_timetrail_box', score: 0.97,
    left: 0.18, right: 0.82, top: 0.51, bottom: 0.91 };
  const badges = [0.26, 0.34, 0.42, 0.67, 0.75, 0.83].map((y) => ({
    label: 'lap_index', score: 0.91, left: 0.63, right: 0.66,
    top: y - 0.02, bottom: y + 0.02,
  }));
  const weak = { ...badges[4], score: 0.50, top: 0.77, bottom: 0.81 };
  const input = [player, ghost, ...badges, weak];
  expect(removeWeakOffLatticeLapIndex(input)).toEqual({
    detections: input.filter((d) => d !== weak), removed: weak,
  });
  expect(removeWeakOffLatticeLapIndex(input.filter((d) => d !== ghost)).removed).toBeNull();
  expect(removeWeakOffLatticeLapIndex([...input.filter((d) => d !== badges[2]),
    { ...badges[2], top: 0.38, bottom: 0.42 }]).removed).toBeNull();
  expect(removeWeakOffLatticeLapIndex([...input.filter((d) => d !== weak),
    { ...weak, score: 0.65 }]).removed).toBeNull();
});
