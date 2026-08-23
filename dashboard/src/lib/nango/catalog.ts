import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { repositoryRoot } from "../runtime-paths.ts";

type ProviderDefinition = {
  display_name?: unknown;
  alias?: unknown;
  auth_mode?: unknown;
  categories?: unknown;
  docs?: unknown;
  default_scopes?: unknown;
  authorization_url?: unknown;
  token_url?: unknown;
  authorization_params?: unknown;
  token_params?: unknown;
  refresh_params?: unknown;
  authorization_method?: unknown;
  body_format?: unknown;
  disable_pkce?: unknown;
  scope_separator?: unknown;
  proxy?: unknown;
};

export interface ConnectedAppOAuthMetadata {
  authorizationUrl: string;
  tokenUrl: string;
  baseUrl: string;
  authorizationParams: Record<string, string>;
  tokenParams: Record<string, string>;
  refreshParams: Record<string, string>;
  proxyHeaders: Record<string, string>;
  authorizationMethod: "body" | "header";
  bodyFormat: "form" | "json";
  disablePkce: boolean;
  scopeSeparator: string;
}

export interface NangoIntegration {
  integrationId: string;
  provider: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string;
  authentication: "oauth" | "credentials" | "none";
  authMode: string;
  oauthFamily: string | null;
  scopes: string[];
}

const FEATURED: Array<{
  slug: string;
  provider: string;
  name?: string;
}> = [
  { slug: "spotify", provider: "spotify", name: "Spotify" },
  { slug: "gmail", provider: "google-mail", name: "Gmail" },
  { slug: "slack", provider: "slack" },
  { slug: "github", provider: "github", name: "GitHub" },
  { slug: "google-calendar", provider: "google-calendar" },
  {
    slug: "microsoft-outlook",
    provider: "outlook",
    name: "Microsoft Outlook",
  },
  {
    slug: "microsoft-outlook-calendar",
    provider: "outlook",
    name: "Microsoft Outlook Calendar",
  },
  { slug: "microsoft-teams", provider: "microsoft-teams" },
  { slug: "notion", provider: "notion" },
];

const SCOPES: Record<string, string[]> = {
  spotify: [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-library-read",
    "user-library-modify",
    "playlist-modify-private",
  ],
  gmail: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  slack: [
    "channels:history",
    "channels:read",
    "chat:write",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "users:read",
  ],
  github: ["repo", "read:org", "user"],
  "google-calendar": [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
  ],
  "microsoft-outlook": [
    "offline_access",
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
  ],
  "microsoft-outlook-calendar": [
    "offline_access",
    "User.Read",
    "Calendars.ReadWrite",
  ],
  "microsoft-teams": [
    "offline_access",
    "User.Read",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Read.All",
    "ChannelMessage.Send",
    "Chat.ReadWrite",
  ],
};

let catalogCache: NangoIntegration[] | null = null;
let providerCache: Record<string, ProviderDefinition> | null = null;

