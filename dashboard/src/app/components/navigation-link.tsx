"use client";

import Link from "next/link";
import { useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { desktopTabsBridge, openInDesktopTab } from "@/lib/desktop-browser-tabs";
import { subscribeToTrail, withProfileReturnTo } from "@/lib/nav-history";
import LinkContextMenu from "./link-context-menu";

function currentLocation(): string {
  return window.location.href;
}

function serverLocation(): string {
  return "";
}

type Props = Omit<ComponentProps<typeof Link>, "href" | "target"> & {
  href: string;
  label: string;
  newTab?: boolean;
};

/** Destination links share tab behavior and retain both right-click choices. */
export default function NavigationLink({ href, label, newTab = false, onClick, onAuxClick, children, ...props }: Props) {
  const location = useSyncExternalStore(subscribeToTrail, currentLocation, serverLocation);
  const destination = withProfileReturnTo(href, location);

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.altKey || event.button > 1) return;
    const modified = event.ctrlKey || event.metaKey || event.button === 1;
    // Shift-click remains the explicit native request for a separate window.
    if ((!newTab && !modified) || (event.shiftKey && !modified) || !desktopTabsBridge()) return;
    event.preventDefault();
    void openInDesktopTab(destination, { background: modified && !event.shiftKey }).then((opened) => {
      // Tabs may have been disabled in Profile. Keep the destination usable
      // without turning a normal click into an unexpected new window.
      if (!opened) window.location.assign(destination);
    });
  }

  return (
    <LinkContextMenu href={destination} label={label}>
      <Link
        {...props}
        href={destination}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : props.rel}
        onClick={(event) => { onClick?.(event); open(event); }}
        onAuxClick={(event) => { onAuxClick?.(event); open(event); }}
      >
        {children}
      </Link>
    </LinkContextMenu>
  );
}
