import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import { gardenSourceFigures, searchGardenSourceFigures } from "../src/lib/hermes/garden-source-figures.ts";
import { parseGardenReadNode } from "../src/lib/hermes/garden-reader.ts";
import { applyGardenRevision } from "../src/lib/garden-revision.ts";
import { saveVisualDescription } from "../src/lib/hermes/garden-visual-descriptions.ts";

function fixture(t, content = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-source-images-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const garden = path.join(root, "course");
  fs.mkdirSync(path.join(garden, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(garden, "assets"));
  const node = parseGardenReadNode({ slug: "book", folder: "sources", relPath: "sources/book.md" },
    `---\ntitle: Book\nsourceAnchors: [S1.P2.F1]\n---\n${content}`);
  const asset = (name) => { fs.writeFileSync(path.join(garden, "assets", name), "image-bytes"); return `/course/assets/${name}`; };
  const ledger = (visuals) => fs.writeFileSync(path.join(garden, ".breadboard/source-visuals.json"), JSON.stringify(visuals));
  return { root, garden, node, asset, ledger, read: (args = {}) => gardenSourceFigures(root, "course", node, args) };
}

test('page figure lookups read only candidate descriptions and still search their visual content', async t => {
  const f = fixture(t, '## Page 2\n![Figure](../assets/book-page-002-figure-1.png)\n\n## Page 3\n![Figure](../assets/book-page-003-figure-1.png)');
  const images = ['book-page-002-figure-1.png', 'book-page-003-figure-1.png', 'unrelated.png'].map(f.asset);
  for (const [index, imagePath] of images.entries()) {
    const asset = path.join(f.garden, 'assets', path.basename(imagePath));
    const stat = fs.statSync(asset);
    await saveVisualDescription(f.garden, { imagePath, caption: index === 0 ? 'Induced current' : 'Another diagram',
      description: 'Observed source figure', visibleText: '', model: 'fixture', size: stat.size, mtimeMs: stat.mtimeMs,
      sha256: createHash('sha256').update(fs.readFileSync(asset)).digest('hex') });
  }
  const readFile = fs.promises.readFile.bind(fs.promises);
  const readdir = fs.promises.readdir.bind(fs.promises);
  const records = [];
  const directories = [];
  t.mock.method(fs.promises, 'readFile', async (file, ...args) => {
    if (String(file).includes('visual-descriptions')) records.push(path.basename(String(file)));
    return readFile(file, ...args);
  });
  t.mock.method(fs.promises, 'readdir', async (directory, ...args) => {
    directories.push(String(directory));
    return readdir(directory, ...args);
  });
  const key = image => createHash('sha256').update(image).digest('hex') + '.json';
  const result = await f.read({ pageStart: 2, pageEnd: 2 });
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].caption, 'Induced current');
  assert.equal(result.figures[0].descriptionSource, 'vision');
  assert.deepEqual(records, [key(images[0])]);
  assert.equal(directories.some(directory => directory.endsWith('visual-descriptions')), false);
  records.length = 0;
  const search = await f.read({ query: 'induced current' });
  assert.equal(search.total, 1, 'Saved visual descriptions remain searchable even with generic source captions.');
  assert.deepEqual(new Set(records), new Set(images.slice(0, 2).map(key)));
  fs.mkdirSync(path.join(f.garden, 'sources'));
  fs.writeFileSync(path.join(f.garden, 'sources/book.md'), f.node.content);
  const wholeGarden = await searchGardenSourceFigures(f.root, [{ slug: 'course', name: 'Course' }], { query: 'induced current' });
  assert.equal(wholeGarden.total, 1, 'Full-Garden search still uses saved descriptions.');
  assert.equal(wholeGarden.figures[0].imagePath, images[0]);
});

