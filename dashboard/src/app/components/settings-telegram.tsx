"use client";

// The Telegram link, as a Settings section: paste a bot token from BotFather,
// say who may talk to it, and see the chats it has opened.
//
// Everything here is a view over `/api/telegram`. The token is written straight
// to disk on the server and never comes back — the browser learns only that a
// token exists and which bot it resolved to, so a status poll is never worth
// stealing.

import { useCallback, useEffect, useState } from "react";

import { formatWhen } from "./settings-whatsapp";

export type TelegramState = "disconnected" | "starting" | "connected" | "error";

export interface TelegramChatSummary {
  chatId: string;
  label: string;
  handle: string;
  isGroup: boolean;
  messageCount: number;
  lastMessageAt: string;
}

export interface TelegramBlockedSender {
  senderId: string;
  username: string;
  name: string;
  attempts: number;
  lastAt: string;
}

export interface TelegramStatus {
  available: boolean;
  unavailableReason: string | null;
  state: TelegramState;
  error: string | null;
  linked: boolean;
  tokenFromEnvironment: boolean;
  botUsername: string | null;
  botName: string | null;
  linkedAt: string | null;
  allowedUsers: string[];
  autostart: boolean;
  managedByAnotherUser: boolean;
  blocked: TelegramBlockedSender[];
  chats: TelegramChatSummary[];
}

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 60_000;

const STATE_LABEL: Record<TelegramState, string> = {
  disconnected: "Not connected",
  starting: "Connecting",
  connected: "Connected",
  error: "Needs attention",
};

/**
 * A paper plane in the same line weight as the rest of Settings — the shape
 * everyone reads as Telegram, without importing Telegram's saturated brand disc
 * into a quiet settings list.
 */
export function PaperPlaneIcon({ className = "h-4 w-4" }: { className?: string }) {
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
      <path d="M20.5 4.2 3.8 10.6c-.7.27-.66 1.28.05 1.5l4.4 1.35 1.6 4.9c.22.68 1.12.8 1.5.19l2.2-3.45 4.2 3.1c.5.36 1.2.09 1.33-.5l2.4-12.6c.13-.66-.5-1.2-1.1-.94Z" />
      <path d="M8.25 13.45 19.4 5.9l-8.1 9.1" />
    </svg>
  );
}

