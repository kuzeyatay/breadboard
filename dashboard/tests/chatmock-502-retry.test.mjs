import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  HTTP_502_ATTEMPT_DELAYS_MS,
  HTTP_502_MAX_ATTEMPTS,
  HTTP_502_RETRY_INTERVAL_MS,
  MODEL_TRANSPORT_TOTAL_DELAY_MS,
  isExplicitProviderQuotaResetError,
  isRetryableModelTransportError,
  modelTransportRetryCause,
  retryModelTransport,
  retryHttp502,
} from '../src/lib/http-502-retry.ts';
import { attachLearnTokenUsageTracking } from '../src/lib/learn-token-usage.ts';

function errorWithStatus(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
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

test('exported transport total delay remains the sum of the scheduled waits', () => {
  assert.equal(
    MODEL_TRANSPORT_TOTAL_DELAY_MS,
    HTTP_502_ATTEMPT_DELAYS_MS.reduce((total, delayMs) => total + delayMs, 0),
  );
  assert.equal(MODEL_TRANSPORT_TOTAL_DELAY_MS, HTTP_502_RETRY_INTERVAL_MS * 3);
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

test('an explicit provider session reset wrapped in 502 is terminal without replay', async () => {
  const quotaReset = errorWithStatus(
    502,
    "You've hit your session limit; resets 1:30pm (Europe/Istanbul)",
  );
  const sleeps = [];
  let calls = 0;

  assert.equal(isExplicitProviderQuotaResetError(quotaReset), true);
  assert.equal(modelTransportRetryCause(quotaReset), undefined);
  assert.equal(isRetryableModelTransportError(quotaReset), false);
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      throw quotaReset;
    }, { sleep: async (delayMs) => sleeps.push(delayMs) }),
    (error) => error === quotaReset,
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('only the recognized ChatMock restart failures are transport-retryable', () => {
  const transientFailures = [
    new Error('Connection error.'),
    Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }),
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
    }),
    new Error('socket hang up'),
    new Error('Response ended prematurely'),
    errorWithStatus(502),
    Object.assign(new Error('HTTP 502: upstream timed out'), { status: 502 }),
    Object.assign(new Error('wrapped'), { response: { status: 502 } }),
  ];
  const terminalFailures = [
    errorWithStatus(503),
    errorWithStatus(429),
    new Error('connection failed'),
    new Error('fetch failed'),
    Object.assign(new Error('request failed'), { code: 'ENOTFOUND' }),
    Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }),
    Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }),
    Object.assign(new Error('Connection error.'), {
      cause: Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }),
    }),
  ];

  for (const failure of transientFailures) {
    assert.equal(isRetryableModelTransportError(failure), true, failure.message);
  }
  for (const failure of terminalFailures) {
    assert.equal(isRetryableModelTransportError(failure), false, failure.message);
  }
});

test('retry metadata distinguishes HTTP 502 from connection failures without changing attempt numbers', async () => {
  const attempts = [];
  const delays = [];
  let calls = 0;
  const result = await retryModelTransport(
    async () => {
      calls += 1;
      if (calls === 1) throw errorWithStatus(502);
      if (calls === 2) {
        throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
      }
      if (calls === 3) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
        });
      }
      return 'recovered';
    },
    {
      onAttempt: (attempt) => attempts.push(attempt),
      onDelay: (attempt) => delays.push(attempt),
      sleep: async () => undefined,
    },
  );

  assert.equal(result, 'recovered');
  assert.equal(calls, 4);
  assert.deepEqual(
    attempts.map(({ attempt, retryCause }) => ({ attempt, retryCause })),
    [
      { attempt: 1, retryCause: undefined },
      { attempt: 2, retryCause: 'http_502' },
      { attempt: 3, retryCause: 'connection_failure' },
      { attempt: 4, retryCause: 'connection_failure' },
    ],
  );
  assert.deepEqual(
    delays.map(({ attempt, retryCause }) => ({ attempt, retryCause })),
    [{ attempt: 4, retryCause: 'connection_failure' }],
  );
  assert.equal(modelTransportRetryCause(errorWithStatus(502)), 'http_502');
  assert.equal(
    modelTransportRetryCause(Object.assign(new Error('reset'), { code: 'ECONNRESET' })),
    'connection_failure',
  );
});

