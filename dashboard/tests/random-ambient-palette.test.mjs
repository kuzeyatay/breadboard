import test from 'node:test';
import assert from 'node:assert/strict';
import { randomAmbientPalette } from '../src/lib/random-ambient-palette.ts';

test('random lighting shares a restrained color family while visiting the full hue wheel', () => {
  const families = new Set();
  for (let cycle = -1; cycle < 360; cycle++) {
    const colors = randomAmbientPalette(cycle);
    assert.deepEqual(colors, randomAmbientPalette(cycle), 'every tab gets the same time-seeded palette');
    const tones = colors.map(color => color.match(/[\d.]+/g).map(Number));
    assert.equal(tones.length, 3);
    for (const [hue, saturation, lightness] of tones) {
      const gap = Math.abs(hue - tones[0][0]);
      assert(Math.min(gap, 360 - gap) <= 11, 'all lights stay close to one main hue');
      assert(saturation >= 35 && saturation <= 55, 'avoid neon saturation');
      assert(lightness >= 45 && lightness <= 70, 'keep usable soft lighting tones');
    }
    families.add(Math.floor(tones[0][0] / 30) % 12);
  }
  assert.equal(families.size, 12, 'random scenes still explore the whole spectrum over time');
});
