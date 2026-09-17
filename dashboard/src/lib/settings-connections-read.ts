/**
 * What one read of the Connections panel produces (SET-03, SET-04).
 *
 * Each service is read and reported independently: a failed app-connection
 * read must not discard a Spotify connection or an integration catalog that
 * answered perfectly well, and it must not replace previously good data with
 * nothing. Reading the panel also performs no calendar synchronization —
 * that belongs to the calendar's own lifecycle, and is only asked for here
 * when an authorization has just completed.
 */

export interface ConnectionsReadResult<Integration, Spotify> {
  /** Present only when its own read succeeded; `undefined` means "keep what you have". */
  readonly spotify?: Spotify;
  readonly integrations?: Integration[];
  /** The panel's status line, or `undefined` to leave it unchanged. */
  readonly message?: string;
  /** True when this read failed to reach the app-connections service. */
  readonly failed: boolean;
  /** A newly authorized Google Calendar has nothing to show until it syncs once. */
  readonly calendarSyncNeeded: boolean;
}

interface ComposioPayload {
  provider?: unknown;
  message?: string;
  error?: string;
  connectedIntegrations?: { slug: string }[];
}

export const CONNECTIONS_UNAVAILABLE = "App connections could not be loaded.";

type Reader = (input: string) => Promise<{ ok: boolean; body: Record<string, unknown> }>;

export interface ConnectionsReadOptions {
  readonly read: Reader;
  readonly connectionsUrl: string;
  readonly integrationsUrl: string;
  readonly spotifyUrl: string;
  /** Set only for a read triggered by a completed authorization. */
  readonly afterAuthorization?: boolean;
}

export async function readConnectionsPanel<
  Integration extends { slug: string },
  Spotify,
>(
  options: ConnectionsReadOptions,
): Promise<ConnectionsReadResult<Integration, Spotify>> {
  const [connections, integrations, spotify] = await Promise.allSettled([
    options.read(options.connectionsUrl),
    options.read(options.integrationsUrl),
    options.read(options.spotifyUrl),
  ]);

  const result: {
    spotify?: Spotify;
    integrations?: Integration[];
    message?: string;
    failed: boolean;
    calendarSyncNeeded: boolean;
  } = { failed: false, calendarSyncNeeded: false };

  if (spotify.status === "fulfilled" && spotify.value.ok) {
    result.spotify = spotify.value.body as unknown as Spotify;
  }

  if (integrations.status === "fulfilled" && integrations.value.ok) {
    const available = (integrations.value.body as { integrations?: Integration[] })
      .integrations;
    // An authenticated account with no integrations is an empty list; an
    // unreadable catalog leaves the previous list alone (SET-07).
    result.integrations = Array.isArray(available)
      ? available.filter((integration) => integration.slug.toLowerCase() !== "spotify")
      : [];
  }

  const payload =
    connections.status === "fulfilled"
      ? (connections.value.body as ComposioPayload)
      : null;
  if (connections.status === "rejected" || !connections.value.ok || !payload?.provider) {
    result.failed = true;
    result.message = payload?.message ?? payload?.error ?? CONNECTIONS_UNAVAILABLE;
    return result;
  }

  result.message = payload.message;
  result.calendarSyncNeeded = Boolean(
    options.afterAuthorization &&
      payload.connectedIntegrations?.some(
        (integration) => integration.slug === "google-calendar",
      ),
  );
  return result;
}
