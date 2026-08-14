"use client";

// Where a surface wants artifacts to open.
//
// The Terminal is a dock along the bottom of the page, not a page of its own,
// so an artifact opened from it must stay inside that dock — a panel pinned to
// the viewport would float free of the chat it belongs to and cover the app
// above it. A surface that can host the panel itself hands a lane element down
// through this context; the viewer portals into it and lets the surface's own
// flex row do the splitting. Surfaces that are whole pages (the Garden
// workspace) offer no lane, and the viewer falls back to its own fixed panel.

import { createContext, useContext, type ReactNode } from "react";

const ArtifactDockHostContext = createContext<HTMLElement | null>(null);

/** The lane this surface offers, or null when it has none to give. */
export function useArtifactDockHost(): HTMLElement | null {
  return useContext(ArtifactDockHostContext);
}

export function ArtifactDockHostProvider({
  host,
  children,
}: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <ArtifactDockHostContext.Provider value={host}>
      {children}
    </ArtifactDockHostContext.Provider>
  );
}
