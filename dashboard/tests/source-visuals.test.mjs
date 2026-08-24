import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import {
  DEFAULT_SOURCE_FORMULA_REVIEW_TIMEOUT_MS,
  MAX_SOURCE_FORMULA_REVIEW_TIMEOUT_MS,
  MIN_SOURCE_FORMULA_REVIEW_TIMEOUT_MS,
  SOURCE_FORMULA_REVIEW_FINAL_ATTEMPT_ALLOWANCE_MS,
  SOURCE_FORMULA_REVIEW_SCHEDULING_MARGIN_MS,
  ensureSourcePdfPageSnapshots,
  loadSourceVisuals,
  recordSourceVisualAssignments,
  reviewRequiredSourceFormulaExactText,
  resolveSourceVisualSourceIdentityMap,
  saveSourceFormulaReviewSetManifest,
  saveSourceVisuals,
  sourceSetHashWithReviewedFormulas,
  sourceVisualCachedPageImageUrls,
  sourceVisualSourceIdentityMapHash,
  sourceVisualSourceIdentityMapPath,
  sourceFormulaTopologyReviewPageReceipts,
  sourceFormulaReviewTimeoutMs,
  extractSourceVisuals,
  validateSourceFormulaReviewSet,
} from "../src/lib/source-visuals.ts";
import { encodePng } from "../src/lib/png-crop.ts";
import { attachLearnTokenUsageTracking } from "../src/lib/learn-token-usage.ts";

/** Write N page-snapshot PNGs and return their garden-relative URLs. */
function seedPageImages(contentPath, garden, count) {
  const dir = path.join(contentPath, garden, "assets", "pages");
  fs.mkdirSync(dir, { recursive: true });
  const urls = [];
  for (let i = 1; i <= count; i += 1) {
    const name = `src-page-${String(i).padStart(3, "0")}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    urls.push(`/${garden}/assets/pages/${name}`);
  }
  return urls;
}

function fakeClient(create) {
  return { chat: { completions: { create } } };
}

test("formula-review logical timeout covers the full bounded transport schedule", () => {
  const requiredDefault =
    SOURCE_FORMULA_REVIEW_FINAL_ATTEMPT_ALLOWANCE_MS +
    SOURCE_FORMULA_REVIEW_SCHEDULING_MARGIN_MS;

  assert.equal(DEFAULT_SOURCE_FORMULA_REVIEW_TIMEOUT_MS, requiredDefault);
  assert.equal(sourceFormulaReviewTimeoutMs(""), requiredDefault);
  assert.equal(sourceFormulaReviewTimeoutMs("45000"), 45_000);
  assert.equal(sourceFormulaReviewTimeoutMs("1"), MIN_SOURCE_FORMULA_REVIEW_TIMEOUT_MS);
  assert.equal(
    sourceFormulaReviewTimeoutMs(String(MAX_SOURCE_FORMULA_REVIEW_TIMEOUT_MS + 1)),
    MAX_SOURCE_FORMULA_REVIEW_TIMEOUT_MS,
  );
});

function validDetection(overrides = {}) {
  return {
    type: "figure",
    caption: "Source figure",
    bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    ...overrides,
  };
}

function solidPng(red = 220) {
  const width = 120;
  const height = 160;
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = red;
    pixels[offset + 1] = 240;
    pixels[offset + 2] = 250;
  }
  return encodePng({ width, height, channels: 3, colorType: 2, pixels });
}

function seedFormulaReviewGarden(root, garden, pages = [1]) {
  const gardenDir = path.join(root, garden);
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(gardenDir, "assets", "src-source.pdf"), Buffer.from("stable pdf bytes"));
  fs.writeFileSync(
    path.join(gardenDir, "sources", "src.md"),
    [
      "---",
      `source_pdf: \"/${garden}/assets/src-source.pdf\"`,
      "---",
      "",
      ...pages.flatMap((pageNumber) => [
        `## Page ${pageNumber}`,
        `Corroborating page text for formula ${pageNumber}: $x_${pageNumber}=1$`,
        "",
      ]),
    ].join("\n"),
  );
  const visuals = pages.map((pageNumber) => ({
    sourceVisualId: `S1.P${pageNumber}.E1`,
    sourceId: "src",
    pageNumber,
    type: "equation",
    caption: `Untrusted formula ${pageNumber}`,
    exactText: `x_${pageNumber}=0`,
    pageImagePath: `/${garden}/assets/src-page-${String(pageNumber).padStart(3, "0")}.png`,
    bbox: { x: 0.2, y: 0.35, width: 0.5, height: 0.12 },
    usageStatus: "unused",
  }));
  saveSourceVisuals(root, garden, visuals);
  return visuals;
}

function acceptedReview(sourceVisualId, pageNumber, action = "replace") {
  return {
    sourceVisualId,
    action,
    acceptedExactText: action === "approve" ? `x_${pageNumber}=0` : `x_${pageNumber}=1`,
    acceptedCaption: action === "approve"
      ? `Untrusted formula ${pageNumber}`
      : `Verified formula ${pageNumber}`,
    identityAssessment: "preserved",
    reason: "The full PDF page render and labeled crop show the complete displayed equality.",
  };
}

function recoveredApproval(sourceVisualId, exactText, caption) {
  return {
    sourceVisualId,
    action: "approve",
    acceptedExactText: exactText,
    acceptedCaption: caption,
    identityAssessment: "preserved",
    reason: "The fresh full-page PDF render and the labeled crop show this complete displayed equation.",
  };
}

function ordinaryReviewerReplacement(sourceVisualId, exactText, caption) {
  return {
    sourceVisualId,
    action: "replace",
    acceptedExactText: exactText,
    acceptedCaption: caption,
    identityAssessment: "preserved",
    reason: "The independent formula reviewer used the complete PDF page and labeled crop to refine the visible transcription.",
  };
}

function recoveryFixture(root, garden) {
  const [seed] = seedFormulaReviewGarden(root, garden, [1]);
  const first = {
    ...seed,
    // Recovery must preserve opaque formula slots, not renumber them from E1.
    sourceVisualId: "S1.P1.E2",
  };
  const second = {
    ...first,
    sourceVisualId: "S1.P1.E4",
    caption: "Stale second formula crop",
    exactText: "y=0",
    bbox: { x: 0.18, y: 0.26, width: 0.42, height: 0.1 },
  };
  saveSourceVisuals(root, garden, [first, second]);
  const pageUrl = `/${garden}/assets/src-page-001.png`;
  const pagePath = path.join(root, garden, "assets", "src-page-001.png");
  const staleSnapshot = solidPng(15);
  const freshPage = solidPng(205);
  fs.writeFileSync(pagePath, staleSnapshot);
  return { pageUrl, pagePath, freshPage, staleSnapshot };
}

function identityMismatchReviews() {
  return {
    reviews: [
      {
        sourceVisualId: "S1.P1.E2",
        action: "reject",
        identityAssessment: "identity_mismatch",
        topologyAssessment: "same_slot",
        reason: "The labeled crop is a section heading rather than the first complete displayed equation.",
      },
      {
        sourceVisualId: "S1.P1.E4",
        action: "reject",
        identityAssessment: "identity_mismatch",
        topologyAssessment: "same_slot",
        reason: "The labeled crop is running prose rather than the second complete displayed equation.",
      },
    ],
  };
}

function recoveredWholePageResponse() {
  return {
    detections: [
      {
        type: "figure",
        caption: "Recovered source figure",
        bbox: { x: 0.06, y: 0.06, width: 0.46, height: 0.2 },
      },
      {
        type: "equation",
        caption: "Recovered first equality",
        exactText: "a=1",
        bbox: { x: 0.1, y: 0.4, width: 0.7, height: 0.11 },
      },
      {
        type: "equation",
        caption: "Recovered second equality",
        exactText: "b=2",
        bbox: { x: 0.18, y: 0.68, width: 0.52, height: 0.16 },
      },
    ],
    formulaReplacements: [
      {
        sourceVisualId: "S1.P1.E2",
        caption: "Recovered first equality",
        exactText: "a=1",
        bbox: { x: 0.1, y: 0.4, width: 0.7, height: 0.11 },
      },
      {
        // Deliberately preserve non-contiguous slots to prove v4 replay does
        // not call generic nextId and renumber them from E1/E2.
        sourceVisualId: "S1.P1.E4",
        caption: "Recovered second equality",
        exactText: "b=2",
        bbox: { x: 0.18, y: 0.68, width: 0.52, height: 0.16 },
      },
    ],
  };
}

function singleSlotIdentityMismatch(sourceVisualId, pageNumber) {
  return {
    reviews: [{
      sourceVisualId,
      action: "reject",
      identityAssessment: "identity_mismatch",
      topologyAssessment: "same_slot",
      reason: `The supplied page ${pageNumber} crop identifies a neighboring visual, not this complete displayed equation.`,
    }],
  };
}

function singleSlotRecoveredWholePage(sourceVisualId, pageNumber) {
  const caption = `Recovered page ${pageNumber} equality`;
  const exactText = `r_${pageNumber}=1`;
  const bbox = { x: 0.14, y: 0.62, width: 0.58, height: 0.11 };
  return {
    detections: [
      {
        type: "figure",
        caption: `Recovered page ${pageNumber} figure`,
        bbox: { x: 0.05, y: 0.06, width: 0.42, height: 0.18 },
      },
      {
        type: "equation",
        caption,
        exactText,
        bbox,
      },
    ],
    formulaReplacements: [{
      sourceVisualId,
      caption,
      exactText,
      bbox,
    }],
  };
}

function topologyFixture(root, garden, count = 5) {
  seedFormulaReviewGarden(root, garden, [1]);
  const old = Array.from({ length: count }, (_, index) => ({
    sourceVisualId: `S1.P1.E${index + 1}`,
    sourceId: "src",
    pageNumber: 1,
    type: "equation",
    caption: `Stale topology slot ${index + 1}`,
    exactText: `z_${index + 1}=0`,
    pageImagePath: `/${garden}/assets/src-page-001.png`,
    bbox: {
      x: 0.08,
      y: 0.08 + index * 0.13,
      width: 0.5 + (index % 2) * 0.07,
      height: 0.09,
    },
    usageStatus: "unused",
  }));
  saveSourceVisuals(root, garden, old);
  const pageUrl = `/${garden}/assets/src-page-001.png`;
  const pagePath = path.join(root, garden, "assets", "src-page-001.png");
  const stalePage = solidPng(33);
  const freshPage = solidPng(204);
  fs.writeFileSync(pagePath, stalePage);
  return { old, pageUrl, pagePath, stalePage, freshPage };
}

function topologySlot(sourceVisualId, index, priorSourceVisualIds) {
  return {
    sourceVisualId,
    caption: `Topology equation ${sourceVisualId.split(".").pop()}`,
    exactText: `t_${sourceVisualId.split("E").pop()}=${index + 1}`,
    // Distinct expanded crops even against a solid test image.
    bbox: {
      x: 0.06 + (index % 2) * 0.03,
      y: 0.08 + index * 0.16,
      width: 0.5 + index * 0.06,
      height: 0.075 + index * 0.012,
    },
    priorSourceVisualIds,
  };
}

function topologyRecoveryResponse(activeFormulaSlots, priorSlotResolutions, { figure = true } = {}) {
  return {
    detections: [
      ...(figure ? [{
        type: "figure",
        caption: "Topology recovery figure",
        bbox: { x: 0.05, y: 0.02, width: 0.38, height: 0.08 },
      }] : []),
      ...activeFormulaSlots.map((slot) => ({
        type: "equation",
        caption: slot.caption,
        exactText: slot.exactText,
        bbox: slot.bbox,
      })),
    ],
    activeFormulaSlots,
    priorSlotResolutions,
  };
}

function topologyRejectReviews(old, topologyIndex = 0) {
  return {
    reviews: old.map((visual, index) => ({
      sourceVisualId: visual.sourceVisualId,
      action: "reject",
      identityAssessment: "identity_mismatch",
      topologyAssessment: index === topologyIndex ? "topology_change" : "same_slot",
      reason: index === topologyIndex
        ? "The full page shows that this old slot has changed formula topology."
        : "The labeled crop no longer identifies its supplied formula slot.",
    })),
  };
}

function topologyConfirmation(priorSlotResolutions) {
  return {
    status: "confirmed",
    reason: "The complete high-resolution page confirms the supplied active formula inventory and old-slot graph.",
    priorSlotResolutions: priorSlotResolutions.map((resolution) => ({
      ...resolution,
      reason: "The complete page visibly confirms this exact old-slot relation.",
    })),
  };
}

function approvalsForTopologyInputs(inputs) {
  return {
    reviews: inputs.map((input) => recoveredApproval(
      input.sourceVisualId,
      input.inputExactText,
      input.inputCaption,
    )),
  };
}

function localGardenAsset(root, garden, url) {
  return path.join(root, garden, ...url.slice(`/${garden}/`.length).split("/"));
}

/** Add an unrelated formula after an accepted review to force the production
 * full-ledger re-review path that source-map discovery uses. */
function appendLateFormulaPage(root, garden, pageNumber = 2) {
  const visual = {
    sourceVisualId: `S1.P${pageNumber}.E1`,
    sourceId: "src",
    pageNumber,
    type: "equation",
    caption: `Late untrusted formula ${pageNumber}`,
    exactText: `q_${pageNumber}=0`,
    pageImagePath: `/${garden}/assets/src-page-${String(pageNumber).padStart(3, "0")}.png`,
    bbox: { x: 0.16, y: 0.42, width: 0.58, height: 0.12 },
    usageStatus: "unused",
  };
  fs.writeFileSync(localGardenAsset(root, garden, visual.pageImagePath), solidPng(140 + pageNumber));
  fs.appendFileSync(
    path.join(root, garden, "sources", "src.md"),
    `\n## Page ${pageNumber}\nLate canonical formula $q_${pageNumber}=1$\n`,
  );
  saveSourceVisuals(root, garden, [...loadSourceVisuals(root, garden), visual]);
  return visual;
}

