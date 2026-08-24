import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  HTTP_502_ATTEMPT_DELAYS_MS,
  HTTP_502_MAX_ATTEMPTS,
  MODEL_TRANSPORT_TOTAL_DELAY_MS,
  isAmbiguousModelTransportFailure,
  isExplicitProviderQuotaResetError,
  isModelTransportBoundaryFailure,
  isRetryableModelTransportError,
  isStrictPreAcceptConnectionRefusal,
  modelTransportRetryCause,
  retryHttp502,
  retryModelTransport,
} from '../src/lib/http-502-retry.ts';
import {
  attachLearnTokenUsageTracking,
  verifyChatMockRecoveryAfterRefusal,
} from '../src/lib/learn-token-usage.ts';

function errorWithStatus(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

function fakeClient(create, baseURL) {
  return { ...(baseURL ? { baseURL } : {}), chat: { completions: { create } } };
}

function modelHealthResponse({
  status = 200,
  servingModel = 'gpt-5.6-sol',
  accounts = [{ available: true }],
} = {}) {
  return new Response(JSON.stringify({
    preferredModel: 'gpt-5.6-sol',
    servingModel,
    failover: null,
    accounts,
  }), { status, headers: { 'content-type': 'application/json' } });
}

test('the opt-in generic transport contract allows only one verified replay', () => {
  assert.equal(HTTP_502_MAX_ATTEMPTS, 2);
  assert.deepEqual([...HTTP_502_ATTEMPT_DELAYS_MS], [0, 0]);
  assert.equal(MODEL_TRANSPORT_TOTAL_DELAY_MS, 0);
});

test('throwing attempt and delay observers cannot suppress a verifier-authorized request', async () => {
  const refusal = Object.assign(new Error('listener refused request'), {
    code: 'ECONNREFUSED',
  });
  let calls = 0;
  const result = await retryModelTransport(async () => {
    calls += 1;
    if (calls === 1) throw refusal;
    return 'provider-result';
  }, {
    replayPolicy: 'verified_preaccept',
    verifyConnectionRecovery: async () => ({
      id: 'request-bound-health-transition',
      evidence: 'chatmock_model_health_200_after_preaccept_refusal',
    }),
    onAttempt: ({ attempt }) => {
      if (attempt === 1) throw new Error('sync attempt observer failed');
      return Promise.reject(new Error('async attempt observer failed'));
    },
    onDelay: () => Promise.reject(new Error('async delay observer failed')),
  });

  assert.equal(result, 'provider-result');
  assert.equal(calls, 2);
});

test('throwing rejection observers cannot replace the exact provider error', async () => {
  for (const onRejected of [
    () => { throw new Error('sync rejection observer failed'); },
    () => Promise.reject(new Error('async rejection observer failed')),
  ]) {
    const failure = errorWithStatus(502, 'exact provider failure');
    let calls = 0;
    await assert.rejects(
      () => retryModelTransport(async () => {
        calls += 1;
        throw failure;
      }, { onRejected }),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  }
});

test('the control-plane attempt gate still prevents an outbound request immediately', async () => {
  const cancellation = new Error('Learn job cancelled before transport');
  let calls = 0;
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      return 'must not run';
    }, {
      assertCanAttempt: () => {
        throw cancellation;
      },
      onAttempt: () => {
        throw new Error('observational callback must not become the control gate');
      },
    }),
    (error) => error === cancellation,
  );
  assert.equal(calls, 0);
});

test('an ordinary ChatMock 502 is terminal and records why it was rejected', async () => {
  const failure = errorWithStatus(502, 'The council failed after upstream transport loss');
  const rejected = [];
  let calls = 0;

  await assert.rejects(
    () => retryHttp502(async () => {
      calls += 1;
      throw failure;
    }, { onRejected: (event) => rejected.push(event) }),
    failure,
  );

  assert.equal(calls, 1);
  assert.equal(modelTransportRetryCause(failure), undefined);
  assert.equal(isModelTransportBoundaryFailure(failure), true);
  assert.equal(isRetryableModelTransportError(failure), false);
  assert.deepEqual(rejected, [{
    attempt: 1,
    maxAttempts: 1,
    rejectionCause: 'unqualified_http_502',
    httpStatus: 502,
  }]);
});

