"use client";

import Link from "next/link";
import { useEffect, useState, type AriaAttributes, type ComponentType } from "react";
import { ChevronDown, Compass, Globe2, LayoutGrid, ListTodo, PanelsTopLeft, Settings, Timer, UsersRound } from "lucide-react";
import VSCodeIcon from "@/app/components/vscode-icon";
import BrowserHomeAccessories from "@/app/browser/browser-home-accessories";
import LinkContextMenu from "@/app/components/link-context-menu";
import NavigationLink from "@/app/components/navigation-link";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { usePageAppearance } from "@/app/components/use-page-appearance";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import styles from "./new-tab-controls.module.css";
import { useNewTabAddressee } from "./use-new-tab-addressee";
import NewTabGreeting from "./new-tab-greeting";
import NewTabNotepad from "./new-tab-notepad";
import ProviderUsageNotch from "./provider-usage-notch";
import PageAppearance from "@/app/components/page-appearance";
import SpotifyAmbientBackground from "@/app/components/spotify-ambient-background";
import AsciiArtwork from "@/app/components/ascii-artwork";
import RainBackground from "@/app/components/rain-background";
import { SpotifyAmbientProvider } from "@/app/components/spotify-ambient-context";
import VoiceShortcut from "@/app/components/voice-shortcut";
import GestureShortcut from "@/app/components/gesture-shortcut";
import ScreenTimeShortcut from "@/app/components/screen-time-shortcut";
import NewTabSearch from "./new-tab-search";
import type { NewTabGarden } from "@/lib/new-tab-gardens";
import type { SearchHistoryEntry } from "@/lib/new-tab-search-suggestions";
export type { NewTabGarden } from "@/lib/new-tab-gardens";

interface Place {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: AriaAttributes["aria-hidden"] }>;
}

const PLACES: Place[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/plan", label: "Plan", icon: ListTodo },
  { href: "/code", label: "Code", icon: VSCodeIcon },
  { href: "/buzz", label: "Organization", icon: UsersRound },
  { href: "/pomodoro", label: "Work Timer", icon: Timer },
  { href: "/settings", label: "Settings", icon: Settings },
];

const RECENT_GARDEN_LIMIT = 6;

/** The shell replaces this tab with its sandboxed browser. */
function BrowserShortcut({ query }: { query: string }) {
  const tabs = useDesktopTabs();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!tabs?.enabled) return null;
  if (!"browser".includes(query)) return null;

  async function openBrowser() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    startNavigationProgress();
    let opened = false;
    try {
      opened = await openBrowserInDesktop({ replaceCurrent: true });
    } catch {
      // A failed desktop handoff leaves this page available for another try.
    } finally {
      if (!opened) {
        cancelNavigationProgress();
        setFailed(true);
        setBusy(false);
      }
    }
  }

  return (
    <>
      <LinkContextMenu href="/browser" label="Browser">
        <button type="button" className={styles.destinationButton} disabled={busy} aria-busy={busy} onClick={() => void openBrowser()}>
          <Globe2 aria-hidden="true" size={15} />
          Browser
        </button>
      </LinkContextMenu>
      {failed && <p role="alert" className={styles.browserError}>Couldn’t open Browser. Try again.</p>}
    </>
  );
}

