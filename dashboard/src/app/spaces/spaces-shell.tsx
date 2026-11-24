"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import NavigationLink from "@/app/components/navigation-link";
import GardenAssistantSwitch from "@/app/components/hermes/garden-assistant-switch";
import styles from "./spaces.module.css";

export interface SpacesGarden { slug: string; name: string }

/**
 * Every Spaces editor (documents, pages, designs, videos) sits under one header, full width,
 * with Bread in the bottom-right corner: the same assistant the Garden uses, which reaches
 * Design and Video through their tool connections. No editor gets an assistant of its own.
 */
export default function SpacesShell({ showFlowers, trail, title, actions, garden, pageKey, initialAssistantOpen = false, children }: {
  showFlowers: boolean;
  trail: string[];
  /** A last breadcrumb the editor owns, such as a name field it renames in place. */
  title?: ReactNode;
  actions?: ReactNode;
  garden: SpacesGarden | null;
  /** The open file (`file:<id>`), so Bread here shares that file's chats with the Garden reader. */
  pageKey?: string;
  initialAssistantOpen?: boolean;
  children: ReactNode;
}) {
  const [assistantWidth, setAssistantWidth] = useState(0);
  // Inside the Garden reader (`embed=1`) the reader already has the file's header and Bread: keep only this editor's own actions.
  if (useSearchParams().get("embed") === "1") return (
    <div className={`${styles.shell} ${styles.embedded}`}>
      {actions && <header className={styles.embeddedBar}><div className={styles.actions}>{actions}</div></header>}
      <div className={styles.body}><div className={styles.stage}>{children}</div></div>
    </div>
  );
  return (
    <div className={styles.shell}>
      <header className={`breadboard-flower-navbar ${styles.navbar}`}>
        <NavbarFlowerWind showFlowers={showFlowers} />
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <NavigationLink href="/spaces" label="Spaces" prefetch={false} className={styles.crumbHome}><ArrowLeft size={15} aria-hidden="true" />Spaces</NavigationLink>
          {trail.filter(Boolean).map((part, index, all) => <span key={index} className={styles.crumbPart}>
            <span aria-hidden="true">/</span>
            <span className={index === all.length - 1 && !title ? styles.crumbTitle : styles.crumbKind} title={part}>{part}</span>
          </span>)}
          {title && <span className={styles.crumbPart}><span aria-hidden="true">/</span>{title}</span>}
        </nav>
        <div className={styles.actions}>{actions}</div>
      </header>
      <div className={styles.body}>
        <div className={styles.stage} style={{ marginRight: assistantWidth }}>{children}</div>
        <GardenAssistantSwitch
          activeClusterSlug={garden?.slug ?? null}
          activeClusterName={garden?.name}
          initialOpen={initialAssistantOpen}
          pageKey={pageKey}
          onPanelWidthChange={setAssistantWidth}
        />
      </div>
    </div>
  );
}
