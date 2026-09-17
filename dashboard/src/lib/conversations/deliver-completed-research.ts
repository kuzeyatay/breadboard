import { completedResearchDelivery } from "./completed-research.ts";
import { completeAssistantMessage, conversationTurnWasCancelled, listRecentConversationMessages } from "./store.ts";

const DELIVERY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0,
  cachedInputTokens: 0, reasoningTokens: 0, scope: "turn" as const, apiCalls: 0 };

/** Publishing an already reviewed report needs no live model or research tools. */
export function deliverCompletedResearch(input: {
  conversationId: number;
  clientMessageId: string;
  continuationText: string;
  internalAgentContinuation?: boolean;
}, database?: Parameters<typeof completeAssistantMessage>[1]) {
  if (!input.internalAgentContinuation || conversationTurnWasCancelled(input.conversationId, input.clientMessageId, database)) return null;
  const delivery = completedResearchDelivery({
    ...input, messages: listRecentConversationMessages(input.conversationId, 30, database),
  });
  if (!delivery) return null;
  const completed = completeAssistantMessage({
    conversationId: input.conversationId, clientMessageId: input.clientMessageId,
    content: delivery.content,
    tokenUsage: DELIVERY_USAGE,
    metadata: {
      internalAgentContinuation: true,
      researchDelivery: { runId: delivery.runId, workerClientMessageId: delivery.workerClientMessageId },
      verification: delivery.verification,
      runtimeStatus: "idle", responseDurationMs: 0,
      responseCompletedAt: new Date().toISOString(),
    },
  }, database);
  const receipt = JSON.parse(completed.metadata || "{}").researchDelivery;
  return completed.status === "complete" && receipt?.runId === delivery.runId
    ? { ...delivery, content: completed.content } : null;
}

export function completedResearchEventStream(delivery: NonNullable<ReturnType<typeof completedResearchDelivery>>): Response {
  const events = [
    { type: "runtime", backend: "breadboard-research-delivery", fallback: false },
    { type: "delta", text: delivery.content },
    { type: "verification", verification: delivery.verification },
    { type: "usage", usage: DELIVERY_USAGE },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      "X-Breadboard-AI-Backend": "breadboard-research-delivery", "X-Breadboard-AI-Fallback": "0" },
  });
}
