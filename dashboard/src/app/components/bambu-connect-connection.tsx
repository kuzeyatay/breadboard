"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { BambuConnectStatus } from "@/lib/bambu/connect.ts";
import { printerRequest } from "@/lib/bambu/client.ts";
import styles from "./hermes/bambu-print-card.module.css";
const url = "/api/hermes/connections/bambu/connect";

export function BambuConnectConnection() {
  const [status, setStatus] = useState<BambuConnectStatus | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), sending = useRef(false);
  async function refresh() {
    setError(null);
    try { setStatus(await printerRequest(url, undefined, { signal: AbortSignal.timeout(15000) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check Bambu Connect."); }
  }
  useEffect(() => { void refresh(); }, []);
  async function handoff(file: File) {
    if (sending.current) return;
    if (!/\.gcode\.3mf$/i.test(file.name) || file.size > 128 * 1024 * 1024) { setError("Choose one sliced .gcode.3mf plate smaller than 128 MiB."); return; }
    sending.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const result = await printerRequest(url, undefined, { method: "POST", headers: { "content-type": "application/octet-stream", "x-bambu-filename": encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(60000) });
      setMessage(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not hand off the sliced plate."); }
    finally { sending.current = false; setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <section aria-label="Bambu Connect printing">
    <h3>Print a sliced plate with Bambu Connect</h3>
    <p className={styles.notice}>Keep your cloud connection and choose any compatible Bambu printer in Bambu Connect. Confirm the printer, build plate and AMS trays there before pressing Print.</p>
    <p className={styles.muted}>Breadboard can hand off the file. Bambu Connect handles printer selection and printing; Breadboard cannot automatically select an AMS tray or confirm that printing started.</p>
    {status && <p className={styles.notice}>{status.message}</p>}
    <div className={styles.footer}>
      <button type="button" className={styles.primary} disabled={busy || !status?.available} onClick={() => input.current?.click()}><ExternalLink size={14}/>Send sliced plate to Bambu Connect</button>
      {status && !status.available && status.platformSupported && <a className={styles.button} href={status.setupUrl} target="_blank" rel="noopener noreferrer">Get Bambu Connect</a>}
      <button type="button" className={styles.button} disabled={busy} onClick={() => void refresh()} aria-label="Refresh Bambu Connect detection"><RefreshCw size={14}/></button>
    </div>
    <input ref={input} type="file" accept=".gcode.3mf" hidden aria-label="Sliced plate for Bambu Connect" onChange={event => { const file = event.target.files?.[0]; if (file) void handoff(file); }}/>
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p>}
  </section>;
}
