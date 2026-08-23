"use client";

// Settings → Connections: the external apps Breadboard may act through.
//
// Connecting an account is setup, done once; the capability surfaces are for
// deciding what an agent may do with it afterward.

import { useCallback, useEffect, useMemo, useState } from "react";
import { invalidateCommandResponseCache } from "@/lib/hermes/command-client-cache";
import { invalidateSettingsCache } from "@/lib/settings-client-cache";

const SPOTIFY_CONNECTION_URL = "/api/hermes/connections/spotify";

type ComposioResponse = {
  configured: boolean;
  provider: "Composio";
  connected: boolean;
  enabled: boolean;
  toolCount: number;
  message: string | null;
};

type AppIntegration = {
  integrationId: string;
  provider: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string;
  authentication: "oauth" | "credentials" | "none";
  connected?: boolean;
  managedAuthentication?: boolean;
};

type SpotifyConnection = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "needs_reauth" | "not_connected";
};

function LoadingRows() {
  return (
    <div className="space-y-2 p-2" aria-label="Loading connections">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex animate-pulse items-center gap-3 rounded-xl px-3 py-3 motion-reduce:animate-none">
          <span className="h-9 w-9 rounded-xl bg-[var(--paper-strong)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-2/5 rounded bg-[var(--paper-strong)]" />
            <span className="block h-2.5 w-4/5 rounded bg-[var(--paper-strong)]" />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SettingsConnections() {
  const [appIntegrations, setAppIntegrations] = useState<AppIntegration[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsMessage, setConnectionsMessage] = useState<string | null>(null);
  const [spotify, setSpotify] = useState<SpotifyConnection | null>(null);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [query, setQuery] = useState("");

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const [response, integrationsResponse, spotifyResponse] = await Promise.all([
        fetch("/api/hermes/composio", { cache: "no-store" }),
        fetch("/api/hermes/composio/integrations", {
          cache: "no-store",
        }),
        fetch(SPOTIFY_CONNECTION_URL, { cache: "no-store" }),
      ]);
      const payload = (await response.json().catch(() => ({}))) as
        | ComposioResponse
        | { message?: string; error?: string };
      if (!response.ok || !("provider" in payload)) {
        const failure = payload as { message?: string; error?: string };
        throw new Error(
          failure.message ??
            failure.error ??
            "App connections could not be loaded.",
        );
      }
      setConnectionsMessage(payload.message);
      if (spotifyResponse.ok) {
        const spotifyPayload = (await spotifyResponse.json()) as SpotifyConnection;
        setSpotify(spotifyPayload);
      }
      if (integrationsResponse.ok) {
        const integrationsPayload = (await integrationsResponse.json()) as {
          integrations?: AppIntegration[];
        };
        setAppIntegrations(
          Array.isArray(integrationsPayload.integrations)
            ? integrationsPayload.integrations.filter(
                (integration) => integration.slug.toLowerCase() !== "spotify",
              )
            : [],
        );
      }
    } catch (cause) {
      setConnectionsMessage(
        cause instanceof Error
          ? cause.message
          : "App connections could not be loaded.",
      );
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  // Sign-in finishes in another window, so the list is re-read whenever this
  // one comes back to the foreground as well as on the popup's own message.
  useEffect(() => {
    void loadConnections();
    const refreshAfterExternalAuthorization = () => {
      if (document.visibilityState === "visible") void loadConnections();
    };
    const refreshAfterComposioAuthorization = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "breadboard:connections:changed"
      ) {
        void loadConnections();
      }
    };
    window.addEventListener("focus", refreshAfterExternalAuthorization);
    window.addEventListener("message", refreshAfterComposioAuthorization);
    document.addEventListener(
      "visibilitychange",
      refreshAfterExternalAuthorization,
    );
    return () => {
      window.removeEventListener("focus", refreshAfterExternalAuthorization);
      window.removeEventListener("message", refreshAfterComposioAuthorization);
      document.removeEventListener(
        "visibilitychange",
        refreshAfterExternalAuthorization,
      );
    };
  }, [loadConnections]);

  const visibleAppIntegrations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return appIntegrations;
    return appIntegrations.filter((integration) =>
      `${integration.name} ${integration.slug} ${integration.description}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [appIntegrations, query]);

  const spotifyMatchesQuery = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return !normalized || "spotify music playback playlists".includes(normalized);
  }, [query]);

  async function connectSpotify() {
    const popup = window.open(
      "about:blank",
      "breadboard-spotify-oauth",
      "popup,width=720,height=760",
    );
    if (popup) popup.opener = null;
    setSpotifyBusy(true);
    setConnectionsMessage("Opening Spotify sign-in…");
    try {
      const response = await fetch(SPOTIFY_CONNECTION_URL, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(
          payload.message ?? payload.error ?? "Spotify sign-in could not be started.",
        );
      }
      invalidateSettingsCache("/api/hermes/mcp");
      invalidateCommandResponseCache();
      if (popup) popup.location.replace(payload.authorizationUrl);
      else window.location.assign(payload.authorizationUrl);
      setConnectionsMessage(
        "Finish signing in with Spotify in the opened window, then return here.",
      );
    } catch (cause) {
      popup?.close();
      setConnectionsMessage(
        cause instanceof Error
          ? cause.message
          : "Spotify sign-in could not be started.",
      );
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function disconnectSpotify() {
    if (!window.confirm("Disconnect Spotify from Breadboard?")) return;
    setSpotifyBusy(true);
    setConnectionsMessage("Disconnecting Spotify…");
    try {
      const response = await fetch(SPOTIFY_CONNECTION_URL, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(
          payload.message ?? payload.error ?? "Spotify could not be disconnected.",
        );
      }
      invalidateSettingsCache("/api/hermes/mcp");
      invalidateCommandResponseCache();
      setSpotify({ configured: false, connected: false, status: "not_connected" });
      setConnectionsMessage("Spotify disconnected.");
    } catch (cause) {
      setConnectionsMessage(
        cause instanceof Error ? cause.message : "Spotify could not be disconnected.",
      );
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function connectApp(integration: AppIntegration) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setConnectionsLoading(true);
    setConnectionsMessage(`Opening ${integration.name} sign-in…`);
    try {
      const response = await fetch("/api/hermes/composio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integration.integrationId }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | { authorizationUrl: string }
        | { message?: string; error?: string };
      if (!response.ok || !("authorizationUrl" in payload)) {
        const failure = payload as { message?: string; error?: string };
        throw new Error(
          failure.message ??
            failure.error ??
            `${integration.name} sign-in could not be started.`,
        );
      }
      if (popup) {
        popup.location.href = payload.authorizationUrl;
      } else {
        window.location.assign(payload.authorizationUrl);
      }
      setConnectionsMessage(
        `Finish connecting ${integration.name} in the opened window.`,
      );
    } catch (cause) {
      popup?.close();
      setConnectionsMessage(
        cause instanceof Error
          ? cause.message
          : `${integration.name} sign-in could not be started.`,
      );
    } finally {
      setConnectionsLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          aria-hidden
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path strokeLinecap="round" d="m16 16 4 4" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search connections"
          className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
          aria-label="Search connections"
        />
      </div>
      <div className="px-1">
        <p className="text-xs leading-5 text-[var(--ink-muted)]">
          Connections securely link external apps to Breadboard, letting agents use their information and actions when you ask while keeping credentials outside the chat.
        </p>
      </div>
      {connectionsMessage ? (
        <p role="status" className="mx-1 text-xs text-[var(--botanical)]">
          {connectionsMessage}
        </p>
      ) : null}
      {!appIntegrations.length && !spotify && connectionsLoading ? (
        <LoadingRows />
      ) : spotifyMatchesQuery || visibleAppIntegrations.length ? (
        <ul
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          aria-label="Available app connections"
        >
          {spotifyMatchesQuery ? (
            <li className="neu-card flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1ed760] text-[#0b2214]"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.59 14.42a.62.62 0 0 1-.86.2c-2.36-1.44-5.33-1.77-8.82-.97a.63.63 0 0 1-.28-1.22c3.82-.87 7.1-.5 9.76 1.12.3.18.39.57.2.87Zm1.23-2.74a.78.78 0 0 1-1.08.26c-2.7-1.66-6.82-2.14-10.01-1.17a.78.78 0 1 1-.46-1.5c3.65-1.1 8.19-.57 11.3 1.34.37.23.48.7.25 1.07Zm.1-2.85C14.68 8.9 9.34 8.72 6.25 9.66a.94.94 0 0 1-.55-1.8c3.55-1.07 9.45-.86 13.18 1.35a.94.94 0 0 1-.96 1.62Z" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
                  Spotify
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--ink-muted)]">
                  {spotify?.connected
                    ? "Connected"
                    : spotify?.configured
                      ? "Sign-in required"
                      : "Music, playlists, and playback"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void connectSpotify()}
                  disabled={spotifyBusy || connectionsLoading}
                  className="neu-button rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-50"
                  aria-label={`${spotify?.connected ? "Reconnect" : "Connect"} Spotify`}
                >
                  {spotifyBusy
                    ? "Opening…"
                    : spotify?.connected
                      ? "Reconnect"
                      : "Connect"}
                </button>
                {spotify?.configured ? (
                  <button
                    type="button"
                    onClick={() => void disconnectSpotify()}
                    disabled={spotifyBusy || connectionsLoading}
                    className="rounded-lg px-2 py-1.5 text-xs text-[#9a4438] disabled:opacity-50"
                    aria-label="Disconnect Spotify"
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </li>
          ) : null}
          {visibleAppIntegrations.map((integration) => (
            <li
              key={integration.integrationId}
              className="neu-card flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3"
            >
              <span
                aria-hidden
                className="neu-button-icon h-10 w-10 shrink-0 rounded-xl bg-contain bg-center bg-no-repeat"
                style={{ backgroundImage: `url("${integration.logoUrl}")` }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
                  {integration.name}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--ink-muted)]">
                  {integration.connected
                    ? "Connected through Composio"
                    : integration.authentication === "oauth"
                    ? "OAuth sign-in"
                    : integration.authentication === "credentials"
                      ? "Secure credentials"
                      : "No account required"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void connectApp(integration)}
                disabled={connectionsLoading || integration.connected}
                className="neu-button shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-50"
                aria-label={`Connect ${integration.name}`}
              >
                {integration.connected ? "Connected" : "Connect"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">
          {query
            ? "No app connections matched this search."
            : "The app catalog could not be loaded."}
        </p>
      )}
    </div>
  );
}
