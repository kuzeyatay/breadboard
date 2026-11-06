"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { SKETCH_MARGIN, sketchRectOutlines } from "@/lib/hermes/sketch-outline";

export default function TerminalDockOutline({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [box, setBox] = useState({ width: 0, height: 0, radius: 0 });

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const measure = () => {
      const { width, height } = target.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
      setBox((previous) =>
        previous.width === width && previous.height === height && previous.radius === radius
          ? previous
          : { width, height, radius },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  const outlines = useMemo(() => {
    if (!box.width || !box.height) return null;
    // Keep both hand-drawn passes inside the dock's clipped border box, even
    // when it is collapsed to the slim bar or resized to fill the viewport.
    return sketchRectOutlines({
      width: Math.max(1, box.width - SKETCH_MARGIN * 2),
      height: Math.max(1, box.height - SKETCH_MARGIN * 2),
      radius: box.radius,
    }, 17);
  }, [box]);

  if (!outlines) return null;

  return (
    <svg
      aria-hidden="true"
      className="bb-terminal-dock-outline"
      viewBox={`0 0 ${box.width} ${box.height}`}
      preserveAspectRatio="none"
    >
      <path d={outlines.settled} pathLength={1} />
      <path d={outlines.pass} pathLength={1} />
    </svg>
  );
}
