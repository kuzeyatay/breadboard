import OpenAI from "openai";
import { NextResponse } from "next/server";
import { GLOBAL_MODEL_SENTINEL } from "@/lib/ai-models.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { withCouncil } from "@/lib/council.ts";
import {
  GENOFFICE_AI_LIMITS,
  GENOFFICE_AI_SYSTEM_PROMPT,
  parseGenOfficeAiHistory,
  parseGenOfficeAiReply,
} from "@/lib/hermes/genoffice-ai.ts";
import {
  ArtifactStoreError,
  getArtifactForUser,
} from "@/lib/hermes/artifact-store.ts";
import { apiErrorResponse, ApiError, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { requireUserId } from "@/lib/server-auth.ts";

export const dynamic = "force-dynamic";

function requiredConversationId(request: Request): string {
  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
  }
  return conversationId;
}

function routeError(error: unknown) {
  if (error instanceof ArtifactStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return apiErrorResponse(error);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { artifactId } = await params;
    const conversationId = requiredConversationId(request);
    const artifact = getArtifactForUser({
      artifactId,
      userId,
      conversationPublicId: conversationId,
    });
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    if (artifact.renderer_id !== "document-file" || !artifact.filename.toLowerCase().endsWith(".docx")) {
      throw new ArtifactStoreError(
        422,
        "artifact_editor_docx_unsupported",
        "This artifact is not an editable Word document.",
      );
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string"
      ? body.prompt.trim().slice(0, GENOFFICE_AI_LIMITS.prompt)
      : "";
    if (!prompt) throw new ApiError(400, "genoffice_ai_prompt_required", "A prompt is required.");
    const history = parseGenOfficeAiHistory(body.history);
    const documentContext = typeof body.documentContext === "string"
      ? body.documentContext.slice(0, GENOFFICE_AI_LIMITS.documentContext)
      : "";
    const documentHtml = typeof body.documentHtml === "string"
      ? body.documentHtml.slice(0, GENOFFICE_AI_LIMITS.documentHtml)
      : "";
    if (!documentContext) {
      throw new ApiError(400, "genoffice_ai_context_required", "The current document context is required.");
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "local",
    });
    const response = await client.chat.completions.create(withCouncil({
      model: GLOBAL_MODEL_SENTINEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GENOFFICE_AI_SYSTEM_PROMPT },
        ...history.map((entry) => ({ role: entry.role, content: entry.text } as const)),
        {
          role: "user",
          content: [
            `User request:\n${prompt}`,
            `Current document block context:\n${documentContext}`,
            documentHtml
              ? `Current document restricted HTML${body.documentTruncated ? " (truncated by the editor)" : ""}:\n${documentHtml}`
              : "Current document HTML is unavailable; use the block context only.",
          ].join("\n\n---\n\n"),
        },
      ],
    }, {
      taskType: "small_revision",
      pageId: artifact.id,
    }));
    const reply = parseGenOfficeAiReply(response.choices[0]?.message?.content ?? "");
    return NextResponse.json(reply);
  } catch (error) {
    return routeError(error);
  }
}

