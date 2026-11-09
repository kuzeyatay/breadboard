import { boundPromptContext } from "../hermes/prompt-budget.ts";
import { agentLaunchContinuationIds } from "./delegated-agent-provenance.ts";
import { conversationMessageText } from "./message-context.ts";

export const RECENT_CONTEXT_LIMIT = 120_000;
const MESSAGE_CONTEXT_LIMIT = 64_000;
const HISTORY_OMISSION = "[Older conversation context omitted to fit this turn; retrieve scoped history if needed.]\n";
const HISTORY_START = "<!-- breadboard:recent-history:v1 -->\n";
const HISTORY_END = "<!-- /breadboard:recent-history -->";

function runtimeMessage(role: string, surface: string, line: string): string {
  // Length framing keeps headings, role-looking lines and markup in quoted
  // messages from becoming boundaries. The plugin unwraps this before sending
  // it and only removes copies proven present in that exact outgoing request.
  return `<!-- message ${role} ${surface} ${Buffer.byteLength(line, "utf8")} -->\n${line}\n`;
}

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
  maximumCharacters = RECENT_CONTEXT_LIMIT,
  markForRuntimeDeduplication = false,
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
  const framed = markForRuntimeDeduplication && visible.every(message =>
    /^(user|assistant)$/.test(message.role) && /^[a-z_]+$/.test(message.surface));
  let remaining = Math.min(RECENT_CONTEXT_LIMIT, maximumCharacters) - HISTORY_OMISSION.length
    - (framed ? HISTORY_START.length + HISTORY_END.length : 0);
  let omitted = false;
  for (const message of [...visible].reverse()) {
    const content = redact(conversationMessageText(message));
    if (!content.trim()) continue;
    const prefix = `${message.role.toUpperCase()} [${message.surface}]: `;
    // Reserve enough room for the decimal UTF-8 byte length and frame. The
    // source excerpt uses the same budget as before; stored messages stay exact.
    const overhead = framed ? runtimeMessage(message.role, message.surface, "").length + 10 : 1;
    const excerpt = boundPromptContext(content, Math.min(MESSAGE_CONTEXT_LIMIT, remaining - prefix.length - overhead));
    if (!excerpt) {
      omitted = true;
      continue;
    }
    const line = framed ? runtimeMessage(message.role, message.surface, prefix + excerpt) : prefix + excerpt;
    remaining -= line.length + (framed ? 0 : 1);
    lines.push(line);
  }
  const rendered = lines.reverse().join(framed ? "" : "\n");
  if (!rendered) return omitted ? HISTORY_OMISSION : "";
  return (omitted ? HISTORY_OMISSION : "") + (framed ? HISTORY_START + rendered + HISTORY_END : rendered);
}
