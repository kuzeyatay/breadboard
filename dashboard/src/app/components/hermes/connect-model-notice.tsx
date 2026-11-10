"use client";

import { useEffect, useState } from "react";

import { fetchCachedSettings } from "@/lib/settings-client-cache";
import { modelConnected, OPEN_SETTINGS_EVENT } from "@/lib/model-connection";
import { AUTH_CHANGED_EVENT } from "@/lib/auth-events";

async function readJson(url: string, force: boolean): Promise<Record<string, unknown>> {
  const response = await fetchCachedSettings(url, { force });
  return response.ok ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : {};
}

/**
 * Shown above a blank chat until some model can answer. It reads the same
 * three endpoints the Settings → Account panel reads (and shares their cache),
 * so connecting a model there makes it go away on the next look.
 */
export default function ConnectModelNotice() {
  // Unknown until the endpoints answer: say nothing rather than flash a
  // warning at someone whose ChatGPT account is about to load.
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async (force = false) => {
      try {
        const [account, providers, proxy] = await Promise.all([
          readJson("/api/chatmock/account", force),
          readJson("/api/chatmock/providers", force),
          readJson("/api/cliproxy/status", force),
        ]);
        if (cancelled) return;
        setConnected(
          modelConnected({
            chatgptSignedIn: Boolean((account.account as { signedIn?: boolean } | undefined)?.signedIn),
            providers: Array.isArray(providers.providers) ? providers.providers : [],
            proxyAccounts: Array.isArray(proxy.accounts) ? proxy.accounts.length : 0,
          }),
        );
      } catch {
        // The proxy is still starting; the next chat will ask again.
      }
    };
    void check();
    // The account panel invalidates the cache when a sign-in lands; an auth
    // change is the closest broadcast that the notice can hear.
    const recheck = () => void check(true);
    window.addEventListener(AUTH_CHANGED_EVENT, recheck);
    window.addEventListener("focus", recheck);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, recheck);
      window.removeEventListener("focus", recheck);
    };
  }, []);

  if (connected !== false) return null;

  return (
    <div className="mx-auto mb-2 w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-100">
      <p className="font-medium">No model is connected yet</p>
      <p className="mt-1 text-amber-200/80">
        Sign in with ChatGPT or add an API key, and this chat can answer.
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: "account" }))}
        className="mt-2 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-medium text-gray-950 transition hover:bg-amber-300"
      >
        Connect a model
      </button>
    </div>
  );
}