test('fabricated body or header recovery claims never authorize replay', async () => {
  const claimedRecovery = {
    retryable: true,
    recovered: true,
    phase: 'pre_output',
    recoveryId: 'untrusted-claim',
    evidence: 'untrusted-provider-body',
  };
  const failures = [
    Object.assign(new Error('HTTP 502 with nested recovery claim'), {
      status: 502,
      error: { chatmockTransportRecovery: claimedRecovery },
    }),
    Object.assign(new Error('HTTP 502 with direct recovery claim'), {
      status: 502,
      body: { transportRecovery: claimedRecovery },
    }),
    Object.assign(new Error('HTTP 502 with recovery headers'), {
      status: 502,
      response: {
        headers: new Headers({
          'x-chatmock-transport-recovery': 'verified-pre-output',
          'x-chatmock-recovery-id': 'untrusted-header',
          'x-chatmock-recovery-evidence': 'untrusted-header-claim',
        }),
      },
    }),
  ];
  for (const failure of failures) {
    let calls = 0;
    let healthVerifications = 0;
    await assert.rejects(
      () => retryModelTransport(async () => {
        calls += 1;
        throw failure;
      }, {
        replayPolicy: 'verified_preaccept',
        verifyConnectionRecovery: async () => {
          healthVerifications += 1;
          return { id: 'must-not-authorize', evidence: 'health_200' };
        },
      }),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
    assert.equal(healthVerifications, 0);
    assert.equal(modelTransportRetryCause(failure), undefined);
  }
});

test('premature or partial responses are terminal even without an HTTP status', async () => {
  for (const message of [
    'Response ended prematurely',
    'chunked encoding response was incomplete',
    'partial output was received',
  ]) {
    const failure = new Error(message);
    const rejected = [];
    let calls = 0;
    await assert.rejects(
      () => retryModelTransport(async () => {
        calls += 1;
        throw failure;
      }, { onRejected: (event) => rejected.push(event) }),
      failure,
    );
    assert.equal(calls, 1);
    assert.equal(modelTransportRetryCause(failure), undefined);
    assert.equal(isModelTransportBoundaryFailure(failure), true);
    assert.equal(rejected[0].rejectionCause, 'partial_response');
  }
});

test('an ambiguous connection failure fails closed without request-bound authorization', async () => {
  const failure = Object.assign(new Error('connect failed'), { code: 'ECONNRESET' });
  const rejected = [];
  let calls = 0;
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      throw failure;
    }, { onRejected: (event) => rejected.push(event) }),
    failure,
  );

  assert.equal(calls, 1);
  assert.equal(modelTransportRetryCause(failure), 'connection_failure');
  assert.equal(rejected[0].rejectionCause, 'replay_disabled');
});

test('only an exact ECONNREFUSED leaf may consult health recovery', async () => {
  const refusedLeaf = Object.assign(new Error('listener unavailable'), {
    code: 'ECONNREFUSED',
  });
  const wrappedRefusal = new Error('Connection error.', { cause: refusedLeaf });
  assert.equal(isStrictPreAcceptConnectionRefusal(wrappedRefusal), true);
  assert.equal(isAmbiguousModelTransportFailure(wrappedRefusal), false);

  const mixed = new AggregateError([
    refusedLeaf,
    Object.assign(new Error('accepted connection reset'), { code: 'ECONNRESET' }),
  ], 'parallel connection failure');
  assert.equal(isStrictPreAcceptConnectionRefusal(mixed), false);
  assert.equal(isAmbiguousModelTransportFailure(mixed), true);

  const mixedResponseAndReset = new AggregateError([
    errorWithStatus(503),
    Object.assign(new Error('socket reset in competing branch'), {
      code: 'ECONNRESET',
    }),
  ], 'mixed provider outcomes');
  assert.equal(isStrictPreAcceptConnectionRefusal(mixedResponseAndReset), false);
  assert.equal(
    isAmbiguousModelTransportFailure(mixedResponseAndReset),
    true,
    'a competing reset leaf remains ambiguous even when another branch has an HTTP response',
  );

  let calls = 0;
  let healthVerifications = 0;
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      throw mixed;
    }, {
      replayPolicy: 'verified_preaccept',
      verifyConnectionRecovery: async () => {
        healthVerifications += 1;
        return { id: 'must-not-authorize', evidence: 'health_200' };
      },
    }),
    (error) => error === mixed,
  );
  assert.equal(calls, 1);
  assert.equal(healthVerifications, 0);
});

