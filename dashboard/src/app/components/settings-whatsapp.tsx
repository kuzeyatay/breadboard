"use client";

// The WhatsApp link, as a Settings section: pair a phone by QR, choose who may
// talk to it, and see the chats it has opened.
//
// This used to be a dialog behind an icon in the Terminal bar. It lives in
// Settings → Messaging now, next to Telegram, because "which of my messaging
// apps can reach Breadboard" is one question and it deserves one place.
//
// Everything here is a view over `/api/whatsapp`. The QR arrives as a rendered
// image, never as the raw pairing payload, and credentials live in Hermes's
// private data directory — the browser only ever sees status.

import { useCallback, useEffect, useState } from "react";

export type WhatsAppState =
  | "disconnected"
  | "installing"
  | "pairing"
  | "starting"
  | "connected"
  | "error";

export interface WhatsAppChatSummary {
  chatId: string;
  label: string;
  number: string;
  isGroup: boolean;
  messageCount: number;
  lastMessageAt: string;
}

export interface WhatsAppStatus {
  available: boolean;
  unavailableReason: string | null;
  state: WhatsAppState;
  error: string | null;
  paired: boolean;
  mode: "self-chat" | "bot";
  allowedNumbers: string[];
  autostart: boolean;
  linkedNumber: string | null;
  linkedName: string | null;
  linkedAt: string | null;
  managedByAnotherUser: boolean;
  dependenciesInstalled: boolean;
  qrImage: string | null;
  qrAt: string | null;
  log: string[];
  chats: WhatsAppChatSummary[];
}

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 60_000;

const STATE_LABEL: Record<WhatsAppState, string> = {
  disconnected: "Not connected",
  installing: "Installing bridge",
  pairing: "Waiting for scan",
  starting: "Connecting",
  connected: "Connected",
  error: "Needs attention",
};

/**
 * A message, drawn in the same line weight as the rest of Settings.
 *
 * Deliberately not WhatsApp's brand mark: a saturated third-party logo in a
 * settings list reads as an advertisement rather than as part of the app.
 */
export function MessageBubbleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8.25A3.25 3.25 0 0 1 7.25 5h9.5A3.25 3.25 0 0 1 20 8.25v5.5A3.25 3.25 0 0 1 16.75 17H10l-4.5 3.25V17h-.25A1.25 1.25 0 0 1 4 15.75v-7.5Z" />
      <path d="M8.25 9.75h7.5" />
      <path d="M8.25 12.75h4.5" />
    </svg>
  );
}