test('figure searches validate only plausible images, including description-only matches and stale source fallbacks', async t => {
  const f = fixture(t);
  const images = Array.from({ length: 40 }, (_, i) => f.asset(`diagram-${i}.png`));
  const content = images.map((image, i) => `## Page ${i + 1}\n![${i === 1 ? 'Crystal circuit' : 'Figure'}](${image})`).join('\n\n');
  f.node.content = content;
  fs.mkdirSync(path.join(f.garden, 'sources'));
  fs.writeFileSync(path.join(f.garden, 'sources/book.md'), content);
  for (const [i, imagePath] of images.entries()) {
    const asset = path.join(f.garden, 'assets', path.basename(imagePath));
    const stat = fs.statSync(asset);
    await saveVisualDescription(f.garden, { imagePath, caption: i === 0 || i === 2 ? 'Crystal reactance' : 'Unrelated diagram',
      description: 'Observed source figure', visibleText: '', model: 'fixture', size: stat.size, mtimeMs: stat.mtimeMs,
      sha256: createHash('sha256').update(fs.readFileSync(asset)).digest('hex') });
  }
  // Both records are stale: one must fall back to the matching source caption,
  // while the other must not return an obsolete description as evidence.
  for (const i of [1, 2]) fs.writeFileSync(path.join(f.garden, 'assets', path.basename(images[i])), 'replacement-pixels');
  const realpath = fs.promises.realpath.bind(fs.promises);
  const touched = new Set();
  t.mock.method(fs.promises, 'realpath', async (file, ...args) => {
    if (String(file).includes(`${path.sep}assets${path.sep}`)) touched.add(path.basename(String(file)));
    return realpath(file, ...args);
  });
  for (const lookup of [
    () => f.read({ query: 'crystal', limit: 1 }),
    () => searchGardenSourceFigures(f.root, [{ slug: 'course', name: 'Course' }], { query: 'crystal', limit: 1 }),
  ]) {
    touched.clear();
    const first = await lookup();
    assert.equal(first.total, 2);
    assert.equal(first.nextOffset, 1);
    assert.equal(first.figures[0].imagePath, images[0]);
    assert.equal(first.figures[0].descriptionSource, 'vision');
    assert.deepEqual([...touched].sort(), images.slice(0, 3).map(image => path.basename(image)).sort(),
      'Unrelated saved descriptions must not trigger image filesystem checks.');
  }
  const second = await f.read({ query: 'crystal', offset: 1, limit: 1 });
  assert.equal(second.figures[0].imagePath, images[1]);
  assert.equal(second.figures[0].caption, 'Crystal circuit');
  assert.equal(second.figures[0].descriptionSource, 'source_caption');
});

test('matching image checks overlap in bounded batches and preserve pagination order', async t => {
  const f = fixture(t);
  const images = Array.from({ length: 35 }, (_, i) => f.asset(`crystal-${i}.png`));
  f.node.content = images.map(image => `![Crystal](${image})`).join('\n');
  fs.mkdirSync(path.join(f.garden, 'sources'));
  fs.writeFileSync(path.join(f.garden, 'sources/book.md'), f.node.content);
  fs.writeFileSync(path.join(f.garden, 'index.md'), f.node.content);
  const realpath = fs.promises.realpath.bind(fs.promises);
  let active = 0, peak = 0;
  t.mock.method(fs.promises, 'realpath', async (file, ...args) => {
    if (!String(file).includes(`${path.sep}assets${path.sep}`)) return realpath(file, ...args);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return await realpath(file, ...args);
    } finally { active--; }
  });
  for (const lookup of [
    () => f.read({ query: 'crystal', offset: 16, limit: 16 }),
    () => searchGardenSourceFigures(f.root, [{ slug: 'course', name: 'Course' }], { query: 'crystal', offset: 16, limit: 16 }),
  ]) {
    peak = 0;
    const result = await lookup();
    assert.ok(peak > 1 && peak <= 16, `Expected bounded concurrent checks, got ${peak}`);
    assert.equal(result.total, 35);
    assert.equal(result.nextOffset, 32);
    assert.deepEqual(result.figures.map(figure => figure.imagePath), images.slice(16, 32));
    assert.ok(result.figures.every(figure => !figure.relPath || figure.relPath === 'sources/book.md'));
  }
});

