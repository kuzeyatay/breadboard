import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  detectFigureBoxes,
  embedPageFigures,
  pngBufferFromDataUrl,
} from '../src/lib/vlm-ocr/figures.ts';
import { parsePagesWithVlm } from '../src/lib/vlm-ocr/parse.ts';
import { loadVlmOcrConfig } from '../src/lib/vlm-ocr/config.ts';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// ── A real 8-bit RGBA PNG, which is what the page snapshots are ─────────────

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4;
      raw[p] = x % 256;
      raw[p + 1] = y % 256;
      raw[p + 2] = 128;
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pageDataUrl = `data:image/png;base64,${makePng(600, 800).toString('base64')}`;

// ── Detection ───────────────────────────────────────────────────────────────

test('a bare coordinate line is read as a figure box', () => {
  const figures = detectFigureBoxes('Intro\n\n(147,90),(925,415)\n\nMore text');
  assert.equal(figures.length, 1);
  assert.equal(figures[0].lineIndex, 2);
  assert.deepEqual(figures[0].box, {
    x: 0.147,
    y: 0.09,
    width: 0.778,
    height: 0.325,
  });
});

test('coordinates trailing a line of text are not treated as a figure', () => {
  // That box may just be the sentence's own bounding box; cropping it would
  // put a picture of a sentence into the document.
  assert.deepEqual(
    detectFigureBoxes('Source: navigation data(39,337),(512,900)'),
    [],
  );
});

test('a caption next to the box becomes the alt text', () => {
  const withCaptionBelow = detectFigureBoxes(
    '(100,100),(900,500)\nFigure 3: Torque against angle',
  );
  assert.equal(withCaptionBelow[0].caption, 'Figure 3: Torque against angle');

  const withCaptionAbove = detectFigureBoxes('图 2 受力分析\n(100,100),(900,500)');
  assert.equal(withCaptionAbove[0].caption, '图 2 受力分析');

  // Ordinary prose next to a box is not a caption.
  assert.equal(
    detectFigureBoxes('(100,100),(900,500)\nThe next paragraph begins here.')[0]
      .caption,
    '',
  );
});

test('implausible boxes are rejected rather than cropped', () => {
  // Out of the [0,1000] space the model normalizes into.
  assert.deepEqual(detectFigureBoxes('(10,10),(4000,3000)'), []);
  // A sliver too thin to show anything.
  assert.deepEqual(detectFigureBoxes('(100,100),(110,110)'), []);
  // Essentially the whole page is not a figure.
  assert.deepEqual(detectFigureBoxes('(0,0),(1000,1000)'), []);
});

// ── Cropping and embedding ──────────────────────────────────────────────────

test('a detected figure is cropped from the page and embedded as an image', () => {
  const saved = [];
  const result = embedPageFigures({
    text: 'Before\n\n(147,90),(925,415)\n\nFigure 1: The apparatus',
    pageNumber: 3,
    pageDataUrl,
    saveFigure: (args) => {
      saved.push(args);
      return { path: `/garden/assets/figure-${args.index}.png` };
    },
  });

  assert.equal(result.embedded, 1);
  assert.equal(result.skipped, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].pageNumber, 3);
  assert.ok(saved[0].png.length > 0, 'a real PNG buffer was produced');
  assert.ok(
    result.text.includes('![Figure 1: The apparatus](/garden/assets/figure-1.png)'),
  );
  assert.ok(!result.text.includes('(147,90)'), 'the coordinates are gone');
});

test('a figure without a caption still gets usable alt text', () => {
  const result = embedPageFigures({
    text: '(147,90),(925,415)',
    pageNumber: 7,
    pageDataUrl,
    saveFigure: () => ({ path: '/g/assets/f.png' }),
  });
  assert.equal(result.text, '![Page 7 figure 1](/g/assets/f.png)');
});

test('brackets in a caption cannot break the image embed', () => {
  const result = embedPageFigures({
    text: '(147,90),(925,415)\nFigure 2: signal [dB] over time',
    pageNumber: 1,
    pageDataUrl,
    saveFigure: () => ({ path: '/g/assets/f.png' }),
  });
  assert.ok(result.text.startsWith('![Figure 2: signal dB over time]('));
});

test('a page that is not a PNG reports skipped figures instead of throwing', () => {
  const result = embedPageFigures({
    text: '(147,90),(925,415)',
    pageNumber: 1,
    pageDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    saveFigure: () => ({ path: '/g/assets/f.png' }),
  });
  assert.equal(result.embedded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.text, '(147,90),(925,415)');
  assert.equal(pngBufferFromDataUrl('data:image/jpeg;base64,/9j/4AAQ'), null);
});

test('a saver that refuses leaves the document no worse than before', () => {
  const result = embedPageFigures({
    text: '(147,90),(925,415)',
    pageNumber: 1,
    pageDataUrl,
    saveFigure: () => null,
  });
  assert.equal(result.embedded, 0);
  assert.equal(result.skipped, 1);
  // Still a coordinate line, which normalization then strips as before.
  assert.equal(result.text, '(147,90),(925,415)');
});

// ── Through the page pipeline ───────────────────────────────────────────────

test('figures survive normalization, which would otherwise delete their boxes', async () => {
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [{ label: 'Page 1', pageNumber: 1, dataUrl: pageDataUrl }],
    ensureServer: async () => {},
    saveFigure: ({ index }) => ({ path: `/g/assets/fig-${index}.png` }),
    runner: async () => ({
      text: 'Some body text.\n\n(147,90),(925,415)\n\nFigure 1: Setup',
      earlyStopped: false,
    }),
  });

  assert.equal(result.figureCount, 1);
  assert.ok(result.markdown.includes('![Figure 1: Setup](/g/assets/fig-1.png)'));
});

test('without a saver the pipeline behaves exactly as it did before', async () => {
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [{ label: 'Page 1', pageNumber: 1, dataUrl: pageDataUrl }],
    ensureServer: async () => {},
    runner: async () => ({
      text: 'Body text.\n\n(147,90),(925,415)',
      earlyStopped: false,
    }),
  });
  assert.equal(result.figureCount, 0);
  assert.ok(!result.markdown.includes('(147,90)'), 'coordinates still stripped');
});

test('the Runtime V2 ingest worker persists figures as page assets and counts them', () => {
  const route = source('../src/app/api/ingest/route.ts');
  const worker = source('../src/lib/runtime-v2/ingest-executor.ts');
  // The thin Next route owns authentication, upload staging, and the Runtime
  // submission only. Figure extraction belongs to the finite worker.
  assert.match(route, /jobType: "document-ingestion"/);
  assert.doesNotMatch(route, /function vlmFigureSaver\(/);
  assert.match(worker, /function vlmFigureSaver\(/);
  // Both the PDF and the single-image path pass a saver.
  assert.equal((worker.match(/saveFigure: vlmFigureSaver\(/g) ?? []).length, 2);
  // The count that reaches the persisted payload has to come from the VLM
  // result rather than being recomputed or defaulted. The local variable it is
  // carried in is not the contract, so this pins the derivation and the
  // destination instead of the identifier.
  assert.equal((worker.match(/figureCount = vlm\.figureCount/g) ?? []).length, 2);
  assert.match(worker, /^\s*figureCount,$/m);
});
