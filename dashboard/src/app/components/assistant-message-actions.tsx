"use client";

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import EvidencePanel from "@/app/components/hermes/evidence-panel";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import { playSpeechBlob, stopSpeechPlayback } from "@/lib/speech/playback";

type Feedback = "up" | "down" | null;
type SpeechState = "idle" | "loading" | "playing";
type DictationState = "idle" | "preparing";

export interface AssistantResponseBranch {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

interface Props {
  content: string;
  onRetry?: () => void;
  verification?: VerificationSummary;
  branch?: AssistantResponseBranch;
}

function contentKey(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `breadboard:assistant-feedback:${(hash >>> 0).toString(36)}`;
}

async function copyToClipboard(content: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable.");
  }
  await navigator.clipboard.writeText(content);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadMarkdown(content: string): void {
  saveBlob(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
    `breadboard-response-${new Date().toISOString().slice(0, 10)}.md`,
  );
}

function responseTextForSpeech(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " Code example omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function speechError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `Speech failed (${response.status}).`;
}

const actionClass =
  "rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus:outline-none focus:ring-2 focus:ring-[var(--line-strong)]";

export function AssistantResponseBranchNavigation({
  branch,
  className = "",
}: {
  branch: AssistantResponseBranch;
  className?: string;
}) {
  if (branch.total <= 1) return null;
  return (
    <div
      className={`${className} flex items-center gap-0.5 text-xs text-[var(--ink-muted)]`}
      aria-label={`Response branch ${branch.current} of ${branch.total}`}
    >
      <button
        type="button"
        onClick={branch.onPrevious}
        disabled={branch.current <= 1}
        className="rounded-md p-1 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-30"
        aria-label="Previous response branch"
        title="Previous branch"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="min-w-8 text-center tabular-nums">
        {branch.current}/{branch.total}
      </span>
      <button
        type="button"
        onClick={branch.onNext}
        disabled={branch.current >= branch.total}
        className="rounded-md p-1 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-30"
        aria-label="Next response branch"
        title="Next branch"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Where a message's action row belongs: under everything the message produced.
 *
 * Inline run cards render their own action row from deep inside the card, which
 * put it above the artifact cards the transcript appends after the message. A
 * transcript wraps each message in `MessageActionsSlot` and the row is
 * portalled to the end, so copy/speak/retry always sit below the artifacts.
 */
const MessageActionsSlotContext = createContext<{
  slot: HTMLElement | null;
  suppressActions: boolean;
}>({ slot: null, suppressActions: false });

export function MessageActionsSlot({
  children,
  suppressActions = false,
}: {
  children: ReactNode;
  /** Keep controls from escaping a visually hidden owner through the portal. */
  suppressActions?: boolean;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <MessageActionsSlotContext.Provider value={{ slot, suppressActions }}>
      {children}
      {/* `contents` so an empty slot adds no gap to a flex message column. */}
      <div ref={setSlot} className="contents" />
    </MessageActionsSlotContext.Provider>
  );
}

export default function AssistantMessageActions({
  content,
  onRetry,
  verification,
  branch,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [dictationState, setDictationState] = useState<DictationState>("idle");
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const [evidenceBox, setEvidenceBox] = useState<{
    style: CSSProperties;
    maxHeight: number;
  } | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const dictationAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const { slot, suppressActions } = useContext(MessageActionsSlotContext);
  const storageKey = useMemo(() => contentKey(content), [content]);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    setFeedback(stored === "up" || stored === "down" ? stored : null);
  }, [storageKey]);

  /**
   * The evidence panel is anchored, not stacked: it is measured against the
   * action row and drawn in a fixed layer on the body. Laying it out with
   * `absolute bottom-full` inside the row is what produced the bug this
   * replaces — the row sits near the bottom of the viewport, so a panel 70vh
   * tall grew straight off the top of the screen, taking its own heading and
   * close button with it, and any ancestor with `overflow` clipped the rest.
   */
  const placeEvidence = useCallback(() => {
    const anchor = menuRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const margin = 12;
    const gap = 6;
    // The message scrolled out of the transcript. A panel still pinned where
    // its trigger used to be describes an answer the reader cannot see.
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
      setEvidenceOpen(false);
      return;
    }
    const width = Math.min(384, window.innerWidth - margin * 2);
    const above = anchor.top - gap - margin;
    const below = window.innerHeight - anchor.bottom - gap - margin;
    // Whichever side has more room, and never more height than that side has.
    const openUp = above >= below;
    const maxHeight = Math.min(
      Math.max(openUp ? above : below, 160),
      Math.round(window.innerHeight * 0.7),
    );
    const left = Math.min(
      Math.max(margin, anchor.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    setEvidenceBox({
      maxHeight,
      style: openUp
        ? {
            position: "fixed",
            left,
            bottom: window.innerHeight - anchor.top + gap,
            width,
          }
        : { position: "fixed", left, top: anchor.bottom + gap, width },
    });
  }, []);

  useEffect(() => {
    if (!evidenceOpen) {
      setEvidenceBox(null);
      return;
    }
    placeEvidence();
    window.addEventListener("resize", placeEvidence);
    // Capturing: the transcript is the element that scrolls, not the window.
    window.addEventListener("scroll", placeEvidence, true);
    return () => {
      window.removeEventListener("resize", placeEvidence);
      window.removeEventListener("scroll", placeEvidence, true);
    };
  }, [evidenceOpen, placeEvidence]);

  useEffect(() => {
    if (!menuOpen && !evidenceOpen) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel lives in a portal, so it is not inside the action row.
      if (evidenceRef.current?.contains(target)) return;
      if (!menuRef.current?.contains(target)) {
        setMenuOpen(false);
        setEvidenceOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setEvidenceOpen(false);
      }
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [evidenceOpen, menuOpen]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
      mountedRef.current = false;
      speechAbortRef.current?.abort();
      dictationAbortRef.current?.abort();
    },
    [],
  );

  async function toggleSpeech() {
    setSpeechMessage(null);
    if (speechState === "playing") {
      stopSpeechPlayback();
      setSpeechState("idle");
      return;
    }
    if (speechState === "loading") {
      speechAbortRef.current?.abort();
      speechAbortRef.current = null;
      setSpeechState("idle");
      return;
    }
    const text = responseTextForSpeech(content);
    if (!text) {
      setSpeechMessage("This response has no readable text.");
      return;
    }
    const controller = new AbortController();
    speechAbortRef.current = controller;
    setSpeechState("loading");
    try {
      const response = await fetch("/api/speech/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await speechError(response));
      await playSpeechBlob(await response.blob(), () => {
        if (mountedRef.current) setSpeechState("idle");
      });
      if (mountedRef.current) setSpeechState("playing");
    } catch (error) {
      if (!mountedRef.current) return;
      setSpeechState("idle");
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSpeechMessage(error instanceof Error ? error.message : "This response could not be spoken.");
      }
    } finally {
      if (speechAbortRef.current === controller) speechAbortRef.current = null;
    }
  }

  async function copyResponse() {
    try {
      await copyToClipboard(content);
      setCopied(true);
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } finally {
      setMenuOpen(false);
    }
  }

  function setRating(rating: Exclude<Feedback, null>) {
    const next = feedback === rating ? null : rating;
    setFeedback(next);
    if (next) localStorage.setItem(storageKey, next);
    else localStorage.removeItem(storageKey);
  }

  function downloadResponse() {
    downloadMarkdown(content);
    setMenuOpen(false);
  }

  /**
   * The spoken reading of this response, saved rather than played.
   *
   * A second press cancels: synthesis of a long answer takes as long as the
   * answer takes to say, and the menu stays open throughout so the row that
   * started the wait is the row reporting it.
   */
  async function downloadDictation() {
    if (dictationState === "preparing") {
      dictationAbortRef.current?.abort();
      dictationAbortRef.current = null;
      setDictationState("idle");
      return;
    }
    setSpeechMessage(null);
    const text = responseTextForSpeech(content);
    if (!text) {
      setMenuOpen(false);
      setSpeechMessage("This response has no readable text.");
      return;
    }
    const controller = new AbortController();
    dictationAbortRef.current = controller;
    setDictationState("preparing");
    try {
      const response = await fetch("/api/speech/synthesize/mp3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await speechError(response));
      const recording = await response.blob();
      if (!mountedRef.current) return;
      saveBlob(
        recording,
        `breadboard-dictation-${new Date().toISOString().slice(0, 10)}.mp3`,
      );
      setMenuOpen(false);
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMenuOpen(false);
      setSpeechMessage(
        error instanceof Error ? error.message : "This response could not be saved as a recording.",
      );
    } finally {
      if (dictationAbortRef.current === controller) dictationAbortRef.current = null;
      if (mountedRef.current) setDictationState("idle");
    }
  }

  function retryResponse() {
    setMenuOpen(false);
    onRetry?.();
  }

  const actions = (
    <div className="mt-2 flex items-center gap-0.5" aria-label="Assistant response actions">
      <button
        type="button"
        onClick={() => void copyResponse()}
        className={actionClass}
        title={copied ? "Copied" : "Copy response"}
        aria-label={copied ? "Response copied" : "Copy response"}
      >
        {copied ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        )}
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => void toggleSpeech()}
          className={`${actionClass} ${speechState === "playing" ? "bg-[var(--paper-strong)] text-[var(--botanical)]" : ""}`}
          title={speechState === "loading" ? "Cancel speech generation" : speechState === "playing" ? "Stop speaking" : "Read response aloud"}
          aria-label={speechState === "loading" ? "Cancel speech generation" : speechState === "playing" ? "Stop reading response" : "Read response aloud"}
          aria-pressed={speechState === "playing"}
        >
          {speechState === "loading" ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-80" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z" />
            </svg>
          ) : speechState === "playing" ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="7" y="7" width="10" height="10" rx="1.5" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 9.5v5h3.5l4 3.5V6l-4 3.5H5Z" />
              <path strokeLinecap="round" d="M16 9a4.2 4.2 0 0 1 0 6m2.5-8.5a7.8 7.8 0 0 1 0 11" />
            </svg>
          )}
        </button>
        {speechMessage ? (
          <div role="alert" className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-xs leading-5 text-[var(--ink)] shadow-lg">
            <button type="button" className="float-right ml-2 text-[var(--ink-muted)]" onClick={() => setSpeechMessage(null)} aria-label="Dismiss speech error">×</button>
            {speechMessage}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setRating("up")}
        className={`${actionClass} ${feedback === "up" ? "bg-[var(--paper-strong)] text-[var(--ink-heading)]" : ""}`}
        title="Helpful"
        aria-label="Mark response as helpful"
        aria-pressed={feedback === "up"}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 10v10H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3Zm0 10h9.2a3 3 0 0 0 2.94-2.42l1.1-5.5A2.56 2.56 0 0 0 17.73 9H14l.55-2.74A2.73 2.73 0 0 0 11.87 3L7 10Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setRating("down")}
        className={`${actionClass} ${feedback === "down" ? "bg-[var(--paper-strong)] text-[var(--ink-heading)]" : ""}`}
        title="Not helpful"
        aria-label="Mark response as not helpful"
        aria-pressed={feedback === "down"}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 14V4H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3Zm0-10h9.2a3 3 0 0 1 2.94 2.42l1.1 5.5A2.56 2.56 0 0 1 17.73 15H14l.55 2.74A2.73 2.73 0 0 1 11.87 21L7 14Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={downloadResponse}
        className={actionClass}
        title="Download response"
        aria-label="Download response as Markdown"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
      </button>
      {onRetry ? (
        <button
          type="button"
          onClick={retryResponse}
          className={actionClass}
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6v5h-5M4 18v-5h5m9.7-3A7 7 0 0 0 6.1 7.1L4 11m16 2-2.1 3.9A7 7 0 0 1 5.3 14" />
          </svg>
        </button>
      ) : null}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setEvidenceOpen(false);
            setMenuOpen((current) => !current);
          }}
          className={actionClass}
          title="More actions"
          aria-label="More response actions"
          aria-expanded={menuOpen}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
        {menuOpen ? (
          <div
            aria-label="More response actions menu"
            className="absolute bottom-full left-0 z-20 mb-1 min-w-44 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 text-xs text-[var(--ink)] shadow-lg"
          >
            {verification ? (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setEvidenceOpen(true);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--paper-strong)]"
              >
                View evidence
              </button>
            ) : null}
            <button type="button" onClick={downloadResponse} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--paper-strong)]">
              Download Markdown
            </button>
            <button
              type="button"
              onClick={() => void downloadDictation()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--paper-strong)]"
              title={
                dictationState === "preparing"
                  ? "Cancel the recording"
                  : "Save the spoken reading of this response as an .mp3 file"
              }
            >
              {dictationState === "preparing" ? (
                <svg className="h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-80" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z" />
                </svg>
              ) : null}
              <span>
                {dictationState === "preparing" ? "Preparing dictation…" : "Download dictation"}
              </span>
            </button>
          </div>
        ) : null}
        {evidenceOpen && verification && evidenceBox && typeof document !== "undefined"
          ? createPortal(
              <div ref={evidenceRef} style={evidenceBox.style} className="z-50">
                <EvidencePanel
                  verification={verification}
                  maxHeight={evidenceBox.maxHeight}
                  onClose={() => setEvidenceOpen(false)}
                />
              </div>,
              document.body,
            )
          : null}
      </div>
      {branch ? (
        <AssistantResponseBranchNavigation branch={branch} className="ml-1" />
      ) : null}
    </div>
  );

  if (suppressActions) return null;
  return slot ? createPortal(actions, slot) : actions;
}
