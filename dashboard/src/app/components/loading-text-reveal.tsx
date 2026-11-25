"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

/** Attach to the text that replaces a loading indicator. A cached result or
 * virtualized row that mounts already populated should be readable at once. */
export function useLoadingTextReveal(loading: boolean) {
  const wasLoading = useRef(loading);
  const targets = useRef(new Set<HTMLElement>());

  useLayoutEffect(() => {
    const finished = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!finished) return;

    const nodes = targets.current;
    for (const node of nodes) node.setAttribute("data-loading-text-reveal", "");
    return () => {
      for (const node of nodes) node.removeAttribute("data-loading-text-reveal");
    };
  }, [loading]);

  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const nodes = targets.current;
    nodes.add(node);
    return () => { nodes.delete(node); };
  }, []);
}

/** Keep this slot mounted while a reply is pending so only its first text fades. */
export function ReplyText({ children, className }: { children: ReactNode; className?: string }) {
  const reveal = useLoadingTextReveal(!children);
  return children ? <div ref={reveal} className={className}>{children}</div> : null;
}