test("source images retain identity and embeds, filter by pages/caption and paginate", async (t) => {
  const f = fixture(t, "![Duplicate](/course/assets/vector.png)\n![Extra][image]\n\n[image]: </course/assets/extra (1).png>");
  const image = f.asset("vector.png");
  f.asset("extra (1).png");
  const page = f.asset("book-page-002.png");
  f.ledger([
    { sourceId: "book", sourceVisualId: "S1.P2.F1", pageNumber: 2, type: "diagram", caption: "Vector addition", croppedImagePath: image },
    { sourceId: "book", sourceVisualId: "S1.P2.PAGE", pageNumber: 2, type: "full_page_fallback", caption: "Whole page", pageImagePath: page },
    { sourceId: "another-book", sourceVisualId: "S2.P2.F1", pageNumber: 2, type: "diagram", caption: "Different source", croppedImagePath: image },
  ]);
  const first = await f.read({ limit: 1 });
  assert.equal(first.total, 2, "Crops deduplicate embedded images and omit page snapshots by default");
  assert.equal(first.nextOffset, 1);
  assert.equal(first.figures[0].sourceVisualId, "S1.P2.F1");
  assert.equal(first.figures[0].availability, "available");
  assert.equal(first.figures[0].markdown, "![Vector addition](</course/assets/vector.png>)");
  assert.deepEqual(first.anchors, ["S1.P2.F1"]);
  const second = await f.read({ offset: first.nextOffset, limit: 1 });
  assert.equal(second.nextOffset, null);
  assert.equal(second.figures[0].markdown, "![Extra](</course/assets/extra (1).png>)");
  assert.equal((await f.read({ query: "vector", pageStart: 2, pageEnd: 2 })).total, 1);
  assert.equal((await f.read({ pageStart: 3 })).total, 0);
  const fallbacks = await f.read({ includePageSnapshots: true, pageStart: 2, pageEnd: 2 });
  assert.equal(fallbacks.total, 2);
  assert.equal(fallbacks.figures[1].type, "full_page_fallback");
});

test('a listed source image supplies actual pixels and a crop while retaining its source identity', async t => {
  const f = fixture(t, '## Page 28\n![Pole-zero map](../assets/map.png)');
  const imagePath = f.asset('map.png');
  await sharp({ create: { width: 80, height: 40, channels: 3, background: 'blue' } })
    .png().toFile(path.join(f.garden, 'assets/map.png'));
  const result = await f.read({ imagePath, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } });
  const bytes = Buffer.from(result.screenshot.dataUrl.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 40); assert.equal(metadata.height, 40);
  assert.equal(result.originalWidth, 80); assert.equal(result.originalHeight, 40);
  assert.equal(result.figures[0].pageNumber, 28);
  assert.equal(result.figures[0].markdown, '![Pole-zero map](</course/assets/map.png>)');
  assert.ok((await sharp(bytes).stats()).channels[2].mean > 240);
  await assert.rejects(f.read({ imagePath, crop: { x: 0.8, y: 0, width: 0.5, height: 1 } }), /rectangle/);
  assert.equal((await f.read()).screenshot, undefined, 'Listing does not send every image to the model.');
});

test('inspection cannot read unlisted, unreliable, missing or out-of-Garden images', async t => {
  const f = fixture(t);
  f.asset('unlisted.png');
  const rejected = f.asset('rejected.png');
  fs.mkdirSync(path.join(f.root, 'other/assets'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'other/assets/private.png'), 'private');
  fs.symlinkSync(path.join(f.root, 'other/assets'), path.join(f.garden, 'assets/linked'), 'junction');
  const paths = ['/course/assets/missing.png', '/other/assets/private.png',
    '/course/assets/%2e%2e/%2e%2e/other/assets/private.png', '/course/assets/linked/private.png',
    'https://example.test/private.png'];
  f.ledger([
    ...paths.map(croppedImagePath => ({ sourceId: 'book', caption: 'Unavailable', croppedImagePath })),
    { sourceId: 'book', caption: 'Rejected', croppedImagePath: rejected, cropStatus: 'omitted_unreliable' },
  ]);
  for (const imagePath of [...paths, rejected, '/course/assets/unlisted.png', 4]) {
    await assert.rejects(f.read({ imagePath }));
  }
});

