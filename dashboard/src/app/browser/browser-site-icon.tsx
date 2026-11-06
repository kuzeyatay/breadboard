"use client";
import { useState, type ReactNode } from "react";
export function websiteIconUrl(url: string): string {
  const hostname = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

function websiteIconSources(src?: string, pageUrl?: string): string[] {
  const sources: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !sources.includes(value)) sources.push(value);
  };
  add(src);
  if (!pageUrl) return sources;
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "http:" && page.protocol !== "https:") return sources;
    add(websiteIconUrl(page.toString()));
    add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(page.hostname)}.ico`);
    add(new URL("/favicon.ico", page.origin).toString());
  } catch {
    // A bad page URL cannot invalidate a favicon the shell already supplied.
  }
  return sources;
}

function ResilientSiteImage({ sources, fallback }: { sources: readonly string[]; fallback: ReactNode }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  if (!source) return <span className="browser-site-icon-fallback">{fallback}</span>;
  return (
    <>
    {loadedSource !== source && <span className="browser-site-icon-fallback">{fallback}</span>}
    {/* Site icons come from the website or a favicon service. The existing
        glyph stays usable while they load, without holding up the page. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={source}
      alt=""
      data-startup-optional
      decoding="async"
      style={{ visibility: loadedSource === source ? "visible" : "hidden" }}
      ref={image => { if (image?.complete && image.naturalWidth && loadedSource !== source) setLoadedSource(source); }}
      onLoad={() => setLoadedSource(source)}
      onError={() => setSourceIndex((index) => index + 1)}
    />
    </>
  );
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" {...STROKE} />
      <path d="m12.2 12.2 4 4" {...STROKE} />
    </svg>
  );
}

export function GoogleGlyph() {
  return <span className="browser-google-glyph" aria-hidden="true">G</span>;
}

export function BrowserSiteIcon({
  src,
  fallback,
  className,
  pageUrl,
}: {
  src?: string;
  fallback: ReactNode;
  className?: string;
  pageUrl?: string;
}) {
  const sources = websiteIconSources(src, pageUrl);
  return (
    <span className={`browser-site-icon ${className ?? ""}`} aria-hidden="true">
      <ResilientSiteImage key={sources.join("\n")} sources={sources} fallback={fallback} />
    </span>
  );
}

