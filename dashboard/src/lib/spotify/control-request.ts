const transportActions = new Set(["pause", "resume", "next", "previous", "seek", "transfer", "play-track", "play-playlist", "play-artist", "play-album", "import-history"]);

export async function spotifyPlayerRequest(
  resource: "player" | "engine" = "player",
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, unknown>,
): Promise<Response> {
  const desktop = (window as unknown as {
    breadboardDesktop?: { spotifyRequest?: (request: Record<string, unknown>) => Promise<{status: number; body: string}> };
  }).breadboardDesktop;
  if ((method === "GET" || resource === "engine" || transportActions.has(String(body?.action))) && desktop?.spotifyRequest) {
    // Never retry an ambiguous native result through fetch: it may already
    // have reached Spotify. Older shells and ordinary browsers use fetch.
    const response = await desktop.spotifyRequest({ resource, method, ...(body ? {body} : {}) });
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
  }
  return fetch(resource === "engine" ? "/api/hermes/connections/spotify/engine" : "/api/browser/spotify", {
    method, headers: { "Content-Type": "application/json" },
    ...(body ? {body: JSON.stringify(body)} : {}), cache: "no-store",
    ...(method === "POST" && resource === "player" ? {priority: "high" as const} : {}),
    ...(resource === "engine" ? {signal: AbortSignal.timeout(15_000), keepalive: method === "DELETE"} : {}),
  });
}

export const spotifyControlRequest = (body: Record<string, unknown>) => spotifyPlayerRequest("player", "POST", body);
