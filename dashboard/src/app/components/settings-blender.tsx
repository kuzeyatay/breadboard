"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Box, X } from "lucide-react";
import { invalidateCommandResponseCache } from "@/lib/hermes/command-client-cache";
import { invalidateSettingsCache } from "@/lib/settings-client-cache";
import styles from "./hermes/bambu-print-card.module.css";

const endpoint = "/api/hermes/connections/blender";
type Connection = {
  installed: boolean;
  configured: boolean;
  enabled: boolean;
  connected?: boolean;
  addonPath: string;
  setupCommand: string;
};

export default function BlenderConnectionEntry() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const read = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not read the Blender connection.");
      setConnection(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the Blender connection.");
    }
  }, []);
  useEffect(() => { void read(); }, [read]);

  async function act(action: "connect" | "refresh" | "disable") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Blender could not complete this step.");
      setConnection(body);
      setMessage(body.connected ? "Blender responded. Use /blender in chat to work on your scene."
        : action === "disable" ? "Connection disabled. Blender remains open."
        : "Open Blender and connect to start working on a scene.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blender could not complete this step.");
      await read();
    } finally {
      invalidateCommandResponseCache();
      invalidateSettingsCache();
      window.dispatchEvent(new Event("breadboard:connections:changed"));
      setBusy(false);
    }
  }

  return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); if (value && !busy) void read(); }}>
    <li className="neu-card flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
      <span aria-hidden className="neu-button-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--ink)]"><Box size={23} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">Blender</span>
        <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">{connection?.connected ? "Connected to Blender" : connection?.enabled ? "Enabled · local 3D modeling" : "Local 3D modeling and rendering"}</span>
      </span>
      <Dialog.Trigger className="neu-button shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)]" aria-label="Set up Blender">
        {connection?.enabled ? "Manage" : "Connect"}
      </Dialog.Trigger>
    </li>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <div>
            <Dialog.Title>Blender</Dialog.Title>
            <Dialog.Description className={styles.muted}>Create and edit scenes in Blender on this computer.</Dialog.Description>
          </div>
          <Dialog.Close className={styles.button} aria-label="Close Blender setup"><X size={15} /></Dialog.Close>
        </div>
        <div className="space-y-4 text-sm" aria-busy={busy}>
          <p>Install Blender and keep it open. Enable the <strong>MCP for Blender</strong> add-on, then start its server from the viewport sidebar (<strong>N</strong>).</p>
          {connection && !connection.installed && <>
            <p>Install <a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noreferrer" className="underline">uv</a>, then run this setup command in PowerShell:</p>
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--line)] p-3 text-xs">{connection.setupCommand}</pre>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void read()}>Check installation</button>
          </>}
          {connection?.installed && <>
            <p>In Blender’s Preferences → Add-ons → Install from Disk, choose this file and enable it:</p>
            <p className="break-all text-xs text-[var(--ink-muted)]">{connection.addonPath}</p>
            <p>Connect to let Breadboard inspect and edit the open scene. Use <strong>/blender</strong> in chat. Telemetry is disabled.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={styles.primary} disabled={busy} onClick={() => void act("connect")}>{connection.enabled ? "Reconnect" : "Connect Blender"}</button>
              {connection.enabled && <button type="button" className={styles.button} disabled={busy} onClick={() => void act("refresh")}>Check connection</button>}
            </div>
          </>}
          {connection?.enabled && <button type="button" className={styles.button} disabled={busy} onClick={() => void act("disable")}>Disable connection</button>}
          {message && <p role="status" className={styles.notice}>{message}</p>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
