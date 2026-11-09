import { systemPromptText } from "../../../../lib/system-prompts/service.ts";
import { NextResponse } from "next/server";
import { requireUserId, requireReadableCluster } from "@/lib/server-auth";
import { gardenPdfReference, readGardenPdfPages } from "@/lib/pdf-garden-reading.ts";
import { requireSameOrigin } from "@/lib/request-origin";
import {
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
  pdfViewDecisionMessages,
  resolvePdfViewDecision,
} from "@/lib/pdf-assistant-view-decision.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireSameOrigin(request, "Ask about PDFs from Breadboard.");
    const body = await readJsonBody(request, 128_000);
    const question = requireString(body.question, "question", 12_000);
    const source = gardenPdfReference(request, body.sourceUrl);
    let sourcePageText: string | undefined;
    if (source && process.env.QUARTZ_CONTENT_PATH) {
      const cluster = requireReadableCluster(userId, source.clusterSlug);
      sourcePageText = readGardenPdfPages({ ...source, clusterSlug: cluster.slug,
        contentPath: process.env.QUARTZ_CONTENT_PATH })?.[Number(body.pageNumber)];
    }
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
    const decision = await resolvePdfViewDecision({
      signal: request.signal,
      requestDecision: async (signal) => {
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
            sourcePageText,
            selectedText:
              typeof body.selectedText === "string"
                ? body.selectedText
                : undefined,
            history,
          }, systemPromptText("pdf-view-decision", userId)),
          response_format: { type: "json_object" },
        },
        {
          signal,
          maxRetries: 0,
        },
      );
      return completion.choices[0]?.message?.content ?? "";
      },
    });
    return NextResponse.json(decision);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
