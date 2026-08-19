"use client";

// The panel that opens beside the transcript — Artifacts, Uploads, Scheduled,
// Hooks, Processes — and the edge that moves it.
//
// It used to appear and vanish at a fixed width, which made choosing a panel a
// jump cut: the transcript lost a third of itself between one frame and the
// next, with nothing on the boundary to say the panel could be moved at all.
// The rail and the learning map on either side of it both had an edge; this is
// the third one, so all three now drag and click the same way.
//
// Collapsed is not the same as closed. Closing is the rail's job — its panel
// buttons toggle — and a closed panel takes its edge with it. Collapsing leaves
// the edge standing so the panel can be brought back from the boundary it left,
// which is the only reason the width goes to zero rather than unmounting.

import { useEffect, useState, type ReactNode } from "react";
import RailDivider from "./rail-divider";
import { useRailResize } from "./use-rail-resize";

interface Props {
  /** Accessible name of the panel, and what the edge's tooltip calls it. */
  label: string;
  /** Width when open and untouched, in pixels. */
  defaultWidth: number;
  /** Remembers a dragged width across reloads. */
  storageKey: string;
  children: ReactNode;
}

const PANEL_MIN = 320;
const PANEL_MAX = 720;
/** A panel put away leaves nothing behind but its edge. */
const PANEL_RAIL = 0;
const PANEL_THRESHOLD = 220;

export default function SidePanelDock({ label, defaultWidth, storageKey, children }: Props) {
  const rail = useRailResize({
    side: "right",
    defaultWidth,
    min: PANEL_MIN,
    max: PANEL_MAX,
    railWidth: PANEL_RAIL,
    threshold: PANEL_THRESHOLD,
    storageKey,
  });

  // The width travels from nothing on the first frame *after* mount, so opening
  // a panel arrives the same way collapsing one leaves. Set during the mount
  // commit it would already be the panel's full width, and the panel would pop.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const open = entered && !rail.collapsed;

  return (
    <>
      <RailDivider
        collapsed={!open}
        onToggle={rail.toggle}
        name={`Toggle the ${label} panel`}
        moves={`the ${label} panel`}
        onPointerDown={rail.onPointerDown}
        dragging={rail.dragging}
      />
      <aside
        aria-label={label}
        // Nothing inside a collapsed panel is reachable by tab or by a screen
        // reader; a zero-width box with its contents still focusable is a
        // keyboard trap in a panel the user has just put away.
        inert={!open}
        // `entered`, not `open`: once the first frame is behind it the box
        // follows the width exactly, so a drag down through the collapse
        // threshold keeps up with the pointer instead of snapping shut under it.
        style={{ width: entered ? rail.width : 0 }}
        className={`bb-neu-sidebar-right shrink-0 overflow-hidden ${
          rail.dragging ? "" : "bb-rail-travel"
        }`}
      >
        {/* The contents hold the width the panel is heading for while the box
            travels, so a collapse slides the panel out of view instead of
            reflowing every line of it on the way. */}
        <div style={{ width: rail.openWidth }} className="h-full">
          {children}
        </div>
      </aside>
    </>
  );
}
