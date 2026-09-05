"use client";

import { useState } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";

export default function BrowserNotificationSettings() {
  const tabs = useDesktopTabs();
  const preferences = tabs?.browserPreferences;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(command: DesktopTabsCommand) {
    setBusy(true); setError("");
    if (!await sendDesktopTabsCommand(command)) setError("Couldn’t save your notification settings. Try again.");
    setBusy(false);
  }
  return <section className="mt-8 rounded-xl border border-[var(--line)] p-5" aria-labelledby="browser-notifications-title">
    <h2 id="browser-notifications-title" className="text-lg font-semibold">Website notifications</h2>
    <p className="mt-2 text-sm text-[var(--ink-muted)]">Sites ask before sending notifications. Page notifications appear alongside Breadboard’s other notifications. Permissions apply to this browser profile.</p>
    {!preferences ? <p className="mt-4 text-sm">Open this page in the latest Breadboard desktop app to manage website notifications.</p> : <>
      <label className="mt-5 flex items-center justify-between gap-4">
        <span>Allow website notifications</span>
        <input type="checkbox" role="switch" className="size-5 accent-[var(--botanical)]" checked={preferences.notificationsEnabled} disabled={busy}
          onChange={event => void save({ type: "browser-notifications-enabled", enabled: event.target.checked })} />
      </label>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">Turning this off pauses all website notifications and permission requests. Your per-site choices are kept.</p>
      <div className="mt-5 divide-y divide-[var(--line)]">
        {Object.entries(preferences.sites).sort(([a], [b]) => a.localeCompare(b)).map(([origin, permission]) => <div key={origin} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 break-all text-sm">{origin}</span>
          <select aria-label={`Notifications for ${origin}`} value={permission} disabled={busy} className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm"
            onChange={event => void save({ type: "browser-notification-permission", origin, permission: event.target.value as "default" | "granted" | "denied" })}>
            <option value="granted">Allow</option><option value="denied">Block</option><option value="default">Ask again</option>
          </select>
        </div>)}
        {!Object.keys(preferences.sites).length ? <p className="text-sm text-[var(--ink-muted)]">No site permissions yet.</p> : null}
      </div>
    </>}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
  </section>;
}
