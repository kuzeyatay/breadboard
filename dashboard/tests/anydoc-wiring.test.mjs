import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const ingestRoute = source('../src/app/api/ingest/route.ts');
const statusRoute = source('../src/app/api/anydoc/status/route.ts');
const option = source('../src/app/components/anydoc-parse-option.tsx');
const workspace = source('../src/app/gardens/[clusterSlug]/workspace-client.tsx');
const dashboard = source('../src/app/dashboard/dashboard-client.tsx');
const nextConfig = source('../next.config.ts');
const envExample = source('../.env.example');
const packageJson = JSON.parse(source('../package.json'));

test('both upload panels offer the option and post it to the ingest route', () => {
  for (const [name, client] of [
    ['garden workspace', workspace],
    ['dashboard', dashboard],
  ]) {
    assert.match(client, /from "@\/app\/components\/anydoc-parse-option"/, name);
    assert.match(client, /<AnydocParseOption/, name);
    assert.match(
      client,
      /formData\.append\("parseWithAnydoc", String\(usesAnydoc\)\)/,
      name,
    );
    // The option only applies to files anydoc can convert.
    assert.match(client, /ANYDOC_PARSE_FILE_RE\.test\(file\.name\)/, name);
    // It is not offered when the converter cannot be loaded.
    assert.match(client, /anydocStatus\.available/, name);
  }
});

test('one reader claims each file, most specific first', () => {
  for (const client of [workspace, dashboard]) {
    // The VLM reads pixels and outranks anydoc on the PDFs they both accept.
    assert.match(
      client,
      /const usesAnydoc =\s*!usesVlm &&\s*parseWithAnydoc/,
    );
    // Handwriting OCR is the fallback for the pages neither was asked for.
    assert.match(
      client,
      /const usesHandwriting =\s*!usesVlm &&\s*!usesAnydoc &&\s*isHandwriting/,
    );
  }
});

test('the ingest route reads the flag and converts the formats anydoc knows', () => {
  assert.match(ingestRoute, /formData\.get\("parseWithAnydoc"\) === "true"/);
  assert.match(ingestRoute, /formData\.get\("parseMode"\) === "anydoc"/);
  assert.match(
    ingestRoute,
    /const useAnydoc = Boolean\(anydocFormat\) && !useVlm/,
  );
  assert.match(ingestRoute, /convertWithAnydoc\(\{/);
  // Anything else is read the normal way, with a note saying so.
  assert.match(ingestRoute, /is not a format anydoc converts/);
});

test('an anydoc-parsed PDF keeps its original beside the note', () => {
  assert.match(ingestRoute, /if \(ext === "pdf"\) \{\s*sourcePdfPath = saveUploadedPdfAsset/);
});

test('an anydoc-parsed source records how it was read', () => {
  assert.match(ingestRoute, /extraction_method: `anydoc-\$\{ANYDOC_VERSION\}`/);
  assert.match(ingestRoute, /parse_mode: "anydoc"/);
});

test('embedded images are written into the garden the document belongs to', () => {
  assert.match(ingestRoute, /function anydocImageSaver\(/);
  assert.match(ingestRoute, /createdFilePaths\.push\(filePath\)/);
  // A failed write is skipped, not fatal: the text conversion already worked.
  assert.match(ingestRoute, /\/\/ An image that cannot be written is reported as skipped, not fatal\./);
});

test('the status route probes without touching an upload', () => {
  assert.match(statusRoute, /anydocAvailability\(\)/);
  assert.match(statusRoute, /await requireUserId\(\)/);
});

test('the option explains itself when the converter is unavailable', () => {
  assert.match(option, /ANYDOC_ENABLED=true/);
  assert.match(option, /npm install @firecrawl\/anydoc/);
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
  assert.match(envExample, /Parse with anydoc/);
});
