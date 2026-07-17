import type OpenAI from 'openai';
import {
  chatTokenUsageFromResponse,
  type ChatTokenUsage,
} from './chat-token-usage.ts';
import {
  retryHttp502,
  type Http502RetryOptions,
} from './http-502-retry.ts';

export interface LearnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimated: boolean;
  startedCalls: number;
  completedCalls: number;
  reportedCalls: number;
  unreportedCalls: number;
  inFlightCalls: number;
}

export function emptyLearnTokenUsage(): LearnTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    estimated: false,
    startedCalls: 0,
    completedCalls: 0,
    reportedCalls: 0,
    unreportedCalls: 0,
    inFlightCalls: 0,
  };
}

/** Add job-scoped counters without losing whether any contributing response
 * was estimated or unavailable. Used to present one Learn workflow total when
 * planning and generation are persisted as separate jobs. */
export function sumLearnTokenUsage(
  usages: Iterable<LearnTokenUsage | null | undefined>,
): LearnTokenUsage {
  const total = emptyLearnTokenUsage();
  for (const usage of usages) {
    if (!usage) continue;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.totalTokens += usage.totalTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.estimated ||= usage.estimated;
    total.startedCalls += usage.startedCalls;
    total.completedCalls += usage.completedCalls;
    total.reportedCalls += usage.reportedCalls;
    total.unreportedCalls += usage.unreportedCalls;
    total.inFlightCalls += usage.inFlightCalls;
  }
  return total;
}

export type LearnTokenUsageEvent =
  | { type: 'started' }
  | { type: 'completed'; usage: ChatTokenUsage | null };

export type LearnTokenUsageListener = (event: LearnTokenUsageEvent) => void;

type CompletionCreate = (...args: unknown[]) => Promise<unknown>;

interface TrackingState {
  listener: LearnTokenUsageListener;
  retry502: Http502RetryOptions;
}

export interface LearnTokenUsageTrackingOptions {
  retry502?: Http502RetryOptions;
}

function requestSignal(args: unknown[]): AbortSignal | null | undefined {
  const options = args[1];
  if (!options || typeof options !== 'object') return undefined;
  const signal = (options as { signal?: unknown }).signal;
  return typeof AbortSignal !== 'undefined' && signal instanceof AbortSignal
    ? signal
    : undefined;
}

function combineRequestSignals(
  request: AbortSignal | null | undefined,
  job: AbortSignal | null | undefined,
): AbortSignal | undefined {
  const signals = [request, job].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/** The explicit six-attempt 502 ladder owns retries for Learn calls. Disable
 * the SDK's default two retries so one logical call cannot become 18 HTTP
 * attempts. Existing timeout and signal options remain intact. */
function withSdkRetriesDisabled(
  args: unknown[],
  signal?: AbortSignal,
): unknown[] {
  const next = [...args];
  const currentOptions = next[1];
  next[1] = {
    ...(currentOptions && typeof currentOptions === 'object' ? currentOptions : {}),
    maxRetries: 0,
    ...(signal ? { signal } : {}),
  };
  return next;
}

const trackingByCompletionResource = new WeakMap<object, TrackingState>();

function notifyListener(
  listener: LearnTokenUsageListener,
  event: LearnTokenUsageEvent,
): void {
  try {
    listener(event);
  } catch {
    // Usage telemetry must never turn a successful model response into a
    // failed Learn step.
  }
}

/**
 * Instrument the request-scoped ChatMock client used by Learn. Every current
 * Learn model path ultimately calls chat.completions.create, including source
 * visual extraction, council writing, critics, and model-backed repairs.
 * Re-attaching the same client moves the listener to the new job instead of
 * stacking wrappers and double-counting calls.
 */
export function attachLearnTokenUsageTracking(
  client: OpenAI,
  listener: LearnTokenUsageListener,
  options: LearnTokenUsageTrackingOptions = {},
): OpenAI {
  const resource = client.chat.completions as unknown as object;
  const existing = trackingByCompletionResource.get(resource);
  if (existing) {
    existing.listener = listener;
    existing.retry502 = options.retry502 ?? {};
    return client;
  }

  const mutableResource = resource as { create: CompletionCreate };
  const originalCreate = mutableResource.create.bind(resource);
  const state: TrackingState = { listener, retry502: options.retry502 ?? {} };
  trackingByCompletionResource.set(resource, state);

  mutableResource.create = async (...args: unknown[]) => {
    // Pin both events to the job that owned the client when this request
    // began. A later reattachment must not split one request across jobs.
    const requestListener = state.listener;
    const requestRetryOptions = state.retry502;
    const signal = combineRequestSignals(
      requestSignal(args),
      requestRetryOptions.signal,
    );
    const requestArgs = withSdkRetriesDisabled(args, signal);
    notifyListener(requestListener, { type: 'started' });
    try {
      const response = await retryHttp502(
        () => originalCreate(...requestArgs),
        {
          ...requestRetryOptions,
          signal,
        },
      );
      notifyListener(requestListener, {
        type: 'completed',
        usage: chatTokenUsageFromResponse(response),
      });
      return response;
    } catch (error) {
      notifyListener(requestListener, { type: 'completed', usage: null });
      throw error;
    }
  };

  return client;
}
