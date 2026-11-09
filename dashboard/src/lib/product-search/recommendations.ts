import { systemPromptText } from "../system-prompts/service.ts";
import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import type { ProductSearchItem } from "../generative-ui/contracts.ts";

import { PROMPT_PRODUCT_REVIEW as PRODUCT_REVIEW_INSTRUCTION } from "../system-prompts/feature-defaults.ts";
export { PRODUCT_REVIEW_INSTRUCTION };

/** Only the name and ordering may change; all commercial facts remain sourced. */
export function parseReviewedProducts(content: unknown, candidates: readonly ProductSearchItem[]): ProductSearchItem[] {
  if (typeof content !== "string" || content.length > 32_000) throw new Error("Invalid product review.");
  const data = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  if (!data || !Array.isArray(data.products) || data.products.length > candidates.length) throw new Error("Invalid product review.");
  const byId = new Map(candidates.map((product) => [product.id, product]));
  const used = new Set<string>();
  return data.products.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid product review.");
    const { id, title, evidence } = entry as { id?: unknown; title?: unknown; evidence?: unknown };
    const product = typeof id === "string" ? byId.get(id) : undefined;
    if (!product || used.has(product.id) || typeof title !== "string" || !title.trim() || title.length > 300 || /[<>\r\n]/.test(title)) {
      throw new Error("Invalid product review.");
    }
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const facts = [product.title, product.description ?? "", ...(product.attributes ?? []).map((attribute) => attribute.value)];
    if (typeof evidence !== "string" || !normalize(evidence) || evidence.length > 240 ||
        !facts.some((fact) => normalize(fact).includes(normalize(evidence)))) {
      throw new Error("Product review evidence is not present in the source.");
    }
    used.add(product.id);
    return { ...product, title: title.trim() };
  });
}

/** A bounded, tool-free relevance and English naming pass, before UI projection. */
export async function reviewProductRecommendations(
  query: string,
  products: readonly ProductSearchItem[],
  options: { userId?: number | null; signal?: AbortSignal; baseUrl?: string; fetcher?: typeof fetch; userRequest?: string } = {},
): Promise<ProductSearchItem[]> {
  if (!products.length) return [];
  const response = await (options.fetcher ?? fetch)(`${(options.baseUrl ?? localChatmockBaseUrl()).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chatmockApiKeyValue()}` },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: GLOBAL_MODEL_SENTINEL,
      stream: false,
      responses_tool_choice: "none",
      tool_choice: "none",
      reasoning_effort: "low",
      max_completion_tokens: 4_000,
      messages: [
        { role: "system", content: systemPromptText("product-review", options.userId) },
        { role: "user", content: JSON.stringify({ query, ...(options.userRequest ? { userRequest: options.userRequest.slice(0, 4_000) } : {}), candidates: products.map(({ id, title, description, attributes, price }) => ({ id, title, description, attributes, price })) }) },
      ],
    }),
  });
  if (!response.ok) throw new Error("Product review is unavailable.");
  const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("Product review was incomplete.");
  return parseReviewedProducts(choice?.message?.content, products);
}
