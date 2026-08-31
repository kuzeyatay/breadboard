"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import BreadboardLoader from "@/app/components/breadboard-loader";
import type { HermesSurface } from "@/lib/hermes/config.ts";

const SIGN_IN_REQUIRED_EVENT = "breadboard:sign-in-required";
const SIGN_IN_DISMISSED_EVENT = "breadboard:sign-in-dismissed";

export interface SignInStartResult {
  browserName?: string | null;
}

/**
 * A user-controlled sign-in handoff. The callbacks deliberately live only in
 * renderer memory: credentials stay in the browser window and never become an
 * event payload, request body, chat message, or durable artifact.
 */
export interface SignInRequest {
  id: string;
  surface: HermesSurface;
  sessionId?: string | number | null;
  url: string;
  serviceName?: string;
  browserName?: string | null;
  startSignIn: () => Promise<SignInStartResult | void>;
  finishSignIn?: () => Promise<void>;
  retry?: () => void;
}

const pendingRequests = new Map<string, SignInRequest>();

function requestMatches(
  request: SignInRequest,
  surface: HermesSurface,
  sessionId: string | number | null | undefined,
): boolean {
  if (request.surface !== surface) return false;
  if (request.sessionId == null) return true;
  if (sessionId == null) return false;
  return String(request.sessionId) === String(sessionId);
}

/** Publish (or refresh) the sign-in card that belongs to an active composer. */
export function showSignInRequest(request: SignInRequest): void {
  if (typeof window === "undefined") return;
  pendingRequests.set(request.id, request);
  window.dispatchEvent(
    new CustomEvent<SignInRequest>(SIGN_IN_REQUIRED_EVENT, { detail: request }),
  );
}

export function dismissSignInRequest(id: string): void {
  if (typeof window === "undefined") return;
  pendingRequests.delete(id);
  window.dispatchEvent(
    new CustomEvent<{ id: string }>(SIGN_IN_DISMISSED_EVENT, {
      detail: { id },
    }),
  );
}

function latestMatchingRequest(
  surface: HermesSurface,
  sessionId: string | number | null | undefined,
): SignInRequest | null {
  return (
    [...pendingRequests.values()]
      .reverse()
      .find((candidate) => requestMatches(candidate, surface, sessionId)) ?? null
  );
}

function displaySite(request: SignInRequest): {
  name: string;
  origin: string;
  initial: string;
} {
  try {
    const parsed = new URL(request.url);
    const host = parsed.hostname.replace(/^www\./iu, "");
    const name = request.serviceName?.trim() || host;
    return {
      name,
      origin: parsed.origin,
      initial: (host[0] || "S").toUpperCase(),
    };
  } catch {
    const name = request.serviceName?.trim() || "this site";
    return { name, origin: request.url, initial: name[0]?.toUpperCase() || "S" };
  }
}

type Phase = "idle" | "opening" | "open" | "finishing" | "error";

