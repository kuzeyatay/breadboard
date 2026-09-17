"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserSignInsControl,
  type DesktopBrowserSignInsState,
} from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "../components/use-desktop-tabs";

/** Reads the same live Electron session that built-in browser tabs and agents use. */
export default function BrowserProfilePanel() {
  const tabs = useDesktopTabs();
  const [profile, setProfile] = useState<DesktopBrowserSignInsState | null>(null);
  const [available, setAvailable] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const readVersion = useRef(0);

  const read = useCallback(async () => {
    const control = browserSignInsControl();
    setAvailable(control !== null);
    if (!control) return;
    const version = ++readVersion.current;
    try {
      const next = await control.read();
      if (version !== readVersion.current) return;
      setProfile(next);
      setReadError(false);
    } catch {
      if (version === readVersion.current) setReadError(true);
    }
  }, []);

  // Cookies can change while any browser tab is open. Refresh on returning to
  // Profile and while visible, without opening Chromium's on-disk databases.
  useEffect(() => {
    void read();
    const refresh = () => {
      if (document.visibilityState === "visible") void read();
    };
    const timer = setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      readVersion.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [read, tabs?.activeId, tabs?.tabs.length]);

  async function act(action: "open" | "reset") {
    const control = browserSignInsControl();
    if (!control || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "open") {
        let address: string | undefined;
        if (url.trim()) {
          try {
            const value = url.trim();
            const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
            address = parsed.toString();
          } catch {
            setError("Enter a valid website address, such as mail.google.com.");
            return;
          }
        }
        if (!(await control.open(address))) {
          setError("Breadboard could not open a browser tab. Enable Browser navigation and try again.");
        }
      } else if (await control.reset()) {
        setConfirmReset(false);
      } else {
        setError("Close Breadboard's browser tabs before forgetting sign-ins.");
      }
      await read();
    } catch {
      setError("Breadboard could not reach the browser. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const canOpen = available && tabs?.enabled === true;
  const canReset = available && profile !== null && profile.openPages === 0;

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5" aria-busy={busy}>
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Browser sign-ins</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Your accounts in Breadboard&apos;s built-in browser.
        </p>
      </header>

      <p className="text-xs leading-5 text-gray-400">
        Open Breadboard&apos;s browser and sign into the sites you want to use. Your sign-ins stay
        on this device and are shared with agents working in Breadboard&apos;s browser.
      </p>

      {!available ? (
        <p className="mt-4 text-xs text-gray-500">
          {tabs ? "Restart Breadboard to manage browser sign-ins." : "Manage sign-ins in the Breadboard desktop app."}
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-gray-400">
            {profile?.sites.length
              ? "Saved browser data is available to your browser tabs and agents."
              : "Sign in to a website to keep your account available here."}
          </p>

          {profile !== null && profile.sites.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                Sites with saved cookies
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.sites.map((site) => (
                  <span key={site} className="neu-surface rounded-full border border-gray-800 px-2.5 py-1 text-[11px] text-gray-300">
                    {site}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="mt-4 block">
            <span className="text-[11px] font-medium text-gray-500">Open at (optional)</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canOpen && !busy) void act("open");
              }}
              placeholder="mail.google.com"
              spellCheck={false}
              className="neu-surface mt-1 w-full rounded-xl border border-gray-800 px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-gray-700 focus:outline-none"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void act("open")}
              disabled={busy || !canOpen}
              className="neu-surface rounded-xl border border-gray-800 px-3 py-2 text-xs font-medium text-white transition hover:border-gray-700 disabled:opacity-50"
            >
              Open Breadboard browser
            </button>
            <button
              type="button"
              onClick={() => (confirmReset ? void act("reset") : setConfirmReset(true))}
              disabled={busy || !canReset}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                confirmReset
                  ? "border-red-900 bg-red-950/40 text-red-300 hover:border-red-800"
                  : "neu-surface border-gray-800 text-gray-400 hover:border-gray-700"
              }`}
            >
              {confirmReset ? "Delete every sign-in" : "Forget sign-ins"}
            </button>
            {confirmReset && !busy && (
              <button type="button" onClick={() => setConfirmReset(false)} className="text-xs text-gray-500 underline-offset-2 hover:underline">
                Cancel
              </button>
            )}
          </div>

          {!canOpen && (
            <p className="mt-3 text-xs text-gray-500">Enable Browser navigation to open a sign-in tab.</p>
          )}
          {(profile?.openPages ?? 0) > 0 && (
            <p className="mt-3 text-xs text-gray-500">Close Breadboard&apos;s browser tabs before forgetting sign-ins.</p>
          )}
          {confirmReset && (
            <p className="mt-3 text-xs text-gray-500">
              This clears cookies and site data from Breadboard&apos;s browser and signs you out of its websites.
            </p>
          )}
        </>
      )}

      {(error || readError) && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {error || "Breadboard could not read saved browser data."}{" "}
          {readError && <button type="button" onClick={() => void read()} className="underline">Retry</button>}
        </p>
      )}
    </section>
  );
}
