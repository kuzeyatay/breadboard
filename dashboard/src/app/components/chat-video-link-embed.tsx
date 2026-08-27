"use client";

// A video link pasted into a chat message, rendered as a playable card.
//
// Attaching a video file already shows a player (chat-message-attachments.tsx),
// but a pasted YouTube link rendered as bare text — the video was only viewable
// after an editing flow downloaded it. This closes that gap without downloading
// anything: a YouTube link becomes a click-to-play embed (thumbnail first, the
// iframe only after a click, so a transcript full of links stays light and the
// virtualized row height never shifts), a TikTok or Instagram link becomes the
// same facade in a vertical card, and a direct media URL becomes a <video>
// element that streams from its origin.
//
// Identity comes from video-sources/identity.ts — the same module the composer
// and the Watch skill use to decide what counts as "a video link" — so this
// card appears for exactly the links the runtime would act on.

import { useMemo, useState } from "react";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";
import type { ChatMessageAttachment } from "@/lib/chat-attachments";
import { videoSourceFor, videoUrlsIn, type VideoSource } from "@/lib/video-sources/identity";

interface Props {
  /** The message text the links were pasted into. */
  text?: string;
  /**
   * The message's attachments. When an editing flow has already attached the
   * downloaded file, that card is the richer player — skip the embed rather
   * than show the same video twice.
   */
  attachments?: readonly ChatMessageAttachment[];
}

const MAX_EMBEDS = 3;

const PROVIDER_NAME: Record<VideoSource["provider"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  web: "Video",
};

function youtubeVideoId(source: VideoSource): string | null {
  return source.provider === "youtube" && source.key.startsWith("youtube:")
    ? source.key.slice("youtube:".length)
    : null;
}

function PlayGlyph() {
  return (
    <span className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white shadow-lg transition group-hover:scale-105 group-hover:bg-black/75">
      <svg className="h-6 w-6 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5.5v13l11-6.5-11-6.5Z" />
      </svg>
    </span>
  );
}

function YouTubeEmbed({ source }: { source: VideoSource }) {
  const [playing, setPlaying] = useState(false);
  const videoId = youtubeVideoId(source);
  if (!videoId) return null;
  return (
    // A fixed 16:9 box whether it holds the thumbnail or the iframe: the
    // virtualized transcript measures this row once and the height never moves.
    <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={`YouTube video ${videoId}`}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 grid w-full cursor-pointer place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
          aria-label="Play video"
        >
          {/* Thumbnails come straight from YouTube's CDN; nothing else loads until play. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          <PlayGlyph />
        </button>
      )}
    </div>
  );
}

/**
 * TikTok and Instagram in a click-to-load vertical card. Neither exposes a
 * tokenless thumbnail CDN the way YouTube does, so the facade is a branded
 * placeholder instead of a preview frame — still a fixed-height box, still
 * zero network until the click.
 */
function VerticalEmbed({ source }: { source: VideoSource }) {
  const [playing, setPlaying] = useState(false);
  const embedUrl =
    source.provider === "tiktok"
      ? // The documented Player embed; autoplay is honored because the iframe
        // only exists after a click, which is a user gesture.
        `https://www.tiktok.com/player/v1/${source.key.slice("tiktok:".length)}?autoplay=1`
      : // canonicalUrl already ends with a slash: …/reel/<code>/embed/
        `${source.canonicalUrl}embed/`;
  return (
    // 9:16 like the videos themselves; fixed whether facade or iframe, so the
    // virtualized transcript measures this row once.
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[18px] bg-black">
      {playing ? (
        <iframe
          src={embedUrl}
          title={`${PROVIDER_NAME[source.provider]} video ${source.label}`}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 grid w-full cursor-pointer place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
          aria-label="Play video"
        >
          <span className="absolute inset-0 bg-gradient-to-b from-neutral-800 via-black to-neutral-900" />
          <span className="relative flex flex-col items-center gap-3">
            <PlayGlyph />
            <span className="text-xs font-medium tracking-wide text-white/70">
              {PROVIDER_NAME[source.provider]} · {source.label}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

export default function ChatVideoLinkEmbeds({ text, attachments }: Props) {
  const sources = useMemo(() => {
    if (!text) return [];
    // The downloaded copy (an editing flow's attachment) already shows a
    // player for this video; a second card for the link would be a duplicate.
    if (attachments?.some((attachment) => attachment.type === "video")) return [];
    const seen = new Set<string>();
    const found: VideoSource[] = [];
    for (const url of videoUrlsIn(text)) {
      const source = videoSourceFor(url);
      if (!source || seen.has(source.key)) continue;
      seen.add(source.key);
      found.push(source);
      if (found.length >= MAX_EMBEDS) break;
    }
    return found;
  }, [attachments, text]);

  if (sources.length === 0) return null;

  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {sources.map((source) => {
        const vertical = source.provider === "tiktok" || source.provider === "instagram";
        return (
          <div
            key={source.key}
            className={`neu-surface-raised w-full overflow-hidden rounded-[22px] border border-[var(--line)] p-1 ${
              // Vertical video in a 32rem-wide card would tower over the
              // transcript; a narrower card keeps 9:16 at a sane height.
              vertical ? "max-w-[min(17rem,64vw)]" : "max-w-[min(32rem,72vw)]"
            }`}
          >
            {source.provider === "youtube" ? (
              <YouTubeEmbed source={source} />
            ) : vertical ? (
              <VerticalEmbed source={source} />
            ) : (
              <ReclaimingVideo
                controls
                // The file can be gigabytes; nothing is fetched until played.
                preload="metadata"
                src={source.canonicalUrl}
                className="block max-h-80 w-full rounded-[18px] bg-black"
              />
            )}
            <a
              href={source.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate px-2 pb-1 pt-1.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink-heading)] hover:underline"
              title={source.originalUrl}
            >
              {PROVIDER_NAME[source.provider]} · {source.label} ↗
            </a>
          </div>
        );
      })}
    </div>
  );
}