export default function SignInRequiredCard({
  surface,
  sessionId,
}: {
  surface: HermesSurface;
  sessionId?: string | number | null;
}) {
  const [request, setRequest] = useState<SignInRequest | null>(() =>
    latestMatchingRequest(surface, sessionId),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [browserName, setBrowserName] = useState<string | null>(
    request?.browserName ?? null,
  );
  const [visible, setVisible] = useState(Boolean(request));
  const requestIdRef = useRef<string | null>(request?.id ?? null);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<SignInRequest>).detail;
      if (!detail || !requestMatches(detail, surface, sessionId)) return;
      const isNew = requestIdRef.current !== detail.id;
      requestIdRef.current = detail.id;
      setRequest(detail);
      setBrowserName((current) => detail.browserName ?? current);
      if (isNew) {
        setPhase("idle");
        setError("");
        setVisible(false);
        requestAnimationFrame(() => setVisible(true));
      }
    };
    const dismiss = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (!detail || requestIdRef.current !== detail.id) return;
      requestIdRef.current = null;
      setVisible(false);
      window.setTimeout(() => {
        setRequest(null);
        setPhase("idle");
        setError("");
      }, 180);
    };
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, receive);
    window.addEventListener(SIGN_IN_DISMISSED_EVENT, dismiss);
    return () => {
      window.removeEventListener(SIGN_IN_REQUIRED_EVENT, receive);
      window.removeEventListener(SIGN_IN_DISMISSED_EVENT, dismiss);
    };
  }, [sessionId, surface]);

  const site = useMemo(
    () => (request ? displaySite(request) : null),
    [request],
  );

  if (!request || !site) return null;

  const browser = browserName || request.browserName || "your browser";
  const busy = phase === "opening" || phase === "finishing";

  async function beginSignIn() {
    setPhase("opening");
    setError("");
    try {
      const result = await request!.startSignIn();
      if (result?.browserName) setBrowserName(result.browserName);
      setPhase("open");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : "Breadboard could not open the sign-in window.",
      );
      setPhase("error");
    }
  }

  async function finishSignIn(retry: boolean) {
    setPhase("finishing");
    setError("");
    try {
      await request!.finishSignIn?.();
      const retryTask = retry ? request!.retry : undefined;
      dismissSignInRequest(request!.id);
      retryTask?.();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : "Breadboard could not finish the sign-in handoff.",
      );
      setPhase("error");
    }
  }

  async function cancel() {
    if (phase === "open" && request!.finishSignIn) {
      setPhase("finishing");
      try {
        await request!.finishSignIn();
      } catch {
        // Dismissing must remain possible even when a window was closed by hand.
      }
    }
    dismissSignInRequest(request!.id);
  }

  return (
    <section
      aria-labelledby={`${request.id}-title`}
      aria-live="polite"
      className={`bb-sign-in-card mb-2 overflow-hidden rounded-[24px] border border-[color-mix(in_srgb,var(--line-strong)_70%,transparent)] bg-[color-mix(in_srgb,var(--paper-raised)_88%,transparent)] text-[var(--ink)] shadow-[0_16px_44px_color-mix(in_srgb,var(--ink)_14%,transparent),inset_0_1px_0_color-mix(in_srgb,white_65%,transparent)] backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transform-none motion-reduce:transition-opacity ${
        visible
          ? "translate-y-0 scale-100 opacity-100 blur-0"
          : "translate-y-2 scale-[0.985] opacity-0 blur-[2px]"
      }`}
    >
      <div className="flex gap-3.5 px-4 pb-3 pt-4 sm:px-5">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] border border-[var(--line)] bg-[var(--paper-surface)] text-lg font-semibold text-[var(--botanical)] shadow-[var(--neu-soft-shadow)]">
          {site.initial}
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink-muted)]">
            <svg
              aria-hidden
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path strokeLinecap="round" d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
            </svg>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h2
            id={`${request.id}-title`}
            className="text-[15px] font-semibold leading-5 tracking-[-0.01em] text-[var(--ink-heading)]"
          >
            {phase === "open" || phase === "finishing"
              ? `Finish signing in to ${site.name}`
              : "Sign in to continue"}
          </h2>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]">
            <svg
              aria-hidden
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
            >
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path strokeLinecap="round" d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
            </svg>
            <span className="truncate">{site.origin}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
            {phase === "open" || phase === "finishing"
              ? `Complete the sign-in in ${browser}, then return here. The saved browser session will be available to future tasks.`
              : `Breadboard reached a page that needs your account. Enter your details only in ${browser}; this card never receives what you type.`}
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-4 mb-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_28%,var(--line))] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--danger)] sm:mx-5"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--line)_72%,transparent)] bg-[color-mix(in_srgb,var(--paper-surface)_48%,transparent)] px-4 py-3 sm:px-5">
        <p className="max-w-[32rem] text-[11px] leading-4 text-[var(--ink-muted)]">
          Only sign in where you are comfortable letting the browser agent act.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={busy}
            className="rounded-full px-3 py-2 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:bg-[var(--paper-surface)] disabled:opacity-45"
          >
            Cancel
          </button>
          {phase === "open" || phase === "finishing" ? (
            <button
              type="button"
              onClick={() => void finishSignIn(Boolean(request.retry))}
              disabled={busy}
              className="neu-button-accent inline-flex min-w-28 items-center justify-center gap-2 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-4 py-2 text-xs font-semibold text-[var(--paper-raised)] transition-[transform,background-color,opacity] hover:bg-[var(--botanical-hover)] active:scale-[0.97] disabled:cursor-wait disabled:opacity-55"
            >
              {phase === "finishing" ? (
                <BreadboardLoader className="h-3.5 w-3.5" />
              ) : null}
              {request.retry ? "Done and retry" : "Done"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void beginSignIn()}
              disabled={busy}
              className="neu-button-accent inline-flex min-w-36 items-center justify-center gap-2 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-4 py-2 text-xs font-semibold text-[var(--paper-raised)] transition-[transform,background-color,opacity] hover:bg-[var(--botanical-hover)] active:scale-[0.97] disabled:cursor-wait disabled:opacity-55"
            >
              {phase === "opening" ? (
                <BreadboardLoader className="h-3.5 w-3.5" />
              ) : null}
              {phase === "error" ? "Try again" : `Continue in ${browser}`}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        @media (prefers-reduced-transparency: reduce) {
          .bb-sign-in-card {
            background: var(--paper-raised);
            backdrop-filter: none;
          }
        }

        @media (prefers-contrast: more) {
          .bb-sign-in-card {
            border-color: var(--ink-muted);
            background: var(--paper-raised);
          }
        }
      `}</style>
    </section>
  );
}
