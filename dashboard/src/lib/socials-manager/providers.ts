// The social networks Postiz knows how to write for.
//
// Ported from the vendored clone rather than invented: identifiers and editors
// come from postiz-app/libraries/nestjs-libraries/src/integrations/social/*.provider.ts
// and the character limits from
// postiz-app/apps/frontend/src/components/new-launch/providers/*/.
//
// Only the drafting-relevant shape is carried across. Postiz's provider classes
// are NestJS services bound to its Prisma schema, Temporal workflows and per
// network OAuth apps; importing them would drag that whole runtime in. What the
// agent actually needs to write a good post is the network's name, how long a
// post may be, and whether its editor takes plain text, markdown or HTML.

export type SocialsManagerEditor = "normal" | "markdown" | "html";

export interface SocialsManagerProvider {
  /** Postiz's own identifier, kept identical so drafts stay portable. */
  id: string;
  name: string;
  editor: SocialsManagerEditor;
  /** Hard character ceiling for a single post on this network. */
  maxCharacters: number;
  /** Short note surfaced in the UI when the limit is conditional. */
  note?: string;
}

/**
 * X's ceiling depends on the account tier (280 free, 4000 premium) — the clone
 * resolves it from per-channel settings. Breadboard has no such setting yet, so
 * the safe floor is the default and the note explains the ceiling.
 */
export const SOCIALS_MANAGER_PROVIDERS: readonly SocialsManagerProvider[] = [
  { id: "x", name: "X", editor: "normal", maxCharacters: 280, note: "4000 on a premium account" },
  { id: "linkedin", name: "LinkedIn", editor: "normal", maxCharacters: 3000 },
  { id: "linkedin-page", name: "LinkedIn Page", editor: "normal", maxCharacters: 3000 },
  { id: "facebook", name: "Facebook Page", editor: "normal", maxCharacters: 63206 },
  { id: "instagram", name: "Instagram (Facebook Business)", editor: "normal", maxCharacters: 2200 },
  { id: "instagram-standalone", name: "Instagram (Standalone)", editor: "normal", maxCharacters: 2200 },
  { id: "threads", name: "Threads", editor: "normal", maxCharacters: 500 },
  { id: "nostr", name: "Nostr", editor: "normal", maxCharacters: 100000 },
  { id: "wrapcast", name: "Farcaster", editor: "normal", maxCharacters: 800 },
  { id: "tiktok", name: "TikTok", editor: "normal", maxCharacters: 2000 },
  { id: "youtube", name: "YouTube", editor: "normal", maxCharacters: 5000 },
  { id: "twitch", name: "Twitch", editor: "normal", maxCharacters: 500 },
  { id: "kick", name: "Kick", editor: "normal", maxCharacters: 500 },
  { id: "pinterest", name: "Pinterest", editor: "normal", maxCharacters: 500 },
  { id: "dribbble", name: "Dribbble", editor: "normal", maxCharacters: 40000 },
  { id: "reddit", name: "Reddit", editor: "normal", maxCharacters: 10000 },
  { id: "lemmy", name: "Lemmy", editor: "normal", maxCharacters: 10000 },
  { id: "discord", name: "Discord", editor: "markdown", maxCharacters: 1980 },
  { id: "slack", name: "Slack", editor: "normal", maxCharacters: 400000 },
  { id: "telegram", name: "Telegram", editor: "html", maxCharacters: 4096 },
  { id: "mewe", name: "MeWe", editor: "normal", maxCharacters: 63206 },
  { id: "vk", name: "VK", editor: "normal", maxCharacters: 2048 },
  { id: "tumblr", name: "Tumblr", editor: "normal", maxCharacters: 32768 },
  { id: "skool", name: "Skool", editor: "normal", maxCharacters: 50000 },
  { id: "whop", name: "Whop", editor: "markdown", maxCharacters: 50000 },
  { id: "moltbook", name: "Moltbook", editor: "normal", maxCharacters: 300 },
  { id: "gmb", name: "Google My Business", editor: "normal", maxCharacters: 1500 },
  { id: "devto", name: "Dev.to", editor: "markdown", maxCharacters: 100000 },
  { id: "hashnode", name: "Hashnode", editor: "markdown", maxCharacters: 10000 },
  { id: "medium", name: "Medium", editor: "markdown", maxCharacters: 100000 },
  { id: "wordpress", name: "WordPress", editor: "html", maxCharacters: 100000 },
  { id: "listmonk", name: "ListMonk", editor: "html", maxCharacters: 300000 },
];

/**
 * Useful local-only drafts when the user has not connected an account yet.
 * Keep this to broadly applicable text-first social formats: connected accounts
 * remain authoritative, while this set makes the agent useful before setup.
 */
export const OFFLINE_DRAFT_PROVIDER_IDS: readonly string[] = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "threads",
];

const BY_ID = new Map(SOCIALS_MANAGER_PROVIDERS.map((provider) => [provider.id, provider]));

export function findSocialsManagerProvider(id: string): SocialsManagerProvider | null {
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

export function isSocialsManagerProviderId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value.trim().toLowerCase());
}

/** Resolve a free-text network mention ("twitter", "LinkedIn") to a provider. */
export function resolveProviderMention(value: string): SocialsManagerProvider | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    twitter: "x",
    tweet: "x",
    "x.com": "x",
    fb: "facebook",
    ig: "instagram",
    insta: "instagram",
    li: "linkedin",
    yt: "youtube",
    farcaster: "wrapcast",
    warpcast: "wrapcast",
    "dev.to": "devto",
    gbp: "gmb",
    "google business": "gmb",
  };
  const aliased = aliases[normalized];
  if (aliased) return BY_ID.get(aliased) ?? null;
  const direct = BY_ID.get(normalized);
  if (direct) return direct;
  return (
    SOCIALS_MANAGER_PROVIDERS.find(
      (provider) => provider.name.toLowerCase() === normalized,
    ) ?? null
  );
}