test('a preserved PDF page beyond saved snapshots is inspected and replayed with the same pixels', async t => {
  const f = fixture(t);
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= 26; i++) {
    const page = pdf.addPage([200, 100]);
    page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: i === 26 ? rgb(0, 0, 1) : rgb(1, 0, 0) });
  }
  fs.writeFileSync(path.join(f.garden, 'assets/book.pdf'), await pdf.save());
  f.node.sourcePdf = '/course/assets/book.pdf';
  assert.equal((await f.read()).total, 0, 'No pre-generated page images exist.');
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const inspected = await f.read({ pdfPage: 26, crop });
  assert.equal(inspected.pdfPage, 26); assert.equal(inspected.totalPages, 26);
  assert.equal(inspected.sourcePdf, f.node.sourcePdf);
  const pixels = Buffer.from(inspected.screenshot.dataUrl.split(',')[1], 'base64');
  const stats = await sharp(pixels).stats();
  assert.ok(stats.channels[2].mean > 240); assert.ok(stats.channels[0].mean < 10);
  assert.equal((await sharp(pixels).metadata()).width, 800);
  for (const pdfPage of [0, -1, 1.5, '26', 27]) await assert.rejects(f.read({ pdfPage }));
  await assert.rejects(f.read({ pdfPage: 26, imagePath: '/course/assets/book.pdf' }), /Choose/);
  f.node.sourcePdf = '/other/assets/private.pdf';
  await assert.rejects(f.read({ pdfPage: 26 }), /authorized Garden/);
  f.node.sourcePdf = '/course/assets/%2e%2e/private.pdf';
  await assert.rejects(f.read({ pdfPage: 26 }), /authorized Garden/);
});

test("unavailable, unreliable and out-of-Garden assets never produce reusable embeds", async (t) => {
  const f = fixture(t);
  const local = f.asset("local.png");
  fs.mkdirSync(path.join(f.root, "other/assets"), { recursive: true });
  fs.writeFileSync(path.join(f.root, "other/assets/private.png"), "private");
  fs.symlinkSync(path.join(f.root, "other/assets"), path.join(f.garden, "assets/linked"), "junction");
  const paths = ["/course/assets/missing.png", "/other/assets/private.png", "/course/assets/%2e%2e/%2e%2e/other/assets/private.png", "/course/assets/linked/private.png", "https://example.test/image.png"];
  f.ledger([
    ...paths.map((croppedImagePath, i) => ({ sourceId: "book", sourceVisualId: `S1.P2.F${i}`, type: "figure", caption: "Unavailable", croppedImagePath })),
    { sourceId: "book", sourceVisualId: "S1.P2.F9", type: "figure", caption: "Rejected crop", croppedImagePath: local, cropStatus: "omitted_unreliable" },
  ]);
  const result = await f.read();
  assert.equal(result.total, 6);
  assert.ok(result.figures.every((figure) => figure.markdown === null));
  assert.equal(result.figures.at(-1).availability, "omitted_unreliable");
});

test("embedded images work without a ledger and code examples do not become figures", async (t) => {
  const f = fixture(t, "![Real](/course/assets/real.png)\n\n```md\n![Example](/course/assets/example.png)\n```\n");
  f.asset("real.png");
  f.asset("example.png");
  const result = await f.read();
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].availability, "available");
  assert.equal(result.warning, undefined);
  fs.writeFileSync(path.join(f.garden, ".breadboard/source-visuals.json"), "broken catalog");
  const damaged = await f.read();
  assert.equal(damaged.total, 1);
  assert.match(damaged.warning, /catalog could not be read/);
});

test("figures from another Markdown page can be inserted without breaking relative links or replacing the note", async (t) => {
  const f = fixture(t);
  f.asset("basis (2).png");
  const relatedNote = parseGardenReadNode({ slug: "basis", folder: "notes", relPath: "notes/basis.md" },
    '---\ntitle: Basis vectors\nsource: user-note\n---\n![Two basis vectors](<../assets/basis (2).png>)\n');
  const result = await gardenSourceFigures(f.root, "course", relatedNote, { query: "basis" });
  assert.equal(result.figures[0].availability, "available");
  assert.equal(result.figures[0].markdown, "![Two basis vectors](</course/assets/basis (2).png>)");
  const original = '---\ntitle: Fields\n---\n\nA vector has components.\n\n$$E_x = 2$$\n\nAnother section.\n';
  const anchor = 'A vector has components.';
  const insertion = `\n\n${result.figures[0].markdown}\n\nSource: [[notes/basis|Basis vectors]].`;
  const revised = applyGardenRevision(original, anchor + insertion, anchor);
  assert.equal(revised.replace(insertion, ''), original);
  assert.equal(result.relPath, 'notes/basis.md');
});

