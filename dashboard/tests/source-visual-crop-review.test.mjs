import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSourceVisuals, loadSourceVisuals } from "../src/lib/source-visuals.ts";
import { encodePng } from "../src/lib/png-crop.ts";
import {
  FIGURE_CROP_REVIEW_SYSTEM_PROMPT,
  cropEdgeInk,
  figureCropRenderBBox,
  figureCropReviewCacheKey,
  figureCropReviewReceiptMatches,
  parseFigureCropReviewResponse,
  tightFigureCropBBox,
} from "../src/lib/source-visual-crop-review.ts";

function whitePng(width, height, paint = () => {}) {
  const pixels = Buffer.alloc(width * height * 3, 255);
  paint((x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) pixels.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  });
  return encodePng({ width, height, channels: 3, colorType: 2, pixels });
}

function seedPage(root, garden) {
  const dir = path.join(root, garden, "assets", "pages");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "src-page-001.png"), whitePng(400, 300, (fill) => fill(60, 100, 160, 150)));
  return `/${garden}/assets/pages/src-page-001.png`;
}

const reply = (content) => ({ choices: [{ message: { content } }] });

test("crop edge ink flags only the sides that slice through printed content", () => {
  const cut = whitePng(200, 100, (fill) => fill(150, 40, 200, 60));
  assert.deepEqual(cropEdgeInk(cut), { top: false, right: true, bottom: false, left: false });
  const clean = whitePng(200, 100, (fill) => fill(60, 30, 140, 70));
  assert.deepEqual(cropEdgeInk(clean), { top: false, right: false, bottom: false, left: false });
});

test("a reviewed crop gets small padding instead of being widened into its neighbours", () => {
  const box = tightFigureCropBBox({ x: 0.47, y: 0.83, width: 0.1, height: 0.16 }, "diagram");
  assert.ok(box.width < 0.2, `width ${box.width}`);
  assert.ok(box.y + box.height <= 1);
});

test("crop review responses must cover every crop and give a box for clipped or misplaced crops", () => {
  assert.throws(
    () => parseFigureCropReviewResponse(JSON.stringify({ reviews: [{ crop: "crop-1", verdict: "clipped", reason: "cut" }] }), ["crop-1"]),
    /needs a valid in-page bbox/,
  );
  assert.throws(
    () => parseFigureCropReviewResponse(JSON.stringify({ reviews: [] }), ["crop-1"]),
    /omitted crop-1/,
  );
  const parsed = parseFigureCropReviewResponse(
    "I checked both crops.\n\n" + JSON.stringify({ reviews: [{ crop: "crop-1", verdict: "complete", reason: "whole figure" }] }),
    ["crop-1"],
  );
  assert.equal(parsed.get("crop-1").verdict, "complete");
});

