interface BreadboardLogoProps {
  className?: string;
}

// Hole grid geometry (shared with the icon generator script).
const HOLE_COLS = 13;
const COL_START = 17;
const COL_END = 83;
const BANK1_ROWS = [32, 37, 42, 47];
const BANK2_ROWS = [60, 65, 70, 75];
const HOLE = 2.6;

function holeColumns(): number[] {
  const step = (COL_END - COL_START) / (HOLE_COLS - 1);
  return Array.from({ length: HOLE_COLS }, (_, i) => COL_START + i * step);
}

function bankHoles(rows: number[]): { x: number; y: number }[] {
  const cols = holeColumns();
  const holes: { x: number; y: number }[] = [];
  for (const y of rows) for (const x of cols) holes.push({ x, y });
  return holes;
}

/**
 * Breadboard logo: a rounded board outline with top/bottom power rails, two
 * banks of holes split by the center channel, and side notches. Drawn with
 * `currentColor` so it inherits the surrounding text color.
 */
export default function BreadboardLogo({
  className = "h-12 w-12",
}: BreadboardLogoProps) {
  const holes = [...bankHoles(BANK1_ROWS), ...bankHoles(BANK2_ROWS)];
  const notches = [26, 40, 60, 74];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      className={`${className} text-white`}
    >
      {/* Board outline */}
      <rect x="8" y="14" width="84" height="72" rx="6" strokeWidth="4" />

      {/* Side notches */}
      {notches.map((y) => (
        <g key={`n-${y}`}>
          <rect x="4" y={y - 3} width="4.5" height="6" rx="1" fill="currentColor" stroke="none" />
          <rect x="91.5" y={y - 3} width="4.5" height="6" rx="1" fill="currentColor" stroke="none" />
        </g>
      ))}

      {/* Top + bottom power rails */}
      <rect x="15" y="20" width="70" height="7" rx="3" strokeWidth="2.4" />
      <rect x="15" y="79" width="70" height="7" rx="3" strokeWidth="2.4" />

      {/* Center channel */}
      <line x1="12" y1="51.5" x2="88" y2="51.5" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="12" y1="56.5" x2="88" y2="56.5" strokeWidth="2.4" strokeLinecap="round" />

      {/* Hole banks */}
      {holes.map((hole, index) => (
        <rect
          key={index}
          x={hole.x - HOLE / 2}
          y={hole.y - HOLE / 2}
          width={HOLE}
          height={HOLE}
          fill="currentColor"
          stroke="none"
        />
      ))}
    </svg>
  );
}
