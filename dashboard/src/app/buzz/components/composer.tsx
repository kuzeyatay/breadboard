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
  Loader2,
  Paperclip,
  Quote,
  Smile,
  Strikethrough,
  X,
} from "lucide-react";
import { MAX_STORED_FILE_ATTACHMENT_BYTES, STORED_FILE_FILENAME_HEADER } from "@/lib/stored-file-attachments.ts";

import { cn } from "@/app/buzz/lib/cn";
import { useTheme } from "@/app/buzz/lib/theme";
import MetalSendButton from "@/app/components/effects/metal-send-button";
import ComposerBorderBeam from "@/app/components/effects/composer-border-beam";
import ChatDraftFormatting from "@/app/components/chat/chat-draft-formatting";
import { readStored, writeStored } from "../lib/message-state";
import { Button } from "@/app/buzz/ui/button";
import { EmojiPicker } from "./emoji-picker";
import { ComposerIntelligence } from "./composer-intelligence";
import { useSentenceCompletion } from "@/app/components/use-sentence-completion";
import SuggestionInfo from "@/app/components/suggestion-info";
import { usePersonalize } from "@/app/components/use-personalize";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/buzz/ui/tooltip";
import type { BuzzMember, BuzzMessage } from "../types.ts";
import type { RoomAttachment } from "../use-room.ts";
import { CommandHub } from "@/app/components/hermes/command-hub";

/** A file picked here: stored on this machine first, then sent with the message. */
type PickedFile = { key: string; name: string; size: number } & (
  | { state: "uploading" }
  | { state: "ready"; stored: RoomAttachment }
  | { state: "failed"; error: string });

