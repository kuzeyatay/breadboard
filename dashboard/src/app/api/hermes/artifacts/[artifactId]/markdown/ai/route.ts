import { systemPromptText } from "../../../../../../../lib/system-prompts/service.ts";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { normalizeAssistantModelId, DEFAULT_MODEL } from "@/lib/ai-models.ts";
import {
  normalizeAssistantReasoningEffort,
  toOpenAiReasoningEffort,
} from "@/lib/assistant-reasoning.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { withCouncil } from "@/lib/system-prompts/council.ts";
import {
  ArtifactStoreError,
  getArtifactForUser,
  presentArtifact,
} from "@/lib/hermes/artifact-store.ts";
import { artifactEditorMode } from "@/lib/hermes/artifact-editor-types.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import {
  markdownIntegrityIssue,
  normalizeProducedMarkdown,
} from "@/lib/markdown-safety.ts";
import { requireUserId } from "@/lib/server-auth.ts";

export const dynamic = "force-dynamic";

const MAX_MARKDOWN_CHARS = 180_000;
const MAX_HISTORY_ENTRIES = 12;

interface ChatEntry {
  role: "user" | "assistant";
  text: string;
}

function requiredConversationId(request: Request): string {
  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
  }
  return conversationId;
}

function parseHistory(value: unknown): ChatEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<ChatEntry>;
    if (
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.text !== "string" ||
      !item.text.trim()
    ) return [];
    return [{ role: item.role, text: item.text.trim().slice(0, 8_000) }];
  }).slice(-MAX_HISTORY_ENTRIES);
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1]?.trim() ?? trimmed;
}

function parseReply(value: string, currentContent: string): {
  message: string;
  content?: string;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(value)) as Record<string, unknown>;
  } catch {
    throw new ApiError(502, "markdown_ai_invalid_reply", "Bread returned an unreadable Markdown edit.");
  }
  const message = typeof parsed.message === "string" ? parsed.message.trim().slice(0, 8_000) : "";
  if (!message) {
    throw new ApiError(502, "markdown_ai_empty_reply", "Bread returned an empty Markdown response.");
  }
  if (parsed.content === null || parsed.content === undefined) return { message };
  if (typeof parsed.content !== "string") {
    throw new ApiError(502, "markdown_ai_invalid_content", "Bread returned invalid Markdown content.");
  }
  const content = normalizeProducedMarkdown(parsed.content);
  if (content.length > MAX_MARKDOWN_CHARS) {
    throw new ApiError(413, "markdown_ai_content_too_large", "The edited Markdown is too large for this assistant.");
  }
  const issue = markdownIntegrityIssue(content);
  if (issue) {
    throw new ApiError(502, "markdown_ai_damaged_content", issue);
  }
  return content === currentContent ? { message } : { message, content };
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
    const presented = presentArtifact(artifact);
    if (presented.kind !== "markdown" || !artifactEditorMode(presented)) {
      throw new ArtifactStoreError(
        422,
        "artifact_editor_markdown_unsupported",
        "This artifact is not an editable Markdown document.",
      );
    }

    const body = await readJsonBody(request, 2 * 1024 * 1024);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== artifact.current_version) {
      throw new ArtifactStoreError(
        409,
        "artifact_version_conflict",
        "The Markdown document changed while Bread was opening it. Reload the editor and try again.",
      );
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 12_000) : "";
    const currentContent = typeof body.content === "string" ? body.content : "";
    const selection = typeof body.selection === "string" ? body.selection.trim().slice(0, 1_000) : "";
    if (!prompt) throw new ApiError(400, "markdown_ai_prompt_required", "A prompt is required.");
    if (!currentContent || currentContent.length > MAX_MARKDOWN_CHARS) {
      throw new ApiError(413, "markdown_ai_document_too_large", "This Markdown document is too large for the assistant.");
    }
    const model = normalizeAssistantModelId(body.model) ?? DEFAULT_MODEL;
    const effort = normalizeAssistantReasoningEffort(body.reasoningEffort);
    const history = parseHistory(body.history);
    const { baseURL } = resolveChatmockBaseUrl(request);
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "local",
    });

    const response = await client.chat.completions.create(withCouncil({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPromptText("markdown-assistant", userId),
        },
        ...history.map((entry) => ({ role: entry.role, content: entry.text } as const)),
        {
          role: "user",
          content: [
            `Request:\n${prompt}`,
            selection ? `Selected text:\n${selection}` : "",
            `Current Markdown:\n\`\`\`markdown\n${currentContent}\n\`\`\``,
          ].filter(Boolean).join("\n\n---\n\n"),
        },
      ],
      ...(effort === "none" ? {} : { reasoning_effort: toOpenAiReasoningEffort(effort) }),
    }, {
      taskType: "small_revision",
      pageId: artifact.id,
      ...(artifact.garden_slug ? { gardenId: artifact.garden_slug } : {}),
    }, userId));

    return NextResponse.json(parseReply(
      response.choices[0]?.message?.content ?? "",
      currentContent,
    ));
  } catch (error) {
    return routeError(error);
  }
}
