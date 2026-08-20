"use client";

// Buzz's composer dock: the editor above, a toolbar row beneath it, and the
// round send button on the right. Icons, variants and the `rounded-full` send
// are upstream's `MessageComposerToolbar`.
//
// The one piece of room-specific behaviour is `@`. Mentions are how a room
// decides who answers, so completion is not a convenience — a mistyped handle
// is a message no agent picks up. The list is the room's own members, never the
// whole roster, because you cannot summon someone who is not in the room.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALargeSmall,
  ArrowUp,
  AtSign,
  Bold,
  Code,
  Italic,
  Link2,
  List,
  Paperclip,
  Quote,
  Smile,
  Strikethrough,
} from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import { Button } from "@/app/buzz/ui/button";
import { EmojiPicker } from "./emoji-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/buzz/ui/tooltip";
import type { BuzzMember } from "../types.ts";

export function Composer({
  members,
  placeholder,
  disabled = false,
  autoFocus = false,
  onSend,
}: {
  members: BuzzMember[];
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSend: (body: string) => void;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [showFormatting, setShowFormatting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return members
      .filter(
        (member) =>
          member.handle.toLowerCase().includes(query) ||
          member.displayName.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [members, mentionQuery]);

  useEffect(() => setHighlighted(0), [mentionQuery]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [value]);

  const readMentionQuery = (text: string, caret: number) => {
    const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret));
    setMentionQuery(match ? match[1] : null);
  };

  const applyMention = (handle: string) => {
    const element = inputRef.current;
    const caret = element?.selectionStart ?? value.length;
    const before = value
      .slice(0, caret)
      .replace(/(?:^|\s)@([a-z0-9-]*)$/i, (whole) =>
        whole.startsWith("@") ? `@${handle} ` : ` @${handle} `,
      );
    setValue(before + value.slice(caret));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(before.length, before.length);
    });
  };

  const insertAt = () => {
    setValue((current) => `${current}${current.endsWith(" ") || current === "" ? "" : " "}@`);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      setMentionQuery("");
    });
  };

  /**
   * Put `text` where the caret is, replacing whatever is selected, and leave
   * the caret at `caretOffset` inside it.
   *
   * Appending to the end would be wrong for every one of these controls: an
   * emoji belongs where you were typing, and a formatting mark belongs around
   * the words you highlighted.
   */
  const insertAtCaret = (text: string, caretOffset = text.length) => {
    const element = inputRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + caretOffset, start + caretOffset);
    });
  };

  /**
   * Wrap the selection in a markdown mark, or open an empty pair with the
   * caret between the halves when nothing is selected.
   */
  const wrapSelection = (before: string, after = before) => {
    const element = inputRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + before + selected + after + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  };

  /** Put a marker at the head of every line the selection touches. */
  const prefixLines = (marker: string) => {
    const element = inputRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
    const block = value.slice(lineStart, lineEnd);
    // A second press takes the marker off again, so the button is a toggle
    // rather than a way to stack four quote levels by accident.
    const allMarked = block
      .split("\n")
      .every((line) => line.startsWith(marker));
    const next = block
      .split("\n")
      .map((line) => (allMarked ? line.slice(marker.length) : marker + line))
      .join("\n");
    setValue(value.slice(0, lineStart) + next + value.slice(lineEnd));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(lineStart, lineStart + next.length);
    });
  };

  const submit = () => {
    const text = value.trim();
    if (text === "" || disabled) return;
    onSend(text);
    setValue("");
    setMentionQuery(null);
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative px-4 pb-4 pt-1">
        {matches.length > 0 ? (
          <ul
            className="absolute bottom-full left-4 right-4 z-20 mb-1 overflow-hidden rounded-xl border border-border/70 bg-popover py-1 shadow-lg"
            role="listbox"
          >
            {matches.map((member, index) => (
              <li key={member.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => applyMention(member.handle)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    index === highlighted && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="font-medium">{member.displayName}</span>
                  <span className="text-2xs text-muted-foreground">
                    @{member.handle}
                  </span>
                  <span className="ml-auto text-3xs uppercase tracking-wide text-muted-foreground">
                    {member.kind === "human"
                      ? "person"
                      : member.respondTo === "always"
                        ? "always answers"
                        : "on mention"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div
          data-buzz-composer
          className="rounded-2xl border border-input/50 bg-buzz-background px-3 pb-1.5 pt-2 transition-colors focus-within:border-ring/60"
        >
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            disabled={disabled}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              readMentionQuery(event.target.value, event.target.selectionStart ?? 0);
            }}
            onKeyDown={(event) => {
              if (matches.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlighted((current) => (current + 1) % matches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlighted(
                    (current) => (current - 1 + matches.length) % matches.length,
                  );
                  return;
                }
                if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                  event.preventDefault();
                  applyMention(matches[highlighted].handle);
                  return;
                }
                if (event.key === "Escape") {
                  setMentionQuery(null);
                  return;
                }
              }
              // Enter sends, Shift+Enter breaks the line — the convention every
              // chat client shares, and the one muscle memory expects here.
              // The marks the rest of the app uses for the same keys, so a
              // selection can be bolded without reaching for the toolbar.
              const shortcut = event.metaKey || event.ctrlKey;
              if (shortcut && event.key.toLowerCase() === "b") {
                event.preventDefault();
                wrapSelection("**");
                return;
              }
              if (shortcut && event.key.toLowerCase() === "i") {
                event.preventDefault();
                wrapSelection("_");
                return;
              }
              if (shortcut && event.key.toLowerCase() === "e") {
                event.preventDefault();
                wrapSelection("`");
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="max-h-[220px] min-h-[26px] w-full resize-none bg-transparent px-1 text-message leading-6 outline-hidden placeholder:text-muted-foreground/60 disabled:opacity-50"
          />

          {showFormatting ? (
            <div className="mb-1 flex flex-wrap items-center gap-0.5 border-b border-border/40 pb-1">
              {(
                [
                  ["Bold", Bold, () => wrapSelection("**")],
                  ["Italic", Italic, () => wrapSelection("_")],
                  ["Strikethrough", Strikethrough, () => wrapSelection("~~")],
                  ["Code", Code, () => wrapSelection("`")],
                  ["Link", Link2, () => wrapSelection("[", "](url)")],
                  ["Quote", Quote, () => prefixLines("> ")],
                  ["Bulleted list", List, () => prefixLines("- ")],
                ] as const
              ).map(([label, Icon, apply]) => (
                <Tooltip disableHoverableContent key={label}>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={label}
                      disabled={disabled}
                      onClick={apply}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Tooltip disableHoverableContent>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Mention someone"
                    data-testid="message-insert-mention"
                    disabled={disabled}
                    onClick={insertAt}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <AtSign />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mention someone</TooltipContent>
              </Tooltip>
              <Tooltip disableHoverableContent>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Attach file"
                    disabled
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Paperclip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attachments are not wired up yet</TooltipContent>
              </Tooltip>
              <EmojiPicker
                onPick={(emoji) => insertAtCaret(emoji)}
                side="top"
                align="start"
              >
                <Button
                  aria-label="Emoji"
                  data-testid="composer-emoji"
                  disabled={disabled}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Smile />
                </Button>
              </EmojiPicker>
              <Tooltip disableHoverableContent>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Toggle formatting"
                    aria-pressed={showFormatting}
                    className={cn(showFormatting && "bg-accent text-accent-foreground")}
                    data-testid="composer-formatting"
                    disabled={disabled}
                    onClick={() => {
                      setShowFormatting((current) => !current);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ALargeSmall />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showFormatting ? "Hide formatting" : "Formatting"}
                </TooltipContent>
              </Tooltip>
            </div>

            <Button
              aria-label="Send message"
              className="rounded-full"
              data-testid="send-message"
              disabled={disabled || value.trim() === ""}
              onClick={submit}
              size="icon"
              type="button"
            >
              <ArrowUp aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
