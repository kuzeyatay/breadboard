"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---- Types mirrored from the API (redacted; never contains secrets) ----
type RuntimeState = "available" | "starting" | "unavailable" | "misconfigured" | "disabled";

interface Configuration {
  operator: "browser";
  browserStrategy: "gui" | "dom" | "hybrid";
  provider: string;
  model: string;
  endpoint?: string;
  maxSteps: number;
  timeoutMs: number;
  approvalMode: "every_action" | "sensitive_actions";
  allowedDomains: string[];
  allowDownloads: boolean;
  allowClipboard: boolean;
  allowFileUpload: boolean;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  kind: "prompt" | "runtime";
  runtime: "ui-tars" | "openharness" | null;
  capabilities: string[];
  enabled: boolean;
  isDefault: boolean;
  configuration: Configuration;
  secretConfigured: boolean;
  runtimeState: RuntimeState;
  lastRun?: { id: string; status: string; createdAt: string };
}

interface AdapterHealth {
  status: "healthy" | "unavailable";
  runtime: "fake" | "agent-tars" | null;
  realBrowser: boolean;
  version: string | null;
}

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface PendingApproval {
  actionId: string;
  action: string;
  target: string;
  explanation: string;
  risk: string;
  screenshotBefore?: string;
  requestedAt: string;
  expiresAt: string;
}

const STATE_COLOR: Record<RuntimeState, string> = {
  available: "#1f9d55",
  starting: "#b7791f",
  unavailable: "#a0616a",
  misconfigured: "#b7791f",
  disabled: "#6b7280",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as { ok: boolean } & Record<string, unknown>;
  if (!res.ok || data.ok === false) throw new Error(String(data.error ?? res.status));
  return data as unknown as T;
}

export default function AgentsClient({ username }: { username: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [adapter, setAdapter] = useState<AdapterHealth | null>(null);
  const [mode, setMode] = useState<string>("optional");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<Agent | null>(null);
  const [running, setRunning] = useState<Agent | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ agents: Agent[]; adapter: AdapterHealth; mode: string }>("/api/ui-tars/agents");
      setAgents(data.agents);
      setAdapter(data.adapter);
      setMode(data.mode);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={S.page}>
      <style>{GLOBAL_CSS}</style>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>Agents</h1>
          <p style={S.sub}>Runtime and prompt agents for {username}</p>
        </div>
        <div style={S.adapterBadge}>
          Runtime adapter:{" "}
          <strong style={{ color: adapter?.status === "healthy" ? STATE_COLOR.available : STATE_COLOR.unavailable }}>
            {mode === "disabled" ? "disabled" : adapter?.status === "healthy" ? `available (${adapter.runtime}${adapter.realBrowser ? "" : ", simulated"})` : "unavailable"}
          </strong>
        </div>
      </header>

      {error && <div style={S.errorBar}>Could not load agents: {error}</div>}
      {loading ? (
        <p style={S.sub}>Loading…</p>
      ) : (
        <div style={S.grid}>
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} onConfigure={() => setConfiguring(a)} onRun={() => setRunning(a)} />
          ))}
        </div>
      )}

      {configuring && (
        <ConfigureModal
          agent={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={async () => {
            setConfiguring(null);
            await load();
          }}
        />
      )}
      {running && <RunWorkspace agent={running} onClose={() => { setRunning(null); void load(); }} />}
    </div>
  );
}

