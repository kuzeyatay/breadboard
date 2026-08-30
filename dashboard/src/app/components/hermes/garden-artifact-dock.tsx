"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ArtifactDockHostProvider } from "./artifact-dock-host";

interface Props {
  children: ReactNode;
}

interface ActiveResize {
  pointerId: number;
  startX: number;
  startWidth: number;
  nextWidth: number;
  target: HTMLDivElement;
  previousCursor: string;
  previousUserSelect: string;
}

const WIDTH_KEY = "breadboard:garden:artifact-dock-width";
const DEFAULT_WIDTH = "max(24rem, 50vw)";
const DEFAULT_WIDTH_FLOOR = 384;
const MIN_WIDTH = 520;
const MAX_WIDTH = 1440;
const VIEWPORT_SHARE = 0.82;
const VIEWPORT_GUTTER = 48;
const KEYBOARD_STEP = 32;

function widthBounds(): { min: number; max: number } {
  const viewportMax = Math.min(
    MAX_WIDTH,
    Math.round(window.innerWidth * VIEWPORT_SHARE),
    window.innerWidth - VIEWPORT_GUTTER,
  );
  const max = Math.max(320, viewportMax);
  return { min: Math.min(MIN_WIDTH, max), max };
}

function clampWidth(width: number): number {
  const { min, max } = widthBounds();
  return Math.min(max, Math.max(min, Math.round(width)));
}

function persistWidth(width: number) {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Resizing still works when storage is unavailable.
  }
}

/**
 * A Garden-wide portal lane for artifacts. The lane is positioned by the
 * workspace body, so it overlays the learning map without covering Garden's
 * header or asking the chat and map to reflow around it.
 */
export default function GardenArtifactDock({ children }: Props) {
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ActiveResize | null>(null);

  const stopResize = useCallback((pointerId: number, save: boolean) => {
    const active = resizeRef.current;
    if (!active || active.pointerId !== pointerId) return;
    resizeRef.current = null;
    if (active.target.hasPointerCapture(pointerId)) {
      active.target.releasePointerCapture(pointerId);
    }
    document.body.style.cursor = active.previousCursor;
    document.body.style.userSelect = active.previousUserSelect;
    setDragging(false);
    if (save) persistWidth(active.nextWidth);
  }, []);

  useEffect(() => {
    let restoredWidth: number | null = null;
    try {
      const stored = window.localStorage.getItem(WIDTH_KEY);
      const parsed = stored === null ? Number.NaN : Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) restoredWidth = parsed;
    } catch {
      // The CSS half-workspace default remains the source of truth.
    }
    const initialWidth = restoredWidth ?? Math.max(DEFAULT_WIDTH_FLOOR, window.innerWidth / 2);
    // A stored or viewport-derived width cannot seed state on the server
    // without creating a hydration mismatch, so it is restored after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(clampWidth(initialWidth));

    const keepInsideViewport = () => {
      setWidth((current) => (current === null ? null : clampWidth(current)));
    };
    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, []);

  useEffect(
    () => () => {
      const active = resizeRef.current;
      if (!active) return;
      resizeRef.current = null;
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
      document.body.style.cursor = active.previousCursor;
      document.body.style.userSelect = active.previousUserSelect;
    },
    [],
  );

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const shell = shellRef.current;
    if (!shell) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = shell.getBoundingClientRect().width;
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      nextWidth: startWidth,
      target: event.currentTarget,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "var(--bb-cursor-col-resize, col-resize)";
    document.body.style.userSelect = "none";
    setDragging(true);
  }, []);

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = resizeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    // The panel is fixed to the right: moving its left edge left makes it wider.
    const nextWidth = clampWidth(active.startWidth + active.startX - event.clientX);
    active.nextWidth = nextWidth;
    setWidth(nextWidth);
  }, []);

  const handleResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event.pointerId, event.type !== "pointercancel");
    },
    [stopResize],
  );

  const handleResizeKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const shell = shellRef.current;
    if (!shell) return;
    const current = shell.getBoundingClientRect().width;
    const { min, max } = widthBounds();
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = current + KEYBOARD_STEP;
    if (event.key === "ArrowRight") next = current - KEYBOARD_STEP;
    if (event.key === "Home") next = min;
    if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampWidth(next);
    setWidth(clamped);
    persistWidth(clamped);
  }, []);

  const shellStyle = {
    width: width ?? DEFAULT_WIDTH,
    maxWidth: "calc(100vw - 3rem)",
  } satisfies CSSProperties;

  return (
    <ArtifactDockHostProvider host={dockHost}>
      {children}
      <div
        ref={shellRef}
        style={shellStyle}
        className="bb-garden-artifact-shell absolute inset-y-0 right-0 z-30 flex"
      >
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize artifact viewer"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width ?? MIN_WIDTH}
          title="Drag to resize the artifact viewer"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onKeyDown={handleResizeKey}
          className="group absolute inset-y-0 left-0 z-20 flex w-2 -translate-x-1/2 touch-none cursor-col-resize items-center justify-center outline-none"
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-[#8faf9a] group-focus-visible:bg-[#8faf9a] ${
              dragging ? "bg-[#8faf9a]" : "bg-[var(--line)]"
            }`}
          />
          <span
            aria-hidden
            className={`pointer-events-none relative h-14 w-1.5 rounded-full border transition-colors group-hover:border-[rgba(169,193,177,0.7)] group-hover:bg-[#A9C1B1] group-focus-visible:border-[rgba(169,193,177,0.7)] group-focus-visible:bg-[#A9C1B1] ${
              dragging
                ? "border-[rgba(169,193,177,0.7)] bg-[#A9C1B1]"
                : "border-transparent bg-transparent"
            }`}
          />
        </div>
        <div
          ref={setDockHost}
          className="bb-garden-artifact-lane h-full min-w-0 flex-1 overflow-hidden"
        />
      </div>
    </ArtifactDockHostProvider>
  );
}
