export interface ProviderUsageLink {
  href: string;
  label: string;
  title: string;
}

/**
 * Return the provider-owned page that reports live subscription usage.
 *
 * Breadboard embeds Claude's read-only usage snapshot. This provider-owned page
 * remains available as a detailed view and as a fallback when that snapshot is
 * unavailable.
 */
export function providerUsageLink(
  modelId: string | undefined,
): ProviderUsageLink | null {
  const normalized = modelId?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("cliproxy/claude-")) {
    return {
      href: "https://claude.ai/settings/usage",
      label: "Usage",
      title: "Open live Claude usage",
    };
  }
  return null;
}
