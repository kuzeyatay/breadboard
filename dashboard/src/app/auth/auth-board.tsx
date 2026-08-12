import type { CSSProperties } from 'react';

/* The auth screens sit on a drawn breadboard: a perfboard hole field, two power
   rails, and twelve traces that route in from the edges and terminate at solder
   pads either side of the card — so the sign-in panel reads as the component
   seated in the middle of the board. Everything is drawn in the shared palette
   tokens, so the same markup renders on warm paper or charcoal.

   Geometry lives in a 1440x900 viewBox scaled with `slice` (a *uniform*
   transform on purpose: `pathLength="1"` — which is what draws every line with a
   single CSS rule — repeats its dashes instead of drawing under a non-uniform
   stretch). Nothing is routed between x=402 and x=1038, which is the corridor the
   card occupies at every window size, and the field is laid out so no trace
   crosses a part, a dimension or a label. */

const PAD_LEFT = 402;
const PAD_RIGHT = 1038;

/* Each trace leaves its pad horizontally, breaks once at 45°, then either runs
   off the sheet or stops — at a via, a part, or the chip. `to` is the y it breaks
   to; `end` is where it finishes (off-sheet by default). */
type Trace = { y: number; turn: number; to: number; end?: number };

const LEFT_TRACES: Trace[] = [
  { y: 214, turn: 342, to: 246 },
  { y: 302, turn: 300, to: 270 },
  { y: 390, turn: 258, to: 352 },
  { y: 478, turn: 258, to: 556 },
  { y: 566, turn: 300, to: 644, end: 150 }, // stops at a test-point via
  { y: 654, turn: 342, to: 700, end: 254 }, // runs into the capacitor
];

const RIGHT_TRACES: Trace[] = [
  { y: 258, turn: 1098, to: 190, end: 1166 }, // runs into the resistor
  { y: 346, turn: 1140, to: 300 },
  { y: 434, turn: 1140, to: 470 },
  { y: 522, turn: 1182, to: 560 },
  { y: 610, turn: 1072, to: 690, end: 1152 }, // lands on the chip's edge
  { y: 698, turn: 1098, to: 752 },
];

function leftPath({ y, turn, to, end = -40 }: Trace) {
  const run = Math.abs(to - y);
  return `M${PAD_LEFT} ${y}H${turn}L${turn - run} ${to}${turn - run === end ? '' : `H${end}`}`;
}

function rightPath({ y, turn, to, end = 1480 }: Trace) {
  const run = Math.abs(to - y);
  return `M${PAD_RIGHT} ${y}H${turn}L${turn + run} ${to}${turn + run === end ? '' : `H${end}`}`;
}

/* Traces that carry a travelling pulse once the board has finished drawing. Only
   the four that reach the sheet edge, so a pulse always arrives from off-screen,
   and only four so the field stays quiet. */
const PULSES = [
  { d: leftPath(LEFT_TRACES[2]), delay: 3.1 },
  { d: leftPath(LEFT_TRACES[3]), delay: 6.4 },
  { d: rightPath(RIGHT_TRACES[1]), delay: 4.6 },
  { d: rightPath(RIGHT_TRACES[3]), delay: 8.2 },
];

function delay(seconds: number): CSSProperties {
  return { '--bb-d': `${seconds}s` } as CSSProperties;
}

function Pad({ x, y, at }: { x: number; y: number; at: number }) {
  return (
    <g className="bb-auth-pad" style={delay(at)}>
      <circle cx={x} cy={y} r={7} className="bb-auth-pad-ring" />
      <circle cx={x} cy={y} r={2.4} className="bb-auth-pad-hole" />
    </g>
  );
}

function Via({ x, y, at }: { x: number; y: number; at: number }) {
  return (
    <g className="bb-auth-pad" style={delay(at)}>
      <circle cx={x} cy={y} r={4.5} className="bb-auth-pad-ring" />
      <circle cx={x} cy={y} r={1.6} className="bb-auth-pad-hole" />
    </g>
  );
}

