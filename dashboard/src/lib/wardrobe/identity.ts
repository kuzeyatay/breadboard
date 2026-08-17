// The Wardrobe agent's chat identity: the slash command that activates it, and
// the parsing of a message into an import request.
//
// The input is the photographs, not the sentence. A run turns attached photos of
// worn or laid-out clothes into transparent catalog cutouts and modeled editorial
// photos, and files them in the local wardrobe the cloned app reads. The message
// is only ever direction — "skip the modeled shots", "these are all outerwear" —
// so it is kept short and passed through as regeneration guidance.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const WARDROBE_COMMAND = "/agents:wardrobe";
export const WARDROBE_AGENT_ID = "wardrobe";
export const WARDROBE_AGENT_NAME = "Wardrobe";

/** How many garments a single photo may contribute before the rest are left. */
export const DEFAULT_MAX_ITEMS_PER_PHOTO = 6;
export const MIN_MAX_ITEMS_PER_PHOTO = 1;
export const MAX_MAX_ITEMS_PER_PHOTO = 8;

/** Image quality the cloned app asks the provider for. */
export const WARDROBE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type WardrobeQuality = (typeof WARDROBE_QUALITIES)[number];

export interface WardrobeRequest {
  /** Extra direction for the generator, in the user's own words. */
  direction: string;
  /** Garments to take from one photo, highest-confidence first. */
  maxItemsPerPhoto: number;
  quality: WardrobeQuality;
}

export const DEFAULT_WARDROBE_REQUEST: WardrobeRequest = {
  direction: "",
  maxItemsPerPhoto: DEFAULT_MAX_ITEMS_PER_PHOTO,
  quality: "high",
};

export function wardrobeUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${WARDROBE_COMMAND} ${trimmed}` : WARDROBE_COMMAND;
}

/**
 * The direction carried by an `/agents:wardrobe …` message, or null when the
 * message is not addressed to this agent. An empty string means the command was
 * typed on its own, which is the normal case: the photos are the request.
 *
 * Other slash tokens stacked in front are preserved in the returned text so the
 * capability resolver still sees them and can refuse the combination in the
 * words every surface uses.
 */
export function taskFromWardrobeCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:wardrobe(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}

/**
 * The label a transcript keeps for an import. The photographs are the request
 * and they are never repeated into the transcript, so what a reopened chat has
 * to show is how many there were — and the direction, when there was any, since
 * that is the only part a person actually typed.
 */
export function wardrobeRunLabel(input: { photos: number; direction: string }): string {
  const count = `${input.photos} photo${input.photos === 1 ? "" : "s"}`;
  const direction = input.direction.trim();
  if (!direction) return count;
  const label = `${count} · ${direction}`;
  return label.length > 120 ? `${label.slice(0, 117)}…` : label;
}

function clampItems(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_ITEMS_PER_PHOTO;
  return Math.min(MAX_MAX_ITEMS_PER_PHOTO, Math.max(MIN_MAX_ITEMS_PER_PHOTO, Math.round(value)));
}

export function isWardrobeQuality(value: unknown): value is WardrobeQuality {
  return typeof value === "string" && (WARDROBE_QUALITIES as readonly string[]).includes(value);
}

/**
 * Read the flags a message may carry, and leave everything else as direction.
 *
 * Stored defaults arrive as `defaults`; anything typed in the message wins over
 * them, which is the rule every agent follows.
 *
 * There is deliberately no "skip the modeled photo" flag. The clone starts the
 * modeled stage the instant a cutout is approved, and approving the cutout is
 * what files the garment in the wardrobe — so a switch here could only ever
 * throw away a photo that had already been paid for. What genuinely decides it
 * is whether an identity reference exists, which is a setup question and is
 * answered in the settings panel.
 */
export function parseWardrobeRequest(
  text: string,
  defaults: WardrobeRequest = DEFAULT_WARDROBE_REQUEST,
): WardrobeRequest {
  let maxItemsPerPhoto = clampItems(defaults.maxItemsPerPhoto);
  let quality = defaults.quality;

  const direction = text
    .replace(/(^|\s)--items[= ](\d{1,2})(?=\s|$)/gi, (_match, lead: string, digits: string) => {
      maxItemsPerPhoto = clampItems(Number(digits));
      return lead;
    })
    .replace(/(^|\s)--quality[= ]([a-z]+)(?=\s|$)/gi, (match, lead: string, value: string) => {
      const lowered = value.toLowerCase();
      if (!isWardrobeQuality(lowered)) return match;
      quality = lowered;
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();

  return { direction: direction.slice(0, 1_200), maxItemsPerPhoto, quality };
}
