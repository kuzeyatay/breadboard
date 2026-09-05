/** Browser bridge credentials travel only in authenticated requests, never prompts. */
export interface BrowserTerminalAccess { port: number; token: string }

export function parseBrowserTerminalAccess(value: unknown): BrowserTerminalAccess | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { port, token } = value as BrowserTerminalAccess;
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    && typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
    ? { port, token } : undefined;
}

export async function currentBrowserTerminalAccess(): Promise<BrowserTerminalAccess | undefined> {
  if (typeof window === "undefined") return undefined;
  const desktop = (window as Window & { breadboardDesktop?: {
    getBrowserTerminalAccess?: () => Promise<BrowserTerminalAccess | null>;
  } }).breadboardDesktop;
  // An ordinary Terminal and an older shell keep working without browser access.
  return parseBrowserTerminalAccess(await desktop?.getBrowserTerminalAccess?.());
}
