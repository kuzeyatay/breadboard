"use client";

import { createContext } from "react";

/** Lightweight context shared with Markdown without importing the artifact pane. */
export const ArtifactLinkContext = createContext<((href: string) => boolean) | null>(null);

export function artifactLinkTarget(href: string, origin: string) {
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const match = /^\/api\/hermes\/artifacts\/(art_[a-zA-Z0-9-]+)\/(?:download|preview)$/.exec(url.pathname);
    if (!match) return null;
    const rawVersion = url.searchParams.get("version");
    const version = rawVersion === null ? undefined : Number(rawVersion);
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return null;
    return { id: match[1], version };
  } catch { return null; }
}
