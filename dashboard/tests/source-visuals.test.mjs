import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  ensureSourcePdfPageSnapshots,
  loadSourceVisuals,
  recordSourceVisualAssignments,
  saveSourceVisuals,
  extractSourceVisuals,
} from "../src/lib/source-visuals.ts";

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
    const client = fakeClient(async () => {
      calls += 1;
      throw new Error("502 Bad Gateway");
    });

    await assert.rejects(
      () => extractSourceVisuals({ client, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls }),
      /vision detection failed on \d+ page\(s\).*502/s,
    );
    // Fail-fast: stops after 3 consecutive detection failures, not all 5 pages.
    assert.ok(calls <= 3, `expected fail-fast within 3 calls, got ${calls}`);
    // The prior good ledger entry is preserved (not wiped by the failed run).
    const ledger = JSON.parse(fs.readFileSync(path.join(root, garden, ".breadboard", "source-visuals.json"), "utf-8"));
    assert.deepEqual(ledger.map((v) => v.sourceVisualId), ["S9.P1.F1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test("extractSourceVisuals resumes after a failed page without rescanning completed pages", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-extract-resume-"));
  try {
    const garden = "garden";
    const urls = seedPageImages(root, garden, 2);
    let firstPageCalls = 0;
    let secondPageCalls = 0;
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
      throw new Error("Connection error.");
    });

    await assert.rejects(
      () => extractSourceVisuals({ client: interruptedClient, model: "m", contentPath: root, gardenSlug: garden, sourceId: "src", sourceIndex: 1, pageImageUrls: urls }),
      /vision detection failed/,
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
