"use client";

// One row in the transcript, built on Buzz's own row anatomy.
//
// The shape is upstream's `MessageRow`: an `article` that is a flex row of an
// avatar gutter and a column holding `MessageHeaderRow` above the body, padded
// by the conversation-row variable so the whole transcript retunes with the
// type scale. A continuation row swaps the avatar for a clock that only appears
// on hover — which is what makes consecutive messages from one member read as
// one block rather than as repeated records.

import { memo, useState } from "react";
import { MessageSquareText, Pencil, SmilePlus, Trash2 } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import {
  MessageAuthorText,
  MessageHeaderRow,
  MessageMetaSeparator,
} from "@/app/buzz/ui/MessageHeader";
import { EmojiPicker } from "./emoji-picker";
import { MessageMarkdown } from "./message-markdown";
import type { BuzzMember, BuzzMessage } from "../types.ts";

/** Offered without opening a picker, as upstream's action bar does. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉"];

function clockTime(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export interface MessageRowProps {
  message: BuzzMessage;
  member: BuzzMember | undefined;
  /** Everyone in the room, so `@handle` can be drawn as a chip. */
  roomMembers: BuzzMember[];
  /** True when the row above is the same member, close in time. */
  grouped: boolean;
  isSelf: boolean;
  onReact: (emoji: string) => void;
  onOpenThread: () => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
}

function MessageRowImpl({
  message,
  member,
  roomMembers,
  grouped,
  isSelf,
  onReact,
  onOpenThread,
  onDelete,
  onEdit,
}: MessageRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  const live = message.status === "pending" || message.status === "streaming";
  const failed = message.status === "failed" || message.status === "aborted";

  if (message.deletedAt) {
    return (
      <article className="group/message relative z-10 mx-1 flex rounded-2xl px-2 py-conversation-row">
        <p className="text-message italic text-muted-foreground/70">
          This message was deleted.
        </p>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group/message relative z-10 rounded-2xl transition-colors",
        "py-conversation-row",
        "mx-1 px-2 hover:bg-muted/50 focus-within:bg-muted/50",
        "flex",
      )}
      data-message-id={message.id}
      data-testid="message-row"
      /*
       * Upstream gives every row a 36px avatar gutter, and swaps the avatar
       * for a hover clock on a continuation. With no profile pictures that
       * column is an empty indent down the whole transcript, so it is gone and
       * the text starts at the row's own edge. A continuation's exact minute
       * goes here instead of into that column — it is one hover away, and the
       * block it belongs to already prints the time on its header row.
       */
      title={grouped ? clockTime(message.createdAt) : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {grouped ? null : (
          <MessageHeaderRow>
            <MessageAuthorText as="h3">{message.authorName}</MessageAuthorText>
            {message.authorKind === "agent" ? (
              <span className="rounded bg-muted px-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                agent
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {clockTime(message.createdAt)}
            </span>
            {message.editedAt ? (
              <>
                <MessageMetaSeparator />
                <span className="text-xs text-muted-foreground/70">(edited)</span>
              </>
            ) : null}
          </MessageHeaderRow>
        )}

        <div data-testid="message-body">
          {editing ? (
            <div className="mt-1">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={Math.min(10, draft.split("\n").length + 1)}
                className="w-full resize-none rounded-lg border border-input/50 bg-buzz-background px-3 py-2 text-message outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="mt-1 flex gap-2 text-2xs">
                <button
                  type="button"
                  className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground"
                  onClick={() => {
                    onEdit(draft);
                    setEditing(false);
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDraft(message.body);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className={cn("text-message", failed && "text-destructive")}>
              {message.body ? (
                <MessageMarkdown body={message.body} members={roomMembers} />
              ) : live ? (
                <span className="inline-flex items-center gap-1.5 py-0.5 text-muted-foreground">
                  <span className="sprout-arc-spinner size-3" aria-hidden="true" />
                  <span className="text-2xs">{message.authorName} is thinking…</span>
                </span>
              ) : null}
            </div>
          )}
        </div>

        {message.reactions && message.reactions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onReact(reaction.emoji)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs transition-colors",
                  reaction.mine
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                <span>{reaction.emoji}</span>
                <span className="tabular-nums">{reaction.count}</span>
              </button>
            ))}
            <EmojiPicker onPick={onReact} side="top" align="start">
              <button
                type="button"
                className="flex items-center rounded-full border border-border/60 px-1.5 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/message:opacity-100 data-[state=open]:opacity-100"
                aria-label="Add reaction"
              >
                <SmilePlus className="size-3" />
              </button>
            </EmojiPicker>
          </div>
        ) : null}

        {message.replyCount && message.replyCount > 0 ? (
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-1 flex w-fit items-center gap-1.5 rounded-md py-0.5 text-2xs font-medium text-primary hover:underline"
          >
            <MessageSquareText className="size-3.5" />
            {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>

      {/* Upstream's action bar: floated at the row's top-right, revealed on
          hover. `.buzz-root` carries its own `hover:` variant, so it stays
          hidden until a real pointer is over the row. */}
      <div className="absolute -top-3 right-4 z-20 flex items-center gap-0.5 rounded-lg border border-border/60 bg-popover p-0.5 opacity-0 shadow-xs transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className="flex size-6 items-center justify-center rounded-md text-xs hover:bg-muted"
            aria-label={`React ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <EmojiPicker onPick={onReact} side="top" align="end">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="React with any emoji"
            title="React"
          >
            <SmilePlus className="size-3.5" />
          </button>
        </EmojiPicker>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpenThread}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Reply in thread"
          title="Reply in thread"
        >
          <MessageSquareText className="size-3.5" />
        </button>
        {isSelf ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Edit message"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label="Delete message"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

// The transcript re-renders on every poll. Without this, every row in a long
// room re-renders each time an agent adds a word to one of them.
export const MessageRow = memo(MessageRowImpl);
