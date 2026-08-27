"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { finishInteractionHydration } from "./interaction-hydration-bridge";

/**
 * Marks the page interactive only after this complete child tree has hydrated.
 * The head bridge replays any earlier click once, while this fragment keeps page
 * shells as direct body children for the existing desktop layout selectors.
 */
export default function InteractionHydrationGate({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    finishInteractionHydration(window);
  }, []);

  return <>{children}</>;
}
