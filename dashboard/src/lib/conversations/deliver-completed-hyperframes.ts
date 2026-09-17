import { completedResearchDelivery } from "./completed-research.ts";
import { publishHyperframesVideo, hyperframesDeliveryContent } from "../hyperframes/artifact.ts";
import { completeAssistantMessage, conversationTurnWasCancelled, listRecentConversationMessages } from "./store.ts";
import { setArtifactOriginatingMessage } from "../hermes/artifact-store.ts";

/** A verified render can be delivered directly; no second model or permission preflight is needed. */
export async function deliverCompletedHyperframes(input: {
  userId: number;
  conversationId: number;
  clientMessageId: string;
  continuationText: string;
  internalAgentContinuation?: boolean;
}) {
  if (!input.internalAgentContinuation || conversationTurnWasCancelled(input.conversationId, input.clientMessageId)) return null;
  const delivery = completedResearchDelivery({ ...input, agentKind: "hyperframes",
    messages: listRecentConversationMessages(input.conversationId, 30) });
  if (!delivery) return null;
  const artifact = await publishHyperframesVideo(input.userId, delivery.runId);
  if (!artifact || artifact.conversation_id !== input.conversationId) return null;
  const content = hyperframesDeliveryContent(artifact, delivery.runId);
  const completed = completeAssistantMessage({ conversationId: input.conversationId,
    clientMessageId: input.clientMessageId, content,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
      reasoningTokens: 0, scope: "turn", apiCalls: 0 },
    metadata: { internalAgentContinuation: true, verification: delivery.verification,
      hyperframesDelivery: { runId: delivery.runId, artifactId: artifact.id },
      pendingPermissions: [], error: null, runtimeStatus: "idle", responseDurationMs: 0,
      responseCompletedAt: new Date().toISOString() },
  });
  if (completed.status === "complete") {
    setArtifactOriginatingMessage({ artifactId: artifact.id, assistantMessageId: completed.id });
  }
  return completed.status === "complete" ? { ...delivery, content: completed.content } : null;
}
