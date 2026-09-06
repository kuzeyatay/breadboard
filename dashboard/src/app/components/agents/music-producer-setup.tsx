"use client";
import { useCallback, useEffect, useState } from "react";
export default function MusicProducerSetup() {
  const [mode, setMode] = useState("managed"), [url, setUrl] = useState(""), [key, setKey] = useState("");
  const [model, setModel] = useState("acestep-v15-turbo"), [message, setMessage] = useState("");
  const [resonantSlug, setResonantSlug] = useState("");
  const [resonantStatus, setResonantStatus] = useState("Not configured."), [stoppedGate, setStoppedGate] = useState(false);
  const [job, setJob] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/music-producer/health");
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? "Could not check ACE-Step.");
      setMode(value.settings.mode);
      setUrl(value.settings.externalUrl);
      setModel(value.settings.model);
      setResonantSlug(value.settings.resonantSlug ?? "");
      setResonantStatus(value.resonant ?? "Connection status unavailable.");
      setStoppedGate(value.stoppedGate === true);
      setMessage(`${value.state}: ${value.message}${value.hardware ? ` Acceleration: ${value.hardware.cuda ? value.hardware.gpu : value.hardware.mps ? "Apple MPS" : "CPU (no supported GPU detected)"}.` : ""}`);
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check ACE-Step.");
    }
  }, []);
  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/music-producer/setup", { signal: controller.signal }).then(response => response.json()).then(value => {
      if (value.jobId && !["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"].includes(value.state)) {
        setJob(value.jobId);
        setBusy(true);
      }
    }).catch(() => { });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!job)
      return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/music-producer/setup?jobId=${encodeURIComponent(job)}`);
        const value = await response.json();
        if (cancelled)
          return;
        if (!response.ok)
          throw new Error(value.error ?? "Setup status unavailable.");
        setMessage(`Setup: ${value.stage ?? value.state}`);
        if (["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"].includes(value.state)) {
          setJob(null);
          setBusy(false);
          if (value.state === "succeeded")
            void check();
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      }
      catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Setup status unavailable.");
          setBusy(false);
        }
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [check, job]);
  return <section className="space-y-3">
    <p>One musical draft per request, initially 60 seconds. The run defaults below set your preferred duration. WAV masters and their prior versions stay with the conversation.</p>
    <label className="block">Provider mode <select value={mode} onChange={event => {
      setMode(event.target.value);
      if (event.target.value === "managed")
        setModel("acestep-v15-turbo");
    }}><option value="managed">Managed local ACE-Step</option><option value="external">External ACE-Step endpoint</option></select></label>
    {mode === "external" ? <>
      <p>Audio references, lyrics and prompts will be transferred to this endpoint. Breadboard does not own its computation.</p>
      <label className="block">HTTP(S) origin <input value={url} onChange={event => setUrl(event.target.value)} placeholder="http://127.0.0.1:8001" /></label>
      <label className="block">API key <input type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder="Leave empty to keep the stored key" /></label>
    </> : null}
    <label className="block">Audio model <select value={model} onChange={event => setModel(event.target.value)}><option value="acestep-v15-turbo">ACE-Step 1.5 turbo</option>{mode === "external" ? <><option value="acestep-v15-sft">ACE-Step 1.5 sft</option><option value="acestep-v15-base">ACE-Step 1.5 base</option></> : null}</select></label>
    <div className="flex gap-2"><button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/music-producer/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, externalUrl: url, model, resonantSlug, ...(key ? { apiKey: key } : {}) }) });
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error);
        setKey("");
        await check();
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
      }
      finally {
        setBusy(false);
      }
    }}>Save and test connection</button><button type="button" disabled={busy} onClick={() => void check()}>Check readiness</button></div>
    {mode === "managed" ? <>
      <p>Explicit setup downloads the pinned MIT ACE-Step source, isolated Python dependencies, and turbo/VAE/text-encoder weights (up to 16 GiB, plus dependency/cache space). Model licenses and notices remain with the downloads. Hardware is detected during setup; readiness does not guarantee GPU capacity.</p>
      <p><a href="https://github.com/ace-step/ACE-Step-1.5/blob/ca1e85fe9430179831e6bc6be790c332190a3866/LICENSE" target="_blank" rel="noreferrer">Source license</a> · <a href="https://huggingface.co/ACE-Step/Ace-Step1.5/tree/19671f406d603126926c1b7e2adc169acbcade22" target="_blank" rel="noreferrer">Model files and license</a></p>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch("/api/music-producer/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmDownloads: true }) });
          const value = await response.json();
          if (!response.ok)
            throw new Error(value.error);
          setJob(value.jobId);
        }
        catch (error) {
          setMessage(error instanceof Error ? error.message : "Setup failed.");
          setBusy(false);
        }
      }}>Download and prepare ACE-Step</button>
    </> : null}
    <p role="status">{message}</p>
    {mode === "managed" && stoppedGate ? <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/music-producer/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearStoppedGate" }) });
        const value = await response.json();
        if (!response.ok)
          throw Error(value.error);
        await check();
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not reset the generation lock.");
      }
      finally {
        setBusy(false);
      }
    }}>Reset stopped provider’s generation lock</button> : null}
    {job ? <button type="button" onClick={async () => { const response = await fetch("/api/music-producer/setup", { method: "DELETE" }); setMessage(response.ok ? "Stopping setup through Runtime…" : "Could not stop setup."); }}>Stop setup</button> : null}
    <label className="block">Optional Resonant connection name <input value={resonantSlug} onChange={event => setResonantSlug(event.target.value)} placeholder="resonant" /></label>
    <p>Resonant: {resonantStatus}</p>
    <p>Approve Resonant in Connected Apps with an explicit workspace (<code>--root</code>), then save its connection name here. Use <code>--arrange</code> in a request for bounded composition and mixing. Projects and assets remain in that workspace; only the final WAV is imported. Resonant is separately installed AGPL software. Its provider, voice, installation and generation tools are disabled in this adapter.</p>
  </section>;
}
