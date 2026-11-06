import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dictationPosition, DICTATION_WINDOW_SIZE, DICTATION_PILL_SIZE } from '../src/main/dictation-position';

test('pill sits above the caret, flips below at the top edge and stays visible on every monitor', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1280, y: -100, width: 1280, height: 1024 }]) {
    for (let i = 0; i < 1000; i++) {
      const caret = { x: area.x + i % area.width, y: area.y + (i * 23) % area.height, width: 1, height: 20 };
      const p = dictationPosition(caret, area);
      assert.ok(p.x + 8 >= area.x && p.y + 8 >= area.y);
      assert.ok(p.x + 8 + DICTATION_PILL_SIZE.width <= area.x + area.width);
      assert.ok(p.y + 8 + DICTATION_PILL_SIZE.height <= area.y + area.height);
    }
  }
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(dictationPosition({ x: 100, y: 100, width: 2, height: 20 }, area), { x: 45, y: 52 });
  assert.deepEqual(dictationPosition({ x: 100, y: 2, width: 2, height: 20 }, area), { x: 45, y: 22 });
  assert.deepEqual(DICTATION_WINDOW_SIZE, { width: 320, height: 100 });
  assert.deepEqual(DICTATION_PILL_SIZE, { width: 96, height: 32 });
});
