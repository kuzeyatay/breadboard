"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, Check, ChevronDown, GripHorizontal, Minus, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { BrowserSketchOutline } from "@/app/browser/browser-home-widgets";
import { todayDate } from "@/lib/calendar/wallclock";
import { formatShortDate } from "@/lib/calendar/format";
import type { PlanColumn, PlanTask, UpdateTaskInput } from "@/lib/plan/types";
import { useNotepadPosition } from "./use-notepad-position";
import { useNotepadTasks } from "./use-notepad-tasks";
import styles from "./new-tab-notepad.module.css";

function TaskDate({ value, label, disabled, onChange }: {
  value: string | null; label: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return (
    <label className={styles.date} title={label}>
      <CalendarDays size={12} aria-hidden="true" />
      <span>{value ? value === todayDate() ? "Today" : formatShortDate(value) : "Date"}</span>
      <input type="date" aria-label={label} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TodoRow({ task, columns, onUpdate }: {
  task: PlanTask; columns: PlanColumn[]; onUpdate: (id: number, patch: UpdateTaskInput, onSaved?: () => void) => Promise<boolean>;
}) {
  // A local draft survives both background refreshes and a failed save.
  const [draft, setDraft] = useState<string | null>(null);
  const [pendingDone, setPendingDone] = useState<boolean | null>(null);
  const [previousColumn, setPreviousColumn] = useState(task.completedAt ? null : task.columnId);
  const done = pendingDone ?? Boolean(task.completedAt);
  const targetColumn = task.completedAt
    ? columns.find((column) => column.id === previousColumn && !column.isFinal) ?? columns.find((column) => !column.isFinal)
    : columns.find((column) => column.isFinal);

  async function saveTitle() {
    if (draft === null) return;
    const title = draft.trim();
    if (!title || title === task.title) { setDraft(null); return; }
    await onUpdate(task.id, { title }, () => setDraft((current) => current?.trim() === title ? null : current));
  }

  async function toggleDone() {
    if (!targetColumn || pendingDone !== null) return;
    if (!task.completedAt) setPreviousColumn(task.columnId);
    setPendingDone(!task.completedAt);
    await onUpdate(task.id, { columnId: targetColumn.id });
    setPendingDone(null);
  }

  return (
    <li className={styles.row} data-done={done}>
      <label className={styles.check}>
        <input type="checkbox" checked={done} disabled={!targetColumn || pendingDone !== null}
          aria-label={`Complete ${task.title}`} onChange={() => void toggleDone()} />
        <span aria-hidden="true">{done && <Check size={12} strokeWidth={2.5} />}</span>
      </label>
      <div className={styles.taskContent}>
        <input className={styles.title} value={draft ?? task.title} aria-label={`Edit ${task.title}`} maxLength={200}
          onChange={(event) => setDraft(event.target.value)} onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") { event.preventDefault(); setDraft(null); }
          }} />
        <TaskDate value={task.dueDate} label={`Due date for ${task.title}`} onChange={(value) => { void onUpdate(task.id, { dueDate: value || null }); }} />
      </div>
    </li>
  );
}

export default function NewTabNotepad({ ownerKey }: { ownerKey: string }) {
  const { panelRef, ready, dragging, collapsed, handleProps, toggleCollapsed } = useNotepadPosition(ownerKey);
  const data = useNotepadTasks(ownerKey);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentId = useId();
  const headingId = useId();
  const today = todayDate();
  const todayTasks = data.tasks.filter((task) => task.dueDate === today);
  const remaining = todayTasks.filter((task) => !task.completedAt).length;
  const canAdd = !data.loading && data.columns.some((column) => !column.isFinal);
  const calendarHref = `/plan?${new URLSearchParams({ view: "calendar", ...(data.projectId ? { project: String(data.projectId) } : {}) })}`;

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || adding || !canAdd) return;
    setAdding(true);
    const submittedTitle = title.trim();
    await data.addTask(submittedTitle, date ?? todayDate(), () => {
      setTitle((current) => current.trim() === submittedTitle ? "" : current);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    setAdding(false);
  }

  return (
    <aside ref={panelRef} aria-labelledby={headingId} className={styles.notepad}
      data-ready={ready} data-dragging={dragging} data-collapsed={collapsed}>
      <BrowserSketchOutline targetRef={panelRef} index={4} />
      <header className={styles.header}>
        <button type="button" className={styles.handle} {...handleProps}
          aria-label="Move to-do notepad" title="Drag to move · Arrow keys to reposition">
          <GripHorizontal size={16} aria-hidden="true" />
          <span id={headingId}>To-do</span>
          {!data.loading && <span className={styles.count}>{remaining}</span>}
        </button>
        <Link href={calendarHref} className={styles.iconButton} aria-label="Open to-dos in calendar" title="Open calendar"><ArrowUpRight size={16} aria-hidden="true" /></Link>
        <button type="button" className={styles.iconButton} aria-label={collapsed ? "Expand to-do notepad" : "Minimize to-do notepad"}
          aria-expanded={!collapsed} aria-controls={contentId} onClick={toggleCollapsed}>
          {collapsed ? <Plus size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
        </button>
      </header>
      <div id={contentId} className={styles.body} hidden={collapsed}>
        <div className={styles.project}>
          <select aria-label="To-do project" value={data.projectId ?? ""} disabled={data.busy || data.loading} onChange={(event) => data.selectProject(Number(event.target.value))}>
            {!data.projectId && <option value="">To-dos</option>}
            {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <ChevronDown size={12} aria-hidden="true" />
        </div>
        {data.error && <div className={styles.error} role="alert"><span>{data.error.message}</span><button type="button" onClick={data.error.retry} disabled={data.busy}>Retry</button></div>}
        <ul className={styles.tasks} aria-label="Today's to-dos" aria-busy={data.loading}>
          {todayTasks.map((task) => <TodoRow key={task.id} task={task} columns={data.columns} onUpdate={data.updateTask} />)}
        </ul>
        {!data.loading && !todayTasks.length && !data.error && <p className={styles.empty}>{data.projectId ? "No to-dos for today." : <Link href="/plan">Create a project in Plan</Link>}</p>}
        <form className={styles.composer} onSubmit={(event) => void addTask(event)}>
          <div className={styles.composerLine}>
            <button type="submit" className={styles.add} aria-label="Add to-do" disabled={!title.trim() || adding || !canAdd}><Plus size={18} aria-hidden="true" /></button>
            <input ref={inputRef} aria-label="New to-do" placeholder="Add a to-do…" value={title} maxLength={200} disabled={!canAdd || adding} onChange={(event) => setTitle(event.target.value)} />
          </div>
          {title && <TaskDate value={date ?? todayDate()} label="New to-do due date" disabled={adding} onChange={(value) => setDate(value || null)} />}
        </form>
      </div>
    </aside>
  );
}
