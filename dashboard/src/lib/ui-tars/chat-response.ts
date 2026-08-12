import { agentTarsFailureMessage } from "./identity.ts";

interface AgentTarsResponseEvent {
  type: string;
  payload: Record<string, unknown>;
}

const NATIVE_DESKTOP_FAILURE = /(?:clipboardy|clipboard|could not paste|command failed|thread ['"]main['"] panicked|rust_backtrace|node_modules|src[\\/]libcore|too many action execute failures)/i;

export function safeAgentTarsMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return "";
  if (NATIVE_DESKTOP_FAILURE.test(message)) {
    return /clipboard|paste/i.test(message)
      ? "Agent TARS could not type into the desktop application."
      : "Agent TARS could not complete a desktop action.";
  }
  return message
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/(?:\/[^\s"':]+){2,}/g, "<path>");
}

/** Turn normalized run progress/terminal events into the visible chat reply. */
export function agentTarsChatResponse(events: AgentTarsResponseEvent[]): string {
  const terminal = events.findLast((event) =>
    ["run.completed", "run.failed", "run.aborted", "runtime.disconnected"].includes(event.type),
  );
  const latestStatus = events.findLast((event) => event.type === "run.status");
  const statusMessage = safeAgentTarsMessage(latestStatus?.payload.message);
  if (!terminal) return statusMessage;
  if (terminal.type === "run.completed") {
    const summary = safeAgentTarsMessage(terminal.payload.summary);
    return agentTarsFailureMessage(summary) ?? (summary || statusMessage || "Task completed.");
  }
  if (terminal.type === "run.failed") {
    const message = safeAgentTarsMessage(terminal.payload.message);
    return message || statusMessage || "Agent TARS could not complete the task.";
  }
  if (terminal.type === "run.aborted") return statusMessage || "Request was aborted.";
  const message = safeAgentTarsMessage(terminal.payload.message);
  return message || statusMessage || "The Agent TARS runtime disconnected.";
}