test("recordSourceVisualAssignments splits formula concept usage from crop status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-visuals-"));
  try {
    const garden = "garden";
    fs.mkdirSync(path.join(root, garden), { recursive: true });
    saveSourceVisuals(root, garden, [
      {
        sourceVisualId: "S1.P6.E3",
        sourceId: "src",
        pageNumber: 6,
        type: "equation",
        caption: "Total spike count summed over neurons and time steps",
        usageStatus: "unused",
      },
    ]);

    const [visual] = recordSourceVisualAssignments(
      root,
      garden,
      new Map(),
      () => "formula taught from source markdown",
      { conceptAnchorIds: ["S1.P6.E3"] },
    );

    assert.equal(visual.usageStatus, "assigned");
    assert.equal(visual.conceptUsage, "explained_as_text_formula");
    assert.equal(visual.cropStatus, "omitted_unreliable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordSourceVisualAssignments preserves the current model-authored omission reason, never a stale canned reason", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-visual-reason-"));
  try {
    const garden = "garden";
    fs.mkdirSync(path.join(root, garden), { recursive: true });
    saveSourceVisuals(root, garden, [{
      sourceVisualId: "S1.P4.F1",
      sourceId: "src",
      pageNumber: 4,
      type: "figure",
      caption: "Field direction",
      usageStatus: "intentionally_skipped",
      skipReason: "Not central to any confirmed subsection of this learning map.",
    }]);

    const exactReason = "Its arrow convention conflicts with the convention selected for the lesson.";
    const [visual] = recordSourceVisualAssignments(
      root,
      garden,
      new Map(),
      () => exactReason,
      { trackedArtifactIds: ["S1.P4.F1"] },
    );
    assert.equal(visual.skipReason, exactReason);

    assert.throws(
      () => recordSourceVisualAssignments(
        root,
        garden,
        new Map(),
        () => "",
        { trackedArtifactIds: ["S1.P4.F1"] },
      ),
      /no model-authored assignment or omission reason/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals surfaces a model failure instead of silently reporting no figures", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-fail-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 5);
    // Preserve a prior good extraction from a different source across the failure.
    saveSourceVisuals(root, garden, [
      { sourceVisualId: "S9.P1.F1", sourceId: "other", pageNumber: 1, type: "figure", caption: "kept", usageStatus: "unused" },
    ]);

    let calls = 0;
    const providerFailure = new Error("502 Bad Gateway");
    const client = fakeClient(async () => {
      calls += 1;
      throw providerFailure;
    });

    await assert.rejects(
      () => extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls }),
      (error) => error === providerFailure,
    );
    assert.equal(calls, 1, "one provider failure must stop the scan without replay");
    // The prior good ledger entry is preserved (not wiped by the failed run).
    const ledger = JSON.parse(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json"), "utf-8"));
    assert.deepEqual(ledger.map((v) => v.sourceVisualId), ["S9.P1.F1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source visual detection preserves ambiguous provider failures after one create", async () => {
  const failures = [
    new Error("Connection error.", {
      cause: Object.assign(new Error("socket reset after request write"), {
        code: "ECONNRESET",
      }),
    }),
    Object.assign(new Error("Request timed out."), {
      name: "APIConnectionTimeoutError",
    }),
    Object.assign(new Error("Request was aborted."), {
      name: "AbortError",
      code: "ABORT_ERR",
    }),
    Object.assign(new Error("HTTP 502 without a request receipt"), {
      status: 502,
    }),
    new Error("Response ended prematurely after partial output"),
  ];

  for (const [index, providerFailure] of failures.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `bb-extract-ambiguous-${index}-`));
    try {
      const [page] = seedPageImages(root, "garden", 1);
      let calls = 0;
      const usageEvents = [];
      const client = fakeClient(async () => {
        calls += 1;
        throw providerFailure;
      });
      attachLearnTokenUsageTracking(client, (event) => usageEvents.push(event));

      await assert.rejects(
        () => extractSourceVisuals({
          client,
          model: "model-generic",
          contentPath: root,
          gardenSlug: "garden",
          sourceId: "source-generic",
          sourceIndex: 1,
          pageImageUrls: [page],
        }),
        (error) => error === providerFailure,
      );
      assert.equal(calls, 1);
      assert.deepEqual(usageEvents.map(({ type }) => type), ["started", "completed"]);
      assert.equal(usageEvents[1].usage, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("extractSourceVisuals treats a successful empty detection as genuinely no figures (no throw)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-empty-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 2);
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return { choices: [{ message: { content: "[]" } }] };
    });
    const found = await extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls });
    assert.deepEqual(found, []);
    assert.equal(calls, 2);

    // Empty pages are completed work too: a second run reuses their scan cache.
    const retried = await extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls });
    assert.deepEqual(retried, []);
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const invalid of [
  { name: "missing response content", content: undefined },
  { name: "malformed JSON", content: "not-json" },
  { name: "the wrong top-level shape", content: '{"detections":[]}' },
  {
    name: "a mixed valid and invalid detection array",
    content: JSON.stringify([validDetection(), { ...validDetection({ caption: "Invalid type" }), type: "logo" }]),
  },
  {
    name: "an invalid thirteenth entry after twelve valid detections",
    content: JSON.stringify([
      ...Array.from({ length: 12 }, (_, index) => validDetection({ caption: `Valid ${index + 1}` })),
      { ...validDetection({ caption: "Invalid thirteenth entry" }), type: "logo" },
    ]),
  },
  {
    name: "an equation without exactText",
    content: JSON.stringify([validDetection({ type: "equation", caption: "Unreadable equation" })]),
  },
  {
    name: "an out-of-page bbox",
    content: JSON.stringify([validDetection({ bbox: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 } })]),
  },
  {
    name: "a missing bbox",
    content: JSON.stringify([{ type: "figure", caption: "No location" }]),
  },
]) {
  test(`extractSourceVisuals rejects ${invalid.name} without caching an empty or partial scan`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-invalid-protocol-"));
    try {
      const garden = "garden";
      const [page] = seedPageImages(root, garden, 1);
      const invalidClient = fakeClient(async () => ({
        choices: [{ message: { ...(invalid.content === undefined ? {} : { content: invalid.content }) } }],
      }));

      await assert.rejects(
        () => extractSourceVisuals({
          client: invalidClient,
          model: "m",
          contentPath: root,
          gardenSlug: garden,
          sourceId: "src",
          sourceIndex: 1,
          pageImageUrls: [page],
        }),
        /Source visual detection protocol error/s,
      );
      const cachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
      assert.equal(fs.existsSync(cachePath), false, "an invalid response must not create a scan cache entry");

      let retryCalls = 0;
      const validClient = fakeClient(async () => {
        retryCalls += 1;
        return { choices: [{ message: { content: "[]" } }] };
      });
      assert.deepEqual(await extractSourceVisuals({
        client: validClient,
        model: "m",
        contentPath: root,
        gardenSlug: garden,
        sourceId: "src",
        sourceIndex: 1,
        pageImageUrls: [page],
      }), []);
      assert.equal(retryCalls, 1, "Retry must call the detector again instead of reusing an invalid scan");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("extractSourceVisuals preserves every valid detection beyond the old first-12 cap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-more-than-twelve-"));
  try {
    const garden = "garden";
    const [page] = seedPageImages(root, garden, 1);
    const detections = Array.from({ length: 13 }, (_, index) =>
      validDetection({ caption: `Source figure ${index + 1}` }));
    const client = fakeClient(async () => ({
      choices: [{ message: { content: JSON.stringify(detections) } }],
    }));

    const found = await extractSourceVisuals({
      client,
      model: "m",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [page],
    });

    assert.equal(found.length, 13);
    const thirteenth = found.find((visual) => visual.sourceVisualId === "S1.P1.F13");
    assert.equal(thirteenth?.caption, "Source figure 13");
    const cache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    assert.equal(cache.sources.src[page].detections.length, 13);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("equation detections require and preserve the model-authored exact LaTeX transcription", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-equation-text-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 1);
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return {
        choices: [{
          message: {
            content: JSON.stringify([{
              type: "equation",
              caption: "Gauss's law",
              exactText: "\\nabla \\cdot \\mathbf{D} = \\rho_v",
              bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.15 },
            }]),
          },
        }],
      };
    });

    const found = await extractSourceVisuals({
      client,
      model: "m",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: urls,
    });

    assert.equal(calls, 1);
    assert.deepEqual(found.map((visual) => visual.sourceVisualId), ["S1.P1.E1"]);
    assert.equal(found[0].exactText, "\\nabla \\cdot \\mathbf{D} = \\rho_v");
    assert.equal(loadSourceVisuals(root, garden)[0].exactText, "\\nabla \\cdot \\mathbf{D} = \\rho_v");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals resumes after a failed page without rescanning completed pages", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-resume-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 2);
    let firstPageCalls = 0;
    let secondPageCalls = 0;
    const providerFailure = new Error("Connection error.");
    const interruptedClient = fakeClient(async (request) => {
      const imageUrl = request.messages[1].content[0].image_url.url;
      assert.equal(request.messages[1].content[0].image_url.detail, "low");
      assert.match(imageUrl, /^data:image\/png;base64,/);
      if (firstPageCalls === 0) {
        firstPageCalls += 1;
        return {
          choices: [{
            message: {
              content: JSON.stringify([{
                type: "diagram",
                caption: "Coordinate system",
                bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
              }]),
            },
          }],
        };
      }
      secondPageCalls += 1;
      throw providerFailure;
    });

    await assert.rejects(
      () => extractSourceVisuals({ client: interruptedClient, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls }),
      (error) => error === providerFailure,
    );
    assert.equal(firstPageCalls, 1);
    assert.equal(secondPageCalls, 1);

    let retryCalls = 0;
    const retryClient = fakeClient(async () => {
      retryCalls += 1;
      return { choices: [{ message: { content: "[]" } }] };
    });
    const result = await extractSourceVisuals({ client: retryClient, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls });
    assert.equal(result.length, 1);
    assert.equal(result[0].caption, "Coordinate system");
    assert.equal(retryCalls, 1, "only the interrupted second page should be requested again");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals scans every supplied page when no explicit cap is set", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-all-pages-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 45);
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return { choices: [{ message: { content: "[]" } }] };
    });

    const found = await extractSourceVisuals({
      client,
      model: "m",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: urls,
    });

    assert.deepEqual(found, []);
    assert.equal(calls, 45, "the old implicit 40-page cutoff must not return");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractSourceVisuals adds a newly supplied page without losing an existing page", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-incremental-"));
  try {
    const garden = "garden";
    const [pageOne, pageTwo] = seedPageImages(root, garden, 2);
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return {
        choices: [{
          message: {
            content: JSON.stringify([{
              type: "figure",
              caption: calls === 1 ? "First-page figure" : "Second-page figure",
              bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
            }]),
          },
        }],
      };
    });

    const first = await extractSourceVisuals({
      client,
      model: "m",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageOne],
    });
    assert.deepEqual(first.map((visual) => visual.sourceVisualId), ["S1.P1.F1"]);

    const second = await extractSourceVisuals({
      client,
      model: "m",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageTwo],
    });
    assert.deepEqual(second.map((visual) => visual.sourceVisualId), ["S1.P1.F1", "S1.P2.F1"]);
    assert.deepEqual(
      loadSourceVisuals(root, garden).map((visual) => visual.caption),
      ["First-page figure", "Second-page figure"],
    );
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ensureSourcePdfPageSnapshots reuses canonical page assets without reopening the PDF", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pdf-page-cache-"));
  try {
    const garden = "garden";
    const assetDir = path.join(root, garden, "assets");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "textbook-page-003.png"), Buffer.from("page 3"));
    fs.writeFileSync(path.join(assetDir, "textbook-page-041.png"), Buffer.from("page 41"));

    const urls = await ensureSourcePdfPageSnapshots({
      contentPath: root,
      gardenSlug: garden,
      sourceId: "Textbook",
      // Deliberately absent: a complete cache hit must not reopen the PDF.
      sourcePdfUrl: `/${garden}/assets/textbook-source.pdf`,
      pageNumbers: [41, 3, 41],
    });
    assert.deepEqual(urls, [
      `/${garden}/assets/textbook-page-041.png`,
      `/${garden}/assets/textbook-page-003.png`,
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ensureSourcePdfPageSnapshots renders a requested page beyond the eager page-24 cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pdf-late-page-"));
  try {
    const garden = "garden";
    const assetsDir = path.join(root, garden, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const pdf = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => {
      pdf.once("end", resolve);
      pdf.once("error", reject);
    });
    for (let pageNumber = 1; pageNumber <= 25; pageNumber += 1) {
      pdf.addPage({ size: [320, 240], margin: 24 });
      pdf.fontSize(18).text(`Source page ${pageNumber}`);
    }
    pdf.end();
    await finished;
    const pdfPath = path.join(assetsDir, "book-source.pdf");
    fs.writeFileSync(pdfPath, Buffer.concat(chunks));

    const urls = await ensureSourcePdfPageSnapshots({
      contentPath: root,
      gardenSlug: garden,
      sourceId: "book",
      sourcePdfUrl: `/${garden}/assets/book-source.pdf`,
      pageNumbers: [25],
    });

    assert.deepEqual(urls, [`/${garden}/assets/book-page-025.png`]);
    const png = fs.readFileSync(path.join(assetsDir, "book-page-025.png"));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ensureSourcePdfPageSnapshots rejects a source PDF path outside the garden", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pdf-page-safe-path-"));
  try {
    const garden = "garden";
    fs.mkdirSync(path.join(root, garden), { recursive: true });
    await assert.rejects(
      () => ensureSourcePdfPageSnapshots({
        contentPath: root,
        gardenSlug: garden,
        sourceId: "textbook",
        sourcePdfUrl: `/${garden}/../outside.pdf`,
        pageNumbers: [1],
      }),
      /missing or is outside this garden/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a later plan rehydrates rollback-surviving AI page scans before semantic planning", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-visual-rehydrate-"));
  try {
    const garden = "garden";
    const assetPath = path.join(root, garden, "assets", "src-page-047.png");
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, solidPng());
    const pageUrl = `/${garden}/assets/src-page-047.png`;
    let initialCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        initialCalls += 1;
        return { choices: [{ message: { content: JSON.stringify([validDetection({
          type: "equation",
          caption: "Late discovered equation",
          exactText: "z=47",
        })]) } }] };
      }),
      model: "vision-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(initialCalls, 1);
    assert.deepEqual(loadSourceVisuals(root, garden).map((visual) => visual.sourceVisualId), [
      "S1.P47.E1",
    ]);

    // Simulate planning rollback: the semantic ledger projection is restored,
    // while the inert, content-fingerprinted AI scan cache and page asset remain.
    saveSourceVisuals(root, garden, []);
    const survivingPages = sourceVisualCachedPageImageUrls(root, garden, "src");
    assert.deepEqual(survivingPages, [pageUrl]);
    let retryCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        retryCalls += 1;
        throw new Error("matching cached AI scan should be reprojected without another call");
      }),
      model: "vision-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: survivingPages,
    });
    assert.equal(retryCalls, 0);
    assert.deepEqual(loadSourceVisuals(root, garden).map((visual) => visual.sourceVisualId), [
      "S1.P47.E1",
    ]);

    saveSourceVisuals(root, garden, []);
    fs.writeFileSync(assetPath, solidPng(90));
    assert.deepEqual(sourceVisualCachedPageImageUrls(root, garden, "src"), [pageUrl]);
    let staleFingerprintCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        staleFingerprintCalls += 1;
        return { choices: [{ message: { content: JSON.stringify([validDetection({
          type: "equation",
          caption: "Redetected equation after page bytes changed",
          exactText: "z=48",
        })]) } }] };
      }),
      model: "vision-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: sourceVisualCachedPageImageUrls(root, garden, "src"),
    });
    assert.equal(staleFingerprintCalls, 1);
    assert.equal(loadSourceVisuals(root, garden)[0].exactText, "z=48");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("garden-global source slots survive A+B to B-only and B-only to A+B selections", async () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-index-ab-b-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-index-b-ab-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-index-review-cache-"));
  try {
    const garden = "garden";
    fs.mkdirSync(path.join(firstRoot, garden, "sources"), { recursive: true });
    fs.mkdirSync(path.join(firstRoot, garden, "assets"), { recursive: true });
    fs.writeFileSync(path.join(firstRoot, garden, "assets", "b-source.pdf"), "stable b pdf");
    fs.writeFileSync(
      path.join(firstRoot, garden, "sources", "b.md"),
      `---\nsource_pdf: "/${garden}/assets/b-source.pdf"\n---\n\n## Page 1\nB formula.\n`,
    );
    const initial = resolveSourceVisualSourceIdentityMap({
      contentPath: firstRoot,
      gardenSlug: garden,
      sourceIds: ["a", "b"],
      persist: true,
    });
    assert.deepEqual(initial, [
      { sourceId: "a", sourceIndex: 1 },
      { sourceId: "b", sourceIndex: 2 },
    ]);
    saveSourceVisuals(firstRoot, garden, [{
      sourceVisualId: "S2.P1.E1",
      sourceId: "b",
      pageNumber: 1,
      type: "equation",
      caption: "Untrusted formula 1",
      exactText: "x_1=0",
      pageImagePath: `/${garden}/assets/b-page-001.png`,
      bbox: { x: 0.2, y: 0.35, width: 0.5, height: 0.12 },
      usageStatus: "unused",
    }]);
    const bOnly = resolveSourceVisualSourceIdentityMap({
      contentPath: firstRoot,
      gardenSlug: garden,
      sourceIds: ["b"],
      persist: true,
    });
    assert.deepEqual(bOnly, initial);
    let calls = 0;
    const reviewed = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => {
        calls += 1;
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S2.P1.E1", 1)],
        }) } }] };
      }),
      model: "review-model",
      contentPath: firstRoot,
      gardenSlug: garden,
      selectedSourceIds: ["b"],
      sourceIdentityMap: bOnly,
      requiredFormulaIds: ["S2.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    assert.equal(calls, 1);
    assert.deepEqual(reviewed.formulaIds, ["S2.P1.E1"]);
    const baseSourceSetHash = "b".repeat(64);
    saveSourceFormulaReviewSetManifest(firstRoot, garden, {
      schemaVersion: 1,
      promptVersion: 2,
      model: "review-model",
      sourceIds: ["b"],
      sourceIdentityMap: bOnly,
      sourceIdentityMapHash: sourceVisualSourceIdentityMapHash(bOnly),
      formulaIds: ["S2.P1.E1"],
      topologyReviewPageReceipts: reviewed.topologyReviewPageReceipts,
      reviewSetHash: reviewed.reviewedFormulaSetHash,
      baseSourceSetHash,
      combinedSourceSetHash: sourceSetHashWithReviewedFormulas(
        baseSourceSetHash,
        reviewed.reviewedFormulaSetHash,
      ),
      createdAt: "2026-08-15T12:00:00.000Z",
    });
    const validationOptions = {
      contentPath: firstRoot,
      gardenSlug: garden,
      requiredFormulaIds: ["S2.P1.E1"],
      expectedReviewSetHash: reviewed.reviewedFormulaSetHash,
      expectedModel: "review-model",
      expectedSourceIds: ["b"],
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    fs.rmSync(sourceVisualSourceIdentityMapPath(firstRoot, garden));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /Durable source identity registry is missing/,
    );

    fs.mkdirSync(path.join(secondRoot, garden), { recursive: true });
    const freshBOnly = resolveSourceVisualSourceIdentityMap({
      contentPath: secondRoot,
      gardenSlug: garden,
      sourceIds: ["b"],
      persist: true,
    });
    assert.deepEqual(freshBOnly, [{ sourceId: "b", sourceIndex: 1 }]);
    saveSourceVisuals(secondRoot, garden, [{
      sourceVisualId: "S1.P1.F1",
      sourceId: "b",
      pageNumber: 1,
      type: "figure",
      caption: "B figure",
      usageStatus: "unused",
    }]);
    const expanded = resolveSourceVisualSourceIdentityMap({
      contentPath: secondRoot,
      gardenSlug: garden,
      sourceIds: ["a", "b"],
      persist: true,
    });
    assert.deepEqual(expanded, [
      { sourceId: "b", sourceIndex: 1 },
      { sourceId: "a", sourceIndex: 2 },
    ]);
    saveSourceVisuals(secondRoot, garden, [
      ...loadSourceVisuals(secondRoot, garden),
      {
        sourceVisualId: "S2.P1.F1",
        sourceId: "a",
        pageNumber: 1,
        type: "figure",
        caption: "A figure",
        usageStatus: "unused",
      },
    ]);
    assert.deepEqual(
      resolveSourceVisualSourceIdentityMap({
        contentPath: secondRoot,
        gardenSlug: garden,
        sourceIds: ["a", "b"],
      }),
      expanded,
    );
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("stable source-slot allocation fails closed on a corrupt existing visual ledger", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-index-corrupt-"));
  try {
    const garden = "garden";
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, "{not-json");
    assert.throws(
      () => resolveSourceVisualSourceIdentityMap({
        contentPath: root,
        gardenSlug: garden,
        sourceIds: ["a"],
        persist: true,
      }),
      /ledger is unreadable while resolving stable source identities/,
    );
    assert.equal(fs.existsSync(sourceVisualSourceIdentityMapPath(root, garden)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI formula review projects exactText, caption, and a fresh PDF-render crop with durable audit provenance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const rendered = solidPng();
    const requests = [];
    const client = fakeClient(async (request, requestOptions) => {
      requests.push(request);
      assert.equal(requestOptions.maxRetries, 0);
      return {
        choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S1.P1.E1", 1)],
        }) } }],
      };
    });
    const result = await reviewRequiredSourceFormulaExactText({
      client,
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      now: () => "2026-08-15T12:00:00.000Z",
      renderPdfPage: async ({ sourcePdf, pageNumber }) => {
        assert.equal(sourcePdf.toString(), "stable pdf bytes");
        assert.equal(pageNumber, 1);
        return rendered;
      },
    });

    assert.equal(result.modelCalls, 1);
    assert.deepEqual(result.newlyReplacedFormulaIds, ["S1.P1.E1"]);
    const [reviewed] = loadSourceVisuals(root, garden);
    assert.equal(reviewed.exactText, "x_1=1");
    assert.equal(reviewed.caption, "Verified formula 1");
    assert.equal(reviewed.formulaReview.inputExactText, "x_1=0");
    assert.equal(reviewed.formulaReview.acceptedExactText, "x_1=1");
    assert.equal(reviewed.formulaReview.inputCaption, "Untrusted formula 1");
    assert.equal(reviewed.formulaReview.acceptedCaption, "Verified formula 1");
    assert.equal(reviewed.croppedImagePath, reviewed.formulaReview.reviewedEquationCropPath);
    assert.ok(fs.existsSync(path.join(root, garden, ...reviewed.formulaReview.reviewRecordPath.split("/"))));
    assert.ok(fs.existsSync(path.join(root, garden, ...reviewed.formulaReview.reviewedPageImagePath.split("/"))));
    assert.ok(fs.existsSync(path.join(root, garden, ...reviewed.croppedImagePath.slice(`/${garden}/`.length).split("/"))));

    const userContent = requests[0].messages[1].content;
    assert.equal(userContent.filter((part) => part.type === "image_url").length, 2);
    assert.ok(userContent.filter((part) => part.type === "image_url").every((part) =>
      part.image_url.detail === "high"));
    const requestPayload = JSON.parse(userContent[0].text);
    assert.match(requestPayload.canonicalPageText, /Corroborating page text/);
    assert.equal(requestPayload.sourcePdfSha256.length, 64);
    assert.equal(requestPayload.inputVisuals[0].inputExactText, "x_1=0");
    assert.equal(requestPayload.inputVisuals[0].inputCaption, "Untrusted formula 1");

    const validation = validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      assetUrlGardenSlug: garden,
      requiredFormulaIds: ["S1.P1.E1"],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "review-model",
      expectedSourceIds: ["src"],
    });
    assert.deepEqual(validation.problems, []);
    assert.equal(validation.reviewSetHash, result.reviewedFormulaSetHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("AI formula review accepts one complete JSON code fence while preserving the raw audited response", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-fenced-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-fenced-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const rawResponse = `\`\`\`json\n${JSON.stringify({
      reviews: [acceptedReview("S1.P1.E1", 1)],
    })}\n\`\`\``;
    let calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => {
        calls += 1;
        return { choices: [{ message: { content: rawResponse } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });

    assert.equal(calls, 1);
    assert.equal(result.modelCalls, 1);
    const [reviewed] = loadSourceVisuals(root, garden);
    assert.equal(reviewed.exactText, "x_1=1");
    const envelope = JSON.parse(fs.readFileSync(
      path.join(root, garden, ...reviewed.formulaReview.reviewRecordPath.split("/")),
      "utf-8",
    ));
    assert.equal(envelope.rawResponse, rawResponse);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("AI formula review preserves model-authored LaTeX after repairing only an illegal JSON escape", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-illegal-escape-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-illegal-escape-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const acceptedExactText = String.raw`\mathbf{A}=\oint\frac{\mu_0 I\,d\mathbf{L}}{4\pi R}\tag{47}`;
    const serialized = JSON.stringify({
      reviews: [{
        ...acceptedReview("S1.P1.E1", 1),
        acceptedExactText,
      }],
    });
    const rawResponse = serialized.replaceAll("\\\\", "\\");
    assert.notEqual(rawResponse, serialized);
    assert.throws(() => JSON.parse(rawResponse), /Bad escaped character/);
    let calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => {
        calls += 1;
        return { choices: [{ message: { content: rawResponse } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });

    assert.equal(calls, 1);
    assert.equal(result.modelCalls, 1);
    const [reviewed] = loadSourceVisuals(root, garden);
    assert.equal(reviewed.exactText, acceptedExactText);
    assert.doesNotMatch(reviewed.exactText, /[\u0000-\u001F\u007F]/);
    const envelope = JSON.parse(fs.readFileSync(
      path.join(root, garden, ...reviewed.formulaReview.reviewRecordPath.split("/")),
      "utf-8",
    ));
    assert.equal(envelope.rawResponse, rawResponse);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("AI formula review rejects valid JSON whose escaped LaTeX would introduce a control character", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-control-character-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-control-character-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const invalidRaw = JSON.stringify({
      reviews: [{
        ...acceptedReview("S1.P1.E1", 1),
        acceptedExactText: "\frachalf",
      }],
    });
    const requestTexts = [];
    let calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        calls += 1;
        requestTexts.push(request.messages[1].content[0].text);
        return { choices: [{ message: { content: calls === 1
          ? invalidRaw
          : JSON.stringify({ reviews: [acceptedReview("S1.P1.E1", 1)] }) } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });

    assert.equal(calls, 2);
    assert.equal(result.modelCalls, 2);
    assert.match(requestTexts[1], /acceptedExactText must not contain control characters/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("AI formula review confines escape recovery to acceptedExactText", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-escape-scope-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-escape-scope-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const serialized = JSON.stringify({
      reviews: [{
        ...acceptedReview("S1.P1.E1", 1),
        acceptedCaption: String.raw`Permittivity \epsilon_0`,
      }],
    });
    const invalidRaw = serialized.replace(
      String.raw`\\epsilon_0`,
      String.raw`\epsilon_0`,
    );
    let calls = 0;
    const requestTexts = [];
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        calls += 1;
        requestTexts.push(request.messages[1].content[0].text);
        return { choices: [{ message: { content: calls === 1
          ? invalidRaw
          : JSON.stringify({ reviews: [acceptedReview("S1.P1.E1", 1)] }) } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });

    assert.equal(calls, 2);
    assert.equal(result.modelCalls, 2);
    assert.match(requestTexts[1], /response was not valid JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("malformed formula review gets bounded AI-only rereview with exact prior response and diagnostic", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-repair-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-repair-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const invalidRaw = 'Here is the JSON you requested:\n```json\n{"reviews":[]}\n```';
    const requestTexts = [];
    let calls = 0;
    const client = fakeClient(async (request) => {
      calls += 1;
      requestTexts.push(request.messages[1].content[0].text);
      return {
        choices: [{ message: { content: calls === 1
          ? invalidRaw
          : JSON.stringify({ reviews: [acceptedReview("S1.P1.E1", 1)] }) } }],
      };
    });
    const result = await reviewRequiredSourceFormulaExactText({
      client,
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    assert.equal(result.modelCalls, 2);
    assert.equal(calls, 2);
    assert.match(requestTexts[1], /exact prior raw response and strict parse diagnostic/);
    const repairPacket = JSON.parse(requestTexts[1].slice(requestTexts[1].lastIndexOf("\n") + 1));
    assert.equal(repairPacket.rawResponse, invalidRaw);
    assert.match(requestTexts[1], /response was not valid JSON/);
    const [reviewed] = loadSourceVisuals(root, garden);
    const envelope = JSON.parse(fs.readFileSync(
      path.join(root, garden, ...reviewed.formulaReview.reviewRecordPath.split("/")),
      "utf-8",
    ));
    assert.equal(envelope.repairHistory[0].rawResponse, invalidRaw);
    assert.match(envelope.repairHistory[0].diagnostic, /response was not valid JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("empty, missing, or literal-null formula-review output is terminal after one model request", async () => {
  for (const [label, content] of [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "  \n"],
    ["literal-null", "null"],
    ["fenced-null", "```json\nnull\n```"],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `bb-formula-review-${label}-`));
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), `bb-formula-review-${label}-cache-`));
    try {
      const garden = "garden";
      seedFormulaReviewGarden(root, garden, [1]);
      let calls = 0;
      await assert.rejects(
        () => reviewRequiredSourceFormulaExactText({
          client: fakeClient(async () => {
            calls += 1;
            return {
              choices: [{
                message: content === undefined ? {} : { content },
              }],
            };
          }),
          model: "review-model",
          contentPath: root,
          gardenSlug: garden,
          selectedSourceIds: ["src"],
          requiredFormulaIds: ["S1.P1.E1"],
          cacheRoot,
          renderPdfPage: async () => solidPng(),
        }),
        /formula page review returned (?:no nonempty candidate|literal JSON null); no semantic repair request was issued/,
      );
      assert.equal(calls, 1, `${label} output must not authorize a semantic model retry`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    }
  }
});

test("formula model boundaries parse each fulfilled response before a later cancellation checkpoint", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/source-visuals.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /await options\.client\.chat\.completions\.create\([\s\S]{0,1200}?\);\s*options\.checkCancelled\?\.\(\);\s*rawResponse = response\.choices/,
    "a settled formula response must be captured and validated before cancellation can gate another request",
  );
  assert.ok(
    (source.match(/options\.checkCancelled\?\.\(\);\s*const requestPayload/g) ?? []).length >= 7,
    "every bounded formula loop still gates cancellation before its next outbound request",
  );
});

test("failed page-batch review leaves the staging ledger untouched and reuses accepted external cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-atomic-"));
  const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-retry-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-atomic-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1, 2]);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const before = fs.readFileSync(ledgerPath);
    const failingClient = fakeClient(async (request) => {
      const payload = request.messages[1].content[0].text;
      if (payload.includes('"pageNumber":1')) {
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S1.P1.E1", 1)],
        }) } }] };
      }
      return { choices: [{ message: { content: '{"reviews":[]}' } }] };
    });
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: failingClient,
        model: "review-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: ["S1.P1.E1", "S1.P2.E1"],
        cacheRoot,
        renderPdfPage: async ({ pageNumber }) => solidPng(200 + pageNumber),
      }),
      /reviews must contain exactly 1 entries/,
    );
    assert.deepEqual(fs.readFileSync(ledgerPath), before);
    assert.equal(
      fs.existsSync(path.join(root, garden, ".breadboard", "source-formula-reviews")),
      false,
    );

    seedFormulaReviewGarden(retryRoot, garden, [1, 2]);
    let retryCalls = 0;
    const retryResult = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        retryCalls += 1;
        assert.ok(request.messages[1].content[0].text.includes('"pageNumber":2'));
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S1.P2.E1", 2)],
        }) } }] };
      }),
      model: "review-model",
      contentPath: retryRoot,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1", "S1.P2.E1"],
      cacheRoot,
      renderPdfPage: async ({ pageNumber }) => solidPng(200 + pageNumber),
    });
    assert.equal(retryCalls, 1);
    assert.equal(retryResult.modelCalls, 1);
    assert.deepEqual(retryResult.cacheHitFormulaIds, ["S1.P1.E1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(retryRoot, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("formula review rejects duplicate IDs and S/P identity mismatches before any model call", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-identity-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-identity-cache-"));
  try {
    const garden = "garden";
    const [formula] = seedFormulaReviewGarden(root, garden, [1]);
    let calls = 0;
    const options = {
      client: fakeClient(async () => {
        calls += 1;
        throw new Error("model must not be called");
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    };
    saveSourceVisuals(root, garden, [formula, { ...formula }]);
    await assert.rejects(() => reviewRequiredSourceFormulaExactText(options), /Duplicate required source formula ids/);

    saveSourceVisuals(root, garden, [{ ...formula, sourceId: "wrong-source" }]);
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText(options),
      /assigns S1 to both "src" and "wrong-source"|does not match stable source src/,
    );

    saveSourceVisuals(root, garden, [{
      ...formula,
      pageNumber: 2,
      pageImagePath: `/${garden}/assets/src-page-002.png`,
    }]);
    await assert.rejects(() => reviewRequiredSourceFormulaExactText(options), /does not encode ledger page 2/);

    saveSourceVisuals(root, garden, [{
      ...formula,
      pageImagePath: `/${garden}/assets/src-page-002.png`,
    }]);
    await assert.rejects(() => reviewRequiredSourceFormulaExactText(options), /snapshot URL encodes a different page/);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("reject or ambiguous formula evidence fails closed without ledger projection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-reject-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-reject-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const before = fs.readFileSync(ledgerPath);
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async () => ({ choices: [{ message: { content: JSON.stringify({
          reviews: [{
            sourceVisualId: "S1.P1.E1",
            action: "reject",
            identityAssessment: "ambiguous",
            reason: "The PDF render does not establish a complete single displayed equation.",
          }],
        }) } }] })),
        model: "review-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: ["S1.P1.E1"],
        cacheRoot,
        renderPdfPage: async () => solidPng(),
      }),
      /review rejected source evidence.*ambiguous/,
    );
    assert.deepEqual(fs.readFileSync(ledgerPath), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("identity_mismatch recovery uses one high-detail whole-page receipt and preserves accepted lineage", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-recovery-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-recovery-cache-"));
  try {
    const garden = "garden";
    const { pageUrl, pagePath, freshPage } = recoveryFixture(root, garden);
    const rejectedRaw = JSON.stringify(identityMismatchReviews());
    let formulaReviewCalls = 0;
    let recoveryCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("one-time recovery of stale")) {
          recoveryCalls += 1;
          const parts = request.messages[1].content;
          const imageParts = parts.filter((part) => part.type === "image_url");
          assert.equal(imageParts.length, 1);
          assert.equal(imageParts[0].image_url.detail, "high");
          const payload = JSON.parse(parts.find((part) => part.type === "text").text);
          assert.equal(payload.failedReviewerResponseVerbatim, rejectedRaw);
          assert.match(payload.failedReviewerResponseVerbatim, /section heading rather than the first complete displayed equation/);
          return { choices: [{ message: { content: JSON.stringify(recoveredWholePageResponse()) } }] };
        }
        formulaReviewCalls += 1;
        if (formulaReviewCalls === 1) {
          return { choices: [{ message: { content: rejectedRaw } }] };
        }
        assert.equal(formulaReviewCalls, 2);
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        assert.deepEqual(
          payload.inputVisuals.map((input) => [input.sourceVisualId, input.inputExactText, input.inputCaption]),
          [
            ["S1.P1.E2", "a=1", "Recovered first equality"],
            ["S1.P1.E4", "b=2", "Recovered second equality"],
          ],
        );
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          recoveredApproval("S1.P1.E2", "a=1", "Recovered first equality"),
          recoveredApproval("S1.P1.E4", "b=2", "Recovered second equality"),
        ] }) } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(formulaReviewCalls, 2);
    assert.equal(recoveryCalls, 1);
    assert.equal(result.modelCalls, 3);
    assert.deepEqual(fs.readFileSync(pagePath), freshPage);

    const reviewed = loadSourceVisuals(root, garden);
    assert.deepEqual(reviewed.map((visual) => visual.sourceVisualId), ["S1.P1.E2", "S1.P1.E4", "S1.P1.F1"]);
    for (const formula of reviewed.filter((visual) => visual.type === "equation")) {
      assert.equal(formula.formulaReview.artifactRecovery.model, "review-model");
      assert.ok(fs.existsSync(localGardenAsset(root, garden, formula.croppedImagePath)));
    }
    const figure = reviewed.find((visual) => visual.sourceVisualId === "S1.P1.F1");
    assert.ok(figure?.croppedImagePath);
    assert.ok(fs.existsSync(localGardenAsset(root, garden, figure.croppedImagePath)));

    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "review-model",
      expectedSourceIds: ["src"],
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);

    // A fully projected v4 page is not replayed on a later extraction: it
    // retains formula review, recovery provenance, exact slots, and crops.
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const acceptedLedgerBytes = fs.readFileSync(ledgerPath);
    let genericCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        throw new Error("v4 receipt should have been faithfully projected");
      }),
      model: "generic-detector",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericCalls, 0);
    assert.deepEqual(fs.readFileSync(ledgerPath), acceptedLedgerBytes);

    // Formula finalization treats the nested receipt as required lineage, not
    // merely text included in the review-set hash.
    const mixedLineage = loadSourceVisuals(root, garden);
    mixedLineage.find((visual) => visual.sourceVisualId === "S1.P1.E4")
      .formulaReview.artifactRecovery.model = "forged-recovery-model";
    saveSourceVisuals(root, garden, mixedLineage);
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /artifactRecovery provenance/,
    );
    fs.writeFileSync(ledgerPath, acceptedLedgerBytes);

    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const originalScanCache = fs.readFileSync(scanCachePath);
    const tamperedScanCache = JSON.parse(originalScanCache.toString("utf-8"));
    tamperedScanCache.sources.src[pageUrl].formulaArtifactRecovery.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tamperedScanCache));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /missing or invalid recovery scan receipt/,
    );
    fs.writeFileSync(scanCachePath, originalScanCache);

    // A changed live snapshot cannot early-continue based on the v4 entry's
    // own old fingerprint. It invalidates the receipt and goes through the
    // ordinary detector path exactly once.
    fs.writeFileSync(pagePath, solidPng(77));
    let changedSnapshotDetectorCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        changedSnapshotDetectorCalls += 1;
        return { choices: [{ message: { content: "[]" } }] };
      }),
      model: "generic-detector",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(changedSnapshotDetectorCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("persistent external review-cache failure degrades while durable review evidence stays fail-closed", async () => {
  const successRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-external-cache-degraded-"));
  const failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-durable-cache-failure-"));
  const originalMkdirSync = fs.mkdirSync;
  try {
    const garden = "garden";
    seedFormulaReviewGarden(successRoot, garden, [1, 2]);
    const blockedExternalCache = path.join(successRoot, "external-cache-blocker");
    fs.writeFileSync(blockedExternalCache, "not a directory");
    const attemptedExternalDirectories = [];
    fs.mkdirSync = function observeExternalCacheDirectories(directoryPath, ...args) {
      if (path.resolve(String(directoryPath)).startsWith(path.resolve(blockedExternalCache))) {
        attemptedExternalDirectories.push(path.resolve(String(directoryPath)));
      }
      return originalMkdirSync.call(this, directoryPath, ...args);
    };
    let successCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        successCalls += 1;
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        const pageNumber = payload.pageNumber;
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview(`S1.P${pageNumber}.E1`, pageNumber)],
        }) } }] };
      }),
      model: "external-cache-degraded-model",
      contentPath: successRoot,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1", "S1.P2.E1"],
      cacheRoot: blockedExternalCache,
      renderPdfPage: async () => solidPng(),
    });
    fs.mkdirSync = originalMkdirSync;
    assert.equal(successCalls, 2);
    assert.equal(result.modelCalls, 2);
    assert.equal(attemptedExternalDirectories.length, 1);
    assert.equal(fs.readFileSync(blockedExternalCache, "utf8"), "not a directory");
    const [reviewed] = loadSourceVisuals(successRoot, garden);
    assert.ok(reviewed.formulaReview.reviewRecordPath);
    assert.ok(fs.existsSync(path.join(
      successRoot,
      garden,
      ...reviewed.formulaReview.reviewRecordPath.split("/"),
    )));
    assert.ok(fs.existsSync(path.join(
      successRoot,
      garden,
      ...reviewed.formulaReview.reviewedPageImagePath.split("/"),
    )));

    seedFormulaReviewGarden(failureRoot, garden, [1]);
    const failureLedgerPath = path.join(failureRoot, garden, ".breadboard", "source-visuals.json");
    const beforeFailureLedger = fs.readFileSync(failureLedgerPath);
    const blockedDurableRecords = path.join(
      failureRoot,
      garden,
      ".breadboard",
      "source-formula-reviews",
    );
    fs.writeFileSync(blockedDurableRecords, "not a directory");
    const blockedFailureCache = path.join(failureRoot, "external-cache-blocker");
    fs.writeFileSync(blockedFailureCache, "not a directory");
    let failureCalls = 0;
    await assert.rejects(() => reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => {
        failureCalls += 1;
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S1.P1.E1", 1)],
        }) } }] };
      }),
      model: "durable-cache-failure-model",
      contentPath: failureRoot,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot: blockedFailureCache,
      renderPdfPage: async () => solidPng(),
    }), /EEXIST|ENOTDIR|not a directory/);
    assert.equal(failureCalls, 1);
    assert.deepEqual(fs.readFileSync(failureLedgerPath), beforeFailureLedger);
    assert.equal(fs.readFileSync(blockedDurableRecords, "utf8"), "not a directory");
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync(successRoot, { recursive: true, force: true });
    fs.rmSync(failureRoot, { recursive: true, force: true });
  }
});

