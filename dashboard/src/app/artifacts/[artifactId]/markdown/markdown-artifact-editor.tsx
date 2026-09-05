"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil } from "lucide-react";
import AssistantComposer from "@/app/components/assistant-composer";
import BreadboardLoader from "@/app/components/breadboard-loader";
import ChatMarkdown from "@/app/components/chat-markdown";
import { ConfirmDialog } from "@/app/components/confirm-dialog";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import { broadcastArtifactUpdate } from "@/lib/hermes/artifact-update-channel";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import {
  markdownIntegrityIssue,
  normalizeProducedMarkdown,
} from "@/lib/markdown-safety";
import styles from "./markdown-artifact-editor.module.css";

interface EditorPayload {
  artifact: PresentedArtifact;
  content?: string;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: string;
}

interface AiPayload {
  message?: string;
  content?: string;
  error?: string;
}

const MAX_CHAT_ENTRIES = 30;

function editorEndpoint(artifact: PresentedArtifact): string {
  const query = new URLSearchParams({ conversationId: artifact.conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/edit?${query}`;
}

function aiEndpoint(artifact: PresentedArtifact): string {
  const query = new URLSearchParams({ conversationId: artifact.conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/markdown/ai?${query}`;
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorText(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }
  return fallback;
}

export default function MarkdownArtifactEditor({
  initialArtifact,
  onClose,
}: {
  initialArtifact: PresentedArtifact;
  onClose?: () => void;
}) {
  const [artifact, setArtifact] = useState(initialArtifact);
  const artifactRef = useRef(initialArtifact);
  const [content, setContentState] = useState("");
  const contentRef = useRef("");
  const [savedContent, setSavedContent] = useState("");
  const savedContentRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [editing, setEditing] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const discardConfirmedRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatHydrated, setChatHydrated] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const savingRef = useRef(false);
  const assistantController = useRef<AbortController | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const documentRef = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
  } = useAssistantIntelligence();
  const { models, modelsLoading, loadModels } = useAssistantModels({ eager: true });

  const setContent = useCallback((value: string) => {
    discardConfirmedRef.current = false;
    contentRef.current = value;
    setContentState(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(editorEndpoint(initialArtifact), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as EditorPayload & { error?: string };
        if (!response.ok || typeof body.content !== "string") {
          throw new Error(errorText(body, "The Markdown editor could not open this artifact."));
        }
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        artifactRef.current = body.artifact;
        setArtifact(body.artifact);
        const normalized = normalizeProducedMarkdown(body.content!);
        contentRef.current = normalized;
        setContentState(normalized);
        savedContentRef.current = body.content!;
        setSavedContent(body.content!);
        if (normalized !== body.content) {
          setSaveMessage("Recovered damaged LaTeX — save to keep the repair");
        }
        const integrityIssue = markdownIntegrityIssue(normalized);
        if (integrityIssue) {
          setError(`${integrityIssue} Remove or replace it before saving.`);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "The Markdown editor could not open.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialArtifact]);

  const dirty = content !== savedContent;

  const leaveEditor = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    window.close();
    window.setTimeout(() => {
      if (!window.closed && window.history.length > 1) window.history.back();
    }, 50);
  }, [onClose]);

  const closeEditor = useCallback(() => {
    if (dirty) {
      setDiscardDialogOpen(true);
      return;
    }
    leaveEditor();
  }, [dirty, leaveEditor]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (discardConfirmedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const key = `breadboard.markdown.ai.chat.${initialArtifact.id}`;
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        setChat(stored.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Partial<ChatEntry>;
          if (
            (candidate.role !== "user" && candidate.role !== "assistant") ||
            typeof candidate.text !== "string"
          ) return [];
          return [{
            id: typeof candidate.id === "string" ? candidate.id : messageId(),
            role: candidate.role,
            text: candidate.text.slice(0, 8_000),
            error: typeof candidate.error === "string" ? candidate.error.slice(0, 1_000) : undefined,
          }];
        }).slice(-MAX_CHAT_ENTRIES));
      }
    } catch {
      // A damaged local transcript must never keep the document from opening.
    } finally {
      setChatHydrated(true);
    }
  }, [initialArtifact.id]);

  useEffect(() => {
    if (!chatHydrated) return;
    const key = `breadboard.markdown.ai.chat.${initialArtifact.id}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(chat.slice(-MAX_CHAT_ENTRIES)));
    } catch {
      // Private browsing or a full storage quota should not break the editor.
    }
    const frame = window.requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chat, chatHydrated, assistantBusy, initialArtifact.id]);

  const save = useCallback(async (
    nextContent = contentRef.current,
    expectedArtifact = artifactRef.current,
  ): Promise<PresentedArtifact | null> => {
    if (loading || savingRef.current) return null;
    const normalizedContent = normalizeProducedMarkdown(nextContent);
    const integrityIssue = markdownIntegrityIssue(normalizedContent);
    if (integrityIssue) {
      setError(`${integrityIssue} Remove or replace it before saving.`);
      return null;
    }
    if (normalizedContent !== nextContent) setContent(normalizedContent);
    if (normalizedContent === savedContentRef.current) return expectedArtifact;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setSaveMessage("Saving…");
    try {
      const response = await fetch(editorEndpoint(expectedArtifact), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: expectedArtifact.version,
          content: normalizedContent,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        artifact?: PresentedArtifact;
        error?: string;
      };
      if (!response.ok || !body.artifact) {
        throw new Error(errorText(body, "The Markdown document could not be saved."));
      }
      artifactRef.current = body.artifact;
      setArtifact(body.artifact);
      savedContentRef.current = normalizedContent;
      setSavedContent(normalizedContent);
      setSaveMessage(`Saved as version ${body.artifact.version}`);
      broadcastArtifactUpdate(body.artifact);
      return body.artifact;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "The Markdown document could not be saved.";
      setError(message);
      setSaveMessage("");
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [loading, setContent]);

  useEffect(() => {
    if (discardDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [discardDialogOpen, save]);

  useEffect(() => {
    if (!onClose || discardDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeEditor, discardDialogOpen, onClose]);

  const history = useMemo(
    () => chat.filter((entry) => entry.role === "user").map((entry) => entry.text),
    [chat],
  );

  const askBread = useCallback(async () => {
    const instruction = prompt.trim();
    if (!instruction || assistantBusy || loading) return;
    const baseContent = contentRef.current;
    const baseArtifact = artifactRef.current;
    const userEntry: ChatEntry = { id: messageId(), role: "user", text: instruction };
    const priorChat = chat;
    setChat((current) => [...current, userEntry].slice(-MAX_CHAT_ENTRIES));
    setPrompt("");
    setAssistantBusy(true);
    setError("");
    const controller = new AbortController();
    assistantController.current = controller;

    try {
      const response = await fetch(aiEndpoint(baseArtifact), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: instruction,
          content: baseContent,
          selection,
          expectedVersion: baseArtifact.version,
          model,
          reasoningEffort,
          history: priorChat.slice(-12).map((entry) => ({ role: entry.role, text: entry.text })),
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as AiPayload;
      if (!response.ok || typeof body.message !== "string") {
        throw new Error(errorText(body, "Bread could not edit this Markdown document."));
      }

      if (
        contentRef.current !== baseContent ||
        artifactRef.current.version !== baseArtifact.version
      ) {
        throw new Error("The document changed while Bread was working. Your newer edits were kept; send the request again to apply it to this version.");
      }

      let saved = true;
      if (typeof body.content === "string" && body.content !== baseContent) {
        setContent(body.content);
        saved = Boolean(await save(body.content, baseArtifact));
      }
      const suffix = typeof body.content === "string" && body.content !== baseContent
        ? saved
          ? "\n\nThe changes are applied and saved in this document."
          : "\n\nThe edit is visible, but it could not be saved yet."
        : "";
      const assistantEntry: ChatEntry = {
        id: messageId(),
        role: "assistant",
        text: `${body.message}${suffix}`.trim(),
      };
      setChat((current) => [...current, assistantEntry].slice(-MAX_CHAT_ENTRIES));
    } catch (assistantError) {
      const stopped = assistantError instanceof DOMException && assistantError.name === "AbortError";
      const failureEntry: ChatEntry = {
        id: messageId(),
        role: "assistant",
        text: stopped ? "Stopped." : "I could not complete that request.",
        error: stopped
          ? undefined
          : assistantError instanceof Error
            ? assistantError.message
            : String(assistantError),
      };
      setChat((current) => [...current, failureEntry].slice(-MAX_CHAT_ENTRIES));
    } finally {
      if (assistantController.current === controller) assistantController.current = null;
      setAssistantBusy(false);
    }
  }, [assistantBusy, chat, loading, model, prompt, reasoningEffort, save, selection, setContent]);

  function captureSelection() {
    const field = sourceRef.current;
    if (!field || field.selectionStart === field.selectionEnd) {
      setSelection("");
      return;
    }
    setSelection(field.value.slice(field.selectionStart, field.selectionEnd).trim().slice(0, 1_000));
  }

  function captureDocumentSelection() {
    const selected = window.getSelection();
    if (!selected?.rangeCount || !documentRef.current?.contains(selected.getRangeAt(0).commonAncestorContainer)) {
      setSelection("");
      return;
    }
    setSelection(selected.toString().trim().slice(0, 1_000));
  }

  return (
    <main
      className={`${styles.editor} ${
        onClose ? "h-full" : "h-[calc(100vh-var(--breadboard-titlebar-height,0px))]"
      }`}
      data-markdown-artifact-editor
    >
      <header className={styles.toolbar}>
        <p className={styles.title} title={artifact.title}>{artifact.title}</p>
        <span className="sr-only" aria-live="polite">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : saveMessage || "Saved"}
        </span>
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          disabled={loading}
          aria-pressed={editing}
          aria-label={editing ? "Read document" : "Edit Markdown"}
          title={editing ? "Read document" : "Edit Markdown"}
          className={`${styles.action} ${editing ? "" : styles.iconAction}`}
        >
          {editing ? "Done" : <Pencil size={18} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        {dirty || saving ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            title="Save changes (Ctrl+S)"
            className={`${styles.action} ${styles.save}`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={closeEditor}
          aria-label="Close Markdown editor"
          className={`${styles.action} ${styles.iconAction}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      {error ? (
        <p role="alert" className="shrink-0 border-b border-[#e7b9ae] bg-[#fff1ed] px-5 py-2 text-sm text-[#9a4438]">
          {error}
        </p>
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.documentPane} aria-label="Markdown workspace" aria-busy={loading}>
          {loading ? (
            <div className="grid min-h-0 flex-1 place-items-center">
              <BreadboardLoader className="h-6 w-6" />
            </div>
          ) : editing ? (
            <textarea
              ref={sourceRef}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setSelection("");
              }}
              onSelect={captureSelection}
              onBlur={captureSelection}
              aria-label="Markdown source"
              autoFocus
              spellCheck
              className={styles.source}
            />
          ) : (
            <div className={styles.documentScroll} tabIndex={0} aria-label="Document">
              <article
                ref={documentRef}
                className={styles.document}
                onMouseUp={captureDocumentSelection}
                onKeyUp={captureDocumentSelection}
              >
                <ChatMarkdown content={content} />
              </article>
            </div>
          )}
        </section>

        <aside className={styles.assistant} aria-label="Bread Markdown assistant">
          <div ref={chatRef} className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-5" aria-live="polite">
            {chat.map((entry) => (
              <div
                key={entry.id}
                className={entry.role === "user"
                  ? "ml-7 rounded-2xl rounded-br-md border border-[var(--line)] bg-[var(--paper-strong)] px-3.5 py-3 text-sm"
                  : "text-sm leading-6"}
              >
                {entry.role === "assistant" ? <ChatMarkdown content={entry.text} compact /> : entry.text}
                {entry.error ? <p className="mt-2 text-xs text-[#a44539]">{entry.error}</p> : null}
              </div>
            ))}
            {assistantBusy ? (
              <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                <BreadboardLoader className="h-4 w-4" />
                Bread is working in this document…
              </div>
            ) : null}
          </div>
          <div className="shrink-0 p-3">
            <AssistantComposer
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => void askBread()}
              history={history}
              placeholder={selection ? "Ask Bread about the selection…" : "Ask Bread about this document…"}
              disabled={loading}
              queueDisabled
              isSending={assistantBusy}
              canSubmit={Boolean(prompt.trim()) && !assistantBusy}
              model={model}
              models={models}
              modelsLoading={modelsLoading}
              onLoadModels={loadModels}
              onModelChange={setModel}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              intelligenceModes={intelligenceModes}
              compact
              externalRunActive={assistantBusy}
              onStop={() => assistantController.current?.abort()}
              headerContent={selection ? (
                <div className="flex items-center gap-2 px-1 py-0.5 text-[11px] text-[var(--ink-muted)]">
                  <span className="font-semibold text-[var(--botanical)]">Selected</span>
                  <span className="truncate">{selection}</span>
                  <button type="button" onClick={() => setSelection("")} className="ml-auto" aria-label="Clear selected text context">✕</button>
                </div>
              ) : undefined}
            />
          </div>
        </aside>
      </div>
      {discardDialogOpen ? (
        <ConfirmDialog
          title="Discard changes?"
          body="Your unsaved edits will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onCancel={() => setDiscardDialogOpen(false)}
          onConfirm={() => {
            discardConfirmedRef.current = true;
            setDiscardDialogOpen(false);
            leaveEditor();
          }}
        />
      ) : null}
    </main>
  );
}
