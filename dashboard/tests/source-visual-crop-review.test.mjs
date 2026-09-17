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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
