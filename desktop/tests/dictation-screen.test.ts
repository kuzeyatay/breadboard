import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import type { DictationAnchor } from '../src/main/dictation-position';
import type { DictationScreen } from '../src/main/dictation-screen';

test('screen-aware dictation captures the caret monitor and maps its coordinates independently of DPI', async () => {
  let selectedId = 2, unavailable = false, empty = false;
  const requested: unknown[] = [], encoded: number[] = [];
  const displays = [
    { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, scaleFactor: 1.5, bounds: { x: -1280, y: -200, width: 1280, height: 720 } },
  ];
  const moduleExports: { captureDictationScreen?: (caret: DictationAnchor) => Promise<DictationScreen> } = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../dist/main/dictation-screen.js'), 'utf8'), {
    exports: moduleExports, require: (name: string) => {
      assert.equal(name, 'electron');
      return {
        screen: { getDisplayNearestPoint: () => displays.find(display => display.id === selectedId) },
        desktopCapturer: { getSources: async (options: unknown) => {
          requested.push(JSON.parse(JSON.stringify(options)));
          return displays.filter(display => !unavailable || display.id !== selectedId).map(display => ({
            display_id: String(display.id), thumbnail: {
              isEmpty: () => empty, getSize: () => ({ width: 1600, height: 900 }),
              toJPEG: (quality: number) => { assert.equal(quality, 80); encoded.push(display.id); return Buffer.from(`monitor-${display.id}`); },
            },
          }));
        } },
      };
    },
  });
  const capture = moduleExports.captureDictationScreen!;
  const secondary = await capture({ x: -960, y: 160, width: 1, height: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(secondary)), {
    dataUrl: `data:image/jpeg;base64,${Buffer.from('monitor-2').toString('base64')}`,
    width: 1600, height: 900, caret: { x: 250, y: 500 },
  });
  assert.deepEqual(encoded, [2], 'other monitors are never serialized for the model');
  assert.deepEqual(requested, [{ types: ['screen'], thumbnailSize: { width: 1600, height: 1600 } }]);
  selectedId = 1;
  const primary = await capture({ x: 960, y: 540, width: 1, height: 20 });
  assert.equal(primary.caret.x, 500); assert.equal(primary.caret.y, 500);
  unavailable = true;
  await assert.rejects(capture({ x: 0, y: 0, width: 1, height: 20 }), /could not capture/);
  unavailable = false; empty = true;
  await assert.rejects(capture({ x: 0, y: 0, width: 1, height: 20 }), /could not capture/);
  assert.deepEqual(encoded, [2, 1], 'missing or empty capture never falls back to the wrong screen');
});
