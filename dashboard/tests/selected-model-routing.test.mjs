import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveLearnRequestModel, InvalidLearnRouteBodyError } from '../src/lib/learn-route-errors.ts';

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

test('ingestion uses the profile, while Learn accepts a validated run override', () => {
  assert.doesNotMatch(ingestRoute, /formData\.get\("model"\)/);
  for (const action of LEARN_ACTIONS) {
    assert.match(learnRoute(action), /resolveLearnRequestModel\(body, selectedModelForUser\(userId\)\)/);
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


test('Learn overrides accept concrete model IDs and fall back only when omitted', () => {
  assert.equal(resolveLearnRequestModel({}, 'gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(resolveLearnRequestModel({model:' cliproxy/claude-opus-5 '}, 'gpt-5.6-sol'), 'cliproxy/claude-opus-5');
  for (const model of [null, '', 42, {}, [], 'default', 'chat', 'AUTO', 'invalid model']) {
    assert.throws(() => resolveLearnRequestModel({model}, 'gpt-5.6-sol'), InvalidLearnRouteBodyError);
  }
});

test('Learn requires an explicit model when the profile default is disabled', () => {
  for (const body of [{}, {model: 'none'}, {model: ' none '}]) {
    assert.throws(() => resolveLearnRequestModel(body, 'none'), /No default model is selected/);
  }
  assert.equal(resolveLearnRequestModel({model: 'gpt-6-astra'}, 'none'), 'gpt-6-astra');
});
