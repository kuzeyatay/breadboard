/** Data travels only between the owning Terminal and its trusted answer view. */
export interface BrowserInlineAnswerState {
  requestId: string;
  selectionId: string;
  content: Record<string, unknown>;
}
export interface BrowserInlineAnswerAction {
  requestId: string;
  selectionId: string;
  action: "ask" | "stop" | "delete" | "close";
  question?: string;
  attachments?: unknown[];
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
      !["ask", "stop", "delete", "close"].includes(action.action)) return false;
  if (action.action === "ask" && (typeof action.question !== "string" || !action.question.trim() || action.question.length > 100_000)) return false;
  if (action.attachments !== undefined && (!Array.isArray(action.attachments) || action.attachments.length > 32)) return false;
  try { return JSON.stringify(action).length <= 16_000_000; } catch { return false; }
}
