"use client";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import ViewportPopover from "./viewport-popover";
import type { SuggestionLesson } from "@/lib/personal-context/suggestions";
import { RECOMMENDATION_REFRESH_EVENT } from "@/lib/recommendations/types";
import { AUTH_CHANGED_EVENT } from "@/lib/auth-events";

export async function lessonAction(lesson: SuggestionLesson, action: string, value?: string) {
  const response = await fetch("/api/personal-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: lesson.key, basis: lesson.basis, scope: lesson.scope, action, value }),
  });
  if (!response.ok) throw new Error((await response.json()).error || "Couldn’t save this change.");
  if (action !== "accept") window.dispatchEvent(new Event(RECOMMENDATION_REFRESH_EVENT));
  if (action === "apply") window.dispatchEvent(new Event("breadboard:calendar:changed"));
}
// A small "i" button that opens the reason and controls in a popover beside
// it, like the Intelligence menu. `className` places the trigger (the greeting
// cards pin it inside the card's corner).
export function LessonControls({ lesson, className = "relative inline-block" }: { lesson: SuggestionLesson; className?: string }) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); setEditing(false); };
  async function run(action: string) {
    try {
      await lessonAction(lesson, action, value);
      setEditing(false);
      setError("");
      if (action !== "correct") setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save this change.");
    }
  }
  const action = "rounded-lg px-2 py-1 text-[var(--ink)] transition hover:bg-[var(--paper-strong)]";
  return (
    <div className={className}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Why this?"
        title="Why this?"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
      >
        <Info aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <ViewportPopover
          anchorRef={button}
          ariaLabel="Why this?"
          role="dialog"
          portal={false}
          topLayer
          onClose={close}
          className="neu-popover fixed w-72 space-y-2 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-left text-xs text-[var(--ink-muted)]"
        >
          <div className="text-sm text-[var(--ink)]">Why this?</div>
          <p>{lesson.why}</p>
          {lesson.sources.length ? (
            <ul className="space-y-0.5">
              {[...new Set(lesson.sources)].map((ref) => (
                <li key={ref} className="truncate">{/^(https?:\/\/|\/(?!\/))/.test(ref) ? <a href={ref} className="underline">{ref}</a> : ref}</li>
              ))}
            </ul>
          ) : null}
          <div className="-mx-2 flex flex-wrap gap-1 border-t border-[var(--line)] pt-2">
            {lesson.eventId ? (
              <button type="button" className={action} onClick={() => void run("apply")}>
                Update event
              </button>
            ) : (
              <button type="button" className={action} onClick={() => setEditing(true)}>
                Correct
              </button>
            )}
            <button type="button" className={action} onClick={() => void run("dismiss")}>
              Dismiss
            </button>
            {!lesson.eventId && (
              <button type="button" className={action} onClick={() => void run("forget")}>
                Forget
              </button>
            )}
          </div>
          {editing && (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void run("correct");
              }}
            >
              <input
                autoFocus
                maxLength={300}
                aria-label="Correction"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] px-2 py-1 text-[var(--ink)]"
              />
              <button className={action} disabled={!value.trim()}>Save</button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
        </ViewportPopover>
      ) : null}
    </div>
  );
}
export function LearnedContextSettings() {
  const [rows, setRows] = useState<Array<{ title: string; lesson: SuggestionLesson }>>([]);
  useEffect(() => {
    let rev = 0;
    const read = async () => {
      const n = ++rev;
      try {
        const r = await fetch("/api/personal-context", { cache: "no-store" });
        const data = r.ok ? await r.json() : {};
        if (n === rev) setRows(data.lessons || []);
      } catch {
        if (n === rev) setRows([]);
      }
    };
    const reset = () => {
      setRows([]);
      void read();
    };
    void read();
    window.addEventListener(RECOMMENDATION_REFRESH_EVENT, reset);
    window.addEventListener(AUTH_CHANGED_EVENT, reset);
    return () => {
      rev++;
      window.removeEventListener(RECOMMENDATION_REFRESH_EVENT, reset);
      window.removeEventListener(AUTH_CHANGED_EVENT, reset);
    };
  }, []);
  return rows.length ? (
    <section className="space-y-2">
      <h3>Learned from your work</h3>
      {rows.map((row) => (
        <div key={row.lesson.key} className="flex items-center gap-1">
          {row.title}
          <LessonControls lesson={row.lesson} />
        </div>
      ))}
    </section>
  ) : null;
}
