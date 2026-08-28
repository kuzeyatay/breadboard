export interface LearnCouncilTerminalReceiptProof {
  requestId: string;
  requestHash: string;
  dispatchGeneration: number;
  dispatchCount: number;
  redispatchCount: number;
  redispatchAllowed: boolean;
  failureCode: string;
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
        !(error instanceof LearnCouncilTerminalReceiptError) ||
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