test("Garden-wide image search covers notes, excludes hidden pages, and reports damaged catalogs", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.garden, "notes"));
  f.asset("visible.png");
  f.asset("hidden.png");
  fs.writeFileSync(path.join(f.garden, "notes", "visible.md"),
    '---\ntitle: Vector basis\n---\n![Components](../assets/visible.png)\n![Missing](../assets/missing.png)\n');
  for (const [name, metadata] of [["draft", "draft: true"], ["internal", "internal: true"]]) {
    fs.writeFileSync(path.join(f.garden, "notes", `${name}.md`),
      `---\ntitle: Vector basis\n${metadata}\n---\n![Components](../assets/hidden.png)\n`);
  }
  fs.writeFileSync(path.join(f.garden, ".breadboard", "source-visuals.json"), "invalid catalog");
  const result = await searchGardenSourceFigures(f.root, [{ slug: "course", name: "Course" }], { query: "vector basis" });
  assert.equal(result.total, 2);
  assert.ok(result.figures.every((figure) => figure.relPath === "notes/visible.md"));
  assert.equal(result.figures[0].markdown, "![Components](</course/assets/visible.png>)");
  assert.equal(result.figures[1].availability, "missing_or_not_local");
  assert.equal(result.figures[1].markdown, null);
  assert.equal(result.warnings[0].gardenId, "course");
  assert.match(result.warnings[0].warning, /catalog could not be read/);
});

test("generic OCR crops are found by their own page text without borrowing another page", async (t) => {
  const f = fixture(t, '## Page 1\nThe sketch shows a mitochondrion with folded cristae.\n\n![Page 1 figure 1](../assets/cell.png)\n\n## Page 2\nA mechanical pulley lifts the load.\n\n![Page 2 figure 1](../assets/pulley.png)');
  f.asset('cell.png'); f.asset('pulley.png');
  const result = await f.read({ query: 'show me the folded cristae' });
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].imagePath, '/course/assets/cell.png');
  assert.equal(result.figures[0].pageNumber, 1);
  assert.equal(result.figures[0].descriptionSource, 'context_only');
  assert.match(result.figures[0].context, /mitochondrion/);
  assert.doesNotMatch(result.figures[0].context, /pulley/);
});

test('figure previews stay compact while searches still find evidence beyond the preview', async t => {
  const content = '## Page 1\n' + 'Ordinary context. '.repeat(70) +
    'A rare mechanical escapement appears here.\n\n![Page 1 figure 1](../assets/clock.png)';
  const f = fixture(t, content);
  f.asset('clock.png');
  fs.mkdirSync(path.join(f.garden, 'sources'));
  fs.writeFileSync(path.join(f.garden, 'sources/book.md'), content);
  for (const result of [
    await f.read({ query: 'escapement' }),
    await f.read({}),
    await searchGardenSourceFigures(f.root, [{ slug: 'course', name: 'Course' }], { query: 'escapement' }),
  ]) {
    assert.equal(result.total, 1);
    const figure = result.figures[0];
    assert.ok(figure.context.length <= 320);
    assert.equal(figure.contextTruncated, true);
    assert.equal(figure.context.isWellFormed(), true);
    assert.equal(figure.pageNumber, 1);
    assert.equal(figure.markdown, '![Page 1 figure 1](</course/assets/clock.png>)');
    assert.equal(result.nextOffset, null);
  }
});

