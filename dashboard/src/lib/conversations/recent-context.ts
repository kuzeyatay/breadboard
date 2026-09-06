import { boundPromptContext } from "../hermes/prompt-budget.ts";
import { agentLaunchContinuationIds } from "./delegated-agent-provenance.ts";
import { conversationMessageText } from "./message-context.ts";

export const RECENT_CONTEXT_LIMIT = 120_000;
const MESSAGE_CONTEXT_LIMIT = 64_000;
const HISTORY_OMISSION = "[Older conversation context omitted to fit this turn; retrieve scoped history if needed.]\n";

interface ContextMessage {
  role: string;
  surface: string;
  content: string;
  metadata?: string | null;
  client_message_id?: string;
  status?: string;
}

function metadata(message: ContextMessage): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(message.metadata ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Render-time projection only: the original transcript and reports stay intact. */
export function composeRecentConversationContext(
  messages: readonly ContextMessage[],
  redact: (text: string) => string = (text) => text,
): string {
  const completedTurns = new Set(messages.filter((message) =>
    message.role === "assistant" && message.content.trim() &&
    message.status === "complete" && message.client_message_id,
  ).map((message) => message.client_message_id));
  const synthesizedWorkers = new Set(messages.flatMap((message) =>
    message.role === "user" && metadata(message).internalAgentContinuation === true &&
    completedTurns.has(message.client_message_id)
      ? agentLaunchContinuationIds(message.content) : [],
  ));
  const visible = messages.filter((message) => {
    const meta = metadata(message);
    // A worker handoff is machine context, not a second request from the user.
    if (message.role === "user" && meta.internalAgentContinuation === true) return false;
    if (meta.delegatedAgentRun === true) {
      const run = meta.externalAgentRun as { runId?: string } | undefined;
      if (synthesizedWorkers.has(message.client_message_id ?? "") ||
          synthesizedWorkers.has(run?.runId ?? "")) return false;
    }
    return true;
  });
  const lines: string[] = [];
  let remaining = RECENT_CONTEXT_LIMIT - HISTORY_OMISSION.length;
  let omitted = false;
  for (const message of [...visible].reverse()) {
    const content = redact(conversationMessageText(message));
    if (!content.trim()) continue;
    const prefix = `${message.role.toUpperCase()} [${message.surface}]: `;
    const excerpt = boundPromptContext(content, Math.min(MESSAGE_CONTEXT_LIMIT, remaining - prefix.length - 1));
    if (!excerpt) {
      omitted = true;
      continue;
    }
    const line = prefix + excerpt;
    remaining -= line.length + 1;
    lines.push(line);
  }
  return (omitted ? HISTORY_OMISSION : "") + lines.reverse().join("\n");
}
