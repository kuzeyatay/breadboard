export interface AssistantHandoffMessage {
  role?: string;
  content?: string;
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  failed?: boolean;
  interrupted?: boolean;
  verification?: { externalAgents?: readonly { carried?: boolean }[] };
}

/** A launch turn reports a hand-off; carried provenance identifies its later answer. */
export function assistantHandoffContent(message: AssistantHandoffMessage): string {
  if (message.role === "user" || message.failed || message.interrupted) return "";
  const content = message.content?.trim() ?? "";
  if (!content) return "";
  if (content === message.delegatedAgentPreamble?.trim()) return content;
  // A worker's own result remains answer content, including its inline widget.
  if (message.delegatedAgentRun) return "";
  const agents = message.verification?.externalAgents;
  // A synthesis may launch follow-up work while already reporting results.
  // Its carried provenance keeps that substantive response in the body.
  return agents?.length && agents.every((agent) => agent.carried !== true)
    ? content
    : "";
}

/**
 * Text shown in the ordinary assistant response body.
 *
 * Hermes keeps public, pre-tool narration separate from the durable answer so
 * the final response can replace it cleanly. Progress narration is disclosed
 * by the response's Thinking row; it must never masquerade as answer text.
 */
export function assistantVisibleContent(
  content: string,
  message?: AssistantHandoffMessage,
): string {
  if (message && assistantHandoffContent({ ...message, content })) return "";
  return content.trim() ? content : "";
}
