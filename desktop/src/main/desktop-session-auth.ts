import type { Session } from "electron";

/** Ask only the authenticated local dashboard which exact tab owners ended. */
export async function finishedAutomationTabOwners(dashboardUrl: string,
  session: Pick<Session, "cookies">, owners: string[], signal: AbortSignal, fetchStatus: typeof fetch = fetch): Promise<string[]> {
  const url = new URL("/api/browser/automation-tabs", dashboardUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Invalid desktop session origin");
  }
  const cookies = await session.cookies.get({ url: url.href });
  const response = await fetchStatus(url.href, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    headers: { "Content-Type": "application/json", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    body: JSON.stringify({ owners }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Automation tab status unavailable"); }
  const body = await response.json() as { finishedOwners?: unknown };
  if (!Array.isArray(body?.finishedOwners) || !body.finishedOwners.every(owner => typeof owner === "string")) {
    throw new Error("Invalid automation tab status");
  }
  return body.finishedOwners.filter(owner => owners.includes(owner));
}

/** Keep the control bridge's account check available while renderers stream.
 * The server still authenticates the actual desktop cookie on every call. */
export async function desktopSessionAccountId(dashboardUrl: string,
  session: Pick<Session, "cookies">, fetchSession: typeof fetch = fetch): Promise<string> {
  const url = new URL("/api/auth/session", dashboardUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Invalid desktop session origin");
  }
  const cookies = await session.cookies.get({ url: url.href });
  const response = await fetchSession(url.href, {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
    headers: { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
  });
  if (!response.ok) { await response.body?.cancel(); return ""; }
  const body = await response.json() as { user?: { id?: string | number } };
  return String(body?.user?.id || "");
}
