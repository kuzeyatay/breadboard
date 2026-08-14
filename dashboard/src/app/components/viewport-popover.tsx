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
}: {
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onClose: () => void;
  role?: "dialog" | "menu";
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
    const place = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const anchorRect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = Math.min(
        popover.offsetWidth,
        viewportWidth - VIEWPORT_MARGIN * 2,
      );
      const naturalHeight = popover.scrollHeight;
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
      const maxHeight = placeBelow ? roomBelow : roomAbove;
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
      event.stopPropagation();
      onCloseRef.current();
      anchorRef.current?.focus();
    };

    place();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const resizeObserver = new ResizeObserver(place);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);

    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      resizeObserver.disconnect();
    };
  }, [anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={{
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight || undefined,
        visibility: position.maxHeight ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
