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
  genOfficeWritingTools,
  listGenOfficeWritingSkills,
  renderGenOfficeWritingSkillsDirective,
  runGenOfficeWritingTool,
} from "@/lib/hermes/genoffice-writing-skills.ts";
import {
  ArtifactStoreError,
  getArtifactForUser,
} from "@/lib/hermes/artifact-store.ts";
import { apiErrorResponse, ApiError, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { requireUserId } from "@/lib/server-auth.ts";

export const dynamic = "force-dynamic";

const MAX_WRITING_TOOL_ROUNDS = 4;

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
    const writingSkills = listGenOfficeWritingSkills({ userId, request: prompt });
    const openedSkillSlugs = new Set<string>();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: [
          GENOFFICE_AI_SYSTEM_PROMPT,
          renderGenOfficeWritingSkillsDirective(writingSkills),
        ].join("\n\n"),
      },
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
    ];

    for (let round = 0; round < MAX_WRITING_TOOL_ROUNDS; round += 1) {
      const response = await client.chat.completions.create(withCouncil({
        model: GLOBAL_MODEL_SENTINEL,
        response_format: { type: "json_object" },
        messages,
        tools: genOfficeWritingTools(openedSkillSlugs) as OpenAI.Chat.ChatCompletionTool[],
        tool_choice: "auto",
        parallel_tool_calls: true,
      }, {
        taskType: "small_revision",
        pageId: artifact.id,
      }));
      const message = response.choices[0]?.message;
      if (!message) throw new Error("Bread returned no Word assistant response.");
      const toolCalls = (message.tool_calls ?? []).filter(
        (call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
          call.type === "function",
      );
      if (toolCalls.length === 0) {
        return NextResponse.json(parseGenOfficeAiReply(message.content ?? ""));
      }

      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: toolCalls,
      });
      for (const toolCall of toolCalls) {
        const result = await runGenOfficeWritingTool({
          userId,
          name: toolCall.function.name,
          rawArguments: toolCall.function.arguments,
          skills: writingSkills,
          openedSkillSlugs,
          signal: request.signal,
        });
        const openedSlug = result.ok && result.data?.slug;
        if (
          toolCall.function.name === "skill_open" &&
          typeof openedSlug === "string"
        ) {
          openedSkillSlugs.add(openedSlug);
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Tool work is bounded. One final tool-free call turns the gathered
    // guidance or rewrite into the exact JSON contract the editor can apply.
    messages.push({
      role: "system",
      content:
        "The Word writing-tool budget is exhausted. Do not request another tool. Return the final JSON object now, using only verified tool results and the supported GenOffice actions.",
    });
    const finalResponse = await client.chat.completions.create(withCouncil({
      model: GLOBAL_MODEL_SENTINEL,
      response_format: { type: "json_object" },
      messages,
    }, {
      taskType: "small_revision",
      pageId: artifact.id,
    }));
    return NextResponse.json(
      parseGenOfficeAiReply(finalResponse.choices[0]?.message?.content ?? ""),
    );
  } catch (error) {
    return routeError(error);
  }
}
