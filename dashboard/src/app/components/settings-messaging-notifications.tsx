"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessagingNotificationSettings, NotificationChannel } from "@/lib/messaging-notifications/types";

export default function SettingsMessagingNotifications({ channel, connected }: { channel: NotificationChannel; connected: boolean }) {
  const label = channel === "whatsapp" ? "WhatsApp" : "Telegram";
  const [settings, setSettings] = useState<MessagingNotificationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const version = generation.current;
    try {
      const response = await fetch(`/api/messaging-notifications?channel=${channel}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.settings) throw new Error("Couldn’t load notification settings.");
      if (mounted.current && !saving.current && version === generation.current) {
        setSettings(payload.settings);
        setError(null);
      }
    } catch {
      if (mounted.current && !saving.current && version === generation.current) setError("Couldn’t load notification settings.");
    }
  }, [channel]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  async function save(enabled: boolean, recipient: string) {
    if (saving.current) return;
    saving.current = true;
    generation.current++;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/messaging-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, enabled, recipient }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.settings) throw new Error(payload.error || "Couldn’t save notification settings.");
      if (mounted.current) setSettings(payload.settings);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Couldn’t save notification settings.");
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const recipient = settings?.recipient || (settings?.recipients.length === 1 ? settings.recipients[0].id : "");
  const canEnable = settings?.available && settings.recipients.some(item => item.id === recipient);
  const descriptionId = `${channel}-notification-description`;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4" aria-label={`${label} notifications`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor={`${channel}-notification-switch`} className="text-sm font-medium text-[var(--ink-heading)]">
            Send notifications via {label}
          </label>
          <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">
            Get Breadboard questions, response alerts and Learn updates in your private chat.
          </p>
        </div>
        <button
          id={`${channel}-notification-switch`}
          type="button"
          role="switch"
          aria-checked={settings?.enabled ?? false}
          aria-describedby={descriptionId}
          aria-label={`Send notifications via ${label}`}
          disabled={busy || !settings || (!settings.enabled && !canEnable)}
          onClick={() => void save(!settings?.enabled, recipient)}
          className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-50 ${settings?.enabled ? "border-[var(--botanical)] bg-[var(--botanical)]" : "border-[var(--line-strong)] bg-[var(--line)]"}`}
        >
          <span className={`pointer-events-none h-4 w-4 rounded-full bg-white shadow-sm ${settings?.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {settings && settings.recipients.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor={`${channel}-notification-recipient`} className="text-xs text-[var(--ink-muted)]">Send to</label>
          <select
            id={`${channel}-notification-recipient`}
            value={recipient}
            disabled={busy}
            onChange={event => void save(settings.enabled, event.target.value)}
            className="block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]"
          >
            <option value="" disabled>Choose your private chat</option>
            {recipient && !settings.recipients.some(item => item.id === recipient) ? <option value={recipient} disabled>Previous chat unavailable</option> : null}
            {settings.recipients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      ) : settings ? (
        <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
          {channel === "telegram" ? "Link your bot below, allow your Telegram account, then message the bot to choose your chat here." : "Link your WhatsApp below to send notifications to your own number."}
        </p>
      ) : <p className="text-xs text-[var(--ink-muted)]">Loading notification settings…</p>}

      {settings?.enabled ? <p className="text-xs text-[var(--ink-muted)]">
        {connected ? "New notifications are sent while Breadboard is running. Older notifications won’t be resent." : "Delivery is paused until you connect below. Keep Breadboard running to receive notifications."}
      </p> : null}
      {busy ? <p role="status" className="text-xs text-[var(--ink-muted)]">Saving…</p> : null}
      {error || settings?.lastError ? <p role="alert" className="text-xs text-[var(--danger)]">
        {error || settings?.lastError}
        {error && !settings ? <button type="button" onClick={() => void refresh()} className="ml-2 underline">Retry</button> : null}
      </p> : null}
    </section>
  );
}
