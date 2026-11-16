import { providerReplyVerification } from "@/lib/hermes/evidence.ts";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { DEFAULT_MODEL, normalizeAssistantModelId } from "@/lib/ai-models.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 200;
const MAX_CHARS = 120_000;

/**
 * POST: write a fresh answer to the last user message in `messages`, and only
 * return it. Nothing is stored here.
 *
 * Regenerating an answer that is not the newest one must leave every later
 * message where it is, so it cannot go through a surface's send path, which
 * appends a turn and hands the runtime a truncated history. The caller saves
 * the text as a new version of that one answer instead.
 */
// ponytail: plain model call (no tools, memory or garden context); the newest
// answer still retries through the full agent path.
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json().catch(() => null)) as {
      messages?: unknown;
      model?: unknown;
    } | null;
    const messages = Array.isArray(body?.messages)
      ? body.messages
          .slice(-MAX_MESSAGES)
          .flatMap((entry: unknown) => {
            const m = entry as { role?: unknown; content?: unknown } | null;
            if (!m || (m.role !== "user" && m.role !== "assistant")) return [];
            if (typeof m.content !== "string" || !m.content.trim()) return [];
            return [{ role: m.role, content: m.content.slice(0, MAX_CHARS) }];
          })
      : [];
    if (messages.at(-1)?.role !== "user") {
      return NextResponse.json(
        { error: "There is no question to answer again." },
        { status: 400 },
      );
    }
    const model = normalizeAssistantModelId(body?.model) ?? DEFAULT_MODEL;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: request.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: unknown } }[];
      error?: { message?: string } | string;
    } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!response.ok || typeof content !== "string" || !content.trim()) {
      const error = typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message;
      return NextResponse.json(
        { error: error || "The response could not be regenerated." },
        { status: 502 },
      );
    }
    const { answerModel, usedFallback } = providerReplyVerification(response.headers, payload?.model);
    return NextResponse.json({ content: content.trim(), answerModel, usedFallback });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
