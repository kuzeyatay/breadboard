/**
 * Microsoft suppresses FIDO/Windows Hello sign-in for Electron user agents,
 * although Chromium already supports the native Windows WebAuthn API. Present
 * the actual Chromium identity for web browsing, retaining its version and OS.
 * This belongs only to browser profiles; the product session keeps its identity.
 */
export function browserUserAgent(userAgent: string): string {
  if (!/\bChrome\/\d/.test(userAgent)) return userAgent;
  return userAgent.replace(/\s+(?:Electron|Breadboard(?:-desktop)?)\/\S+/gi, "");
}
