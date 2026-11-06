import assert from "node:assert/strict";
import test from "node:test";
import { locateOcrText } from "../src/lib/ocr-positioning.ts";

test("handwriting localization uses its OCR provider and keeps irregular word boxes", async () => {
  const signal = new AbortController().signal;
  const result = await locateOcrText({text: "Long word", dataUrl: "data:image/png;base64,test", signal,
    locate: async (input) => {
      assert.equal(input.signal, signal);
      assert.equal(input.dataUrl, "data:image/png;base64,test");
      assert.match(input.prompt, /one tight box per WORD/);
      assert.match(input.prompt, /Long word/);
      return '```json\n[{"box":[50,110,400,140],"text":"Long"},{"box":[490,120,580,150],"text":"word"}]\n```';
    }});
  assert.deepEqual(result, [
    {text: "Long", box: [0.05, 0.11, 0.4, 0.14]},
    {text: "word", box: [0.49, 0.12, 0.58, 0.15]},
  ]);
});

test("truncated localization cannot silently replace an entire page with its beginning", async () => {
  await assert.rejects(locateOcrText({text: "first second", dataUrl: "image", locate: async () =>
    '[{"box":[50,110,400,140],"text":"first"}, {"box":'}));
  await assert.rejects(locateOcrText({text: "text", dataUrl: "image", locate: async () => '[]'}), /no usable/);
});

test("cancelled positioning never starts an OCR request", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(locateOcrText({text: "text", dataUrl: "image", signal: controller.signal,
    locate: async () => { assert.fail("must not call provider"); }}), {name: "AbortError"});
});
