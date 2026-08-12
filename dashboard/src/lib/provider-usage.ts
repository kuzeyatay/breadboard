export interface ProviderUsageLink {
  href: string;
  label: string;
  title: string;
}

/**
 * Return the provider-owned page that reports live subscription usage.
 *
 * Claude Code does not expose its plan-limit snapshot through a documented
 * non-interactive CLI command. Sending `/usage` through print mode would be a
 * real model request, so Breadboard opens Claude's own live usage view instead.
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
