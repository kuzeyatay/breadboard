"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Activity, RefreshCw } from "lucide-react";
import { notchColor, notchHeadlineRow, notchRemaining, notchReserveCopy, notchResetCopy, notchUsageRows, type NotchProviderId } from "@/lib/usage-notch";
import { useProviderUsage } from "./use-provider-usage";
import glyphs from "./usage-notch-glyphs.json";
import styles from "./provider-usage-notch.module.css";

// Shape, palette, proportions and traced glyphs adapted from vinzdg/codenotch.
// Copyright (c) 2026 Vinz, MIT; see CODENOTCH-LICENSE.txt alongside this file.
const GLYPHS = { anthropic: glyphs.claude, chatgpt: glyphs.openai, google: glyphs.gemini };
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function ProviderGlyph({ provider }: { provider: NotchProviderId }) {
  return <svg viewBox="0 0 1 1" className={styles.glyph} aria-hidden="true"><path d={GLYPHS[provider]} fill="currentColor" fillRule="evenodd" /></svg>;
}

function UsageRing({ provider, used, loading, stale }: { provider: NotchProviderId; used: number | null; loading: boolean; stale: boolean }) {
  const remaining = notchRemaining(used);
  return (
    <span className={styles.ring} style={{ "--usage-color": notchColor(used) } as CSSProperties}>
      <svg viewBox="0 0 48 48" className={styles.ringTrack} aria-hidden="true">
        <circle cx="24" cy="24" r="20.8" fill="none" stroke="var(--notch-track)" strokeWidth="6.4" />
        <circle cx="24" cy="24" r="20.8" fill="none" className={styles.ringProgress} strokeWidth="3.3" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (remaining ?? 0)} transform="rotate(-90 24 24)" opacity={remaining === 0 || remaining === null ? 0 : 1} />
      </svg>
      <ProviderGlyph provider={provider} />
      {loading && <svg viewBox="0 0 48 48" className={styles.refreshArc} aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="20 80" /></svg>}
      {stale && !loading && <span className={styles.staleDot} aria-hidden="true" />}
    </span>
  );
}

