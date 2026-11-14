import "server-only";

import { nangoIntegrationCatalog } from "../nango/catalog.ts";
import { brokerRest, composioConfigured } from "./client.ts";

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
  /** Auth scheme Connect sets up itself; null when sign-in is already managed. */
  connectScheme: string | null;
}

interface CatalogToolkit {
  slug: string;
  name: string;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  meta?: { description?: string; logo?: string };
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

/**
 * The apps people reach for first in ChatGPT and Claude, pinned right after
 * the featured ones, in this order. A name is given only where the catalog's
 * own differs. Every slug here issued a real sign-in link on 2026-11-10; an
 * app the catalog stops carrying simply drops out.
 */
const POPULAR: ReadonlyArray<readonly [toolkitSlug: string, name?: string]> = [
  ["higgsfield_mcp", "Higgsfield"],
  ["canva"], ["figma"], ["googledrive"], ["googledocs"], ["googlesheets"],
  ["googleslides"], ["linear"], ["jira"], ["confluence"], ["asana"],
  ["hubspot"], ["stripe"], ["intercom"], ["box"], ["dropbox"],
  ["one_drive"], ["share_point"], ["excel"], ["airtable"], ["clickup"],
  ["monday"], ["trello"], ["todoist"], ["calendly"], ["zoom"],
  ["googlemeet"], ["googletasks"], ["google_maps"], ["youtube"], ["miro"],
  ["discord"], ["linkedin"], ["reddit"], ["instagram"], ["salesforce"],
  ["zendesk"], ["square"], ["quickbooks"], ["mailchimp"], ["typeform"],
  ["supabase"], ["sentry"], ["vercel_mcp", "Vercel"],
  ["cloudflare_mcp", "Cloudflare"], ["netlify_mcp", "Netlify"],
  ["neon_mcp", "Neon"], ["gitlab"], ["bitbucket"], ["hugging_face"],
  ["granola_mcp", "Granola"], ["plaid_mcp", "Plaid"], ["ramp_mcp", "Ramp"],
  ["wix_mcp", "Wix"], ["attio"],
  ["elevenlabs"], ["heygen"], ["runway"], ["replicate"], ["fal_ai"],
  ["gamma"], ["perplexityai", "Perplexity"], ["firecrawl"], ["exa"],
  ["tavily"], ["apify"], ["posthog"], ["fireflies"], ["apollo"],
  ["ahrefs"], ["semrush"], ["telegram"], ["tripadvisor"],
];

/**
 * Schemes Connect can set up with no developer app of the user's own. Apps
 * that need no account are left out: there is nothing to connect, so an agent
 * would never be handed their tools.
 */
const SELF_SERVE_SCHEMES = ["DCR_OAUTH", "API_KEY", "BEARER_TOKEN", "BASIC"];

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
    description: `Connect ${item.name} so agents can use its information and actions when you ask.`,
    logoUrl: legacyLogo(item.legacyProvider),
    authentication: "oauth",
    managedAuthentication: true,
    connectScheme: null,
  }));
}

/** undefined: the app cannot be connected from here, so it is not offered. */
function toolkitConnectScheme(toolkit: CatalogToolkit): string | null | undefined {
  if (toolkit.composio_managed_auth_schemes?.length) return null;
  const schemes = (toolkit.auth_schemes ?? []).map((scheme) => scheme.toUpperCase());
  return SELF_SERVE_SCHEMES.find((scheme) => schemes.includes(scheme));
}

async function allToolkits(): Promise<CatalogToolkit[]> {
  const toolkits: CatalogToolkit[] = [];
  let cursor: string | null = null;
  // ~1,700 apps at 500 a page; the cap only stops a cursor that never ends.
  for (let page = 0; page < 10; page += 1) {
    const response: { items?: CatalogToolkit[]; next_cursor?: string | null } =
      await brokerRest(
        `/toolkits?limit=500&sort_by=usage${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
    toolkits.push(...(response.items ?? []));
    cursor = response.next_cursor ?? null;
    if (!cursor) break;
  }
  return toolkits;
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
    const featuredToolkits = new Set(FEATURED.map((item) => item.toolkitSlug));
    const popularRank = new Map(POPULAR.map(([toolkitSlug], index) => [toolkitSlug, index]));
    const remaining = (await allToolkits())
      .filter(
        (toolkit) =>
          TOOLKIT_RE.test(toolkit.slug) &&
          !featuredToolkits.has(toolkit.slug) &&
          // The broker's own account-management toolkit is not an app.
          !/composio/i.test(`${toolkit.slug} ${toolkit.name}`) &&
          toolkitConnectScheme(toolkit) !== undefined,
      )
      .map((toolkit): ComposioIntegration => {
        const slug = breadboardSlugForComposioToolkit(toolkit.slug);
        const connectScheme = toolkitConnectScheme(toolkit) ?? null;
        const name = POPULAR[popularRank.get(toolkit.slug) ?? -1]?.[1] ?? toolkit.name;
        const description = toolkit.meta?.description?.trim();
        return {
          integrationId: `composio:${slug}`,
          provider: toolkit.slug,
          toolkitSlug: toolkit.slug,
          slug,
          name,
          description:
            description && !/composio/i.test(description)
              ? description
              : `Connect ${name} so agents can use it when you ask.`,
          logoUrl: toolkit.meta?.logo?.trim() || legacyLogo(toolkit.slug.replace(/_/g, "-")),
          authentication:
            connectScheme === null || connectScheme === "DCR_OAUTH"
              ? "oauth"
              : "credentials",
          managedAuthentication: connectScheme === null,
          connectScheme,
        };
      });
    // Stable sort: popular apps first in their pinned order, the rest by usage.
    remaining.sort(
      (left, right) =>
        (popularRank.get(left.toolkitSlug) ?? POPULAR.length) -
        (popularRank.get(right.toolkitSlug) ?? POPULAR.length),
    );
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
