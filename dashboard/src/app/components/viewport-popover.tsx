"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type PopoverPosition = {
  left: number;
  top: number;
  maxHeight: number;
};

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 4;

/**
 * A popover that escapes scrolling/overflow containers while staying attached
 * to its trigger. The menu flips to the side of the trigger with enough room
 * and becomes internally scrollable when neither side can fit it.
 */
export default function ViewportPopover({
  anchorRef,
  ariaLabel,
  children,
  className,
  onClose,
  role = "menu",
  portal = true,
  topLayer = false,
  open = true,
  id,
  restoreFocusOnEscape = true,
  maxHeight: heightLimit = Infinity,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onClose: () => void;
  role?: "dialog" | "menu";
  /** Nested popovers stay in the parent's DOM tree for outside-click handling. */
  portal?: boolean;
  /** Escape transformed ancestors while retaining the popover's DOM position. */
  topLayer?: boolean;
  open?: boolean;
  id?: string;
  restoreFocusOnEscape?: boolean;
  maxHeight?: number;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState<PopoverPosition>({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    maxHeight: 0,
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;
    if (topLayer) popover.showPopover();

    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = Math.min(
        popover.offsetWidth,
        viewportWidth - VIEWPORT_MARGIN * 2,
      );
      const naturalHeight = Math.min(popover.scrollHeight, heightLimit);
      const roomBelow = Math.max(
        0,
        viewportHeight - anchorRect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN,
      );
      const roomAbove = Math.max(
        0,
        anchorRect.top - ANCHOR_GAP - VIEWPORT_MARGIN,
      );
      const placeBelow =
        naturalHeight <= roomBelow || roomBelow >= roomAbove;
      const maxHeight = Math.min(placeBelow ? roomBelow : roomAbove, heightLimit);
      const renderedHeight = Math.min(naturalHeight, maxHeight);
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, anchorRect.right - popoverWidth),
        Math.max(VIEWPORT_MARGIN, viewportWidth - popoverWidth - VIEWPORT_MARGIN),
      );
      const top = placeBelow
        ? anchorRect.bottom + ANCHOR_GAP
        : anchorRect.top - ANCHOR_GAP - renderedHeight;

      setPosition((current) =>
        current.left === left &&
        current.top === top &&
        current.maxHeight === maxHeight
          ? current
          : { left, top, maxHeight },
      );
    };

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        anchorRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      onCloseRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let the innermost panel close first, preserving the menu behind it.
      if (popoverRef.current?.querySelector('[data-viewport-popover]:not([hidden])')) return;
      event.stopPropagation();
      onCloseRef.current();
      if (restoreFocusOnEscape) anchorRef.current?.focus();
    };

    place();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const resizeObserver = new ResizeObserver(place);
    resizeObserver.observe(popover);

    // A top-layer panel stays visible even after its trigger scrolls out of view.
    const intersectionObserver = topLayer ? new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) onCloseRef.current();
    }) : null;
    if (anchorRef.current) {
      resizeObserver.observe(anchorRef.current);
      intersectionObserver?.observe(anchorRef.current);
    }

    return () => {
      if (topLayer) popover.hidePopover();
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [anchorRef, open, heightLimit, topLayer, restoreFocusOnEscape]);

  if (typeof document === "undefined") return null;

  const panel = (
    <div
      ref={popoverRef}
      id={id}
      data-viewport-popover=""
      popover={topLayer ? "manual" : undefined}
      hidden={!open}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={{
        margin: topLayer ? 0 : undefined,
        right: topLayer ? "auto" : undefined,
        bottom: topLayer ? "auto" : undefined,
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight || undefined,
        maxWidth: "calc(100vw - 24px)",
        visibility: position.maxHeight ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
  return portal ? createPortal(panel, document.body) : panel;
}
