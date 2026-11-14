"use client";

import { useState } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";

type Permission = "default" | "granted" | "denied";
const CHOICES: Array<[Permission, string]> = [["granted", "Allow"], ["denied", "Block"], ["default", "Ask again"]];
const SUBHEADING = "text-xs font-semibold uppercase tracking-wide text-gray-600";

function PermissionChoice({ label, value, disabled, onChange }: { label: string; value: Permission; disabled: boolean; onChange: (value: Permission) => void }) {
  return <div className="neu-segmented inline-flex shrink-0 gap-0.5 rounded-xl p-1" role="group" aria-label={label}>
    {CHOICES.map(([choice, name]) => <button key={choice} type="button" disabled={disabled} aria-pressed={value === choice} onClick={() => { if (value !== choice) onChange(choice); }}
      className={`rounded-lg px-2.5 py-1 text-xs disabled:opacity-50 ${value === choice ? "bg-[var(--paper-raised)] font-medium text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>{name}</button>)}
  </div>;
}

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
  return <section className="neu-surface-raised min-w-0 rounded-2xl border border-gray-800 p-5" aria-labelledby="browser-notifications-title">
    <h2 id="browser-notifications-title" className="text-sm font-semibold text-white">Site permissions</h2>
    <p className="mt-0.5 text-xs leading-5 text-gray-500">Sites ask before using your microphone, camera or location, or sending notifications. Your choices are saved for each site in this browser profile.</p>
    {!preferences ? <p className="mt-4 text-sm text-gray-500">Open this page in the latest Breadboard desktop app to manage site permissions.</p> : <>
      <h3 className={`mt-5 ${SUBHEADING}`}>Microphone, camera and location</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500">Choose Ask again to reset a permission. Reload open pages after changing access. Your operating system must also allow Breadboard to use the device.</p>
      <div className="mt-2 divide-y divide-[var(--line)]">
        {Object.entries(preferences.mediaSites ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([origin, permissions]) => <div key={origin} className="py-3">
          <p className="break-all text-sm font-medium text-white">{origin}</p>
          {(["microphone", "camera", "location"] as const).filter(kind => kind === "microphone" || kind === "camera" || permissions[kind]).map(kind => {
            const name = { microphone: "Microphone", camera: "Camera", location: "Location" }[kind];
            return <div key={kind} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>{name}</span>
              <PermissionChoice label={`${name} for ${origin}`} value={permissions[kind] ?? "default"} disabled={busy}
                onChange={permission => void save({ type: "browser-media-permission", origin, media: [kind], permission })} />
            </div>;
          })}
        </div>)}
        {!Object.keys(preferences.mediaSites ?? {}).length ? <p className="py-3 text-xs text-gray-500">No microphone, camera or location permissions saved. Sites will ask when they need access.</p> : null}
      </div>
      <h3 className={`mt-5 ${SUBHEADING}`}>Website notifications</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500">Allowed sites keep running quietly after you close their tabs so notifications can appear across Breadboard while this window is open. Open a notification to return to the site. Blocking a site or turning notifications off stops its closed background page; reopen the site to start receiving again.</p>
      <p className="mt-2 text-xs leading-5 text-gray-500">Web Push uses Mozilla’s push service. Message contents are encrypted in transit and decrypted on this computer.</p>
      <label className="mt-4 flex items-center justify-between gap-4 text-sm font-medium text-white">
        <span>Allow website notifications</span>
        <input type="checkbox" role="switch" className="browser-settings-switch" checked={preferences.notificationsEnabled} disabled={busy}
          onChange={event => void save({ type: "browser-notifications-enabled", enabled: event.target.checked })} />
      </label>
      <p className="mt-1 text-xs leading-5 text-gray-500">Turning this off pauses website notifications and requests to send them. Your per-site choices are kept.</p>
      <div className="mt-2 divide-y divide-[var(--line)]">
        {Object.entries(preferences.sites).sort(([a], [b]) => a.localeCompare(b)).map(([origin, permission]) => <div key={origin} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 break-all text-sm font-medium text-white">{origin}</span>
          <PermissionChoice label={`Notifications for ${origin}`} value={permission} disabled={busy}
            onChange={next => void save({ type: "browser-notification-permission", origin, permission: next })} />
        </div>)}
        {!Object.keys(preferences.sites).length ? <p className="py-3 text-xs text-gray-500">No site permissions yet.</p> : null}
      </div>
      <h3 className={`mt-5 ${SUBHEADING}`}>Apps sites can open</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500">Links such as Zoom or Teams meetings open their desktop app without asking for these sites.</p>
      <div className="mt-2 divide-y divide-[var(--line)]">
        {Object.entries(preferences.appLinks ?? {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([origin, schemes]) => schemes.map(scheme =>
          <div key={`${origin} ${scheme}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="min-w-0 break-all text-sm text-white"><span className="font-medium">{origin}</span> <span className="text-gray-500">opens {scheme}: links</span></span>
            <button type="button" disabled={busy} className="rounded-lg px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] disabled:opacity-50"
              onClick={() => void save({ type: "browser-app-link", origin, scheme, allowed: false })}>Remove</button>
          </div>))}
        {!Object.values(preferences.appLinks ?? {}).some(schemes => schemes.length) ? <p className="py-3 text-xs text-gray-500">Sites ask before opening another app.</p> : null}
      </div>
      <h3 className={`mt-5 ${SUBHEADING}`}>Saved passwords</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500">Breadboard offers to save a password when you sign in, and fills it when you click the sign-in field. Passwords are encrypted with your Windows account and are never shown here.</p>
      <div className="mt-2 divide-y divide-[var(--line)]">
        {(tabs?.savedPasswords ?? []).map(({ origin, username }) => <div key={`${origin} ${username}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 break-all text-sm text-white"><span className="font-medium">{origin}</span> <span className="text-gray-500">{username || "(no username)"}</span></span>
          <button type="button" disabled={busy} className="rounded-lg px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] disabled:opacity-50"
            onClick={() => void save({ type: "browser-password-delete", origin, username })}>Remove</button>
        </div>)}
        {!(tabs?.savedPasswords ?? []).length ? <p className="py-3 text-xs text-gray-500">No saved passwords.</p> : null}
      </div>
    </>}
    {error ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p> : null}
  </section>;
}
