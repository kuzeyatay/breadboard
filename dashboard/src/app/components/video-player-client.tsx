"use client";

// Breadboard's full-page video player.
//
// A dashboard address that answers with video bytes — an artifact preview, a
// garden media asset, a chat attachment — used to open in whatever the frame
// fell back to: Chromium's bare media viewer on a black page, with none of the
// app's chrome and no way back. This is the reader those addresses land in
// instead, the way `/pdf` is for PDFs. Playback itself is the shared
// BreadboardVideoPlayer; this page only adds the header around it.

import { useCallback, useRef } from "react";
import { ArrowLeft, Download, X } from "lucide-react";
import BreadboardVideoPlayer from "@/app/components/breadboard-video-player";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "./use-desktop-tabs";
import styles from "./video-player-client.module.css";

interface Props {
  /** Visible name of the video. */
  title: string;
  /** Same-origin address serving the video bytes. */
  sourceUrl: string;
  /** Where the back control goes; the browser's own history when absent. */
  backHref?: string;
  showNavbarFlowers?: boolean;
}

export default function VideoPlayerClient({
  title,
  sourceUrl,
  backHref,
  showNavbarFlowers = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tabs = useDesktopTabs();

  const goBack = useCallback(() => {
    videoRef.current?.pause();
    if (backHref) window.location.assign(backHref);
    else if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  }, [backHref]);

  const exitPlayer = useCallback(async () => {
    videoRef.current?.pause();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    // Address this player explicitly so a delayed command cannot close another tab.
    if (
      tabs?.enabled && tabs.selfId != null &&
      await sendDesktopTabsCommand({ type: "close", id: tabs.selfId })
    ) return;
    goBack();
  }, [goBack, tabs]);

  return (
    <div className={styles.player}>
      <header className={styles.header}>
        {showNavbarFlowers ? <NavbarFlowerWind /> : null}
        <button type="button" onClick={goBack} className={styles.button} aria-label="Back">
          <ArrowLeft aria-hidden="true" size={18} /><span className={styles.optionalLabel}>Back</span>
        </button>
        <div className={styles.heading}>
          <h1 className={styles.title} title={title}>
            {title}
          </h1>
        </div>
        <a
          href={sourceUrl}
          download
          className={styles.button}
          aria-label="Download video"
        >
          <Download aria-hidden="true" size={18} /><span className={styles.optionalLabel}>Download</span>
        </a>
        <button type="button" onClick={() => void exitPlayer()} className={styles.button} aria-label="Exit player" title="Exit player">
          <X aria-hidden="true" size={18} /> Exit
        </button>
      </header>

      <div className={styles.stage}>
        <BreadboardVideoPlayer
          src={sourceUrl}
          title={title}
          elementRef={videoRef}
          ownsKeyboard
          className={styles.video}
        />
      </div>
    </div>
  );
}
