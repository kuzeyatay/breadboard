import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the learning map owns the single View garden action', () => {
  const graph = read('src/app/components/knowledge-graph.tsx');
  const workspace = read('src/app/gardens/[clusterSlug]/workspace-client.tsx');

  assert.match(graph, />\s*View garden\s*</);
  assert.match(graph, /aria-label="View garden"/);
  assert.doesNotMatch(graph, /Open Quartz|Open Quartz Learning Map/);
  assert.doesNotMatch(workspace, />\s*View garden\s*</);
});

test('the Quartz preview preserves the browser host and reports real canvas readiness', () => {
  const route = read('src/app/api/quartz-graph-preview/route.ts');
  const graph = read('src/app/components/knowledge-graph.tsx');

  assert.match(route, /request\.headers\.get\('host'\)/);
  assert.match(route, /browserRequestOrigin\(request\)/);
  assert.match(route, /graph\.home-knowledge-graph > \.graph-outer canvas/);
  assert.match(route, /breadboard:quartz-graph-preview/);
  assert.match(graph, /event\.source !== previewFrameRef\.current\?\.contentWindow/);
  assert.match(graph, /previewStatus === 'ready' \? 'opacity-100' : 'opacity-0'/);
  assert.match(graph, /Preview unavailable\./);
  assert.doesNotMatch(graph, /setPreviewReady|Preparing preview/);
});
