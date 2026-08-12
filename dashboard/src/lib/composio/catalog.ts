import "server-only";

import type { ToolKitItem } from "@composio/core";
import { nangoIntegrationCatalog } from "../nango/catalog.ts";
import { composioClient, composioConfigured } from "./client.ts";

export interface ComposioIntegration {
  integrationId: string;
  provider: string;
  toolkitSlug: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string;
  authentication: "oauth" | "credentials" | "none";
  managedAuthentication: boolean;
}

const FEATURED: ReadonlyArray<{
  slug: string;
  toolkitSlug: string;
  name: string;
  legacyProvider: string;
}> = [
  { slug: "gmail", toolkitSlug: "gmail", name: "Gmail", legacyProvider: "google-mail" },
  { slug: "slack", toolkitSlug: "slack", name: "Slack", legacyProvider: "slack" },
  { slug: "github", toolkitSlug: "github", name: "GitHub", legacyProvider: "github" },
  {
    slug: "google-calendar",
    toolkitSlug: "googlecalendar",
    name: "Google Calendar",
    legacyProvider: "google-calendar",
  },
  {
    slug: "microsoft-outlook",
    toolkitSlug: "outlook",
    name: "Microsoft Outlook",
    legacyProvider: "outlook",
  },
  {
    slug: "microsoft-outlook-calendar",
    toolkitSlug: "outlook",
    name: "Microsoft Outlook Calendar",
    legacyProvider: "outlook",
  },
  {
    slug: "microsoft-teams",
    toolkitSlug: "microsoft_teams",
    name: "Microsoft Teams",
    legacyProvider: "microsoft-teams",
  },
  { slug: "notion", toolkitSlug: "notion", name: "Notion", legacyProvider: "notion" },
] as const;

const TOOLKIT_RE = /^[a-z0-9][a-z0-9_]{0,99}$/;
const BREADBOARD_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function legacyLogo(provider: string): string {
  return `/api/hermes/nango/integrations/logo?provider=${encodeURIComponent(provider)}`;
}

function featuredCatalog(): ComposioIntegration[] {
  return FEATURED.map((item) => ({
    integrationId: `composio:${item.slug}`,
    provider: item.toolkitSlug,
    toolkitSlug: item.toolkitSlug,
    slug: item.slug,
    name: item.name,
    description: `Connect ${item.name} through Composio so agents can use its information and actions when you ask.`,
    logoUrl: legacyLogo(item.legacyProvider),
    authentication: "oauth",
    managedAuthentication: true,
  }));
}

function toolkitAuthentication(
  toolkit: ToolKitItem,
): ComposioIntegration["authentication"] {
  if (toolkit.noAuth) return "none";
  if (
    toolkit.authSchemes?.some((scheme) =>
      ["OAUTH1", "OAUTH2", "DCR_OAUTH", "S2S_OAUTH2"].includes(
        scheme.toUpperCase(),
      ),
    )
  ) {
    return "oauth";
  }
  return "credentials";
}

export function breadboardSlugForComposioToolkit(toolkitSlug: string): string {
  const featured = FEATURED.find((item) => item.toolkitSlug === toolkitSlug);
  if (featured) return featured.slug;
  return toolkitSlug.replace(/_/g, "-");
}

export function breadboardSlugsForComposioToolkit(toolkitSlug: string): string[] {
  const featured = FEATURED.filter((item) => item.toolkitSlug === toolkitSlug).map(
    (item) => item.slug,
  );
  return featured.length ? featured : [breadboardSlugForComposioToolkit(toolkitSlug)];
}

export function composioToolkitForBreadboardSlug(slugValue: string): string | null {
  const slug = slugValue.trim().toLowerCase();
  const featured = FEATURED.find(
    (item) => item.slug === slug || `composio:${item.slug}` === slug,
  );
  if (featured) return featured.toolkitSlug;
  const normalized = slug.startsWith("composio:") ? slug.slice(9) : slug;
  if (!BREADBOARD_SLUG_RE.test(normalized)) return null;
  const toolkit = normalized.replace(/-/g, "_");
  return TOOLKIT_RE.test(toolkit) ? toolkit : null;
}

export function findComposioIntegration(
  value: string,
  catalog: readonly ComposioIntegration[] = featuredCatalog(),
): ComposioIntegration | null {
  const normalized = value.trim().toLowerCase();
  return (
    catalog.find(
      (item) =>
        item.slug === normalized ||
        item.integrationId.toLowerCase() === normalized ||
        item.toolkitSlug === normalized,
    ) ?? null
  );
}

let catalogCache: { expiresAt: number; value: ComposioIntegration[] } | null = null;

export async function composioIntegrationCatalog(): Promise<ComposioIntegration[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.value;
  const featured = featuredCatalog();
  if (!composioConfigured()) return featured;
  try {
    const toolkits = await composioClient().toolkits.get({
      limit: 500,
      sortBy: "usage",
    });
    const featuredToolkits = new Set(FEATURED.map((item) => item.toolkitSlug));
    const remaining = toolkits
      .filter(
        (toolkit) =>
          TOOLKIT_RE.test(toolkit.slug) && !featuredToolkits.has(toolkit.slug),
      )
      .map((toolkit): ComposioIntegration => {
        const slug = breadboardSlugForComposioToolkit(toolkit.slug);
        const authentication = toolkitAuthentication(toolkit);
        return {
          integrationId: `composio:${slug}`,
          provider: toolkit.slug,
          toolkitSlug: toolkit.slug,
          slug,
          name: toolkit.name,
          description:
            toolkit.meta.description?.trim() ||
            `Connect ${toolkit.name} through Composio so agents can use it when you ask.`,
          logoUrl: toolkit.meta.logo?.trim() || legacyLogo(toolkit.slug.replace(/_/g, "-")),
          authentication,
          managedAuthentication: Boolean(toolkit.composioManagedAuthSchemes?.length),
        };
      });
    const value = [...featured, ...remaining];
    catalogCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return value;
  } catch {
    // Keep featured cards available during a transient catalog outage. The
    // connection endpoint still returns the precise broker error on click.
    return featured;
  }
}

// The old direct-OAuth catalog remains deliberately reachable by its own API.
// Touching it here also protects its local provider assets from tree-shaking in
// packaged desktop builds while Composio is the active connection broker.
export const retainedDirectOAuthIntegrationCount = () =>
  nangoIntegrationCatalog().length;