test("figure crops are checked against the page: a corrected box wins, a rejected crop keeps later ids stable, and reruns reuse the review", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-visual-crop-review-"));
  const garden = "crop-review";
  const pageUrl = seedPage(root, garden);
  const calls = { detect: 0, review: 0 };
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          const system = String(request.messages[0].content);
          if (system === FIGURE_CROP_REVIEW_SYSTEM_PROMPT) {
            calls.review += 1;
            const payload = JSON.parse(request.messages[1].content[0].text);
            return reply(JSON.stringify({
              reviews: payload.crops.map((crop) => {
                if (crop.caption === "Portrait photo") {
                  return { crop: crop.crop, verdict: "not_on_page", reason: "there is no photo on this page" };
                }
                if (crop.caption === "Markov chain" && payload.round === 1) {
                  return {
                    crop: crop.crop,
                    verdict: "wrong_region",
                    bbox: { x: 0.14, y: 0.32, width: 0.28, height: 0.2 },
                    reason: "the chain sits lower on the page than the crop",
                  };
                }
                return { crop: crop.crop, verdict: "complete", reason: "the whole visual is inside the crop" };
              }),
            }));
          }
          calls.detect += 1;
          return reply(JSON.stringify([
            { type: "figure", caption: "Portrait photo", bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.3 } },
            { type: "diagram", caption: "Markov chain", bbox: { x: 0.14, y: 0.05, width: 0.28, height: 0.2 } },
            { type: "graph", caption: "Blocking probability graph", bbox: { x: 0.1, y: 0.6, width: 0.5, height: 0.3 } },
          ]));
        },
      },
    },
  };
  const options = {
    client,
    model: "m",
    contentPath: root,
    gardenSlug: garden,
    sourceId: "src",
    sourceIndex: 1,
    pageImageUrls: [pageUrl],
    reviewFigureCrops: true,
  };
  try {
    await extractSourceVisuals(options);
    const ledger = loadSourceVisuals(root, garden);
    assert.deepEqual(ledger.map((visual) => visual.sourceVisualId).sort(), ["S1.P1.F2", "S1.P1.G1"]);
    const chain = ledger.find((visual) => visual.sourceVisualId === "S1.P1.F2");
    assert.deepEqual(chain.bbox, { x: 0.14, y: 0.32, width: 0.28, height: 0.2 });
    assert.equal(chain.cropReview.status, "corrected");
    assert.deepEqual(chain.cropReview.detectorBBox, { x: 0.14, y: 0.05, width: 0.28, height: 0.2 });
    const graph = ledger.find((visual) => visual.sourceVisualId === "S1.P1.G1");
    assert.equal(graph.cropReview.status, "approved");
    for (const visual of ledger) {
      assert.ok(fs.existsSync(path.join(root, ...visual.croppedImagePath.split("/").slice(1))), visual.croppedImagePath);
    }
    assert.deepEqual(calls, { detect: 1, review: 2 });

    await extractSourceVisuals(options);
    assert.deepEqual(calls, { detect: 1, review: 2 }, "a rerun reuses the saved scan and crop review");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extraction without the review option never calls the crop reviewer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-visual-crop-review-off-"));
  const garden = "crop-review-off";
  const pageUrl = seedPage(root, garden);
  let reviews = 0;
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          if (String(request.messages[0].content) === FIGURE_CROP_REVIEW_SYSTEM_PROMPT) reviews += 1;
          return reply(JSON.stringify([{ type: "diagram", caption: "Markov chain", bbox: { x: 0.14, y: 0.05, width: 0.28, height: 0.2 } }]));
        },
      },
    },
  };
  try {
    await extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: [pageUrl] });
    assert.equal(reviews, 0);
    assert.equal(loadSourceVisuals(root, garden)[0].cropReview, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a crop review whose transport gives up keeps the detector crop unreviewed instead of failing the run", async () => {
  const { reviewFigureCropsOnPage } = await import("../src/lib/source-visual-crop-review.ts");
  const page = whitePng(400, 300, (fill) => fill(60, 100, 160, 150));
  let calls = 0;
  const receipt = await reviewFigureCropsOnPage({
    model: "m",
    pageImage: page,
    pageFingerprint: "fp",
    pageNumber: 21,
    candidates: [{ detectionIndex: 0, type: "diagram", caption: "Chain", bbox: { x: 0.1, y: 0.3, width: 0.3, height: 0.2 } }],
    complete: async () => { calls += 1; return ""; },
  });
  assert.equal(calls, 1, "an empty transport fallback is not retried by the reviewer");
  assert.equal(receipt.outcomes[0].status, "unreviewed");
  assert.deepEqual(receipt.outcomes[0].bbox, { x: 0.1, y: 0.3, width: 0.3, height: 0.2 });
});

