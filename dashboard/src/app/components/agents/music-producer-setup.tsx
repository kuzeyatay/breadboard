"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ProviderSettings = {
  mode: "managed" | "external";
  externalUrl: string;
  model: string;
  resonantSlug: string;
};
type Health = {
  state: string;
  message: string;
  settings: ProviderSettings & { keyConfigured: boolean };
  resonant?: string;
  stoppedGate?: boolean;
  hardware?: { cuda: boolean; mps: boolean; gpu: string | null };
};
type SetupJob = {
  jobId: string | null;
  state?: string;
  stage?: string;
  message?: string;
  detail?: string;
  cancellationRequested?: boolean;
};

const DEFAULTS: ProviderSettings = { mode: "managed", externalUrl: "", model: "acestep-v15-turbo", resonantSlug: "" };
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"]);
const fieldClass = "neu-inset w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/20 disabled:opacity-50";
const buttonClass = "neu-button rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45";
const primaryClass = buttonClass + " neu-button-accent border-[var(--botanical)] bg-[var(--botanical)] text-[var(--paper-raised)]";
const mutedClass = "text-xs leading-5 text-[var(--ink-muted)]";

function settingsOf(health: Health): ProviderSettings {
  const { mode, externalUrl, model, resonantSlug } = health.settings;
  return { mode, externalUrl, model, resonantSlug: resonantSlug ?? "" };
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.ok === false || !value) {
    throw new Error(typeof value?.error === "string" ? value.error : "Music Producer could not respond. Please try again.");
  }
  return value as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function statusLabel(health: Health | null) {
  if (!health) return "Not checked";
  return ({ ready: "Ready", stopped: "Ready on demand", "missing-models": "Needs setup", "resource-blocked": "Waiting for memory", unavailable: "Unavailable", busy: "In use", starting: "Starting", unsupported: "Unsupported model" } as Record<string, string>)[health.state] ?? "Not ready";
}

function setupMessage(job: SetupJob) {
  if (job.cancellationRequested && !TERMINAL.has(job.state ?? "")) return "Stopping setup. Waiting for the installer to exit.";
  if (job.message) return job.message;
  return ({ succeeded: "ACE-Step setup completed.", failed: "ACE-Step setup failed. Resolve the problem, then try setup again.", cancelled: "Setup was stopped. You can prepare ACE-Step again when ready.", resource_exhausted: "Setup needs more free memory. Close other heavy applications and try again.", interrupted: "Setup was interrupted. Prepare ACE-Step again to finish.", uncertain: "Setup completion could not be confirmed. Check readiness before trying again." } as Record<string, string>)[job.state ?? ""]
    ?? ({ queued: "Setup is queued.", preparing: "Preparing setup.", installing: "Installing ACE-Step and preparing its models.", verifying: "Verifying the installation.", finalizing: "Finishing setup." } as Record<string, string>)[job.stage ?? job.state ?? ""]
    ?? "ACE-Step setup is running. You can close this panel and return later.";
}

