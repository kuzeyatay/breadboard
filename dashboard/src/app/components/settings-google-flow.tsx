"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Video, X } from "lucide-react";
import { invalidateCommandResponseCache } from "@/lib/hermes/command-client-cache";
import { invalidateSettingsCache } from "@/lib/settings-client-cache";
import styles from "./hermes/bambu-print-card.module.css";

const endpoint = "/api/hermes/connections/google-flow";
type Connection = {
  installed: boolean;
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  accountLabel: string | null;
  background: boolean;
};

export default function GoogleFlowConnectionEntry() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const read = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not read the Google Flow connection.");
      setConnection(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the Google Flow connection.");
    }
  }, []);

  useEffect(() => { void read(); }, [read]);

  async function act(action: "connect" | "refresh" | "disable") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Google Flow could not complete this step.");
      setConnection(body);
      setMessage(body.connected
        ? "Connected. Use /veo in chat to create a video."
        : action === "disable" ? "Connection disabled. You are still signed in to Google."
        : "Sign in to Google in Breadboard's browser, then connect here.");
      invalidateCommandResponseCache();
      invalidateSettingsCache();
      window.dispatchEvent(new Event("breadboard:connections:changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google Flow could not complete this step.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); if (value) void read(); }}>
    <li className="neu-card flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
      <span aria-hidden className="neu-button-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--ink)]"><Video size={23} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">Google Flow · Veo</span>
        <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">{connection?.connected ? `Connected${connection.accountLabel ? ` · ${connection.accountLabel}` : ""}` : "Subscription video · no API key"}</span>
      </span>
      <Dialog.Trigger className="neu-button shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)]" aria-label="Set up Google Flow Veo">
        {connection?.connected ? "Manage" : "Connect"}
      </Dialog.Trigger>
    </li>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <div>
            <Dialog.Title>Google Flow · Veo</Dialog.Title>
            <Dialog.Description className={styles.muted}>Create videos using your Google subscription and available Flow credits.</Dialog.Description>
          </div>
          <Dialog.Close className={styles.button} aria-label="Close Google Flow setup"><X size={15} /></Dialog.Close>
        </div>
        <div className="space-y-4 text-sm">
          {!connection?.connected && <>
            <p>Sign in to Google in Breadboard’s browser, then connect here. No API key is needed.</p>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void act("connect")}>Connect in background</button>
          </>}
          {connection?.connected && <p>Connected{connection.accountLabel ? ` as ${connection.accountLabel}` : ""}. Use <strong>/veo</strong> followed by your video prompt. Available models and credit limits come from your Flow account.</p>}
          <div className="flex gap-2">
            <button type="button" className={styles.button} disabled={busy} onClick={() => void act("refresh")}>Check connection</button>
            {connection?.enabled && <button type="button" className={styles.button} disabled={busy} onClick={() => void act("disable")}>Disable connection</button>}
          </div>
          {message && <p role="status" className={styles.notice}>{message}</p>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