test("persistent external artifact-recovery cache failure still binds durable V4 provenance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-recovery-cache-degraded-"));
  const originalMkdirSync = fs.mkdirSync;
  try {
    const garden = "garden";
    const { freshPage } = recoveryFixture(root, garden);
    const blockedExternalCache = path.join(root, "external-cache-blocker");
    fs.writeFileSync(blockedExternalCache, "not a directory");
    const attemptedExternalDirectories = [];
    fs.mkdirSync = function observeExternalCacheDirectories(directoryPath, ...args) {
      if (path.resolve(String(directoryPath)).startsWith(path.resolve(blockedExternalCache))) {
        attemptedExternalDirectories.push(path.resolve(String(directoryPath)));
      }
      return originalMkdirSync.call(this, directoryPath, ...args);
    };
    const rejectedRaw = JSON.stringify(identityMismatchReviews());
    let formulaReviewCalls = 0;
    let recoveryCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("one-time recovery of stale")) {
          recoveryCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(recoveredWholePageResponse()) } }] };
        }
        formulaReviewCalls += 1;
        return { choices: [{ message: { content: formulaReviewCalls === 1
          ? rejectedRaw
          : JSON.stringify({ reviews: [
            recoveredApproval("S1.P1.E2", "a=1", "Recovered first equality"),
            recoveredApproval("S1.P1.E4", "b=2", "Recovered second equality"),
          ] }) } }] };
      }),
      model: "external-recovery-cache-degraded-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      cacheRoot: blockedExternalCache,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(formulaReviewCalls, 2);
    assert.equal(recoveryCalls, 1);
    assert.equal(result.modelCalls, 3);
    assert.equal(fs.readFileSync(blockedExternalCache, "utf8"), "not a directory");
    assert.equal(
      attemptedExternalDirectories.some((directory) =>
        directory.includes(`${path.sep}formula-artifact-recovery-v1${path.sep}`),
      ),
      true,
    );
    assert.equal(
      attemptedExternalDirectories.some((directory) =>
        !directory.includes(`${path.sep}formula-artifact-recovery-v1${path.sep}`),
      ),
      true,
    );
    const reviewed = loadSourceVisuals(root, garden).filter((visual) => visual.type === "equation");
    assert.equal(reviewed.length, 2);
    assert.ok(reviewed.every((visual) => visual.formulaReview.artifactRecovery));
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "external-recovery-cache-degraded-model",
      expectedSourceIds: ["src"],
    }).problems, []);
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("iterative re-review dispatches a newly reached topology page to V5 and persists crops from every round", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-recovery-iterative-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-recovery-iterative-cache-"));
  try {
    const garden = "garden";
    const initial = seedFormulaReviewGarden(root, garden, [1, 2, 3, 4]);
    const pageFourOld = [
      initial.find((visual) => visual.sourceVisualId === "S1.P4.E1"),
      {
        ...initial.find((visual) => visual.sourceVisualId === "S1.P4.E1"),
        sourceVisualId: "S1.P4.E2",
        caption: "Second stale formula on page 4",
        exactText: "y_4=0",
        bbox: { x: 0.19, y: 0.56, width: 0.48, height: 0.1 },
      },
    ];
    assert.ok(pageFourOld.every(Boolean));
    saveSourceVisuals(root, garden, [
      ...initial.filter((visual) => visual.pageNumber !== 4),
      ...pageFourOld,
    ]);
    for (const pageNumber of [1, 2, 3, 4]) {
      fs.writeFileSync(
        path.join(root, garden, "assets", `src-page-${String(pageNumber).padStart(3, "0")}.png`),
        solidPng(30 + pageNumber),
      );
    }
    const rejectedRawByPage = new Map([
      [1, JSON.stringify(singleSlotIdentityMismatch("S1.P1.E1", 1))],
      [4, JSON.stringify(topologyRejectReviews(pageFourOld))],
    ]);
    const pageFourActive = [topologySlot("S1.P4.E3", 0, ["S1.P4.E1", "S1.P4.E2"])];
    const pageFourGraph = [
      {
        sourceVisualId: "S1.P4.E1",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P4.E3"],
        reason: "The first stale crop is the first line of one complete equation.",
      },
      {
        sourceVisualId: "S1.P4.E2",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P4.E3"],
        reason: "The second stale crop is the continuation line of that same complete equation.",
      },
    ];
    const normalCalls = new Map();
    const v4RecoveryPayloads = [];
    const v5RecoveryPayloads = [];
    let topologyReviewCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        const parts = request.messages[1].content;
        const payload = JSON.parse(parts.find((part) => part.type === "text").text);
        if (system.includes("one-time recovery of stale")) {
          v4RecoveryPayloads.push(payload);
          assert.equal(payload.failedReviewerResponseVerbatim, rejectedRawByPage.get(payload.pageNumber));
          assert.equal(parts.filter((part) => part.type === "image_url")[0].image_url.detail, "high");
          return {
            choices: [{ message: {
              content: JSON.stringify(singleSlotRecoveredWholePage(
                `S1.P${payload.pageNumber}.E1`,
                payload.pageNumber,
              )),
            } }],
          };
        }
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewCalls += 1;
          assert.equal(payload.pageNumber, 4);
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(pageFourGraph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          v5RecoveryPayloads.push(payload);
          assert.equal(payload.pageNumber, 4);
          assert.equal(payload.failedReviewerResponseVerbatim, rejectedRawByPage.get(4));
          assert.equal(parts.filter((part) => part.type === "image_url")[0].image_url.detail, "high");
          return {
            choices: [{ message: {
              content: JSON.stringify(topologyRecoveryResponse(pageFourActive, pageFourGraph)),
            } }],
          };
        }
        if (system.includes("successor candidate")) {
          throw new Error("a confirmed V5 topology recovery must not invent a V6 repair");
        }
        const pageNumber = payload.pageNumber;
        normalCalls.set(pageNumber, (normalCalls.get(pageNumber) ?? 0) + 1);
        if ((pageNumber === 1 || pageNumber === 4) && normalCalls.get(pageNumber) === 1) {
          return { choices: [{ message: { content: rejectedRawByPage.get(pageNumber) } }] };
        }
        return {
          choices: [{ message: {
            content: JSON.stringify({
              reviews: payload.inputVisuals.map((input) => recoveredApproval(
                input.sourceVisualId,
                input.inputExactText,
                input.inputCaption,
              )),
            }),
          } }],
        };
      }),
      model: "iterative-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1", "S1.P2.E1", "S1.P3.E1", "S1.P4.E1", "S1.P4.E2"],
      cacheRoot,
      renderPdfPage: async ({ pageNumber }) => solidPng(170 + pageNumber),
    });

    // Page 4 sits beyond the initial three-page reviewer batch. It is first
    // reached only after page 1's model-authored recovery/re-review succeeds,
    // reproducing the p73 -> p96 state-machine seam without a provider call.
    assert.deepEqual(v4RecoveryPayloads.map((payload) => payload.pageNumber), [1]);
    assert.deepEqual(v5RecoveryPayloads.map((payload) => payload.pageNumber), [4]);
    assert.equal(topologyReviewCalls, 1);
    assert.deepEqual([...normalCalls.entries()].sort((left, right) => left[0] - right[0]), [
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
    assert.equal(result.modelCalls, 9);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1", "S1.P2.E1", "S1.P3.E1", "S1.P4.E3"]);

    const projected = loadSourceVisuals(root, garden);
    for (const [pageNumber, sourceVisualId, lineage] of [
      [1, "S1.P1.E1", "artifactRecovery"],
      [4, "S1.P4.E3", "artifactTopologyRecovery"],
    ]) {
      const equation = projected.find((visual) => visual.sourceVisualId === sourceVisualId);
      const figure = projected.find((visual) => visual.sourceVisualId === `S1.P${pageNumber}.F1`);
      assert.equal(equation?.formulaReview?.[lineage]?.model, "iterative-review-model");
      assert.equal(equation?.exactText, pageNumber === 1 ? "r_1=1" : pageFourActive[0].exactText);
      assert.ok(figure?.croppedImagePath, `page ${pageNumber} recovered figure needs a persisted crop`);
      assert.ok(
        fs.existsSync(localGardenAsset(root, garden, figure.croppedImagePath)),
        `page ${pageNumber} recovered figure crop must survive later recovery rounds`,
      );
    }
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "iterative-review-model",
      expectedSourceIds: ["src"],
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("iterative re-review carries a confirmed V6 page into a later V5 topology recovery without losing either receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-recovery-v6-v5-iterative-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-recovery-v6-v5-iterative-cache-"));
  try {
    const garden = "garden";
    const initial = seedFormulaReviewGarden(root, garden, [1, 2, 3, 4]);
    const pageOneSeed = initial.find((visual) => visual.sourceVisualId === "S1.P1.E1");
    const pageFourSeed = initial.find((visual) => visual.sourceVisualId === "S1.P4.E1");
    assert.ok(pageOneSeed && pageFourSeed);
    const pageOneOld = [
      pageOneSeed,
      {
        ...pageOneSeed,
        sourceVisualId: "S1.P1.E2",
        caption: "Second stale formula on page 1",
        exactText: "y_1=0",
        bbox: { x: 0.18, y: 0.55, width: 0.5, height: 0.1 },
      },
    ];
    const pageFourOld = [
      pageFourSeed,
      {
        ...pageFourSeed,
        sourceVisualId: "S1.P4.E2",
        caption: "Second stale formula on page 4",
        exactText: "y_4=0",
        bbox: { x: 0.19, y: 0.56, width: 0.48, height: 0.1 },
      },
    ];
    saveSourceVisuals(root, garden, [
      ...initial.filter((visual) => visual.pageNumber !== 1 && visual.pageNumber !== 4),
      ...pageOneOld,
      ...pageFourOld,
    ]);
    for (const pageNumber of [1, 2, 3, 4]) {
      fs.writeFileSync(
        path.join(root, garden, "assets", `src-page-${String(pageNumber).padStart(3, "0")}.png`),
        solidPng(80 + pageNumber),
      );
    }
    const pageOneGraph = [
      {
        sourceVisualId: "S1.P1.E1",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P1.E1"],
        reason: "The first old crop is the first line of one complete displayed equation.",
      },
      {
        sourceVisualId: "S1.P1.E2",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P1.E1"],
        reason: "The second old crop continues that same complete displayed equation.",
      },
    ];
    const pageFourGraph = [
      {
        sourceVisualId: "S1.P4.E1",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P4.E3"],
        reason: "The first old crop is the first line of one complete displayed equation.",
      },
      {
        sourceVisualId: "S1.P4.E2",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P4.E3"],
        reason: "The second old crop continues that same complete displayed equation.",
      },
    ];
    const pageOneCandidateOne = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const pageOneCandidateTwo = [{
      ...pageOneCandidateOne[0],
      caption: "Corrected page 1 complete equality",
      exactText: "u_1\\approx 1",
    }];
    const pageOneCandidateOneRaw = JSON.stringify(topologyRecoveryResponse(
      pageOneCandidateOne,
      pageOneGraph,
    ));
    const pageOneCandidateTwoRaw = JSON.stringify(topologyRecoveryResponse(
      pageOneCandidateTwo,
      pageOneGraph,
    ));
    const pageOneTopologyRejectRaw = JSON.stringify(topologyRejectReviews(pageOneOld));
    const pageFourTopologyRejectRaw = JSON.stringify(topologyRejectReviews(pageFourOld));
    const firstTopologyReviewerReject = {
      status: "rejected",
      reason: "The page image shows a dotted approximation mark that candidate C1 did not transcribe.",
    };
    const firstTopologyReviewerRejectRaw = JSON.stringify(firstTopologyReviewerReject);
    const normalCalls = new Map();
    const v5Authors = [];
    let v6Authors = 0;
    const topologyReviewerCalls = new Map();
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        const parts = request.messages[1].content;
        const payload = JSON.parse(parts.find((part) => part.type === "text").text);
        if (system.includes("bounded successor candidate")) {
          v6Authors += 1;
          assert.equal(payload.pageNumber, 1);
          assert.equal(payload.priorCandidateResponseVerbatim, pageOneCandidateOneRaw);
          assert.equal(payload.priorIndependentTopologyReviewerResponseVerbatim, firstTopologyReviewerRejectRaw);
          return { choices: [{ message: { content: pageOneCandidateTwoRaw } }] };
        }
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          const pageNumber = payload.pageNumber;
          topologyReviewerCalls.set(pageNumber, (topologyReviewerCalls.get(pageNumber) ?? 0) + 1);
          if (pageNumber === 1 && topologyReviewerCalls.get(pageNumber) === 1) {
            return { choices: [{ message: { content: firstTopologyReviewerRejectRaw } }] };
          }
          return { choices: [{ message: {
            content: JSON.stringify(topologyConfirmation(
              pageNumber === 1 ? pageOneGraph : pageFourGraph,
            )),
          } }], };
        }
        if (system.includes("formula-topology recovery")) {
          v5Authors.push(payload.pageNumber);
          assert.equal(
            payload.failedReviewerResponseVerbatim,
            payload.pageNumber === 1 ? pageOneTopologyRejectRaw : pageFourTopologyRejectRaw,
          );
          return { choices: [{ message: {
            content: payload.pageNumber === 1
              ? pageOneCandidateOneRaw
              : JSON.stringify(topologyRecoveryResponse(
                [topologySlot("S1.P4.E3", 0, ["S1.P4.E1", "S1.P4.E2"])],
                pageFourGraph,
              )),
          } }], };
        }
        if (system.includes("one-time recovery of stale")) {
          throw new Error("every iterative recovery in this fixture is topology-shaped");
        }
        const pageNumber = payload.pageNumber;
        normalCalls.set(pageNumber, (normalCalls.get(pageNumber) ?? 0) + 1);
        if (pageNumber === 1 && normalCalls.get(pageNumber) === 1) {
          return { choices: [{ message: { content: pageOneTopologyRejectRaw } }] };
        }
        if (pageNumber === 4 && normalCalls.get(pageNumber) === 1) {
          return { choices: [{ message: { content: pageFourTopologyRejectRaw } }] };
        }
        return { choices: [{ message: { content: JSON.stringify({
          reviews: payload.inputVisuals.map((input) => recoveredApproval(
            input.sourceVisualId,
            input.inputExactText,
            input.inputCaption,
          )),
        }) } }] };
      }),
      model: "iterative-v6-v5-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: [
        "S1.P1.E1", "S1.P1.E2", "S1.P2.E1", "S1.P3.E1", "S1.P4.E1", "S1.P4.E2",
      ],
      cacheRoot,
      renderPdfPage: async ({ pageNumber }) => solidPng(200 + pageNumber),
    });

    assert.deepEqual(v5Authors, [1, 4]);
    assert.equal(v6Authors, 1);
    assert.deepEqual([...topologyReviewerCalls.entries()].sort((left, right) => left[0] - right[0]), [
      [1, 2],
      [4, 1],
    ]);
    assert.deepEqual([...normalCalls.entries()].sort((left, right) => left[0] - right[0]), [
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
    assert.equal(result.modelCalls, 12);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1", "S1.P2.E1", "S1.P3.E1", "S1.P4.E3"]);
    assert.deepEqual(
      result.topologyReviewPageReceipts.map((receipt) => [receipt.sourceId, receipt.pageNumber]),
      [["src", 1], ["src", 4]],
    );

    const projected = loadSourceVisuals(root, garden);
    const pageOneEquation = projected.find((visual) => visual.sourceVisualId === "S1.P1.E1");
    const pageFourEquation = projected.find((visual) => visual.sourceVisualId === "S1.P4.E3");
    assert.ok(pageOneEquation?.formulaReview?.artifactTopologyCandidateRepair);
    assert.equal(pageOneEquation?.formulaReview?.artifactTopologyRecovery, undefined);
    assert.ok(pageFourEquation?.formulaReview?.artifactTopologyRecovery);
    for (const sourceVisualId of ["S1.P1.F1", "S1.P4.F1"]) {
      const figure = projected.find((visual) => visual.sourceVisualId === sourceVisualId);
      assert.ok(figure?.croppedImagePath);
      assert.ok(fs.existsSync(localGardenAsset(root, garden, figure.croppedImagePath)));
    }
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "iterative-v6-v5-model",
      expectedSourceIds: ["src"],
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("accepted recovery receipt rehydrates a rolled-back ledger, carries lineage across reviewer models, and caps another recovery", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-rehydrate-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-rehydrate-cache-"));
  try {
    const garden = "garden";
    const { pageUrl, pagePath, freshPage, staleSnapshot } = recoveryFixture(root, garden);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const beforeLedger = fs.readFileSync(ledgerPath);
    let initialReviewerCalls = 0;
    let initialRecoveryCalls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (system.includes("one-time recovery of stale")) {
            initialRecoveryCalls += 1;
            return { choices: [{ message: { content: JSON.stringify(recoveredWholePageResponse()) } }] };
          }
          initialReviewerCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(identityMismatchReviews()) } }] };
        }),
        model: "recovery-author-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /Source formula review rejected source evidence.*identity_mismatch/s,
    );
    assert.equal(initialReviewerCalls, 2);
    assert.equal(initialRecoveryCalls, 1);
    // Recovery/re-review failure does not project a candidate ledger or a
    // review manifest, but the high-detail receipt and exact page snapshot
    // survive so a fresh job cannot fall back to stale v3 boxes.
    assert.deepEqual(fs.readFileSync(ledgerPath), beforeLedger);
    assert.equal(fs.existsSync(path.join(root, garden, ".breadboard", "source-formula-reviews")), false);
    assert.notDeepEqual(fs.readFileSync(pagePath), staleSnapshot);
    assert.deepEqual(fs.readFileSync(pagePath), freshPage);

    let rehydrateDetectorCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        rehydrateDetectorCalls += 1;
        throw new Error("recovery cache should suppress v3 detector replay");
      }),
      model: "generic-detector",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(rehydrateDetectorCalls, 0);
    assert.deepEqual(rehydrated.map((visual) => visual.sourceVisualId), ["S1.P1.E2", "S1.P1.E4", "S1.P1.F1"]);
    assert.equal(rehydrated.find((visual) => visual.sourceVisualId === "S1.P1.E2").exactText, "a=1");
    assert.equal(rehydrated.find((visual) => visual.sourceVisualId === "S1.P1.E4").exactText, "b=2");
    assert.ok(fs.existsSync(localGardenAsset(
      root,
      garden,
      rehydrated.find((visual) => visual.sourceVisualId === "S1.P1.F1").croppedImagePath,
    )));

    // A normal review may change models after rollback; it must bind the same
    // receipt rather than dropping nested recovery provenance.
    const reReviewed = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        assert.ok(!String(request.messages[0].content).includes("one-time recovery of stale"));
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          ordinaryReviewerReplacement("S1.P1.E2", "a\\simeq 1", "Normal-review refinement of the first equality"),
          ordinaryReviewerReplacement("S1.P1.E4", "b\\simeq 2", "Normal-review refinement of the second equality"),
        ] }) } }] };
      }),
      model: "alternate-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    for (const formula of loadSourceVisuals(root, garden).filter((visual) => visual.type === "equation")) {
      assert.equal(formula.formulaReview.model, "alternate-review-model");
      assert.equal(formula.formulaReview.artifactRecovery.model, "recovery-author-model");
    }
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
      expectedReviewSetHash: reReviewed.reviewedFormulaSetHash,
      expectedModel: "alternate-review-model",
      expectedSourceIds: ["src"],
    }).problems, []);

    // A later, unrelated source-map discovery forces the normal production
    // full-ledger re-review.  The old V4 page must be rebound to its signed
    // recovery candidate before the normal-review cache lookup: the ordinary
    // replacement above is legitimate output, but it is not a new recovery
    // candidate and must not erase nested provenance.
    const late = appendLateFormulaPage(root, garden, 2);
    let lateReviewerCalls = 0;
    const lateReReviewed = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        assert.ok(!system.includes("one-time recovery of stale"));
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        // The V4 page is a same-model cache hit only if the evidence was
        // rebound from the signed candidate.  A call for E2/E4 would expose
        // the old lineage-loss bug.
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), [late.sourceVisualId]);
        lateReviewerCalls += 1;
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          acceptedReview(late.sourceVisualId, late.pageNumber),
        ] }) } }] };
      }),
      model: "alternate-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4", late.sourceVisualId],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(lateReviewerCalls, 1);
    assert.deepEqual(lateReReviewed.formulaIds, ["S1.P1.E2", "S1.P1.E4", late.sourceVisualId]);
    for (const sourceVisualId of ["S1.P1.E2", "S1.P1.E4"]) {
      const formula = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === sourceVisualId);
      assert.equal(formula.formulaReview.model, "alternate-review-model");
      assert.equal(formula.formulaReview.artifactRecovery.model, "recovery-author-model");
    }
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: lateReReviewed.formulaIds,
      expectedReviewSetHash: lateReReviewed.reviewedFormulaSetHash,
      expectedModel: "alternate-review-model",
      expectedSourceIds: ["src"],
    }).problems, []);

    let capReviewerCalls = 0;
    let capRecoveryCalls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          if (String(request.messages[0].content).includes("one-time recovery of stale")) {
            capRecoveryCalls += 1;
            throw new Error("a second recovery call is forbidden");
          }
          capReviewerCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(identityMismatchReviews()) } }] };
        }),
        model: "third-review-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: ["S1.P1.E2", "S1.P1.E4"],
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /already attempted for this unchanged PDF page evidence/,
    );
    assert.equal(capReviewerCalls, 1);
    assert.equal(capRecoveryCalls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("recovery persistence stages every snapshot before publishing a v4 receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-atomic-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-artifact-atomic-cache-"));
  try {
    const garden = "garden";
    const [pageOne, pageTwo] = seedFormulaReviewGarden(root, garden, [1, 2]);
    const pageOneUrl = `/${garden}/assets/src-page-001.png`;
    const pageOnePath = path.join(root, garden, "assets", "src-page-001.png");
    const blockedParent = path.join(root, garden, "assets", "blocked");
    pageTwo.pageImagePath = `/${garden}/assets/blocked/src-page-002.png`;
    saveSourceVisuals(root, garden, [pageOne, pageTwo]);
    const stalePageOne = solidPng(18);
    fs.writeFileSync(pageOnePath, stalePageOne);
    fs.writeFileSync(blockedParent, "not a directory");
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const beforeLedger = fs.readFileSync(ledgerPath);
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    fs.mkdirSync(path.dirname(scanCachePath), { recursive: true });
    const priorScanCache = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      sources: { src: { [pageOneUrl]: { detectorVersion: 3, fingerprint: "prior", detections: [] } } },
    }, null, 2));
    fs.writeFileSync(scanCachePath, priorScanCache);

    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          const input = payload.inputVisuals[0];
          if (String(request.messages[0].content).includes("one-time recovery of stale")) {
            const replacement = {
              sourceVisualId: input.sourceVisualId,
              caption: `Recovered equation ${input.pageNumber}`,
              exactText: `q_${input.pageNumber}=1`,
              bbox: { x: 0.1, y: 0.55, width: 0.66, height: 0.15 },
            };
            return { choices: [{ message: { content: JSON.stringify({
              detections: [
                { type: "figure", caption: `Recovered figure ${input.pageNumber}`, bbox: { x: 0.05, y: 0.05, width: 0.4, height: 0.2 } },
                { type: "equation", caption: replacement.caption, exactText: replacement.exactText, bbox: replacement.bbox },
              ],
              formulaReplacements: [replacement],
            }) } }] };
          }
          return { choices: [{ message: { content: JSON.stringify({ reviews: [{
            sourceVisualId: input.sourceVisualId,
            action: "reject",
            identityAssessment: "identity_mismatch",
            topologyAssessment: "same_slot",
            reason: "The labeled crop is not the complete displayed equation.",
          }] }) } }] };
        }),
        model: "atomic-recovery-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: ["S1.P1.E1", "S1.P2.E1"],
        cacheRoot,
        renderPdfPage: async ({ pageNumber }) => solidPng(180 + pageNumber),
      }),
      /EEXIST|not a directory|ENOTDIR/,
    );
    assert.deepEqual(fs.readFileSync(pageOnePath), stalePageOne);
    assert.deepEqual(fs.readFileSync(scanCachePath), priorScanCache);
    assert.deepEqual(fs.readFileSync(ledgerPath), beforeLedger);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 topology recovery merges old formula slots, recomputes active ids, and binds the signed graph", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-merge-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-merge-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, pagePath, freshPage } = topologyFixture(root, garden, 5);
    const active = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      topologySlot("S1.P1.E2", 1, ["S1.P1.E2"]),
      topologySlot("S1.P1.E3", 2, ["S1.P1.E3"]),
      topologySlot("S1.P1.E4", 3, ["S1.P1.E4", "S1.P1.E5"]),
    ];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"], reason: "First equation remains one complete equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "retain", activeSourceVisualIds: ["S1.P1.E2"], reason: "Second equation remains one complete equation." },
      { sourceVisualId: "S1.P1.E3", disposition: "retain", activeSourceVisualIds: ["S1.P1.E3"], reason: "Third equation remains one complete equation." },
      { sourceVisualId: "S1.P1.E4", disposition: "merge", activeSourceVisualIds: ["S1.P1.E4"], reason: "The fourth and fifth old crops are one displayed equation." },
      { sourceVisualId: "S1.P1.E5", disposition: "merge", activeSourceVisualIds: ["S1.P1.E4"], reason: "The fifth old crop is a continuation line of the fourth equation." },
    ];
    let initialReviewCalls = 0;
    let topologyAuthorCalls = 0;
    let topologyReviewerCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewerCalls += 1;
          const parts = request.messages[1].content;
          assert.equal(parts.filter((part) => part.type === "image_url").length, 1 + active.length);
          assert.equal(parts.find((part) => part.type === "image_url").image_url.detail, "high");
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          topologyAuthorCalls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          assert.equal(payload.failedReviewerResponseVerbatim, JSON.stringify(topologyRejectReviews(old)));
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        initialReviewCalls += 1;
        if (initialReviewCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), active.map((slot) => slot.sourceVisualId));
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(initialReviewCalls, 2);
    assert.equal(topologyAuthorCalls, 1);
    assert.equal(topologyReviewerCalls, 1);
    assert.equal(result.modelCalls, 4);
    assert.deepEqual(result.formulaIds, active.map((slot) => slot.sourceVisualId));
    assert.deepEqual(fs.readFileSync(pagePath), freshPage);
    const ledger = loadSourceVisuals(root, garden);
    assert.deepEqual(
      ledger.filter((visual) => visual.type === "equation").map((visual) => visual.sourceVisualId),
      active.map((slot) => slot.sourceVisualId),
    );
    assert.equal(ledger.some((visual) => visual.sourceVisualId === "S1.P1.E5"), false);
    for (const visual of ledger.filter((candidate) => candidate.type === "equation")) {
      assert.ok(visual.formulaReview?.artifactTopologyRecovery);
      assert.ok(fs.existsSync(localGardenAsset(root, garden, visual.croppedImagePath)));
    }
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-model",
      expectedSourceIds: ["src"],
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    assert.match(
      validateSourceFormulaReviewSet({ ...validationOptions, requiredFormulaIds: old.map((visual) => visual.sourceVisualId) }).problems.join("; "),
      /S1\.P1\.E5.*missing from the ledger/,
    );
    // Accepted V5 evidence is a cache hit for extraction and never falls back
    // to the generic low-detail detector or resurrects retired E5.
    let genericCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        throw new Error("accepted V5 receipt must rehydrate without v3");
      }),
      model: "generic-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericCalls, 0);
    // A changed preserved PDF invalidates the V5 receipt.  Extraction must
    // render that current PDF before it may run the normal detector; it may
    // not launder the old persisted snapshot through an empty v3 result.
    const pdfPath = path.join(root, garden, "assets", "src-source.pdf");
    const changedPdf = Buffer.from("changed source pdf bytes for topology replay");
    const changedPdfPage = solidPng(71);
    fs.writeFileSync(pdfPath, changedPdf);
    let canonicalPdfRenders = 0;
    await extractSourceVisuals({
      client: fakeClient(async (request) => {
        genericCalls += 1;
        const pageImageUrl = request.messages[1].content.find((part) => part.type === "image_url").image_url.url;
        assert.deepEqual(
          Buffer.from(pageImageUrl.slice(pageImageUrl.indexOf(",") + 1), "base64"),
          changedPdfPage,
        );
        return { choices: [{ message: { content: "[]" } }] };
      }),
      model: "generic-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
      renderPdfPage: async ({ sourcePdf }) => {
        canonicalPdfRenders += 1;
        assert.deepEqual(sourcePdf, changedPdf);
        return changedPdfPage;
      },
    });
    assert.equal(genericCalls, 1);
    assert.equal(canonicalPdfRenders, 1);
    assert.deepEqual(fs.readFileSync(pagePath), changedPdfPage);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 topology recovery supports model-authored split, retire, and newly discovered formula ids", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-split-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-split-cache-"));
  try {
    const garden = "garden";
    const { old, freshPage } = topologyFixture(root, garden, 3);
    const active = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      topologySlot("S1.P1.E3", 1, ["S1.P1.E3"]),
      topologySlot("S1.P1.E4", 2, ["S1.P1.E1"]),
      topologySlot("S1.P1.E5", 3, []),
    ];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "split", activeSourceVisualIds: ["S1.P1.E1", "S1.P1.E4"], reason: "The first stale slot spans two complete displayed equations." },
      { sourceVisualId: "S1.P1.E2", disposition: "retire", activeSourceVisualIds: [], reason: "The second stale slot is continuation prose, not an active equation." },
      { sourceVisualId: "S1.P1.E3", disposition: "retain", activeSourceVisualIds: ["S1.P1.E3"], reason: "The third slot still identifies its complete equation." },
    ];
    let normalCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(
          normalCalls === 1 ? topologyRejectReviews(old) : approvalsForTopologyInputs(payload.inputVisuals),
        ) } }] };
      }),
      model: "topology-split-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.deepEqual(result.formulaIds, active.map((slot) => slot.sourceVisualId));
    const ledger = loadSourceVisuals(root, garden);
    assert.equal(ledger.some((visual) => visual.sourceVisualId === "S1.P1.E2"), false);
    assert.deepEqual(
      ledger.filter((visual) => visual.type === "equation").map((visual) => visual.sourceVisualId),
      active.map((slot) => slot.sourceVisualId),
    );
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-split-model",
      expectedSourceIds: ["src"],
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 does not rehydrate a topology receipt after canonical source evidence changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-stale-evidence-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-stale-evidence-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const rolledBackLedger = fs.readFileSync(ledgerPath);
    const active = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const graph = [
      {
        sourceVisualId: "S1.P1.E1",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P1.E1"],
        reason: "The two stale crops belong to one complete displayed equation.",
      },
      {
        sourceVisualId: "S1.P1.E2",
        disposition: "merge",
        activeSourceVisualIds: ["S1.P1.E1"],
        reason: "The second stale crop is a continuation line of the first equation.",
      },
    ];
    let normalCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(
          normalCalls === 1 ? topologyRejectReviews(old) : approvalsForTopologyInputs(payload.inputVisuals),
        ) } }] };
      }),
      model: "topology-stale-evidence-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.deepEqual(
      sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]),
      result.topologyReviewPageReceipts,
    );

    // The page PNG intentionally remains untouched.  Only the canonical
    // source Markdown changes, so this proves V5 cannot use a matching PNG as
    // a proxy for the complete signed evidence set.
    const sourcePath = path.join(root, garden, "sources", "src.md");
    const originalSource = fs.readFileSync(sourcePath, "utf-8");
    fs.writeFileSync(
      sourcePath,
      originalSource.replace("Corroborating page text", "Changed canonical page text"),
      "utf-8",
    );
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), []);
    assert.match(
      validateSourceFormulaReviewSet({
        gardenDir: path.join(root, garden),
        gardenSlug: garden,
        requiredFormulaIds: result.formulaIds,
        expectedReviewSetHash: result.reviewedFormulaSetHash,
        expectedModel: "topology-stale-evidence-model",
        expectedSourceIds: ["src"],
        expectedTopologyReviewPageReceipts: result.topologyReviewPageReceipts,
      }).problems.join("; "),
      /topology.*receipt|canonicalPageTextSha256/i,
    );

    // Extraction does not retain or rehydrate that stale V5 receipt.  Even
    // though this particular mismatch is Markdown-only, it first obtains a
    // byte-verified current PDF render before the normal detector path; a
    // low-detail detector is never treated as a topology repair.
    let genericCalls = 0;
    let canonicalPdfRenders = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        return { choices: [{ message: { content: "[]" } }] };
      }),
      model: "generic-stale-evidence-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
      renderPdfPage: async ({ sourcePdf }) => {
        canonicalPdfRenders += 1;
        assert.equal(sourcePdf.toString("utf-8"), "stable pdf bytes");
        return freshPage;
      },
    });
    assert.equal(genericCalls, 1);
    assert.equal(canonicalPdfRenders, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 all-retired formula page retains a page-level topology receipt with zero active formulas", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-zero-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-zero-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const graph = old.map((visual) => ({
      sourceVisualId: visual.sourceVisualId,
      disposition: "retire",
      activeSourceVisualIds: [],
      reason: "This stale equation slot is prose or a continuation line, not a complete displayed equation.",
    }));
    let normalCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse([], graph)) } }] };
        }
        normalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
      }),
      model: "topology-zero-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(normalCalls, 1);
    assert.deepEqual(result.formulaIds, []);
    assert.equal(result.modelCalls, 3);
    assert.deepEqual(result.topologyReviewPageReceipts.map((receipt) => ({
      sourceId: receipt.sourceId,
      pageNumber: receipt.pageNumber,
      activeFormulaIds: receipt.activeFormulaIds,
    })), [{ sourceId: "src", pageNumber: 1, activeFormulaIds: [] }]);
    assert.deepEqual(loadSourceVisuals(root, garden).filter((visual) => visual.type === "equation"), []);
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: [],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-zero-model",
      expectedSourceIds: ["src"],
      expectedTopologyReviewPageReceipts: result.topologyReviewPageReceipts,
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    // A zero-active V5 page can have no formula row to drive a later scan.
    // If its snapshot is deleted, cache discovery still returns the page and
    // extraction restores only the exact canonical-PDF render; it neither
    // calls the generic detector nor launders the tombstone through `[]`.
    const pagePath = path.join(root, garden, "assets", "src-page-001.png");
    fs.unlinkSync(pagePath);
    assert.deepEqual(sourceVisualCachedPageImageUrls(root, garden, "src"), [pageUrl]);
    let missingSnapshotGenericCalls = 0;
    let missingSnapshotPdfRenders = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        missingSnapshotGenericCalls += 1;
        throw new Error("missing V5 snapshot must be restored from canonical PDF before any v3 scan");
      }),
      model: "generic-zero-missing-snapshot-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: sourceVisualCachedPageImageUrls(root, garden, "src"),
      renderPdfPage: async ({ sourcePdf }) => {
        missingSnapshotPdfRenders += 1;
        assert.equal(sourcePdf.toString("utf-8"), "stable pdf bytes");
        return freshPage;
      },
    });
    assert.equal(missingSnapshotGenericCalls, 0);
    assert.equal(missingSnapshotPdfRenders, 1);
    assert.deepEqual(fs.readFileSync(pagePath), freshPage);
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), result.topologyReviewPageReceipts);
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    // A zero-active page has no formula row through which a stale receipt
    // could otherwise be noticed.  Its tombstone must therefore bind the
    // current canonical Markdown and preserved source PDF, not only its PNG.
    const sourcePath = path.join(root, garden, "sources", "src.md");
    const originalSource = fs.readFileSync(sourcePath, "utf-8");
    fs.writeFileSync(
      sourcePath,
      originalSource.replace("Corroborating page text", "Changed canonical page text"),
      "utf-8",
    );
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), []);
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|canonicalPageTextSha256/i,
    );
    fs.writeFileSync(sourcePath, originalSource, "utf-8");
    const pdfPath = path.join(root, garden, "assets", "src-source.pdf");
    const originalPdf = fs.readFileSync(pdfPath);
    fs.writeFileSync(pdfPath, Buffer.from("changed stable pdf bytes"));
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), []);
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|sourcePdfSha256/i,
    );
    fs.writeFileSync(pdfPath, originalPdf);
    // In particular, a fully retired page must not let a missing current PDF
    // erase its only tombstone through a generic `[]` scan.  The stale cache
    // and ledger remain untouched until canonical PDF evidence can be read.
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const beforeMissingPdfCache = fs.readFileSync(scanCachePath);
    fs.unlinkSync(pdfPath);
    let genericCalls = 0;
    await assert.rejects(
      () => extractSourceVisuals({
        client: fakeClient(async () => {
          genericCalls += 1;
          return { choices: [{ message: { content: "[]" } }] };
        }),
        model: "generic-zero-stale-evidence-model",
        contentPath: root,
        gardenSlug: garden,
        sourceId: "src",
        sourceIndex: 1,
        pageImageUrls: [pageUrl],
      }),
      /preserved source PDF|requires the preserved source PDF/i,
    );
    assert.equal(genericCalls, 0);
    assert.deepEqual(fs.readFileSync(scanCachePath), beforeMissingPdfCache);
    fs.writeFileSync(pdfPath, originalPdf);
    // The review-set hash includes this zero-active tombstone. Removing or
    // corrupting its durable V5 cache receipt fails final validation rather
    // than making the page indistinguishable from one that never had formulas.
    const originalScanCache = fs.readFileSync(scanCachePath);
    const deleted = JSON.parse(originalScanCache.toString("utf-8"));
    delete deleted.sources.src[pageUrl];
    fs.writeFileSync(scanCachePath, JSON.stringify(deleted));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|formula-set hash/i,
    );
    fs.writeFileSync(scanCachePath, originalScanCache);
    const tampered = JSON.parse(originalScanCache.toString("utf-8"));
    tampered.sources.src[pageUrl].formulaArtifactTopologyRecovery.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|formula-set hash/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 topology parser rejects duplicate and partial graphs before accepting one bounded repaired whole-page response", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-malformed-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-malformed-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const active = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      topologySlot("S1.P1.E2", 1, ["S1.P1.E2"]),
    ];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"], reason: "First slot remains complete." },
      { sourceVisualId: "S1.P1.E2", disposition: "retain", activeSourceVisualIds: ["S1.P1.E2"], reason: "Second slot remains complete." },
    ];
    let topologyAuthorCalls = 0;
    let normalCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          topologyAuthorCalls += 1;
          if (topologyAuthorCalls === 1) {
            const duplicate = [
              topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
              topologySlot("S1.P1.E1", 1, ["S1.P1.E2"]),
            ];
            return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(duplicate, graph)) } }] };
          }
          if (topologyAuthorCalls === 2) {
            return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph.slice(0, 1))) } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(
          normalCalls === 1 ? topologyRejectReviews(old) : approvalsForTopologyInputs(payload.inputVisuals),
        ) } }] };
      }),
      model: "topology-malformed-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(topologyAuthorCalls, 3);
    assert.equal(result.modelCalls, 6);
    const cache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    assert.equal(cache.sources.src[pageUrl].formulaArtifactTopologyRecovery.repairHistory.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 rejects a retired/remapped old formula id reused for an unrelated active formula", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-id-reuse-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-id-reuse-cache-"));
  try {
    const garden = "garden";
    const { old, freshPage } = topologyFixture(root, garden, 2);
    const beforeLedger = fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json"));
    const invalidActive = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      // E2 is old but is deliberately declared newly discovered; that would
      // silently rebind stale E2 references if accepted.
      topologySlot("S1.P1.E2", 1, []),
    ];
    const invalidGraph = [
      { sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"], reason: "First stays active." },
      { sourceVisualId: "S1.P1.E2", disposition: "retire", activeSourceVisualIds: [], reason: "Second old slot retires." },
    ];
    let authorCalls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (system.includes("formula-topology recovery")) {
            authorCalls += 1;
            return { choices: [{ message: { content: JSON.stringify(
              topologyRecoveryResponse(invalidActive, invalidGraph),
            ) } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }),
        model: "topology-id-reuse-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /cannot reuse a retired or remapped old formula id/,
    );
    assert.equal(authorCalls, 3);
    assert.deepEqual(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json")), beforeLedger);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V6 consumes a signed rejected V5 C1/R1 when current old slots no longer strictly match", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-relaxed-v5-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-relaxed-v5-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Both old rows form one complete equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The second old row continues the first equation." },
    ];
    const candidateOne = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const candidateTwo = [{
      ...candidateOne[0],
      exactText: "t_1\\approx 1",
      caption: "Fresh successor after the independent C1 rejection",
    }];
    const candidateOneRaw = JSON.stringify(topologyRecoveryResponse(candidateOne, graph));
    const candidateTwoRaw = JSON.stringify(topologyRecoveryResponse(candidateTwo, graph));
    const initialRejectedRaw = JSON.stringify({
      status: "rejected",
      reason: "C1 is a complete candidate, but its visible relation is not exact enough to confirm.",
    });
    let v5AuthorCalls = 0;
    let v6AuthorCalls = 0;
    let topologyReviewerCalls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
            topologyReviewerCalls += 1;
            return { choices: [{ message: { content: initialRejectedRaw } }] };
          }
          if (system.includes("bounded successor candidate")) {
            v6AuthorCalls += 1;
            throw new Error("pause after durable rejected C1/R1 before C2");
          }
          if (system.includes("formula-topology recovery")) {
            v5AuthorCalls += 1;
            return { choices: [{ message: { content: candidateOneRaw } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }),
        model: "topology-v6-relaxed-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /pause after durable rejected C1\/R1 before C2/,
    );
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 1);
    assert.equal(topologyReviewerCalls, 1);
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const beforeResume = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    assert.equal(beforeResume.sources.src[pageUrl].detectorVersion, 5);
    assert.equal(beforeResume.sources.src[pageUrl].formulaArtifactTopologyReview.status, "rejected");
    assert.equal(beforeResume.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair, undefined);

    // Simulate the fresh job's same-page current inputs after rollback/review
    // drift. The PDF/Markdown/render are unchanged, but strict V5 old-slot
    // equality must not block the signed C1/R1 from entering bounded V6 C2.
    const drifted = loadSourceVisuals(root, garden).map((visual) =>
      visual.sourceVisualId === "S1.P1.E2"
        ? { ...visual, caption: "Current rejected old slot with a changed caption" }
        : visual,
    );
    saveSourceVisuals(root, garden, drifted);
    let resumedNormalCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewerCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("bounded successor candidate")) {
          v6AuthorCalls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          assert.equal(payload.priorCandidateResponseVerbatim, candidateOneRaw);
          assert.equal(payload.priorIndependentTopologyReviewerResponseVerbatim, initialRejectedRaw);
          return { choices: [{ message: { content: candidateTwoRaw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          throw new Error("the existing C1 must not be re-authored as V5");
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        resumedNormalCalls += 1;
        if (resumedNormalCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        assert.equal(payload.inputVisuals[0].inputExactText, candidateTwo[0].exactText);
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-v6-relaxed-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 2);
    assert.equal(topologyReviewerCalls, 2);
    assert.equal(resumedNormalCalls, 2);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1"]);
    const resumedCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    assert.equal(resumedCache.sources.src[pageUrl].detectorVersion, 6);
    assert.equal(resumedCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.candidates.length, 1);
    assert.equal(
      resumedCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.candidates[0].topologyReview.status,
      "confirmed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V6 carries exact rejected C1/R1 bytes into a fresh complete C2 and confirms it independently", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-confirm-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-confirm-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const rolledBackLedger = fs.readFileSync(ledgerPath);
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Both old rows are one displayed equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The second row is the continuation of the first equation." },
    ];
    const candidateOne = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"]),
    ];
    const candidateTwo = [{
      ...candidateOne[0],
      caption: "Corrected complete topology equality",
      exactText: "u_1\\approx 1",
    }];
    const candidateOneRaw = JSON.stringify(topologyRecoveryResponse(candidateOne, graph));
    const candidateTwoRaw = JSON.stringify(topologyRecoveryResponse(candidateTwo, graph));
    const firstRejected = {
      status: "rejected",
      reason: "The complete page shows a dotted approximation sign that C1 transcribed incorrectly.",
    };
    const firstRejectedRaw = JSON.stringify(firstRejected);
    let normalCalls = 0;
    let v5AuthorCalls = 0;
    let v6AuthorCalls = 0;
    let topologyReviewerCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewerCalls += 1;
          if (topologyReviewerCalls === 1) {
            return { choices: [{ message: { content: firstRejectedRaw } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("bounded successor candidate")) {
          v6AuthorCalls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          assert.equal(payload.priorCandidateResponseVerbatim, candidateOneRaw);
          assert.equal(payload.priorIndependentTopologyReviewerResponseVerbatim, firstRejectedRaw);
          assert.equal(payload.priorIndependentTopologyReviewerReasonVerbatim, firstRejected.reason);
          assert.equal(request.messages[1].content.find((part) => part.type === "image_url").image_url.detail, "high");
          return { choices: [{ message: { content: candidateTwoRaw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          v5AuthorCalls += 1;
          return { choices: [{ message: { content: candidateOneRaw } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        if (normalCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), ["S1.P1.E1"]);
        assert.equal(payload.inputVisuals[0].inputExactText, candidateTwo[0].exactText);
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-v6-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 1);
    assert.equal(topologyReviewerCalls, 2);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1"]);
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const scanCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    const cycle = scanCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair;
    assert.equal(scanCache.sources.src[pageUrl].detectorVersion, 6);
    assert.equal(cycle.candidates.length, 1);
    assert.equal(cycle.candidates[0].candidate.candidateOrdinal, 2);
    assert.equal(cycle.candidates[0].candidate.priorCandidateRawResponse, candidateOneRaw);
    assert.equal(cycle.candidates[0].candidate.priorTopologyReviewRawResponse, firstRejectedRaw);
    assert.equal(cycle.candidates[0].topologyReview.status, "confirmed");
    assert.equal(result.topologyReviewPageReceipts[0].recoveryCacheKey, cycle.cacheKey);
    const reviewed = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === "S1.P1.E1");
    assert.ok(reviewed.formulaReview?.artifactTopologyCandidateRepair);
    assert.equal(reviewed.formulaReview?.artifactTopologyRecovery, undefined);
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-v6-model",
      expectedSourceIds: ["src"],
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    const acceptedLedger = fs.readFileSync(ledgerPath);
    const originalCache = fs.readFileSync(scanCachePath);
    const tampered = JSON.parse(originalCache.toString("utf-8"));
    tampered.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.candidates[0].candidate.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*candidate|formula-set hash/i,
    );
    fs.writeFileSync(scanCachePath, originalCache);

    // A malformed current-evidence V6 master is a durable cap, not permission
    // to overwrite it with the generic detector. Keep the damaged bytes for
    // strict final validation/diagnosis and make no vision call.
    const malformed = JSON.parse(originalCache.toString("utf-8"));
    malformed.sources.src[pageUrl]
      .formulaArtifactTopologyCandidateRepair.candidates[0]
      .candidate.rawResponse += " ";
    const malformedBytes = Buffer.from(JSON.stringify(malformed));
    fs.writeFileSync(scanCachePath, malformedBytes);
    let malformedGenericCalls = 0;
    await assert.rejects(
      () => extractSourceVisuals({
        client: fakeClient(async () => {
          malformedGenericCalls += 1;
          throw new Error("malformed V6 history must never call v3");
        }),
        model: "generic-v6-malformed-model",
        contentPath: root,
        gardenSlug: garden,
        sourceId: "src",
        sourceIndex: 1,
        pageImageUrls: [pageUrl],
      }),
      /candidate repair.*malformed|malformed.*candidate|refusing generic/i,
    );
    assert.equal(malformedGenericCalls, 0);
    assert.deepEqual(fs.readFileSync(scanCachePath), malformedBytes);
    fs.writeFileSync(scanCachePath, originalCache);

    // Review orchestration has the same evidence boundary as extraction. A
    // malformed V6 master for changed canonical evidence must permit one new
    // V5 cycle; the raw cap only blocks reuse for the exact evidence it signed.
    const sourcePath = path.join(root, garden, "sources", "src.md");
    const originalSource = fs.readFileSync(sourcePath, "utf-8");
    const restartedSlot = topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]);
    const restartedGraph = [{
      sourceVisualId: "S1.P1.E1",
      disposition: "retain",
      activeSourceVisualIds: ["S1.P1.E1"],
      reason: "The changed source evidence now retains this one complete equation.",
    }];
    fs.writeFileSync(scanCachePath, malformedBytes);
    fs.writeFileSync(
      sourcePath,
      originalSource.replace("Corroborating page text", "Changed topology source evidence"),
      "utf-8",
    );
    let restartedNormalCalls = 0;
    let restartedV5AuthorCalls = 0;
    let restartedTopologyReviewerCalls = 0;
    const restarted = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          restartedTopologyReviewerCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(restartedGraph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          restartedV5AuthorCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(
            topologyRecoveryResponse([restartedSlot], restartedGraph),
          ) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        restartedNormalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(
          restartedNormalCalls === 1
            ? topologyRejectReviews([old[0]])
            : approvalsForTopologyInputs(payload.inputVisuals),
        ) } }] };
      }),
      model: "changed-evidence-v5-restart-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.deepEqual(restarted.formulaIds, ["S1.P1.E1"]);
    assert.equal(restartedNormalCalls, 2);
    assert.equal(restartedV5AuthorCalls, 1);
    assert.equal(restartedTopologyReviewerCalls, 1);
    const restartedCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    assert.equal(restartedCache.sources.src[pageUrl].detectorVersion, 5);
    assert.equal(restartedCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair, undefined);
    fs.writeFileSync(ledgerPath, acceptedLedger);
    fs.writeFileSync(sourcePath, originalSource, "utf-8");
    fs.writeFileSync(scanCachePath, originalCache);

    // The same damaged receipt must not become a permanent denial of service
    // once its signed canonical source evidence has genuinely changed. Both
    // Markdown and preserved-PDF drift open a new canonical-render/V3 cycle;
    // they do not reuse or silently project any stale V6 candidate.
    fs.writeFileSync(scanCachePath, malformedBytes);
    fs.writeFileSync(
      sourcePath,
      originalSource.replace("Corroborating page text", "Changed topology source evidence"),
      "utf-8",
    );
    let changedMarkdownGenericCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        changedMarkdownGenericCalls += 1;
        return { choices: [{ message: { content: "[]" } }] };
      }),
      model: "generic-v6-changed-markdown-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
      renderPdfPage: async () => freshPage,
    });
    assert.equal(changedMarkdownGenericCalls, 1);
    const markdownInvalidated = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    assert.equal(markdownInvalidated.sources.src[pageUrl].detectorVersion, 3);
    assert.equal(markdownInvalidated.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair, undefined);
    fs.writeFileSync(sourcePath, originalSource, "utf-8");
    fs.writeFileSync(scanCachePath, originalCache);

    const pdfPath = path.join(root, garden, "assets", "src-source.pdf");
    const originalPdf = fs.readFileSync(pdfPath);
    fs.writeFileSync(scanCachePath, malformedBytes);
    fs.writeFileSync(pdfPath, Buffer.from("changed topology source PDF bytes"));
    let changedPdfGenericCalls = 0;
    await extractSourceVisuals({
      client: fakeClient(async () => {
        changedPdfGenericCalls += 1;
        return { choices: [{ message: { content: "[]" } }] };
      }),
      model: "generic-v6-changed-pdf-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
      renderPdfPage: async () => freshPage,
    });
    assert.equal(changedPdfGenericCalls, 1);
    const pdfInvalidated = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    assert.equal(pdfInvalidated.sources.src[pageUrl].detectorVersion, 3);
    assert.equal(pdfInvalidated.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair, undefined);
    fs.writeFileSync(pdfPath, originalPdf);
    fs.writeFileSync(scanCachePath, originalCache);

    // A failed Learn staging rollback removes the ledger but not the signed
    // scan cache. Rehydration must replay C2 exactly, without a low-detail
    // detector or a fresh V5/V6 author/reviewer call.
    fs.writeFileSync(ledgerPath, rolledBackLedger);
    let genericDetectorCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        genericDetectorCalls += 1;
        throw new Error("confirmed V6 receipt must rehydrate without v3");
      }),
      model: "generic-v6-rehydrate-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericDetectorCalls, 0);
    assert.deepEqual(
      rehydrated.filter((visual) => visual.type === "equation").map((visual) => visual.sourceVisualId),
      ["S1.P1.E1"],
    );
    assert.equal(rehydrated.find((visual) => visual.sourceVisualId === "S1.P1.E1").formulaReview, undefined);

    // A later normal reviewer can replace transcription text, but its input
    // is rebound to C2 and the V6 lineage survives a model change.
    let forbiddenV6Calls = 0;
    const later = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (
          system.includes("formula-topology recovery") ||
          system.includes("bounded successor candidate") ||
          system.includes("independently verify a proposed model-authored formula-slot topology")
        ) {
          forbiddenV6Calls += 1;
          throw new Error("confirmed V6 history must be reused, not re-authored");
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        assert.equal(payload.inputVisuals[0].inputExactText, candidateTwo[0].exactText);
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [{
            sourceVisualId: "S1.P1.E1",
            action: "replace",
            acceptedExactText: "u_1\\simeq 1",
            acceptedCaption: "Normalized complete topology equality",
            identityAssessment: "preserved",
            reason: "The same complete crop supports normalized transcription.",
          }],
        }) } }] };
      }),
      model: "later-v6-formula-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(forbiddenV6Calls, 0);
    const laterReviewed = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === "S1.P1.E1");
    assert.equal(laterReviewed.exactText, "u_1\\simeq 1");
    assert.equal(
      laterReviewed.formulaReview?.artifactTopologyCandidateRepair?.cycleCacheKey,
      cycle.cacheKey,
    );
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: later.formulaIds,
      expectedReviewSetHash: later.reviewedFormulaSetHash,
      expectedModel: "later-v6-formula-review-model",
      expectedSourceIds: ["src"],
    }).problems, []);

    // The prior normal reviewer deliberately replaced C2's transcription. A
    // further normal review must still be rebound to the signed C2 candidate,
    // rather than treating the later accepted text as a new topology input and
    // dropping its V6 provenance on a model/cache change.
    let rerunV6Calls = 0;
    const rerun = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (
          system.includes("formula-topology recovery") ||
          system.includes("bounded successor candidate") ||
          system.includes("independently verify a proposed model-authored formula-slot topology")
        ) {
          rerunV6Calls += 1;
          throw new Error("a confirmed V6 lineage must not be regenerated");
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        assert.equal(payload.inputVisuals[0].inputExactText, candidateTwo[0].exactText);
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [{
            sourceVisualId: "S1.P1.E1",
            action: "replace",
            acceptedExactText: "u_1\\simeq 1",
            acceptedCaption: "Normalized complete topology equality",
            identityAssessment: "preserved",
            reason: "The same complete crop supports the normalized transcription.",
          }],
        }) } }] };
      }),
      model: "rerun-v6-formula-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(rerunV6Calls, 0);
    const rerunReviewed = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === "S1.P1.E1");
    assert.equal(rerunReviewed.exactText, "u_1\\simeq 1");
    assert.equal(
      rerunReviewed.formulaReview?.artifactTopologyCandidateRepair?.cycleCacheKey,
      cycle.cacheKey,
    );
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: rerun.formulaIds,
      expectedReviewSetHash: rerun.reviewedFormulaSetHash,
      expectedModel: "rerun-v6-formula-review-model",
      expectedSourceIds: ["src"],
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V6 retains a zero-active topology tombstone after C1 is rejected and C2 is confirmed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-zero-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-zero-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const rolledBackLedger = fs.readFileSync(ledgerPath);
    const graph = old.map((visual) => ({
      sourceVisualId: visual.sourceVisualId,
      disposition: "retire",
      activeSourceVisualIds: [],
      reason: "The complete page does not support this stale partial formula slot.",
    }));
    const candidateOneRaw = JSON.stringify(topologyRecoveryResponse([], graph));
    const candidateTwoRaw = JSON.stringify(topologyRecoveryResponse([], graph));
    let normalCalls = 0;
    let v5AuthorCalls = 0;
    let v6AuthorCalls = 0;
    let topologyReviewerCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewerCalls += 1;
          if (topologyReviewerCalls === 1) {
            return { choices: [{ message: { content: JSON.stringify({
              status: "rejected",
              reason: "C1 did not provide enough whole-page evidence for its retirement inventory.",
            }) } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("bounded successor candidate")) {
          v6AuthorCalls += 1;
          return { choices: [{ message: { content: candidateTwoRaw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          v5AuthorCalls += 1;
          return { choices: [{ message: { content: candidateOneRaw } }] };
        }
        normalCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
      }),
      model: "topology-v6-zero-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(normalCalls, 1);
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 1);
    assert.equal(topologyReviewerCalls, 2);
    assert.deepEqual(result.formulaIds, []);
    assert.deepEqual(result.topologyReviewPageReceipts.map((receipt) => ({
      sourceId: receipt.sourceId,
      pageNumber: receipt.pageNumber,
      activeFormulaIds: receipt.activeFormulaIds,
    })), [{ sourceId: "src", pageNumber: 1, activeFormulaIds: [] }]);
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const scanCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    const cycle = scanCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair;
    assert.equal(scanCache.sources.src[pageUrl].detectorVersion, 6);
    assert.equal(cycle.candidates.length, 1);
    assert.equal(cycle.candidates[0].topologyReview.status, "confirmed");
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: [],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-v6-zero-model",
      expectedSourceIds: ["src"],
      expectedTopologyReviewPageReceipts: result.topologyReviewPageReceipts,
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);

    // The V6 tombstone is the sole durable evidence on an all-retired page.
    // Rehydrating a rolled-back ledger must replay that signed final C2 page
    // without turning the page into a generic empty scan.
    fs.writeFileSync(ledgerPath, rolledBackLedger);
    let genericCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        throw new Error("confirmed V6 tombstone must not call the generic detector");
      }),
      model: "generic-v6-zero-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericCalls, 0);
    assert.deepEqual(rehydrated.filter((visual) => visual.type === "equation"), []);
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), result.topologyReviewPageReceipts);
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);

    const originalCache = fs.readFileSync(scanCachePath);
    const deleted = JSON.parse(originalCache.toString("utf-8"));
    delete deleted.sources.src[pageUrl];
    fs.writeFileSync(scanCachePath, JSON.stringify(deleted));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|formula-set hash/i,
    );
    fs.writeFileSync(scanCachePath, originalCache);
    const tampered = JSON.parse(originalCache.toString("utf-8"));
    tampered.sources.src[pageUrl]
      .formulaArtifactTopologyCandidateRepair.initialTopologyReview.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*candidate|topology.*receipt|formula-set hash/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V6 advances a rejected C2 to a fresh C3 and confirms only the terminal candidate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-c3-confirm-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v6-c3-confirm-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The two old rows form one complete equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The second old row is part of that same displayed equation." },
    ];
    const candidateOne = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const candidateTwo = [{ ...candidateOne[0], exactText: "t_1\\approx 1", caption: "Second complete topology candidate" }];
    const candidateThree = [{ ...candidateOne[0], exactText: "t_1\\simeq 1", caption: "Third complete topology candidate" }];
    const candidateOneRaw = JSON.stringify(topologyRecoveryResponse(candidateOne, graph));
    const candidateTwoRaw = JSON.stringify(topologyRecoveryResponse(candidateTwo, graph));
    const candidateThreeRaw = JSON.stringify(topologyRecoveryResponse(candidateThree, graph));
    const firstRejectedRaw = JSON.stringify({
      status: "rejected",
      reason: "C1's complete inventory still misreads the visible relation.",
    });
    const secondRejectedRaw = JSON.stringify({
      status: "rejected",
      reason: "C2 remains a valid full candidate but the visible relation is still not exact.",
    });
    let normalCalls = 0;
    let v5AuthorCalls = 0;
    let v6AuthorCalls = 0;
    let topologyReviewerCalls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyReviewerCalls += 1;
          if (topologyReviewerCalls === 1) {
            return { choices: [{ message: { content: firstRejectedRaw } }] };
          }
          if (topologyReviewerCalls === 2) {
            return { choices: [{ message: { content: secondRejectedRaw } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("bounded successor candidate")) {
          v6AuthorCalls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          if (v6AuthorCalls === 1) {
            assert.equal(payload.priorCandidateResponseVerbatim, candidateOneRaw);
            assert.equal(payload.priorIndependentTopologyReviewerResponseVerbatim, firstRejectedRaw);
            return { choices: [{ message: { content: candidateTwoRaw } }] };
          }
          assert.equal(payload.priorCandidateResponseVerbatim, candidateTwoRaw);
          assert.equal(payload.priorIndependentTopologyReviewerResponseVerbatim, secondRejectedRaw);
          assert.equal(payload.priorIndependentTopologyReviewerReasonVerbatim, JSON.parse(secondRejectedRaw).reason);
          return { choices: [{ message: { content: candidateThreeRaw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          v5AuthorCalls += 1;
          return { choices: [{ message: { content: candidateOneRaw } }] };
        }
        normalCalls += 1;
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        if (normalCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        assert.equal(payload.inputVisuals[0].inputExactText, candidateThree[0].exactText);
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-v6-c3-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(normalCalls, 2);
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 2);
    assert.equal(topologyReviewerCalls, 3);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1"]);
    const cache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    const cycle = cache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair;
    assert.equal(cycle.candidates.length, 2);
    assert.equal(cycle.candidates[0].candidate.candidateOrdinal, 2);
    assert.equal(cycle.candidates[0].topologyReview.status, "rejected");
    assert.equal(cycle.candidates[1].candidate.candidateOrdinal, 3);
    assert.equal(cycle.candidates[1].candidate.rawResponse, candidateThreeRaw);
    assert.equal(cycle.candidates[1].topologyReview.status, "confirmed");
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-v6-c3-model",
      expectedSourceIds: ["src"],
      expectedTopologyReviewPageReceipts: result.topologyReviewPageReceipts,
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V6 caps three total model-authored topology candidates after independent rejections", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-reject-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-reject-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const beforeLedger = fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json"));
    const active = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"]),
    ];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Proposed merge." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Proposed merge." },
    ];
    let v5AuthorCalls = 0;
    let v6AuthorCalls = 0;
    let reviewerCalls = 0;
    const rejectingClient = fakeClient(async (request) => {
      const system = String(request.messages[0].content);
      if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
        reviewerCalls += 1;
        return { choices: [{ message: { content: JSON.stringify({
          status: "rejected",
          reason: "The high-resolution page does not prove this proposed merge.",
        }) } }] };
      }
      if (system.includes("bounded successor candidate")) {
        v6AuthorCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
      }
      if (system.includes("formula-topology recovery")) {
        v5AuthorCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
      }
      return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
    });
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: rejectingClient,
        model: "topology-reject-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /exhausted 3 total model-authored candidates/,
    );
    assert.equal(v5AuthorCalls, 1);
    assert.equal(v6AuthorCalls, 2);
    assert.equal(reviewerCalls, 3);
    assert.deepEqual(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json")), beforeLedger);
    const scanCache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    assert.equal(scanCache.sources.src[pageUrl].detectorVersion, 6);
    assert.equal(scanCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.initialTopologyReview.status, "rejected");
    assert.equal(scanCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.candidates.length, 2);
    assert.equal(
      scanCache.sources.src[pageUrl].formulaArtifactTopologyCandidateRepair.candidates[1].topologyReview.status,
      "rejected",
    );
    let forbiddenAuthorCalls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (
            system.includes("formula-topology recovery") ||
            system.includes("bounded successor candidate") ||
            system.includes("independently verify a proposed model-authored formula-slot topology")
          ) {
            forbiddenAuthorCalls += 1;
            throw new Error("V6 cap must prevent another recovery/reviewer call");
          }
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }),
        model: "later-topology-reject-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /exhausted 3 total model-authored candidates/,
    );
    assert.equal(forbiddenAuthorCalls, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json")), beforeLedger);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 retries only the independent topology reviewer after a transport failure, never re-detecting the page", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-review-retry-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-review-retry-cache-"));
  try {
    const garden = "garden";
    const { old, freshPage } = topologyFixture(root, garden, 2);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const beforeLedger = fs.readFileSync(ledgerPath);
    const active = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "One complete equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Continuation line." },
    ];
    let phase = 1;
    let authorCalls = 0;
    let topologyReviewerCalls = 0;
    const client = fakeClient(async (request) => {
      const system = String(request.messages[0].content);
      if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
        topologyReviewerCalls += 1;
        if (phase === 1) throw new Error("temporary topology-review transport failure");
        return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
      }
      if (system.includes("formula-topology recovery")) {
        authorCalls += 1;
        return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
      }
      const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
      return { choices: [{ message: { content: JSON.stringify(
        payload.inputVisuals.length === old.length
          ? topologyRejectReviews(old)
          : approvalsForTopologyInputs(payload.inputVisuals),
      ) } }] };
    });
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client,
        model: "topology-review-retry-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /temporary topology-review transport failure/,
    );
    assert.equal(authorCalls, 1);
    assert.equal(topologyReviewerCalls, 1);
    assert.deepEqual(fs.readFileSync(ledgerPath), beforeLedger);
    phase = 2;
    const recovered = await reviewRequiredSourceFormulaExactText({
      client,
      model: "topology-review-retry-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(authorCalls, 1);
    assert.equal(topologyReviewerCalls, 2);
    assert.deepEqual(recovered.formulaIds, ["S1.P1.E1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V5 accepted receipt rehydrates a rolled-back full page without v3 and retains lineage across a later reviewer model", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-rehydrate-"));
  const initialCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-rehydrate-cache-"));
  const laterCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-rehydrate-later-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const rolledBackLedger = fs.readFileSync(ledgerPath);
    const active = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"]),
    ];
    const graph = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The first and second stale slots form one displayed equation." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The second stale slot is the continuation line of the first equation." },
    ];
    let initialTopologyAuthorCalls = 0;
    await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
        }
        if (system.includes("formula-topology recovery")) {
          initialTopologyAuthorCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(active, graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        return { choices: [{ message: { content: JSON.stringify(
          payload.inputVisuals[0].sourceVisualId === "S1.P1.E1" && payload.inputVisuals.length === 2
            ? topologyRejectReviews(old)
            : approvalsForTopologyInputs(payload.inputVisuals),
        ) } }] };
      }),
      model: "topology-author-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot: initialCacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(initialTopologyAuthorCalls, 1);
    // Simulate later Learn rollback: only the ledger rolls back; durable scan
    // cache and its high-res render remain to converge the next extraction.
    fs.writeFileSync(ledgerPath, rolledBackLedger);
    let genericDetectorCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        genericDetectorCalls += 1;
        throw new Error("V5 cache must prevent low-detail detector replay");
      }),
      model: "generic-detector-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericDetectorCalls, 0);
    assert.deepEqual(rehydrated.filter((visual) => visual.type === "equation").map((visual) => visual.sourceVisualId), ["S1.P1.E1"]);
    assert.equal(rehydrated[0].formulaReview, undefined);
    let forbiddenRecoveryCalls = 0;
    const later = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("formula-topology recovery") || system.includes("independently verify a proposed model-authored formula-slot topology")) {
          forbiddenRecoveryCalls += 1;
          throw new Error("accepted V5 receipt must be reused, not re-authored");
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), ["S1.P1.E1"]);
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          ordinaryReviewerReplacement(
            "S1.P1.E1",
            "t_1\\simeq 1",
            "Normal-review refinement after topology confirmation",
          ),
        ] }) } }] };
      }),
      model: "later-formula-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot: laterCacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(forbiddenRecoveryCalls, 0);
    const reviewed = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === "S1.P1.E1");
    assert.equal(reviewed.formulaReview.model, "later-formula-review-model");
    assert.equal(reviewed.formulaReview.artifactTopologyRecovery.model, "topology-author-model");
    const topologyReceiptsBeforeLateDiscovery = sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]);
    assert.deepEqual(topologyReceiptsBeforeLateDiscovery, later.topologyReviewPageReceipts);

    // The source-map pass can discover a later unrelated page after this
    // normal replacement.  Re-running the complete formula set under the
    // same model must reuse the original V5 candidate request for page one,
    // not treat the accepted normal text/caption as a topology candidate and
    // silently lose its durable receipt/provenance.
    const late = appendLateFormulaPage(root, garden, 2);
    let lateReviewerCalls = 0;
    const lateReReviewed = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        assert.ok(!system.includes("formula-topology recovery"));
        assert.ok(!system.includes("independently verify a proposed model-authored formula-slot topology"));
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        // Page one is a same-model cache hit only when it has first been
        // rebound to the signed V5 active slot.  Any call for E1 here would
        // be the late full-ledger lineage loss that failed live staging.
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), [late.sourceVisualId]);
        lateReviewerCalls += 1;
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          acceptedReview(late.sourceVisualId, late.pageNumber),
        ] }) } }] };
      }),
      model: "later-formula-review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1", late.sourceVisualId],
      cacheRoot: laterCacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(lateReviewerCalls, 1);
    assert.deepEqual(lateReReviewed.formulaIds, ["S1.P1.E1", late.sourceVisualId]);
    const lateReviewed = loadSourceVisuals(root, garden).find((visual) => visual.sourceVisualId === "S1.P1.E1");
    assert.equal(lateReviewed.formulaReview.model, "later-formula-review-model");
    assert.equal(lateReviewed.formulaReview.artifactTopologyRecovery.model, "topology-author-model");
    assert.deepEqual(
      sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]),
      topologyReceiptsBeforeLateDiscovery,
    );

    const acceptedLedger = fs.readFileSync(ledgerPath);
    await extractSourceVisuals({
      client: fakeClient(async () => {
        genericDetectorCalls += 1;
        throw new Error("faithful V5 projection should not be replayed");
      }),
      model: "generic-detector-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericDetectorCalls, 0);
    assert.deepEqual(fs.readFileSync(ledgerPath), acceptedLedger);
    assert.deepEqual(validateSourceFormulaReviewSet({
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: lateReReviewed.formulaIds,
      expectedReviewSetHash: lateReReviewed.reviewedFormulaSetHash,
      expectedModel: "later-formula-review-model",
      expectedSourceIds: ["src"],
      expectedTopologyReviewPageReceipts: lateReReviewed.topologyReviewPageReceipts,
    }).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(initialCacheRoot, { recursive: true, force: true });
    fs.rmSync(laterCacheRoot, { recursive: true, force: true });
  }
});

