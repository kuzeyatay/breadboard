"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import PageAppearance from "@/app/components/page-appearance";
import BrowserNotificationSettings from "./notification-settings";

const SettingsDialog = dynamic(() => import("@/app/components/settings-dialog"), { ssr: false });

export default function BrowserSettings({ ownerKey, appearance }: { ownerKey: string; appearance: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 text-[var(--ink)]">
      <h1 className="text-2xl font-semibold">Browser settings</h1>
      <p className="mt-3 text-sm text-[var(--ink-muted)]">Manage website notifications, your account, and the browser’s appearance.</p>
      <BrowserNotificationSettings />
      <div className="mt-8 flex flex-wrap gap-4">
        <button className="rounded-lg border border-[var(--line-strong)] px-4 py-3" onClick={() => setSettingsOpen(true)}>Accounts and connections</button>
        <Link className="rounded-lg border border-[var(--line-strong)] px-4 py-3" href="/profile">Your profile</Link>
      </div>
      <PageAppearance page="browser" ownerKey={ownerKey} initialOpen={appearance} />
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </main>
  );
}
