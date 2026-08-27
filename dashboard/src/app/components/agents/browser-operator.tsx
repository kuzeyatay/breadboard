"use client";

// Agent TARS operator: agent cards, configuration, and the live run
// workspace. Rendered both on /agents and inside the capability palette's
// Agents tab, so it owns its own data loading and modals.

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import Image from "next/image";
import AgentTarsRunMetrics from "@/app/components/agent-tars-run-metrics";
import AgentTarsScreenshotGallery from "@/app/components/agent-tars-screenshot-gallery";
import { appendBoundedAgentRunEvent } from "@/lib/agent-run-history";
import {
  CHATMOCK_PROVIDER,
  DEFAULT_ASSISTANT_MODELS,
  formatAssistantModelName,
  groupAssistantModels,
} from "@/lib/ai-models";
import { AGENT_TARS_LOGO_PATH, agentTarsFailureMessage } from "@/lib/ui-tars/identity.ts";
import { safeAgentTarsMessage } from "@/lib/ui-tars/chat-response.ts";

// ---- Types mirrored from the API (redacted; never contains secrets) ----
type RuntimeState = "available" | "starting" | "unavailable" | "misconfigured" | "disabled";

interface Configuration {
  operator: "browser" | "computer";
  browserStrategy: "gui" | "dom" | "hybrid";
  desktopCoordinateSpace: "screen_pixels" | "normalized_1000";
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
  runtime: "ui-tars" | "hermes" | null;
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
  operators?: Array<"browser" | "computer">;
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

const RUN_STREAM_END_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "run.aborted",
  "runtime.disconnected",
]);

const STATE_STYLE: Record<RuntimeState, { label: string; dot: string; text: string }> = {
  available: { label: "Available", dot: "bg-[var(--botanical)]", text: "text-[var(--botanical)]" },
  starting: { label: "Starting", dot: "bg-[#8a6f00]", text: "text-[#8a6f00]" },
  unavailable: { label: "Unavailable", dot: "bg-[var(--danger)]", text: "text-[var(--danger)]" },
  misconfigured: { label: "Misconfigured", dot: "bg-[#8a6f00]", text: "text-[#8a6f00]" },
  disabled: { label: "Disabled", dot: "bg-[var(--ink-muted)]", text: "text-[var(--ink-muted)]" },
};

const RISK_STYLE: Record<string, string> = {
  high: "text-[var(--danger)]",
  medium: "text-[#8a6f00]",
  low: "text-[var(--botanical)]",
};

// Providers offered in the picker. Anything else is entered by hand and passed
// to the runtime as-is (it falls back to an OpenAI-compatible client).
const PROVIDER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: CHATMOCK_PROVIDER, label: "ChatMock — this server's local gateway" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "volcengine", label: "Volcengine (Doubao — visual grounding)" },
];

function isChatmock(provider: string): boolean {
  return provider.trim().toLowerCase() === CHATMOCK_PROVIDER;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as { ok: boolean } & Record<string, unknown>;
  if (!res.ok || data.ok === false) throw new Error(String(data.error ?? res.status));
  return data as unknown as T;
}

// Small building blocks matching the dashboard's neu-* system.
const BTN_PRIMARY =
  "neu-button-accent inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--botanical-hover)] bg-[var(--botanical)] px-4 py-2 text-sm font-medium text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:opacity-50";
const BTN_SECONDARY =
  "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-2 text-sm text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink-heading)] disabled:opacity-40";
const BTN_DESTRUCTIVE =
  "neu-button-destructive px-4 py-2 text-sm rounded-lg inline-flex items-center justify-center gap-2";
const INPUT =
  "neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] outline-none transition-colors focus:border-[var(--botanical)]";

function BackIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/**
 * The operator surface. `compact` drops the page-level heading for
 * hosts that supply their own (the capability palette).
 */
