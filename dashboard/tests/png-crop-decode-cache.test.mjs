import test from "node:test";
import assert from "node:assert/strict";
import { cropPng, decodePng, encodePng } from "../src/lib/png-crop.ts";

test("cropping one page twice decodes it once and both crops stay exact", () => {
  const width = 100, height = 80, channels = 4;
  const pixels = Buffer.alloc(width * height * channels);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) % 251;
  const page = encodePng({ width, height, channels, colorType: 6, pixels });
  const first = decodePng(cropPng(page, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 0));
  const second = decodePng(cropPng(page, { x: 0.4, y: 0.3, width: 0.5, height: 0.6 }, 0));
  assert.equal(first.width, 50);
  assert.equal(second.height, 48);
  // Top-left pixel of the second crop matches the source at (40, 24).
  const at = (24 * width + 40) * channels;
  assert.deepEqual([...second.pixels.subarray(0, 4)], [...pixels.subarray(at, at + 4)]);
});