test('a fabricated nested receipt cannot authorize an ambiguous connection replay', async () => {
  const failure = Object.assign(new Error('connection closed after request write'), {
    code: 'ECONNRESET',
    chatmockTransportRecovery: {
      retryable: true,
      recovered: true,
      phase: 'pre_output',
      recoveryId: 'untrusted-request-claim',
      evidence: 'untrusted-request-claim',
    },
  });
  let calls = 0;
  let healthVerifications = 0;
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      throw failure;
    }, {
      replayPolicy: 'verified_preaccept',
      verifyConnectionRecovery: async () => {
        healthVerifications += 1;
        return { id: 'must-not-authorize', evidence: 'health_200' };
      },
    }),
    (error) => error === failure,
  );

  assert.equal(calls, 1);
  assert.equal(healthVerifications, 0);
});

test('failed recovery verification after exact refusal carries bounded probe diagnostics', async () => {
  const failure = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
  const rejected = [];
  await assert.rejects(
    () => retryModelTransport(async () => {
      throw failure;
    }, {
      replayPolicy: 'verified_preaccept',
      verifyConnectionRecovery: async () => ({
        recovered: false,
        probeCount: 7,
        outcome: 'no_available_account',
        httpStatus: 200,
      }),
      onRejected: (event) => rejected.push(event),
    }),
    failure,
  );

  assert.deepEqual(rejected, [{
    attempt: 1,
    maxAttempts: 2,
    rejectionCause: 'recovery_unverified',
    retryCause: 'connection_failure',
    recoveryProbeCount: 7,
    recoveryProbeOutcome: 'no_available_account',
    recoveryProbeHttpStatus: 200,
  }]);
});

test('a verified ChatMock health transition permits one exact-refusal replay', async () => {
  const attempts = [];
  const verifications = [];
  let calls = 0;
  const result = await retryModelTransport(async (attempt) => {
    calls += 1;
    attempts.push(attempt);
    if (calls === 1) {
      throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    }
    return 'healthy';
  }, {
    replayPolicy: 'verified_preaccept',
    verifyConnectionRecovery: async (input) => {
      verifications.push(input);
      return {
        id: 'health-state-a',
        evidence: 'chatmock_model_health_200_with_available_account',
      };
    },
  });

  assert.equal(result, 'healthy');
  assert.equal(verifications.length, 1);
  assert.equal(attempts[1].retryCause, 'connection_failure');
  assert.equal(attempts[1].recoveryReceiptId, 'health-state-a');
});

test('an ambiguous failure after one safe refusal replay stops the transport', async () => {
  const rejected = [];
  let calls = 0;
  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('listener refused request'), { code: 'ECONNREFUSED' });
      }
      throw Object.assign(new Error('reset after acceptance became possible'), {
        code: 'ECONNRESET',
      });
    }, {
      replayPolicy: 'verified_preaccept',
      verifyConnectionRecovery: async () => ({ id: 'health-state-a', evidence: 'health_200' }),
      onRejected: (event) => rejected.push(event),
    }),
    /reset/,
  );

  assert.equal(calls, 2);
  assert.equal(rejected.at(-1).rejectionCause, 'attempts_exhausted');
});