test("visible index images remain searchable when another authorized Garden is unavailable", async t => {
  const f = fixture(t);
  f.asset('overview.png');
  fs.writeFileSync(path.join(f.garden, 'index.md'), '# Course overview\n![Mitochondrion overview](/course/assets/overview.png)');
  const result = await searchGardenSourceFigures(f.root,
    [{ slug: 'unavailable', name: 'Unavailable' }, { slug: 'course', name: 'Course' }], { query: 'mitochondrion' });
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].relPath, 'index.md');
  assert.equal(result.figures[0].availability, 'available');
  assert.equal(result.warnings[0].gardenId, 'unavailable');
});

test("website HTML figures use captions and nearby text, excluding code examples", async (t) => {
  const f = fixture(t, '## Controller\nFeedback reduces overshoot.\n\n<figure><img src="../assets/control.png"><figcaption>Controller step response</figcaption></figure>\n\n```html\n<img src="../assets/example.png" alt="Controller">\n```');
  f.asset('control.png'); f.asset('example.png');
  const result = await f.read({ query: 'controller step response' });
  assert.equal(result.total, 1);
  assert.match(result.figures[0].context, /Feedback reduces overshoot/);
  assert.equal(result.figures[0].imagePath, '/course/assets/control.png');
});

test("equations are searchable and frontmatter-only snapshots provide a labeled fallback", async (t) => {
  const f = fixture(t, '## Page 1\nThe Lorentz force bends the trajectory.\n\n## Page 2\nStanding waves form nodes.');
  const snapshot = f.asset('book-page-001.png');
  f.node.sourceImages = [snapshot];
  f.ledger([{ sourceId: 'book', sourceVisualId: 'S1.P2.E1', pageNumber: 2,
    type: 'equation', caption: 'Standing wave', exactText: 'y = A sin(kx)', croppedImagePath: f.asset('wave.png') }]);
  const equation = await f.read({ query: 'sin kx' });
  assert.equal(equation.total, 1);
  assert.equal(equation.figures[0].type, 'equation');
  assert.equal(equation.figures[0].visibleText, 'y = A sin(kx)');
  const page = await f.read({ query: 'Lorentz force' });
  assert.equal(page.total, 1);
  assert.equal(page.figures[0].type, 'full_page_fallback');
  assert.equal(page.figures[0].pageNumber, 1);
  assert.match(page.figures[0].context, /Lorentz/);
  assert.equal((await f.read({ query: 'Lorentz force', includePageSnapshots: false })).total, 0);
});

test('WordPress tracking pixels are excluded without hiding source images', async t => {
  const f = fixture(t, '![Controller](../assets/control.png)\n![](https://pixel.wp.com/g.gif?v=ext)');
  f.asset('control.png');
  f.node.sourceImages = ['https://pixel.wp.com/g.gif?v=other'];
  const result = await f.read({ includePageSnapshots: true });
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].imagePath, '/course/assets/control.png');
});

test("video frames keep timestamp and matching transcript context", async (t) => {
  const f = fixture(t, '## Frames\n### Frame 1 (00:01:05)\n![Frame at 00:01:05](../assets/video-page-001.png)\n\nSaid around this moment: A Wheatstone bridge measures resistance.\n\n### Frame 2 (00:02:10)\n![Frame at 00:02:10](../assets/video-page-002.png)\n\nSaid around this moment: This pendulum swings periodically.');
  f.asset('video-page-001.png'); f.asset('video-page-002.png');
  const result = await f.read({ query: 'Wheatstone bridge' });
  assert.equal(result.total, 1);
  assert.equal(result.figures[0].timestamp, '00:01:05');
  assert.equal(result.figures[0].type, 'full_page_fallback');
});

test("specific figure captions rank ahead of incidental context matches across Gardens", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.garden, 'sources'));
  f.asset('a.png'); f.asset('b.png');
  fs.writeFileSync(path.join(f.garden, 'sources/a.md'), '---\ntitle: Notes\n---\nWe previously discussed photon scattering.\n![General apparatus](../assets/a.png)');
  fs.writeFileSync(path.join(f.garden, 'sources/b.md'), '---\ntitle: Results\n---\n![Photon scattering](../assets/b.png)');
  const result = await searchGardenSourceFigures(f.root, [{ slug: 'course', name: 'Course' }], { query: 'photon scattering', limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.figures[0].imagePath, '/course/assets/b.png');
});
