// The one model call Max Research makes itself.
//
// Everything else it does is commissioned: five agents each run their own
// models, and this is only the reconciliation at the end. Kept in its own
// module so the orchestrator can be tested without a completion, and so the
// timeout is stated where a reader of the run manager will look for it.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";

/**
 * Generous, because of what it is writing.
 *
 * The synthesis reads five findings — up to forty thousand characters each —
 * and reconciles their disagreements. Timing that out at the usual thirty
 * seconds would throw away an hour of research at the last step.
 */
const SYNTHESIS_TIMEOUT_MS = 10 * 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CONTENT_BYTES = 512 * 1024;

/**
 * Transient upstream failures, which are worth another try.
 *
 * A live run lost several minutes of finished research to a single 502 at the
 * reconciliation step. Every agent had succeeded; only the last model call had
 * not, and nothing retried it.
 */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

class PermanentCompletionError extends Error {}

export async function completeText(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const forwardAbort = () =>
      controller.abort(input.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (input.signal?.aborted) forwardAbort();
    else input.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("The reconciliation timed out.", "TimeoutError")),
      SYNTHESIS_TIMEOUT_MS,
    );
    try {
      const response = await fetch(
        `${input.baseUrl.replace(/[/]$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${chatmockApiKeyValue()}`,
          },
          body: JSON.stringify({
            model: input.model,
            messages: [{ role: "user", content: input.prompt }],
            reasoning_effort: input.reasoningEffort,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const error = new Error(
          `The reconciliation model returned ${response.status}.`,
        );
        if (!RETRYABLE.has(response.status)) {
          throw new PermanentCompletionError(error.message);
        }
        if (attempt === ATTEMPTS) throw error;
        lastError = error;
      } else {
        const data = (await readBoundedJson(response)) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
          throw new PermanentCompletionError(
            "The reconciliation model returned too much text.",
          );
        }
        if (content.trim()) return content;
        const error = new Error("The reconciliation model returned no text.");
        if (attempt === ATTEMPTS) throw error;
        lastError = error;
      }
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("The reconciliation failed.");
      if (input.signal?.aborted) throw failure;
      if (failure instanceof PermanentCompletionError) throw failure;
      if (attempt === ATTEMPTS) throw failure;
      lastError = failure;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
    // Linear rather than exponential: three attempts over about half a minute,
    // which is the shape of a brief upstream wobble. A long backoff here would
    // only be a slower way to lose the run.
    await abortableDelay(attempt * 10_000, input.signal);
  }

  throw lastError ?? new Error("The reconciliation failed.");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new PermanentCompletionError(
      "The reconciliation model response exceeded its bound.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new PermanentCompletionError(
      "The reconciliation model returned no response body.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PermanentCompletionError(
        "The reconciliation model response exceeded its bound.",
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"));
  } catch {
    throw new PermanentCompletionError(
      "The reconciliation model returned invalid JSON.",
    );
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