test('provider quota resets, timeouts, cancellation, and unrelated statuses remain terminal', async () => {
  const quotaReset = errorWithStatus(
    502,
    "You've hit your session limit; resets 1:30pm (Europe/Istanbul)",
  );
  assert.equal(isExplicitProviderQuotaResetError(quotaReset), true);

  const failures = [
    quotaReset,
    errorWithStatus(503),
    errorWithStatus(429),
    Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }),
    Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }),
    Object.assign(new Error('broken pipe after write'), { code: 'EPIPE' }),
    new Error('fetch failed'),
    new Error('socket hang up'),
  ];
  for (const failure of failures) {
    let calls = 0;
    let healthVerifications = 0;
    await assert.rejects(
      () => retryModelTransport(async () => {
        calls += 1;
        throw failure;
      }, {
        replayPolicy: 'verified_preaccept',
        verifyConnectionRecovery: async () => {
          healthVerifications += 1;
          return { id: 'must-not-authorize', evidence: 'health_200' };
        },
      }),
      failure,
    );
    assert.equal(calls, 1);
    assert.equal(
      healthVerifications,
      0,
      `${failure.name}: ${failure.message} must not consult service health`,
    );
  }
});

test('a concurrent abort cannot replace the exact operation failure or authorize replay', async () => {
  const controller = new AbortController();
  const cancellation = new Error('Learn job cancelled');
  const providerFailure = Object.assign(new Error('connection dropped'), { code: 'ECONNRESET' });
  let calls = 0;

  await assert.rejects(
    () => retryModelTransport(async () => {
      calls += 1;
      controller.abort(cancellation);
      throw providerFailure;
    }, {
      signal: controller.signal,
      replayPolicy: 'verified_preaccept',
      verifyConnectionRecovery: async () => ({ id: 'should-not-run', evidence: 'none' }),
    }),
    (error) => error === providerFailure,
  );
  assert.equal(calls, 1);
});

test('Learn model POSTs remain single-shot even when exact refusal recovery would verify', async () => {
  const events = [];
  const createOptions = [];
  const attempts = [];
  const rejected = [];
  const controller = new AbortController();
  const exactFailure = Object.assign(new Error('connect refused after proxy lifecycle change'), {
    code: 'ECONNREFUSED',
  });
  let calls = 0;
  const client = fakeClient(async (_body, options) => {
    calls += 1;
    createOptions.push(options);
    throw exactFailure;
  });

  let healthVerifications = 0;
  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    retryTransport: {
      signal: controller.signal,
      verifyConnectionRecovery: async () => {
        healthVerifications += 1;
        return { id: 'health-ok', evidence: 'health_200' };
      },
      onAttempt: (attempt) => attempts.push(attempt),
      onRejected: (rejection) => rejected.push(rejection),
    },
  });
  await assert.rejects(
    () => client.chat.completions.create(
      { model: 'gpt-5.6-sol' },
      { timeout: 1234, maxRetries: 99 },
    ),
    (error) => error === exactFailure,
  );

  assert.equal(calls, 1);
  assert.equal(healthVerifications, 0);
  assert.deepEqual(attempts.map(({ attempt, maxAttempts }) => ({ attempt, maxAttempts })), [
    { attempt: 1, maxAttempts: 1 },
  ]);
  assert.deepEqual(rejected, [{
    attempt: 1,
    maxAttempts: 1,
    rejectionCause: 'replay_disabled',
    retryCause: 'connection_failure',
  }]);
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  assert.equal(events[1].usage, null);
  assert.ok(createOptions.every((options) => options.maxRetries === 0));
  assert.ok(createOptions.every((options) => options.timeout === 1234));
  assert.ok(createOptions.every((options) => options.signal === controller.signal));
});

