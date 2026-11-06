"use client";

import type { ReactNode } from "react";
import { VenetianMask } from "lucide-react";
import BrowserHomeAccessories from "./browser-home-accessories";
import { BrowserQuickLinks } from "./browser-home-widgets";
import PrivateBrowserGreeting from "./private-browser-greeting";
import home from "@/app/new-tab/combined-home.module.css";
import controls from "@/app/new-tab/new-tab-controls.module.css";
import styles from "./browser-private.module.css";

/** Terminal's home layout with the browser's existing private search transport. */
export default function PrivateBrowserHome({ ownerKey, active, navigate, children }: {
  ownerKey: string;
  active: boolean;
  navigate: (url: string) => void;
  children: ReactNode;
}) {
  return (
    <main className={`${home.surface} ${styles.surface} browser-home-widget-surface`} data-private-home>
      <div className={`browser-start-page ${home.rings}`} aria-hidden="true" />
      <div className={`${home.chrome} ${styles.chrome}`}>
        <section className={home.accessories} aria-label="Quick tools and widgets">
          <BrowserHomeAccessories ownerKey={ownerKey} active={active} />
        </section>
      </div>
      <div className={`${home.launchArea} ${styles.launchArea}`}>
        <header className={`${home.heading} ${controls.heading}`}>
          <div className={styles.mode}><VenetianMask size={16} aria-hidden="true" />Private browsing</div>
          <PrivateBrowserGreeting />
        </header>
        <section className={home.launcher} aria-label="Private search and shortcuts">
          {children}
          <BrowserQuickLinks navigate={navigate} ownerKey={ownerKey} active={active} />
        </section>
      </div>
    </main>
  );
}