function UsageNumber({ remaining }: { remaining: number | null }) {
  const reduced = useReducedMotion();
  const value = remaining === null ? "—" : `${Math.round(remaining)}%`;
  return (
    <span className={styles.percent} aria-hidden="true">
      <span className={styles.numberSizer}>{value}</span>
      <AnimatePresence initial={false}>
        <motion.span key={value} className={styles.number}
          initial={{ opacity: 0, transform: reduced ? "none" : "translateY(45%)" }}
          animate={{ opacity: 1, transform: reduced ? "none" : "translateY(0%)" }}
          exit={{ opacity: 0, transform: reduced ? "none" : "translateY(-45%)" }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
        >{value}</motion.span>
      </AnimatePresence>
    </span>
  );
}

export default function ProviderUsageNotch() {
  const usage = useProviderUsage();
  const [open, setOpen] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnFocus = useRef(false);
  const reduced = useReducedMotion();
  const clearClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  function hover(provider: string) {
    clearClose();
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !pinned) {
      returnFocus.current = false;
      setOpen(provider);
    }
  }
  function leave() {
    clearClose();
    if (!pinned) closeTimer.current = setTimeout(() => setOpen(null), 120);
  }
  function dismiss() { clearClose(); setOpen(null); setPinned(null); }

  return (
    <aside className={styles.dock} aria-label="Provider usage" data-provider-usage-notch="">
      <motion.div className={styles.body}
        initial={{ opacity: 0, transform: reduced ? "none" : "translateX(100%)" }}
        animate={{ opacity: 1, transform: "translateX(0%)" }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
      >
        {usage.providers.map((provider) => {
          const model = provider.models.includes(usage.selection[provider.id]) ? usage.selection[provider.id] : provider.models[0];
          const reading = usage.readings[model];
          const rows = notchUsageRows(provider.id, reading?.data);
          const headline = notchHeadlineRow(provider.id, rows, reading?.data);
          const used = headline?.used ?? null;
          const remaining = notchRemaining(used);
          const reserveCopy = provider.id === "chatgpt" ? notchReserveCopy(reading?.data) : null;
          const weekly = provider.id === "chatgpt" && !reserveCopy && headline?.limit.window_minutes === 10080;
          const stale = Boolean(reading?.data?.stale || (reading?.error && rows.length));
          const retryAt = Date.parse(reading?.data?.retry_at ?? "");
          const coolingDown = Number.isFinite(retryAt) && retryAt > usage.now;
          const expanded = open === provider.id;
          return (
            <Popover.Root key={provider.id} open={expanded} onOpenChange={(next) => {
              if (!next) dismiss(); else { returnFocus.current = true; setOpen(provider.id); setPinned(provider.id); }
            }}>
              <Popover.Trigger asChild>
                <button type="button" className={styles.provider} onPointerEnter={() => hover(provider.id)} onPointerLeave={leave}
                  onClick={(event) => {
                    // Clicking a hover-open ring pins its card; a second click closes it.
                    event.preventDefault();
                    clearClose();
                    returnFocus.current = true;
                    if (pinned === provider.id) dismiss(); else { setOpen(provider.id); setPinned(provider.id); }
                  }}
                  aria-label={`${provider.label} usage: ${remaining === null ? "not reported" : `${Math.round(remaining)}% remaining`}${weekly ? ", weekly limit" : ""}${reserveCopy ? ", reserve pool" : ""}${stale ? ", last known reading" : ""}`}
                  data-provider={provider.id} data-open={expanded}>
                  <Popover.Anchor asChild><span className={styles.anchor}><UsageRing provider={provider.id} used={used} loading={reading?.loading ?? true} stale={stale} /></span></Popover.Anchor>
                  <UsageNumber remaining={remaining} />
                </button>
              </Popover.Trigger>
              <Popover.Portal forceMount>
                <AnimatePresence>
                {expanded && <Popover.Content forceMount asChild side="left" align="start" sideOffset={20} alignOffset={-52} collisionPadding={12}
                  className={styles.card} aria-label={`${provider.label} usage details`}
                  onPointerEnter={clearClose} onPointerLeave={leave}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => { if (!returnFocus.current) event.preventDefault(); }}
                  onEscapeKeyDown={dismiss}>
                  <motion.div
                    initial={{ opacity: 0, transform: reduced ? "none" : "translateX(8px) scale(0.97)" }}
                    animate={{ opacity: 1, transform: reduced ? "none" : "translateX(0px) scale(1)" }}
                    exit={{ opacity: 0, transform: reduced ? "none" : "translateX(8px) scale(0.97)" }}
                    transition={{ duration: 0.18, ease: EASE_OUT }}>
                  <header className={styles.cardHeader}>
                    <ProviderGlyph provider={provider.id} />
                    <h2>{provider.label} Usage</h2>
                    <button type="button" className={styles.refresh} disabled={reading?.loading || coolingDown} aria-label={`Refresh ${provider.label} usage`} title={coolingDown ? "Waiting for the provider’s retry window" : "Refresh usage"} onClick={() => void usage.refresh(provider, model, true)}>
                      <RefreshCw size={12} aria-hidden="true" className={reading?.loading ? styles.spinning : undefined} />
                    </button>
                  </header>
                  <div className={styles.windows}>
                    {rows.map((row) => {
                      const remaining = notchRemaining(row.used);
                      return <div key={row.key} className={styles.window}>
                      <div className={styles.windowHeading}><span>{row.label}</span><span>{notchResetCopy(reading?.data?.captured_at, row.limit, usage.now)}</span></div>
                      <div className={styles.bar} role="meter" aria-label={`${provider.label} ${row.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining ?? undefined} aria-valuetext={remaining === null ? "Not reported" : `${Math.round(remaining)}% remaining`}>
                        <span style={{ backgroundColor: notchColor(row.used), transform: `scaleX(${(remaining ?? 0) / 100})` }} />
                      </div>
                      <p className={styles.remaining}>{remaining === null ? "Not reported" : `${Math.round(remaining)}% Remaining`}</p>
                    </div>;
                    })}
                  </div>
                  {!rows.length && <p className={styles.status}>{reading?.loading ? "Reading provider usage…" : reading?.error ?? "No usage reported yet. Send a message to update it."}</p>}
                  {stale && <p className={styles.status}>Last reading{reading?.data?.captured_at ? ` · ${new Date(reading.data.captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. {reading?.error ?? "Waiting for an updated report."}</p>}
                  {coolingDown && <p className={styles.status}>Retrying automatically after {new Date(retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>}
                  {reserveCopy && <p className={styles.status} data-usage-reserve="active">{reserveCopy}</p>}
                  {weekly && <p className={styles.status}>Ring shows the remaining weekly allowance.</p>}
                  {provider.id === "google" && rows.length > 1 && <p className={styles.status}>Ring shows the account with the least remaining allowance.</p>}
                  <Popover.Arrow asChild><svg width="30" height="24" viewBox="0 0 30 24" className={styles.tail} aria-hidden="true"><path d="M0 0 C9 2 12 8 15 24 C18 8 21 2 30 0Z" /></svg></Popover.Arrow>
                  </motion.div>
                </Popover.Content>}
                </AnimatePresence>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
        {!usage.providers.length && <Popover.Root>
          <Popover.Trigger asChild><button type="button" className={styles.provider} aria-label="Provider usage status"><span className={styles.ring}><Activity size={21} aria-hidden="true" /></span><span className={styles.percent}>—</span></button></Popover.Trigger>
          <Popover.Portal><Popover.Content className={styles.card} side="left" sideOffset={20} collisionPadding={12} aria-label="Provider usage status">
            <header className={styles.cardHeader}><h2>Provider Usage</h2></header>
            <p className={styles.status}>{usage.catalogError ?? (usage.catalogReady ? "No providers with live usage limits are connected. Add a subscription in Settings → Providers." : "Reading your connected providers…")}</p>
            {usage.catalogReady && <button type="button" className={styles.retry} onClick={() => void usage.loadCatalog()}>Try again</button>}
          </Popover.Content></Popover.Portal>
        </Popover.Root>}
      </motion.div>
    </aside>
  );
}
