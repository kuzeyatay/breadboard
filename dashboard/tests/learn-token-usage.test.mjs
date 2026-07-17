import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  attachLearnTokenUsageTracking,
  sumLearnTokenUsage,
} from '../src/lib/learn-token-usage.ts';

function fakeClient(create) {
  return { chat: { completions: { create } } };
}

test('Learn client tracking reports start and normalized provider usage', async () => {
  const events = [];
  const client = fakeClient(async () => ({
    usageEstimated: true,
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  }));

  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  await client.chat.completions.create({ model: 'gpt-5.6-sol' });

  assert.deepEqual(events, [
    { type: 'started' },
    {
      type: 'completed',
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 80,
        reasoningTokens: 12,
        estimated: true,
      },
    },
  ]);
});

test('Learn workflow usage accumulates planning and generation jobs', () => {
  const usage = sumLearnTokenUsage([
    {
      inputTokens: 153_131,
      outputTokens: 30_046,
      totalTokens: 183_177,
      cachedInputTokens: 120_000,
      reasoningTokens: 10_000,
      estimated: false,
      startedCalls: 20,
      completedCalls: 20,
      reportedCalls: 20,
      unreportedCalls: 0,
      inFlightCalls: 0,
    },
    {
      inputTokens: 94_901,
      outputTokens: 14_976,
      totalTokens: 109_877,
      cachedInputTokens: 80_000,
      reasoningTokens: 5_000,
      estimated: true,
      startedCalls: 10,
      completedCalls: 9,
      reportedCalls: 9,
      unreportedCalls: 0,
      inFlightCalls: 1,
    },
  ]);

  assert.equal(usage.totalTokens, 293_054);
  assert.equal(usage.inputTokens, 248_032);
  assert.equal(usage.outputTokens, 45_022);
  assert.equal(usage.startedCalls, 30);
  assert.equal(usage.reportedCalls, 29);
  assert.equal(usage.inFlightCalls, 1);
  assert.equal(usage.estimated, true);
});

test('Learn client tracking marks missing and failed usage as unreported', async () => {
  const missingEvents = [];
  const missingClient = fakeClient(async () => ({ choices: [] }));
  attachLearnTokenUsageTracking(missingClient, (event) => missingEvents.push(event));
  await missingClient.chat.completions.create({});
  assert.deepEqual(missingEvents, [
    { type: 'started' },
    { type: 'completed', usage: null },
  ]);

  const failedEvents = [];
  const failedClient = fakeClient(async () => {
    throw new Error('upstream failed');
  });
  attachLearnTokenUsageTracking(failedClient, (event) => failedEvents.push(event));
  await assert.rejects(() => failedClient.chat.completions.create({}), /upstream failed/);
  assert.deepEqual(failedEvents, [
    { type: 'started' },
    { type: 'completed', usage: null },
  ]);
});

test('reattaching one Learn client changes jobs without stacking counters', async () => {
  const firstJobEvents = [];
  const secondJobEvents = [];
  const client = fakeClient(async () => ({
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  }));

  attachLearnTokenUsageTracking(client, (event) => firstJobEvents.push(event));
  attachLearnTokenUsageTracking(client, (event) => secondJobEvents.push(event));
  await client.chat.completions.create({});

  assert.deepEqual(firstJobEvents, []);
  assert.equal(secondJobEvents.length, 2);
});

test('an in-flight Learn call stays attributed to the job where it started', async () => {
  const firstJobEvents = [];
  const secondJobEvents = [];
  let resolveRequest;
  const client = fakeClient(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );

  attachLearnTokenUsageTracking(client, (event) => firstJobEvents.push(event));
  const request = client.chat.completions.create({});
  attachLearnTokenUsageTracking(client, (event) => secondJobEvents.push(event));
  resolveRequest({ usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } });
  await request;

  assert.deepEqual(firstJobEvents.map((event) => event.type), ['started', 'completed']);
  assert.deepEqual(secondJobEvents, []);
});

