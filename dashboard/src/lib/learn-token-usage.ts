import type OpenAI from 'openai';
import {
  chatTokenUsageFromResponse,
  type ChatTokenUsage,
} from './chat-token-usage.ts';
import {
  retryModelTransport,
  type ModelTransportRecoveryVerification,
  type ModelTransportRetryOptions,
} from './http-502-retry.ts';

export const CHATMOCK_REFUSAL_RECOVERY_PROBE_DELAYS_MS = [
  0,
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
] as const;
export const CHATMOCK_REFUSAL_RECOVERY_PROBE_TIMEOUT_MS = 2_000;

type RefusalRecoveryProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ChatMockRefusalRecoveryProbeOptions {
  signal?: AbortSignal | null;
  fetchImplementation?: RefusalRecoveryProbeFetch;
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  probeDelaysMs?: readonly number[];
  probeTimeoutMs?: number;
}

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
  /** Durable, allowlisted evidence for the effective request policy observed
   * across this job or workflow. Absent for policy-free/non-Learn callers and
   * legacy jobs that predate policy receipts. */
  requestPolicy?: LearnModelRequestPolicyReceipt;
}

export interface LearnModelRequestPolicyReceipt {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly reasoningSummary: string | null;
  readonly observedCalls: number;
  /** True only when all three fields were present and every observed request
   * matched the first request's effective policy. */
  readonly consistent: boolean;
}

/** A diagnostic fingerprint, not a security boundary. Keep this module safe
 * for the browser bundle because its token-usage helpers are shared by client
 * code even though model-health verification itself runs server-side. */
function modelHealthStateFingerprint(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return [left, right]
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
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
  const requestPolicies: LearnModelRequestPolicyReceipt[] = [];
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
    if (usage.requestPolicy && usage.requestPolicy.observedCalls > 0) {
      requestPolicies.push(usage.requestPolicy);
    }
  }
  const baseline = requestPolicies[0];
  if (baseline) {
    const samePolicy = (receipt: LearnModelRequestPolicyReceipt) =>
      receipt.model === baseline.model &&
      receipt.reasoningEffort === baseline.reasoningEffort &&
      receipt.reasoningSummary === baseline.reasoningSummary;
    total.requestPolicy = {
      model: baseline.model,
      reasoningEffort: baseline.reasoningEffort,
      reasoningSummary: baseline.reasoningSummary,
      observedCalls: requestPolicies.reduce(
        (sum, receipt) => sum + receipt.observedCalls,
        0,
      ),
      consistent: requestPolicies.every(
        (receipt) => receipt.consistent && samePolicy(receipt),
      ),
    };
  }
  return total;
}

/**
 * Bounded, non-secret evidence copied from the effective completion body.
 * Deliberately keep this allowlist narrower than the provider request: model
 * prompts, messages, headers, credentials, and arbitrary reasoning fields
 * must never enter usage telemetry.
 */
export interface LearnModelRequestEvidence {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly reasoningSummary: string | null;
}

export type LearnTokenUsageEvent =
  | { type: 'started'; requestEvidence?: LearnModelRequestEvidence }
  | {
      type: 'completed';
      usage: ChatTokenUsage | null;
      requestEvidence?: LearnModelRequestEvidence;
    };

export type LearnTokenUsageListener = (event: LearnTokenUsageEvent) => void;

type CompletionCreate = (...args: unknown[]) => Promise<unknown>;

interface TrackingState {
  listener: LearnTokenUsageListener;
  retryTransport: ModelTransportRetryOptions;
  completionRequestOverrides?: Readonly<Record<string, unknown>>;
}

export interface LearnTokenUsageTrackingOptions {
  retryTransport?: ModelTransportRetryOptions;
  /** @deprecated Retained for existing Learn callers. */
  retry502?: ModelTransportRetryOptions;
  /**
   * Request-scoped policy fields applied after the caller's completion body.
   * The policy is snapshotted on attachment and copied into a fresh request
   * body, so neither the caller's object nor a later policy mutation can alter
   * an in-flight request. Learn model POSTs are always single-shot.
   */
  completionRequestOverrides?: Readonly<Record<string, unknown>>;
}