export default function NewTabClient({
  gardens: initialGardens,
  initialSearchHistory,
  addressee: initialAddressee,
  greetingOwnerKey = "local",
  widgetOwnerKey = greetingOwnerKey,
}: {
  gardens: NewTabGarden[];
  initialSearchHistory: SearchHistoryEntry[];
  addressee: string;
  greetingOwnerKey?: string;
  widgetOwnerKey?: string;
}) {
  const [gardens, setGardens] = useState(initialGardens);
  const tabs = useDesktopTabs();
  const active = tabs
    ? tabs.selfId === tabs.activeId
    : typeof window !== "undefined" && !("breadboardDesktop" in window);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // Counts and changes made in another tab arrive after the launcher.
    void fetch("/api/new-tab/gardens", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted && Array.isArray(data?.gardens)) setGardens(data.gardens); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active]);
  const addressee = useNewTabAddressee(initialAddressee, greetingOwnerKey);
  const appearance = usePageAppearance(widgetOwnerKey, "new-tab");
  const backgroundImage = appearance.wallpaper?.src;
  const [showAll, setShowAll] = useState(false);
  const [searching, setSearching] = useState(false);
  // Copy the array so sorting never changes the supplied gardens.
  // Never-opened gardens keep their creation order.
  const sortedGardens = [...gardens]
    .sort((left, right) =>
      (right.lastViewedAt ?? "").localeCompare(left.lastViewedAt ?? ""),
    );
  const visibleGardens = showAll ? sortedGardens : sortedGardens.slice(0, RECENT_GARDEN_LIMIT);

  return (
    <SpotifyAmbientProvider ownerKey={widgetOwnerKey}>
    <main
      className={`${styles.surface} browser-home-widget-surface`}
      data-wallpaper-ready={appearance.ready}
      data-wallpaper-tone={appearance.asciiBackground ? "dark" : appearance.ambientBackground ? appearance.theme : backgroundImage ? appearance.wallpaperTone : undefined}
      style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {(appearance.ambientBackground || appearance.asciiBackground || appearance.rainMode !== "off") && <div className={styles.ambientBackdrop}>
        {appearance.ambientBackground && <SpotifyAmbientBackground theme={appearance.theme} spotifyColors={appearance.spotifyBackground} randomColors={appearance.randomColorsBackground} />}
        {appearance.asciiBackground && <AsciiArtwork slug={appearance.asciiBackground} />}
        {appearance.rainMode !== "off" && <RainBackground theme={appearance.theme} mode={appearance.rainMode} />}
      </div>}
      <PageAppearance page="new-tab" ownerKey={widgetOwnerKey} />
      <div className={styles.launcher} data-searching={searching || undefined}>
        <header className={styles.heading}>
          <NewTabGreeting addressee={addressee} />
        </header>

        <NewTabSearch key={greetingOwnerKey} ownerKey={greetingOwnerKey} gardens={gardens} initialHistory={initialSearchHistory} active={active} onSearchingChange={setSearching}>
        <nav id="new-tab-places" aria-label="Places" className={styles.places}>
          {PLACES.map(({ href, label, icon: Icon }) => (
            <NavigationLink key={href} href={href} label={label} newTab={href === "/code"} className={styles.destinationButton}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </NavigationLink>
          ))}
          <BrowserShortcut query="" />
          <VoiceShortcut className={styles.destinationButton} errorClassName={styles.browserError} />
          <GestureShortcut className={styles.destinationButton} />
              <ScreenTimeShortcut className={styles.destinationButton} />
        </nav>

        <section aria-labelledby="new-tab-gardens" className={styles.gardens}>
          <div className={styles.sectionHeading}>
            <h2 id="new-tab-gardens">Your Gardens</h2>
            <span className={styles.gardenCount} aria-live="polite" aria-atomic="true">
              {gardens.length}
            </span>
          </div>
          <ul id="new-tab-garden-list" className={styles.gardenList}>
            {visibleGardens.map((garden) => {
              const workspace = `/gardens/${garden.slug}`;
              const explore = `/garden/${garden.slug}`;
              return (
                <li key={garden.slug} className={styles.gardenRow}>
                  <div className={styles.gardenIdentity}>
                    <span className={styles.gardenDot} style={{ backgroundColor: garden.borderColor }} aria-hidden="true" />
                    <span className={styles.gardenInfo}>
                      <span className={styles.gardenName} title={garden.name}>{garden.name}</span>
                      <span className={styles.noteCount}>{garden.noteCount === null ? "\u00a0" : `${garden.noteCount} ${garden.noteCount === 1 ? "note" : "notes"}`}</span>
                    </span>
                  </div>
                  <LinkContextMenu href={workspace} label={`${garden.name} workspace`}>
                    <Link href={workspace} className={styles.gardenAction} aria-label={`${garden.name} workspace`} title={`${garden.name} workspace`}>
                      <PanelsTopLeft size={17} strokeWidth={1.5} aria-hidden="true" />
                    </Link>
                  </LinkContextMenu>
                  <LinkContextMenu href={explore} label={`Explore ${garden.name}`}>
                    <Link href={explore} className={styles.gardenAction} aria-label={`Explore ${garden.name}`} title={`Explore ${garden.name}`}>
                      <Compass size={17} strokeWidth={1.5} aria-hidden="true" />
                    </Link>
                  </LinkContextMenu>
                </li>
              );
            })}
          </ul>
          {sortedGardens.length === 0 && (
            <p className={styles.emptyState}>
              {gardens.length === 0 ? (
                <>A little room to grow. <Link href="/dashboard">Create your first garden</Link></>
              ) : "No gardens found. Try another name."}
            </p>
          )}
          {gardens.length > RECENT_GARDEN_LIMIT && (
            <button
              type="button"
              className={styles.showAll}
              aria-expanded={showAll}
              aria-controls="new-tab-garden-list"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Show fewer" : `All ${gardens.length} gardens`}
              <ChevronDown size={14} aria-hidden="true" className={showAll ? styles.chevronUp : undefined} />
            </button>
          )}
        </section>
        </NewTabSearch>
      </div>
      <NewTabNotepad key={widgetOwnerKey} ownerKey={widgetOwnerKey} />
      <ProviderUsageNotch key={`usage-${widgetOwnerKey}`} />
      <BrowserHomeAccessories ownerKey={widgetOwnerKey} />
    </main>
    </SpotifyAmbientProvider>
  );
}