async function readStatus(): Promise<TelegramStatus | null> {
  const response = await fetch("/api/telegram", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as { status?: TelegramStatus };
  return payload.status ?? null;
}

/** Poll the link status; fast while the section is on screen, slow otherwise. */
export function useTelegramStatus(active: boolean): {
  status: TelegramStatus | null;
  refresh: () => Promise<TelegramStatus | null>;
} {
  const [status, setStatus] = useState<TelegramStatus | null>(null);

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

export default function SettingsTelegram({
  status,
  refresh,
}: {
  status: TelegramStatus | null;
  refresh: () => Promise<TelegramStatus | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [allowedDraft, setAllowedDraft] = useState<string | null>(null);

  const act = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch("/api/telegram/connection", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { error?: string; detail?: string };
        if (!response.ok) {
          setError(payload.detail || payload.error || "That did not work.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("Breadboard could not reach the Telegram service.");
        return false;
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
        const response = await fetch("/api/telegram", {
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
        setError("Breadboard could not reach the Telegram service.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const state = status?.state ?? "disconnected";
  const connected = state === "connected";
  const allowedValue = allowedDraft ?? (status?.allowedUsers ?? []).join(", ");

  if (status === null) {
    return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Checking…</p>;
  }
  if (!status.available) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        {status.unavailableReason ?? "Telegram is not available in this build."}
      </p>
    );
  }
  if (status.managedByAnotherUser) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        Telegram is linked to a different Breadboard account on this machine.
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
        {status.botUsername ? (
          <span className="text-xs text-[var(--ink-muted)]">
            Linked to @{status.botUsername}
            {status.botName ? ` (${status.botName})` : ""}
          </span>
        ) : null}
      </div>

      {error || status.error ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--danger)]">
          {error ?? status.error}
        </p>
      ) : null}

      {!status.linked ? (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
          <div>
            <p className="text-sm font-medium text-[var(--ink-heading)]">Create a bot, once</p>
            <ol className="mt-1.5 space-y-1 text-xs text-[var(--ink-muted)]">
              <li>1. Open Telegram and message @BotFather</li>
              <li>2. Send /newbot and pick a name and a @username</li>
              <li>3. Paste the token it gives you here</li>
            </ol>
          </div>
          <div className="flex gap-2">
            <input
              id="telegram-token"
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="1234567890:AA…"
              aria-label="Telegram bot token"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 font-mono text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
            />
            <button
              type="button"
              onClick={() => {
                void act({ action: "link", token: tokenDraft }, "link").then((ok) => {
                  if (ok) setTokenDraft("");
                });
              }}
              disabled={busy !== null || tokenDraft.trim().length === 0}
              className="neu-button-accent inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              <PaperPlaneIcon className="h-4 w-4" />
              {busy === "link" ? "Checking…" : "Link bot"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--ink-muted)]">
            The token stays on this machine, in Breadboard&apos;s private data directory. It is
            never sent back to the browser.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <button
              type="button"
              onClick={() => void act({ action: "disconnect" }, "disconnect")}
              disabled={busy !== null}
              className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {busy === "disconnect" ? "Stopping…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void act({ action: "connect" }, "connect")}
              disabled={busy !== null}
              className="neu-button-accent rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          )}
          {status.botUsername ? (
            <a
              href={`https://t.me/${status.botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="neu-button inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
            >
              <PaperPlaneIcon className="h-4 w-4" />
              Open the chat
            </a>
          ) : null}
          {status.tokenFromEnvironment ? (
            <span className="self-center text-[11px] text-[var(--ink-muted)]">
              The token comes from this installation&apos;s environment.
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void act({ action: "unlink" }, "unlink")}
              disabled={busy !== null}
              className="neu-button rounded-lg border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] px-3 py-2 text-sm text-[var(--danger)] disabled:opacity-60"
              title="Disconnect and delete the stored bot token"
            >
              {busy === "unlink" ? "Removing…" : "Remove bot"}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
        <div>
          <p className="text-sm font-medium text-[var(--ink-heading)]">Who can talk to it</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Anyone can find a bot by its @name, so nobody is answered until you list them
            here. Use your own @username, or * to answer everyone.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            id="telegram-allowed"
            value={allowedValue}
            onChange={(event) => setAllowedDraft(event.target.value)}
            placeholder="@username, 123456789"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
          />
          <button
            type="button"
            onClick={() => void saveSettings({ allowedUsers: allowedValue }, "allowed")}
            disabled={busy !== null || allowedDraft === null}
            className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-60"
          >
            {busy === "allowed" ? "Saving…" : "Save"}
          </button>
        </div>

        {status.blocked.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--ink-muted)]">
              Messaged the bot and got no answer
            </p>
            {status.blocked.map((sender) => (
              <div
                key={sender.senderId}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2"
              >
                <span className="min-w-0 truncate text-xs text-[var(--ink)]">
                  {sender.name}
                  {sender.username ? (
                    <span className="text-[var(--ink-muted)]"> · @{sender.username}</span>
                  ) : null}
                  <span className="text-[var(--ink-muted)]">
                    {" "}
                    · {sender.attempts} {sender.attempts === 1 ? "message" : "messages"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void act(
                      { action: "allow", senderId: sender.username || sender.senderId },
                      `allow-${sender.senderId}`,
                    )
                  }
                  disabled={busy !== null}
                  className="neu-button shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-60"
                >
                  {busy === `allow-${sender.senderId}` ? "Allowing…" : "Allow"}
                </button>
              </div>
            ))}
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
          <p className="text-sm font-medium text-[var(--ink-heading)]">Chats opened from Telegram</p>
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
        This is Telegram&apos;s official Bot API, so the bot only ever sees what is sent to it.
        In groups it reads nothing unless you turn off BotFather&apos;s privacy mode or make it
        an admin. Send /help to it for the commands, or /new to start a fresh chat.
      </p>
    </div>
  );
}