test('concurrent Learn calls report every in-flight and completed request', async () => {
  const events = [];
  const resolvers = [];
  const client = fakeClient(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );

  attachLearnTokenUsageTracking(client, (event) => events.push(event));
  const first = client.chat.completions.create({});
  const second = client.chat.completions.create({});

  assert.equal(events.filter((event) => event.type === 'started').length, 2);
  assert.equal(events.filter((event) => event.type === 'completed').length, 0);

  for (const resolve of resolvers) {
    resolve({ usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } });
  }
  await Promise.all([first, second]);

  assert.equal(events.filter((event) => event.type === 'completed').length, 2);
});

test('Learn persistence uses a job-scoped atomic usage table', () => {
  const source = fs.readFileSync(new URL('../src/lib/learn.ts', import.meta.url), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS learn_job_token_usage/);
  assert.match(source, /started_requests = started_requests \+ 1/);
  assert.match(source, /completed_requests = completed_requests \+ 1/);
  assert.match(source, /input_tokens = input_tokens \+ \?/);
  assert.match(source, /tokenUsage: learnTokenUsageForJob\(row\.id\)/);
  assert.match(source, /function learnTokenUsageForWorkflow/);
  assert.match(source, /SELECT garden_id, job_id FROM learn_maps WHERE id = \?/);
  assert.match(source, /tokenUsage: learnTokenUsageForWorkflow\(visibleJob\)/);
  assert.doesNotMatch(
    source.match(/function recordLearnTokenUsageEvent[\s\S]*?\n\}/)?.[0] ?? '',
    /learn_jobs[\s\S]*updated_at/,
  );
});

test('Learn panel renders live job usage without Council activity', () => {
  const source = fs.readFileSync(
    new URL('../src/app/gardens/[clusterSlug]/workspace-client.tsx', import.meta.url),
    'utf8',
  );
  const usagePanelIndex = source.indexOf('aria-label="Learn token usage"');
  const councilActivityIndex = source.indexOf('Council activity');
  const nextPanelSectionIndex = source.indexOf(
    '{panelExpanded &&',
    usagePanelIndex,
  );
  const usagePanelSource = source.slice(usagePanelIndex, nextPanelSectionIndex);

  assert.ok(usagePanelIndex >= 0, 'Learn token usage panel should be rendered');
  assert.equal(councilActivityIndex, -1, 'Council activity should not be rendered');
  assert.ok(nextPanelSectionIndex > usagePanelIndex, 'usage panel should remain in the Learn panel');
  assert.match(source, /label: "Input"/);
  assert.match(source, /label: "Output"/);
  assert.match(source, /label: "Reasoning"/);
  assert.match(source, /label: "Total"/);
  assert.match(source, /learnTokenUsage\.inFlightCalls/);
  assert.match(source, /learnTokenUsage\.unreportedCalls/);
  assert.match(source, /Waiting for usage/);
  assert.match(
    usagePanelSource,
    /metric\.label === "Total"[\s\S]*?formatLearnTotalTokenCount\(metric\.value\)/,
  );
  assert.match(
    source,
    /function formatLearnTotalTokenCount[\s\S]*?count >= 1_000_000[\s\S]*?formatTokenCount\(count\)[\s\S]*?toFixed\(1\)[\s\S]*?k/,
  );
  assert.match(
    usagePanelSource,
    /formatLearnMetricTokenCount\(metric\.value\)/,
  );
  assert.match(
    source,
    /function formatLearnMetricTokenCount[\s\S]*?replace\(\/K\$\/, "k"\)/,
  );
  assert.doesNotMatch(usagePanelSource, /\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /Cached input unavailable/);
  assert.doesNotMatch(source, /Generated across Learn/);
  assert.doesNotMatch(source, /Provider-reported total/);
  assert.doesNotMatch(source, /const statusLabel =/);
  assert.doesNotMatch(source, /const learnUsageBadge =/);
  assert.doesNotMatch(usagePanelSource, /role="status"/);
});