const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function storeFile(file: File): Promise<RoomAttachment> {
  if (file.size > MAX_STORED_FILE_ATTACHMENT_BYTES) throw new Error("Files must be under 128 MiB.");
  const response = await fetch("/api/chat-attachments/files", {
    method: "POST", body: file, duplex: "half",
    headers: { [STORED_FILE_FILENAME_HEADER]: encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
  } as RequestInit & { duplex: "half" });
  const data = (await response.json().catch(() => ({}))) as { blobId?: string; format?: string; sizeBytes?: number; message?: string };
  if (!response.ok || !data.blobId || !data.format) throw new Error(data.message ?? "The file could not be attached.");
  return { name: file.name, blobId: data.blobId, format: data.format, sizeBytes: data.sizeBytes ?? file.size };
}

// The toolbar's buttons share the capability button's round, raised style.
const TOOL_BUTTON =
  "neu-button-icon h-9 w-9 rounded-full text-[var(--ink)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40";

export function Composer({
  members,
  placeholder,
  disabled = false,
  autoFocus = false,
  onSend,
  files: fileMode,
  draftKey,
  roomId,
  threadId,
  messages,
}: {
  members: BuzzMember[];
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSend: (body: string, attachments?: RoomAttachment[]) => boolean | void;
  /**
   * Shows the attach button. `"linked"` is a room of an organization on
   * Crumbs: its files reach members on other machines through the sender's
   * Google Drive, so Drive is connected first.
   */
  files?: "local" | "linked";
  draftKey?: string;
  roomId?: string;
  threadId?: number;
  messages?: BuzzMessage[];
}) {
  const { isDark } = useTheme();
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [showFormatting, setShowFormatting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [driveNotice, setDriveNotice] = useState<null | "connect" | "waiting" | "connected" | "unavailable" | string>(null);
  const uploading = picked.some(file => file.state === "uploading");
  const ready = picked.flatMap(file => file.state === "ready" ? [file.stored] : []);

  const addFiles = (list: FileList | null) => {
    for (const file of Array.from(list ?? []).slice(0, Math.max(0, 10 - picked.length))) {
      const key = `${file.name}:${file.size}:${crypto.randomUUID()}`;
      setPicked(current => [...current, { key, name: file.name, size: file.size, state: "uploading" }]);
      void storeFile(file).then(
        stored => setPicked(current => current.map(item => item.key === key ? { ...item, state: "ready", stored } : item)),
        error => setPicked(current => current.map(item => item.key === key ? { ...item, state: "failed", error: error instanceof Error ? error.message : "The file could not be attached." } : item)),
      );
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  /** In a linked room the picker opens once Google Drive is connected; otherwise it says what is missing. */
  const attach = async () => {
    if (fileMode === "linked") {
      const status = await fetch("/api/drive", { cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ configured: boolean; connected: boolean }> : null).catch(() => null);
      if (!status?.configured) { setDriveNotice("unavailable"); return; }
      if (!status.connected) { setDriveNotice("connect"); return; }
    }
    setDriveNotice(null);
    fileRef.current?.click();
  };

  const connectDrive = async () => {
    try {
      const response = await fetch("/api/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "connect" }) });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!response.ok || !data.url) { setDriveNotice(data.message ?? "Google Drive could not be connected."); return; }
      // Opens in the system browser, where Google allows the consent page.
      window.open(data.url, "_blank");
      setDriveNotice("waiting");
      for (let tries = 0; tries < 90; tries++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await fetch("/api/drive", { cache: "no-store" }).then(next => next.ok ? next.json() as Promise<{ connected: boolean }> : null).catch(() => null);
        if (status?.connected) { setDriveNotice("connected"); return; }
      }
      setDriveNotice("connect");
    } catch { setDriveNotice("Google Drive could not be connected."); }
  };
  const [personalize] = usePersonalize();
  const [roomCards,setRoomCards] = useState<{scope:string;items:string[]}|null>(null);
  const cardScope = JSON.stringify([roomId,threadId,draftKey, messages?.filter(m =>
    m.authorKind === "human" && !m.delivery).map(m => [m.id, m.editedAt, m.deletedAt])]);
  useEffect(()=>{
    if (!roomId || !personalize || disabled) return;
    const controller=new AbortController();
    const params=new URLSearchParams({room:roomId});
    if (threadId) params.set("thread",String(threadId));
    fetch("/api/personal-context?"+params,{signal:controller.signal,cache:"no-store"})
      .then(async r=>r.ok?await r.json() as {prompts?:string[]}:{prompts:[]}).then(data=>{
        if (!controller.signal.aborted) setRoomCards({scope:cardScope,items:Array.isArray(data.prompts)?data.prompts.slice(0,2):[]});
      }).catch(()=>{});
    return ()=>controller.abort();
  },[roomId,threadId,cardScope,personalize,disabled]);
  const draftReady = useRef(false);

  useEffect(() => {
    const draft = draftKey ? readStored<unknown>(`${draftKey}:draft`, "") : "";
    setValue(typeof draft === "string" ? draft : "");
    draftReady.current = true;
  }, [draftKey]);

  const changeValue = (next: string) => {
    setValue(next);
    if (draftKey && draftReady.current) writeStored(`${draftKey}:draft`, next);
  };

  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  /**
   * A capability is an instruction to an agent, so it sits after the @mentions that
   * open the message. A message that names no one asks the room's Bread (or its
   * first agent), the agent that would otherwise not be asked at all.
   */
  const insertCapability = (token: string) => {
    const lead = /^(?:@[\w.-]+\s+)*/.exec(value)?.[0] ?? "";
    const agent = members.find(member => member.kind === "agent" && member.handle.toLowerCase() === "bread") ?? members.find(member => member.kind === "agent");
    const mentions = lead || (agent ? `@${agent.handle} ` : "");
    const next = `${mentions}${token} ${value.slice(lead.length).replace(/^\s+/, "")}`;
    changeValue(next);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length); });
  };

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
    const open = /(^|\s)@[a-z0-9-]*$/i;
    // The caret is stale when the list was opened from the @ button while the
    // editor was not focused, so look for the open "@" at the caret, then at
    // the end of the draft, and otherwise add the mention at the end.
    const caret = [element?.selectionStart ?? value.length, value.length].find((at) => open.test(value.slice(0, at))) ?? value.length;
    const head = value.slice(0, caret);
    const before = open.test(head)
      ? head.replace(open, `$1@${handle} `)
      : `${head}${head === "" || /\s$/.test(head) ? "" : " "}@${handle} `;
    changeValue(before + value.slice(caret));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(before.length, before.length);
    });
  };

  const completion=useSentenceCompletion({conversationKey:cardScope,value,onChange:changeValue,roomId,threadId,
    enabled:Boolean(roomId) && personalize && !disabled && mentionQuery===null,personalize});
  const insertAt = () => {
    const next = `${value}${/\s$/.test(value) || value === "" ? "" : " "}@`;
    changeValue(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
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
    changeValue(next);
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
    changeValue(next);
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
    changeValue(value.slice(0, lineStart) + next + value.slice(lineEnd));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(lineStart, lineStart + next.length);
    });
  };

  const submit = () => {
    const text = value.trim();
    if ((text === "" && !ready.length) || disabled || uploading) return;
    if (onSend(text, ready.length ? ready : undefined) === false) return;
    changeValue("");
    setPicked([]);
    if (driveNotice === "connected") setDriveNotice(null);
    setMentionQuery(null);
  };
  const canSend = !disabled && !uploading && (value.trim() !== "" || ready.length > 0);

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
                  // Keep focus, and with it the caret, in the editor while a name is clicked.
                  onMouseDown={(event) => event.preventDefault()}
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
                  <span className="ml-auto text-3xs text-muted-foreground">
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

        {!value && !disabled && personalize && roomCards?.scope===cardScope && roomCards.items.map(item=>
          <button key={item} type="button" className="mb-1 mr-2 rounded-md border px-2 py-1 text-left text-xs" onClick={()=>{changeValue(item);inputRef.current?.focus();}}>{item}</button>)}
        <ComposerBorderBeam active={value.trim() === "" && !disabled} sharedClock>
        <div
          data-buzz-composer
          className="neu-composer buzz-composer relative rounded-[30px] p-2"
          onPointerDown={(event) => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}
        >
          {!disabled && <ChatDraftFormatting key={draftKey} inputRef={inputRef} value={value} />}
          {driveNotice ? (
            <div role="status" className="mx-2 mb-1 flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span>{driveNotice === "connect" ? "Connect Google Drive to share files with members on other machines. Files are encrypted before they leave this computer."
                : driveNotice === "waiting" ? "Finish connecting in your browser, then come back here."
                : driveNotice === "connected" ? "Google Drive is connected. Attach your files."
                : driveNotice === "unavailable" ? "File sharing in this organization needs Google Drive, which is not set up on this Breadboard yet."
                : driveNotice}</span>
              {driveNotice === "connect" ? <button type="button" className="neu-button rounded-lg px-2 py-1 text-xs text-foreground" onClick={() => void connectDrive()}>Connect Google Drive</button> : null}
              {driveNotice === "waiting" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              <button type="button" aria-label="Dismiss" className="ml-auto rounded-full p-0.5 hover:bg-muted" onClick={() => setDriveNotice(null)}><X className="size-3.5" /></button>
            </div>
          ) : null}
          {picked.length ? (
            <ul className="mx-2 mb-1 flex flex-wrap gap-1.5" aria-label="Attached files">
              {picked.map(file => (
                <li key={file.key} className={cn("flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs", file.state === "failed" && "border-destructive/60 text-destructive")}
                  title={file.state === "failed" ? file.error : undefined}>
                  {file.state === "uploading" ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-label="Attaching" /> : <Paperclip className="size-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{file.state === "failed" ? "not attached" : sizeLabel(file.size)}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} className="shrink-0 rounded-full p-0.5 hover:bg-muted" onClick={() => setPicked(current => current.filter(item => item.key !== file.key))}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            disabled={disabled}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={12000}
            aria-describedby={completion.text ? completion.descriptionId : undefined}
            aria-keyshortcuts={completion.text ? "Tab Escape Alt+I" : undefined}
            onFocus={event=>completion.onFocus(event.currentTarget)}
            onSelect={event=>completion.onSelect(event.currentTarget)}
            onBlur={completion.onBlur}
            onCompositionStart={completion.onCompositionStart}
            onCompositionEnd={event=>completion.onCompositionEnd(event.currentTarget)}
            onChange={(event) => {
              completion.onInput(event.currentTarget);
              changeValue(event.target.value);
              readMentionQuery(event.target.value, event.target.selectionStart ?? 0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (!matches.length && completion.handleKeyDown(event)) return;
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
            className="max-h-[220px] min-h-[40px] w-full resize-none bg-transparent px-3 py-2 text-message leading-6 outline-hidden placeholder:text-muted-foreground disabled:opacity-50"
          />

          {completion.text && <div className="px-3 pb-1 text-xs text-muted-foreground">
            <span id={completion.descriptionId}>{completion.text}<span className="sr-only"> Press Tab to accept, Escape to dismiss, or Alt+I for the reason.</span></span>{' '}
            <span className="inline-flex items-center gap-1 align-middle">
              <kbd aria-hidden>Tab</kbd>
              <SuggestionInfo reason={completion.reason} editorRef={inputRef} />
            </span>
          </div>}
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
                    className={TOOL_BUTTON}
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
              {/* The Terminal's capability palette. The chosen capability goes right after the message's
                  @mentions, where the agent that answers reads it as its first instruction. */}
              <CommandHub
                open={capabilitiesOpen}
                onOpenChange={setCapabilitiesOpen}
                onSelect={item => { setCapabilitiesOpen(false); if (item.kind === "prompt") { changeValue(item.content ?? ""); inputRef.current?.focus(); return; } insertCapability(`/${item.token}`); }}
                onSelectReference={token => { setCapabilitiesOpen(false); insertCapability(`/${token}`); }}
                disabled={disabled}
                compact
                surface="dashboard_terminal"
              />
              {fileMode ? (
                <>
                  <input ref={fileRef} type="file" multiple hidden onChange={event => addFiles(event.target.files)} />
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        className={TOOL_BUTTON}
                    aria-label="Attach files"
                        data-testid="composer-attach"
                        disabled={disabled || picked.length >= 10}
                        onClick={() => void attach()}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Paperclip />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Attach files</TooltipContent>
                  </Tooltip>
                </>
              ) : null}
              <EmojiPicker
                onPick={(emoji) => insertAtCaret(emoji)}
                side="top"
                align="start"
              >
                <Button
                  className={TOOL_BUTTON}
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
                    className={cn(TOOL_BUTTON, showFormatting && "bg-[var(--paper-strong)]")}
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

            <div className="flex items-center gap-2">
            <ComposerIntelligence disabled={disabled} />
            <MetalSendButton
              variant="circle"
              disabled={!canSend}
              // Match the surrounding Organization surface and app chrome.
              theme={isDark ? "dark" : "light"}
            >
            <Button
              aria-label="Send message"
              className="rounded-full"
              data-testid="send-message"
              disabled={!canSend}
              onClick={submit}
              size="icon"
              type="button"
            >
              <ArrowUp aria-hidden />
            </Button>
            </MetalSendButton>
            </div>
          </div>
        </div>
        </ComposerBorderBeam>
      </div>
    </TooltipProvider>
  );
}
