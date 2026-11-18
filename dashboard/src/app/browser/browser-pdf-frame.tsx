"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePageLoading } from "@/app/components/use-page-loading";

/** The reader runs in its own document so its shortcuts, selection and print
 * controls belong to this PDF even when several browser panes are alive. */
export default function BrowserPdfFrame({ viewer, title, active, temporary, style }: {
  viewer: string; title: string; active: boolean; temporary?: boolean; style?: CSSProperties;
}) {
  const observer = useRef<MutationObserver | null>(null);
  const [pending, setPending] = useState(true);
  usePageLoading(active && pending);
  useEffect(() => () => observer.current?.disconnect(), []);
  const url = new URL(viewer, "http://localhost");
  url.searchParams.set("embedded", "browser");
  if (temporary) url.searchParams.set("temporary", "1");
  return <div className="browser-pdf-viewport" style={style}>
    <iframe title={title} src={url.pathname + url.search + url.hash} onLoad={event => {
      observer.current?.disconnect();
      const reader = event.currentTarget.contentDocument?.querySelector("[data-browser-pdf]");
      if (!reader) { setPending(false); return; }
      const update = () => setPending(reader.getAttribute("aria-busy") === "true");
      observer.current = new MutationObserver(update);
      observer.current.observe(reader, { attributes: true, attributeFilter: ["aria-busy"] });
      update();
    }} />
  </div>;
}
