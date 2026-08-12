// Document theme shared by the Markdown -> PDF and Markdown -> DOCX renderers.
//
// The point: the generated document's *look* is not fixed. The agent turns the
// user's wish ("make it a formal report", "a playful colourful hand-out", "a
// clean minimal brief") into a theme — either a named preset or explicit tokens
// — and passes it through the artifact's metadata. Both renderers honour the
// same resolved tokens so a PDF and a DOCX of the same request look consistent.

export type ThemeFontFamily = "sans" | "serif";

export interface DocumentTheme {
  /** Accent colour (hex, no #): H1, links, rules, list markers. */
  accent: string;
  /** Heading text colour (hex, no #). */
  headingColor: string;
  /** Body text colour (hex, no #). */
  bodyColor: string;
  /** Muted colour for captions / secondary text (hex, no #). */
  mutedColor: string;
  /** Body font family. */
  font: ThemeFontFamily;
  /** Whether headings use the same family or a contrasting one. */
  headingFont: ThemeFontFamily;
  /** Base body font size in points. */
  baseFontSize: number;
  /** Multiplier applied to every heading size. */
  headingScale: number;
  /** Draw an accent rule beneath H1/H2. */
  headingRule: boolean;
  /** Fill behind fenced code (hex, no #). */
  codeBackground: string;
  /** Page margin in points (PDF) — DOCX keeps 1in but scales spacing. */
  pageMargin: number;
}

export type DocumentThemeInput = string | Partial<RawThemeInput> | null | undefined;

interface RawThemeInput {
  preset: string;
  accent: string;
  headingColor: string;
  bodyColor: string;
  mutedColor: string;
  font: string;
  headingFont: string;
  baseFontSize: number;
  fontSize: number;
  headingScale: number;
  headingRule: boolean;
  codeBackground: string;
  pageMargin: number;
}

const PRESETS: Record<string, DocumentTheme> = {
  professional: {
    accent: "2563EB",
    headingColor: "111827",
    bodyColor: "1F2937",
    mutedColor: "6B7280",
    font: "sans",
    headingFont: "sans",
    baseFontSize: 10.5,
    headingScale: 1,
    headingRule: true,
    codeBackground: "F6F8FA",
    pageMargin: 54,
  },
  academic: {
    accent: "334155",
    headingColor: "0F172A",
    bodyColor: "1F2937",
    mutedColor: "64748B",
    font: "serif",
    headingFont: "serif",
    baseFontSize: 11,
    headingScale: 0.96,
    headingRule: false,
    codeBackground: "F1F5F9",
    pageMargin: 64,
  },
  minimal: {
    accent: "111827",
    headingColor: "111827",
    bodyColor: "374151",
    mutedColor: "9CA3AF",
    font: "sans",
    headingFont: "sans",
    baseFontSize: 10.5,
    headingScale: 1.02,
    headingRule: false,
    codeBackground: "F3F4F6",
    pageMargin: 64,
  },
  playful: {
    accent: "DB2777",
    headingColor: "6D28D9",
    bodyColor: "1F2937",
    mutedColor: "7C3AED",
    font: "sans",
    headingFont: "sans",
    baseFontSize: 11,
    headingScale: 1.12,
    headingRule: true,
    codeBackground: "FDF2F8",
    pageMargin: 54,
  },
  vibrant: {
    accent: "0D9488",
    headingColor: "0F766E",
    bodyColor: "1F2937",
    mutedColor: "0891B2",
    font: "sans",
    headingFont: "sans",
    baseFontSize: 11,
    headingScale: 1.1,
    headingRule: true,
    codeBackground: "ECFEFF",
    pageMargin: 54,
  },
  formal: {
    accent: "1E3A8A",
    headingColor: "1E293B",
    bodyColor: "1F2937",
    mutedColor: "64748B",
    font: "serif",
    headingFont: "serif",
    baseFontSize: 11,
    headingScale: 1,
    headingRule: true,
    codeBackground: "F1F5F9",
    pageMargin: 60,
  },
};

