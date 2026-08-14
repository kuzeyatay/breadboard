import test from "node:test";
import assert from "node:assert/strict";
import { decodePng, encodePng, resizePngToMaxDimension } from "../src/lib/png-crop.ts";

test("resizePngToMaxDimension reduces vision payloads while preserving aspect ratio", () => {
  const width = 1400;
  const height = 1736;
  const original = encodePng({
    width,
    height,
    channels: 3,
    colorType: 2,
    pixels: Buffer.alloc(width * height * 3, 255),
  });

  const resized = resizePngToMaxDimension(original, 768);
  assert.ok(resized);
  const decoded = decodePng(resized);
  assert.ok(decoded);
  assert.equal(Math.max(decoded.width, decoded.height), 768);
  assert.ok(Math.abs(decoded.width / decoded.height - width / height) < 0.002);
  assert.ok(resized.length < original.length);
});
