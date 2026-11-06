import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { normalizeDocumentPath, normalizeDocumentSlug } from '../src/lib/garden-document-path.ts';

test('documents may share their garden name in bare, nested, URL and encoded paths', () => {
  for (const cluster of ['circuits', 'math-1', 'electromagnetism-1']) {
    for (const input of [cluster, `${cluster}.md`, `sources/${cluster}`, `sources/${cluster}.html`,
      `${cluster}/${cluster}`, `${cluster}/sources/${cluster}`, `/garden/${cluster}/sources/${cluster}.md`,
      `sources\\${cluster}.md`, `https://reader.test/${cluster}/sources/${cluster}#overview`,
      `https://host.test/garden/${cluster}?note=${encodeURIComponent(`sources/${cluster}`)}`,
      encodeURIComponent(encodeURIComponent(`sources/${cluster}`))]) {
      assert.equal(normalizeDocumentSlug(cluster, input), cluster, input);
      assert.equal(normalizeDocumentSlug(cluster, normalizeDocumentSlug(cluster, input)), cluster, 'repeated normalization preserves identity');
    }
    assert.equal(normalizeDocumentPath(cluster, `sources/${cluster}/lesson`), `sources/${cluster}/lesson`);
    assert.equal(normalizeDocumentPath(cluster, `${cluster}/sources/${cluster}/lesson`), `sources/${cluster}/lesson`);
  }
});

test('folder indexes and unsafe paths remain invalid', () => {
  for (const input of ['', 'index', '_index', 'circuits/index', 'sources/_index.md',
    'garden/circuits', 'circuits/../outside', 'sources/./circuits', '../circuits',
    'https://reader.test/circuits/../outside', '%252e%252e%252fcircuits', 'C:\\circuits',
    'circuits\0', 'note?note=']) {
    assert.equal(normalizeDocumentPath('circuits', input), null, input);
    assert.equal(normalizeDocumentSlug('circuits', input), null, input);
  }
  assert.equal(normalizeDocumentSlug('circuits', 'note?note=other'), 'other');
  assert.equal(normalizeDocumentSlug('circuits', 'https://reader.test/circuits/sources/another'), 'another');
});

test('both garden hosts recognize a same-name note without mistaking folder indexes for notes', () => {
  for (const file of ['garden/[clusterSlug]/garden-client.tsx', 'garden/library-garden-client.tsx']) {
    const source = fs.readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8');
    const start = source.indexOf('function decodeQuartzSlug(');
    const end = source.indexOf('\n}', source.indexOf('function isMarkdownDocumentSlug(', start)) + 2;
    const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const helpers = new Function('normalizeDocumentPath', `${code};return {noteSlugFromQuartzSlug,isMarkdownDocumentSlug}`)(normalizeDocumentPath);
    for (const value of ['circuits', 'circuits/circuits', 'circuits/sources/circuits', 'garden/circuits/sources/circuits']) {
      const note = helpers.noteSlugFromQuartzSlug(value, 'circuits');
      assert.equal(helpers.isMarkdownDocumentSlug(note, 'circuits'), true, `${file}: ${value}`);
    }
    for (const value of ['circuits/index', 'circuits/sources/index', 'tags/circuits']) {
      assert.equal(helpers.isMarkdownDocumentSlug(helpers.noteSlugFromQuartzSlug(value, 'circuits'), 'circuits'), false);
    }
  }
});
