import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import {
  extractUrls,
  isSearchConfigured,
  searchBackend,
  searchWeb,
} from './search';

const ENV_KEYS = [
  'CHATMOCK_BASE_URL',
  'FIRECRAWL_KEY',
  'FIRECRAWL_BASE_URL',
  'DEEP_RESEARCH_SEARCH_PROVIDER',
];
const original = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
);

function setEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(original as Record<string, string | undefined>));

describe('search backend selection', () => {
  it('prefers ChatMock web search, which needs no third-party credential', () => {
    setEnv({
      CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1',
      FIRECRAWL_KEY: 'fc-key',
    });
    assert.equal(searchBackend(), 'chatmock-web-search');
    assert.equal(isSearchConfigured(), true);
  });

  it('falls back to Firecrawl when ChatMock is not configured', () => {
    setEnv({ FIRECRAWL_KEY: 'fc-key' });
    assert.equal(searchBackend(), 'firecrawl-cloud');
    setEnv({ FIRECRAWL_BASE_URL: 'http://127.0.0.1:3002' });
    assert.equal(searchBackend(), 'firecrawl-self-hosted');
  });

  it('honors an explicit provider preference', () => {
    setEnv({
      CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1',
      FIRECRAWL_KEY: 'fc-key',
      DEEP_RESEARCH_SEARCH_PROVIDER: 'firecrawl',
    });
    assert.equal(searchBackend(), 'firecrawl-cloud');

    setEnv({
      FIRECRAWL_KEY: 'fc-key',
      DEEP_RESEARCH_SEARCH_PROVIDER: 'chatmock',
    });
    // Asking for ChatMock without ChatMock configured is "no backend", never a
    // silent fallback to a different one.
    assert.equal(searchBackend(), null);
  });

  it('falls back to keyless direct search when nothing is configured', () => {
    // A run with no credential and no gateway used to report "no backend" and
    // return an empty report. The direct backend needs neither, so the honest
    // answer is that search is available — thinner, but real.
    setEnv({});
    assert.equal(searchBackend(), 'direct-fetch');
    assert.equal(isSearchConfigured(), true);
  });

  it('honors an explicit direct preference', () => {
    setEnv({
      CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1',
      DEEP_RESEARCH_SEARCH_PROVIDER: 'direct',
    });
    assert.equal(searchBackend(), 'direct-fetch');
  });
});

describe('ChatMock web search', () => {
  const realFetch = globalThis.fetch;

  function stubResponse(content: string, usage?: Record<string, number>) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content } }],
          ...(usage ? { usage } : {}),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns the cited answer as one document, without the think block', async () => {
    setEnv({ CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1' });
    stubResponse(
      '<think>planning</think>Rotterdam commissioned 20 MW of OPS in 2024 ([portofrotterdam.com](https://www.portofrotterdam.com/news?utm_source=openai)).',
    );

    const result = await searchWeb('shore power rotterdam', 5);
    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0]!.includes('<think>'), false);
    assert.ok(result.contents[0]!.startsWith('Rotterdam commissioned'));
    assert.deepEqual(result.urls, ['https://www.portofrotterdam.com/news']);
    assert.deepEqual(result.documents, [
      {
        url: 'https://www.portofrotterdam.com/news',
        content: result.contents[0],
      },
    ]);
  });

  it('discards an answer that cites nothing, so memory cannot become a learning', async () => {
    setEnv({ CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1' });
    stubResponse(
      'Shore power is widely deployed and very cheap. Everyone agrees.',
    );

    assert.deepEqual(await searchWeb('shore power', 5), {
      contents: [],
      urls: [],
    });
  });

  it('reports gateway token usage even when the synthesis is discarded', async () => {
    setEnv({ CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1' });
    stubResponse('Uncited output.', {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });

    assert.deepEqual(await searchWeb('shore power', 5), {
      contents: [],
      urls: [],
      usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
    });
  });

  it('surfaces a failing gateway instead of silently returning no results', async () => {
    setEnv({ CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1' });
    globalThis.fetch = (async () =>
      new Response('upstream exploded', { status: 502 })) as typeof fetch;

    await assert.rejects(() => searchWeb('anything', 5), /502/);
  });

  it('honors an already-aborted run before calling the gateway', async () => {
    setEnv({ CHATMOCK_BASE_URL: 'http://127.0.0.1:8765/v1' });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as typeof fetch;
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await assert.rejects(
      () => searchWeb('anything', 5, { signal: controller.signal }),
      /cancelled/,
    );
    assert.equal(called, false);
  });
});

describe('citation extraction', () => {
  it('pulls markdown-linked and bare URLs, de-duplicated and untracked', () => {
    const text = [
      'Capacity reached 20 MW ([eea.europa.eu](https://www.eea.europa.eu/report?utm_source=openai)).',
      'See also https://example.org/a, and again https://example.org/a.',
      'Full study: https://www.example.com/study.pdf',
    ].join('\n');

    assert.deepEqual(extractUrls(text, 10), [
      'https://www.eea.europa.eu/report',
      'https://example.org/a',
      'https://www.example.com/study.pdf',
    ]);
  });

  it('respects the limit and returns nothing for uncited text', () => {
    const text = 'https://a.example https://b.example https://c.example';
    assert.equal(extractUrls(text, 2).length, 2);
    assert.deepEqual(extractUrls('No sources here.', 5), []);
  });
});
