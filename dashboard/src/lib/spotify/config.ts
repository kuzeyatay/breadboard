const DEFAULT_SPOTIFY_CLIENT_ID = "cb7cb4f043ed42759672098759409ba8";
export const SPOTIFY_OAUTH_CALLBACK_PATH =
  "/api/hermes/mcp/oauth/callback" as const;

export function spotifyOAuthCallbackOrigin(requestOrigin: string): string {
  let url: URL;
  try {
    url = new URL(requestOrigin);
  } catch {
    throw new Error("The Spotify OAuth callback origin is invalid.");
  }
  if (url.protocol === "http:" && url.hostname === "localhost") {
    // Spotify rejects localhost but permits a loopback IP with a dynamic port.
    url.hostname = "127.0.0.1";
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password) {
    throw new Error("The Spotify OAuth callback must use HTTPS or loopback HTTP.");
  }
  return url.origin;
}

export function spotifyClientId(): string {
  const clientId =
    process.env.BREADBOARD_SPOTIFY_CLIENT_ID?.trim() ||
    DEFAULT_SPOTIFY_CLIENT_ID;
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(clientId)) {
    throw new Error("The Spotify OAuth Client ID is invalid.");
  }
  return clientId;
}
