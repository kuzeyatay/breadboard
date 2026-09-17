import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { requireSameOrigin } from "@/lib/request-origin";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import { createChatmockClient } from "@/lib/chatmock-client.ts";
import {
  GLOBAL_MODEL_SENTINEL,
  normalizeAssistantModelId,
} from "@/lib/ai-models.ts";
import {
  parsePdfViewDecision,
  pdfViewDecisionMessages,
} from "@/lib/pdf-assistant-view-decision.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireUserId();
    requireSameOrigin(request, "Ask about PDFs from Breadboard.");
    const body = await readJsonBody(request, 128_000);
    const question = requireString(body.question, "question", 12_000);
    const history = Array.isArray(body.history)
      ? body.history.slice(-6).flatMap((item) => {
          if (
            !item ||
            (item.role !== "user" && item.role !== "assistant") ||
            typeof item.content !== "string"
          )
            return [];
          return [
            { role: item.role as "user" | "assistant", content: item.content },
          ];
        })
      : [];
    let raw: string;
    try {
      const completion = await createChatmockClient().chat.completions.create(
        {
          model: normalizeAssistantModelId(body.model) ?? GLOBAL_MODEL_SENTINEL,
          messages: pdfViewDecisionMessages({
            question,
            title: typeof body.title === "string" ? body.title : "PDF",
            pageNumber:
              Number.isInteger(body.pageNumber) && Number(body.pageNumber) > 0
                ? Number(body.pageNumber)
                : 1,
            pageText: typeof body.pageText === "string" ? body.pageText : "",
            selectedText:
              typeof body.selectedText === "string"
                ? body.selectedText
                : undefined,
            history,
          }),
          response_format: { type: "json_object" },
        },
        {
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(30_000),
          ]),
          maxRetries: 0,
        },
      );
      raw = completion.choices[0]?.message?.content ?? "";
    } catch {
      throw new ApiError(
        502,
        "pdf_view_decision_unavailable",
        "The assistant could not prepare the PDF context. Try your question again.",
      );
    }
    const decision = parsePdfViewDecision(raw);
    if (!decision)
      throw new ApiError(
        502,
        "pdf_view_decision_invalid",
        "The assistant could not decide which PDF context to use. Try your question again.",
      );
    return NextResponse.json(decision);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
