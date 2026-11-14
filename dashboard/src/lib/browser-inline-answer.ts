import type { ComponentProps } from "react";
import type { InlineSelectionAnswerPopover } from "@/app/components/chat-text-selection-ui";
import type { ChatTextSelectionReference } from "./chat-text-selection";
import type { ChatAttachment } from "./chat-attachments";
import type { ChatTextAnnotation } from "@/app/components/chat-markdown";
import type { ChatHighlightColor } from "./chat-highlights";

export type BrowserInlineAnswerContent = Pick<ComponentProps<typeof InlineSelectionAnswerPopover>,
  "question" | "questionAttachments" | "answer" | "reasoning" | "progressNotes" | "pending" | "usage" |
  "responseDurationMs" | "responseCompletedAt" | "verification" | "startedAt" | "answerMessageId" | "starMessageId" | "conversationId" | "canStar" | "persistDraft"> &
  { canAsk: boolean; artifactMessageId?: string; error?: string; ownerReady?: boolean; note?: string;
    /** Ask-here threads asked inside this answer (recursively), so the card can drill into them. */
    nested?: BrowserInlineNestedThread[];
    /** Marks per answer message id, for the root answer and every nested one. */
    annotations?: Record<string, ChatTextAnnotation[]> };
export type BrowserInlineNestedThread = Omit<BrowserInlineAnswerContent, "nested" | "annotations" | "canAsk" | "ownerReady" | "note" | "error"> &
  { selection: ChatTextSelectionReference };
/** The Terminal asks the browser page to show its drawer (Ask in chat from the web answer card). */
export const BROWSER_REVEAL_TERMINAL_EVENT = "breadboard:browser-reveal-terminal";
export interface BrowserInlineAnswerState { requestId: string; selectionId: string; content: BrowserInlineAnswerContent }
export interface BrowserInlineAnswerViewState extends BrowserInlineAnswerState {
  selection: ChatTextSelectionReference;
  conversationId?: string;
  viewport: { width: number; height: number };
}
export interface BrowserInlineAnswerAction {
  requestId: string; selectionId: string; action: "ask" | "stop" | "delete" | "close" | "highlight" | "ask-in-chat";
  question?: string; attachments?: ChatAttachment[];
  /** ask/stop/delete: a nested thread (absent = the web highlight). highlight/ask-in-chat: the passage. */
  selection?: ChatTextSelectionReference;
  /** color null removes the highlight; note null removes the note; undefined keeps either. */
  highlight?: { color?: ChatHighlightColor | null; note?: string | null };
}
