"use client";

import { useState } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./organization-settings.module.css";

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
  return <section className="mt-8 rounded-xl border border-[var(--line)] p-5" aria-labelledby="organization-sidebar-title">
    <label className="flex items-center justify-between gap-6">
      <span><span id="organization-sidebar-title" className="block text-base font-semibold">Organization sidebar</span><span className="mt-1 block text-sm text-[var(--ink-muted)]">Discuss pages, text, images and videos with a room or the general public.</span></span>
      <input type="checkbox" role="switch" aria-label="Organization sidebar" className={styles.toggle} checked={preferences?.organizationSidebarEnabled !== false} disabled={!preferences || busy} onChange={event => void save(event.target.checked)} />
    </label>
    <p className="mt-3 text-xs text-[var(--ink-muted)]">Turning this off hides the panel button, shared highlights and comment actions. Your conversations are kept. Private browsing never shares annotations.</p>
    {!preferences && <p className="mt-3 text-sm text-[var(--ink-muted)]">Open this page in the Breadboard desktop app to change this setting.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
  </section>;
}
