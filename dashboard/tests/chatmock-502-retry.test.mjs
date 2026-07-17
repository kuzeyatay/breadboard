import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HTTP_502_ATTEMPT_DELAYS_MS,
  HTTP_502_MAX_ATTEMPTS,
  HTTP_502_RETRY_INTERVAL_MS,
  retryHttp502,
} from '../src/lib/http-502-retry.ts';
import { attachLearnTokenUsageTracking } from '../src/lib/learn-token-usage.ts';

function errorWithStatus(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function fakeClient(create) {
  return { chat: { completions: { create } } };
}

test('502 retries use six total attempts: three adjacent then three four-minute waits', async () => {
  const sleeps = [];
  const attempts = [];
  const announcedAttempts = [];
  const announcedDelays = [];
  await assert.rejects(
    () => retryHttp502(
      async (attempt) => {
        attempts.push(attempt);
        throw errorWithStatus(502);
      },
      {
        onDelay: (attempt) => announcedDelays.push(attempt),
        onAttempt: (attempt) => announcedAttempts.push(attempt),
        sleep: async (delayMs) => {
          if (delayMs > 0) sleeps.push(delayMs);
        },
      },
    ),
    (error) => error.status === 502,
  );

  assert.equal(attempts.length, HTTP_502_MAX_ATTEMPTS);
  assert.deepEqual(sleeps, [
    HTTP_502_RETRY_INTERVAL_MS,
    HTTP_502_RETRY_INTERVAL_MS,
    HTTP_502_RETRY_INTERVAL_MS,
  ]);
  assert.deepEqual(
    attempts.map(({ delayMs }) => delayMs),
    [...HTTP_502_ATTEMPT_DELAYS_MS],
  );
  assert.deepEqual(announcedAttempts, attempts);
  assert.deepEqual(
    announcedDelays.map(({ attempt, delayMs }) => ({ attempt, delayMs })),
    [4, 5, 6].map((attempt) => ({
      attempt,
      delayMs: HTTP_502_RETRY_INTERVAL_MS,
    })),
  );
});

test('a successful third adjacent attempt returns immediately', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await retryHttp502(
    async () => {
      calls += 1;
      if (calls < 3) throw errorWithStatus(502);
      return 'recovered';
    },
    { sleep: async (delayMs) => sleeps.push(delayMs) },
  );

  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, []);
});

test('non-502 responses and thrown network errors are not retried', async () => {
  for (const failure of [errorWithStatus(503), new Error('connection failed')]) {
    let calls = 0;
    await assert.rejects(
      () => retryHttp502(async () => {
        calls += 1;
        throw failure;
      }, { sleep: async () => undefined }),
      failure,
    );
    assert.equal(calls, 1);
  }
});

test('Learn tracks six transport attempts as one logical model call', async () => {
  const events = [];
  const createOptions = [];
  const controller = new AbortController();
  let calls = 0;
  const client = fakeClient(async (_body, options) => {
    calls += 1;
    createOptions.push(options);
    if (calls < 6) throw errorWithStatus(502);
    return { usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } };
  });

  attachLearnTokenUsageTracking(
    client,
    (event) => events.push(event),
    { retry502: { signal: controller.signal, sleep: async () => undefined } },
  );
  const response = await client.chat.completions.create(
    { model: 'gpt-5.6-sol' },
    { timeout: 1234, maxRetries: 99 },
  );

  assert.equal(response.usage.total_tokens, 10);
  assert.equal(calls, 6);
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  assert.ok(createOptions.every((options) => options.maxRetries === 0));
  assert.ok(createOptions.every((options) => options.timeout === 1234));
  assert.ok(createOptions.every((options) => options.signal === controller.signal));
});

test('aborting a Learn job interrupts the in-flight transport request', async () => {
  const events = [];
  const controller = new AbortController();
  let receivedSignal;
  const client = fakeClient(async (_body, options) => {
    receivedSignal = options.signal;
    return await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });

  attachLearnTokenUsageTracking(
    client,
    (event) => events.push(event),
    { retry502: { signal: controller.signal } },
  );
  const request = client.chat.completions.create({ model: 'gpt-5.6-sol' });
  await Promise.resolve();
  controller.abort(new Error('Learn job cancelled'));

  await assert.rejects(request, /Learn job cancelled/);
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  assert.equal(events[1].usage, null);
});
