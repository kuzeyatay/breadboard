import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ASSISTANT_REASONING_EFFORTS } from "@/lib/assistant-reasoning";
import {
  abortRun,
  MAX_RESEARCH_QUESTION_MAX_CHARS,
  startRun,
} from "@/lib/max-research/runtime-run-manager.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { recordExternalAgentTurn } from "@/lib/conversations/external-agent-turns.ts";
import { generateAndApplyConversationTitle } from "@/lib/conversations/title-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DurableMaxResearchTurn {
  conversationId: string;
  clientMessageId: string;
  userContent: string;
  branchGroupId?: string;
}

function durableTurnFromBody(
  body: Record<string, unknown>,
): DurableMaxResearchTurn | null | "invalid" {
  const fields = [
    body.conversationId,
    body.clientMessageId,
    body.userContent,
    body.branchGroupId,
  ];
  if (fields.every((value) => value === undefined)) return null;
  if (
    typeof body.conversationId !== "string" ||
    !body.conversationId.startsWith("conv_") ||
    typeof body.clientMessageId !== "string" ||
    !body.clientMessageId.trim() ||
    body.clientMessageId.length > 128 ||
    typeof body.userContent !== "string" ||
    !body.userContent.trim() ||
    body.userContent.length > MAX_RESEARCH_QUESTION_MAX_CHARS ||
    (body.branchGroupId !== undefined &&
      (typeof body.branchGroupId !== "string" ||
        !body.branchGroupId.trim() ||
        body.branchGroupId.length > 128))
  ) {
    return "invalid";
  }
  return {
    conversationId: body.conversationId,
    clientMessageId: body.clientMessageId.trim(),
    userContent: body.userContent,
    ...(typeof body.branchGroupId === "string"
      ? { branchGroupId: body.branchGroupId.trim() }
      : {}),
  };
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { ok: false, error: "question_required" },
        { status: 400 },
      );
    }
    // Mirror the worker's canonical-request rules here, so a request the
    // worker would refuse fails with a reason instead of a crashed worker.
    const reasoningEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort : "medium";
    if (!(ASSISTANT_REASONING_EFFORTS as readonly string[]).includes(reasoningEffort)) {
      return NextResponse.json(
        { ok: false, error: "invalid_reasoning_effort" },
        { status: 400 },
      );
    }
    const durableTurn = durableTurnFromBody(body);
    if (durableTurn === "invalid") {
      return NextResponse.json(
        { ok: false, error: "invalid_conversation_turn" },
        { status: 400 },
      );
    }
    const conversation = durableTurn
      ? getConversationForUser(durableTurn.conversationId, userId)
      : null;
    const run = await startRun({
      userId,
      ...(durableTurn ? { requestId: durableTurn.clientMessageId } : {}),
      question: question.slice(0, MAX_RESEARCH_QUESTION_MAX_CHARS),
      model: typeof body.model === "string" ? body.model : "",
      reasoningEffort,
      baseUrl: resolveChatmockBaseUrl(request).baseURL,
      ...(typeof body.conversationContext === "string"
        ? { conversationContext: body.conversationContext.slice(0, 20_000) }
        : {}),
    });
    if (durableTurn && conversation) {
      try {
        const turn = recordExternalAgentTurn({
          conversation,
          clientMessageId: durableTurn.clientMessageId,
          surface: conversation.surface,
          userContent: durableTurn.userContent,
          run: {
            kind: "max_research",
            runId: run.runId,
            query: question,
          },
          ...(durableTurn.branchGroupId
            ? { branchGroupId: durableTurn.branchGroupId }
            : {}),
        });
        if (turn.userMessage.order_index === 0) {
          await generateAndApplyConversationTitle({
            conversation,
            firstPrompt: turn.userMessage.content,
            model: body.model,
          }).catch(() => undefined);
        }
      } catch (error) {
        await abortRun(userId, run.runId).catch(() => false);
        throw error;
      }
    }
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "max_research_failed",
      },
      { status: 500 },
    );
  }
}