test('the real Learn wrapper performs one outbound create on nested ECONNRESET', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const healthRequests = [];
  globalThis.fetch = async (input) => {
    healthRequests.push(String(input));
    return modelHealthResponse();
  };
  try {
    const resetLeaf = Object.assign(new Error('socket reset after request write'), {
      code: 'ECONNRESET',
    });
    const exactFailure = new Error('Connection error.', { cause: resetLeaf });
    const createCalls = [];
    const usageEvents = [];
    const rejected = [];
    const client = fakeClient(async (body, options) => {
      createCalls.push({ body, options });
      throw exactFailure;
    }, 'http://127.0.0.1:8765/v1');

    attachLearnTokenUsageTracking(client, (event) => usageEvents.push(event), {
      completionRequestOverrides: {
        reasoning: { effort: 'max', summary: 'detailed' },
      },
      retryTransport: {
        onRejected: (event) => rejected.push(event),
      },
    });
    await assert.rejects(
      () => client.chat.completions.create(
        {
          model: 'model-generic',
          reasoning: { effort: 'low', summary: 'none' },
        },
        { maxRetries: 9 },
      ),
      (error) => error === exactFailure,
    );

    assert.equal(createCalls.length, 1);
    assert.equal(healthRequests.length, 0, 'health cannot authorize an ambiguous reset');
    assert.equal(createCalls[0].options.maxRetries, 0);
    assert.deepEqual(createCalls[0].body.reasoning, {
      effort: 'max',
      summary: 'detailed',
    });
    assert.deepEqual(usageEvents, [
      {
        type: 'started',
        requestEvidence: {
          model: 'model-generic',
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
        },
      },
      {
        type: 'completed',
        usage: null,
        requestEvidence: {
          model: 'model-generic',
          reasoningEffort: 'max',
          reasoningSummary: 'detailed',
        },
      },
    ]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].rejectionCause, 'replay_disabled');
    assert.equal(rejected[0].maxAttempts, 1);
    assert.equal(rejected[0].retryCause, 'connection_failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Learn never replays an unqualified 502 or premature response', async () => {
  for (const failure of [errorWithStatus(502), new Error('Response ended prematurely')]) {
    const events = [];
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw failure;
    });
    attachLearnTokenUsageTracking(client, (event) => events.push(event));
    await assert.rejects(
      () => client.chat.completions.create({ model: 'gpt-5.6-sol' }),
      failure,
    );
    assert.equal(calls, 1);
    assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  }
});

test('ChatMock refusal recovery observes a restart until model health becomes ready', async () => {
  const delays = [];
  let probes = 0;
  const receipt = await verifyChatMockRecoveryAfterRefusal(
    fakeClient(async () => undefined, 'http://127.0.0.1:8765/v1'),
    {
      probeDelaysMs: [0, 25],
      sleep: async (delayMs) => delays.push(delayMs),
      fetchImplementation: async () => {
        probes += 1;
        if (probes === 1) {
          throw Object.assign(new Error('listener is restarting'), { code: 'ECONNREFUSED' });
        }
        return modelHealthResponse();
      },
    },
  );

  assert.equal(probes, 2);
  assert.deepEqual(delays, [0, 25]);
  assert.match(receipt.id, /^chatmock-health-/);
  assert.equal(receipt.evidence, 'chatmock_model_health_200_after_preaccept_refusal');
});

test('ChatMock recovery reports bounded probe exhaustion without replay evidence', async () => {
  const result = await verifyChatMockRecoveryAfterRefusal(
    fakeClient(async () => undefined, 'http://127.0.0.1:8765/v1'),
    {
      probeDelaysMs: [0, 1, 2],
      sleep: async () => undefined,
      fetchImplementation: async () => modelHealthResponse({ status: 503 }),
    },
  );

  assert.deepEqual(result, {
    recovered: false,
    probeCount: 3,
    outcome: 'http_error',
    httpStatus: 503,
  });
});

