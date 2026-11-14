/** Data travels only between the owning Terminal and its trusted answer view. */
export interface BrowserInlineAnswerState {
  requestId: string;
  selectionId: string;
  content: Record<string, unknown>;
}
export interface BrowserInlineAnswerAction {
  requestId: string;
  selectionId: string;
  /** highlight / ask-in-chat act on a passage selected inside the card's answer. */
  action: "ask" | "stop" | "delete" | "close" | "highlight" | "ask-in-chat";
  question?: string;
  attachments?: unknown[];
  selection?: unknown;
  highlight?: { color?: string | null; note?: string | null };
}
export function isBrowserInlineAnswerState(value: unknown): value is BrowserInlineAnswerState {
  if (!value || typeof value !== "object") return false;
  const state = value as BrowserInlineAnswerState;
  if (typeof state.requestId !== "string" || state.requestId.length > 128 ||
      typeof state.selectionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(state.selectionId) ||
      !state.content || typeof state.content !== "object" || Array.isArray(state.content) || typeof state.content.pending !== "boolean") return false;
  try { return JSON.stringify(state).length <= 16_000_000; } catch { return false; }
}
export function isBrowserInlineAnswerAction(value: unknown): value is BrowserInlineAnswerAction {
  if (!value || typeof value !== "object") return false;
  const action = value as BrowserInlineAnswerAction;
  if (typeof action.requestId !== "string" || action.requestId.length > 128 ||
      typeof action.selectionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(action.selectionId) ||
      !["ask", "stop", "delete", "close", "highlight", "ask-in-chat"].includes(action.action)) return false;
  if ((action.action === "highlight" || action.action === "ask-in-chat") && (!action.selection || typeof action.selection !== "object")) return false;
  if (action.action === "highlight" && (!action.highlight || typeof action.highlight !== "object")) return false;
  if (action.action === "ask" && (typeof action.question !== "string" || !action.question.trim() || action.question.length > 100_000)) return false;
  if (action.attachments !== undefined && (!Array.isArray(action.attachments) || action.attachments.length > 32)) return false;
  try { return JSON.stringify(action).length <= 16_000_000; } catch { return false; }
}
