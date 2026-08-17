"use client";

import { useEffect } from "react";

export default function DesktopTitleBar() {
  useEffect(() => {
    if (!("breadboardDesktop" in window)) return;
    // The inline script in the document head normally sets this before the first
    // paint, which is what keeps the caption strip from arriving a few frames
    // late. This is only the fallback for a session where that script did not
    // run, so it cleans up nothing it did not set itself.
    if (document.documentElement.dataset.breadboardDesktop === "true") return;
    document.documentElement.dataset.breadboardDesktop = "true";
    return () => {
      delete document.documentElement.dataset.breadboardDesktop;
    };
  }, []);

  return <div className="desktop-title-bar" aria-label="Window controls" />;
}
