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
    try {
      if (!await sendDesktopTabsCommand(command)) setError("Couldn’t save your site permissions. Try again.");
    } catch { setError("Couldn’t save your site permissions. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 rounded-xl border border-[var(--line)] p-5" aria-labelledby="browser-notifications-title">
    <h2 id="browser-notifications-title" className="text-lg font-semibold">Site permissions</h2>
    <p className="mt-2 text-sm text-[var(--ink-muted)]">Sites ask before using your microphone or camera, or sending notifications. Your choices are saved for each site in this browser profile.</p>
    {!preferences ? <p className="mt-4 text-sm">Open this page in the latest Breadboard desktop app to manage site permissions.</p> : <>
      <h3 className="mt-5 text-sm font-semibold">Microphone and camera</h3>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">Choose Ask again to reset a permission. Reload open pages after changing access. Your operating system must also allow Breadboard to use the device.</p>
      <div className="mt-3 divide-y divide-[var(--line)]">
        {Object.entries(preferences.mediaSites ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([origin, permissions]) => <div key={origin} className="py-3">
          <p className="mb-2 break-all text-sm">{origin}</p>
          {(["microphone", "camera"] as const).map(kind => <label key={kind} className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span>{kind === "microphone" ? "Microphone" : "Camera"}</span>
            <select aria-label={`${kind === "microphone" ? "Microphone" : "Camera"} for ${origin}`} value={permissions[kind] ?? "default"} disabled={busy}
              className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm"
              onChange={event => void save({ type: "browser-media-permission", origin, media: [kind], permission: event.target.value as NotificationPermission })}>
              <option value="default">Ask again</option><option value="granted">Allow</option><option value="denied">Block</option>
            </select>
          </label>)}
        </div>)}
        {!Object.keys(preferences.mediaSites ?? {}).length ? <p className="text-sm text-[var(--ink-muted)]">No microphone or camera permissions saved. Sites will ask when they need access.</p> : null}
      </div>
      <h3 className="mt-6 text-sm font-semibold">Website notifications</h3>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">Allowed sites keep running quietly after you close their tabs so notifications can appear across Breadboard while this window is open. Open a notification to return to the site. Blocking a site or turning notifications off stops its closed background page; reopen the site to start receiving again.</p>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">Web Push uses Mozilla’s push service. Message contents are encrypted in transit and decrypted on this computer.</p>
      <label className="mt-5 flex items-center justify-between gap-4">
        <span>Allow website notifications</span>
        <input type="checkbox" role="switch" className="size-5 accent-[var(--botanical)]" checked={preferences.notificationsEnabled} disabled={busy}
          onChange={event => void save({ type: "browser-notifications-enabled", enabled: event.target.checked })} />
      </label>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">Turning this off pauses website notifications and requests to send them. Your per-site choices are kept.</p>
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
