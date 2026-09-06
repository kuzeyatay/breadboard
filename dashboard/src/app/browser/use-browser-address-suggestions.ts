"use client";

import { useLayoutEffect, useRef } from "react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

/** The native page cannot sit over the trusted dropdown. Reserve only the
 * dropdown's measured bottom edge, including changes to its results or size. */
export function useBrowserAddressSuggestions(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dropdown = ref.current;
    if (!open || !dropdown) {
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
      return;
    }

    let lastBottom = -1;
    const measure = () => {
      // Exclude the entrance translation while preserving fractional borders
      // and font metrics at the display's scale factor.
      const transform = getComputedStyle(dropdown).transform;
      const translateY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      const bottom = Math.ceil(dropdown.getBoundingClientRect().bottom - translateY);
      if (bottom === lastBottom) return;
      lastBottom = bottom;
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: true, bottom });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dropdown);
    if (dropdown.offsetParent) observer.observe(dropdown.offsetParent);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
    };
  }, [open]);

  return ref;
}
