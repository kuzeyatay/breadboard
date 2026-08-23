const SPOTIFY_TRACK_URI = /^spotify:track:([A-Za-z0-9]{10,64})$/;

export type SpotifyQueueDirection = "previous" | "next";

export interface SpotifyQueueStep {
  targetId: string;
  targetUri: string;
  targetIndex: number;
  playbackUris: string[];
}

/**
 * Select an adjacent item from Breadboard's recorded queue and rotate the
 * provider payload so Spotify cannot continue through an older ambient queue.
 */
export function spotifyQueueStep(
  queueUris: readonly string[],
  currentTrackId: string,
  direction: SpotifyQueueDirection,
): SpotifyQueueStep | null {
  const queue = queueUris.filter((uri) => SPOTIFY_TRACK_URI.test(uri));
  if (!queue.length) return null;

  const currentUri = `spotify:track:${currentTrackId}`;
  const currentIndex = queue.indexOf(currentUri);
  // If Spotify is still exposing a track from an older ambient queue, enter
  // Breadboard's queue at the appropriate edge instead of skipping its first
  // (or last) item. Once the visible track belongs to this queue, navigation
  // is strictly adjacent and wraps normally.
  const targetIndex = currentIndex < 0
    ? direction === "next" ? 0 : queue.length - 1
    : (currentIndex + (direction === "next" ? 1 : -1) + queue.length) % queue.length;
  const targetUri = queue[targetIndex]!;
  const match = SPOTIFY_TRACK_URI.exec(targetUri);
  if (!match) return null;

  return {
    targetId: match[1]!,
    targetUri,
    targetIndex,
    playbackUris: [...queue.slice(targetIndex), ...queue.slice(0, targetIndex)],
  };
}
