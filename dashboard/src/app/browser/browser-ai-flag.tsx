"use client";

import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { aiFlagSite, looksPrivatePage } from "@/lib/browser-annotations";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

type FlagState = { site: string | null; count: number; mine: boolean; level: "yellow" | "red" | null; signedIn: boolean };

/**
 * Flag the open website as AI-generated. The flag is a public record in the
 * person's Crumbs (AT Protocol) account; the indexer counts them per site and
 * the address bar outline turns yellow, then red, as more people flag it.
 */
export default function BrowserAiFlag({ url, askFirst }: { url: string; askFirst: boolean }) {
  // Pages that look private (an inbox, an account page) and local addresses are not flaggable.
  const site = url && !looksPrivatePage(url) ? aiFlagSite(url) : null;
  const [state, setState] = useState<FlagState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ site: string; message: string } | null>(null);
  const current = site && state?.site === site ? state : null;
  const level = current?.level ?? null;

  useEffect(() => {
    if (!site) return;
    const controller = new AbortController();
    fetch(`/api/crumbs?view=ai-flags&url=${encodeURIComponent(`https://${site}/`)}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<FlagState> : Promise.reject(new Error(String(response.status))))
      .then(setState)
      .catch(() => { if (!controller.signal.aborted) setError({ site, message: "Crumbs can’t be reached right now, so flags are unavailable." }); });
    return () => controller.abort();
  }, [site]);

  useEffect(() => { void sendDesktopTabsCommand({ type: "browser-ai-flags", site, level }); }, [site, level]);

  async function toggle() {
    if (!site || !current || busy) return;
    setError(null);
    // Crumbs' panel holds the sign-in.
    if (!current.signedIn) { void sendDesktopTabsCommand({ type: "browser-organization", open: true }); return; }
    const on = !current.mine;
    if (on && askFirst && !(await sendDesktopTabsCommand({ type: "browser-ai-flag-confirm", site }))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/crumbs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ai-flag", url: `https://${site}/`, on }) });
      const data = await response.json() as FlagState & { error?: string };
      if (!response.ok) throw new Error(data.error || "Couldn’t save your flag. Try again.");
      setState(data);
    } catch (failure) {
      setError({ site, message: failure instanceof Error ? failure.message : "Couldn’t save your flag. Try again." });
    } finally { setBusy(false); }
  }

  const failure = error?.site === site ? error.message : "";
  const label = !site ? "This page can’t be flagged as AI"
    : current?.mine ? `You flagged ${site} as AI-generated. Click to remove your flag`
    : current && !current.signedIn ? "Sign in to Crumbs to flag websites as AI"
    : "Flag website as AI";
  const detail = current && current.count ? ` (${current.count} ${current.count === 1 ? "person has" : "people have"} flagged it)` : "";

  return <>
    <button type="button" className="browser-terminal-launcher browser-ai-flag" aria-label={label} title={failure || label + detail}
      aria-pressed={current?.mine === true} disabled={!site || !current || busy} data-ai-level={level ?? undefined}
      onClick={() => void toggle()}>
      <Flag aria-hidden="true" strokeWidth={1.7} fill={current?.mine ? "currentColor" : "none"} />
    </button>
    <span className="sr-only" role="status">{failure}</span>
  </>;
}
