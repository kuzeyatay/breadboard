"use client";

import { useRef, useState, type SetStateAction } from "react";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { chatDraftKey, readChatDraft, writeChatDraft } from "@/lib/conversations/drafts";

interface InlineQuestionDraft {
  text: string | null;
  attachments: ChatAttachment[] | null;
}

// Keep attachments and temporary-chat text through popup dismissal. Durable
// text uses the same bounded browser store as the main chat composer.
const drafts = new Map<string, InlineQuestionDraft>();
const MAX_DRAFTS = 40;

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

/** The popup is keyed by its highlight, independently of its latest answer. */
export function useInlineQuestionDraft(id: string | undefined, initialText: string | null, persist: boolean) {
  const key = id ? chatDraftKey("ask_here", id) : null;
  const [value, setValue] = useState<InlineQuestionDraft>(() => {
    const cached = key ? drafts.get(key) : undefined;
    if (cached) return cached;
    const store = persist ? storage() : null;
    const saved = key && store ? readChatDraft(store, key) : null;
    return { text: saved ?? initialText, attachments: null };
  });
  const current = useRef(value);

  function update(next: InlineQuestionDraft) {
    current.current = next;
    setValue(next);
    if (!key) return;
    drafts.delete(key);
    if (next.text !== null) {
      drafts.set(key, next);
      while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
    }
    const store = storage();
    if (store) writeChatDraft(store, key, persist ? next.text ?? "" : "");
  }

  return {
    draft: value.text,
    draftAttachments: value.attachments,
    setDraft: (text: string) => update({ ...current.current, text }),
    setDraftAttachments: (action: SetStateAction<ChatAttachment[] | null>) => update({
      ...current.current,
      attachments: typeof action === "function" ? action(current.current.attachments) : action,
    }),
    clearDraft: () => update({ text: null, attachments: null }),
  };
}
