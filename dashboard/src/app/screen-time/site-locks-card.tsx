"use client";

import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound, Lock, Plus, Trash2, X } from "lucide-react";
import type { SiteLockMode, SiteLocksView, SiteLockView } from "@/lib/screen-time/site-locks";
import styles from "./screen-time.module.css";

type Mode = { kind: "add" } | { kind: "remove"; site: SiteLockView } | { kind: "password" };
const PRESETS = [15, 30, 60, 120];
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function call(body?: Record<string, unknown>): Promise<SiteLocksView> {
  const response = await fetch("/api/screen-time/locks", body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Website locks are unavailable. Try again.");
  return payload;
}

function status(site: SiteLockView) {
  if (site.unlockedUntil) return `Unlocked until ${clock(site.unlockedUntil)}`;
  if (site.mode === "always") return "Always locked";
  const used = Math.min(site.minutes, Math.floor(site.usedMs / 60000));
  return used >= site.minutes ? `Limit reached, ${site.minutes} min a day` : `${used} of ${site.minutes} min used today`;
}

export default function SiteLocksCard() {
  const [view, setView] = useState<SiteLocksView | null>(null), [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => { if (document.visibilityState !== "hidden") call().then(next => { if (live) { setView(next); setLoadError(""); } }, error => { if (live) setLoadError(error.message); }); };
    load();
    const timer = setInterval(load, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  return <section className={styles.locksCard} aria-label="Website locks">
    <div className={styles.locksHeading}><Lock size={16} /><h2>Website locks</h2>
      {view && view.sites.length > 0 && <button className={styles.iconButton} onClick={() => setMode({ kind: "add" })} aria-label="Lock another website" title="Lock another website"><Plus size={17} /></button>}
    </div>
    {loadError && <p className={styles.lockError} role="alert">{loadError}</p>}
    {view && !view.sites.length && <>
      <p>Block a website completely, or allow a set number of minutes each day. A parent password protects every change.</p>
      <button className={styles.secondaryButton} onClick={() => setMode({ kind: "add" })}><Lock size={13} /> Lock a website</button>
    </>}
    {view && view.sites.length > 0 && <ul className={styles.lockList}>
      {view.sites.map(site => {
        const share = site.mode === "daily" ? Math.min(1, site.usedMs / (site.minutes * 60000)) : 1;
        const state = site.unlockedUntil ? "open" : site.mode === "always" || share >= 1 ? "locked" : "counting";
        return <li key={site.domain} data-state={state}>
          <div><strong>{site.domain}</strong><span>{status(site)}</span>
            {site.mode === "daily" && !site.unlockedUntil && <span className={styles.lockMeter}><i style={{ width: `${share * 100}%` }} /></span>}
          </div>
          <button className={styles.iconButton} onClick={() => setMode({ kind: "remove", site })} aria-label={`Remove lock for ${site.domain}`} title="Remove lock"><Trash2 size={15} /></button>
        </li>;
      })}
    </ul>}
    {view?.hasPassword && <button className={styles.textButton} onClick={() => setMode({ kind: "password" })}><KeyRound size={13} /> Change parent password</button>}
    <LockDialog mode={mode} hasPassword={Boolean(view?.hasPassword)} close={() => setMode(null)} update={setView} done={next => { setView(next); setMode(null); }} />
  </section>;
}

function LockDialog({ mode, hasPassword, close, update, done }: { mode: Mode | null; hasPassword: boolean; close: () => void; update: (view: SiteLocksView) => void; done: (view: SiteLocksView) => void }) {
  const [domain, setDomain] = useState(""), [lockMode, setLockMode] = useState<SiteLockMode>("daily"), [minutes, setMinutes] = useState(30);
  const [password, setPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const creating = mode?.kind === "password" || (mode?.kind === "add" && !hasPassword);

  useEffect(() => { if (mode) { setDomain(""); setLockMode("daily"); setMinutes(30); setPassword(""); setNewPassword(""); setConfirm(""); setError(""); } }, [mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || busy) return;
    if (creating && newPassword !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      if (mode.kind === "remove") done(await call({ action: "remove", password, domain: mode.site.domain }));
      else if (mode.kind === "password") done(await call({ action: "set-password", password, newPassword }));
      else {
        if (!hasPassword) update(await call({ action: "set-password", newPassword }));
        done(await call({ action: "add", password: hasPassword ? password : newPassword, domain, mode: lockMode, minutes }));
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }

  const title = mode?.kind === "remove" ? `Remove the lock on ${mode.site.domain}?` : mode?.kind === "password" ? "Change parent password" : "Lock a website";
  const description = mode?.kind === "remove" ? "The website opens normally again in Breadboard's browser."
    : mode?.kind === "password" ? "The parent password is needed to add, remove or unlock websites."
    : "Locked websites show a lock screen in Breadboard's browser. Only someone with the parent password can open them.";

  return <Dialog.Root open={Boolean(mode)} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className={styles.scrim} /><Dialog.Content className={styles.settingsDialog}>
    <Dialog.Close className={styles.close} aria-label="Close"><X size={18} /></Dialog.Close>
    <span className={styles.pageIcon}>{mode?.kind === "password" ? <KeyRound size={22} /> : <Lock size={22} />}</span>
    <Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>
    <form className={styles.lockForm} onSubmit={event => void submit(event)}>
      {mode?.kind === "add" && <>
        <label className={styles.field}>Website<input value={domain} onChange={event => setDomain(event.target.value)} placeholder="youtube.com" required autoFocus inputMode="url" autoComplete="off" /></label>
        <fieldset className={styles.field}><legend>How it's locked</legend>
          <div className={styles.lockModes}>
            <button type="button" aria-pressed={lockMode === "daily"} onClick={() => setLockMode("daily")}><strong>Daily time limit</strong><span>Allowed for a few minutes each day</span></button>
            <button type="button" aria-pressed={lockMode === "always"} onClick={() => setLockMode("always")}><strong>Always locked</strong><span>Never opens without the password</span></button>
          </div>
        </fieldset>
        {lockMode === "daily" && <fieldset className={styles.field}><legend>Minutes per day</legend>
          <div className={styles.minuteRow}>
            {PRESETS.map(value => <button type="button" key={value} aria-pressed={minutes === value} onClick={() => setMinutes(value)}>{value < 60 ? `${value} min` : `${value / 60} h`}</button>)}
            <input type="number" min={1} max={1440} value={minutes} onChange={event => setMinutes(Math.round(Number(event.target.value)))} aria-label="Custom minutes per day" />
          </div>
          <small>Time counts only while the website is on screen. It resets at midnight.</small>
        </fieldset>}
      </>}
      {mode && (mode.kind === "remove" || hasPassword) &&<label className={styles.field}>{mode?.kind === "password" ? "Current password" : "Parent password"}
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="off" autoFocus={mode?.kind !== "add"} /></label>}
      {creating && <>
        {mode?.kind === "add" && <p className={styles.settingsNote}>First, create a parent password. You'll need it to change locks or open a locked website.</p>}
        <label className={styles.field}>{mode?.kind === "password" ? "New password" : "Create parent password"}<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={4} required autoComplete="new-password" /></label>
        <label className={styles.field}>Confirm password<input type="password" value={confirm} onChange={event => setConfirm(event.target.value)} minLength={4} required autoComplete="new-password" /></label>
      </>}
      {error && <p className={styles.lockError} role="alert">{error}</p>}
      <button className={styles.primaryButton} data-tone={mode?.kind === "remove" ? "danger" : undefined} disabled={busy}>
        {busy ? "Saving…" : mode?.kind === "remove" ? "Remove lock" : mode?.kind === "password" ? "Change password" : "Lock website"}</button>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
