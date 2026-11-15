/**
 * How a handle is shown. Accounts on the default Bluesky host go by name alone,
 * so "ada.bsky.social" reads as "ada". Display only: lookups need the full handle.
 */
export const shortHandle = (handle?: string | null): string => handle ? handle.replace(/\.bsky\.social$/i, "") : "";
