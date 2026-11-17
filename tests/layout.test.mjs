// The layout helpers: boxes worked out from a page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canvas, cols, grid, inset, page, rows, take } from '../src/layout.ts';

test('a page is the canvas inside its margins, and each format has its own canvas', () => {
  assert.deepEqual(page('wide'), { x: 80, y: 80, w: 1120, h: 560 });
  assert.deepEqual(page('wide', { top: 200 }), { x: 80, y: 200, w: 1120, h: 440 });
  assert.deepEqual(canvas('tall'), { x: 0, y: 0, w: 720, h: 1280 });
  assert.deepEqual(canvas('square'), { x: 0, y: 0, w: 1080, h: 1080 });
});

test('columns and rows share the room by count or by weight, with the gap between them', () => {
  const area = { x: 100, y: 50, w: 620, h: 300 };
  assert.deepEqual(cols(area, 3, 10).map((c) => [c.x, c.w]), [[100, 200], [310, 200], [520, 200]]);
  assert.deepEqual(cols(area, [2, 1], 20).map((c) => [c.x, c.w]), [[100, 400], [520, 200]]);
  assert.deepEqual(rows(area, 2, 20).map((r) => [r.y, r.h]), [[50, 140], [210, 140]]);
  const cells = grid(area, 3, 2, 10);
  assert.equal(cells.length, 6);
  assert.deepEqual(cells[4], { x: 310, y: 205, w: 200, h: 145 });
});

test('inset and take cut a box down', () => {
  const area = { x: 100, y: 50, w: 600, h: 300 };
  assert.deepEqual(inset(area, 20), { x: 120, y: 70, w: 560, h: 260 });
  assert.deepEqual(take(area, 'bottom', 60), { x: 100, y: 290, w: 600, h: 60 });
  assert.deepEqual(take(area, 'right', 100), { x: 600, y: 50, w: 100, h: 300 });
});
