"use client";

import { useCallback, useEffect, useState } from "react";

import type { BrowserProfileState } from "@/lib/agent-browser/service.ts";

const MESSAGES: Record<string, string> = {
  browser_not_found: "No Chrome or Edge was found on this computer.",
  browser_launch_failed: "The browser would not start.",
  browser_launch_cancelled: "The browser opening was cancelled.",
  invalid_url: "That is not a web address the browser can open.",
  profile_not_writable: "Breadboard could not create the profile directory.",
  profile_not_removable: "The profile could not be deleted. Close the browser and try again.",
  run_in_progress: "An agent is using the browser right now. Wait for it to finish.",
  resource_exhausted: "There is not enough free memory to open the browser right now.",
  runtime_unavailable: "The browser Runtime is not available right now.",
  sign_in_window_open: "Close the sign-in window first.",
  sign_in_window_owned_by_another_user: "Another signed-in account opened this browser window.",
  unmanaged_sign_in_window: "Close the existing browser window directly, then try again.",
  unsafe_profile_directory: "The configured profile directory is not safe to delete.",
  unknown_action: "That action is not available.",
};

function message(code: unknown): string {
  return (typeof code === "string" && MESSAGES[code]) || "Something went wrong.";
}

/**
 * The server cannot list the profile's sites while the browser is holding it —
 * Chromium has not written them down yet — so an empty list during a sign-in
 * means "not visible from here", not "signed out of everything". Keep showing
 * what the card already knew until the window closes and a real read lands.
 */
function keepKnownSites(previous: BrowserProfileState, next: BrowserProfileState): BrowserProfileState {
  return next.windowOpen && next.sites.length === 0 && previous.sites.length > 0
    ? { ...next, sites: previous.sites }
    : next;
}

function whenLastUsed(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The browser the agents drive, and the sign-ins it keeps.
 *
 * An Agent Browser run opens a browser that has never logged into anything,
 * which puts every task behind a login out of reach. This card opens that same
 * browser — same binary, same profile directory — as an ordinary window, so a
 * person signs into Gmail, GitHub, or whatever else once, by hand. Every run
 * after that inherits the session.
 *
 * Chromium allows one process per profile, so the window and a run cannot both
 * hold it: the card says so, and the server refuses rather than letting a run
 * fail obscurely.
 */
export default function BrowserProfilePanel({ initial }: { initial: BrowserProfileState }) {
  // Read on the server with the rest of the page, so the card arrives already
  // knowing which browser it drives and what it is signed into.
  const [profile, setProfile] = useState<BrowserProfileState>(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const read = useCallback(async () => {
    const response = await fetch("/api/agent-browser/browser-profile");
    if (!response.ok) return;
    const data = await response.json().catch(() => null);
    if (data?.profile) {
      setProfile((previous) => keepKnownSites(previous, data.profile as BrowserProfileState));
    }
  }, []);

  // While the window is up the interesting facts are all on the other side of
  // it — whether it is still open, what it has signed into — and none of them
  // reach us on their own.
  useEffect(() => {
    if (!profile.windowOpen) return;
    const timer = setInterval(() => void read(), 5_000);
    return () => clearInterval(timer);
  }, [profile.windowOpen, read]);

  async function act(action: "open" | "close" | "reset") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-browser/browser-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "open" && url.trim() ? { action, url: url.trim() } : { action }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(message(data?.error));
        // The refusal itself may be news — a run that started meanwhile, a
        // window someone closed by hand — so re-read regardless.
        await read();
        return;
      }
      if (data?.profile) {
        setProfile((previous) => keepKnownSites(previous, data.profile as BrowserProfileState));
      }
      if (action === "reset") setConfirmReset(false);
    } catch {
      setError("Breadboard could not reach the browser.");
    } finally {
      setBusy(false);
    }
  }

  // Absent rather than disabled when there is no runtime to sign in for: with
  // agent-browser missing, or no browser on the machine, a profile is a folder
  // nothing would ever read.
  if (!profile.runtimeAvailable || !profile.browserFound) return null;

  const browser = profile.browserName ?? "the browser";

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Browser sign-ins</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          The browser your agents drive, and the accounts it stays logged into.
        </p>
      </header>

      <p className="text-xs leading-5 text-gray-400">
        Agent Browser drives <span className="text-gray-200">{browser}</span> against one profile of
        its own. Open it here, sign into the sites you want an agent to reach, and every run after
        that starts already logged in.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <span
          className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
            profile.windowOpen ? "bg-emerald-400" : profile.signedIn ? "bg-sky-400" : "bg-gray-600"
          }`}
          aria-hidden
        />
        <p className="text-xs text-gray-400">
          {profile.windowOpen
            ? "The sign-in window is open. Agents cannot run until it is closed."
            : profile.signedIn
              ? `Runs start from this profile${profile.lastUsedAt ? ` — last used ${whenLastUsed(profile.lastUsedAt)}` : ""}.`
              : "Nothing is saved yet, so runs start signed out."}
        </p>
      </div>

      {profile.sites.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            Signed in
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {profile.sites.map((site) => (
              <span
                key={site}
                className="neu-surface rounded-full border border-gray-800 px-2.5 py-1 text-[11px] text-gray-300"
              >
                {site}
              </span>
            ))}
          </div>
        </div>
      )}

      {!profile.windowOpen && (
        <label className="mt-4 block">
          <span className="text-[11px] font-medium text-gray-500">Open at (optional)</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void act("open");
            }}
            placeholder="mail.google.com"
            spellCheck={false}
            className="neu-surface mt-1 w-full rounded-xl border border-gray-800 px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-gray-700 focus:outline-none"
          />
        </label>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {profile.windowOpen ? (
          <button
            type="button"
            onClick={() => void act("close")}
            disabled={busy}
            className="neu-surface rounded-xl border border-gray-800 px-3 py-2 text-xs font-medium text-white transition hover:border-gray-700 disabled:opacity-50"
          >
            {busy ? "Closing…" : `Close ${browser}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void act("open")}
            disabled={busy || profile.runInProgress}
            className="neu-surface rounded-xl border border-gray-800 px-3 py-2 text-xs font-medium text-white transition hover:border-gray-700 disabled:opacity-50"
          >
            {busy ? "Opening…" : `Open ${browser}`}
          </button>
        )}

        {profile.signedIn && !profile.windowOpen && (
          <button
            type="button"
            onClick={() => (confirmReset ? void act("reset") : setConfirmReset(true))}
            disabled={busy || profile.runInProgress}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
              confirmReset
                ? "border-red-900 bg-red-950/40 text-red-300 hover:border-red-800"
                : "neu-surface border-gray-800 text-gray-400 hover:border-gray-700"
            }`}
          >
            {confirmReset ? "Delete every sign-in" : "Forget sign-ins"}
          </button>
        )}

        {confirmReset && !busy && (
          <button
            type="button"
            onClick={() => setConfirmReset(false)}
            className="text-xs text-gray-500 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>

      {profile.runInProgress && !profile.windowOpen && (
        <p className="mt-3 text-xs text-gray-500">
          An agent is using the browser right now. This waits until it is done.
        </p>
      )}

      <p className="mt-4 text-[11px] leading-5 text-gray-600">
        Kept in <span className="font-mono text-gray-500">{profile.directory}</span>. Anything you
        sign into here, an agent can act as — so sign in only where you would let one.
      </p>

      {error && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