function transportRetryOptions(
  options: LearnTokenUsageTrackingOptions,
): ModelTransportRetryOptions {
  return options.retryTransport ?? options.retry502 ?? {};
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

async function waitForRefusalRecoveryProbe(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal!));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function refusalRecoveryProbeSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Observe ChatMock readiness for diagnostics after a refusal. This result is
 * never wired to Learn's model POST boundary and cannot authorize replay. */
export async function verifyChatMockRecoveryAfterRefusal(
  client: OpenAI,
  options: ChatMockRefusalRecoveryProbeOptions = {},
): Promise<ModelTransportRecoveryVerification> {
  const baseURL = (client as unknown as { baseURL?: unknown }).baseURL;
  if (typeof baseURL !== 'string' || !baseURL.trim()) {
    return { recovered: false, probeCount: 0, outcome: 'missing_base_url' };
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? waitForRefusalRecoveryProbe;
  const delays = options.probeDelaysMs ?? CHATMOCK_REFUSAL_RECOVERY_PROBE_DELAYS_MS;
  const probeTimeoutMs = options.probeTimeoutMs ??
    CHATMOCK_REFUSAL_RECOVERY_PROBE_TIMEOUT_MS;
  const healthUrl = new URL(`${baseURL.replace(/\/+$/, '')}/settings/model-health`);
  let probeCount = 0;
  let outcome = 'observation_exhausted';
  let httpStatus: number | undefined;

  for (const delayMs of delays) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    await sleep(delayMs, options.signal);
    if (options.signal?.aborted) throw abortReason(options.signal);
    probeCount += 1;
    httpStatus = undefined;
    try {
      const response = await fetchImplementation(healthUrl, {
        cache: 'no-store',
        signal: refusalRecoveryProbeSignal(options.signal, probeTimeoutMs),
      });
      httpStatus = response.status;
      if (!response.ok) {
        outcome = 'http_error';
        continue;
      }
      let body: {
        preferredModel?: unknown;
        servingModel?: unknown;
        accounts?: unknown;
        failover?: unknown;
      };
      try {
        body = await response.json() as typeof body;
      } catch {
        outcome = 'invalid_body';
        continue;
      }
      const availableAccounts = Array.isArray(body.accounts)
        ? body.accounts.filter((account) => (
            account &&
            typeof account === 'object' &&
            (account as { available?: unknown }).available === true
          )).length
        : 0;
      if (availableAccounts < 1) {
        outcome = 'no_available_account';
        continue;
      }
      if (typeof body.servingModel !== 'string' || !body.servingModel.trim()) {
        outcome = 'no_serving_model';
        continue;
      }
      const state = JSON.stringify({
        preferredModel: typeof body.preferredModel === 'string' ? body.preferredModel : null,
        servingModel: body.servingModel,
        availableAccounts,
        failoverActive: Boolean(body.failover),
      });
      return {
        id: `chatmock-health-${modelHealthStateFingerprint(state)}`,
        evidence: 'chatmock_model_health_200_after_preaccept_refusal',
      };
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      outcome = error instanceof DOMException && error.name === 'TimeoutError'
        ? 'timeout'
        : 'connection_error';
    }
  }

  return {
    recovered: false,
    probeCount,
    outcome,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

function resolvedTransportRetryOptions(
  options: LearnTokenUsageTrackingOptions,
): ModelTransportRetryOptions {
  const configured = transportRetryOptions(options);
  return {
    ...configured,
    // A refusal observed at this downstream boundary can follow an upstream
    // acceptance during proxy restart. Health is therefore diagnostic only;
    // it can never authorize a second model POST.
    replayPolicy: 'never',
  };
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

/** Learn owns one model request. Disable the SDK's hidden default retries so a
 * logical call is exactly one outbound create. Existing timeout/signal options
 * remain unchanged. */
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRequestPolicyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRequestPolicyValue);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneRequestPolicyValue(entry)]),
  );
}

