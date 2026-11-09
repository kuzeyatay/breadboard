import { renderSystemPrompt } from "../system-prompts/service.ts";
import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { safeProductUrl } from "../generative-ui/contracts.ts";
import type { SearchCandidate } from "./service.ts";

/** A fallback locator only. Model output never supplies prices or product facts. */
export async function discoverProductPages(query: string, market: string, options: {
  userId?: number | null;
  signal?: AbortSignal; baseUrl?: string; fetcher?: typeof fetch;
} = {}): Promise<SearchCandidate[]> {
  const response = await (options.fetcher ?? fetch)(`${(options.baseUrl ?? localChatmockBaseUrl()).replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chatmockApiKeyValue()}` },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000),
    body: JSON.stringify({ model: GLOBAL_MODEL_SENTINEL, stream: false, reasoning_effort: "low", max_completion_tokens: 2_000,
      responses_tools: [{ type: "web_search" }], responses_tool_choice: "auto",
      messages: [
        { role: "system", content: renderSystemPrompt("product-discovery", options.userId, {  }) },
        { role: "user", content: JSON.stringify({ query, market }) },
      ],
    }),
  });
  if (!response.ok) throw new Error("Product page discovery unavailable.");
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 16_000) return [];
  const result = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  if (!Array.isArray(result?.candidates)) return [];
  return result.candidates.slice(0, 8).flatMap((value: unknown): SearchCandidate[] => {
    if (!value || typeof value !== "object") return [];
    const { title, url } = value as { title?: unknown; url?: unknown };
    const pageUrl = safeProductUrl(url);
    if (!pageUrl || typeof title !== "string" || !title.trim()) return [];
    return [{ pageUrl, title: title.trim().slice(0, 300), requireStructuredEvidence: true }];
  });
}
