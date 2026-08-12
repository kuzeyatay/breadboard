"use client";

// The two video panels: 24/7 news channels and city webcams, both YouTube live
// embeds exactly as upstream worldmonitor does it.
//
// Players mount only while their tab is showing and unmount the moment it is
// not — an iframe left behind keeps decoding video in a hidden panel, which on
// a wall-monitor page is the difference between idle and a hot fan.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  channelUrl,
  embedUrl,
  LIVE_CHANNELS,
  WEBCAM_FEEDS,
  WEBCAM_REGIONS,
  type WebcamRegion,
} from "@/lib/worldmonitor/live-streams.ts";

/**
 * Ask the server what these channels are streaming right now.
 *
 * The catalog's ids are a starting point, not the answer: broadcasters mint a
 * new id every time a 24/7 stream restarts, so a tile built from the shipped id
 * eventually renders "video unavailable". The resolved id replaces it as soon
 * as it arrives, and the shipped one keeps the tile from being blank meanwhile.
 */
function useLiveIds(handles: string[]): {
  ids: Record<string, string>;
  /** Handles the server has answered about, whether or not it found a stream. */
  answered: Set<string>;
} {
  const [state, setState] = useState<{ ids: Record<string, string>; answered: Set<string> }>(
    () => ({ ids: {}, answered: new Set() }),
  );
  const key = [...new Set(handles)].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    fetch(`/api/worldmonitor/live-ids?handles=${encodeURIComponent(key)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("live-ids"))))
      .then((data: { ids?: Record<string, string | null> }) => {
        if (cancelled || !data.ids) return;
        setState((current) => {
          // Merge rather than replace: another tab's resolutions are still good.
          const ids = { ...current.ids };
          const answered = new Set(current.answered);
          for (const [handle, videoId] of Object.entries(data.ids!)) {
            answered.add(handle);
            if (videoId) ids[handle] = videoId;
          }
          return { ids, answered };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

function TileIcon({ path }: { path: string }) {
  return (
    <svg
      className="h-2.5 w-2.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICON_OPEN = "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5";
const ICON_EXPAND = "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5";

/**
 * A live tile. `title` doubles as the label, and the label is always a link
 * out: broadcasters rotate their live video id whenever a stream restarts, and
 * when that happens the embed goes blank — one click on the name lands on the
 * channel's current live page instead.
 *
 * The label sits over the picture the way a broadcast lower-third names its
 * camera, rather than on a strip beneath it: a strip has to be painted in some
 * page colour, and the one background this tile can never predict is the frame
 * it is standing on.
 */
function LiveTile({
  videoId,
  handle,
  title,
  subtitle,
  controls,
  offAir,
  action,
}: {
  videoId: string;
  handle: string;
  title: string;
  subtitle?: string;
  controls?: boolean;
  /** The channel was checked and is not streaming — say so rather than
   *  leaving YouTube's own error to explain it. */
  offAir?: boolean;
  /** Corner control. It lives over the picture because the iframe swallows
   *  every click that reaches it, so a wrapper around the tile can never be
   *  the thing the camera is opened with. */
  action?: { label: string; icon: ReactNode; onClick: () => void };
}) {
  return (
    <div className="bb-wm-tile-video relative overflow-hidden rounded-lg border">
      <iframe
        src={embedUrl(videoId, { controls })}
        title={title}
        className="aspect-video w-full"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />

      <a
        href={channelUrl(handle)}
        target="_blank"
        rel="noopener noreferrer"
        className="bb-wm-video-badge absolute top-1 left-1.5 flex max-w-[calc(100%-3rem)] items-center gap-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wider uppercase"
        title={`Open ${title} live on YouTube`}
      >
        <span className={`bb-wm-live-dot ${offAir ? "is-paused" : ""}`} aria-hidden="true" />
        <span className="truncate">{title}</span>
        {subtitle && <span className="truncate font-medium opacity-75">{subtitle}</span>}
        {offAir && <span className="shrink-0 font-medium opacity-75">off air</span>}
        <span className="shrink-0 opacity-75">
          <TileIcon path={ICON_OPEN} />
        </span>
      </a>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          title={action.label}
          className="bb-wm-video-action absolute top-1 right-1.5 p-1"
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}

/** Upstream's LIVE NEWS panel: a channel rail over one full-size player. */
export function LiveNewsView() {
  const [channelId, setChannelId] = useState(LIVE_CHANNELS[0]!.id);
  const channel = LIVE_CHANNELS.find((entry) => entry.id === channelId) ?? LIVE_CHANNELS[0]!;
  const { ids: liveIds, answered } = useLiveIds(
    useMemo(() => LIVE_CHANNELS.map((entry) => entry.handle), []),
  );
  const videoId = liveIds[channel.handle] ?? channel.videoId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bb-wm-tabs flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1">
        {LIVE_CHANNELS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setChannelId(entry.id)}
            aria-pressed={entry.id === channelId}
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] tracking-wide whitespace-nowrap uppercase ${entry.id === channelId ? "is-selected" : ""}`}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <LiveTile
          key={`${channel.id}:${videoId}`}
          videoId={videoId}
          handle={channel.handle}
          title={channel.name}
          subtitle="live"
          offAir={answered.has(channel.handle) && !liveIds[channel.handle]}
        />
        <p className="bb-wm-ink-faint mt-1.5 px-0.5 text-[0.6rem] leading-relaxed">
          Muted by default — browsers block autoplay with sound. Broadcasters
          rotate stream ids; if a channel is blank, its name opens the live page.
        </p>
      </div>
    </div>
  );
}