test("strict formula-review validation detects durable response, provenance, and crop tampering", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-tamper-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-tamper-cache-"));
  try {
    const garden = "garden";
    seedFormulaReviewGarden(root, garden, [1]);
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => ({ choices: [{ message: { content: JSON.stringify({
        reviews: [acceptedReview("S1.P1.E1", 1)],
      }) } }] })),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: ["S1.P1.E1"],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "review-model",
      expectedSourceIds: ["src"],
    };
    const [reviewed] = loadSourceVisuals(root, garden);
    const recordPath = path.join(root, garden, ...reviewed.formulaReview.reviewRecordPath.split("/"));
    const originalRecord = fs.readFileSync(recordPath);
    const envelope = JSON.parse(originalRecord.toString("utf-8"));
    envelope.rawResponse += " ";
    fs.writeFileSync(recordPath, JSON.stringify(envelope));
    assert.match(validateSourceFormulaReviewSet(validationOptions).problems.join("; "), /record integrity failed/);

    fs.writeFileSync(recordPath, originalRecord);
    const tamperedLedger = loadSourceVisuals(root, garden);
    tamperedLedger[0].formulaReview.reviewedAt = "2099-01-01T00:00:00.000Z";
    saveSourceVisuals(root, garden, tamperedLedger);
    assert.match(validateSourceFormulaReviewSet(validationOptions).problems.join("; "), /reviewedAt/);

    saveSourceVisuals(root, garden, [reviewed]);
    const cropPath = path.join(
      root,
      garden,
      ...reviewed.croppedImagePath.slice(`/${garden}/`.length).split("/"),
    );
    fs.writeFileSync(cropPath, Buffer.from("tampered crop"));
    assert.match(validateSourceFormulaReviewSet(validationOptions).problems.join("; "), /crop projection/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("a corrupt canonical review cache is replaced after an AI miss and becomes a healthy next-run hit", async () => {
  const roots = [0, 1, 2].map(() => fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-cache-recover-")));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-cache-recover-store-"));
  try {
    const garden = "garden";
    for (const root of roots) seedFormulaReviewGarden(root, garden, [1]);
    const run = (root, client) => reviewRequiredSourceFormulaExactText({
      client,
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    const validClient = fakeClient(async () => ({ choices: [{ message: { content: JSON.stringify({
      reviews: [acceptedReview("S1.P1.E1", 1)],
    }) } }] }));
    await run(roots[0], validClient);
    const cacheFile = fs.readdirSync(cacheRoot, { recursive: true })
      .map(String)
      .find((name) => /^[a-f0-9]{64}\.json$/.test(path.basename(name)));
    assert.ok(cacheFile);
    fs.writeFileSync(path.join(cacheRoot, cacheFile), "corrupt");

    let recoveryCalls = 0;
    const recovered = await run(roots[1], fakeClient(async () => {
      recoveryCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        reviews: [acceptedReview("S1.P1.E1", 1)],
      }) } }] };
    }));
    assert.equal(recoveryCalls, 1);
    assert.equal(recovered.modelCalls, 1);

    let nextCalls = 0;
    const reused = await run(roots[2], fakeClient(async () => {
      nextCalls += 1;
      throw new Error("healthy cache should prevent a call");
    }));
    assert.equal(nextCalls, 0);
    assert.equal(reused.modelCalls, 0);
    assert.deepEqual(reused.cacheHitFormulaIds, ["S1.P1.E1"]);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("transient external cache-read EPERM retries without causing a duplicate model call", async () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-cache-read-first-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-cache-read-second-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-cache-read-store-"));
  const originalReadFileSync = fs.readFileSync;
  try {
    const garden = "garden";
    seedFormulaReviewGarden(firstRoot, garden, [1]);
    seedFormulaReviewGarden(secondRoot, garden, [1]);
    await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => ({ choices: [{ message: { content: JSON.stringify({
        reviews: [acceptedReview("S1.P1.E1", 1)],
      }) } }] })),
      model: "transient-cache-read-model",
      contentPath: firstRoot,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    const relativeCacheFile = fs.readdirSync(cacheRoot, { recursive: true })
      .map(String)
      .find((name) => /^[a-f0-9]{64}\.json$/.test(path.basename(name)));
    assert.ok(relativeCacheFile);
    const cacheFile = path.resolve(cacheRoot, relativeCacheFile);
    let transientReads = 0;
    fs.readFileSync = function transientCacheRead(filePath, ...args) {
      if (path.resolve(String(filePath)) === cacheFile && transientReads < 2) {
        transientReads += 1;
        throw Object.assign(new Error("EPERM: operation not permitted, open cache"), {
          code: "EPERM",
        });
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };
    let modelCalls = 0;
    const reused = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async () => {
        modelCalls += 1;
        throw new Error("transient cache read must not cause another model call");
      }),
      model: "transient-cache-read-model",
      contentPath: secondRoot,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    assert.equal(transientReads, 2);
    assert.equal(modelCalls, 0);
    assert.equal(reused.modelCalls, 0);
    assert.deepEqual(reused.cacheHitFormulaIds, ["S1.P1.E1"]);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("multiple formulas on one page require one complete one-to-one AI page batch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-multi-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-multi-cache-"));
  try {
    const garden = "garden";
    const [first] = seedFormulaReviewGarden(root, garden, [1]);
    saveSourceVisuals(root, garden, [
      first,
      {
        ...first,
        sourceVisualId: "S1.P1.E2",
        caption: "Untrusted second formula",
        exactText: "y=0",
        bbox: { x: 0.2, y: 0.62, width: 0.5, height: 0.12 },
      },
    ]);
    let calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        calls += 1;
        assert.equal(request.messages[1].content.filter((part) => part.type === "image_url").length, 3);
        return { choices: [{ message: { content: JSON.stringify({ reviews: [
          acceptedReview("S1.P1.E1", 1),
          {
            sourceVisualId: "S1.P1.E2",
            action: "replace",
            acceptedExactText: "y=2",
            acceptedCaption: "Verified second formula",
            identityAssessment: "preserved",
            reason: "The second labeled crop shows the full y equality.",
          },
        ] }) } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P1.E1", "S1.P1.E2"],
      cacheRoot,
      renderPdfPage: async () => solidPng(),
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.newlyReplacedFormulaIds, ["S1.P1.E1", "S1.P1.E2"]);
    const records = new Set(loadSourceVisuals(root, garden).map((visual) =>
      visual.formulaReview.reviewRecordPath));
    assert.equal(records.size, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V7 repairs a confirmed topology candidate only after exact normal-review disagreement and binds the complete receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-consensus-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-consensus-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const graphOne = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "Both old slots are one boxed display." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "The second old slot is continuation text in that boxed display." },
    ];
    const graphTwo = [
      { sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"], reason: "The first numbered display remains distinct." },
      { sourceVisualId: "S1.P1.E2", disposition: "retain", activeSourceVisualIds: ["S1.P1.E2"], reason: "The second numbered display remains distinct." },
    ];
    const candidateOne = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const candidateTwo = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      topologySlot("S1.P1.E2", 1, ["S1.P1.E2"]),
    ];
    const candidateOneRaw = JSON.stringify(topologyRecoveryResponse(candidateOne, graphOne));
    const candidateTwoRaw = JSON.stringify(topologyRecoveryResponse(candidateTwo, graphTwo));
    const normalRejectRaw = JSON.stringify({
      reviews: [{
        sourceVisualId: "S1.P1.E1",
        action: "reject",
        identityAssessment: "identity_mismatch",
        topologyAssessment: "topology_change",
        reason: "The boxed crop contains two independently numbered displays, not one merged equation.",
      }],
    });
    let normalCalls = 0;
    let topologyCalls = 0;
    let v5Calls = 0;
    let v7Calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyCalls += 1;
          return {
            choices: [{
              message: {
                content: JSON.stringify(topologyConfirmation(topologyCalls === 1 ? graphOne : graphTwo)),
              },
            }],
          };
        }
        if (system.includes("two independent checks disagreed")) {
          v7Calls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          assert.equal(payload.baseTopologyCandidateResponseVerbatim, candidateOneRaw);
          assert.equal(payload.triggerNormalFormulaReviewerResponseVerbatim, normalRejectRaw);
          assert.equal(payload.priorFeedbackVerbatim, normalRejectRaw);
          assert.equal(request.messages[1].content.find((part) => part.type === "image_url").image_url.detail, "high");
          return { choices: [{ message: { content: candidateTwoRaw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          v5Calls += 1;
          return { choices: [{ message: { content: candidateOneRaw } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        if (normalCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        if (normalCalls === 2) {
          assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), ["S1.P1.E1"]);
          return { choices: [{ message: { content: normalRejectRaw } }] };
        }
        assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), ["S1.P1.E1", "S1.P1.E2"]);
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-v7-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(v5Calls, 1);
    assert.equal(v7Calls, 1);
    assert.equal(topologyCalls, 2);
    assert.equal(normalCalls, 3);
    assert.equal(result.modelCalls, 7);
    assert.deepEqual(result.formulaIds, ["S1.P1.E1", "S1.P1.E2"]);
    assert.equal(result.topologyReviewPageReceipts[0].recoveryProtocol, "v7");
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const scanCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    const cycle = scanCache.sources.src[pageUrl].formulaArtifactTopologyConsensusRepair;
    assert.equal(scanCache.sources.src[pageUrl].detectorVersion, 7);
    assert.equal(cycle.base.protocol, "v5");
    assert.equal(cycle.triggerFormulaReview.failedReview.rawResponse, normalRejectRaw);
    assert.equal(cycle.candidates.length, 1);
    assert.equal(cycle.candidates[0].candidate.candidateOrdinal, 2);
    assert.equal(cycle.candidates[0].topologyReview.status, "confirmed");
    assert.equal(cycle.candidates[0].formulaReviewFeedback, undefined);
    const reviewed = loadSourceVisuals(root, garden);
    assert.ok(reviewed.every((visual) =>
      visual.type !== "equation" || visual.formulaReview?.artifactTopologyConsensusRepair,
    ));
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: result.formulaIds,
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-v7-model",
      expectedSourceIds: ["src"],
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);
    // The V7 master survives a rollback-owned ledger restore. Re-extraction
    // must replay only the confirmed model-authored C2 page inventory, not
    // call the generic low-detail detector or allocate fresh source ids.
    saveSourceVisuals(root, garden, old);
    let genericCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        throw new Error("confirmed V7 receipt must not fall back to v3");
      }),
      model: "generic-v7-rehydrate-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericCalls, 0);
    assert.deepEqual(
      rehydrated.filter((visual) => visual.type === "equation").map((visual) => visual.sourceVisualId),
      ["S1.P1.E1", "S1.P1.E2"],
    );
    saveSourceVisuals(root, garden, reviewed);
    const originalCache = fs.readFileSync(scanCachePath);
    const tampered = JSON.parse(originalCache.toString("utf-8"));
    tampered.sources.src[pageUrl].formulaArtifactTopologyConsensusRepair.candidates[0]
      .candidate.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /consensus|topology|formula-set hash/i,
    );
    fs.writeFileSync(scanCachePath, originalCache);
    // Row provenance must bind the V7 master exactly and remain mutually
    // exclusive with the earlier V4/V5/V6 recovery variants.
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const originalLedger = fs.readFileSync(ledgerPath);
    const provenanceTampered = JSON.parse(originalLedger.toString("utf-8"));
    provenanceTampered.find((visual) => visual.sourceVisualId === "S1.P1.E1")
      .formulaReview.artifactTopologyConsensusRepair.model = "tampered-v7-model";
    fs.writeFileSync(ledgerPath, JSON.stringify(provenanceTampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /consensus(?:-repair|Repair).*provenance/i,
    );
    const mutuallyExclusiveTampered = JSON.parse(originalLedger.toString("utf-8"));
    mutuallyExclusiveTampered.find((visual) => visual.sourceVisualId === "S1.P1.E1")
      .formulaReview.artifactTopologyRecovery = {};
    fs.writeFileSync(ledgerPath, JSON.stringify(mutuallyExclusiveTampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /multiple topology recovery provenance variants|consensus(?:-repair|Repair).*provenance/i,
    );
    fs.writeFileSync(ledgerPath, originalLedger);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V7 carries a signed C2 normal-review rejection into C3 and caps the candidate ordinal at three", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-c3-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-c3-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 2);
    const graphOne = [
      { sourceVisualId: "S1.P1.E1", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "C1 joins the old rows." },
      { sourceVisualId: "S1.P1.E2", disposition: "merge", activeSourceVisualIds: ["S1.P1.E1"], reason: "C1 treats the second old row as continuation." },
    ];
    const graphSplit = [
      { sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"], reason: "First display is distinct." },
      { sourceVisualId: "S1.P1.E2", disposition: "retain", activeSourceVisualIds: ["S1.P1.E2"], reason: "Second display is distinct." },
    ];
    const c1 = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1", "S1.P1.E2"])];
    const c2 = [
      topologySlot("S1.P1.E1", 0, ["S1.P1.E1"]),
      topologySlot("S1.P1.E2", 1, ["S1.P1.E2"]),
    ];
    const c3 = c2.map((slot, index) => ({
      ...slot,
      exactText: index === 0 ? "r_1\\simeq 1" : "r_2\\simeq 2",
      caption: `Consensus C3 display ${index + 1}`,
    }));
    const c1Raw = JSON.stringify(topologyRecoveryResponse(c1, graphOne));
    const c2Raw = JSON.stringify(topologyRecoveryResponse(c2, graphSplit));
    const c3Raw = JSON.stringify(topologyRecoveryResponse(c3, graphSplit));
    const n1Raw = JSON.stringify({ reviews: [{
      sourceVisualId: "S1.P1.E1", action: "reject", identityAssessment: "identity_mismatch",
      topologyAssessment: "topology_change", reason: "C1 merged two separately numbered displays.",
    }] });
    const n2Raw = JSON.stringify({ reviews: [
      recoveredApproval("S1.P1.E1", c2[0].exactText, c2[0].caption),
      {
        sourceVisualId: "S1.P1.E2", action: "reject", identityAssessment: "identity_mismatch",
        topologyAssessment: "topology_change", reason: "C2 still has a source-fidelity disagreement on the second display.",
      },
    ] });
    let normalCalls = 0;
    let topologyCalls = 0;
    let v7Calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyCalls += 1;
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(
            topologyCalls === 1 ? graphOne : graphSplit,
          )) } }] };
        }
        if (system.includes("two independent checks disagreed")) {
          v7Calls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          if (v7Calls === 1) {
            assert.equal(payload.priorFeedbackVerbatim, n1Raw);
            return { choices: [{ message: { content: c2Raw } }] };
          }
          assert.equal(payload.priorCandidateResponseVerbatim, c2Raw);
          assert.equal(payload.priorFeedbackVerbatim, n2Raw);
          return { choices: [{ message: { content: c3Raw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          return { choices: [{ message: { content: c1Raw } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        if (normalCalls === 1) return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        if (normalCalls === 2) return { choices: [{ message: { content: n1Raw } }] };
        if (normalCalls === 3) return { choices: [{ message: { content: n2Raw } }] };
        assert.deepEqual(payload.inputVisuals.map((input) => input.inputExactText), c3.map((slot) => slot.exactText));
        return { choices: [{ message: { content: JSON.stringify(approvalsForTopologyInputs(payload.inputVisuals)) } }] };
      }),
      model: "topology-v7-c3-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(v7Calls, 2);
    assert.equal(topologyCalls, 3);
    assert.equal(normalCalls, 4);
    assert.equal(result.modelCalls, 10);
    const cache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    const cycle = cache.sources.src[pageUrl].formulaArtifactTopologyConsensusRepair;
    assert.deepEqual(cycle.candidates.map((entry) => entry.candidate.candidateOrdinal), [2, 3]);
    assert.equal(cycle.candidates[0].formulaReviewFeedback.failedReview.rawResponse, n2Raw);
    assert.equal(cycle.candidates[1].topologyReview.status, "confirmed");
    assert.equal(result.topologyReviewPageReceipts[0].recoveryProtocol, "v7");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V7 exhausts three total candidates fail-closed and retains its terminal normal-review feedback cap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-cap-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-cap-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 1);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const ledgerBefore = fs.readFileSync(ledgerPath);
    const graph = [{
      sourceVisualId: "S1.P1.E1", disposition: "retain", activeSourceVisualIds: ["S1.P1.E1"],
      reason: "The candidate accounts for the one supplied old display.",
    }];
    const c1 = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1"])];
    const c2 = [{ ...c1[0], exactText: "q_1\\approx 1", caption: "Consensus candidate two" }];
    const c3 = [{ ...c1[0], exactText: "q_1\\simeq 1", caption: "Consensus candidate three" }];
    const c1Raw = JSON.stringify(topologyRecoveryResponse(c1, graph));
    const c2Raw = JSON.stringify(topologyRecoveryResponse(c2, graph));
    const c3Raw = JSON.stringify(topologyRecoveryResponse(c3, graph));
    const rejection = (reason) => JSON.stringify({ reviews: [{
      sourceVisualId: "S1.P1.E1", action: "reject", identityAssessment: "identity_mismatch",
      topologyAssessment: "topology_change", reason,
    }] });
    const n1Raw = rejection("Normal reviewer disagrees with confirmed C1 topology.");
    const n2Raw = rejection("Normal reviewer disagrees with confirmed C2 topology.");
    const n3Raw = rejection("Normal reviewer disagrees with confirmed C3 topology.");
    let normalCalls = 0;
    let v7Calls = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
            return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(graph)) } }] };
          }
          if (system.includes("two independent checks disagreed")) {
            v7Calls += 1;
            return { choices: [{ message: { content: v7Calls === 1 ? c2Raw : c3Raw } }] };
          }
          if (system.includes("formula-topology recovery")) {
            return { choices: [{ message: { content: c1Raw } }] };
          }
          normalCalls += 1;
          return { choices: [{ message: { content: normalCalls === 1
            ? JSON.stringify(topologyRejectReviews(old))
            : normalCalls === 2 ? n1Raw : normalCalls === 3 ? n2Raw : n3Raw } }] };
        }),
        model: "topology-v7-cap-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /consensus repair exhausted 3 total model-authored candidates/i,
    );
    assert.equal(v7Calls, 2);
    assert.equal(normalCalls, 4);
    assert.deepEqual(fs.readFileSync(ledgerPath), ledgerBefore);
    const cache = JSON.parse(fs.readFileSync(
      path.join(root, garden, ".breadboard", "source-visual-scan-cache.json"),
      "utf-8",
    ));
    const cycle = cache.sources.src[pageUrl].formulaArtifactTopologyConsensusRepair;
    assert.equal(cycle.candidates.length, 2);
    assert.equal(cycle.candidates[1].candidate.candidateOrdinal, 3);
    assert.equal(cycle.candidates[1].formulaReviewFeedback.failedReview.rawResponse, n3Raw);
    let secondRunAuthors = 0;
    await assert.rejects(
      () => reviewRequiredSourceFormulaExactText({
        client: fakeClient(async (request) => {
          const system = String(request.messages[0].content);
          if (system.includes("two independent checks disagreed") ||
              system.includes("formula-topology recovery") ||
              system.includes("independently verify a proposed model-authored formula-slot topology")) {
            secondRunAuthors += 1;
            throw new Error("durable V7 cap must not make another recovery/reviewer call");
          }
          return { choices: [{ message: { content: n3Raw } }] };
        }),
        model: "different-normal-review-model",
        contentPath: root,
        gardenSlug: garden,
        selectedSourceIds: ["src"],
        requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
        cacheRoot,
        renderPdfPage: async () => freshPage,
      }),
      /consensus repair exhausted 3 total model-authored candidates/i,
    );
    assert.equal(secondRunAuthors, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("V7 all-retired inventory binds explicit page-level normal reject/confirm receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-zero-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-topology-v7-zero-cache-"));
  try {
    const garden = "garden";
    const { old, pageUrl, freshPage } = topologyFixture(root, garden, 1);
    const ledgerPath = path.join(root, garden, ".breadboard", "source-visuals.json");
    const rolledBackLedger = fs.readFileSync(ledgerPath);
    const c1Graph = [{
      sourceVisualId: "S1.P1.E1",
      disposition: "retain",
      activeSourceVisualIds: ["S1.P1.E1"],
      reason: "C1 preserves the supplied display before the later ordinary-review disagreement.",
    }];
    const retireGraph = [{
      sourceVisualId: "S1.P1.E1",
      disposition: "retire",
      activeSourceVisualIds: [],
      reason: "The complete page inventory shows that the stale old formula slot is not active.",
    }];
    const c1 = [topologySlot("S1.P1.E1", 0, ["S1.P1.E1"])];
    const c2Raw = JSON.stringify(topologyRecoveryResponse([], retireGraph));
    const c3Raw = JSON.stringify(topologyRecoveryResponse([], retireGraph));
    const n1Raw = JSON.stringify({ reviews: [{
      sourceVisualId: "S1.P1.E1",
      action: "reject",
      identityAssessment: "identity_mismatch",
      topologyAssessment: "topology_change",
      reason: "The confirmed C1 formula is absent from the complete visual inventory.",
    }] });
    const emptyRejectRaw = JSON.stringify({
      status: "rejected",
      reason: "The first all-retired candidate omitted a visible displayed formula from the page inventory.",
    });
    let normalCalls = 0;
    let emptyInventoryReviewCalls = 0;
    let topologyCalls = 0;
    let v7Calls = 0;
    const result = await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const system = String(request.messages[0].content);
        if (system.includes("independently verify a proposed model-authored formula-slot topology")) {
          topologyCalls += 1;
          if (topologyCalls === 1) {
            return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(c1Graph)) } }] };
          }
          return { choices: [{ message: { content: JSON.stringify(topologyConfirmation(retireGraph)) } }] };
        }
        if (system.includes("proposes zero active formulas")) {
          emptyInventoryReviewCalls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          assert.equal(
            payload.candidateResponseVerbatim,
            emptyInventoryReviewCalls === 1 ? c2Raw : c3Raw,
          );
          assert.equal(request.messages[1].content.find((part) => part.type === "image_url").image_url.detail, "high");
          return { choices: [{ message: { content: emptyInventoryReviewCalls === 1
            ? emptyRejectRaw
            : JSON.stringify({
              status: "confirmed",
              reason: "The complete high-resolution page confirms the final candidate has no active displayed formulas.",
            }) } }] };
        }
        if (system.includes("two independent checks disagreed")) {
          v7Calls += 1;
          const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
          if (v7Calls === 1) {
            assert.equal(payload.priorFeedbackVerbatim, n1Raw);
            return { choices: [{ message: { content: c2Raw } }] };
          }
          assert.equal(payload.priorCandidateResponseVerbatim, c2Raw);
          assert.equal(payload.priorFeedbackVerbatim, emptyRejectRaw);
          return { choices: [{ message: { content: c3Raw } }] };
        }
        if (system.includes("formula-topology recovery")) {
          return { choices: [{ message: { content: JSON.stringify(topologyRecoveryResponse(c1, c1Graph)) } }] };
        }
        const payload = JSON.parse(request.messages[1].content.find((part) => part.type === "text").text);
        normalCalls += 1;
        if (normalCalls === 1) {
          return { choices: [{ message: { content: JSON.stringify(topologyRejectReviews(old)) } }] };
        }
        if (normalCalls === 2) {
          assert.deepEqual(payload.inputVisuals.map((input) => input.sourceVisualId), ["S1.P1.E1"]);
          return { choices: [{ message: { content: n1Raw } }] };
        }
        throw new Error("zero-active inventory must use the page-level empty-review protocol");
      }),
      model: "topology-v7-zero-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: old.map((visual) => visual.sourceVisualId),
      cacheRoot,
      renderPdfPage: async () => freshPage,
    });
    assert.equal(v7Calls, 2);
    assert.equal(topologyCalls, 3);
    assert.equal(normalCalls, 2);
    assert.equal(emptyInventoryReviewCalls, 2);
    assert.equal(result.modelCalls, 10);
    assert.deepEqual(result.formulaIds, []);
    assert.deepEqual(result.topologyReviewPageReceipts.map((receipt) => ({
      recoveryProtocol: receipt.recoveryProtocol,
      sourceId: receipt.sourceId,
      pageNumber: receipt.pageNumber,
      activeFormulaIds: receipt.activeFormulaIds,
    })), [{
      recoveryProtocol: "v7",
      sourceId: "src",
      pageNumber: 1,
      activeFormulaIds: [],
    }]);
    const scanCachePath = path.join(root, garden, ".breadboard", "source-visual-scan-cache.json");
    const scanCache = JSON.parse(fs.readFileSync(scanCachePath, "utf-8"));
    const cycle = scanCache.sources.src[pageUrl].formulaArtifactTopologyConsensusRepair;
    assert.equal(scanCache.sources.src[pageUrl].detectorVersion, 7);
    assert.deepEqual(cycle.candidates.map((entry) => entry.candidate.candidateOrdinal), [2, 3]);
    assert.equal(cycle.candidates[0].topologyReview.status, "confirmed");
    assert.equal(cycle.candidates[0].emptyInventoryFormulaReview.status, "rejected");
    assert.equal(cycle.candidates[0].emptyInventoryFormulaReview.rawResponse, emptyRejectRaw);
    assert.equal(cycle.candidates[1].topologyReview.status, "confirmed");
    assert.equal(cycle.candidates[1].emptyInventoryFormulaReview.status, "confirmed");
    const validationOptions = {
      gardenDir: path.join(root, garden),
      gardenSlug: garden,
      requiredFormulaIds: [],
      expectedReviewSetHash: result.reviewedFormulaSetHash,
      expectedModel: "topology-v7-zero-model",
      expectedSourceIds: ["src"],
      expectedTopologyReviewPageReceipts: result.topologyReviewPageReceipts,
    };
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);

    // The V7 tombstone must replay from the master C/R/N history after a
    // staging rollback, never devolving into an unaudited generic empty scan.
    fs.writeFileSync(ledgerPath, rolledBackLedger);
    let genericCalls = 0;
    const rehydrated = await extractSourceVisuals({
      client: fakeClient(async () => {
        genericCalls += 1;
        throw new Error("confirmed V7 tombstone must not invoke generic detection");
      }),
      model: "generic-v7-zero-rehydrate-model",
      contentPath: root,
      gardenSlug: garden,
      sourceId: "src",
      sourceIndex: 1,
      pageImageUrls: [pageUrl],
    });
    assert.equal(genericCalls, 0);
    assert.deepEqual(rehydrated.filter((visual) => visual.type === "equation"), []);
    assert.deepEqual(sourceFormulaTopologyReviewPageReceipts(root, garden, ["src"]), result.topologyReviewPageReceipts);
    assert.deepEqual(validateSourceFormulaReviewSet(validationOptions).problems, []);

    const originalCache = fs.readFileSync(scanCachePath);
    const deleted = JSON.parse(originalCache.toString("utf-8"));
    delete deleted.sources.src[pageUrl];
    fs.writeFileSync(scanCachePath, JSON.stringify(deleted));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /topology.*receipt|formula-set hash/i,
    );
    fs.writeFileSync(scanCachePath, originalCache);
    const tampered = JSON.parse(originalCache.toString("utf-8"));
    tampered.sources.src[pageUrl]
      .formulaArtifactTopologyConsensusRepair.candidates[1]
      .emptyInventoryFormulaReview.rawResponse += " ";
    fs.writeFileSync(scanCachePath, JSON.stringify(tampered));
    assert.match(
      validateSourceFormulaReviewSet(validationOptions).problems.join("; "),
      /consensus|topology.*receipt|formula-set hash/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("production formula review renders exact PDF page N instead of trusting a stale snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-pdf-page-"));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-review-pdf-page-cache-"));
  try {
    const garden = "garden";
    const gardenDir = path.join(root, garden);
    const assetsDir = path.join(gardenDir, "assets");
    fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    const pdf = new PDFDocument({ autoFirstPage: false, compress: false });
    const chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => {
      pdf.once("end", resolve);
      pdf.once("error", reject);
    });
    pdf.addPage({ size: [360, 260], margin: 24 });
    pdf.fillColor("#cc0000").rect(0, 0, 360, 260).fill();
    pdf.fillColor("white").fontSize(24).text("PAGE ONE x=111", 36, 90);
    pdf.addPage({ size: [360, 260], margin: 24 });
    pdf.fillColor("#0033cc").rect(0, 0, 360, 260).fill();
    pdf.fillColor("white").fontSize(24).text("PAGE TWO x=222", 36, 90);
    pdf.end();
    await finished;
    const pdfBytes = Buffer.concat(chunks);
    fs.writeFileSync(path.join(assetsDir, "src-source.pdf"), pdfBytes);
    fs.writeFileSync(
      path.join(gardenDir, "sources", "src.md"),
      `---\nsource_pdf: \"/${garden}/assets/src-source.pdf\"\n---\n\n## Page 2\nDisplayed formula x=222.\n`,
    );

    const parser = new PDFParse({ data: pdfBytes });
    let expectedPageOne;
    let expectedPageTwo;
    try {
      const first = await parser.getScreenshot({ partial: [1], desiredWidth: 1600, imageBuffer: true, imageDataUrl: false });
      const second = await parser.getScreenshot({ partial: [2], desiredWidth: 1600, imageBuffer: true, imageDataUrl: false });
      expectedPageOne = Buffer.from(first.pages[0].data);
      expectedPageTwo = Buffer.from(second.pages[0].data);
    } finally {
      await parser.destroy();
    }
    // Deliberately put page 1 bytes under the page-2 snapshot name. The review
    // must ignore this stale reusable asset and render PDF page 2 itself.
    fs.writeFileSync(path.join(assetsDir, "src-page-002.png"), expectedPageOne);
    saveSourceVisuals(root, garden, [{
      sourceVisualId: "S1.P2.E1",
      sourceId: "src",
      pageNumber: 2,
      type: "equation",
      caption: "Untrusted formula 2",
      exactText: "x_2=0",
      pageImagePath: `/${garden}/assets/src-page-002.png`,
      bbox: { x: 0.12, y: 0.28, width: 0.7, height: 0.3 },
      usageStatus: "unused",
    }]);
    let suppliedFullPage;
    await reviewRequiredSourceFormulaExactText({
      client: fakeClient(async (request) => {
        const fullImage = request.messages[1].content.find((part) => part.type === "image_url");
        suppliedFullPage = Buffer.from(fullImage.image_url.url.split(",")[1], "base64");
        return { choices: [{ message: { content: JSON.stringify({
          reviews: [acceptedReview("S1.P2.E1", 2)],
        }) } }] };
      }),
      model: "review-model",
      contentPath: root,
      gardenSlug: garden,
      selectedSourceIds: ["src"],
      requiredFormulaIds: ["S1.P2.E1"],
      cacheRoot,
    });
    assert.deepEqual(suppliedFullPage, expectedPageTwo);
    assert.notDeepEqual(suppliedFullPage, expectedPageOne);
    assert.deepEqual(fs.readFileSync(path.join(assetsDir, "src-page-002.png")), expectedPageOne);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});
