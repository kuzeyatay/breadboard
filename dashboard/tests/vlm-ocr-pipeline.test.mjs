import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_VLM_OCR_BASE_URL,
  DEFAULT_VLM_OCR_HF_REPO,
  loadVlmOcrConfig,
  normalizeVlmBaseUrl,
  vlmOcrServerHost,
  vlmOcrServerIsLocal,
  vlmOcrServerPort,
} from '../src/lib/vlm-ocr/config.ts';
import { buildVlmOcrServerArgs, vlmOcrWeightsSource } from '../src/lib/vlm-ocr/server.ts';
import { runVlmOcrPage, streamDeltaText } from '../src/lib/vlm-ocr/client.ts';
import { VlmOcrRequestError } from '../src/lib/vlm-ocr/errors.ts';
import {
  parsePageBatchesWithVlm,
  parsePagesWithVlm,
} from '../src/lib/vlm-ocr/parse.ts';
import { VLM_OCR_TASK_PROMPTS } from '../src/lib/vlm-ocr/prompts.ts';

const noopEnsure = async () => {};

function fakePage(pageNumber) {
  return {
    label: `Page ${pageNumber}`,
    pageNumber,
    dataUrl: `data:image/jpeg;base64,page${pageNumber}`,
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

test('the base URL is normalized to an OpenAI-compatible /v1 root', () => {
  assert.equal(normalizeVlmBaseUrl('127.0.0.1:9000', 'fallback'), 'http://127.0.0.1:9000/v1');
  assert.equal(
    normalizeVlmBaseUrl('http://127.0.0.1:9000/v1/', 'fallback'),
    'http://127.0.0.1:9000/v1',
  );
  assert.equal(normalizeVlmBaseUrl('', 'fallback'), 'fallback');
  assert.equal(normalizeVlmBaseUrl('::not a url::', 'fallback'), 'fallback');
});

test('defaults avoid the ports Scriberr and Quartz already use', () => {
  const config = loadVlmOcrConfig({});
  assert.equal(config.baseUrl, DEFAULT_VLM_OCR_BASE_URL);
  assert.equal(vlmOcrServerPort(config), 8077);
  assert.notEqual(vlmOcrServerPort(config), 8080, 'llama.cpp default collides with Scriberr');
  assert.notEqual(vlmOcrServerPort(config), 8081, 'Quartz');
  assert.equal(config.hfRepo, DEFAULT_VLM_OCR_HF_REPO);
  assert.equal(config.enabled, true);
  assert.equal(config.autoStart, true);
  // Upstream's decoding settings for this model.
  assert.equal(config.temperature, 0);
  assert.equal(config.topK, 1);
  assert.equal(config.topP, 1);
  assert.equal(config.repeatPenalty, 1);
  assert.equal(config.maxTokens, 4096);
  assert.equal(config.contextSize, 10240);
});

test('env overrides are parsed and out-of-range values fall back', () => {
  const config = loadVlmOcrConfig({
    VLM_OCR_ENABLED: 'false',
    VLM_OCR_BASE_URL: 'localhost:9999',
    VLM_OCR_AUTO_START: 'no',
    VLM_OCR_MAX_PAGES: '12',
    VLM_OCR_PAGE_IMAGE_WIDTH: '99999',
    VLM_OCR_CONCURRENCY: '3',
  });
  assert.equal(config.enabled, false);
  assert.equal(config.autoStart, false);
  assert.equal(config.baseUrl, 'http://localhost:9999/v1');
  assert.equal(config.maxPages, 12);
  assert.equal(config.pageImageWidth, 1400, 'out-of-range width falls back');
  assert.equal(config.concurrency, 3);
});

test('a remote base URL is recognized as not startable from here', () => {
  const local = loadVlmOcrConfig({});
  assert.equal(vlmOcrServerIsLocal(local), true);
  const remote = loadVlmOcrConfig({ VLM_OCR_BASE_URL: 'http://gpu-box.lan:8077' });
  assert.equal(vlmOcrServerHost(remote), 'gpu-box.lan');
  assert.equal(vlmOcrServerIsLocal(remote), false);
});

// ── Server arguments ────────────────────────────────────────────────────────

test('llama-server is launched with the model and its vision projector', () => {
  const args = buildVlmOcrServerArgs(loadVlmOcrConfig({}));
  assert.deepEqual(args, [
    '--host', '127.0.0.1',
    '--port', '8077',
    '--alias', 'hunyuan-ocr',
    '--ctx-size', '10240',
    '--n-predict', '4096',
    '--parallel', '1',
    '--cache-ram', '0',
    '--no-cache-prompt',
    '--jinja',
    '-hf', 'ggml-org/HunyuanOCR-GGUF:Q8_0',
  ]);
});

test('explicit GGUF paths replace the Hugging Face download', () => {
  const config = loadVlmOcrConfig({
    VLM_OCR_MODEL_PATH: '/models/hyocr.gguf',
    VLM_OCR_MMPROJ_PATH: '/models/mmproj-hyocr.gguf',
    VLM_OCR_GPU_LAYERS: '99',
    VLM_OCR_CONCURRENCY: '3',
  });
  const args = buildVlmOcrServerArgs(config);
  assert.ok(!args.includes('-hf'));
  assert.equal(args[args.indexOf('--model') + 1], '/models/hyocr.gguf');
  assert.equal(args[args.indexOf('--mmproj') + 1], '/models/mmproj-hyocr.gguf');
  assert.equal(args[args.indexOf('--n-gpu-layers') + 1], '99');
  assert.equal(args[args.indexOf('--parallel') + 1], '3');
  assert.match(vlmOcrWeightsSource(config), /hyocr\.gguf \+ .*mmproj/);
});

// ── Streaming ───────────────────────────────────────────────────────────────

test('stream deltas are read and terminators ignored', () => {
  assert.equal(
    streamDeltaText(JSON.stringify({ choices: [{ delta: { content: 'ab' } }] })),
    'ab',
  );
  assert.equal(streamDeltaText('[DONE]'), '');
  assert.equal(streamDeltaText('not json'), '');
  assert.equal(streamDeltaText(JSON.stringify({ choices: [] })), '');
});

test('a half-open SSE body cannot outlive the VLM page deadline', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
            ),
          );
          // Deliberately never close: this models llama-server ending its slot
          // without completing the HTTP response body.
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  try {
    const startedAt = Date.now();
    await assert.rejects(
      runVlmOcrPage({
        config: {
          ...loadVlmOcrConfig({}),
          model: 'hunyuan-ocr',
          requestTimeoutMs: 25,
        },
        dataUrl: 'data:image/jpeg;base64,page',
        prompt: VLM_OCR_TASK_PROMPTS.doc_parse,
      }),
      (error) =>
        error instanceof VlmOcrRequestError &&
        /did not answer within 0s/.test(error.message),
    );
    assert.ok(Date.now() - startedAt < 1_000, 'the stalled body should be bounded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Page pipeline ───────────────────────────────────────────────────────────

test('each page is sent the official prompt and lands under its own heading', async () => {
  const seen = [];
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1), fakePage(2)],
    ensureServer: noopEnsure,
    runner: async ({ dataUrl, prompt }) => {
      seen.push({ dataUrl, prompt });
      return { text: `# Heading ${dataUrl.slice(-1)}\n\nBody text.`, earlyStopped: false };
    },
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].prompt, VLM_OCR_TASK_PROMPTS.doc_parse);
  assert.ok(result.markdown.includes('## Page 1'));
  assert.ok(result.markdown.includes('## Page 2'));
  // The document's own headings are pushed below the page headings.
  assert.ok(result.markdown.includes('### Heading 1'));
  assert.equal(result.failedPages, 0);
  assert.deepEqual(result.warnings, []);
});

