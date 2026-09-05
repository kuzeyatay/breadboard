import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const ingestRoute = source('../src/app/api/ingest/route.ts');
const ingestExecutor = source('../src/lib/runtime-v2/ingest-executor.ts');
const anydocPdfWorker = source('../scripts/runtime-v2-anydoc-pdf-worker.mjs');
const vlmOcrService = source('../scripts/runtime-v2-vlm-ocr-service.mjs');
const statusRoute = source('../src/app/api/vlm-ocr/status/route.ts');
const option = source('../src/app/components/vlm-parse-option.tsx');
const workspace = source('../src/app/gardens/[clusterSlug]/workspace-client.tsx');
const dashboard = source('../src/app/dashboard/dashboard-client.tsx');
const gardenUploadStore = source('../src/lib/garden-upload-store.ts');
const envExample = source('../.env.example');

test('both upload panels offer the option and post it to the ingest route', () => {
  for (const [name, client] of [
    ['garden workspace', workspace],
    ['dashboard', dashboard],
  ]) {
    assert.match(client, /from "@\/app\/components\/vlm-parse-option"/, name);
    assert.match(client, /<VlmParseOption/, name);
    // It is not offered when the model server cannot be reached.
    assert.match(client, /vlmStatus\.available/, name);
  }
  for (const [name, uploader] of [
    ['persistent garden upload engine', gardenUploadStore],
    ['dashboard', dashboard],
  ]) {
    assert.match(
      uploader,
      /formData\.append\("parseWithVlm", String\(usesVlm\)\)/,
      name,
    );
    // The option only applies to files that rasterize into pages.
    assert.match(uploader, /VLM_PARSE_FILE_RE\.test\(file\.name\)/, name);
  }
});

test('handwriting OCR yields to selected document readers in both panels', () => {
  for (const client of [workspace, dashboard]) {
    assert.match(client, /if \(next\) setIsHandwriting\(false\)/);
    assert.match(
      client,
      /disabled=\{(?:isUploading \|\| )?vlmUploadEnabled\}/,
    );
  }
  for (const uploader of [gardenUploadStore, dashboard]) {
    // Handwriting OCR yields to the VLM on every file the VLM claims. It now
    // also yields to anydoc, which sits between them — see anydoc-wiring.
    assert.match(
      uploader,
      /const usesHandwriting =\s*!usesVlm &&[\s\S]{0,140}(?:isHandwriting|options\.handwriting) &&\s*HANDWRITING_FILE_RE\.test\(file\.name\)/,
    );
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
  assert.match(ingestExecutor, /readPdfVlmCheckpoint\(checkpoint, totalPages\)/);
  assert.match(ingestExecutor, /writePdfVlmCheckpoint\(checkpoint, totalPages, checkpointBatches\)/);
  assert.match(ingestExecutor, /Restoring VLM checkpoint/);
  // Textbooks are rendered and OCR'd in bounded batches rather than retaining
  // every page image until the whole document has finished.
  assert.match(ingestExecutor, /first \+= PDF_VLM_RENDER_BATCH_PAGES/);
  assert.match(ingestExecutor, /desiredWidth: config\.pageImageWidth/);
  assert.match(ingestExecutor, /renderPdfBatchInSubprocess\(\{/);
  assert.match(ingestExecutor, /process\.execPath/);
  assert.match(
    ingestExecutor,
    /finally \{\s*collectReleasedPdfBatchMemory\(\)/,
    'released child output is collected before another batch is rendered',
  );
});

test('a VLM-parsed source records how it was read', () => {
  assert.match(ingestExecutor, /extraction_method: "hunyuan-ocr-gguf"/);
  assert.match(ingestExecutor, /parse_mode: "vlm"/);
});

test('PDF anydoc cross-checks run in a bounded disposable process', () => {
  assert.match(ingestExecutor, /convertPdfWithAnydocInSubprocess\(\{/);
  assert.match(ingestExecutor, /timeout: PDF_ANYDOC_TIMEOUT_MS/);
  assert.match(ingestExecutor, /Retrying anydoc with the VLM OCR text companion/);
  assert.match(anydocPdfWorker, /convertWithAnydoc\(\{/);
  assert.match(anydocPdfWorker, /ext: "pdf"/);
});

test('the Runtime-owned OCR service recycles its native child inside the active lease', () => {
  assert.match(vlmOcrService, /MAX_CHILD_COMPLETED_REQUESTS = 192/);
  assert.match(vlmOcrService, /SLOT_RELEASE_MARKER/);
  assert.match(vlmOcrService, /recycling native child after/);
  assert.match(vlmOcrService, /restarting recycled child/);
  assert.match(vlmOcrService, /stdio: \["ignore", "pipe", "pipe"\]/);
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

test('the option explains the local reader and reports when it is unavailable', () => {
  assert.match(option, /Uses a local OCR model to read each page/);
  assert.match(option, /preserving headings, tables, formulas, and figures/);
  assert.match(option, /VLM_OCR_ENABLED=true/);
  assert.match(option, /No OCR model server at/);
  assert.doesNotMatch(option, /Reads every page with HunyuanOCR/);
  assert.doesNotMatch(option, /downloads the weights once/);
});

test('.env.example documents the option and its llama.cpp requirement', () => {
  assert.match(envExample, /VLM_OCR_ENABLED=true/);
  assert.match(envExample, /VLM_OCR_BASE_URL=http:\/\/127\.0\.0\.1:8077\/v1/);
  assert.match(envExample, /ggml-org\/HunyuanOCR-GGUF:Q8_0/);
  assert.match(envExample, /llama-server/);
});
