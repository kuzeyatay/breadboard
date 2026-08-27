import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const ingestRoute = source('../src/app/api/ingest/route.ts');
const ingestExecutor = source('../src/lib/runtime-v2/ingest-executor.ts');
const statusRoute = source('../src/app/api/vlm-ocr/status/route.ts');
const option = source('../src/app/components/vlm-parse-option.tsx');
const workspace = source('../src/app/gardens/[clusterSlug]/workspace-client.tsx');
const dashboard = source('../src/app/dashboard/dashboard-client.tsx');
const envExample = source('../.env.example');

test('both upload panels offer the option and post it to the ingest route', () => {
  for (const [name, client] of [
    ['garden workspace', workspace],
    ['dashboard', dashboard],
  ]) {
    assert.match(client, /from "@\/app\/components\/vlm-parse-option"/, name);
    assert.match(client, /<VlmParseOption/, name);
    assert.match(
      client,
      /formData\.append\("parseWithVlm", String\(usesVlm\)\)/,
      name,
    );
    // The option only applies to files that rasterize into pages.
    assert.match(client, /VLM_PARSE_FILE_RE\.test\(file\.name\)/, name);
    // It is not offered when the model server cannot be reached.
    assert.match(client, /vlmStatus\.available/, name);
  }
});

test('the two page readers are mutually exclusive in both panels', () => {
  for (const client of [workspace, dashboard]) {
    assert.match(client, /if \(next\) setIsHandwriting\(false\)/);
    // Handwriting OCR yields to the VLM on every file the VLM claims. It now
    // also yields to anydoc, which sits between them — see anydoc-wiring.
    assert.match(
      client,
      /const usesHandwriting =\s*!usesVlm &&[\s\S]{0,40}isHandwriting &&\s*HANDWRITING_FILE_RE\.test\(file\.name\)/,
    );
    assert.match(client, /disabled=\{isUploading \|\| vlmUploadEnabled\}/);
  }
});

test('the ingest route reads the flag and routes PDFs and images through the VLM', () => {
  assert.match(ingestRoute, /upload\.fields\.get\("parseWithVlm"\) === "true"/);
  assert.match(ingestRoute, /upload\.fields\.get\("parseMode"\) === "vlm"/);
  assert.match(
    ingestRoute,
    /requestPayload:\s*\{[\s\S]{0,300}parseWithVlm,/,
    'the authenticated compatibility route seals the choice into the Runtime request',
  );
  // Only page-based files; anything else is read the normal way, with a note.
  assert.match(
    ingestExecutor,
    /const useVlm = parseWithVlm && \(isImageExt\(ext\) \|\| ext === "pdf"\)/,
  );
  assert.match(ingestExecutor, /parsePagesWithVlm\(\{/);
  // Pages are rendered at the width the VLM config asks for.
  assert.match(ingestExecutor, /desiredWidth: vlmConfig\.pageImageWidth/);
});

test('a VLM-parsed source records how it was read', () => {
  assert.match(ingestExecutor, /extraction_method: "hunyuan-ocr-gguf"/);
  assert.match(ingestExecutor, /parse_mode: "vlm"/);
});

test('a missing model server fails the upload loudly instead of saving a stub', () => {
  assert.match(ingestExecutor, /if \(isVlmSetupError\(error\)\) throw error;/);
  assert.match(
    ingestExecutor,
    /error instanceof VlmOcrUnavailableError\s*\|\|\s*error instanceof VlmOcrDisabledError/,
  );
});

test('the parsed markdown is re-checked after the writer would clean it', () => {
  // writeDocumentKnowledge runs cleanGeneratedText over the markdown, so the
  // disposable executor verifies the post-clean text rather than the pre-clean text.
  assert.match(
    ingestExecutor,
    /toBreadboardMarkdown\(cleanGeneratedText\(markdown\)\)/,
  );
});

test('the status route probes without starting a download', () => {
  assert.match(statusRoute, /vlmOcrStatus\(config\)/);
  assert.doesNotMatch(statusRoute, /ensureVlmOcrServer/);
  assert.match(statusRoute, /await requireUserId\(\)/);
});

test('the option explains itself when the model is unavailable', () => {
  assert.match(option, /VLM_OCR_ENABLED=true/);
  assert.match(option, /No OCR model server at/);
});

test('.env.example documents the option and its llama.cpp requirement', () => {
  assert.match(envExample, /VLM_OCR_ENABLED=true/);
  assert.match(envExample, /VLM_OCR_BASE_URL=http:\/\/127\.0\.0\.1:8077\/v1/);
  assert.match(envExample, /ggml-org\/HunyuanOCR-GGUF:Q8_0/);
  assert.match(envExample, /llama-server/);
});
