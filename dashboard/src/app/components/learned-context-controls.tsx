"use client";
import { useEffect, useState } from "react";
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
export function LessonControls({ lesson }: { lesson: SuggestionLesson }) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  async function run(action: string) {
    try {
      await lessonAction(lesson, action, value);
      setEditing(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save this change.");
    }
  }
  return (
    <details className="text-xs text-[var(--ink-muted)]">
      <summary>Why this?</summary>
      <p>{lesson.why}</p>
      <ul>
        {lesson.sources.map((ref) => (
          <li key={ref}>{/^(https?:\/\/|\/(?!\/))/.test(ref) ? <a href={ref}>{ref}</a> : ref}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        {lesson.eventId ? (
          <button type="button" onClick={() => void run("apply")}>
            Update event
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            Correct
          </button>
        )}
        <button type="button" onClick={() => void run("dismiss")}>
          Dismiss suggestion
        </button>
        {!lesson.eventId && (
          <button type="button" onClick={() => void run("forget")}>
            Forget
          </button>
        )}
      </div>
      {editing && (
        <form
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
          />
          <button disabled={!value.trim()}>Save correction</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
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
        <div key={row.lesson.key}>
          {row.title}
          <LessonControls lesson={row.lesson} />
        </div>
      ))}
    </section>
  ) : null;
}
