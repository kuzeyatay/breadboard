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

  return (
    <div className="desktop-title-bar" aria-label="Breadboard window title bar">
      <span className="desktop-title-bar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/breadboard-icon-20260426.png" alt="" />
        <span>breadboard</span>
      </span>
    </div>
  );
}