test('ChatMock recovery does not accept a live process without an available account', async () => {
  const result = await verifyChatMockRecoveryAfterRefusal(
    fakeClient(async () => undefined, 'http://127.0.0.1:8765/v1'),
    {
      probeDelaysMs: [0],
      sleep: async () => undefined,
      fetchImplementation: async () => modelHealthResponse({ accounts: [{ available: false }] }),
    },
  );

  assert.deepEqual(result, {
    recovered: false,
    probeCount: 1,
    outcome: 'no_available_account',
    httpStatus: 200,
  });
});

test('ChatMock recovery probe diagnostics distinguish connection, timeout, and invalid body', async () => {
  const cases = [
    {
      outcome: 'connection_error',
      fetchImplementation: async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      },
    },
    {
      outcome: 'timeout',
      fetchImplementation: async () => {
        throw new DOMException('probe timed out', 'TimeoutError');
      },
    },
    {
      outcome: 'invalid_body',
      fetchImplementation: async () => new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    },
  ];

  for (const item of cases) {
    const result = await verifyChatMockRecoveryAfterRefusal(
      fakeClient(async () => undefined, 'http://127.0.0.1:8765/v1'),
      {
        probeDelaysMs: [0],
        sleep: async () => undefined,
        fetchImplementation: item.fetchImplementation,
      },
    );
    assert.equal(result.recovered, false);
    assert.equal(result.probeCount, 1);
    assert.equal(result.outcome, item.outcome);
  }
});

test('cancelling during ChatMock refusal recovery prevents model replay', async () => {
  const controller = new AbortController();
  const cancellation = new Error('Learn job cancelled while ChatMock restarted');
  let probes = 0;
  await assert.rejects(
    () => verifyChatMockRecoveryAfterRefusal(
      fakeClient(async () => undefined, 'http://127.0.0.1:8765/v1'),
      {
        signal: controller.signal,
        probeDelaysMs: [0, 1],
        sleep: async (delayMs) => {
          if (delayMs > 0) controller.abort(cancellation);
        },
        fetchImplementation: async () => {
          probes += 1;
          throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        },
      },
    ),
    cancellation,
  );
  assert.equal(probes, 1);
});

test('nested ECONNREFUSED plus healthy ChatMock still produces one exact Learn failure', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const healthRequests = [];
  globalThis.fetch = async (input, init) => {
    healthRequests.push({ url: String(input), init });
    return modelHealthResponse();
  };
  try {
    const refusal = Object.assign(new Error('listener refused downstream connection'), {
      code: 'ECONNREFUSED',
    });
    const exactFailure = new Error('Connection error.', { cause: refusal });
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      throw exactFailure;
    }, 'http://127.0.0.1:8765/v1');

    attachLearnTokenUsageTracking(client, () => undefined);
    await assert.rejects(
      () => client.chat.completions.create({ model: 'gpt-5.6-sol' }),
      (error) => error === exactFailure,
    );

    assert.equal(calls, 1);
    assert.deepEqual(healthRequests, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  attachLearnTokenUsageTracking(client, (event) => events.push(event), {
    retry502: { signal: controller.signal },
  });
  const request = client.chat.completions.create({ model: 'gpt-5.6-sol' });
  await Promise.resolve();
  controller.abort(new Error('Learn job cancelled'));

  await assert.rejects(request, /Learn job cancelled/);
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(events.map(({ type }) => type), ['started', 'completed']);
  assert.equal(events[1].usage, null);
});

test('Learn source exposes structured terminal transport telemetry', () => {
  const source = fs.readFileSync(new URL('../src/lib/learn.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function attachLearnJobModelTracking');
  const end = source.indexOf('\nfunction updateLearnJob', start);
  assert.ok(start >= 0 && end > start, 'expected the Learn model tracking callback');
  const trackingSource = source.slice(start, end);
  assert.match(trackingSource, /learn_model_transport_failure/);
  assert.match(trackingSource, /rejectionCause/);
  assert.doesNotMatch(trackingSource, /learn_model_transport_retry|recoveryReceiptId/);
});