test("a saved crop review applies on a later pass without the review flag, so rejected crops stay out", async () => {
  // Live 2026-09-16: planning (review on) rejected two crops; generation
  // (review off) replayed the cached detections and re-added them, so the
  // artifact inventory no longer matched the confirmed Learning Map.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-visual-crop-review-replay-"));
  const garden = "crop-review-replay";
  const pageUrl = seedPage(root, garden);
  let reviews = 0;
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          if (String(request.messages[0].content) === FIGURE_CROP_REVIEW_SYSTEM_PROMPT) {
            reviews += 1;
            const payload = JSON.parse(request.messages[1].content[0].text);
            return reply(JSON.stringify({ reviews: payload.crops.map((crop) => crop.caption === "Portrait photo"
              ? { crop: crop.crop, verdict: "not_on_page", reason: "no photo here" }
              : { crop: crop.crop, verdict: "complete", reason: "whole figure" }) }));
          }
          return reply(JSON.stringify([
            { type: "figure", caption: "Portrait photo", bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.3 } },
            { type: "graph", caption: "Blocking probability graph", bbox: { x: 0.1, y: 0.6, width: 0.5, height: 0.3 } },
          ]));
        },
      },
    },
  };
  const base = { client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: [pageUrl] };
  try {
    await extractSourceVisuals({ ...base, reviewFigureCrops: true });
    assert.deepEqual(loadSourceVisuals(root, garden).map((v) => v.sourceVisualId), ["S1.P1.G1"]);
    // Generation's path: the cached scan is replayed without the review flag.
    await extractSourceVisuals(base);
    assert.deepEqual(loadSourceVisuals(root, garden).map((v) => v.sourceVisualId), ["S1.P1.G1"], "a cached replay must keep the rejection");
    // A forced re-scan of the unchanged page keeps the saved review too.
    await extractSourceVisuals({ ...base, force: true });
    assert.deepEqual(loadSourceVisuals(root, garden).map((v) => v.sourceVisualId), ["S1.P1.G1"], "the rejected crop must not come back");
    assert.equal(reviews, 1, "the saved review is reused, not re-requested");
    // Generation on a different model than the reviewer still replays the verdict.
    await extractSourceVisuals({ ...base, model: "other", force: true });
    assert.deepEqual(loadSourceVisuals(root, garden).map((v) => v.sourceVisualId), ["S1.P1.G1"], "a verdict from another model must still apply on replay");
    assert.equal(reviews, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a reviewer-supplied box is cropped verbatim, so a correction can converge", () => {
  // The reviewer corrects a crop whose top edge sliced the running header, so
  // its box starts just below that header. Padding the correction puts the
  // header back, the next round reports the same defect and returns the same
  // box, and the detection is dropped at round exhaustion (telecom-1,
  // 2026-09-21: two Sauter tables died this way and failed the completeness
  // gate). A detector box still gets its pad - nothing has vetted it.
  const corrected = { x: 0.136, y: 0.103, width: 0.738, height: 0.674 };

  assert.deepEqual(figureCropRenderBBox(corrected, "table", true), corrected);

  const padded = figureCropRenderBBox(corrected, "table", false);
  assert.deepEqual(padded, tightFigureCropBBox(corrected, "table"));
  assert.ok(padded.y < corrected.y, "padding a correction reaches back up into the header it excluded");
});

test("a v1 review is reused unless it carries the verdict the padding bug caused", () => {
  // Re-reviewing every cached page costs ~2 min per model call across hundreds
  // of pages. Approved and corrected v1 outcomes were verified against the
  // exact crop they describe and are rendered the way they were approved, so
  // they stay reusable. A rejected outcome is the one the padded loop could
  // not converge out of, so that page is re-reviewed under v2.
  const bbox = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
  const candidates = [{ detectionIndex: 0, type: "table", caption: "Table 1.1", bbox }];
  const receipt = (version, status) => ({
    version,
    cacheKey: "k",
    model: "m",
    outcomes: [{ detectionIndex: 0, status, bbox, reason: "r", rounds: status === "approved" ? 1 : 2 }],
    modelCalls: 1,
  });

  assert.equal(figureCropReviewReceiptMatches(receipt(1, "approved"), "k", candidates), true);
  assert.equal(figureCropReviewReceiptMatches(receipt(1, "corrected"), "k", candidates), true);
  assert.equal(figureCropReviewReceiptMatches(receipt(2, "corrected"), "k", candidates), true);

  const rejected = { version: 1, cacheKey: "k", model: "m", modelCalls: 3,
    outcomes: [{ detectionIndex: 0, status: "rejected", reason: "slices the running header", rounds: 3 }] };
  assert.equal(figureCropReviewReceiptMatches(rejected, "k", candidates), false,
    "a v1 rejection is re-reviewed under the fixed geometry");
  assert.equal(figureCropReviewReceiptMatches({ ...rejected, version: 2 }, "k", candidates), true,
    "a v2 rejection was already judged with verbatim crops and stands");
});

