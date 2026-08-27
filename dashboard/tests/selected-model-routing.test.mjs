import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const resolver = source('../src/lib/selected-model.ts');
const ingestRoute = source('../src/app/api/ingest/route.ts');
const ingestWorker = source('../src/lib/runtime-v2/ingest-executor.ts');
const learnRoute = (action) =>
  source(`../src/app/api/gardens/[gardenId]/learn/${action}/route.ts`);

const LEARN_ACTIONS = ['plan', 'generate', 'regenerate', 'rebuild', 'confirm'];

test('the resolver reads the user preference and never lets a lookup fail a run', () => {
  assert.match(resolver, /getHermesUserSettings\(userId\)/);
  assert.match(resolver, /normalizeAssistantModelId\(settings\.defaultModel\) \?\? DEFAULT_MODEL/);
  // A signed-out or broken lookup falls back rather than throwing.
  assert.match(resolver, /catch \{\s*return DEFAULT_MODEL;/);
  assert.match(resolver, /if \(typeof userId !== "number"/);
});

test('the ingestion pipeline no longer hardcodes a model', () => {
  assert.doesNotMatch(ingestRoute, /DEFAULT_MODEL/);
  assert.match(ingestRoute, /model = selectedModelForUser\(userId\)/);
  assert.match(ingestRoute, /jobType: "document-ingestion"/);
});

test('every AI call in the ingestion pipeline receives the resolved model', () => {
  // The three ChatMock calls plus the note writer all take `model`.
  for (const call of [
    'transcribePageImage',
    'formatPdfPagesAsMarkdown',
    'extractDocumentKnowledge',
    'writeDocumentKnowledge',
  ]) {
    assert.match(
      ingestWorker,
      new RegExp(`${call}\\(\\{[^}]*\\bmodel\\b`, 's'),
      `${call} is not passed the model`,
    );
  }
  // Handwriting OCR fans out over pages; the model has to reach that worker.
  assert.match(ingestWorker, /transcribePdfPages\(\s*client!,\s*model,/);
});

test('the Learn panel runs on the selected model too', () => {
  for (const action of LEARN_ACTIONS) {
    const route = learnRoute(action);
    assert.match(
      route,
      /selectedModelForUser\(userId\)/,
      `${action} does not resolve the selected model`,
    );
    assert.doesNotMatch(route, /LEARN_MODEL/, `${action} still pins the model`);
  }
});

test('a caller cannot steer ingestion or Learn onto another model', () => {
  // The model comes from the stored preference, not from request input.
  assert.doesNotMatch(ingestRoute, /formData\.get\("model"\)/);
  for (const action of LEARN_ACTIONS) {
    assert.doesNotMatch(learnRoute(action), /body\.model/);
  }
});

test('the old pinning rationale is replaced, not silently left behind', () => {
  const learn = source('../src/lib/learn.ts');
  assert.doesNotMatch(
    learn,
    /It must not\s*\*? ?inherit the interactive assistant's currently selected model/,
  );
  assert.match(learn, /Fallback model for Learn/);
});