test('Learn retry progress uses a truthful generic event and carries the classified cause', () => {
  const source = fs.readFileSync(new URL('../src/lib/learn.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function attachLearnJobModelTracking');
  const end = source.indexOf('\nfunction updateLearnJob', start);
  assert.ok(start >= 0 && end > start, 'expected the Learn model tracking callback');
  const trackingSource = source.slice(start, end);

  assert.equal(
    [...trackingSource.matchAll(/"learn_model_transport_retry"/g)].length,
    2,
  );
  assert.equal([...trackingSource.matchAll(/\bretryCause\b/g)].length, 4);
  assert.match(trackingSource, /Model transport unavailable/);
  assert.doesNotMatch(trackingSource, /Gateway 502|learn_chatmock_502_retry/);
});

test('a transient connection failure replays the same operation outside semantic accounting', async () => {
  let calls = 0;
  const attempts = [];
  const result = await retryModelTransport(async (attempt) => {
    calls += 1;
    attempts.push(attempt.attempt);
    if (calls === 1) throw new Error('Connection error.');
    if (calls === 2) {
      throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    }
    return 'recovered';
  });

  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
  assert.deepEqual(attempts, [1, 2, 3]);
});

test('cancellation between a transport failure and retry stops replay immediately', async () => {
  const controller = new AbortController();
  const cancellation = new Error('Learn job cancelled');
  let calls = 0;

  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      controller.abort(cancellation);
      throw Object.assign(new Error('connection dropped'), { code: 'ECONNRESET' });
    }, { signal: controller.signal }),
    cancellation,
  );
  assert.equal(calls, 1);
});

test('Learn tracks six mixed transport attempts as one logical model call', async () => {
  const events = [];
  const createOptions = [];
  const transportAttempts = [];
  const controller = new AbortController();
  let calls = 0;
  const client = fakeClient(async (_body, options) => {
    calls += 1;
    createOptions.push(options);
    if (calls < 6) {
      if (calls % 2 === 1) throw errorWithStatus(502);
      throw Object.assign(new Error('connection dropped'), { code: 'ECONNRESET' });
    }
    return { usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } };
  });

  attachLearnTokenUsageTracking(
    client,
    (event) => events.push(event),
    {
      retryTransport: {
        signal: controller.signal,
        onAttempt: (attempt) => transportAttempts.push(attempt),
        sleep: async () => undefined,
      },
    },
  );
  const response = await client.chat.completions.create(
    { model: 'gpt-5.6-sol' },
    { timeout: 1234, maxRetries: 99 },
  );

  assert.equal(response.usage.total_tokens, 10);
  assert.equal(calls, 6);
  assert.deepEqual(
    transportAttempts.map(({ attempt, retryCause }) => ({ attempt, retryCause })),
    [
      { attempt: 1, retryCause: undefined },
      { attempt: 2, retryCause: 'http_502' },
      { attempt: 3, retryCause: 'connection_failure' },
      { attempt: 4, retryCause: 'http_502' },
      { attempt: 5, retryCause: 'connection_failure' },
      { attempt: 6, retryCause: 'http_502' },
    ],
  );
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  assert.ok(createOptions.every((options) => options.maxRetries === 0));
  assert.ok(createOptions.every((options) => options.timeout === 1234));
  assert.ok(createOptions.every((options) => options.signal === controller.signal));
});

test('Learn reuses the exact request body and options across connection retries', async () => {
  const events = [];
  const received = [];
  let calls = 0;
  const client = fakeClient(async (body, options) => {
    calls += 1;
    received.push({ body, options });
    if (calls < 3) throw new Error('Response ended prematurely');
    return { usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } };
  });
  const body = { model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'same' }] };

  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  const response = await client.chat.completions.create(body, { timeout: 4321 });

  assert.equal(response.usage.total_tokens, 13);
  assert.equal(received.length, 3);
  assert.ok(received.every(({ body: receivedBody }) => receivedBody === body));
  assert.ok(received.every(({ options }) => options === received[0].options));
  assert.ok(received.every(({ options }) => options.timeout === 4321));
  assert.ok(received.every(({ options }) => options.maxRetries === 0));
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
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
