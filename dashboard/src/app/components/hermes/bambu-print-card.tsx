"use client";
/* eslint-disable @next/next/no-img-element -- These bounded local PNG endpoints require the user's session; do not proxy them through the image optimizer. */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Box, Check, Pause, Play, Printer, X } from "lucide-react";
import type { PrinterJobResource } from "@/lib/generative-ui/contracts.ts";
import { isActive, TERMINAL_STATES, type PrintReview, type PrinterConfig, type JobState } from "@/lib/bambu/types.ts";
import { jobUrl, printerRequest, usePrinterJob } from "@/lib/bambu/client.ts";
import { printerPhoto } from "@/lib/bambu/photos.ts";
import { BambuConnections } from "../settings-bambu";
import { ConfirmDialog } from "../confirm-dialog";
import styles from "./bambu-print-card.module.css";

const labels: Record<JobState,string> = { needs_file:"Choose sliced file", validating:"Validating file", review_required:"Review required", blocked:"Review blocked", awaiting_approval:"Waiting for approval", approved:"Approved · checking printer", uploading:"Uploading", start_requested:"Start requested", start_unconfirmed:"Start unconfirmed", preparing:"Preparing", printing:"Printing", paused:"Paused", cancel_requested:"Cancel requested", cancelled:"Cancelled", failed:"Print failed", completed:"Completed" };
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes/60)}h ${Math.round(minutes%60)}m` : `${Math.round(minutes)} min`;
function Photo({ printer, onAdd }: { printer: PrinterConfig | null; onAdd: () => void }) {
  const src = printerPhoto(printer), [broken, setBroken] = useState(false);
  return <div className={styles.photo}>{src && !broken ? <img src={src} alt={`${printer?.name} — ${printer?.model}`} onError={() => setBroken(true)}/> : <><Printer aria-label="Printer photo unavailable" strokeWidth={1}/>{printer && <button type="button" onClick={onAdd}>Add printer photo</button>}</>}</div>;
}
export default function BambuPrintCard({ resource, legacyChatSessionId }: { resource: PrinterJobResource; legacyChatSessionId?: number | null }) {
  const { view, error: pollError, refresh, update } = usePrinterJob(resource.data.jobId, resource.data.conversationPublicId, legacyChatSessionId);
  const [open, setOpen] = useState(false), [setup, setSetup] = useState(false), [review, setReview] = useState<PrintReview | null>(null);
  const [plateClear, setPlateClear] = useState(false), [physicalSetup, setPhysicalSetup] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [cancel, setCancel] = useState(false);
  const article = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), photoInput = useRef<HTMLInputElement>(null), busyRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const [inspected, setInspected] = useState(false), [photoVersion, setPhotoVersion] = useState(0);
  const job = view?.job, terminal = Boolean(job && TERMINAL_STATES.includes(job.state)), active = Boolean(job && isActive(job.state)), canEdit = Boolean(job && !active && !terminal && job.state !== "validating");
  const stale = Boolean(pollError || (job && ["preparing","printing","paused","cancel_requested"].includes(job.state) && view?.stale));
  const currentPrinter = view?.printers.find(p => p.id === review?.printerId) ?? view?.printer ?? null;
  const plate = job?.file?.plates.find(p => p.id === review?.plateId);
  useEffect(() => {
    if (!job) return;
    setReview(job.review ?? (job.file && view?.printers.length ? { printerId: view.printers[0].id, plateId: job.file.plates[0].id, mapping: [], options: { bedLeveling:true, flowCalibration:false, vibrationCalibration:true } } : null));
    setPlateClear(false); setPhysicalSetup(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only a new durable revision resets the local draft; telemetry polling must preserve in-progress edits.
  }, [job?.revision, job?.id, view?.printers.length]);
  const spokenStatus = job ? `${labels[job.state]}${stale ? ". Status is stale." : ""}` : "Preparing printer card";
  useEffect(() => { const timer = setTimeout(() => setAnnouncement(spokenStatus), 1500); return () => clearTimeout(timer); }, [spokenStatus]);
  const scopeQuery = legacyChatSessionId ? `&chatSessionId=${legacyChatSessionId}` : "";
  const url = jobUrl(resource.data.jobId, resource.data.conversationPublicId) + scopeQuery;
  async function perform(body: Record<string, unknown>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { const result = await printerRequest(url, body); if (body.action === "again") await refresh(); else update(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Printer action failed."); await refresh(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function upload(file: File, photo = false) {
    if (!job || busyRef.current) return;
    const limit = photo ? 5 * 1024 * 1024 : 128 * 1024 * 1024;
    if (file.size > limit) { setError(`Choose a file smaller than ${photo ? 5 : 128} MiB.`); return; }
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await printerRequest(photo ? `/api/hermes/connections/bambu/${currentPrinter!.id}/photo` : jobUrl(job.id, resource.data.conversationPublicId,"/file") + scopeQuery, undefined, { method:"POST", headers: { "content-type":file.type || "application/octet-stream", "x-bambu-filename":encodeURIComponent(file.name), "x-bambu-revision":String(job.revision) }, body:file });
      if (photo) { setPhotoVersion(v => v + 1); await refresh(); } else { update(result); setOpen(true); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "File upload failed."); await refresh(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function edit(next: PrintReview) { setReview(next); setPlateClear(false); setPhysicalSetup(false); }
  const reviewed = job?.state === "awaiting_approval" && JSON.stringify(review) === JSON.stringify(job.review);
  const telemetry = job?.telemetry;
  const progress = job?.state === "uploading" ? job.uploadBytes !== null && job.file?.size ? Math.min(100,100 * job.uploadBytes/job.file.size) : null : active || terminal ? telemetry?.progress ?? null : null;
  const photoAdd = () => { if (currentPrinter) photoInput.current?.click(); else { setSetup(true); setOpen(true); } };
  const showReview = () => { setSetup(!view?.printers.some(p => p.configured)); setOpen(true); };
  if (job && (job.resourceId !== resource.id || job.scope.runId !== resource.data.runId || job.scope.originatingTurnId !== resource.data.originatingTurnId)) return <p role="alert">This print reference does not belong to this task output.</p>;
  return <>
    <article ref={article} className={styles.card} data-printer-job={resource.data.jobId} aria-label="Bambu Lab print job">
      <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
      <header className={styles.header}><div className={styles.identity}><h3 className={styles.name}>{currentPrinter?.name ?? "Bambu Lab"}</h3><p className={styles.muted}>{currentPrinter?.model ?? "Your prepared print"}</p></div><span className={styles.pill}><span className={styles.dot}/>{stale ? "Status stale" : job ? labels[job.state] : "Print job"}</span></header>
      <div className={styles.main}><Photo key={`${currentPrinter?.id}:${photoVersion}`} printer={currentPrinter} onAdd={photoAdd}/><div><p className={styles.file}>{job?.file?.name ?? "Make room for your next idea."}</p>
        {progress !== null ? <div className={styles.progressNumber}>{Math.floor(progress)}<span>%</span></div> : <div className={styles.stateText}>{!job ? "Choose & review" : !view?.printers.some(p => p.configured) ? "Connect a printer" : labels[job.state]}</div>}
        <p className={styles.muted}>{job?.state === "preparing" ? telemetry?.stage ?? "Printer preparation" : job?.state === "uploading" ? job.uploadBytes === null ? "Transferring approved file" : `${(job.uploadBytes/1048576).toFixed(1)} / ${((job.file?.size ?? 0)/1048576).toFixed(1)} MiB` : telemetry?.remainingMinutes != null && active ? `About ${duration(telemetry.remainingMinutes)} remaining` : terminal && job?.finishedAt ? new Date(job.finishedAt).toLocaleString(undefined,{ month:"short",day:"numeric",hour:"2-digit",minute:"2-digit" }) : plate?.durationSeconds ? `Estimated print: ${duration(plate.durationSeconds/60)}` : "Already sliced. Always reviewed."}</p>
        {(progress !== null || job?.state === "uploading" || job?.state === "validating") && <div className={styles.track} role="progressbar" aria-label={job?.state === "uploading" ? "File transfer" : "Print progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}><div className={progress === null ? styles.indeterminate : styles.fill} style={progress !== null ? { width:`${progress}%` } : undefined}/></div>}
      </div></div>
      {telemetry && (active || terminal) && <div className={styles.stats}>{telemetry.layer != null && <span>Layer {telemetry.layer}{telemetry.totalLayers != null ? ` / ${telemetry.totalLayers}` : ""}</span>}{telemetry.nozzleTemperature != null && <span>Nozzle {Math.round(telemetry.nozzleTemperature)}°C</span>}{telemetry.bedTemperature != null && <span>Bed {Math.round(telemetry.bedTemperature)}°C</span>}</div>}
      {currentPrinter && job?.review && <div className={styles.filaments}>{job.review.mapping.map(mapping => { const source = currentPrinter.sources.find(s => s.id === mapping.sourceId); return source ? <span className={styles.swatchLabel} key={mapping.filamentIndex}><span className={styles.swatch} style={{ background:source.color ?? "transparent" }}/>{source.material} · {source.label}</span> : null; })}</div>}
      {(job?.message || error || pollError) && <p role={error ? "alert" : undefined} className={`${styles.notice} ${error ? styles.error : ""}`}>{error ?? pollError ?? job?.message}</p>}
      {stale && <p className={styles.notice}>Last known values. The printer may still be running.</p>}
      <footer className={styles.footer}>
        {(!job || canEdit) && <button className={styles.primary} disabled={busy || !job} onClick={() => job?.file || !view?.printers.some(p => p.configured) ? showReview() : fileInput.current?.click()}>{!view?.printers.some(p => p.configured) ? "Connect a printer" : job?.file ? "Review print" : "Choose sliced file"}</button>}
        {job?.state === "paused" && <button className={styles.primary} disabled={busy || stale || Boolean(job.pendingControl)} onClick={() => void perform({ action:"resume" })}><Play size={13}/>Resume</button>}
        {job && ["printing","preparing"].includes(job.state) && <button className={styles.primary} disabled={busy || stale || Boolean(job.pendingControl)} onClick={() => void perform({ action:"pause" })}><Pause size={13}/>Pause</button>}
        {job && (active || terminal) && <button className={styles.button} onClick={() => { setSetup(false); setOpen(true); }}>Print details</button>}
        {terminal && !job?.nextJobId && <button className={styles.primary} disabled={busy} onClick={() => void perform({ action:"again" })}>Print again</button>}
        {busy && <span className={styles.muted}>Saving…</span>}{job?.pendingControl && <span className={styles.muted}>{job.pendingControl === "cancel" ? "Cancel" : job.pendingControl === "pause" ? "Pause" : "Resume"} pending printer confirmation</span>}
      </footer>
      {telemetry && <p className={styles.muted}>Updated {new Date(telemetry.observedAt).toLocaleTimeString(undefined,{ hour:"2-digit",minute:"2-digit" })}{stale ? " · stale" : " · printer telemetry"}</p>}
      <input ref={fileInput} type="file" className={styles.srOnly} tabIndex={-1} aria-label="Choose sliced print file" accept=".gcode.3mf,.3mf" onChange={event => { const file = event.target.files?.[0]; event.target.value=""; if (file) void upload(file); }}/>
      <input ref={photoInput} type="file" className={styles.srOnly} tabIndex={-1} aria-label="Add printer photo" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value=""; if (file) void upload(file,true); }}/>
    </article>
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.sheet} onCloseAutoFocus={event => {event.preventDefault();article.current?.querySelector<HTMLButtonElement>("footer button")?.focus({preventScroll:true});}}>
      <div className={styles.sheetHeader}><div><Dialog.Title>{setup ? "Connect Bambu Lab" : canEdit ? "Review your print" : "Print details"}</Dialog.Title><Dialog.Description className={styles.muted}>{setup ? "Private printer setup" : "One printer. One plate. Your approval."}</Dialog.Description></div><Dialog.Close className={styles.button} aria-label="Close print details"><X size={16}/></Dialog.Close></div>
      {setup ? <BambuConnections onSaved={() => void refresh()}/> : <>
        {canEdit && <><button className={styles.button} disabled={busy} onClick={() => fileInput.current?.click()}><Box size={14}/>{job?.file ? "Change sliced file" : "Choose sliced file"}</button>{view?.attachments?.length ? <label>Or choose an attached sliced file<select defaultValue="" disabled={busy} onChange={event => { if (event.target.value) void perform({ action:"attach", revision:job?.revision, uploadId:event.target.value }); }}><option value="">Select attachment</option>{view.attachments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : null}</>}
        <p className={styles.file} style={{marginTop:18}}>{job?.file?.name ?? "Choose an already-sliced .gcode.3mf file to begin."}</p>
        {review && <><label>Target printer<select disabled={!canEdit || busy} value={review.printerId} onChange={event => edit({ ...review, printerId:event.target.value, mapping:[] })}>{view?.printers.filter(p => p.configured).map(printer => <option key={printer.id} value={printer.id}>{printer.name} · {printer.model}</option>)}</select></label>
          <label>Printable plate<select disabled={!canEdit || busy} value={review.plateId} onChange={event => edit({ ...review, plateId:Number(event.target.value), mapping:[] })}>{job?.file?.plates.map(p => <option key={p.id} value={p.id}>Plate {p.id}{p.blockers.length ? " · needs attention" : ""}</option>)}</select></label>
          <dl className={styles.reviewMeta}><div><dt>Slice requires</dt><dd>{plate?.model ?? "Unknown printer"} · {plate?.nozzle ?? "Unknown"} mm</dd></div><div><dt>Configured nozzle</dt><dd>{currentPrinter?.nozzle} mm</dd></div><div><dt>Sliced build plate</dt><dd>{plate?.buildPlate?.replaceAll("_"," ") ?? "Unknown"}</dd></div><div><dt>Configured build plate</dt><dd>{currentPrinter?.buildPlate.replaceAll("_"," ")}</dd></div><div><dt>Estimated duration</dt><dd>{plate?.durationSeconds ? duration(plate.durationSeconds/60) : "Unavailable"}</dd></div><div><dt>Estimated material</dt><dd>{plate?.grams != null ? `${plate.grams} g` : "Unavailable"}</dd></div></dl>
          {plate?.thumbnail && <img alt={`Plate ${plate.id} slicer preview`} src={`${jobUrl(job!.id, resource.data.conversationPublicId,"/thumbnail")}&plate=${plate.id}`} style={{width:80,height:80,objectFit:"contain",borderRadius:12}}/>}
          <h3>Filament mapping</h3><p className={styles.muted}>Required by the sliced file → exact physical source. Source values below are configured; fresh printer inventory is checked again before dispatch.</p>
          {plate?.filaments.map(filament => { const mapping = review.mapping.find(m => m.filamentIndex === filament.index), source = currentPrinter?.sources.find(s => s.id === mapping?.sourceId); return <div className={styles.mapping} key={filament.index}><span className={styles.swatchLabel}><span className={styles.swatch} style={{background:filament.color ?? "transparent"}}/>Project filament {filament.index+1} · {filament.material} · {filament.color ?? "colour unknown"}</span><label>Physical source<select aria-label="Physical source" value={mapping?.sourceId ?? ""} disabled={!canEdit || busy} onChange={event => edit({ ...review, mapping:[...review.mapping.filter(m => m.filamentIndex !== filament.index),{ filamentIndex:filament.index, sourceId:event.target.value, acceptColorSubstitution:false }].sort((a,b) => a.filamentIndex-b.filamentIndex) })}><option value="" disabled>Select source</option>{currentPrinter?.sources.map(s => <option value={s.id} key={s.id} disabled={!s.available || s.material.toUpperCase() !== filament.material.toUpperCase() || (s.id === "external" && plate.filaments.length !== 1)}>{s.label} · {s.material} · {s.color ?? "colour unknown"}{!s.available ? " · unavailable" : ""}</option>)}</select></label>{source && (!source.color || !filament.color || source.color !== filament.color) && <label><input type="checkbox" disabled={!canEdit || busy} checked={mapping?.acceptColorSubstitution ?? false} onChange={event => edit({ ...review, mapping:review.mapping.map(m => m.filamentIndex === filament.index ? {...m,acceptColorSubstitution:event.target.checked} : m) })}/>I accept this colour substitution or unverified colour.</label>}</div>; })}
          <h3>Execution options</h3>{([["bedLeveling","Bed levelling"],["flowCalibration","Flow calibration"],["vibrationCalibration","Vibration calibration"]] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={review.options[key]} disabled={!canEdit || busy} onChange={event => edit({...review,options:{...review.options,[key]:event.target.checked}})}/>{label}</label>)}
        </>}
        {canEdit && <><p className={styles.notice}>Metadata compatibility cannot guarantee that arbitrary machine instructions are safe. Use a sliced file you trust.</p><button className={styles.primary} disabled={!review || busy} onClick={() => void perform({ action:"review", revision:job?.revision, review })}>Check this setup</button>
          {job?.blockers.length ? <ul className={`${styles.notice} ${styles.error}`}>{job.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
          {reviewed && <><h3>Before you start</h3><label><input type="checkbox" checked={plateClear} onChange={event => setPlateClear(event.target.checked)}/>I checked that the build plate is clear and correctly installed.</label><label><input type="checkbox" checked={physicalSetup} onChange={event => setPhysicalSetup(event.target.checked)}/>I checked that the physical nozzle, filament and setup match this review.</label><p className={styles.muted}>Breadboard has not visually verified these conditions. Approval expires after five minutes.</p><button className={styles.primary} disabled={busy || !plateClear || !physicalSetup} onClick={() => void perform({ action:"approve", revision:job?.revision, plateClear, physicalSetup })}><Check size={14}/>Approve &amp; print</button></>}
          <div className={styles.footer}><button className={styles.button} onClick={() => setSetup(true)}>Printer setup</button><button className={styles.danger} disabled={busy} onClick={() => void perform({ action:"cancel_draft" })}>Discard draft</button></div>
        </>}
        {active && <><p className={styles.notice}>{job?.message ?? "Progress and completion come from identified printer telemetry."}</p>{job && ["preparing","printing","paused"].includes(job.state) && <button className={styles.danger} disabled={busy || stale || Boolean(job.pendingControl)} onClick={() => setCancel(true)}>Cancel print</button>}{job && ["approved","uploading"].includes(job.state) && <button className={styles.danger} disabled={busy} onClick={() => void perform({ action:"cancel_draft" })}>Cancel before start</button>}</>}
        {active && job?.attempt?.startIntentAt && <details className={styles.history}><summary>Resolve an unconfirmed or interrupted job</summary><p className={styles.notice}>Inspect the printer in person. If it is still running, use its own display. Closing this record requires a fresh idle report and does not establish whether the earlier print succeeded.</p><label><input type="checkbox" checked={inspected} onChange={e => setInspected(e.target.checked)}/>I inspected the printer and confirmed no print is running.</label><button className={styles.button} disabled={busy || !inspected} onClick={() => void perform({action:"resolve_inspected", revision:job.revision, inspected})}>Verify idle and close record</button></details>}
        {job?.file && <details className={styles.history}><summary>File integrity and history</summary><p style={{overflowWrap:"anywhere"}}>SHA-256: {job.file.sha256}</p><p>{job.uploadVerified === "size" ? "FTPS transfer and remote file length verified. A remote checksum was not verified." : "The printer has not confirmed an upload."}</p>{job.audit.map((entry,i) => <p key={i}>{new Date(entry.at).toLocaleString()} · {entry.event.replaceAll("_"," ")}</p>)}</details>}
        <p className={styles.notice}>You can leave this task while Breadboard monitors the job. If the whole application closes, local monitoring stops and the printer may continue independently.</p>
      </>}
      {error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    {cancel && <ConfirmDialog title="Cancel this print?" subject={job?.file?.name ?? "Current print"} body="This stops the identified physical print. A cancellation is confirmed only when the printer reports it." confirmLabel="Cancel print" cancelLabel="Keep printing" onCancel={() => setCancel(false)} onConfirm={() => { setCancel(false); void perform({ action:"cancel", confirmed:true }); }}/>}
    {job?.nextJobId && <div className={styles.nested}><BambuPrintCard legacyChatSessionId={legacyChatSessionId} resource={{ ...resource, id:`printer:${job.nextJobId}`, data:{...resource.data,jobId:job.nextJobId} }}/></div>}
  </>;
}