test("an unparseable crop review keeps the detector crop instead of failing the run", async () => {
  // A transport that returns nothing already degrades to "unreviewed". A
  // malformed answer is the same condition and must not be worse: throwing
  // discarded a whole run mid-pass (telecom-1, 2026-09-21, page 4).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crop-badjson-"));
  try {
    const page = whitePng(600, 800, (fill) => fill(60, 80, 520, 300));
    const pagePath = path.join(dir, "page-001.png");
    fs.writeFileSync(pagePath, page);
    const { reviewFigureCropsOnPage } = await import("../src/lib/source-visual-crop-review.ts");
    const result = await reviewFigureCropsOnPage({
      pageImage: page,
      pageNumber: 4,
      pageFingerprint: "fp",
      model: "m",
      candidates: [{ detectionIndex: 0, type: "table", caption: "Table 1.1", bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.3 } }],
      complete: async () => "I cannot return JSON for this page.",
    });
    const outcome = result.outcomes.find((o) => o.detectionIndex === 0);
    assert.equal(outcome.status, "unreviewed", "the page degrades instead of throwing");
    assert.ok(outcome.bbox, "the detector crop is kept");
    assert.match(outcome.reason, /no valid response/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reuse keeps a verdict from another model but still binds everything else", () => {
  // Cache keys bind a verdict to its authoring model, so a transport change
  // re-reviews the whole garden (telecom-1, 2026-09-22: ~5 hours for 210
  // pages). With reuse on, the saved verdict is checked against the key its
  // OWN author would have produced, so prompt version, page bytes and
  // candidate boxes must still match exactly.
  const bbox = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
  const candidates = [{ detectionIndex: 0, type: "table", caption: "Table 1.1", bbox }];
  const keyFor = (model) => figureCropReviewCacheKey({ model, pageFingerprint: "fp-1", candidates });
  const receipt = {
    version: 2,
    cacheKey: keyFor("openaiweb/gpt-5-6-thinking"),
    model: "openaiweb/gpt-5-6-thinking",
    outcomes: [{ detectionIndex: 0, status: "approved", bbox, reason: "complete", rounds: 1 }],
    modelCalls: 1,
  };

  // Default: a different model does not match, so the page is re-reviewed.
  assert.notEqual(keyFor("gpt-5.6-sol"), receipt.cacheKey);
  assert.equal(figureCropReviewReceiptMatches(receipt, keyFor("gpt-5.6-sol"), candidates), false);

  // Reuse: check against the author's own key, which matches.
  assert.equal(figureCropReviewReceiptMatches(receipt, keyFor(receipt.model), candidates), true);

  // Reuse never relaxes the other bindings: a changed page still re-reviews.
  const movedPage = figureCropReviewCacheKey({ model: receipt.model, pageFingerprint: "fp-2", candidates });
  assert.equal(figureCropReviewReceiptMatches(receipt, movedPage, candidates), false);
  const movedBox = figureCropReviewCacheKey({
    model: receipt.model,
    pageFingerprint: "fp-1",
    candidates: [{ ...candidates[0], bbox: { ...bbox, y: 0.4 } }],
  });
  assert.equal(figureCropReviewReceiptMatches(receipt, movedBox, candidates), false);
});

test("a reusable v1 receipt matches the key it was written under", () => {
  // The matcher accepts rejection-free v1 receipts, but the key hashed the
  // current version, so none ever matched. Live 2026-09-23: all 54 v1
  // receipts in telecom-1's scan cache were silently ignored on replay.
  const bbox = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
  const candidates = [{ detectionIndex: 0, type: "figure", caption: "Fig. 1", bbox }];
  const key = (version) => figureCropReviewCacheKey({ model: "m", pageFingerprint: "fp", candidates, version });
  const receipt = {
    version: 1,
    cacheKey: key(1),
    model: "m",
    outcomes: [{ detectionIndex: 0, status: "approved", bbox, reason: "complete", rounds: 1 }],
    modelCalls: 1,
  };
  assert.notEqual(key(undefined), key(1));
  assert.equal(figureCropReviewReceiptMatches(receipt, key(receipt.version), candidates), true);
  assert.equal(figureCropReviewReceiptMatches({ ...receipt, version: 2 }, key(2), candidates), false);
});
