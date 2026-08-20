"use client";

// Buzz rewrites media URLs onto whichever relay the client is connected to.
// Member avatars here are already local or absolute, so the URL stands as-is.

export function rewriteRelayUrl(url: string): string {
  return url;
}
