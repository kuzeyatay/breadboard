import type { ComponentProps } from "react";
import type { InlineSelectionAnswerPopover } from "@/app/components/chat-text-selection-ui";
import type { ChatTextSelectionReference } from "./chat-text-selection";
import type { ChatAttachment } from "./chat-attachments";

export type BrowserInlineAnswerContent = Pick<ComponentProps<typeof InlineSelectionAnswerPopover>,
  "question" | "questionAttachments" | "answer" | "reasoning" | "progressNotes" | "pending" | "usage" |
  "responseDurationMs" | "responseCompletedAt" | "verification" | "startedAt" | "answerMessageId" | "starMessageId" | "conversationId" | "canStar" | "persistDraft"> &
  { canAsk: boolean; artifactMessageId?: string; error?: string; ownerReady?: boolean; note?: string };
export interface BrowserInlineAnswerState { requestId: string; selectionId: string; content: BrowserInlineAnswerContent }
export interface BrowserInlineAnswerViewState extends BrowserInlineAnswerState {
  selection: ChatTextSelectionReference;
  conversationId?: string;
  viewport: { width: number; height: number };
}
export interface BrowserInlineAnswerAction {
  requestId: string; selectionId: string; action: "ask" | "stop" | "delete" | "close";
  question?: string; attachments?: ChatAttachment[];
}
