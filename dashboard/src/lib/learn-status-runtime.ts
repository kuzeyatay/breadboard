/**
 * TypeScript-visible contract for the compile-time Learn status runtime alias.
 * next.config.ts replaces this module with the development or production
 * implementation. Reaching this fallback means that isolation was not wired.
 */
export async function getLearnStatusSnapshotForRoute(_input: {
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown>> {
  throw new Error("The Learn status runtime alias is not configured.");
}