export default function BrowserOperatorPanel({ compact = false }: { compact?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [adapter, setAdapter] = useState<AdapterHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<Agent | null>(null);
  const [running, setRunning] = useState<Agent | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ agents: Agent[]; adapter: AdapterHealth }>("/api/ui-tars/agents");
      setAgents(data.agents);
      setAdapter(data.adapter);
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
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {compact ? (
          <span />
        ) : (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-gray-500">Run Agent TARS in an isolated browser or, with explicit approval, on your actual desktop.</p>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${adapterOk ? "bg-emerald-400" : "bg-rose-400"}`} />
          Runtime adapter:&nbsp;
          <span className={adapterOk ? "text-emerald-300" : "text-rose-300"}>
            {adapterOk ? `available${adapter?.realBrowser ? "" : " · simulated"}` : "unavailable"}
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
    </>
  );
}

/** Full-screen host for the panel, used by the capability palette. */
export function BrowserOperatorDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="browser-operator-title"
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-auto px-4 py-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bb-modal-panel neu-dialog w-full max-w-3xl rounded-2xl border text-[var(--ink)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-4">
          <div className="min-w-0">
            <button onClick={onClose} className="mb-1 inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)]">
              <BackIcon /> Back
            </button>
            <h2 id="browser-operator-title" className="truncate text-lg font-semibold text-[var(--ink-heading)]">Agent TARS</h2>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              Choose an isolated browser or explicitly approved control of your actual desktop.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close Agent TARS" className="neu-button-icon rounded-full p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="max-h-[75vh] overflow-auto px-6 py-5">
          <BrowserOperatorPanel compact />
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent, onConfigure, onRun }: { agent: Agent; onConfigure: () => void; onRun: () => void }) {
  const state = STATE_STYLE[agent.runtimeState];
  const canRun = agent.enabled && agent.runtimeState === "available";
  const chatmock = isChatmock(agent.configuration.provider);
  return (
    <div className="neu-surface relative flex flex-col gap-4 rounded-xl border-2 border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gray-200">
              <Image
                src={AGENT_TARS_LOGO_PATH}
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 object-contain brightness-0 invert opacity-90"
              />
            </span>
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
        <Meta k="Target" v={agent.configuration.operator === "computer" ? "actual desktop" : "isolated browser"} />
        <Meta k="Strategy" v={agent.configuration.operator === "computer" ? "visual GUI" : agent.configuration.browserStrategy} />
        <Meta k="Approval" v={agent.configuration.approvalMode === "every_action" ? "every action" : "sensitive"} />
        <Meta k="Credential" v={chatmock ? "server-managed" : agent.secretConfigured ? "configured" : "not configured"} />
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
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-auto px-4 py-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bb-modal-panel neu-dialog w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-2xl border text-[var(--ink)]`}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-4">
          <div className="min-w-0">
            <button onClick={onClose} className="mb-1 inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)]">
              <BackIcon /> Back
            </button>
            <h2 className="truncate text-lg font-semibold text-[var(--ink-heading)]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="neu-button-icon rounded-full p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="max-h-[70vh] overflow-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">{footer}</footer>}
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

  const chatmock = isChatmock(cfg.provider);
  const knownProvider = PROVIDER_OPTIONS.some((p) => p.id === cfg.provider);
  const modelOptions = useMemo(
    () => [...new Set([...DEFAULT_ASSISTANT_MODELS, ...(cfg.model ? [cfg.model] : [])])],
    [cfg.model],
  );

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
      subtitle={cfg.operator === "computer" ? "Actual desktop control · approval required for every run" : "Isolated browser operator"}
      onClose={onClose}
      footer={
        <>
          {err && <span className="mr-auto text-xs text-rose-300">{err}</span>}
          <button className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button className={BTN_PRIMARY} disabled={saving || !cfg.provider.trim()} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <SectionTitle>Runtime</SectionTitle>
      <div className="flex items-center gap-3">
        <button className={BTN_SECONDARY} onClick={testConnection}>Test connection</button>
        {testMsg && <span className="text-xs text-gray-400">{testMsg}</span>}
      </div>

      <SectionTitle>Model</SectionTitle>
      <Field
        label="Provider"
        hint={chatmock ? "Uses this server's local gateway — no API key needed." : undefined}
      >
        <select
          className={INPUT}
          value={knownProvider ? cfg.provider : "custom"}
          onChange={(e) => set("provider", e.target.value === "custom" ? "" : e.target.value)}
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          <option value="custom">Other (enter manually)</option>
        </select>
      </Field>
      {!knownProvider && (
        <Field label="Provider name" hint="Unknown providers are called through an OpenAI-compatible client.">
          <input className={INPUT} value={cfg.provider} onChange={(e) => set("provider", e.target.value)} placeholder="e.g. together" />
        </Field>
      )}
      <Field label="Model">
        {chatmock ? (
          <select className={INPUT} value={cfg.model} onChange={(e) => set("model", e.target.value)}>
            {groupAssistantModels(modelOptions).map((group) => (
              <optgroup key={group.vendorId} label={group.vendorLabel}>
                {group.models.map((m) => (
                  <option key={m} value={m}>{formatAssistantModelName(m)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <input className={INPUT} value={cfg.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. UI-TARS-1.5-7B" />
        )}
      </Field>
      <Field
        label="Endpoint (optional)"
        hint={chatmock ? "Leave blank to use the gateway this server is configured with." : undefined}
      >
        <input className={INPUT} value={cfg.endpoint ?? ""} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://…/v1" />
      </Field>
      <Field
        label={`API key ${chatmock ? "· optional" : agent.secretConfigured ? "· configured" : "· not configured"}`}
        hint={
          chatmock
            ? "Not required for the local gateway. Write-only — stored server-side and never returned to the browser."
            : "Write-only — stored server-side and never returned to the browser."
        }
      >
        <input
          className={INPUT}
          type="password"
          value={credential}
          disabled={removeCredential}
          placeholder={agent.secretConfigured ? "•••••••• (leave blank to keep)" : chatmock ? "Not required" : "Enter provider API key"}
          onChange={(e) => setCredential(e.target.value)}
        />
        {agent.secretConfigured && (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={removeCredential} onChange={(e) => setRemoveCredential(e.target.checked)} /> Remove stored key
          </label>
        )}
      </Field>

      <SectionTitle>Control target</SectionTitle>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => set("operator", "browser")}
          className={`rounded-xl border p-3 text-left transition-colors ${cfg.operator === "browser" ? "border-[var(--botanical)] bg-[var(--paper-strong)]" : "border-[var(--line)] bg-[var(--paper-surface)]"}`}
        >
          <span className="block text-sm font-semibold text-[var(--ink-heading)]">Isolated browser</span>
          <span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">Separate profile with no access to your normal browser data.</span>
        </button>
        <button
          type="button"
          onClick={() => setCfg((current) => ({ ...current, operator: "computer", approvalMode: "sensitive_actions" }))}
          className={`rounded-xl border p-3 text-left transition-colors ${cfg.operator === "computer" ? "border-[var(--danger)] bg-[var(--paper-strong)]" : "border-[var(--line)] bg-[var(--paper-surface)]"}`}
        >
          <span className="block text-sm font-semibold text-[var(--ink-heading)]">Actual desktop</span>
          <span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">Sees your screen and operates the real mouse and keyboard.</span>
        </button>
      </div>
      {cfg.operator === "computer" ? (
        <>
          <div className="mb-4 rounded-xl border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_7%,var(--paper-raised))] p-3 text-[12px] leading-5 text-[var(--ink)]">
            Desktop mode takes over your active mouse and keyboard and can interact with any visible app. Breadboard asks for a high-risk approval before each run starts.
          </div>
          <Field
            label="Model coordinate protocol"
            hint="General vision models report screenshot pixels. Native UI-TARS models use a normalized 1000 × 1000 grid."
          >
            <select
              className={INPUT}
              value={cfg.desktopCoordinateSpace}
              onChange={(e) => set(
                "desktopCoordinateSpace",
                e.target.value as Configuration["desktopCoordinateSpace"],
              )}
            >
              <option value="screen_pixels">Screenshot pixels — general vision models</option>
              <option value="normalized_1000">Normalized 1000 grid — native UI-TARS models</option>
            </select>
          </Field>
        </>
      ) : (
        <>
          <p className="mb-3 text-[12px] leading-5 text-gray-500">
            Runs in a dedicated, isolated browser profile — no access to your normal browser, cookies, or password manager.
          </p>
          <Field
            label="Strategy"
            hint="Visual grounding needs a vision-grounded provider (Doubao); other providers run in DOM mode."
          >
            <select className={INPUT} value={cfg.browserStrategy} onChange={(e) => set("browserStrategy", e.target.value as Configuration["browserStrategy"])}>
              <option value="dom">DOM — safe bring-up (no vision model)</option>
              <option value="hybrid">Hybrid</option>
              <option value="gui">GUI — visual grounding (needs vision model)</option>
            </select>
          </Field>
        </>
      )}

      <SectionTitle>Permissions</SectionTitle>
      {cfg.operator === "browser" && (
        <Field label="Allowed domains" hint="Comma-separated. Empty = unrestricted; off-list navigation needs approval.">
          <input className={INPUT} value={cfg.allowedDomains.join(", ")} onChange={(e) => set("allowedDomains", e.target.value.split(",").map((d) => d.trim()).filter(Boolean))} />
        </Field>
      )}
      <Field label="Approval policy">
        <select className={INPUT} value={cfg.approvalMode} onChange={(e) => set("approvalMode", e.target.value as Configuration["approvalMode"])}>
          <option value="sensitive_actions">{cfg.operator === "computer" ? "Approve once before each desktop run (recommended)" : "Sensitive actions (recommended)"}</option>
          <option value="every_action">{cfg.operator === "computer" ? "Desktop session and every action" : "Every action"}</option>
        </select>
      </Field>
      {cfg.operator === "browser" && (
        <div className="space-y-2">
          <Toggle label="Allow downloads (asks every time)" checked={cfg.allowDownloads} onChange={(v) => set("allowDownloads", v)} />
          <Toggle label="Allow clipboard" checked={cfg.allowClipboard} onChange={(v) => set("allowClipboard", v)} />
          <Toggle label="Allow file upload" checked={cfg.allowFileUpload} onChange={(v) => set("allowFileUpload", v)} />
        </div>
      )}

      <SectionTitle>Limits</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Max steps"><input className={INPUT} type="number" min={1} max={200} value={cfg.maxSteps} onChange={(e) => set("maxSteps", Number(e.target.value))} /></Field>
        <Field label="Max runtime (seconds)"><input className={INPUT} type="number" min={5} max={1800} value={Math.round(cfg.timeoutMs / 1000)} onChange={(e) => set("timeoutMs", Number(e.target.value) * 1000)} /></Field>
      </div>
    </Modal>
  );
}

function RunWorkspace({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const controlsDesktop = agent.configuration.operator === "computer";
  const [task, setTask] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);
  const timelineRef = useRef<HTMLUListElement | null>(null);
  const followTimelineRef = useRef(true);
  const launchRequestRef = useRef<{ task: string; requestId: string } | null>(null);

  const applyEvent = useCallback((e: RunEvent) => {
    seqRef.current = Math.max(seqRef.current, e.sequenceNumber);
    setEvents((previous) => appendBoundedAgentRunEvent(previous, e));
    if (e.type === "observation.page") {
      const url = (e.payload as { url?: string }).url;
      if (url) setPageUrl(url);
    }
    if (e.type === "approval.requested") setPending(e.payload as unknown as PendingApproval);
    if (e.type === "approval.approved" || e.type === "approval.rejected") setPending(null);
    if (["run.completed", "run.failed", "run.aborted", "runtime.disconnected"].includes(e.type)) setPending(null);
    if (e.type === "run.completed" && agentTarsFailureMessage(e.payload.summary)) {
      setStatus("failed");
    } else if (e.type === "run.started") {
      setStatus("running");
    } else if (["run.completed", "run.failed", "run.aborted"].includes(e.type)) {
      setStatus(e.type.replace("run.", ""));
    }
    if (e.type === "runtime.disconnected") setStatus("runtime_lost");
  }, []);

  const connect = useCallback((rid: string, since: number) => {
    esRef.current?.close();
    const es = new EventSource(`/api/ui-tars/agents/${agent.id}/runs/${rid}/events?since=${since}`);
    const handleMessage = (message: MessageEvent) => {
      try {
        const event = JSON.parse(message.data) as RunEvent;
        applyEvent(event);
        if (RUN_STREAM_END_EVENTS.has(event.type) && esRef.current === es) {
          esRef.current = null;
          es.close();
        }
      } catch {
        /* ignore */
      }
    };
    es.onmessage = handleMessage;
    [
      "run.started", "run.status", "agent.thinking", "agent.usage", "observation.page", "observation.screenshot", "action.proposed", "approval.requested",
      "approval.approved", "approval.rejected", "action.started", "action.completed", "action.failed", "run.completed",
      "run.failed", "run.aborted", "runtime.disconnected",
    ].forEach((t) => {
      es.addEventListener(t, handleMessage as EventListener);
    });
    esRef.current = es;
  }, [agent.id, applyEvent]);

  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !followTimelineRef.current) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [events]);

  const handleTimelineScroll = useCallback((event: UIEvent<HTMLUListElement>) => {
    const timeline = event.currentTarget;
    followTimelineRef.current =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 32;
  }, []);

  const launch = async () => {
    setErr(null);
    const normalizedTask = task.trim();
    const prior = launchRequestRef.current;
    const request =
      prior?.task === normalizedTask
        ? prior
        : { task: normalizedTask, requestId: crypto.randomUUID() };
    launchRequestRef.current = request;
    try {
      const res = await api<{ run: { id: string; status: string } }>(`/api/ui-tars/agents/${agent.id}/runs`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      launchRequestRef.current = null;
      setRunId(res.run.id);
      setStatus(res.run.status);
      setEvents([]);
      followTimelineRef.current = true;
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
      subtitle={runId ? `Status: ${status}` : controlsDesktop ? "Launch an actual-desktop task" : "Launch an isolated-browser task"}
      onClose={onClose}
      wide={Boolean(runId)}
      footer={
        runId ? (
          <>
            {err && <span className="mr-auto text-xs text-rose-300">{err}</span>}
            {!terminal && <button className={BTN_DESTRUCTIVE} onClick={stop}>Stop</button>}
            {terminal && (
              <button className={BTN_PRIMARY} onClick={() => { setRunId(null); setStatus("idle"); setEvents([]); setPageUrl(null); }}>
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
        <>
          {controlsDesktop && (
            <div className="mb-4 rounded-xl border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_7%,var(--paper-raised))] p-3 text-[12px] leading-5 text-[var(--ink)]">
              This run will request approval before it can see or control your actual desktop. Keep the desktop visible and do not use the mouse or keyboard while Agent TARS is acting. Stop the run at any time to release control.
            </div>
          )}
          <Field label="Task" hint={controlsDesktop ? "Describe what Agent TARS should do on the visible desktop." : "Describe what the operator should do in the isolated browser."}>
            <textarea
              className={`${INPUT} min-h-[120px] resize-y`}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder={controlsDesktop ? "e.g. Open Notepad and type a short note." : "e.g. Open example.com, fill the contact form and submit it."}
            />
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <AgentTarsRunMetrics events={events} active={!terminal} failed={status === "failed" || status === "runtime_lost"} />
          </div>
          {/* Screenshot + approval */}
          <div className="neu-surface-subtle relative flex aspect-[8/5] min-h-56 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]">
            {pageUrl && <div className="truncate border-b border-[var(--line)] bg-[var(--paper-strong)] px-3 py-1.5 font-mono text-[10px] text-[var(--ink-muted)]">{pageUrl}</div>}
            <AgentTarsScreenshotGallery
              key={runId}
              events={events}
              imageUrl={(screenshotId) => `/api/ui-tars/agents/${agent.id}/runs/${runId}/screenshots/${screenshotId}`}
              alt={controlsDesktop ? "Actual desktop screenshot" : "Browser screenshot"}
              emptyLabel={terminal ? "No screenshot was captured" : "Waiting for the first screenshot…"}
            />
            {pending && (
              <div className="neu-surface-raised absolute inset-x-3 bottom-3 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-raised)] p-3 shadow-xl">
                <div className="text-[13px] font-semibold text-[var(--ink-heading)]">
                  Approval required · <span className={RISK_STYLE[pending.risk] ?? "text-[var(--ink-muted)]"}>{pending.risk} risk</span>
                </div>
                <div className="mt-1 text-[13px] leading-5 text-[var(--ink)]">{pending.explanation}</div>
                <div className="mt-1 break-all font-mono text-[10px] text-[var(--ink-muted)]">{pending.action}: {pending.target}</div>
                <div className="mt-3 flex justify-end gap-2">
                  <button className={BTN_DESTRUCTIVE} onClick={() => decide("reject")}>Reject</button>
                  <button className={BTN_PRIMARY} onClick={() => decide("approve")}>Approve</button>
                </div>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="neu-surface-subtle flex aspect-[8/5] min-h-56 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]">
            <div className="sticky top-0 border-b border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-[13px] font-semibold text-[var(--ink-heading)]">Timeline</div>
            <ul
              ref={timelineRef}
              onScroll={handleTimelineScroll}
              aria-live="polite"
              className="flex-1 overflow-auto px-2 py-1.5"
            >
              {events.length === 0 && <li className="px-2 py-3 text-xs text-[var(--ink-muted)]">No events yet…</li>}
              {events.map((e) => (
                <li key={e.sequenceNumber} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 border-b border-[var(--line)] px-2 py-1.5 text-[12px] last:border-0">
                  <span className="font-mono text-[10px] font-medium text-[var(--botanical)]">{e.type}</span>
                  <span className="min-w-0 break-words text-[var(--ink-muted)]">{summarize(e)}</span>
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
  if (e.type === "agent.thinking") return String(p.summary ?? "Thinking");
  if (e.type === "agent.usage") return `${p.estimated === true ? "~" : ""}${p.totalTokens ?? 0} tokens`;
  if (e.type === "action.proposed" || e.type === "action.started") return `${p.action ?? ""} ${p.target ?? ""}`.trim();
  if (e.type === "action.completed") return String(p.summary ?? "done");
  if (e.type === "action.failed" || e.type === "run.failed") return safeAgentTarsMessage(p.error ?? p.message) || "error";
  if (e.type === "run.completed") {
    return agentTarsFailureMessage(p.summary) ?? String(p.summary ?? "completed");
  }
  if (e.type === "observation.screenshot") return "screenshot captured";
  return "";
}