async function readStatus(): Promise<WhatsAppStatus | null> {
  const response = await fetch("/api/whatsapp", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as { status?: WhatsAppStatus };
  return payload.status ?? null;
}

/**
 * Poll the link status. `active` makes it responsive while the section is on
 * screen; otherwise it ticks slowly, just often enough to keep a header dot
 * honest.
 */
export function useWhatsAppStatus(active: boolean): {
  status: WhatsAppStatus | null;
  refresh: () => Promise<WhatsAppStatus | null>;
} {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);

  const refresh = useCallback(async () => {
    const next = await readStatus().catch(() => null);
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const next = await readStatus().catch(() => null);
      if (!cancelled && next) setStatus(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  return { status, refresh };
}

export function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}

export default function SettingsWhatsApp({
  status,
  refresh,
}: {
  /** Owned by the tab, so its own indicator stays in sync. */
  status: WhatsAppStatus | null;
  refresh: () => Promise<WhatsAppStatus | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowedDraft, setAllowedDraft] = useState<string | null>(null);

  const act = useCallback(
    async (action: string, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch("/api/whatsapp/connection", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload = (await response.json()) as {
          status?: WhatsAppStatus;
          error?: string;
          detail?: string;
        };
        if (!response.ok) {
          setError(payload.detail || payload.error || "That did not work.");
          return;
        }
        await refresh();
      } catch {
        setError("Breadboard could not reach the WhatsApp service.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const saveSettings = useCallback(
    async (patch: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch("/api/whatsapp", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json()) as { error?: string; detail?: string };
        if (!response.ok) {
          setError(payload.detail || payload.error || "That did not work.");
          return;
        }
        setAllowedDraft(null);
        await refresh();
      } catch {
        setError("Breadboard could not reach the WhatsApp service.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const state = status?.state ?? "disconnected";
  const connected = state === "connected";
  const pairing = state === "pairing" || state === "installing";
  const allowedValue = allowedDraft ?? (status?.allowedNumbers ?? []).join(", ");

  if (status === null) {
    return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Checking…</p>;
  }
  if (!status.available) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        {status.unavailableReason ?? "WhatsApp is not available in this build."}
      </p>
    );
  }
  if (status.managedByAnotherUser) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        WhatsApp is linked to a different Breadboard account on this machine.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            connected
              ? "border-[rgba(79,128,94,0.45)] text-[#315c40]"
              : state === "error"
                ? "border-[color-mix(in_srgb,var(--danger)_40%,var(--line))] text-[var(--danger)]"
                : "border-[var(--line)] text-[var(--ink-muted)]"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              connected
                ? "bg-[#4F805E]"
                : state === "error"
                  ? "bg-[var(--danger)]"
                  : "bg-[var(--ink-muted)]"
            }`}
          />
          {STATE_LABEL[state]}
        </span>
        {status.linkedNumber ? (
          <span className="text-xs text-[var(--ink-muted)]">
            Linked to +{status.linkedNumber}
            {status.linkedName ? ` (${status.linkedName})` : ""}
          </span>
        ) : null}
      </div>

      {error || status.error ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--danger)]">
          {error ?? status.error}
        </p>
      ) : null}

      {pairing ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-5">
          {status.qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- server-rendered data URL, no loader needed
            <img
              src={status.qrImage}
              alt="WhatsApp pairing QR code"
              width={260}
              height={260}
              className="rounded-lg bg-white p-2"
            />
          ) : (
            <p className="py-16 text-sm text-[var(--ink-muted)]">
              {state === "installing"
                ? "Installing the WhatsApp bridge — this happens once and takes a minute."
                : "Generating a QR code…"}
            </p>
          )}
          <ol className="space-y-1 text-center text-xs text-[var(--ink-muted)]">
            <li>1. Open WhatsApp on your phone</li>
            <li>2. Settings → Linked devices → Link a device</li>
            <li>3. Scan this code</li>
          </ol>
          <button
            type="button"
            onClick={() => void act("cancel-pair", "cancel")}
            disabled={busy !== null}
            className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!status.paired ? (
            <button
              type="button"
              onClick={() => void act("pair", "pair")}
              disabled={busy !== null}
              className="neu-button-accent inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              <MessageBubbleIcon className="h-4 w-4" />
              {busy === "pair" ? "Starting…" : "Link with QR code"}
            </button>
          ) : connected ? (
            <button
              type="button"
              onClick={() => void act("disconnect", "disconnect")}
              disabled={busy !== null}
              className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {busy === "disconnect" ? "Stopping…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void act("connect", "connect")}
              disabled={busy !== null}
              className="neu-button-accent rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          )}
          {status.paired ? (
            <button
              type="button"
              onClick={() => void act("unlink", "unlink")}
              disabled={busy !== null}
              className="neu-button rounded-lg border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] px-3 py-2 text-sm text-[var(--danger)] disabled:opacity-60"
              title="Remove the linked device and delete its credentials"
            >
              {busy === "unlink" ? "Removing…" : "Unlink device"}
            </button>
          ) : null}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
        <div>
          <p className="text-sm font-medium text-[var(--ink-heading)]">Who can talk to it</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Self-chat uses your own number: message yourself and Breadboard answers.
            Bot mode uses a second number that other people message.
          </p>
        </div>
        <div className="neu-segmented inline-flex rounded-xl p-1" role="group">
          {(["self-chat", "bot"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void saveSettings({ mode }, "mode")}
              disabled={busy !== null || status.mode === mode}
              aria-pressed={status.mode === mode}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                status.mode === mode
                  ? "text-[var(--ink-heading)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {mode === "self-chat" ? "Personal self-chat" : "Separate bot number"}
            </button>
          ))}
        </div>
        {status.mode === "bot" ? (
          <div className="space-y-2">
            <label
              htmlFor="whatsapp-allowed"
              className="block text-xs font-medium text-[var(--ink-muted)]"
            >
              Allowed numbers — country code, no “+”. Use * to allow everyone.
            </label>
            <div className="flex gap-2">
              <input
                id="whatsapp-allowed"
                value={allowedValue}
                onChange={(event) => setAllowedDraft(event.target.value)}
                placeholder="31612345678, 15551234567"
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
              />
              <button
                type="button"
                onClick={() => void saveSettings({ allowedNumbers: allowedValue }, "allowed")}
                disabled={busy !== null || allowedDraft === null}
                className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-60"
              >
                {busy === "allowed" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <input
            type="checkbox"
            checked={status.autostart}
            onChange={(event) => void saveSettings({ autostart: event.target.checked }, "autostart")}
            disabled={busy !== null}
          />
          Reconnect automatically when Breadboard starts
        </label>
      </div>

      {status.chats.length > 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--ink-heading)]">Chats opened from WhatsApp</p>
          <ul className="mt-2 space-y-1">
            {status.chats.slice(0, 8).map((chat) => (
              <li
                key={chat.chatId}
                className="flex items-center justify-between gap-3 text-xs text-[var(--ink-muted)]"
              >
                <span className="truncate">
                  {chat.label}
                  {chat.isGroup ? " (group)" : ""}
                </span>
                <span className="shrink-0">
                  {chat.messageCount} · {formatWhen(chat.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
            They appear in the Terminal&apos;s Recents, where you can keep replying by hand.
          </p>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
        This uses WhatsApp&apos;s linked-device protocol through the Hermes bridge, which is
        not an official WhatsApp integration. Keep usage conversational, don&apos;t send bulk
        messages, and prefer a dedicated number for bot mode — accounts using third-party
        bridges can be restricted.
      </p>
    </div>
  );
}
