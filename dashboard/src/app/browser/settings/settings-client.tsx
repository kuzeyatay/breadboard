"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import BrowserNavigation from "@/app/browser/browser-navigation";
import PageAppearance from "@/app/components/page-appearance";
import { TerminalLibrary, type Panel } from "@/app/new-tab/terminal-browser-controls";
import DownloadSettingsPanel from "@/app/profile/download-settings-panel";
import BrowserNotificationSettings from "./notification-settings";
import BrowserOrganizationSettings from "./organization-settings";

const SettingsDialog = dynamic(() => import("@/app/components/settings-dialog"), { ssr: false });

export default function BrowserSettings({ ownerKey, appearance, showFlowers }: { ownerKey: string; appearance: boolean; showFlowers: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  return (
    <>
      <div className="sticky top-0 z-20">
        <BrowserNavigation showFlowers={showFlowers} restoreOwnerKey={ownerKey} onPanel={setPanel} />
      </div>
      <div className="relative">
        <main className="mx-auto w-full max-w-5xl px-6 py-8 text-[var(--ink)]">
          <h1 className="text-xl font-semibold text-white">Browser settings</h1>
          <p className="mt-1 pr-16 text-sm text-gray-500 xl:pr-0">Manage downloads, site permissions, your account, and the browser’s appearance.</p>
          <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="min-w-0 space-y-4">
              <DownloadSettingsPanel />
              <BrowserOrganizationSettings />
              <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5" aria-labelledby="browser-account-title">
                <h2 id="browser-account-title" className="text-sm font-semibold text-white">Account</h2>
                <p className="mt-0.5 text-xs text-gray-500">Manage your sign-ins and everything else in Breadboard.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="neu-button rounded-lg border px-3 py-1.5 text-xs text-white" onClick={() => setSettingsOpen(true)}>Accounts and connections</button>
                  <Link className="neu-button rounded-lg border px-3 py-1.5 text-xs text-white" href="/settings">Settings</Link>
                </div>
              </section>
            </div>
            <BrowserNotificationSettings />
          </div>
        </main>
        <PageAppearance page="browser" ownerKey={ownerKey} initialOpen={appearance} />
      </div>
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {panel ? <TerminalLibrary panel={panel} ownerKey={ownerKey} close={() => setPanel(null)} /> : null}
    </>
  );
}