const PRESET_ALIASES: Record<string, string> = {
  default: "professional",
  clean: "professional",
  business: "professional",
  corporate: "formal",
  report: "formal",
  scholarly: "academic",
  paper: "academic",
  fun: "playful",
  colorful: "playful",
  colourful: "playful",
  bold: "vibrant",
  simple: "minimal",
  plain: "minimal",
};

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/^#/, "");
  return HEX_RE.test(`#${clean}`) ? clean.toUpperCase() : null;
}

function normalizeFamily(value: unknown): ThemeFontFamily | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  if (["serif", "times", "georgia", "roman"].includes(clean)) return "serif";
  if (["sans", "sans-serif", "helvetica", "arial", "modern"].includes(clean)) return "sans";
  return null;
}

function presetByName(name: unknown): DocumentTheme | null {
  if (typeof name !== "string") return null;
  const key = name.trim().toLowerCase();
  const resolved = PRESETS[key] ?? PRESETS[PRESET_ALIASES[key] ?? ""];
  return resolved ?? null;
}

/**
 * Resolves a theme from agent-supplied input: a preset name (`"formal"`), an
 * object of explicit tokens (`{ accent: "#db2777", font: "serif" }`), or a
 * combination (`{ preset: "academic", accent: "#7c3aed" }`). Unknown or invalid
 * input falls back to the professional preset, so rendering is never blocked.
 */
export function resolveDocumentTheme(input: DocumentThemeInput): DocumentTheme {
  if (typeof input === "string") {
    return { ...(presetByName(input) ?? PRESETS.professional) };
  }
  const base = input && typeof input === "object"
    ? presetByName(input.preset) ?? PRESETS.professional
    : PRESETS.professional;
  const theme: DocumentTheme = { ...base };
  if (!input || typeof input !== "object") return theme;

  const accent = normalizeHex(input.accent);
  if (accent) theme.accent = accent;
  const headingColor = normalizeHex(input.headingColor);
  if (headingColor) theme.headingColor = headingColor;
  const bodyColor = normalizeHex(input.bodyColor);
  if (bodyColor) theme.bodyColor = bodyColor;
  const mutedColor = normalizeHex(input.mutedColor);
  if (mutedColor) theme.mutedColor = mutedColor;
  const codeBackground = normalizeHex(input.codeBackground);
  if (codeBackground) theme.codeBackground = codeBackground;

  const font = normalizeFamily(input.font);
  if (font) {
    theme.font = font;
    // If a heading font wasn't given explicitly, follow the body family.
    if (normalizeFamily(input.headingFont) === null) theme.headingFont = font;
  }
  const headingFont = normalizeFamily(input.headingFont);
  if (headingFont) theme.headingFont = headingFont;

  const size = typeof input.baseFontSize === "number"
    ? input.baseFontSize
    : typeof input.fontSize === "number"
      ? input.fontSize
      : null;
  if (size !== null && Number.isFinite(size)) {
    theme.baseFontSize = Math.min(16, Math.max(8, size));
  }
  if (typeof input.headingScale === "number" && Number.isFinite(input.headingScale)) {
    theme.headingScale = Math.min(1.6, Math.max(0.7, input.headingScale));
  }
  if (typeof input.headingRule === "boolean") theme.headingRule = input.headingRule;
  if (typeof input.pageMargin === "number" && Number.isFinite(input.pageMargin)) {
    theme.pageMargin = Math.min(96, Math.max(36, input.pageMargin));
  }
  return theme;
}

/** Extracts a theme from an artifact's metadata (`metadata.theme` / `.style`). */
export function themeFromMetadata(metadata: Record<string, unknown> | undefined): DocumentTheme {
  if (!metadata) return resolveDocumentTheme(undefined);
  const candidate =
    (metadata.theme as DocumentThemeInput) ??
    (metadata.style as DocumentThemeInput) ??
    (metadata.documentStyle as DocumentThemeInput) ??
    undefined;
  return resolveDocumentTheme(candidate);
}

/** Heading size multipliers relative to the base font size (H1..H6). */
export const HEADING_FACTORS = [2.0, 1.62, 1.33, 1.19, 1.1, 1.03] as const;