function providersPath(): string | null {
  const candidates = [
    path.join(
      repositoryRoot(),
      "nango",
      "packages",
      "providers",
      "providers.yaml",
    ),
    path.resolve(
      process.cwd(),
      "..",
      "nango",
      "packages",
      "providers",
      "providers.yaml",
    ),
    path.resolve(
      process.cwd(),
      "nango",
      "packages",
      "providers",
      "providers.yaml",
    ),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function nangoLogoPath(provider: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(provider)) return null;
  const candidates = [
    path.join(
      repositoryRoot(),
      "nango",
      "packages",
      "webapp",
      "public",
      "images",
      "template-logos",
      `${provider}.svg`,
    ),
    path.resolve(
      process.cwd(),
      "..",
      "nango",
      "packages",
      "webapp",
      "public",
      "images",
      "template-logos",
      `${provider}.svg`,
    ),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function providerDefinitions(): Record<string, ProviderDefinition> {
  if (providerCache) return providerCache;
  const sourcePath = providersPath();
  if (!sourcePath) return {};
  try {
    const parsed = load(fs.readFileSync(sourcePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    providerCache = parsed as Record<string, ProviderDefinition>;
    return providerCache;
  } catch {
    return {};
  }
}

function humanize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function inheritedValue(
  provider: string,
  field: keyof ProviderDefinition,
  seen = new Set<string>(),
): unknown {
  if (seen.has(provider)) return undefined;
  seen.add(provider);
  const definition = providerDefinitions()[provider];
  if (!definition) return undefined;
  if (definition[field] !== undefined) return definition[field];
  const alias =
    typeof definition.alias === "string" ? definition.alias.trim() : "";
  return alias ? inheritedValue(alias, field, seen) : undefined;
}

function plainStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function connectedAppOAuthMetadata(
  integration: NangoIntegration,
): ConnectedAppOAuthMetadata | null {
  if (integration.authMode !== "OAUTH2") return null;
  const authorizationUrl = inheritedValue(
    integration.provider,
    "authorization_url",
  );
  const tokenUrl = inheritedValue(integration.provider, "token_url");
  const proxy = inheritedValue(integration.provider, "proxy");
  const proxyRecord =
    proxy && typeof proxy === "object" && !Array.isArray(proxy)
      ? (proxy as Record<string, unknown>)
      : null;
  const baseUrl = proxyRecord?.base_url;
  if (
    typeof authorizationUrl !== "string" ||
    typeof tokenUrl !== "string" ||
    typeof baseUrl !== "string" ||
    [authorizationUrl, tokenUrl, baseUrl].some((value) => value.includes("${"))
  ) {
    return null;
  }
  const authorizationMethod = inheritedValue(
    integration.provider,
    "authorization_method",
  );
  const bodyFormat = inheritedValue(integration.provider, "body_format");
  const separator = inheritedValue(integration.provider, "scope_separator");
  return {
    authorizationUrl,
    tokenUrl,
    baseUrl,
    authorizationParams: plainStringMap(
      inheritedValue(integration.provider, "authorization_params"),
    ),
    tokenParams: plainStringMap(
      inheritedValue(integration.provider, "token_params"),
    ),
    refreshParams: plainStringMap(
      inheritedValue(integration.provider, "refresh_params"),
    ),
    proxyHeaders: Object.fromEntries(
      Object.entries(plainStringMap(proxyRecord?.headers)).filter(
        ([key, value]) => !key.includes("${") && !value.includes("${"),
      ),
    ),
    authorizationMethod: authorizationMethod === "header" ? "header" : "body",
    bodyFormat: bodyFormat === "json" ? "json" : "form",
    disablePkce:
      inheritedValue(integration.provider, "disable_pkce") === true,
    scopeSeparator:
      typeof separator === "string" && separator.length <= 4 ? separator : " ",
  };
}

function authMode(provider: string): string {
  const value = inheritedValue(provider, "auth_mode");
  return typeof value === "string" ? value.toUpperCase() : "NONE";
}

function authenticationForMode(
  mode: string,
): NangoIntegration["authentication"] {
  if (mode.includes("OAUTH") || mode === "APP" || mode === "TBA") {
    return "oauth";
  }
  if (mode === "NONE") return "none";
  return "credentials";
}

function oauthFamily(provider: string): string | null {
  const root = inheritedValue(provider, "alias");
  if (typeof root === "string" && root.trim()) return root.trim();
  if (provider.startsWith("google-")) return "google";
  if (provider.startsWith("microsoft-") || provider === "outlook") {
    return "microsoft";
  }
  return provider;
}

function integration(
  slug: string,
  provider: string,
  nameOverride?: string,
): NangoIntegration | null {
  const definition = providerDefinitions()[provider];
  if (!definition) return null;
  const mode = authMode(provider);
  const displayName =
    nameOverride ||
    (typeof definition.display_name === "string"
      ? definition.display_name.trim()
      : "") ||
    humanize(provider);
  const inheritedScopes = inheritedValue(provider, "default_scopes");
  return {
    integrationId: `breadboard-${slug}`,
    provider,
    slug,
    name: displayName,
    description: `Connect ${displayName} so agents can use its information and available actions when you ask.`,
    logoUrl: `/api/hermes/nango/integrations/logo?provider=${encodeURIComponent(provider)}`,
    authentication: authenticationForMode(mode),
    authMode: mode,
    oauthFamily: oauthFamily(provider),
    scopes:
      SCOPES[slug] ??
      (Array.isArray(inheritedScopes)
        ? inheritedScopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : []),
  };
}

export function nangoIntegrationCatalog(): NangoIntegration[] {
  if (catalogCache) return catalogCache;
  const featured = FEATURED.map((entry) =>
    integration(entry.slug, entry.provider, entry.name),
  ).filter((item): item is NangoIntegration => item !== null);
  const featuredProviders = new Set(FEATURED.map((entry) => entry.provider));
  const remaining = Object.keys(providerDefinitions())
    .filter(
      (provider) =>
        /^[a-z0-9][a-z0-9-]{0,99}$/.test(provider) &&
        !featuredProviders.has(provider),
    )
    .map((provider) => integration(provider, provider))
    .filter((item): item is NangoIntegration => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
  catalogCache = [...featured, ...remaining];
  return catalogCache;
}

export function findNangoIntegration(
  value: string,
): NangoIntegration | null {
  const normalized = value.trim().toLowerCase();
  return (
    nangoIntegrationCatalog().find(
      (item) =>
        item.slug === normalized ||
        item.integrationId.toLowerCase() === normalized,
    ) ?? null
  );
}
