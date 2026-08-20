"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * What a confirmation asks. The heading states the act, `subject` names the one
 * thing it lands on, and `body` says what it costs — kept apart so a long chat
 * title cannot swallow the sentence explaining the consequence, which is what a
 * one-string `window.confirm` does.
 */
export interface ConfirmRequest {
  title: string;
  subject?: string | null;
  body: string;
  /** Secondary note, set apart in an inset panel below the body. */
  detail?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button as destructive. */
  tone?: "danger" | "neutral";
}

interface ConfirmDialogProps extends ConfirmRequest {
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The app's own confirmation sheet: the same material as the rest of the
 * dialogs, in the page's theme, instead of the OS chrome `window.confirm`
 * paints — which in the desktop shell announces itself as "breadboard-desktop",
 * cannot be styled or animated, and blocks the renderer while it is up.
 *
 * Rendered into a portal on `document.body` so it is never clipped or
 * re-anchored by a transformed ancestor; the garden chat tray is itself a
 * fixed, stacked panel.
 */
export function ConfirmDialog({
  title,
  subject,
  body,
  detail,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Cancel takes focus: a destructive dialog should not be confirmable by a
    // stray Enter left over from the keystroke that opened it.
    cancelRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture: the surfaces underneath listen for Escape too, and the dialog
    // owns that key while it is open.
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  // Only ever mounted from a user action, so this never runs during a server
  // render — the guard is for a caller that renders it eagerly.
  if (typeof document === "undefined") return null;

  const destructive = tone === "danger";

  return createPortal(
    <div
      className="bb-modal-backdrop bb-confirm-backdrop fixed inset-0 z-[200] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bb-confirm-title"
        aria-describedby="bb-confirm-body"
        className="bb-modal-panel bb-confirm-panel neu-dialog w-full max-w-[26rem] overflow-hidden rounded-2xl border bg-[var(--paper-raised)] text-[var(--ink)]"
      >
        <div className="p-6 pb-5">
          <div className="flex items-start gap-3.5">
            <span
              className={
                destructive
                  ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_11%,var(--paper-raised))] text-[var(--danger)]"
                  : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line-strong)] bg-[var(--paper-strong)] text-[var(--ink-muted)]"
              }
            >
              <svg
                className="h-[18px] w-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                {destructive ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7m1.9 0-.6 11.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6.1 7M10 11v5m4-5v5"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v4m0 4h.01M10.3 4.7 2.9 17.5A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.5L13.7 4.7a2 2 0 0 0-3.4 0Z"
                  />
                )}
              </svg>
            </span>
            <div className="min-w-0 pt-0.5">
              <h2
                id="bb-confirm-title"
                className="text-lg font-semibold leading-6 text-[var(--ink-heading)]"
              >
                {title}
              </h2>
              {subject ? (
                <p className="mt-2 break-words text-sm font-medium leading-5 text-[var(--ink)]">
                  {subject}
                </p>
              ) : null}
              <p
                id="bb-confirm-body"
                className="mt-2 text-sm leading-6 text-[var(--ink-muted)]"
              >
                {body}
              </p>
            </div>
          </div>

          {detail ? (
            <div className="neu-inset mt-5 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-sm leading-5 text-[var(--ink-muted)]">
              {detail}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--line)] bg-[var(--paper-surface)] px-6 py-4 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--botanical)] focus:ring-offset-2 focus:ring-offset-[var(--paper-surface)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? "neu-button-destructive rounded-lg border border-[var(--danger-hover)] bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[#fffefb] transition hover:bg-[var(--danger-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2 focus:ring-offset-[var(--paper-surface)]"
                : "neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--paper-raised)] focus:outline-none focus:ring-2 focus:ring-[var(--botanical)] focus:ring-offset-2 focus:ring-offset-[var(--paper-surface)]"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * `window.confirm` with the app's own face on it. It answers with a promise so
 * the call sites keep the shape they had:
 *
 *     if (!(await confirm({ title: "Delete this chat?", body: "…" }))) return;
 *
 * Render `confirmDialog` anywhere in the component's tree; it portals itself to
 * the body. A second request while one is open answers the first with `false`,
 * so no caller is left awaiting a promise that never settles.
 */
export function useConfirmDialog(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setRequest(next);
    });
  }, []);

  // An unmount while a question is open is a cancel, not a hung promise.
  useEffect(
    () => () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    },
    [],
  );

  const confirmDialog = useMemo(
    () =>
      request ? (
        <ConfirmDialog
          {...request}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      ) : null,
    [request, settle],
  );

  return { confirm, confirmDialog };
}
