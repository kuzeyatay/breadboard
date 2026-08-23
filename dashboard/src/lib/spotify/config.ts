const DEFAULT_SPOTIFY_CLIENT_ID = "cb7cb4f043ed42759672098759409ba8";
const DEFAULT_SPOTIFY_OAUTH_CALLBACK =
  "http://127.0.0.1:3000/api/hermes/mcp/oauth/callback";

function secureCallbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Spotify OAuth callback URL is invalid.");
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password) {
    throw new Error("The Spotify OAuth callback URL must use HTTPS or loopback HTTP.");
  }
  if (url.pathname !== "/api/hermes/mcp/oauth/callback") {
    throw new Error(
      "The Spotify OAuth callback URL must end with /api/hermes/mcp/oauth/callback.",
    );
  }
  url.search = "";
  url.hash = "";
  return url;
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

export function spotifyOAuthCallbackUrl(): string {
  const configured =
    process.env.BREADBOARD_SPOTIFY_OAUTH_CALLBACK_URL?.trim() ||
    // Preserve installations that registered the earlier shared callback key.
    process.env.BREADBOARD_MCP_OAUTH_CALLBACK_URL?.trim() ||
    DEFAULT_SPOTIFY_OAUTH_CALLBACK;
  return secureCallbackUrl(configured).toString();
}