export function AuthBoard({ sheet }: { sheet: string }) {
  return (
    <div className="bb-auth-board" aria-hidden="true">
      <div className="bb-auth-holes" />

      <svg
        className="bb-auth-schematic"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
        role="presentation"
      >
        {/* Drafting frame: corner ticks and one registration mark. */}
        <path className="bb-auth-rule" pathLength={1} style={delay(0.1)} d="M28 68V28H68" />
        <path className="bb-auth-rule" pathLength={1} style={delay(0.16)} d="M1372 28h40v40" />
        <path className="bb-auth-rule" pathLength={1} style={delay(0.22)} d="M28 832v40h40" />
        <path className="bb-auth-rule" pathLength={1} style={delay(0.28)} d="M1412 832v40h-40" />

        <g className="bb-auth-mark" style={delay(1.9)}>
          <circle cx={1364} cy={76} r={11} className="bb-auth-rule-static" />
          <path className="bb-auth-rule-static" d="M1364 59v34M1347 76h34" />
        </g>

        {/* Power rails. */}
        <path className="bb-auth-rail bb-auth-rail-pos" pathLength={1} style={delay(0.34)} d="M44 104h1352" />
        <path className="bb-auth-rail" pathLength={1} style={delay(0.42)} d="M44 118h1352" />
        <path className="bb-auth-rail" pathLength={1} style={delay(0.5)} d="M44 782h1352" />
        <path className="bb-auth-rail bb-auth-rail-neg" pathLength={1} style={delay(0.58)} d="M44 796h1352" />

        {/* Traces + pads. The card sits in the corridor between the two pad columns. */}
        {LEFT_TRACES.map((trace, i) => (
          <path
            key={`l${trace.y}`}
            className="bb-auth-trace"
            pathLength={1}
            style={delay(0.62 + i * 0.075)}
            d={leftPath(trace)}
          />
        ))}
        {RIGHT_TRACES.map((trace, i) => (
          <path
            key={`r${trace.y}`}
            className="bb-auth-trace"
            pathLength={1}
            style={delay(0.66 + i * 0.075)}
            d={rightPath(trace)}
          />
        ))}
        {LEFT_TRACES.map((trace, i) => (
          <Pad key={`lp${trace.y}`} x={PAD_LEFT} y={trace.y} at={1.5 + i * 0.075} />
        ))}
        {RIGHT_TRACES.map((trace, i) => (
          <Pad key={`rp${trace.y}`} x={PAD_RIGHT} y={trace.y} at={1.54 + i * 0.075} />
        ))}

        {/* Discrete parts, each on the end of the trace that feeds it. */}
        <path
          className="bb-auth-trace"
          pathLength={1}
          style={delay(1.4)}
          d="M1166 190h42l10-18 20 36 20-36 20 36 10-18h42"
        />
        <path
          className="bb-auth-trace"
          pathLength={1}
          style={delay(1.52)}
          d="M254 700h-74M180 682v36M166 682v36M166 700H92"
        />
        <g className="bb-auth-chip" style={delay(1.85)}>
          <rect x={1152} y={628} width={140} height={82} rx={6} className="bb-auth-chip-body" />
          <path className="bb-auth-rule-static" d="M1152 640a10 10 0 0 0 0 20" />
          <path
            className="bb-auth-rule-static"
            d="M1176 628v-14M1206 628v-14M1236 628v-14M1266 628v-14M1176 710v14M1206 710v14M1236 710v14M1266 710v14"
          />
        </g>

        <Via x={150} y={644} at={1.72} />
        <Via x={92} y={700} at={1.78} />
        <Via x={1330} y={190} at={1.66} />

        {/* Drafting dimension across the capacitor run. */}
        <g className="bb-auth-dim" style={delay(2.05)}>
          <path className="bb-auth-rule-static" d="M92 714v42M254 714v42M92 744h162" />
          <path className="bb-auth-rule-static" d="M85 751l14-14M247 751l14-14" />
          <text x={173} y={736} className="bb-auth-label bb-auth-label-dim">
            162.0
          </text>
        </g>

        {/* Sheet block and rail markings. */}
        <g className="bb-auth-titles" style={delay(2.2)}>
          <text x={60} y={168} className="bb-auth-label bb-auth-label-lead">
            BREADBOARD
          </text>
          <text x={60} y={192} className="bb-auth-label">
            {sheet}
          </text>
          <text x={44} y={92} className="bb-auth-label">
            +5V
          </text>
          <text x={44} y={772} className="bb-auth-label">
            GND
          </text>
          <text x={1340} y={848} className="bb-auth-label" textAnchor="end">
            REV A · SHEET 1/1
          </text>
        </g>

        {/* Signal travelling inward to the pads, once the board is drawn. */}
        {PULSES.map((pulse) => (
          <path
            key={pulse.delay}
            className="bb-auth-pulse"
            pathLength={1}
            style={delay(pulse.delay)}
            d={pulse.d}
          />
        ))}
      </svg>
    </div>
  );
}

/* Four fixed-size corner brackets around the card. They are separate square SVGs
   rather than one stretched overlay for the same `pathLength` reason as above. */
export function AuthCardCorners() {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((corner, i) => (
        <svg
          key={corner}
          className={`bb-auth-corner bb-auth-corner-${corner}`}
          viewBox="0 0 28 28"
          width={28}
          height={28}
          style={delay(1.05 + i * 0.09)}
          aria-hidden="true"
        >
          <path className="bb-auth-corner-line" pathLength={1} d="M1 27V9a8 8 0 0 1 8-8h18" />
        </svg>
      ))}
    </>
  );
}
