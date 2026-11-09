"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import type { BambuStudioStatus } from "@/lib/bambu/types.ts";
import { printerRequest } from "@/lib/bambu/client.ts";
import styles from "./hermes/bambu-print-card.module.css";
import { BambuConnectConnection } from "./bambu-connect-connection";
const url = "/api/hermes/connections/bambu/studio";

export function BambuStudioConnection({ onDetected }: { onDetected?: (status: BambuStudioStatus) => void }) {
  const [studio, setStudio] = useState<BambuStudioStatus | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), busyRef = useRef(false), detected = useRef(onDetected);
  detected.current = onDetected;
  async function refresh() {
    setError(null);
    try { const result = await printerRequest(url, undefined, { signal: AbortSignal.timeout(15000) }); setStudio(result); detected.current?.(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check Bambu Studio."); }
  }
  useEffect(() => { void refresh(); }, []);
  async function open(file?: File) {
    if (busyRef.current) return;
    if (file && file.size > 128 * 1024 * 1024) { setError("Choose a model smaller than 128 MiB."); return; }
    busyRef.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const result = file
        ? await printerRequest(url, undefined, { method: "POST", headers: { "content-type": "application/octet-stream", "x-bambu-filename": encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(60000) })
        : await printerRequest(url, { action: "open" }, { signal: AbortSignal.timeout(15000) });
      setMessage(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Bambu Studio."); }
    finally { busyRef.current = false; setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <section aria-label="Local Bambu Studio" className={styles.studio}>
    <h3>Bambu Studio on this computer</h3>
    <p className={styles.notice}>Use your installed app, its existing sign-in and printer connections. Open a model here, then slice and send it in Bambu Studio.</p>
    {studio?.installed && <>
      <p className={styles.muted}>Installed{studio.version ? ` · ${studio.version}` : ""}</p>
      {studio.selected.printer && <p className={styles.notice}>Selected profile: <strong>{studio.selected.printer}</strong></p>}
      <p className={styles.muted}>The selected profile is a slicing preset. The connected printer and loaded AMS trays are checked in Bambu Studio.</p>
      {studio.profiles.length > 0 && <details className={styles.history}><summary>Available printer profiles ({studio.profiles.length})</summary>{studio.profiles.map(profile => <p key={profile.name}>{profile.name} · {profile.nozzles.join(" / ")} mm</p>)}</details>}
    </>}
    {studio && !studio.installed && <p className={styles.notice}>{studio.message}</p>}
    <div className={styles.footer}>
      <button type="button" className={styles.primary} disabled={busy || !studio?.installed} onClick={() => void open()}><ExternalLink size={14}/>Open Bambu Studio</button>
      <button type="button" className={styles.button} disabled={busy || !studio?.installed} onClick={() => input.current?.click()}><FolderOpen size={14}/>Open model in Studio</button>
      <button type="button" className={styles.button} disabled={busy} onClick={() => void refresh()} aria-label="Refresh Bambu Studio detection"><RefreshCw size={14}/></button>
    </div>
    <input ref={input} type="file" accept=".3mf,.stl,.step,.stp" hidden aria-label="Model for Bambu Studio" onChange={event => { const file = event.target.files?.[0]; if (file) void open(file); }}/>
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p>}
    <BambuConnectConnection/>
  </section>;
}
