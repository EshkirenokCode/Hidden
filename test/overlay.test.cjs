const test = require('node:test');
const assert = require('node:assert/strict');
const { fitOverlay } = require('../electron/overlay-layout.cjs');
const area = { x: 0, y: 25, width: 1440, height: 875 };
test('overlay grows with content and keeps its full bounds on screen', () => {
  const bounds = { x: 900, y: 600, width: 620, height: 300 };
  const short = fitOverlay(bounds, area, 300);
  const long = fitOverlay(bounds, area, 600);
  assert.equal(short.bounds.height, 300);
  assert.equal(long.bounds.height, 600);
  assert.equal(long.limited, false);
  assert.ok(long.bounds.y + long.bounds.height <= 888);
  assert.ok(long.bounds.x + long.bounds.width <= 1428);
});
test('overlay caps huge answers and supports a display with negative coordinates', () => {
  const result = fitOverlay({ x: -100, y: -200, width: 620 }, { x: -1440, y: 0, width: 1440, height: 900 }, 10000);
  assert.equal(result.bounds.height, 876);
  assert.equal(result.limited, true);
  assert.ok(result.bounds.x + result.bounds.width <= -12);
  assert.equal(result.bounds.y, 12);
});
