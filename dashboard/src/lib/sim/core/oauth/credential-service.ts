// Breadboard stand-in for sim's lib/oauth/credential-service.ts (simstudioai/sim,
// Apache-2.0). Sim exchanges a stored Google service-account key for an access token.
// Breadboard stores no credentials (see core/credentials/access), so this is
// unreachable in practice and fails loudly rather than returning an empty token.

export async function getServiceAccountToken(
  credentialId: string,
  _scopes: string[],
  _impersonateEmail?: string,
): Promise<string> {
  throw new Error(
    `Service-account credentials are not available in Breadboard (credential ${credentialId})`,
  );
}
