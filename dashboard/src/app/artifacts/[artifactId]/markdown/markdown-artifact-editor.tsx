"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AssistantComposer from "@/app/components/assistant-composer";
import BreadboardLoader from "@/app/components/breadboard-loader";
import BreadboardLogo from "@/app/components/breadboard-logo";
import ChatMarkdown from "@/app/components/chat-markdown";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import { broadcastArtifactUpdate } from "@/lib/hermes/artifact-update-channel";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import {
  markdownIntegrityIssue,
  normalizeProducedMarkdown,
} from "@/lib/markdown-safety";

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
}: {
  initialArtifact: PresentedArtifact;
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
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatHydrated, setChatHydrated] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const savingRef = useRef(false);
  const assistantController = useRef<AbortController | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
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

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

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

  function closeWindow() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed && window.history.length > 1) window.history.back();
    }, 50);
  }

  return (
    <main className="flex h-[calc(100vh-var(--breadboard-titlebar-height,0px))] min-h-0 flex-col overflow-hidden bg-[var(--paper-bg)] text-[var(--ink)]" data-markdown-artifact-editor>
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--botanical)] shadow-sm">
          <BreadboardLogo className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">{artifact.title}</p>
          <p className="truncate text-xs text-[var(--ink-muted)]">Markdown · {artifact.filename} · version {artifact.version}</p>
        </div>
        <span className="min-w-32 text-right text-xs text-[var(--ink-muted)]" aria-live="polite">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : saveMessage || "Saved"}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || loading}
          className="neu-button rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={closeWindow}
          aria-label="Close Markdown editor"
          className="neu-button-icon rounded-xl px-3 py-2 text-[var(--ink-muted)]"
        >
          ✕
        </button>
      </header>

      {error ? (
        <p role="alert" className="shrink-0 border-b border-[#e7b9ae] bg-[#fff1ed] px-5 py-2 text-sm text-[#9a4438]">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="grid min-h-0 grid-cols-1 overflow-hidden border-r border-[var(--line)] lg:grid-cols-2" aria-label="Markdown workspace">
          <div className="flex min-h-0 flex-col border-r border-[var(--line)] bg-[var(--paper-surface)]">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Source</span>
              <span className="text-[11px] text-[var(--ink-muted)]">Ctrl+S to save</span>
            </div>
            {loading ? (
              <div className="grid min-h-0 flex-1 place-items-center">
                <BreadboardLoader className="h-6 w-6" />
              </div>
            ) : (
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
                spellCheck
                className="min-h-0 flex-1 resize-none bg-[var(--paper-raised)] p-5 font-mono text-[13px] leading-6 text-[var(--ink)] outline-none selection:bg-[var(--selection)]"
              />
            )}
          </div>

          <div className="flex min-h-0 flex-col bg-[var(--neu-surface-pressed)]">
            <div className="flex h-11 shrink-0 items-center border-b border-[var(--line)] px-4">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Preview</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              <article className="artifact-document-page mx-auto min-h-full w-full max-w-[54rem] rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-6 py-7 text-[var(--ink)] shadow-[0_8px_24px_rgba(28,45,36,0.10)] sm:px-8">
                <ChatMarkdown content={content} />
              </article>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-[var(--paper-surface)]" aria-label="Bread Markdown assistant">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--line)] px-4">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--botanical)] text-[11px] font-bold text-white">B</span>
            <span className="text-sm font-semibold text-[var(--ink-heading)]">Bread</span>
            <span className="ml-auto text-[11px] text-[var(--ink-muted)]">Markdown assistant</span>
          </div>
          <div ref={chatRef} className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-5" aria-live="polite">
            {chat.length === 0 ? (
              <div className="mx-auto mt-10 max-w-64 text-center">
                <p className="text-sm font-semibold text-[var(--ink-heading)]">Edit this document with Bread</p>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                  Ask for a rewrite, a new section, cleaner structure, or a repair to selected text. Changes are previewed and saved here.
                </p>
              </div>
            ) : null}
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
          <div className="shrink-0 border-t border-[var(--line)] p-3">
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
    </main>
  );
}