test('large documents consume one rendered VLM page batch at a time', async () => {
  const progress = [];
  const consumedBatches = [];
  let activeBatch = null;

  async function* batches() {
    for (const numbers of [[1, 2, 3, 4], [5, 6, 7, 8], [9]]) {
      assert.equal(activeBatch, null, 'the prior image batch must be released first');
      activeBatch = numbers;
      yield numbers.map(fakePage);
      consumedBatches.push(numbers);
      activeBatch = null;
    }
  }

  const result = await parsePageBatchesWithVlm({
    config: loadVlmOcrConfig({}),
    batches: batches(),
    totalPages: 9,
    ensureServer: noopEnsure,
    onProgress: (step) => progress.push(step),
    runner: async ({ dataUrl }) => {
      const pageNumber = Number(dataUrl.slice(-1));
      assert.ok(activeBatch.includes(pageNumber));
      return { text: `Content ${pageNumber}.`, earlyStopped: false };
    },
  });

  assert.deepEqual(consumedBatches, [[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  assert.equal(result.pages.length, 9);
  assert.match(result.markdown, /## Page 9/);
  assert.equal(progress.at(-1), 'Parsing with the VLM (9/9 pages)…');
});

test('a task other than doc_parse sends that task\'s official prompt', async () => {
  let sent = '';
  await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1)],
    task: 'table',
    ensureServer: noopEnsure,
    runner: async ({ prompt }) => {
      sent = prompt;
      return { text: 'x', earlyStopped: false };
    },
  });
  assert.equal(sent, VLM_OCR_TASK_PROMPTS.table);
});

