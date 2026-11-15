import type { SVGProps } from "react";

/** The Crumbs mark: a slice of bread with a few crumbs falling from it. */
export default function CrumbsIcon({ size = 18, strokeWidth = 1.7, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5.6 10.3C4.4 9.7 3.6 8.7 3.6 7.5c0-2.2 2.6-3.7 6.4-3.7s6.4 1.5 6.4 3.7c0 1.2-.8 2.2-2 2.8v6.1c0 1-.8 1.8-1.8 1.8H7.4c-1 0-1.8-.8-1.8-1.8v-6.1Z" />
      <circle cx="18.6" cy="14.4" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="20.4" cy="18.5" r=".95" fill="currentColor" stroke="none" />
      <circle cx="16.9" cy="19.7" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}
