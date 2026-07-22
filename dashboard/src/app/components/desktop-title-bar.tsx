"use client";

import { useEffect } from "react";

export default function DesktopTitleBar() {
  useEffect(() => {
    if (!("breadboardDesktop" in window)) return;
    document.documentElement.dataset.breadboardDesktop = "true";
    return () => {
      delete document.documentElement.dataset.breadboardDesktop;
    };
  }, []);

  return <div className="desktop-title-bar" aria-label="Window controls" />;
}