test('one failing page does not lose the rest of the document', async () => {
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1), fakePage(2), fakePage(3)],
    ensureServer: noopEnsure,
    runner: async ({ dataUrl }) => {
      if (dataUrl.endsWith('2')) throw new Error('server said no');
      return { text: 'Readable content.', earlyStopped: false };
    },
  });

  assert.equal(result.failedPages, 1);
  assert.equal(result.pages.length, 3);
  assert.ok(result.markdown.includes('## Page 1'));
  assert.ok(result.markdown.includes('## Page 3'));
  assert.match(result.warnings.join(' '), /Page 2.*server said no/);
});

test('a transient model transport loss waits for recovery and retries the interrupted page', async () => {
  let runs = 0;
  let ensured = 0;
  const progress = [];
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1)],
    ensureServer: async () => {
      ensured += 1;
    },
    onProgress: (step) => progress.push(step),
    runner: async () => {
      runs += 1;
      if (runs === 1) throw new VlmOcrRequestError('connection closed');
      return { text: 'Recovered content.', earlyStopped: false };
    },
  });

  assert.equal(runs, 2);
  assert.equal(ensured, 2, 'initial readiness plus recovery readiness');
  assert.equal(result.failedPages, 0);
  assert.match(result.markdown, /Recovered content/);
  assert.ok(progress.some((step) => step.includes('Recovering the local OCR model server')));
});

test('a page cut short by repetition is reported, not silently truncated', async () => {
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1)],
    ensureServer: noopEnsure,
    runner: async () => ({ text: 'Partial content.', earlyStopped: true }),
  });
  assert.equal(result.truncatedPages, 1);
  assert.match(result.warnings.join(' '), /repeating itself/);
});

test('VLM_OCR_MAX_PAGES caps the run and says so', async () => {
  let calls = 0;
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({ VLM_OCR_MAX_PAGES: '2' }),
    pages: [fakePage(1), fakePage(2), fakePage(3)],
    ensureServer: noopEnsure,
    runner: async () => {
      calls += 1;
      return { text: 'ok', earlyStopped: false };
    },
  });
  assert.equal(calls, 2);
  assert.match(result.warnings.join(' '), /Only the first 2 of 3 pages/);
});

test('model output is lowered to renderable markdown before it is returned', async () => {
  const result = await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1)],
    ensureServer: noopEnsure,
    runner: async () => ({
      text:
        '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>\n\n' +
        'Threshold <t> exceeded.\n\n$$ \\left( x + 1',
      earlyStopped: false,
    }),
  });

  assert.ok(!result.markdown.includes('<table'));
  assert.ok(result.markdown.includes('| a | b |'));
  assert.ok(!result.markdown.includes('<t>'));
  assert.ok(result.markdown.includes('\\right.'), 'the open \\left was balanced');
});

test('the model server is only contacted once per document', async () => {
  let ensured = 0;
  await parsePagesWithVlm({
    config: loadVlmOcrConfig({}),
    pages: [fakePage(1), fakePage(2)],
    ensureServer: async () => {
      ensured += 1;
    },
    runner: async () => ({ text: 'ok', earlyStopped: false }),
  });
  assert.equal(ensured, 1);
});

test('an aborted upload propagates instead of saving a half-read document', async () => {
  const controller = new AbortController();
  await assert.rejects(
    parsePagesWithVlm({
      config: loadVlmOcrConfig({}),
      pages: [fakePage(1), fakePage(2)],
      signal: controller.signal,
      ensureServer: noopEnsure,
      runner: async () => {
        controller.abort();
        return { text: 'partial', earlyStopped: false };
      },
    }),
    (error) => error.name === 'AbortError',
  );
});
