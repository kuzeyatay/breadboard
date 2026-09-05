"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarDays, ChevronDown, Compass, Globe2, LayoutGrid, ListTodo, PanelsTopLeft, Search, UserRound, UsersRound, X, type LucideIcon } from "lucide-react";
import BrowserHomeAccessories from "@/app/browser/browser-home-accessories";
import { BrowserSketchOutline } from "@/app/browser/browser-home-widgets";
import LinkContextMenu from "@/app/components/link-context-menu";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { usePageAppearance } from "@/app/components/use-page-appearance";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import styles from "./new-tab-controls.module.css";
import { useNewTabAddressee } from "./use-new-tab-addressee";
import NewTabGreeting from "./new-tab-greeting";
import PageAppearance from "@/app/components/page-appearance";

export interface NewTabGarden {
  slug: string;
  name: string;
  noteCount: number;
  lastViewedAt: string | null;
  borderColor: string;
}

interface Place {
  href: string;
  label: string;
  icon: LucideIcon;
}

const PLACES: Place[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/plan", label: "Plan", icon: ListTodo },
  { href: "/buzz", label: "Organization", icon: UsersRound },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/profile", label: "Profile", icon: UserRound },
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
      <button type="button" className={styles.destinationButton} disabled={busy} aria-busy={busy} onClick={() => void openBrowser()}>
        <Globe2 aria-hidden="true" size={15} />
        Browser
      </button>
      {failed && <p role="alert" className={styles.browserError}>Couldn’t open Browser. Try again.</p>}
    </>
  );
}

export default function NewTabClient({
  gardens,
  addressee: initialAddressee,
  greetingOwnerKey = "local",
  widgetOwnerKey = greetingOwnerKey,
}: {
  gardens: NewTabGarden[];
  addressee: string;
  greetingOwnerKey?: string;
  widgetOwnerKey?: string;
}) {
  const addressee = useNewTabAddressee(initialAddressee, greetingOwnerKey);
  const appearance = usePageAppearance(widgetOwnerKey, "new-tab");
  const backgroundImage = appearance.wallpaper?.src;
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchFrameRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const matchingPlaces = PLACES.filter((place) => place.label.toLowerCase().includes(needle));
  // Filter creates a new array, so sorting never changes the supplied gardens.
  // Never-opened gardens keep their creation order.
  const sortedGardens = gardens
    .filter((garden) => garden.name.toLowerCase().includes(needle))
    .sort((left, right) =>
      (right.lastViewedAt ?? "").localeCompare(left.lastViewedAt ?? ""),
    );
  const visibleGardens = showAll || needle ? sortedGardens : sortedGardens.slice(0, RECENT_GARDEN_LIMIT);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  return (
    <main
      className={`${styles.surface} browser-home-widget-surface`}
      style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      <div className="browser-home-rings" aria-hidden="true" />
      <PageAppearance page="new-tab" ownerKey={widgetOwnerKey} />
      <div className={styles.launcher}>
        <header className={styles.heading}>
          <NewTabGreeting addressee={addressee} />
        </header>

        <div ref={searchFrameRef} className={styles.search} role="search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") clearSearch(); }}
            placeholder="Find a garden or a place…"
            aria-label="Find a garden or a place"
            aria-controls="new-tab-garden-list new-tab-places"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={clearSearch} aria-label="Clear search" className={styles.clearSearch}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <BrowserSketchOutline targetRef={searchFrameRef} index={0} />
        </div>

        <nav id="new-tab-places" aria-label="Places" className={styles.places}>
          {matchingPlaces.map(({ href, label, icon: Icon }) => (
            <LinkContextMenu key={href} href={href} label={label}>
              <Link href={href} className={styles.destinationButton}>
                <Icon size={15} aria-hidden="true" />
                {label}
              </Link>
            </LinkContextMenu>
          ))}
          <BrowserShortcut query={needle} />
        </nav>

        <section aria-labelledby="new-tab-gardens" className={styles.gardens}>
          <div className={styles.sectionHeading}>
            <h2 id="new-tab-gardens">{needle ? "Matching Gardens" : "Your Gardens"}</h2>
            <span className={styles.gardenCount} aria-live="polite" aria-atomic="true">
              {needle ? `${sortedGardens.length} found` : `${gardens.length}`}
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
                      <span className={styles.noteCount}>{garden.noteCount} {garden.noteCount === 1 ? "note" : "notes"}</span>
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
          {!needle && gardens.length > RECENT_GARDEN_LIMIT && (
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
      </div>
      <BrowserHomeAccessories ownerKey={widgetOwnerKey} />
    </main>
  );
}
