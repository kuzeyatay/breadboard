"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NavBar from "@/app/components/navbar";

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

const STATE_STYLE: Record<RuntimeState, { label: string; dot: string; text: string }> = {
  available: { label: "Available", dot: "bg-emerald-400", text: "text-emerald-300" },
  starting: { label: "Starting", dot: "bg-amber-400", text: "text-amber-300" },
  unavailable: { label: "Unavailable", dot: "bg-rose-400", text: "text-rose-300" },
  misconfigured: { label: "Misconfigured", dot: "bg-amber-400", text: "text-amber-300" },
  disabled: { label: "Disabled", dot: "bg-gray-500", text: "text-gray-400" },
};

const RISK_STYLE: Record<string, string> = {
  high: "text-rose-300",
  medium: "text-amber-300",
  low: "text-emerald-300",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as { ok: boolean } & Record<string, unknown>;
  if (!res.ok || data.ok === false) throw new Error(String(data.error ?? res.status));
  return data as unknown as T;
}

// Small building blocks matching the dashboard's neu-* system.
const BTN_PRIMARY =
  "neu-button-primary px-4 py-2 bg-white text-gray-950 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2";
const BTN_SECONDARY =
  "neu-button px-4 py-2 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40";
const BTN_DESTRUCTIVE =
  "neu-button-destructive px-4 py-2 text-sm rounded-lg inline-flex items-center justify-center gap-2";
const INPUT =
  "neu-control w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-gray-600";

function BackIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export default function AgentsClient({ email, username }: { email: string; username: string }) {
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

  const adapterOk = adapter?.status === "healthy";

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col pb-16">
      <NavBar email={email} username={username} />

      <div className="max-w-5xl mx-auto w-full px-6 py-8 flex-1">
        <a href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors">
          <BackIcon /> Back to gardens
        </a>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-gray-500">Runtime agents that act on your behalf in an isolated browser.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-400">
            <span className={`h-2 w-2 rounded-full ${adapterOk ? "bg-emerald-400" : "bg-rose-400"}`} />
            Runtime adapter:&nbsp;
            <span className={adapterOk ? "text-emerald-300" : "text-rose-300"}>
              {mode === "disabled" ? "disabled" : adapterOk ? `available${adapter?.realBrowser ? "" : " · simulated"}` : "unavailable"}
            </span>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
            Could not load agents: {error}
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} onConfigure={() => setConfiguring(a)} onRun={() => setRunning(a)} />
            ))}
          </div>
        )}
      </div>

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
      {running && (
        <RunWorkspace
          agent={running}
          onClose={() => {
            setRunning(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AgentCard({ agent, onConfigure, onRun }: { agent: Agent; onConfigure: () => void; onRun: () => void }) {
  const state = STATE_STYLE[agent.runtimeState];
  const canRun = agent.enabled && agent.runtimeState === "available";
  return (
    <div className="neu-surface relative flex flex-col gap-4 rounded-xl border-2 border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">🌐</span>
            <h2 className="truncate text-base font-semibold text-white">{agent.name}</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-gray-200">{agent.runtime ?? agent.kind}</span>
            {agent.capabilities.map((c) => (
              <span key={c} className="rounded-md border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400">{c}</span>
            ))}
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-700 px-2 py-1 text-[11px] ${state.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} /> {state.label}
        </span>
      </div>

      <p className="text-[13px] leading-5 text-gray-400">{agent.description}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        <Meta k="Model" v={agent.configuration.model || "not set"} />
        <Meta k="Provider" v={agent.configuration.provider} />
        <Meta k="Strategy" v={agent.configuration.browserStrategy} />
        <Meta k="Approval" v={agent.configuration.approvalMode === "every_action" ? "every action" : "sensitive"} />
        <Meta k="Credential" v={agent.secretConfigured ? "configured" : "not configured"} />
        <Meta k="Last run" v={agent.lastRun ? agent.lastRun.status : "—"} />
      </dl>

      <div className="mt-1 flex gap-2">
        <button className={BTN_SECONDARY} onClick={onConfigure}>Configure</button>
        <button className={canRun ? BTN_PRIMARY : `${BTN_SECONDARY} cursor-not-allowed`} disabled={!canRun} onClick={onRun} title={canRun ? "" : "Configure a model to run"}>
          Run task
        </button>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-gray-500">{k}</dt>
      <dd className="truncate font-medium text-gray-200" title={v}>{v}</dd>
    </div>
  );
}

// ---- Modal shell with a Back/close affordance --------------------------------
function Modal({ title, subtitle, onClose, children, footer, wide }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`neu-dialog w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-2xl border border-gray-800 bg-gray-900`}>
        <header className="flex items-start justify-between gap-4 border-b border-gray-800 px-6 py-4">
          <div className="min-w-0">
            <button onClick={onClose} className="mb-1 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors">
              <BackIcon /> Back
            </button>
            <h2 className="truncate text-lg font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="neu-button-icon rounded-full p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="max-h-[70vh] overflow-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-800 px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] text-gray-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-600">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-700">
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-emerald-500/80" : "border border-gray-700 bg-gray-900"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${checked ? "translate-x-[18px] bg-gray-950" : "translate-x-0.5 bg-gray-500"}`} />
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-gray-500 first:mt-0">{children}</h3>;
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
    <Modal
      title={`Configure ${agent.name}`}
      subtitle="Browser-only operator · runs in an isolated profile"
      onClose={onClose}
      footer={
        <>
          {err && <span className="mr-auto text-xs text-rose-300">{err}</span>}
          <button className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <SectionTitle>Runtime</SectionTitle>
      <div className="flex items-center gap-3">
        <button className={BTN_SECONDARY} onClick={testConnection}>Test connection</button>
        {testMsg && <span className="text-xs text-gray-400">{testMsg}</span>}
      </div>

      <SectionTitle>Model</SectionTitle>
      <Field label="Provider"><input className={INPUT} value={cfg.provider} onChange={(e) => set("provider", e.target.value)} /></Field>
      <Field label="Model"><input className={INPUT} value={cfg.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. UI-TARS-1.5-7B" /></Field>
      <Field label="Endpoint (optional)"><input className={INPUT} value={cfg.endpoint ?? ""} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://…/v1" /></Field>
      <Field
        label={`API key ${agent.secretConfigured ? "· configured" : "· not configured"}`}
        hint="Write-only — stored server-side and never returned to the browser."
      >
        <input
          className={INPUT}
          type="password"
          value={credential}
          disabled={removeCredential}
          placeholder={agent.secretConfigured ? "•••••••• (leave blank to keep)" : "Enter provider API key"}
          onChange={(e) => setCredential(e.target.value)}
        />
        {agent.secretConfigured && (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={removeCredential} onChange={(e) => setRemoveCredential(e.target.checked)} /> Remove stored key
          </label>
        )}
      </Field>

      <SectionTitle>Browser operator</SectionTitle>
      <p className="mb-3 text-[12px] leading-5 text-gray-500">
        Runs in a dedicated, isolated browser profile — no access to your normal browser, cookies, or password manager.
      </p>
      <Field label="Strategy">
        <select className={INPUT} value={cfg.browserStrategy} onChange={(e) => set("browserStrategy", e.target.value as Configuration["browserStrategy"])}>
          <option value="dom">DOM — safe bring-up (no vision model)</option>
          <option value="hybrid">Hybrid</option>
          <option value="gui">GUI — visual grounding (needs vision model)</option>
        </select>
      </Field>

      <SectionTitle>Permissions</SectionTitle>
      <Field label="Allowed domains" hint="Comma-separated. Empty = unrestricted; off-list navigation needs approval.">
        <input className={INPUT} value={cfg.allowedDomains.join(", ")} onChange={(e) => set("allowedDomains", e.target.value.split(",").map((d) => d.trim()).filter(Boolean))} />
      </Field>
      <Field label="Approval policy">
        <select className={INPUT} value={cfg.approvalMode} onChange={(e) => set("approvalMode", e.target.value as Configuration["approvalMode"])}>
          <option value="sensitive_actions">Sensitive actions (recommended)</option>
          <option value="every_action">Every action</option>
        </select>
      </Field>
      <div className="space-y-2">
        <Toggle label="Allow downloads" checked={cfg.allowDownloads} onChange={(v) => set("allowDownloads", v)} />
        <Toggle label="Allow clipboard" checked={cfg.allowClipboard} onChange={(v) => set("allowClipboard", v)} />
        <Toggle label="Allow file upload" checked={cfg.allowFileUpload} onChange={(v) => set("allowFileUpload", v)} />
      </div>

      <SectionTitle>Limits</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Max steps"><input className={INPUT} type="number" min={1} max={200} value={cfg.maxSteps} onChange={(e) => set("maxSteps", Number(e.target.value))} /></Field>
        <Field label="Max runtime (seconds)"><input className={INPUT} type="number" min={5} max={1800} value={Math.round(cfg.timeoutMs / 1000)} onChange={(e) => set("timeoutMs", Number(e.target.value) * 1000)} /></Field>
      </div>
    </Modal>
  );
}

function RunWorkspace({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [task, setTask] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);

  const applyEvent = useCallback((e: RunEvent) => {
    seqRef.current = Math.max(seqRef.current, e.sequenceNumber);
    setEvents((prev) => (prev.some((p) => p.sequenceNumber === e.sequenceNumber) ? prev : [...prev, e].sort((a, b) => a.sequenceNumber - b.sequenceNumber)));
    if (e.type === "observation.screenshot") {
      const sid = String((e.payload as { screenshotId?: string }).screenshotId ?? "");
      if (sid) setShot(sid);
    }
    if (e.type === "observation.page") {
      const url = (e.payload as { url?: string }).url;
      if (url) setPageUrl(url);
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
    es.onmessage = (m) => { try { applyEvent(JSON.parse(m.data) as RunEvent); } catch { /* ignore */ } };
    [
      "run.started", "run.status", "observation.page", "observation.screenshot", "action.proposed", "approval.requested",
      "approval.approved", "approval.rejected", "action.started", "action.completed", "action.failed", "run.completed",
      "run.failed", "run.aborted", "runtime.disconnected",
    ].forEach((t) => {
      es.addEventListener(t, (m) => { try { applyEvent(JSON.parse((m as MessageEvent).data) as RunEvent); } catch { /* ignore */ } });
    });
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
      setShot(null);
      setPageUrl(null);
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
    <Modal
      title={agent.name}
      subtitle={runId ? `Status: ${status}` : "Launch a browser task"}
      onClose={onClose}
      wide={Boolean(runId)}
      footer={
        runId ? (
          <>
            {err && <span className="mr-auto text-xs text-rose-300">{err}</span>}
            {!terminal && <button className={BTN_DESTRUCTIVE} onClick={stop}>Stop</button>}
            {terminal && (
              <button className={BTN_PRIMARY} onClick={() => { setRunId(null); setStatus("idle"); setShot(null); setEvents([]); setPageUrl(null); }}>
                New task
              </button>
            )}
            <button className={BTN_SECONDARY} onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            {err && <span className="mr-auto text-xs text-rose-300">{err}</span>}
            <button className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
            <button className={task.trim() ? BTN_PRIMARY : `${BTN_SECONDARY} cursor-not-allowed`} disabled={!task.trim()} onClick={launch}>Launch</button>
          </>
        )
      }
    >
      {!runId ? (
        <Field label="Task" hint="Describe what the operator should do in the browser.">
          <textarea className={`${INPUT} min-h-[120px] resize-y`} value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Open example.com, fill the contact form and submit it." />
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Screenshot + approval */}
          <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
            {pageUrl && <div className="truncate border-b border-gray-800 px-3 py-1.5 text-[11px] text-gray-500">{pageUrl}</div>}
            {shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/ui-tars/agents/${agent.id}/runs/${runId}/screenshots/${shot}`} alt="Browser screenshot" className="block w-full" />
            ) : (
              <div className="flex h-56 items-center justify-center text-xs text-gray-600">Waiting for first screenshot…</div>
            )}
            {pending && (
              <div className="absolute inset-x-3 bottom-3 rounded-xl border border-gray-700 bg-gray-900/95 p-3 shadow-xl backdrop-blur">
                <div className="text-[13px] font-semibold text-white">
                  Approval required · <span className={RISK_STYLE[pending.risk] ?? "text-gray-300"}>{pending.risk} risk</span>
                </div>
                <div className="mt-1 text-[13px] text-gray-300">{pending.explanation}</div>
                <div className="mt-1 break-all text-[11px] text-gray-500">{pending.action}: {pending.target}</div>
                <div className="mt-3 flex justify-end gap-2">
                  <button className={BTN_DESTRUCTIVE} onClick={() => decide("reject")}>Reject</button>
                  <button className={BTN_PRIMARY} onClick={() => decide("approve")}>Approve</button>
                </div>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="flex max-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
            <div className="sticky top-0 border-b border-gray-800 bg-gray-950 px-3 py-2 text-[13px] font-semibold text-gray-300">Timeline</div>
            <ul className="flex-1 overflow-auto p-2">
              {events.length === 0 && <li className="px-2 py-3 text-xs text-gray-600">No events yet…</li>}
              {events.map((e) => (
                <li key={e.sequenceNumber} className="border-b border-gray-900 px-2 py-1.5 text-[12px] last:border-0">
                  <span className="mr-2 font-mono text-[11px] text-sky-300">{e.type}</span>
                  <span className="break-words text-gray-400">{summarize(e)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
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
  if (e.type === "observation.screenshot") return "screenshot captured";
  return "";
}
