const AGENCY_AGENTS_DIRECTORY_TOKEN = "agents:agency-agents";
export const AGENCY_AGENTS_DIRECTORY_COMMAND = `/${AGENCY_AGENTS_DIRECTORY_TOKEN}`;
const AGENCY_AGENT_TOKEN_PREFIX = `${AGENCY_AGENTS_DIRECTORY_TOKEN}:`;

const AGENCY_AGENT_SLUG = /^[a-z0-9][a-z0-9_.-]*$/i;

export function agencyAgentToken(slug: string): string {
  return `${AGENCY_AGENT_TOKEN_PREFIX}${slug}`;
}

export function agencyAgentSlugFromToken(token: string): string | null {
  const normalized = token.replace(/^\//, "").toLowerCase();
  if (!normalized.startsWith(AGENCY_AGENT_TOKEN_PREFIX)) return null;
  const slug = normalized.slice(AGENCY_AGENT_TOKEN_PREFIX.length);
  return AGENCY_AGENT_SLUG.test(slug) ? slug : null;
}
