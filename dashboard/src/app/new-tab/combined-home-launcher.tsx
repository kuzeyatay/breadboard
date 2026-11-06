"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ListTodo, Settings, Timer, UsersRound } from "lucide-react";
import BrowserHomeAccessories from "@/app/browser/browser-home-accessories";
import SavedBrowserBookmarksBar from "@/app/browser/browser-bookmarks-bar";
import { BrowserQuickLinks } from "@/app/browser/browser-home-widgets";
import NavigationLink from "@/app/components/navigation-link";
import VoiceShortcut from "@/app/components/voice-shortcut";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { useStartupLoading } from "@/app/components/startup-readiness";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import { desktopTabsBridge, navigateBrowserFromHome } from "@/lib/desktop-browser-tabs";
import type { NewTabGarden } from "@/lib/new-tab-gardens";
import type { SearchHistoryEntry } from "@/lib/new-tab-search-suggestions";
import NewTabGreeting from "./new-tab-greeting";
import NewTabNotepad from "./new-tab-notepad";
import NewTabSearch from "./new-tab-search";
import ProviderUsageNotch from "./provider-usage-notch";
import { useNewTabAddressee } from "./use-new-tab-addressee";
import controls from "./new-tab-controls.module.css";
import styles from "./combined-home.module.css";

export interface CombinedHomeData {
  gardens: NewTabGarden[];
  initialSearchHistory: SearchHistoryEntry[];
  addressee: string;
  greetingOwnerKey: string;
  widgetOwnerKey: string;
}

const PLACES = [
  { href: "/plan", label: "Plan", icon: ListTodo },
  { href: "/buzz", label: "Organization", icon: UsersRound },
  { href: "/pomodoro", label: "Work Timer", icon: Timer },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Compose the live controls. Their data stores and UI remain the originals. */
export default function CombinedHomeLauncher({ data, navigation }: { data: CombinedHomeData; navigation: ReactNode }) {
  const tabs = useDesktopTabs();
  const active = tabs ? tabs.selfId === tabs.activeId : !desktopTabsBridge();
  useStartupLoading(!tabs && Boolean(desktopTabsBridge()));
  const nativeToolbar = Boolean(tabs?.persistentShell && tabs.tabs.find(tab => tab.id === tabs.selfId)?.browser);
  const [gardens, setGardens] = useState(data.gardens);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const addressee = useNewTabAddressee(data.addressee, data.greetingOwnerKey);
  const chrome = useRef<HTMLDivElement>(null);
  const launchArea = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLElement>(null);
  const notch = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const alignNotch = () => {
      if (!launcher.current || !notch.current) return;
      let top = launcher.current.getBoundingClientRect().top;
      let parent = launcher.current.parentElement;
      // Fixed elements belong to the viewport, or to a transformed split pane.
      // Recover the resting position even when this page is already scrolled.
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (getComputedStyle(parent).transform !== "none") {
          top -= parent.getBoundingClientRect().top;
          break;
        }
        top += parent.scrollTop;
        parent = parent.parentElement;
      }
      if (!parent || parent === document.body || parent === document.documentElement) top += window.scrollY;
      notch.current.style.setProperty("--provider-notch-top", `${top}px`);
    };
    alignNotch();
    const observer = new ResizeObserver(alignNotch);
    if (chrome.current) observer.observe(chrome.current);
    if (launchArea.current) observer.observe(launchArea.current);
    window.addEventListener("resize", alignNotch);
    return () => { observer.disconnect(); window.removeEventListener("resize", alignNotch); };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetch("/api/new-tab/gardens", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (!controller.signal.aborted && Array.isArray(result?.gardens)) setGardens(result.gardens); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, data.gardens]);

  async function navigate(url: string) {
    setNavigationError(null);
    startNavigationProgress();
    if (!desktopTabsBridge()) {
      window.location.assign(url);
      return;
    }
    const opened = await navigateBrowserFromHome(url, tabs).catch(() => false);
    cancelNavigationProgress();
    if (!opened) {
      setNavigationError(url);
    }
  }

  return (
    <>
      <div ref={chrome} className={styles.chrome}>
        {!nativeToolbar && navigation}
        {!nativeToolbar && <SavedBrowserBookmarksBar ownerKey={data.widgetOwnerKey} navigate={url => void navigate(url)} />}
        <section className={styles.accessories} aria-label="Quick tools and widgets">
          <BrowserHomeAccessories ownerKey={data.widgetOwnerKey} active={active} preparing={tabs?.preparingNewTab} />
        </section>
      </div>
      <NewTabNotepad key={data.widgetOwnerKey} ownerKey={data.widgetOwnerKey} topAnchorRef={chrome} />
      <div ref={launchArea} className={styles.launchArea} data-searching={searching || undefined}>
        <header className={`${styles.heading} ${controls.heading}`}><NewTabGreeting addressee={addressee} /></header>
        <section ref={launcher} className={styles.launcher} aria-label="Search and shortcuts">
          <NewTabSearch ownerKey={data.greetingOwnerKey} browserOwnerKey={data.widgetOwnerKey} gardens={gardens} initialHistory={data.initialSearchHistory} active={active} onSearchingChange={setSearching}>
            <nav id="new-tab-places" aria-label="Places" className={controls.places}>
              {PLACES.map(({ href, label, icon: Icon }) => (
                <NavigationLink key={href} href={href} label={label} prefetch={false} className={controls.destinationButton}>
                  <Icon size={15} aria-hidden="true" />{label}
                </NavigationLink>
              ))}
              <VoiceShortcut className={controls.destinationButton} errorClassName={controls.browserError} />
            </nav>
            <BrowserQuickLinks navigate={url => void navigate(url)} ownerKey={data.widgetOwnerKey} active={active} />
            {navigationError && <p role="alert" className={controls.browserError}>Couldn’t open this website. <button type="button" onClick={() => void navigate(navigationError)}>Try again</button></p>}
          </NewTabSearch>
        </section>
        <div ref={notch} className={styles.notchAnchor}><ProviderUsageNotch /></div>
      </div>
    </>
  );
}
