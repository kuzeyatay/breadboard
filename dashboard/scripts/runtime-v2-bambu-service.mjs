import { startRuntimeV2GatewayHttpService } from "./runtime-v2-gateway-http.mjs";
import { BambuLanAdapter } from "./bambu-lan-adapter.mjs";

export async function startBambuService({ adapter, callback, argv = process.argv.slice(2) } = {}) {
  const token = process.env.BREADBOARD_BAMBU_SERVICE_TOKEN;
  const origin = new URL(process.env.BREADBOARD_BAMBU_DASHBOARD_ORIGIN ?? "http://127.0.0.1:3000");
  if (origin.protocol !== "http:" || !["127.0.0.1","localhost","[::1]"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/") throw new Error("Invalid printer dashboard endpoint.");
  const call = callback ?? (async body => {
    const response = await fetch(`${origin.origin}/api/hermes/connections/bambu/internal`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20 * 60_000), redirect: "error" });
    if (!response.ok) throw new Error("Printer backend unavailable.");
    return response.json();
  });
  const lan = adapter ?? new BambuLanAdapter({ onUploadProgress: (attemptId, bytes) => call({ action: "upload_progress", attemptId, bytes }) });
  let stopping = false, timer, recovered = false, failures = 0, recovery;
  function ensureRecovered() {
    if (recovered) return Promise.resolve();
    recovery ??= call({ action: "recover" }).then(() => { recovered = true; }).catch(error => { recovery = null; throw error; });
    return recovery;
  }
  async function tick() {
    if (stopping) return;
    try {
      await ensureRecovered();
      const result = await call({ action: "tick" });
      await lan.reap(new Set(result.serials ?? [])); failures = 0;
    } catch { failures = Math.min(failures + 1, 5); }
    if (!stopping) timer = setTimeout(tick, Math.min(30000, 2000 * 2 ** failures) + Math.floor(Math.random() * 500));
  }
  return startRuntimeV2GatewayHttpService({ name: "bambu-printer", tokenEnvironmentName: "BREADBOARD_BAMBU_SERVICE_TOKEN", argv,
    route: async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/ready") { await ensureRecovered(); return { ready: true }; }
      if (method !== "POST" || !/^\/v1\/(test|observe|upload|start|control)$/.test(path)) throw Object.assign(new Error("Unsupported printer operation."), { status: 404 });
      const action = path.slice(4);
      try { return await lan[action](body.access, action === "observe" ? body.fresh === true : body.input); }
      catch { throw Object.assign(new Error("Printer communication failed. Check the printer's display and connection."), { status: 502, code: "bambu_transport" }); }
    },
    onStarted: async () => { void ensureRecovered().catch(() => {}); timer = setTimeout(tick, 100); },
    onStop: async () => { stopping = true; clearTimeout(timer); await lan.close(); },
  });
}
if (process.argv[1]?.endsWith("runtime-v2-bambu-service.mjs")) await startBambuService();