function AgentCard({ agent, onConfigure, onRun }: { agent: Agent; onConfigure: () => void; onRun: () => void }) {
  const canRun = agent.enabled && agent.runtimeState === "available";
  return (
    <div style={S.card}>
      <div style={S.cardTop}>
        <div>
          <div style={S.cardName}>{agent.name}</div>
          <div style={S.badges}>
            <span style={S.badge}>{agent.runtime ?? agent.kind}</span>
            {agent.capabilities.map((c) => (
              <span key={c} style={S.badgeMuted}>{c}</span>
            ))}
          </div>
        </div>
        <span style={{ ...S.stateDot, background: STATE_COLOR[agent.runtimeState] }} title={agent.runtimeState} />
      </div>
      <p style={S.cardDesc}>{agent.description}</p>
      <dl style={S.meta}>
        <Meta k="Runtime" v={agent.runtimeState} color={STATE_COLOR[agent.runtimeState]} />
        <Meta k="Model" v={agent.configuration.model || "not set"} />
        <Meta k="Provider" v={agent.configuration.provider} />
        <Meta k="Strategy" v={agent.configuration.browserStrategy} />
        <Meta k="Approval" v={agent.configuration.approvalMode === "every_action" ? "every action" : "sensitive actions"} />
        <Meta k="Credential" v={agent.secretConfigured ? "configured" : "not configured"} />
        <Meta k="Last run" v={agent.lastRun ? agent.lastRun.status : "—"} />
      </dl>
      <div style={S.cardActions}>
        <button style={S.btnSecondary} onClick={onConfigure}>Configure</button>
        <button style={canRun ? S.btnPrimary : S.btnDisabled} disabled={!canRun} onClick={onRun} title={canRun ? "" : "Runtime unavailable or misconfigured"}>
          Run task
        </button>
      </div>
    </div>
  );
}

function Meta({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={S.metaRow}>
      <dt style={S.metaKey}>{k}</dt>
      <dd style={{ ...S.metaVal, ...(color ? { color } : {}) }}>{v}</dd>
    </div>
  );
}

function ConfigureModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<Configuration>(agent.configuration);
  const [credential, setCredential] = useState("");
  const [removeCredential, setRemoveCredential] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const set = <K extends keyof Configuration>(k: K, v: Configuration[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { configuration: cfg };
      if (removeCredential) body.providerApiKey = null;
      else if (credential.trim()) body.providerApiKey = credential.trim();
      await api(`/api/ui-tars/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTestMsg("Checking…");
    try {
      const h = await api<{ health: AdapterHealth }>("/api/ui-tars/health");
      setTestMsg(h.health.status === "healthy" ? `Runtime healthy (${h.health.runtime ?? "?"})` : "Runtime unavailable");
    } catch (e) {
      setTestMsg(`Unavailable: ${(e as Error).message}`);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={S.h2}>Configure {agent.name}</h2>

        <Section title="Runtime">
          <button style={S.btnSecondary} onClick={testConnection}>Test connection</button>
          {testMsg && <span style={S.hint}> {testMsg}</span>}
        </Section>

        <Section title="Model">
          <Field label="Provider">
            <input style={S.input} value={cfg.provider} onChange={(e) => set("provider", e.target.value)} />
          </Field>
          <Field label="Model">
            <input style={S.input} value={cfg.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. UI-TARS-1.5-7B" />
          </Field>
          <Field label="Endpoint (optional)">
            <input style={S.input} value={cfg.endpoint ?? ""} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://…/v1" />
          </Field>
          <Field label={`API key ${agent.secretConfigured ? "(configured)" : "(not configured)"}`}>
            <input
              style={S.input}
              type="password"
              value={credential}
              disabled={removeCredential}
              placeholder={agent.secretConfigured ? "•••••••• (leave blank to keep)" : "Enter provider API key"}
              onChange={(e) => setCredential(e.target.value)}
            />
            {agent.secretConfigured && (
              <label style={S.check}>
                <input type="checkbox" checked={removeCredential} onChange={(e) => setRemoveCredential(e.target.checked)} /> Remove stored key
              </label>
            )}
            <div style={S.hint}>The key is write-only — it is stored server-side and never returned to the browser.</div>
          </Field>
        </Section>

        <Section title="Browser operator">
          <div style={S.hint}>Browser-only operator (fixed for MVP). Runs in an isolated browser profile — no access to your normal browser, cookies, or password manager.</div>
          <Field label="Strategy">
            <select style={S.input} value={cfg.browserStrategy} onChange={(e) => set("browserStrategy", e.target.value as Configuration["browserStrategy"])}>
              <option value="dom">DOM (safe bring-up; no vision model)</option>
              <option value="hybrid">Hybrid</option>
              <option value="gui">GUI / visual grounding (needs vision model)</option>
            </select>
          </Field>
        </Section>

        <Section title="Permissions">
          <Field label="Allowed domains (comma-separated; empty = unrestricted)">
            <input
              style={S.input}
              value={cfg.allowedDomains.join(", ")}
              onChange={(e) => set("allowedDomains", e.target.value.split(",").map((d) => d.trim()).filter(Boolean))}
            />
          </Field>
          <Field label="Approval policy">
            <select style={S.input} value={cfg.approvalMode} onChange={(e) => set("approvalMode", e.target.value as Configuration["approvalMode"])}>
              <option value="sensitive_actions">Sensitive actions (recommended)</option>
              <option value="every_action">Every action</option>
            </select>
          </Field>
          <Toggle label="Allow downloads" checked={cfg.allowDownloads} onChange={(v) => set("allowDownloads", v)} />
          <Toggle label="Allow clipboard" checked={cfg.allowClipboard} onChange={(v) => set("allowClipboard", v)} />
          <Toggle label="Allow file upload" checked={cfg.allowFileUpload} onChange={(v) => set("allowFileUpload", v)} />
        </Section>

        <Section title="Limits">
          <Field label="Maximum steps">
            <input style={S.input} type="number" min={1} max={200} value={cfg.maxSteps} onChange={(e) => set("maxSteps", Number(e.target.value))} />
          </Field>
          <Field label="Maximum runtime (seconds)">
            <input style={S.input} type="number" min={5} max={1800} value={Math.round(cfg.timeoutMs / 1000)} onChange={(e) => set("timeoutMs", Number(e.target.value) * 1000)} />
          </Field>
        </Section>

        {err && <div style={S.errorBar}>{err}</div>}
        <div style={S.modalActions}>
          <button style={S.btnSecondary} onClick={onClose}>Cancel</button>
          <button style={S.btnPrimary} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function RunWorkspace({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [task, setTask] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);

  const applyEvent = useCallback((e: RunEvent) => {
    seqRef.current = Math.max(seqRef.current, e.sequenceNumber);
    setEvents((prev) => (prev.some((p) => p.sequenceNumber === e.sequenceNumber) ? prev : [...prev, e].sort((a, b) => a.sequenceNumber - b.sequenceNumber)));
    if (e.type === "observation.screenshot") {
      const sid = String((e.payload as { screenshotId?: string }).screenshotId ?? "");
      if (sid) setShot(sid); // store just the id; URL is built in render with runId
    }
    if (e.type === "approval.requested") setPending(e.payload as unknown as PendingApproval);
    if (e.type === "approval.approved" || e.type === "approval.rejected") setPending(null);
    if (["run.completed", "run.failed", "run.aborted", "runtime.disconnected"].includes(e.type)) setPending(null);
    if (e.type.startsWith("run.")) setStatus(e.type.replace("run.", ""));
    if (e.type === "runtime.disconnected") setStatus("runtime_lost");
  }, []);

  const connect = useCallback((rid: string, since: number) => {
    esRef.current?.close();
    const es = new EventSource(`/api/ui-tars/agents/${agent.id}/runs/${rid}/events?since=${since}`);
    es.onmessage = (m) => {
      try { applyEvent(JSON.parse(m.data) as RunEvent); } catch { /* ignore */ }
    };
    // Named events also arrive; listen generically via addEventListener on known types.
    ["run.started", "run.status", "observation.page", "observation.screenshot", "action.proposed", "approval.requested", "approval.approved", "approval.rejected", "action.started", "action.completed", "action.failed", "run.completed", "run.failed", "run.aborted", "runtime.disconnected"].forEach((t) => {
      es.addEventListener(t, (m) => { try { applyEvent(JSON.parse((m as MessageEvent).data) as RunEvent); } catch { /* ignore */ } });
    });
    es.onerror = () => { /* EventSource auto-reconnects; terminal runs close server-side */ };
    esRef.current = es;
  }, [agent.id, applyEvent]);

  useEffect(() => () => esRef.current?.close(), []);

  const launch = async () => {
    setErr(null);
    try {
      const res = await api<{ run: { id: string; status: string } }>(`/api/ui-tars/agents/${agent.id}/runs`, {
        method: "POST",
        body: JSON.stringify({ task }),
      });
      setRunId(res.run.id);
      setStatus(res.run.status);
      setEvents([]);
      seqRef.current = 0;
      connect(res.run.id, 0);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const decide = async (kind: "approve" | "reject") => {
    if (!runId || !pending) return;
    try {
      await api(`/api/ui-tars/agents/${agent.id}/runs/${runId}/${kind}`, { method: "POST", body: JSON.stringify({ actionId: pending.actionId }) });
      setPending(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const stop = async () => {
    if (!runId) return;
    try { await api(`/api/ui-tars/agents/${agent.id}/runs/${runId}/abort`, { method: "POST", body: "{}" }); } catch (e) { setErr((e as Error).message); }
  };

  const terminal = ["completed", "failed", "aborted", "runtime_lost"].includes(status);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.wsHeader}>
          <div>
            <h2 style={S.h2}>{agent.name}</h2>
            <div style={S.hint}>Status: <strong>{status}</strong></div>
          </div>
          <button style={S.btnSecondary} onClick={onClose}>Close</button>
        </div>

        {!runId ? (
          <div>
            <Field label="Task">
              <textarea style={{ ...S.input, minHeight: 90 }} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Describe the browser task…" />
            </Field>
            {err && <div style={S.errorBar}>{err}</div>}
            <div style={S.modalActions}>
              <button style={task.trim() ? S.btnPrimary : S.btnDisabled} disabled={!task.trim()} onClick={launch}>Launch</button>
            </div>
          </div>
        ) : (
          <div style={S.wsBody}>
            <div style={S.wsScreenshot}>
              {shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/ui-tars/agents/${agent.id}/runs/${runId}/screenshots/${shot}`} alt="Browser screenshot" style={S.shotImg} />
              ) : (
                <div style={S.shotPlaceholder}>Waiting for first screenshot…</div>
              )}
              {pending && (
                <div style={S.approvalCard}>
                  <div style={S.approvalTitle}>Approval required · <span style={{ color: STATE_COLOR.misconfigured }}>{pending.risk} risk</span></div>
                  <div style={S.approvalBody}>{pending.explanation}</div>
                  <div style={S.approvalTarget}>{pending.action}: {pending.target}</div>
                  <div style={S.modalActions}>
                    <button style={S.btnDanger} onClick={() => decide("reject")}>Reject</button>
                    <button style={S.btnPrimary} onClick={() => decide("approve")}>Approve</button>
                  </div>
                </div>
              )}
            </div>
            <div style={S.timeline}>
              <div style={S.timelineHead}>Timeline</div>
              <ul style={S.timelineList}>
                {events.map((e) => (
                  <li key={e.sequenceNumber} style={S.timelineItem}>
                    <span style={S.tlType}>{e.type}</span>
                    <span style={S.tlText}>{summarize(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {runId && (
          <div style={S.modalActions}>
            {err && <div style={S.errorBar}>{err}</div>}
            {!terminal && <button style={S.btnDanger} onClick={stop}>Stop</button>}
            {terminal && <button style={S.btnPrimary} onClick={() => { setRunId(null); setStatus("idle"); setShot(null); setEvents([]); }}>Retry</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function summarize(e: RunEvent): string {
  const p = e.payload as Record<string, unknown>;
  if (e.type === "observation.page") return String(p.url ?? p.title ?? "");
  if (e.type === "run.status") return String(p.message ?? "");
  if (e.type === "action.proposed" || e.type === "action.started") return `${p.action ?? ""} ${p.target ?? ""}`.trim();
  if (e.type === "action.completed") return String(p.summary ?? "done");
  if (e.type === "action.failed" || e.type === "run.failed") return String(p.error ?? p.message ?? "error");
  if (e.type === "run.completed") return String(p.summary ?? "completed");
  return "";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={S.section}>
      <h3 style={S.h3}>{title}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={S.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

// ---- Styles (theme-aware via CSS variables in GLOBAL_CSS) ----
const GLOBAL_CSS = `
:root { --uta-bg:#ffffff; --uta-fg:#1a1a1a; --uta-muted:#6b7280; --uta-border:#e5e7eb; --uta-card:#fafafa; --uta-accent:#2563eb; }
@media (prefers-color-scheme: dark) { :root { --uta-bg:#0f1115; --uta-fg:#e6e6e6; --uta-muted:#9aa0aa; --uta-border:#272b33; --uta-card:#171a20; --uta-accent:#3b82f6; } }
.uta * { box-sizing: border-box; }
`;
const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: "0 auto", padding: 24, color: "var(--uta-fg)", background: "var(--uta-bg)", minHeight: "100vh", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  h1: { fontSize: 26, margin: 0 },
  h2: { fontSize: 20, margin: "0 0 8px" },
  h3: { fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--uta-muted)", margin: "16px 0 8px" },
  sub: { color: "var(--uta-muted)", margin: "4px 0 0" },
  adapterBadge: { fontSize: 13, color: "var(--uta-muted)", background: "var(--uta-card)", border: "1px solid var(--uta-border)", borderRadius: 8, padding: "8px 12px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 },
  card: { border: "1px solid var(--uta-border)", background: "var(--uta-card)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  cardName: { fontSize: 17, fontWeight: 600 },
  badges: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
  badge: { fontSize: 11, background: "var(--uta-accent)", color: "#fff", borderRadius: 6, padding: "2px 8px" },
  badgeMuted: { fontSize: 11, background: "transparent", color: "var(--uta-muted)", border: "1px solid var(--uta-border)", borderRadius: 6, padding: "2px 8px" },
  stateDot: { width: 12, height: 12, borderRadius: "50%", flexShrink: 0, marginTop: 4 },
  cardDesc: { color: "var(--uta-muted)", fontSize: 13, margin: "12px 0" },
  meta: { margin: 0, display: "grid", gap: 4 },
  metaRow: { display: "flex", justifyContent: "space-between", fontSize: 13 },
  metaKey: { color: "var(--uta-muted)", margin: 0 },
  metaVal: { margin: 0, fontWeight: 500 },
  cardActions: { display: "flex", gap: 8, marginTop: 16 },
  btnPrimary: { background: "var(--uta-accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 14 },
  btnSecondary: { background: "transparent", color: "var(--uta-fg)", border: "1px solid var(--uta-border)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 14 },
  btnDanger: { background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 14 },
  btnDisabled: { background: "var(--uta-border)", color: "var(--uta-muted)", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "not-allowed", fontSize: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto", zIndex: 50 },
  modal: { background: "var(--uta-bg)", color: "var(--uta-fg)", border: "1px solid var(--uta-border)", borderRadius: 12, padding: 24, width: "100%", maxWidth: 560 },
  modalActions: { display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 16, flexWrap: "wrap" },
  section: { borderTop: "1px solid var(--uta-border)", paddingTop: 4 },
  field: { display: "block", marginBottom: 12 },
  fieldLabel: { display: "block", fontSize: 13, color: "var(--uta-muted)", marginBottom: 4 },
  input: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--uta-border)", background: "var(--uta-bg)", color: "var(--uta-fg)", fontSize: 14 },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginTop: 6 },
  hint: { fontSize: 12, color: "var(--uta-muted)", marginTop: 4 },
  errorBar: { background: "#7f1d1d", color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "8px 0" },
  wsHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  wsBody: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 },
  wsScreenshot: { position: "relative", border: "1px solid var(--uta-border)", borderRadius: 8, overflow: "hidden", minHeight: 240, background: "var(--uta-card)" },
  shotImg: { width: "100%", display: "block" },
  shotPlaceholder: { display: "flex", alignItems: "center", justifyContent: "center", height: 240, color: "var(--uta-muted)", fontSize: 13 },
  approvalCard: { position: "absolute", left: 8, right: 8, bottom: 8, background: "var(--uta-bg)", border: "1px solid var(--uta-border)", borderRadius: 8, padding: 12 },
  approvalTitle: { fontWeight: 600, fontSize: 13 },
  approvalBody: { fontSize: 13, margin: "6px 0" },
  approvalTarget: { fontSize: 12, color: "var(--uta-muted)", wordBreak: "break-all" },
  timeline: { border: "1px solid var(--uta-border)", borderRadius: 8, background: "var(--uta-card)", maxHeight: 360, overflow: "auto" },
  timelineHead: { padding: "8px 12px", borderBottom: "1px solid var(--uta-border)", fontSize: 13, fontWeight: 600, position: "sticky", top: 0, background: "var(--uta-card)" },
  timelineList: { listStyle: "none", margin: 0, padding: 8 },
  timelineItem: { padding: "6px 8px", borderBottom: "1px solid var(--uta-border)", fontSize: 12 },
  tlType: { color: "var(--uta-accent)", fontFamily: "monospace", marginRight: 8 },
  tlText: { color: "var(--uta-fg)", wordBreak: "break-word" },
};
