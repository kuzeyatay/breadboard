import "server-only";
import { timingSafeEqual } from "node:crypto";
import { acquireServiceLease, releaseSupervisorLease, isRuntimeV2ServiceControlConfigured } from "../supervisor-control.ts";
import { fail } from "./types.ts";
import type { PrinterAdapter, PrinterAccess } from "./adapter.ts";
import type { BambuStore } from "./store.ts";

function endpoint() {
  const token = process.env.BREADBOARD_BAMBU_SERVICE_TOKEN ?? "";
  let url: URL;
  try { url = new URL(process.env.BREADBOARD_BAMBU_SERVICE_URL ?? ""); } catch { fail("The supervised printer service is unavailable. Start Breadboard with its desktop runtime.", "bambu_runtime_unavailable", 503); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || token.length < 32) fail("Printer runtime configuration is invalid.", "bambu_runtime_unavailable", 503);
  return { origin: url.origin, token };
}
export function authorizeBambuRuntime(request: Request) {
  const expected = Buffer.from(`Bearer ${endpoint().token}`), provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) fail("Printer runtime authorization failed.", "runtime_unauthorized", 401);
}
async function request<T>(action: string, body: unknown, timeoutMs = 20000): Promise<T> {
  const { origin, token } = endpoint();
  const response = await fetch(`${origin}/v1/${action}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) fail("Printer communication failed. Check its status before retrying.", "bambu_transport", 502);
  return payload.result as T;
}
export class BambuRuntimeAdapter implements PrinterAdapter {
  test(access: PrinterAccess) { return request<Awaited<ReturnType<PrinterAdapter["test"]>>>("test", { access }); }
  observe(access: PrinterAccess, fresh = false) { return request<Awaited<ReturnType<PrinterAdapter["observe"]>>>("observe", { access, fresh }); }
  upload(access: PrinterAccess, input: Parameters<PrinterAdapter["upload"]>[1]) { return request<Awaited<ReturnType<PrinterAdapter["upload"]>>>("upload", { access, input }, 15 * 60_000); }
  start(access: PrinterAccess, input: Parameters<PrinterAdapter["start"]>[1]) { return request<void>("start", { access, input }); }
  control(access: PrinterAccess, input: Parameters<PrinterAdapter["control"]>[1]) { return request<void>("control", { access, input }); }
}
let ensuring: Promise<void> | null = null;
export async function ensureBambuRuntime(store: BambuStore): Promise<void> {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    endpoint();
    if (!isRuntimeV2ServiceControlConfigured()) fail("Printer work requires Breadboard's supervised desktop runtime.", "bambu_runtime_unavailable", 503);
    const lease = await acquireServiceLease("bambu-printer", "Approved printer job or read-only connection test");
    if (!lease) fail("Printer runtime could not be acquired.", "bambu_runtime_unavailable", 503);
    try { await request("ready", {}); }
    catch (error) { await releaseSupervisorLease({ id: lease.id, targetId: "bambu-printer" }); throw error; }
    const previous = store.db.prepare("SELECT lease_id FROM bambu_runtime_leases").all() as { lease_id: string }[];
    store.db.prepare("INSERT OR IGNORE INTO bambu_runtime_leases VALUES (?)").run(lease.id);
    for (const old of previous) if (old.lease_id !== lease.id) { await releaseSupervisorLease({ id: old.lease_id, targetId: "bambu-printer" }); store.db.prepare("DELETE FROM bambu_runtime_leases WHERE lease_id = ?").run(old.lease_id); }
  })().finally(() => { ensuring = null; });
  return ensuring;
}
export async function releaseIdleBambuRuntime(store: BambuStore) {
  if (store.active().length) return;
  const leases = store.db.prepare("SELECT lease_id FROM bambu_runtime_leases").all() as { lease_id: string }[];
  for (const lease of leases) { await releaseSupervisorLease({ id: lease.lease_id, targetId: "bambu-printer" }); store.db.prepare("DELETE FROM bambu_runtime_leases WHERE lease_id = ?").run(lease.lease_id); }
}
export async function restoreBambuRuntime(store: BambuStore) {
  if (store.active().length) await ensureBambuRuntime(store);
}
