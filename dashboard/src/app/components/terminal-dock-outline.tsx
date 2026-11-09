"use client";

import { useEffect, useRef, type RefObject } from "react";
import { terminalDockOutlines } from "@/lib/terminal-dock-outline-path";

export default function TerminalDockOutline({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const target = targetRef.current;
    const svg = svgRef.current;
    if (!target || !svg) return;
    let previous = "";
    const paint = (width: number, height: number) => {
      const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
      const key = `${width}:${height}:${radius}`;
      if (!width || !height || key === previous) return;
      previous = key;
      const outlines = terminalDockOutlines({ width, height, radius });
      // ResizeObserver runs before paint. Update coordinates and paths together
      // here instead of stretching the old path while React catches up.
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.children[0].setAttribute("d", outlines.settled);
      svg.children[1].setAttribute("d", outlines.pass);
    };
    const initial = target.getBoundingClientRect();
    paint(initial.width, initial.height);
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      if (box) paint(box.inlineSize, box.blockSize);
      else {
        const rect = target.getBoundingClientRect();
        paint(rect.width, rect.height);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);
  return (
    <svg ref={svgRef} aria-hidden="true" className="bb-terminal-dock-outline" preserveAspectRatio="none">
      <path pathLength={1} />
      <path pathLength={1} />
    </svg>
  );
}
