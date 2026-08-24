import { isOpenGymSuperAgentRoutingCandidate } from "./identity.ts";

/**
 * Resolve a likely fitness request against the server-owned catalogue. Once a
 * request has clear exercise-form intent, resolver failure is fail-open: the
 * openGym run can still render a card and explain a missing catalogue, whereas
 * handing the prompt to the model can silently lose the requested widget.
 */
export async function shouldRouteOpenGymFromSuperAgent(
  task: string,
): Promise<boolean> {
  if (!isOpenGymSuperAgentRoutingCandidate(task)) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch("/api/open-gym/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task }),
      signal: controller.signal,
    });
    if (!response.ok) return true;
    const data = (await response.json().catch(() => ({}))) as {
      route?: unknown;
    };
    return data.route === true;
  } catch {
    return true;
  } finally {
    clearTimeout(timeout);
  }
}
