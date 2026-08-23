// The Bolt Slides agent's chat identity: the command that reaches it, and the
// parsing of a message into a deck request.
//
// A run turns one sentence into a presentation that is a running web app — the
// bolt-slides deck engine themed and authored for the topic, then built with
// Vite and served as a link. The message is the brief: what the deck is about,
// who it is for, what it has to land. The flags below are the parts of that a
// person may want to state exactly rather than leave to the model — how long
// the deck runs, whether it is dark or light, and which brand it dresses as.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const BOLT_SLIDES_COMMAND = "/agents:bolt-slides";
export const BOLT_SLIDES_AGENT_ID = "bolt-slides";
export const BOLT_SLIDES_AGENT_NAME = "Bolt Slides";

/** Below this a deck is a handful of statements; above it nobody presents it. */
export const BOLT_SLIDES_MIN_SLIDES = 5;
export const BOLT_SLIDES_MAX_SLIDES = 24;
export const BOLT_SLIDES_DEFAULT_SLIDES = 12;

/**
 * The nine theme families the bundled skill names. `auto` leaves the choice to
 * the deck plan, which is the right default: the theme follows the topic, and a
 * pitch deck and a teaching deck genuinely want different ones.
 */
export const BOLT_SLIDES_THEMES = [
  "auto",
  "dark-product",
  "editorial-luxury",
  "swiss",
  "dark-technical",
  "warm-minimal",
  "fintech",
  "aurora-glass",
  "cinematic",
  "paper-editorial",
] as const;
export type BoltSlidesTheme = (typeof BOLT_SLIDES_THEMES)[number];

export interface BoltSlidesRequest {
  /** What the deck is about, with every flag removed. */
  brief: string;
  /** How many slides to aim for. The plan may land one or two either side. */
  slides: number;
  theme: BoltSlidesTheme;
  /** A brand site to take colour, type, and name from, when one was given. */
  brandUrl: string | null;
}

export type BoltSlidesDefaults = Partial<Pick<BoltSlidesRequest, "slides" | "theme">>;

export function isBoltSlidesTheme(value: unknown): value is BoltSlidesTheme {
  return typeof value === "string" && (BOLT_SLIDES_THEMES as readonly string[]).includes(value);
}

export function boltSlidesUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${BOLT_SLIDES_COMMAND} ${trimmed}` : BOLT_SLIDES_COMMAND;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them and can
 * refuse the combination in the words every surface uses.
 */
export function taskFromBoltSlidesCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:bolt-slides") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

function clampSlides(value: number): number {
  if (!Number.isFinite(value)) return BOLT_SLIDES_DEFAULT_SLIDES;
  return Math.max(BOLT_SLIDES_MIN_SLIDES, Math.min(Math.round(value), BOLT_SLIDES_MAX_SLIDES));
}

/**
 * Read the flags a message may carry, and leave everything else as the brief.
 *
 * Stored preferences arrive as `defaults` and fill only what the message left
 * unsaid — a flag typed here always wins, because a preference you cannot
 * override in one message is a trap.
 */
export function parseBoltSlidesRequest(
  message: string,
  defaults: BoltSlidesDefaults = {},
): BoltSlidesRequest {
  let slides = clampSlides(defaults.slides ?? BOLT_SLIDES_DEFAULT_SLIDES);
  let theme: BoltSlidesTheme = defaults.theme ?? "auto";
  let brandUrl: string | null = null;

  const brief = message
    .replace(/(^|\s)--slides[= ](\d{1,3})(?=\s|$)/gi, (_match, lead: string, digits: string) => {
      slides = clampSlides(Number(digits));
      return lead;
    })
    .replace(/(^|\s)--theme[= ]([a-z-]+)(?=\s|$)/gi, (match, lead: string, value: string) => {
      const lowered = value.toLowerCase();
      if (!isBoltSlidesTheme(lowered)) return match;
      theme = lowered;
      return lead;
    })
    .replace(/(^|\s)--brand[= ](\S+)(?=\s|$)/gi, (match, lead: string, value: string) => {
      if (!/^https?:\/\//i.test(value)) return match;
      brandUrl = value;
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();

  return { brief, slides, theme, brandUrl };
}

/**
 * A one-line description of the deck, for the run card's header. Written from
 * the request rather than the plan, so it is there before authoring finishes.
 */
export function describeBoltSlidesDeck(request: BoltSlidesRequest): string {
  const parts = [`~${request.slides} slides`];
  if (request.theme !== "auto") parts.push(request.theme.replace(/-/g, " "));
  if (request.brandUrl) parts.push(request.brandUrl.replace(/^https?:\/\//i, ""));
  return parts.join(" · ");
}
