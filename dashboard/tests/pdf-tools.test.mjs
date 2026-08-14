// The PDF tools ported from Stirling PDF run in the browser, but every operation
// that does not touch a canvas is plain byte-in/byte-out work and is exercised
// here against real generated PDFs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFArray,
  PDFDocument,
  decodePDFRawStream,
  degrees,
} from "@cantoo/pdf-lib";
import {
  addImageWatermark,
  addPageNumbers,
  addTextWatermark,
  deletePages,
  extractPages,
  parsePageSelection,
  protectPdf,
  readMetadata,
  rotatePages,
  stampImage,
  writeMetadata,
} from "../src/lib/pdf-tools.ts";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** A 1x1 PNG, enough to stand in for a signature or a logo. */
const PNG = {
  bytes: new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  ),
  type: "png",
};

async function fixture() {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 5; index += 1) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(`Page ${index + 1}`, { x: 50, y: 700, size: 24 });
  }
  pdf.getPage(2).setRotation(degrees(90));
  return pdf.save();
}

/**
 * Where a stamp actually lands: compose every `cm` in the content stream the way
 * a renderer would, then push the image's unit square through it.
 */
async function stampCorners(rotation, placement) {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.setRotation(degrees(rotation));

  const stamped = await stampImage(await source.save(), PNG, {
    pageIndex: 0,
    opacity: 1,
    ...placement,
  });
  const reloaded = await PDFDocument.load(stamped);
  const contents = reloaded.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const drawing = refs
    .map((ref) =>
      Buffer.from(
        decodePDFRawStream(reloaded.context.lookup(ref)).decode(),
      ).toString("latin1"),
    )
    .find((stream) => stream.includes(" Do"));
  assert.ok(drawing, `no image was drawn on a /Rotate ${rotation} page`);

  const multiply = (m, n) => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
  let total = [1, 0, 0, 1, 0, 0];
  for (const match of drawing.matchAll(
    /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g,
  )) {
    total = multiply(match.slice(1).map(Number), total);
  }

  const [a, b, c, d, e, f] = total;
  const corner = (u, v) => ({ x: a * u + c * v + e, y: b * u + d * v + f });
  return [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
}

test("page selection understands all, odd, even, singles and ranges", () => {
  assert.deepEqual(parsePageSelection("all", 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(parsePageSelection("", 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(parsePageSelection("odd", 5), [0, 2, 4]);
  assert.deepEqual(parsePageSelection("even", 5), [1, 3]);
  assert.deepEqual(parsePageSelection("1,3-4", 5), [0, 2, 3]);
  assert.deepEqual(parsePageSelection("4-2", 5), [1, 2, 3]);
  assert.deepEqual(parsePageSelection("9", 5), []);
});

test("a text watermark tiles every page without losing pages", async () => {
  const base = await fixture();
  const watermarked = await addTextWatermark(base, {
    text: "CONFIDENTIAL",
    fontSize: 30,
    rotation: 45,
    opacity: 0.5,
    color: "#d3d3d3",
    widthSpacer: 50,
    heightSpacer: 50,
    fontFamily: "helvetica",
  });

  assert.equal((await PDFDocument.load(watermarked)).getPageCount(), 5);
  assert.ok(watermarked.length > base.length);
});

test("an image watermark tiles every page", async () => {
  const watermarked = await addImageWatermark(await fixture(), PNG, {
    size: 40,
    rotation: 30,
    opacity: 0.4,
    widthSpacer: 60,
    heightSpacer: 60,
  });

  assert.equal((await PDFDocument.load(watermarked)).getPageCount(), 5);
});

test("page numbers accept the {n}/{total}/{filename} template", async () => {
  const numbered = await addPageNumbers(await fixture(), {
    position: 8,
    startingNumber: 1,
    pages: "all",
    customText: "{n} / {total} - {filename}",
    zeroPad: 2,
    fontSize: 12,
    fontFamily: "times",
    fontColor: "#000000",
    margin: "medium",
    fileName: "report.pdf",
  });

  assert.equal((await PDFDocument.load(numbered)).getPageCount(), 5);
});

test("a stamp lands exactly where it was dropped on an upright page", async () => {
  const corners = await stampCorners(0, { relX: 0.6, relY: 0.7, relWidth: 0.2 });
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  assert.ok(Math.abs(Math.min(...xs) - 0.6 * PAGE_WIDTH) < 0.5);
  assert.ok(Math.abs(Math.max(...xs) - 0.8 * PAGE_WIDTH) < 0.5);
  assert.ok(Math.abs(Math.max(...ys) - (PAGE_HEIGHT - 0.7 * PAGE_HEIGHT)) < 0.5);
});

test("a stamp stays on the page whatever /Rotate the page carries", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const corners = await stampCorners(rotation, {
      relX: 0.6,
      relY: 0.7,
      relWidth: 0.2,
    });
    for (const point of corners) {
      assert.ok(
        point.x >= -0.5 &&
          point.x <= PAGE_WIDTH + 0.5 &&
          point.y >= -0.5 &&
          point.y <= PAGE_HEIGHT + 0.5,
        `/Rotate ${rotation}: corner (${point.x}, ${point.y}) fell off the page`,
      );
    }
  }
});

test("rotation is applied on top of the angle a page already has", async () => {
  const rotated = await PDFDocument.load(await rotatePages(await fixture(), "1,3", 90));

  assert.equal(rotated.getPage(0).getRotation().angle, 90);
  assert.equal(rotated.getPage(1).getRotation().angle, 0);
  // Page 3 of the fixture starts at 90 degrees.
  assert.equal(rotated.getPage(2).getRotation().angle, 180);
});

test("pages can be deleted and extracted, but never all of them", async () => {
  const base = await fixture();

  assert.equal((await PDFDocument.load(await deletePages(base, "2,4"))).getPageCount(), 3);
  assert.equal((await PDFDocument.load(await extractPages(base, "2-4"))).getPageCount(), 3);
  await assert.rejects(() => deletePages(base, "all"), /every page/);
  await assert.rejects(() => extractPages(base, "77"), /no pages/);
});

test("metadata round-trips, keywords included", async () => {
  const written = await writeMetadata(await fixture(), {
    title: "Quarterly report",
    author: "Kuzey",
    subject: "Numbers",
    keywords: "one, two",
    creator: "breadboard",
    producer: "breadboard",
  });
  const readBack = await readMetadata(written);

  assert.equal(readBack.title, "Quarterly report");
  assert.equal(readBack.author, "Kuzey");
  assert.equal(readBack.keywords, "one, two");
});

test("a protected copy cannot be reopened without its password", async () => {
  const permissions = {
    printing: true,
    modifying: false,
    copying: false,
    annotating: false,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: false,
  };
  const base = await fixture();

  const encrypted = await protectPdf(base, {
    userPassword: "open-me",
    ownerPassword: "owner",
    permissions,
  });
  await assert.rejects(() => PDFDocument.load(encrypted), /encrypted/i);

  await assert.rejects(
    () => protectPdf(base, { userPassword: "", ownerPassword: "", permissions }),
    /password/,
  );
});
