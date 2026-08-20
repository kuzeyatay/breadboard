"use client";

// Buzz serves animated avatars as a poster/animation pair from its own relay.
// Nothing here produces that shape, so every avatar is a still image.

export function parseAnimatedAvatarUrl(
  _url: string | null,
): { posterUrl: string; animationUrl: string } | null {
  return null;
}
