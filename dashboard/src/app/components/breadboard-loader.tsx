interface BreadboardLoaderProps {
  /** Announced to screen readers; the mark itself carries no visible text. */
  label: string;
  className?: string;
}

// A single breadboard strip: one row of holes, nothing else. The board outline,
// channel and second bank all read as a box on a page that has no other boxes,
// so only the row survives.
const HOLES = 9;
const FIRST = 3;
const LAST = 51;
const HOLE = 1.6;

const STEP = (LAST - FIRST) / (HOLES - 1);

/**
 * Loading mark: a charge running along one strip of a breadboard. Used where a
 * spinner would otherwise sit next to a "loading…" label — the motion is the
 * whole signal, so no text accompanies it, and it is drawn in the page's own
 * hairline color so it settles into the background rather than announcing
 * itself.
 */
export default function BreadboardLoader({
  label,
  className = "h-2 w-16",
}: BreadboardLoaderProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 54 6"
      fill="none"
      className={`${className} text-[var(--line)]`}
    >
      {Array.from({ length: HOLES }, (_, index) => (
        <rect
          key={index}
          x={FIRST + index * STEP - HOLE / 2}
          y={3 - HOLE / 2}
          width={HOLE}
          height={HOLE}
          fill="currentColor"
        />
      ))}

      {/* The charge, sliding from the first hole to the last. */}
      <circle
        className="bb-loader-charge"
        cx={FIRST}
        cy="3"
        r="1.5"
        fill="var(--botanical-3)"
      />
    </svg>
  );
}
