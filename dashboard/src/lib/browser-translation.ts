import { renderSystemPrompt } from "./system-prompts/service.ts";
import { DEFAULT_MODEL } from "./ai-models.ts";
import { localChatmockBaseUrl } from "./chatmock-server.ts";
import { chatmockApiKeyValue } from "./agent-browser/provider.ts";

export interface PageTranslationRequest {
  language: string;
  segments: Array<{ id: number; text: string; context: string }>;
}

export function isPageTranslationRequest(value: unknown): value is PageTranslationRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as PageTranslationRequest;
  return typeof input.language === "string" && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(input.language) &&
    Array.isArray(input.segments) && input.segments.length > 0 && input.segments.length <= 40 &&
    input.segments.every(segment => segment && Number.isSafeInteger(segment.id) && segment.id > 0 &&
      typeof segment.text === "string" && segment.text.length > 0 && segment.text.length <= 12000 &&
      typeof segment.context === "string" && segment.context.length <= 300) &&
    new Set(input.segments.map(segment => segment.id)).size === input.segments.length &&
    input.segments.reduce((size, segment) => size + segment.text.length + segment.context.length, 0) <= 12300;
}

export function parsePageTranslation(content: unknown, input: PageTranslationRequest): Array<{ id: number; text: string }> {
  if (typeof content !== "string" || content.length > 150000) throw new Error("The translation response was incomplete. Try again.");
  let data: unknown;
  try { data = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); }
  catch { throw new Error("The translation response was incomplete. Try again."); }
  const segments = (data as { segments?: unknown })?.segments;
  if (!Array.isArray(segments) || segments.length !== input.segments.length) throw new Error("The translation response was incomplete. Try again.");
  const byId = new Map<number, string>();
  for (const segment of segments) {
    if (!segment || !Number.isSafeInteger(segment.id) || typeof segment.text !== "string" || !segment.text.trim() ||
        segment.text.length > 36000 || byId.has(segment.id)) throw new Error("The translation response was incomplete. Try again.");
    byId.set(segment.id, segment.text);
  }
  return input.segments.map(segment => {
    const text = byId.get(segment.id);
    if (text === undefined) throw new Error("The translation response was incomplete. Try again.");
    return { id: segment.id, text };
  });
}

/** Google's public MT endpoint (the same service Chrome's page translator uses): a batch in well under a second. */
export async function translateWithGoogle(input: PageTranslationRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const body = new URLSearchParams();
  for (const segment of input.segments) body.append("q", segment.text);
  const response = await fetcher(`https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=${encodeURIComponent(input.language)}&format=text`, {
    method: "POST", body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Google translation returned ${response.status}.`);
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length !== input.segments.length) throw new Error("Google translation was incomplete.");
  return input.segments.map((segment, index) => {
    const row = rows[index];
    const text = typeof row === "string" ? row : Array.isArray(row) && typeof row[0] === "string" ? row[0] : undefined;
    if (!text?.trim()) throw new Error("Google translation was incomplete.");
    // Google trims fragments; restore boundary whitespace so inline nodes don't run together.
    return { id: segment.id, text: segment.text.match(/^\s*/)![0] + text.trim() + segment.text.match(/\s*$/)![0] };
  });
}

/** Fast machine translation first; the configured model only when Google is unreachable. */
export async function translatePageText(input: PageTranslationRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch, baseUrl = localChatmockBaseUrl(), userId?: number | null) {
  try { return await translateWithGoogle(input, signal, fetcher); }
  catch (error) { if (signal?.aborted) throw error; }
  return translateWithModel(input, signal, fetcher, baseUrl, userId);
}

/** A plain translation request through the configured provider, with no tools or agent context. */
export async function translateWithModel(input: PageTranslationRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch, baseUrl = localChatmockBaseUrl(), userId?: number | null) {
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${chatmockApiKeyValue()}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
    body: JSON.stringify({
      model: DEFAULT_MODEL, stream: false, temperature: 0,
      // Translation should not inherit the gateway's general-purpose thinking budget.
      reasoning_effort: "low",
      max_completion_tokens: 12000,
      messages: [
        { role: "system", content: renderSystemPrompt("browser-translation", userId, { "language": String(input.language) }) },
        { role: "user", content: JSON.stringify({ segments: input.segments }) },
      ],
    }),
  }).catch(error => {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
    throw new Error("Translation is unavailable. Check your AI connection in Settings and try again.");
  });
  if (!response.ok) throw new Error("Translation is unavailable. Check your AI connection in Settings and try again.");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  return parsePageTranslation(payload.choices?.[0]?.message?.content, input);
}
