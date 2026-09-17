import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  parseSpottingReply,
  spotPageTextLines,
} from "../src/lib/vlm-ocr/spotting.ts";
import { VLM_OCR_SPOTTING_PROMPT } from "../src/lib/vlm-ocr/prompts.ts";

describe("VLM text spotting", () => {
  test("reads a clean JSON reply into fractional boxes", () => {
    const lines = parseSpottingReply(
      JSON.stringify([
        { box: [100, 50, 900, 80], text: "Elektrik devreleri" },
        { box: [120, 100, 400, 130], text: "  Ohm  kanunu " },
      ]),
    );
    assert.deepEqual(lines, [
      { box: [0.1, 0.05, 0.9, 0.08], text: "Elektrik devreleri" },
      { box: [0.12, 0.1, 0.4, 0.13], text: "Ohm kanunu" },
    ]);
  });

  test("unwraps a fenced reply and drops junk entries", () => {
    const lines = parseSpottingReply(
      [
        "```json",
        "[",
        '  {"box": [0, 0, 1000, 1000], "text": "whole page"},',
        '  {"box": [10, 10, 10, 40], "text": "zero width"},',
        '  {"box": [300, 200, 500, 230], "text": ""},',
        '  {"box": [300, 200, 500, 230]},',
        '  {"box": [500, 230, 300, 200], "text": "flipped corners"},',
        "]",
        "```",
      ].join("\n"),
    );
    assert.deepEqual(lines, [
      { box: [0.3, 0.2, 0.5, 0.23], text: "flipped corners" },
    ]);
  });

  test("salvages complete objects from a reply cut off mid-array", () => {
    const lines = parseSpottingReply(
      '[{"box": [10, 20, 300, 40], "text": "first \\"quoted\\" line"}, {"box": [10, 50, 300, 70], "text": "second"}, {"box": [10, 80, 30',
    );
    assert.deepEqual(lines, [
      { box: [0.01, 0.02, 0.3, 0.04], text: 'first "quoted" line' },
      { box: [0.01, 0.05, 0.3, 0.07], text: "second" },
    ]);
  });

  test("returns nothing for prose that carries no boxes", () => {
    assert.deepEqual(parseSpottingReply("The page has no text."), []);
    assert.deepEqual(parseSpottingReply(""), []);
  });

  test("sends the upstream spotting prompt with the page image", async () => {
    const calls = [];
    const config = { baseUrl: "http://127.0.0.1:1/v1" };
    const lines = await spotPageTextLines({
      config,
      dataUrl: "data:image/png;base64,AAAA",
      runner: async (input) => {
        calls.push(input);
        return { text: '[{"box": [0, 0, 500, 50], "text": "hi"}]' };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, VLM_OCR_SPOTTING_PROMPT);
    assert.equal(calls[0].dataUrl, "data:image/png;base64,AAAA");
    assert.equal(calls[0].config, config);
    assert.deepEqual(lines, [{ box: [0, 0, 0.5, 0.05], text: "hi" }]);
  });
});
