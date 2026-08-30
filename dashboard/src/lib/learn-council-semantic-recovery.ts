export interface LearnCouncilTerminalReceiptProof {
  requestId: string;
  requestHash: string;
  dispatchGeneration: number;
  dispatchCount: number;
  redispatchCount: number;
  redispatchAllowed: boolean;
  failureCode: string;
  proofKind?: "terminal_receipt" | "expired_started_receipt";
  startedAt?: string;
  observedAt?: string;
  maxStartedAgeMs?: number;
}

export interface LearnCouncilStartedReceiptObservation {
  requestId: string;
  requestHash: string;
  dispatchGeneration: number;
  dispatchCount: number;
  redispatchCount: number;
  redispatchAllowed: boolean;
  attemptCount: number;
  checkpointDispatchCount: number;
  checkpointRedispatchCount: number;
  startedAt: string;
  observedAt: string;
  maxStartedAgeMs: number;
}

/**
 * Turn a still-started receipt into retry authority only after the maximum
 * lifetime of its exact provider generation has elapsed. A live generation
 * cannot cross this boundary: ChatMock's total upstream deadline is finite,
 * and the attempt prefix must prove that no later generation completed.
 */
export function expiredStartedLearnCouncilReceiptProof(
  input: LearnCouncilStartedReceiptObservation,
): LearnCouncilTerminalReceiptProof | null {
  const startedAtMs = Date.parse(input.startedAt);
  const observedAtMs = Date.parse(input.observedAt);
  if (
    !input.requestId ||
    !/^[a-f0-9]{64}$/u.test(input.requestHash) ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < startedAtMs ||
    !Number.isSafeInteger(input.maxStartedAgeMs) ||
    input.maxStartedAgeMs < 1 ||
    observedAtMs - startedAtMs < input.maxStartedAgeMs ||
    input.dispatchGeneration !== input.dispatchCount ||
    input.dispatchCount !== input.checkpointDispatchCount ||
    input.redispatchCount !== input.checkpointRedispatchCount ||
    input.redispatchCount !== input.dispatchCount - 1 ||
    input.redispatchAllowed !== false ||
    input.attemptCount !== input.dispatchCount - 1
  ) {
    return null;
  }
  return {
    requestId: input.requestId,
    requestHash: input.requestHash,
    dispatchGeneration: input.dispatchGeneration,
    dispatchCount: input.dispatchCount,
    redispatchCount: input.redispatchCount,
    redispatchAllowed: false,
    failureCode: "council_started_receipt_expired",
    proofKind: "expired_started_receipt",
    startedAt: input.startedAt,
    observedAt: input.observedAt,
    maxStartedAgeMs: input.maxStartedAgeMs,
  };
}

/**
 * An authoritative Council receipt proved that every dispatch for one exact
 * request finished without a usable final answer. This is deliberately
 * distinct from an HTTP/SDK error: callers may start a new bounded semantic
 * attempt only after receiving this durable proof.
 */
export class LearnCouncilTerminalReceiptError extends Error {
  readonly receipt: LearnCouncilTerminalReceiptProof;

  constructor(receipt: LearnCouncilTerminalReceiptProof) {
    super(
      `Council request ${receipt.requestId} ended without a final answer ` +
        `(failureCode=${receipt.failureCode}, dispatchCount=${receipt.dispatchCount}).`,
    );
    this.name = "LearnCouncilTerminalReceiptError";
    this.receipt = { ...receipt };
  }
}

/** A strict receipt remained started after its provider generation's finite
 * maximum lifetime. The exact attempt prefix proves the old process can no
 * longer publish a result, so a new semantic identity is safe. */
export class LearnCouncilExpiredStartedReceiptError extends Error {
  readonly receipt: LearnCouncilTerminalReceiptProof;

  constructor(receipt: LearnCouncilTerminalReceiptProof) {
    super(
      `Council request ${receipt.requestId} remained started beyond its ` +
        `maximum provider lifetime (${receipt.maxStartedAgeMs ?? 0}ms).`,
    );
    this.name = "LearnCouncilExpiredStartedReceiptError";
    this.receipt = { ...receipt };
  }
}

export interface LearnCouncilSemanticAttemptContext {
  semanticAttempt: number;
  priorTerminalReceipt?: LearnCouncilTerminalReceiptProof;
}

/**
 * Advance to a new semantic request only after the previous exact request has
 * an authoritative terminal receipt. Ambiguous transport failures, protocol
 * failures, cancellation, and arbitrary provider errors retain exact identity
 * and leave after one call.
 */
export async function runBoundedLearnCouncilSemanticAttempts<T>(input: {
  maxAttempts: number;
  request: (context: LearnCouncilSemanticAttemptContext) => Promise<T>;
  onTerminalReceipt?: (input: {
    semanticAttempt: number;
    nextSemanticAttempt: number;
    receipt: LearnCouncilTerminalReceiptProof;
  }) => void | Promise<void>;
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(3, Math.trunc(input.maxAttempts)));
  let priorTerminalReceipt: LearnCouncilTerminalReceiptProof | undefined;

  for (let semanticAttempt = 0; semanticAttempt < maxAttempts; semanticAttempt += 1) {
    try {
      return await input.request({ semanticAttempt, priorTerminalReceipt });
    } catch (error) {
      if (
        !(
          error instanceof LearnCouncilTerminalReceiptError ||
          error instanceof LearnCouncilExpiredStartedReceiptError
        ) ||
        semanticAttempt + 1 >= maxAttempts
      ) {
        throw error;
      }
      priorTerminalReceipt = error.receipt;
      try {
        await input.onTerminalReceipt?.({
          semanticAttempt,
          nextSemanticAttempt: semanticAttempt + 1,
          receipt: error.receipt,
        });
      } catch {
        // Diagnostics are subordinate to the exact terminal receipt proof.
      }
    }
  }

  throw new Error("Learn Council semantic attempt schedule did not run");
}
