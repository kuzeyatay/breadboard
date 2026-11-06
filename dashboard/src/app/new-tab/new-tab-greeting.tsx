"use client";

import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { desktopTabsBridge } from "@/lib/desktop-browser-tabs";
import { useGreetingTypewriter } from "@/app/components/use-greeting-typewriter";
import styles from "./new-tab-controls.module.css";

const PREFIX = "Where to, ";

export default function NewTabGreeting({ addressee }: { addressee: string }) {
  const target = `${PREFIX}${addressee}?`;
  const tabs = useDesktopTabs();
  // Selection can precede presentation while Electron prepares the next page.
  // Wait for the actual reveal, including when the tab was prewarmed offscreen.
  const presentedId = tabs?.visibleId ?? tabs?.presentedId ?? tabs?.activeId;
  const visible = tabs
    ? !tabs.preparingNewTab && tabs.presentationStatus !== "pending" && tabs.selfId != null && tabs.selfId === tabs.activeId && tabs.selfId === presentedId
    : !desktopTabsBridge();
  const { displayed, animating } = useGreetingTypewriter(target, target, {
    enabled: visible,
    animateInitial: true,
  });

  return (
    <h1 className={styles.greeting} data-animating={animating}>
      <span className="sr-only">{target}</span>
      <span className={styles.greetingSizer} aria-hidden="true">{target}</span>
      <span className={styles.greetingText} aria-hidden="true">
        {displayed.slice(0, PREFIX.length) || "\u00a0"}
        <span className={styles.addressee}>{displayed.slice(PREFIX.length)}</span>
        {animating ? <span className="browser-greeting-caret" /> : null}
      </span>
    </h1>
  );
}
