"use client";

import { useState } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

export default function BrowserOrganizationSettings() {
  const preferences = useDesktopTabs()?.browserPreferences;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(enabled: boolean) {
    setBusy(true); setError("");
    try {
      if (!await sendDesktopTabsCommand({ type: "browser-organization-enabled", enabled })) throw new Error();
    } catch { setError("Couldn’t save your sidebar preference. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5" aria-labelledby="organization-sidebar-title">
    <label className="flex items-center justify-between gap-6">
      <span><span id="organization-sidebar-title" className="block text-sm font-semibold text-white">Organization sidebar</span><span className="mt-0.5 block text-xs leading-5 text-gray-500">Discuss pages, text, images and videos with a room or the general public.</span></span>
      <input type="checkbox" role="switch" aria-label="Organization sidebar" className="browser-settings-switch" checked={preferences?.organizationSidebarEnabled !== false} disabled={!preferences || busy} onChange={event => void save(event.target.checked)} />
    </label>
    <p className="mt-3 text-xs leading-5 text-gray-500">Turning this off hides the panel button, shared highlights and comment actions. Your conversations are kept. Private browsing never shares annotations.</p>
    {!preferences && <p className="mt-3 text-xs text-gray-500">Open this page in the Breadboard desktop app to change this setting.</p>}
    {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
  </section>;
}