/** Upstream's LIVE WEBCAMS panel: region rail over a grid of city cameras. */
export function WebcamsView() {
  const [region, setRegion] = useState<WebcamRegion | "all">("middle-east");
  const [single, setSingle] = useState<string | null>(null);

  const feeds = useMemo(
    () =>
      region === "all" ? WEBCAM_FEEDS : WEBCAM_FEEDS.filter((feed) => feed.region === region),
    [region],
  );

  // Derived, not synced: a camera opened full width is only "open" while the
  // region still contains it, so switching region drops back to the grid
  // without a second render to clean up after the first.
  const opened = single && feeds.some((feed) => feed.id === single) ? single : null;
  const shown = opened ? feeds.filter((feed) => feed.id === opened) : feeds.slice(0, 4);

  // Only the tiles on screen are resolved: a lookup per camera in the catalog
  // would be twenty-odd page fetches to answer a question about four of them.
  const { ids: liveIds, answered } = useLiveIds(
    useMemo(() => shown.map((feed) => feed.handle), [shown]),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bb-wm-tabs flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1">
        {WEBCAM_REGIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setRegion(entry.id)}
            aria-pressed={region === entry.id}
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] tracking-wide whitespace-nowrap uppercase ${region === entry.id ? "is-selected" : ""}`}
          >
            {entry.label}
          </button>
        ))}
        {opened && (
          <button
            type="button"
            onClick={() => setSingle(null)}
            className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] tracking-wide uppercase"
          >
            Grid
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className={opened ? "" : "grid grid-cols-2 gap-1.5"}>
          {shown.map((feed) => (
            <LiveTile
              key={feed.id}
              videoId={liveIds[feed.handle] ?? feed.videoId}
              handle={feed.handle}
              title={feed.city}
              subtitle={feed.country}
              controls={Boolean(opened)}
              offAir={answered.has(feed.handle) && !liveIds[feed.handle]}
              // Only in the grid: the opened tile is playing with YouTube's own
              // controls on, and its chrome claims both top corners on hover.
              // Going back is the rail's Grid button, right above the tile.
              action={
                opened
                  ? undefined
                  : {
                      label: `Open ${feed.city} full width`,
                      icon: <TileIcon path={ICON_EXPAND} />,
                      onClick: () => setSingle(feed.id),
                    }
              }
            />
          ))}
        </div>

        {/* Four at a time is upstream's ceiling too: every extra tile is another
            video decode, and a dozen would stall the page it sits on. */}
        {!opened && feeds.length > 4 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {feeds.slice(4).map((feed) => (
              <button
                key={feed.id}
                type="button"
                onClick={() => setSingle(feed.id)}
                className="neu-button bb-wm-ink-muted rounded-md border px-1.5 py-0.5 text-[0.6rem]"
              >
                {feed.city}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