export default function MusicProducerSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [draft, setDraft] = useState<ProviderSettings>(DEFAULTS);
  const [saved, setSaved] = useState<ProviderSettings | null>(null);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState("");
  const [job, setJob] = useState<SetupJob | null>(null);
  const [setupKnown, setSetupKnown] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [pollAttempt, setPollAttempt] = useState(0);
  const initialized = useRef(false);
  const mutation = useRef(false);
  const healthSequence = useRef(0);
  const activeJob = Boolean(job?.jobId && !TERMINAL.has(job.state ?? ""));
  const dirty = saved !== null && (JSON.stringify(draft) !== JSON.stringify(saved) || Boolean(key) || removeKey);
  const locked = Boolean(action) || activeJob;

  const check = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++healthSequence.current;
    setChecking(true);
    try {
      const value = await request<Health>("/api/music-producer/health", { signal });
      if (signal?.aborted || sequence !== healthSequence.current) return;
      setHealth(value);
      setHealthError("");
      // A readiness check must never overwrite edits in the form.
      if (!initialized.current) {
        initialized.current = true;
        const settings = settingsOf(value);
        setDraft(settings);
        setSaved(settings);
      }
    } catch (cause) {
      if (!signal?.aborted && sequence === healthSequence.current) setHealthError(cause instanceof Error ? cause.message : "Readiness is unavailable.");
    } finally {
      if (!signal?.aborted && sequence === healthSequence.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);

  // Restore both running jobs and their final outcome. A lost poll keeps the
  // known job locked until observation resumes; it never starts another install.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await request<SetupJob>("/api/music-producer/setup", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJob(value.jobId ? value : null);
        setSetupKnown(true);
        setSetupError("");
        if (value.jobId && !TERMINAL.has(value.state ?? "")) timer = setTimeout(() => void poll(), 2000);
        else if (value.state === "succeeded") void check(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setSetupKnown(false);
          setSetupError(cause instanceof Error ? cause.message : "Setup status is unavailable.");
        }
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [check, pollAttempt]);

  function edit(value: Partial<ProviderSettings>) {
    setDraft(current => ({ ...current, ...value }));
    setNotice("");
    setError("");
  }

  async function save() {
    const settings = { ...draft, externalUrl: draft.mode === "managed" ? "" : draft.externalUrl.trim(), resonantSlug: draft.resonantSlug.trim() };
    await post("/api/music-producer/settings", { ...settings, ...(removeKey ? { apiKey: "" } : key ? { apiKey: key } : {}) });
    setSaved(settings);
    setDraft(settings);
    setKey("");
    setRemoveKey(false);
  }

  async function perform(name: string, work: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    setAction(name);
    setNotice("");
    setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That action could not finish."); }
    finally { mutation.current = false; setAction(null); }
  }

  const ready = health && ["ready", "stopped"].includes(health.state) && !health.stoppedGate;
  const existingKey = health?.settings.keyConfigured && draft.externalUrl.trim().replace(/\/$/, "") === saved?.externalUrl.replace(/\/$/, "");

  return <section className="space-y-4 text-sm" aria-label="Music provider setup">
    <div className="neu-surface-subtle space-y-2 rounded-xl border border-[var(--line)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-[var(--ink-heading)]">Music engine</h3>
        <span className={"inline-flex items-center gap-1.5 rounded-full bg-[var(--paper-strong)] px-2.5 py-1 text-[11px] " + (ready ? "text-[var(--botanical)]" : "text-[var(--ink-muted)]")}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {healthError ? "Status unavailable" : health?.stoppedGate ? "Needs recovery" : statusLabel(health)}
        </span>
      </div>
      <p className={mutedClass}>Create a musical draft and keep playable WAV versions with your conversation.</p>
      {healthError ? <p role="alert" className={mutedClass}>{healthError}</p> : <p role="status" className={mutedClass}>{health?.message ?? "Readiness has not been checked yet."}</p>}
      {health?.hardware ? <p className={mutedClass}>Acceleration: {health.hardware.cuda ? health.hardware.gpu ?? "NVIDIA CUDA" : health.hardware.mps ? "Apple MPS" : "CPU"}</p> : null}
      {dirty ? <p className={mutedClass}>Unsaved changes. Readiness reflects your saved provider.</p> : null}
      <button type="button" className={buttonClass} disabled={checking || Boolean(action)} onClick={() => void check()}>{checking ? "Checking readiness…" : "Check readiness"}</button>
    </div>

    <form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (!saved || locked) return;
      void perform("save", async () => { await save(); setNotice("Provider settings saved."); await check(); });
    }}>
      <fieldset disabled={!saved || locked} className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1.5"><span className="block text-xs font-medium">Provider mode</span>
            <select className={fieldClass} value={draft.mode} onChange={event => edit({ mode: event.target.value as ProviderSettings["mode"], ...(event.target.value === "managed" ? { model: "acestep-v15-turbo" } : {}) })}>
              <option value="managed">Local ACE-Step</option><option value="external">External ACE-Step</option>
            </select>
          </label>
          <label className="min-w-0 space-y-1.5"><span className="block text-xs font-medium">Audio model</span>
            <select className={fieldClass} value={draft.model} onChange={event => edit({ model: event.target.value })}>
              <option value="acestep-v15-turbo">ACE-Step 1.5 turbo</option>
              {draft.mode === "external" ? <><option value="acestep-v15-sft">ACE-Step 1.5 sft</option><option value="acestep-v15-base">ACE-Step 1.5 base</option></> : null}
            </select>
          </label>
        </div>
        {draft.mode === "external" ? <div className="space-y-3">
          <p className={mutedClass}>Connect an existing ACE-Step server. Prompts, lyrics and reference audio are sent to this endpoint.</p>
          <label className="block space-y-1.5"><span className="text-xs font-medium">Endpoint URL</span>
            <input className={fieldClass} type="url" required value={draft.externalUrl} onChange={event => edit({ externalUrl: event.target.value })} placeholder="http://127.0.0.1:8001" aria-describedby="music-endpoint-help" />
          </label>
          <p id="music-endpoint-help" className={mutedClass}>Use the server origin, without a path such as /v1.</p>
          <label className="block space-y-1.5"><span className="text-xs font-medium">API key</span>
            <input className={fieldClass} type="password" autoComplete="new-password" value={key} disabled={removeKey} onChange={event => { setKey(event.target.value); setNotice(""); }} placeholder={existingKey ? "Leave empty to keep the saved key" : "Optional API key"} />
          </label>
          {existingKey ? <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]"><input type="checkbox" checked={removeKey} onChange={event => { setRemoveKey(event.target.checked); setKey(""); setNotice(""); }} />Remove saved API key</label> : health?.settings.keyConfigured ? <p className={mutedClass}>Changing the endpoint clears its saved key. Enter a key for the new server if needed.</p> : null}
        </div> : <div className="space-y-2.5 rounded-xl border border-[var(--line)] p-3.5">
          <h4 className="text-xs font-medium text-[var(--ink-heading)]">Local model setup</h4>
          <p className={mutedClass}>Prepare ACE-Step once, then the model starts when you create music. Allow 30 GiB of free space for setup, including up to 16 GiB of model files, Python dependencies and cache.</p>
          <button type="button" className={primaryClass} disabled={!setupKnown} onClick={() => void perform("prepare", async () => {
            // Activate the selected local mode before starting its setup.
            if (dirty) await save();
            const value = await post<SetupJob>("/api/music-producer/setup", { confirmDownloads: true });
            if (!value.jobId) throw new Error("Setup did not return a job. Check setup status before trying again.");
            setJob(value);
            setSetupKnown(false);
            setPollAttempt(current => current + 1);
          })}>Download and prepare ACE-Step</button>
          <p className={mutedClass}><a className="underline underline-offset-2" href="https://github.com/ace-step/ACE-Step-1.5/blob/ca1e85fe9430179831e6bc6be790c332190a3866/LICENSE" target="_blank" rel="noreferrer">Source license</a> · <a className="underline underline-offset-2" href="https://huggingface.co/ACE-Step/Ace-Step1.5/tree/19671f406d603126926c1b7e2adc169acbcade22" target="_blank" rel="noreferrer">Model files and license</a></p>
        </div>}

        <details className="rounded-xl border border-[var(--line)] p-3.5">
          <summary className="cursor-pointer text-xs font-medium text-[var(--ink-heading)]">Arrangement with Resonant <span className="font-normal text-[var(--ink-muted)]">· Optional</span></summary>
          <div className="mt-3 space-y-2.5">
            <p className={mutedClass}>Connect Resonant to compose and mix in an approved local workspace. ACE-Step works independently of this connection.</p>
            <label className="block space-y-1.5"><span className="text-xs font-medium">Resonant connection name</span><input className={fieldClass} value={draft.resonantSlug} maxLength={48} pattern="[a-z0-9_-]*" onChange={event => edit({ resonantSlug: event.target.value })} placeholder="resonant" /></label>
            <p className={mutedClass}>{health?.resonant ?? "Not configured."}</p>
            <p className={mutedClass}>Approve Resonant in Connected Apps with a workspace (<code>--root</code>), then save its name here. Add <code>--arrange</code> to a request to use it. The final WAV is imported into the conversation. Resonant is separately installed AGPL software.</p>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className={primaryClass}>{action === "save" ? "Saving…" : "Save and test connection"}</button>{notice ? <p role="status" className={mutedClass}>{notice}</p> : null}</div>
      </fieldset>
    </form>

    {error ? <p role="alert" className="break-words text-xs leading-5 text-[var(--ink)]">{error}</p> : null}
    {job ? <div className="space-y-2 rounded-xl border border-[var(--line)] p-3.5">
      <p className="text-xs font-medium">{activeJob ? "Setup in progress" : job.state === "succeeded" ? "Setup complete" : job.state === "cancelled" ? "Setup stopped" : "Setup needs attention"}</p>
      <p role="status" className={mutedClass}>{setupMessage(job)}</p>
      {job.detail ? <p className={mutedClass + " whitespace-pre-wrap break-words"}>{job.detail}</p> : null}
      {activeJob ? <button type="button" className={buttonClass} disabled={Boolean(action) || job.cancellationRequested} onClick={() => void perform("stop", async () => {
        await request("/api/music-producer/setup", { method: "DELETE" });
        setJob(current => current ? { ...current, cancellationRequested: true } : current);
        setPollAttempt(current => current + 1);
      })}>{job.cancellationRequested ? "Stopping setup…" : "Stop setup"}</button> : null}
    </div> : null}
    {setupError ? <div className="space-y-2"><p role="alert" className={mutedClass}>{setupError} The last setup may still be running.</p><button type="button" className={buttonClass} disabled={Boolean(action)} onClick={() => setPollAttempt(current => current + 1)}>Retry setup status</button></div> : null}
    {draft.mode === "managed" && health?.stoppedGate ? <div className="space-y-2"><p className={mutedClass}>The stopped provider has an unfinished generation lock. Reset it before starting another track.</p><button type="button" className={buttonClass} disabled={locked || dirty} onClick={() => void perform("reset", async () => { await post("/api/music-producer/provider", { action: "clearStoppedGate" }); setNotice("Generation lock reset."); await check(); })}>Reset generation lock</button></div> : null}
  </section>;
}
