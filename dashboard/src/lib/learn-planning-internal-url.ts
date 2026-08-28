const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const COUNCIL_RECOVERY_PATHS = new Set([
  "/internal/council-results/resolve",
  "/internal/council-results/legacy-resolve",
  "/internal/council-results/legacy-inventory",
  "/internal/council-results/legacy-outcome",
]);

/** Build only the local, uncredentialed HTTP URLs used by promptless Learn
 * recovery reads. Keeping the endpoint allowlist here prevents an externally
 * configured OpenAI base URL from turning recovery into an authenticated SSRF
 * or redirect path. */
export function strictChatMockInternalRecoveryUrl(
  baseUrl: unknown,
  pathname: string,
): URL {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("ChatMock recovery base URL is unavailable.");
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("ChatMock recovery base URL is invalid.");
  }
  const basePath = parsed.pathname.replace(/\/+$/, "");
  if (
    parsed.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (basePath !== "" && basePath !== "/v1") ||
    !COUNCIL_RECOVERY_PATHS.has(pathname)
  ) {
    throw new Error(
      "ChatMock recovery requires an uncredentialed loopback HTTP /v1 base URL and an allowlisted internal endpoint.",
    );
  }
  parsed.pathname = `/v1${pathname}`;
  return parsed;
}
