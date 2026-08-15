import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('garden card actions use client navigation and cannot start a card drag', () => {
  const dashboard = read('src/app/dashboard/dashboard-client.tsx');

  assert.match(dashboard, /<Link\s+data-card-action="true"\s+href=\{`\/garden\/\$\{cluster\.slug\}`\}/);
  assert.match(dashboard, /<Link\s+data-card-action="true"\s+href=\{`\/gardens\/\$\{cluster\.slug\}`\}/);
  assert.match(dashboard, /dragSource\.closest\('\[data-card-action="true"\]'\)/);
  assert.doesNotMatch(dashboard, /<a\s+data-card-action="true"\s+href=\{`\/gardens?\/\$\{cluster\.slug\}`\}/);
});

test('the garden preview uses a prefetched client navigation link', () => {
  const graph = read('src/app/components/knowledge-graph.tsx');

  assert.match(graph, /import Link from 'next\/link';/);
  assert.match(graph, /<Link\s+href=\{graphHref\(clusterSlug\)\}\s+prefetch/);
  assert.doesNotMatch(graph, /<a\s+href=\{graphHref\(clusterSlug\)\}/);
});
