// Breadboard stand-in for sim's lib/oauth/utils.ts (simstudioai/sim, Apache-2.0).
// Sim's OAUTH_PROVIDERS catalog names every integration's scopes for its credential
// picker UI. Breadboard's blocks take plain API keys, so the only surviving caller
// (blocks/utils, filling an `oauth-input` subblock's requiredScopes) gets an empty list.

export function getScopesForService(_serviceId: string): string[] {
  return [];
}
