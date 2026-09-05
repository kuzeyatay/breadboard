"use client";

import { useEffect, useState, type RefObject } from "react";

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

  if (!box.width || !box.height) return null;
  const right = box.width - 2;
  const radius = Math.min(box.radius, right / 2, box.height - 2);
  // An open path follows only the exposed sides and rounded top. There is no
  // invisible bottom segment for the tracing pass to spend half its cycle on.
  const path = `M 1 ${box.height} V ${radius + 1} Q 1 1 ${radius + 1} 1 H ${right - radius} Q ${right} 1 ${right} ${radius + 1} V ${box.height}`;

  return (
    <svg
      aria-hidden="true"
      className="bb-terminal-dock-outline"
      viewBox={`0 0 ${box.width} ${box.height}`}
      preserveAspectRatio="none"
    >
      <path d={path} pathLength={1} />
      <path d={path} pathLength={1} />
    </svg>
  );
}
