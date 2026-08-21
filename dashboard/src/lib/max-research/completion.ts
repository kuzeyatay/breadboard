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

/**
 * Transient upstream failures, which are worth another try.
 *
 * A live run lost several minutes of finished research to a single 502 at the
 * reconciliation step. Every agent had succeeded; only the last model call had
 * not, and nothing retried it.
 */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

export async function completeText(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  prompt: string;
}): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS);
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
        if (!RETRYABLE.has(response.status) || attempt === ATTEMPTS) throw error;
        lastError = error;
      } else {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        if (content.trim()) return content;
        const error = new Error("The reconciliation model returned no text.");
        if (attempt === ATTEMPTS) throw error;
        lastError = error;
      }
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("The reconciliation failed.");
      if (attempt === ATTEMPTS) throw failure;
      lastError = failure;
    } finally {
      clearTimeout(timer);
    }
    // Linear rather than exponential: three attempts over about half a minute,
    // which is the shape of a brief upstream wobble. A long backoff here would
    // only be a slower way to lose the run.
    await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
  }

  throw lastError ?? new Error("The reconciliation failed.");
}