function snapshotCompletionRequestOverrides(
  options: LearnTokenUsageTrackingOptions,
): Readonly<Record<string, unknown>> | undefined {
  const overrides = options.completionRequestOverrides;
  if (!isPlainRecord(overrides)) return undefined;
  return cloneRequestPolicyValue(overrides) as Record<string, unknown>;
}

/** Apply the job's request policy without mutating either input object. The
 * returned argument array is captured once by the transport boundary, so a
 * single outbound request uses one immutable effective completion body. */
function withCompletionRequestOverrides(
  args: unknown[],
  overrides?: Readonly<Record<string, unknown>>,
): unknown[] {
  if (!overrides) return args;
  const next = [...args];
  const request = isPlainRecord(next[0]) ? next[0] : {};
  next[0] = {
    ...request,
    ...(cloneRequestPolicyValue(overrides) as Record<string, unknown>),
  };
  return next;
}

const MODEL_EVIDENCE_MAX_LENGTH = 128;
const REASONING_EVIDENCE_MAX_LENGTH = 32;

function boundedEvidenceString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

/** Snapshot only the effective routing policy fields after the authoritative
 * request overlay has been applied. Evidence is emitted only for callers that
 * supplied a request policy, leaving shared non-Learn tracking unchanged. */
function modelRequestEvidence(
  args: unknown[],
  hasRequestPolicy: boolean,
): LearnModelRequestEvidence | undefined {
  if (!hasRequestPolicy) return undefined;
  const request = isPlainRecord(args[0]) ? args[0] : {};
  const reasoning = isPlainRecord(request.reasoning) ? request.reasoning : {};
  return Object.freeze({
    model: boundedEvidenceString(request.model, MODEL_EVIDENCE_MAX_LENGTH),
    reasoningEffort: boundedEvidenceString(
      reasoning.effort,
      REASONING_EVIDENCE_MAX_LENGTH,
    ),
    reasoningSummary: boundedEvidenceString(
      reasoning.summary,
      REASONING_EVIDENCE_MAX_LENGTH,
    ),
  });
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
    existing.retryTransport = resolvedTransportRetryOptions(options);
    existing.completionRequestOverrides = snapshotCompletionRequestOverrides(options);
    return client;
  }

  const mutableResource = resource as { create: CompletionCreate };
  const originalCreate = mutableResource.create.bind(resource);
  const state: TrackingState = {
    listener,
    retryTransport: resolvedTransportRetryOptions(options),
    completionRequestOverrides: snapshotCompletionRequestOverrides(options),
  };
  trackingByCompletionResource.set(resource, state);

  mutableResource.create = async (...args: unknown[]) => {
    // Pin both events to the job that owned the client when this request
    // began. A later reattachment must not split one request across jobs.
    const requestListener = state.listener;
    const requestRetryOptions = state.retryTransport;
    const requestOverrides = state.completionRequestOverrides;
    const signal = combineRequestSignals(
      requestSignal(args),
      requestRetryOptions.signal,
    );
    const requestArgs = withSdkRetriesDisabled(
      withCompletionRequestOverrides(args, requestOverrides),
      signal,
    );
    const requestEvidence = modelRequestEvidence(
      requestArgs,
      requestOverrides !== undefined,
    );
    notifyListener(requestListener, {
      type: 'started',
      ...(requestEvidence ? { requestEvidence } : {}),
    });
    try {
      const response = await retryModelTransport(
        () => originalCreate(...requestArgs),
        {
          ...requestRetryOptions,
          signal,
        },
      );
      notifyListener(requestListener, {
        type: 'completed',
        usage: chatTokenUsageFromResponse(response),
        ...(requestEvidence ? { requestEvidence } : {}),
      });
      return response;
    } catch (error) {
      notifyListener(requestListener, {
        type: 'completed',
        usage: null,
        ...(requestEvidence ? { requestEvidence } : {}),
      });
      throw error;
    }
  };

  return client;
}
