"use client";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Printer, Plus, X } from "lucide-react";
import { BAMBU_MODELS, BUILD_PLATES, type PrinterConfig, type FilamentSource } from "@/lib/bambu/types.ts";
import { printerRequest } from "@/lib/bambu/client.ts";
import styles from "./hermes/bambu-print-card.module.css";
const url = "/api/hermes/connections/bambu";
export function BambuConnections({ onSaved }: { onSaved?: () => void }) {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]), [selected, setSelected] = useState<PrinterConfig | null>(null);
  const [activeJobs, setActiveJobs] = useState<{id:string;revision:number;printerId:string;name:string;state:string;mayHaveStarted:boolean}[]>([]), [inspected, setInspected] = useState(false);
  const [sources, setSources] = useState<FilamentSource[]>([]), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null), secret = useRef<HTMLInputElement>(null);
  const load = async () => { const result = await printerRequest(url); setPrinters(result.printers); setActiveJobs(result.activeJobs ?? []); };
  useEffect(() => { void load().catch(error => setMessage(error.message)); }, []);
  const select = (printer: PrinterConfig | null) => { setSelected(printer); setSources(printer?.sources ?? []); setInspected(false); setMessage(null); if (secret.current) secret.current.value = ""; };
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setMessage(null);
    try {
      const result = await printerRequest(url, { action: "save", ...(selected ? { id: selected.id } : {}), name: data.get("name"), model: data.get("model"), host: data.get("host"), serial: data.get("serial"), accessCode: data.get("accessCode"), nozzle: Number(data.get("nozzle")), buildPlate: data.get("buildPlate"), developerModeConfirmed: data.get("developerModeConfirmed") === "on", sources });
      select(result.printer); await load(); setMessage("Saved securely. Test the connection before reviewing a print."); onSaved?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the printer."); }
    finally { if (secret.current) secret.current.value = ""; data.delete("accessCode"); setBusy(false); }
  }
  async function action(action: "test" | "disconnect") {
    if (!selected) return; setBusy(true); setMessage(null);
    try { const result = await printerRequest(url, { action, printerId: selected.id }); if (result.printer) { setSelected(result.printer); setMessage(result.printer.message); } else { setMessage("Disconnected. Print history is retained."); select(null); } await load(); onSaved?.(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Connection request failed."); }
    finally { setBusy(false); }
  }
  return <div>
    <p className={styles.notice}>Use the printer’s LAN address, serial number and LAN access code. On firmware that requires it, enable LAN Only and Developer Mode on the printer. Breadboard cannot switch these modes for you.</p>
    <p className={styles.notice}>LAN Only disconnects Bambu cloud features, including Handy cloud access. Availability and wording vary by model and firmware. No camera, slicer installation or extracted certificates are needed here.</p>
    <div className={styles.footer}>{printers.map(printer => <button className={styles.button} key={printer.id} onClick={() => select(printer)}>{printer.name}</button>)}<button className={styles.button} onClick={() => select(null)}><Plus size={13}/> Add printer</button></div>
    <form ref={form} key={selected?.id ?? "new"} onSubmit={save}>
      <label>Friendly name<input name="name" autoComplete="off" required maxLength={80} defaultValue={selected?.name ?? ""} placeholder="Workshop printer" /></label>
      <div className={styles.row}><label>Printer model<select name="model" required defaultValue={selected?.model ?? ""}><option value="" disabled>Select model</option>{BAMBU_MODELS.map(model => <option key={model}>{model}</option>)}</select></label>
      <label>Nozzle diameter<select name="nozzle" required defaultValue={selected?.nozzle ?? ""}><option value="" disabled>Select nozzle</option>{[0.2,0.4,0.6,0.8].map(n => <option value={n} key={n}>{n} mm</option>)}</select></label></div>
      <label>Installed build plate<select name="buildPlate" required defaultValue={selected?.buildPlate ?? ""}><option value="" disabled>Select build plate</option>{BUILD_PLATES.map(p => <option value={p} key={p}>{p.replaceAll("_", " ")}</option>)}</select></label>
      <label>LAN IPv4 address<input name="host" required={!selected} placeholder={selected ? "Leave blank to retain saved address" : "Address shown in printer network settings"} autoComplete="off" /></label>
      <label>Serial number<input name="serial" required={!selected} placeholder={selected ? "Leave blank to retain saved serial" : "From the printer’s display or label"} autoComplete="off" maxLength={32}/></label>
      <label>LAN access code<input ref={secret} name="accessCode" type="password" autoComplete="new-password" required={!selected?.configured} maxLength={8} placeholder={selected?.configured ? "Leave blank to keep saved code" : "8-character access code"}/></label>
      <p className={styles.muted}>The access code is cleared from this form after saving and never returned to chat.</p>
      <h3>Physical filament sources</h3>
      <p className={styles.muted}>Configure the sources you can physically confirm. Classic AMS units 1–4 and a single external spool are supported; A1 uses one AMS Lite. AMS HT and multiple-nozzle systems are unsupported.</p>
      {sources.map((source, index) => <div className={styles.mapping} key={index}><div className={styles.row}>
        <label>Physical source<select value={source.id} onChange={event => setSources(s => s.map((item,i) => i === index ? { ...item, id: event.target.value } : item))}><option value="external">External spool</option>{Array.from({ length:16 },(_,i) => <option key={i} value={`ams:${Math.floor(i/4)}:${i%4}`}>AMS {Math.floor(i/4)+1} · Tray {i%4+1}</option>)}</select></label>
        <label>Material<input required maxLength={32} value={source.material} placeholder="e.g. PETG" onChange={event => setSources(s => s.map((item,i) => i === index ? { ...item, material:event.target.value } : item))}/></label>
      </div><div className={styles.row}><label>Colour<input type="color" aria-label={`${source.id} colour`} value={source.color ?? "#808080"} onChange={event => setSources(s => s.map((item,i) => i === index ? { ...item, color:event.target.value.toUpperCase() } : item))}/></label><label><input type="checkbox" checked={source.available} onChange={event => setSources(s => s.map((item,i) => i === index ? { ...item, available:event.target.checked } : item))}/>Loaded and available</label></div><button type="button" className={styles.button} onClick={() => setSources(s => s.filter((_,i) => i !== index))}>Remove source</button></div>)}
      <button type="button" className={styles.button} disabled={sources.length >= 17} onClick={() => setSources(s => [...s, { id:"external", unit:null, tray:null, label:"External spool", material:"", color:null, available:false, provenance:"configured" }])}>Add filament source</button>
      <label><input name="developerModeConfirmed" type="checkbox" defaultChecked={selected?.developerModeConfirmed}/>I have checked that this printer’s firmware permits third-party LAN print commands, and enabled Developer Mode where required.</label>
      <div className={styles.footer}><button type="submit" className={styles.primary} disabled={busy}>Save printer</button>{selected && <><button type="button" className={styles.button} disabled={busy} onClick={() => void action("test")}>Test connection</button><button type="button" className={styles.danger} disabled={busy} onClick={() => void action("disconnect")}>Disconnect</button></>}</div>
    </form>
    {selected && <div className={styles.reviewMeta}><div><dt>Configured</dt><dd>{selected.configured ? "Yes" : "No"}</dd></div><div><dt>Reachable</dt><dd>{selected.lastTestAt ? selected.reachable ? "Yes" : "No" : "Not tested"}</dd></div><div><dt>Authenticated status</dt><dd>{selected.authenticated ? "Yes" : "Not confirmed"}</dd></div><div><dt>Print command support</dt><dd>{selected.startCapability.replaceAll("_", " ")}</dd></div></div>}
    {activeJobs.filter(j => j.printerId === selected?.id).map(job => <details className={styles.history} key={job.id}><summary>{job.name} · {job.state.replaceAll("_"," ")}</summary><p className={styles.notice}>This retained job may continue even if its task was deleted. Inspect the physical printer before resolving it. This does not resend or stop a print.</p>{job.mayHaveStarted && <><label><input type="checkbox" checked={inspected} onChange={e => setInspected(e.target.checked)}/>I inspected the printer and confirmed no print is running.</label><button type="button" className={styles.button} disabled={!inspected || busy} onClick={async () => {setBusy(true);try {await printerRequest(url,{action:"resolve_inspected",jobId:job.id,revision:job.revision,inspected});await load();setMessage("Record closed after inspection and a fresh idle report. The earlier print outcome remains unknown.");onSaved?.();}catch(error){setMessage(error instanceof Error ? error.message : "Could not resolve this job.");}finally{setBusy(false);}}}>Verify idle and close record</button></>}</details>)}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <p className={styles.notice}>Test connection only reads status. It cannot upload, heat, move or start the printer. The printer may continue independently when Breadboard is closed.</p>
  </div>;
}
export default function BambuConnectionEntry() {
  return (
    <Dialog.Root>
      <li className="neu-card flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
        <span
          aria-hidden
          className="neu-button-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--ink)]"
        >
          <Printer size={23} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
            Bambu Lab
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-[var(--ink-muted)]">
            Secure LAN connection
          </span>
        </span>
        <Dialog.Trigger
          className="neu-button shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-50"
          aria-label="Connect Bambu Lab"
        >
          Connect
        </Dialog.Trigger>
      </li>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          <div className={styles.sheetHeader}>
            <div>
              <Dialog.Title>Bambu Lab</Dialog.Title>
              <Dialog.Description className={styles.muted}>
                Private LAN printer connections
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.button} aria-label="Close printer setup">
              <X size={15} />
            </Dialog.Close>
          </div>
          <BambuConnections />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
