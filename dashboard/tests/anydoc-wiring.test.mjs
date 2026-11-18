import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const ingestRoute = source('../src/app/api/ingest/route.ts');
const ingestWorker = source('../src/lib/runtime-v2/ingest-executor.ts');
const statusRoute = source('../src/app/api/anydoc/status/route.ts');
const workspace = source('../src/app/gardens/[clusterSlug]/workspace-client.tsx');
const gardenUploadStore = source('../src/lib/garden-upload-store.ts');
const dashboard = source('../src/app/dashboard/dashboard-client.tsx');
const nextConfig = source('../next.config.ts');
const envExample = source('../.env.example');
const packageJson = JSON.parse(source('../package.json'));

test('anydoc has no upload option: it is always on, and model OCR is the opt-out', () => {
  for (const [name, client, uploader] of [
    ['garden workspace', workspace, gardenUploadStore],
    ['dashboard', dashboard, dashboard],
  ]) {
    assert.doesNotMatch(client, /AnydocParseOption|anydoc-parse-option/, name);
    assert.doesNotMatch(uploader, /usesAnydoc/, name);
    assert.match(client, /Handwriting \/ model OCR/, name);
    assert.match(
      uploader,
      /const usesHandwriting =\s*!usesVlm &&\s*(?:isHandwriting|options\.handwriting)/,
      name,
    );
  }
});

test('the ingest worker prefers the text layer and keeps the model for figures and scans', () => {
  assert.match(ingestRoute, /jobType: "document-ingestion"/);
  assert.match(ingestWorker, /\(await anydocAvailability\(\)\)\.available/);
  assert.match(ingestWorker, /const useAnydoc = Boolean\(anydocFormat\)/);
  assert.match(ingestWorker, /if \(useAnydoc && !useVlm && !\(modelOcr && ext === "pdf"\)\)/);
  assert.match(ingestWorker, /convertWithAnydoc\(\{/);
  // A PDF with no copyable text falls through to model OCR.
  assert.match(ingestWorker, /modelOcr = true;/);
  assert.match(ingestWorker, /\} else if \(modelOcr\) \{/);
  // A failed conversion is read the older way instead of failing the upload.
  assert.match(ingestWorker, /so it was read directly instead/);
  // Text-layer PDFs still get their figures detected and stored.
  assert.match(ingestWorker, /const extractPdfFigures = async/);
  assert.match(ingestWorker, /## Figures/);
});

test('a PDF can be cross-checked by both the VLM and anydoc', () => {
  assert.match(ingestWorker, /Cross-checking PDF text with anydoc/);
  assert.match(ingestWorker, /## AnyDoc cross-check/);
  assert.match(ingestWorker, /parse_mode: "vlm\+anydoc"/);
  assert.match(
    ingestWorker,
    /extraction_method: `hunyuan-ocr-gguf\+anydoc-\$\{ANYDOC_VERSION\}`/,
  );
});

test('an anydoc-parsed PDF keeps its original beside the note', () => {
  assert.match(ingestWorker, /if \(ext === "pdf"\) \{\s*const saved = saveUploadedDocumentAsset/);
});

test('an anydoc-parsed source records how it was read', () => {
  assert.match(ingestWorker, /extraction_method: `anydoc-\$\{ANYDOC_VERSION\}`/);
  assert.match(ingestWorker, /parse_mode: "anydoc"/);
});

test('embedded images are written into the garden the document belongs to', () => {
  assert.match(ingestWorker, /function anydocImageSaver\(/);
  assert.match(ingestWorker, /createdFilePaths\.push\(filePath\)/);
  // A failed write is skipped, not fatal: the text conversion already worked.
  assert.match(ingestWorker, /\/\/ An image that cannot be written is reported as skipped, not fatal\./);
});

test('the status route probes without touching an upload', () => {
  assert.match(statusRoute, /anydocAvailability\(\)/);
  assert.match(statusRoute, /await requireUserId\(\)/);
});

test('the native module is kept out of the bundle and traced into the build', () => {
  // Membership, not position: other packages legitimately join this list, and
  // an assertion on the first entry would fail for a change that has nothing
  // to do with anydoc.
  const externals = /serverExternalPackages:\s*\[([\s\S]*?)\]/.exec(nextConfig)?.[1];
  assert.ok(externals, 'serverExternalPackages must be declared');
  assert.match(externals, /'@firecrawl\/anydoc'/);
  assert.match(nextConfig, /'node_modules\/@firecrawl\/anydoc-win32-x64-msvc\/\*\*\/\*'/);
});

test('the pinned version the UI reports is the one that is installed', () => {
  const declared = packageJson.dependencies['@firecrawl/anydoc'];
  assert.ok(declared, '@firecrawl/anydoc must be a dependency');
  const convert = source('../src/lib/anydoc/convert.ts');
  const pinned = /export const ANYDOC_VERSION = "([^"]+)"/.exec(convert)?.[1];
  assert.ok(pinned, 'ANYDOC_VERSION must be declared');
  assert.equal(declared.replace(/^[^\d]*/, ''), pinned);
});

test('.env.example documents the option', () => {
  assert.match(envExample, /ANYDOC_ENABLED=true/);
  assert.match(envExample, /Every upload is read with anydoc first/);
});
