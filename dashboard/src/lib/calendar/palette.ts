// Event colours.
//
// Nextcloud Calendar ships saturated web colours; those read as stickers on
// Breadboard's warm-paper surface. These are the palette's own accents —
// botanical greens, the slate-blue and violet secondaries, ochre, terracotta
// and the muted danger red — so a full calendar still looks like one document.

export interface CalendarSwatch {
  name: string;
  value: string;
}

export const CALENDAR_PALETTE: readonly CalendarSwatch[] = [
  { name: "Botanical", value: "#4f6f68" },
  { name: "Sage", value: "#6e8f87" },
  { name: "Slate", value: "#7b97aa" },
  { name: "Violet", value: "#8a7ba0" },
  { name: "Ochre", value: "#9a7b2e" },
  { name: "Terracotta", value: "#b5743a" },
  { name: "Clay", value: "#a45c5c" },
  { name: "Ink", value: "#3b4c44" },
];

export const DEFAULT_CALENDAR_COLOR = CALENDAR_PALETTE[0].value;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isCalendarColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value.trim());
}

export function normalizeCalendarColor(value: unknown): string {
  return isCalendarColor(value) ? value.trim().toLowerCase() : DEFAULT_CALENDAR_COLOR;
}

/** The next unused swatch, so a new calendar rarely repeats an existing colour. */
export function nextCalendarColor(taken: readonly string[]): string {
  const used = new Set(taken.map((color) => color.toLowerCase()));
  const free = CALENDAR_PALETTE.find((swatch) => !used.has(swatch.value));
  return (free ?? CALENDAR_PALETTE[taken.length % CALENDAR_PALETTE.length]).value;
}
