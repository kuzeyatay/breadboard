"use client";

// The Plan shell: the project rail, the view switch, and whichever of the two
// views is showing — the board, or the calendar that used to live at /calendar.
//
// The two views are one page rather than two because they answer the same
// question at different resolutions: the board is what there is to do, the
// calendar is when it has to happen. A card with a due date appears in both.
//
// State a reader would expect to survive a reload — which view, which project,
// which week — is mirrored into the query string with replaceState rather than
// the router, so switching views never pushes onto the back stack.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CalendarClient from "./calendar/calendar-client";
import type { DueTaskChip } from "./calendar/calendar-views";
import PlanBoard from "./plan-board";
import PlanTaskPanel from "./plan-task-panel";
import type { CalendarView } from "@/lib/calendar/layout.ts";
import type { CalendarCollection } from "@/lib/calendar/types.ts";
import { todayDate } from "@/lib/calendar/wallclock.ts";
import type { PlanView } from "@/lib/plan/view.ts";
import type {
  PlanBoard as PlanBoardData,
  PlanComment,
  PlanLabel,
  PlanProjectSummary,
  PlanTask,
  PlanTaskRelation,
} from "@/lib/plan/types.ts";

interface Props {
  initialProjects: PlanProjectSummary[];
  initialBoard: PlanBoardData | null;
  initialLabels: PlanLabel[];
  initialView: PlanView;
  initialCalendars: CalendarCollection[];
  initialCalendarView: CalendarView;
  initialToday: string;
  initialAnchor: string;
}

interface TaskDetail {
  task: PlanTask;
  comments: PlanComment[];
  relations: PlanTaskRelation[];
}

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="5.5" height="15" rx="1.6" />
      <rect x="11.5" y="4.5" width="5.5" height="9.5" rx="1.6" />
      <path strokeLinecap="round" d="M19.5 6.5v11" />
    </svg>
  );
}

function ProjectsNavIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4" width="17" height="16" rx="2.25" />
      <path d="M8.5 4v16" />
      {open ? <path d="m15 9-3 3 3 3" /> : <path d="m12 9 3 3-3 3" />}
    </svg>
  );
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function PlanClient({
  initialProjects,
  initialBoard,
  initialLabels,
  initialView,
  initialCalendars,
  initialCalendarView,
  initialToday,
  initialAnchor,
}: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [board, setBoard] = useState(initialBoard);
  // Not state: nothing on this page creates or renames a label, so the
  // server-rendered list is the list for as long as the tab is open.
  const labels = initialLabels;
  const [view, setView] = useState<PlanView>(initialView);
  const [today, setToday] = useState(initialToday);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [busyTaskIds, setBusyTaskIds] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectsNavOpen, setProjectsNavOpen] = useState(true);

  // Due cards for whatever window the calendar is showing.
  const [dueRange, setDueRange] = useState<{ from: string; to: string } | null>(null);
  const [dueTasks, setDueTasks] = useState<PlanTask[]>([]);

  const activeProjectId = board?.project.id ?? null;
  const dueRequest = useRef(0);

  const projectColors = useMemo(
    () => new Map(projects.map((project) => [project.id, project.color])),
    [projects],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (activeProjectId) url.searchParams.set("project", String(activeProjectId));
    window.history.replaceState(null, "", url);
  }, [view, activeProjectId]);

  // A tab left open past midnight must not keep calling yesterday "today".
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshBoard = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`/api/plan/projects/${projectId}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response, "Could not load the board"));
      const body = (await response.json()) as { board: PlanBoardData };
      setBoard(body.board);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the board");
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    const response = await fetch("/api/plan/projects", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { projects: PlanProjectSummary[] };
    setProjects(body.projects);
  }, []);

  const loadDueTasks = useCallback(async (from: string, to: string) => {
    const id = (dueRequest.current += 1);
    const params = new URLSearchParams({
      dueFrom: from.slice(0, 10),
      dueTo: to.slice(0, 10),
      includeDone: "true",
      limit: "200",
    });
    const response = await fetch(`/api/plan/tasks?${params}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { tasks: PlanTask[] };
    // A slower earlier request must not overwrite a newer one.
    if (id !== dueRequest.current) return;
    setDueTasks(body.tasks);
  }, []);

  useEffect(() => {
    if (view !== "calendar" || !dueRange) return;
    void loadDueTasks(dueRange.from, dueRange.to);
  }, [view, dueRange, loadDueTasks]);

  const onCalendarRange = useCallback((from: string, to: string) => {
    setDueRange((current) =>
      current && current.from === from && current.to === to ? current : { from, to },
    );
  }, []);

  const dueByDate = useMemo(() => {
    const map = new Map<string, DueTaskChip[]>();
    for (const task of dueTasks) {
      if (!task.dueDate) continue;
      const chip: DueTaskChip = {
        id: task.id,
        ref: task.ref,
        title: task.title,
        color: projectColors.get(task.projectId) ?? "#4f6f68",
        done: task.completedAt !== null,
        urgent: task.priority === "urgent" || task.priority === "high",
      };
      const bucket = map.get(task.dueDate);
      if (bucket) bucket.push(chip);
      else map.set(task.dueDate, [chip]);
    }
    return map;
  }, [dueTasks, projectColors]);

  // --- mutations ------------------------------------------------------------

  function markBusy(taskId: number, busy: boolean) {
    setBusyTaskIds((current) => {
      const next = new Set(current);
      if (busy) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  async function createTask(columnId: number, title: string) {
    if (!activeProjectId) return;
    setError(null);
    try {
      const response = await fetch("/api/plan/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, columnId, title }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not add the card"));
      await refreshBoard(activeProjectId);
      void refreshProjects();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add the card");
    }
  }

  async function moveTask(taskId: number, columnId: number, position: number) {
    if (!activeProjectId) return;
    markBusy(taskId, true);
    // Optimistic: the card follows the pointer immediately, and the refresh
    // below replaces the guess with what the server actually did.
    setBoard((current) => (current ? previewMove(current, taskId, columnId, position) : current));
    try {
      const response = await fetch(`/api/plan/tasks/${taskId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, position }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not move the card"));
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move the card");
    } finally {
      markBusy(taskId, false);
      await refreshBoard(activeProjectId);
      void refreshProjects();
      if (detail?.task.id === taskId) void openTask(taskId);
    }
  }

  const openTask = useCallback(async (taskId: number) => {
    try {
      const response = await fetch(`/api/plan/tasks/${taskId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Could not open the card"));
      setDetail((await response.json()) as TaskDetail);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open the card");
    }
  }, []);

  async function patchTask(patch: Record<string, unknown>) {
    if (!detail) return;
    setSavingTask(true);
    setError(null);
    try {
      const response = await fetch(`/api/plan/tasks/${detail.task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not save the card"));
      const body = (await response.json()) as { task: PlanTask };
      setDetail((current) => (current ? { ...current, task: body.task } : current));
      if (activeProjectId) await refreshBoard(activeProjectId);
      if (dueRange) void loadDueTasks(dueRange.from, dueRange.to);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Could not save the card");
    } finally {
      setSavingTask(false);
    }
  }

  async function commentOnTask(content: string) {
    if (!detail) return;
    const response = await fetch(`/api/plan/tasks/${detail.task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      setError(await readError(response, "Could not add the note"));
      return;
    }
    await openTask(detail.task.id);
    if (activeProjectId) await refreshBoard(activeProjectId);
  }

  async function deleteTask() {
    if (!detail) return;
    const taskId = detail.task.id;
    const response = await fetch(`/api/plan/tasks/${taskId}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response, "Could not delete the card"));
      return;
    }
    setDetail(null);
    if (activeProjectId) await refreshBoard(activeProjectId);
    void refreshProjects();
    if (dueRange) void loadDueTasks(dueRange.from, dueRange.to);
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setError(null);
    try {
      const response = await fetch("/api/plan/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not add the project"));
      const body = (await response.json()) as { project: { id: number } };
      setNewProjectName("");
      await refreshProjects();
      await refreshBoard(body.project.id);
      setDetail(null);
      setView("board");
    } catch (projectError) {
      setError(
        projectError instanceof Error ? projectError.message : "Could not add the project",
      );
    } finally {
      setCreatingProject(false);
    }
  }

  async function selectProject(projectId: number) {
    setDetail(null);
    await refreshBoard(projectId);
  }

  /** Open a card from the calendar, which means leaving the calendar. */
  const openTaskFromCalendar = useCallback(
    (taskId: number) => {
      const task = dueTasks.find((candidate) => candidate.id === taskId);
      void (async () => {
        if (task && task.projectId !== activeProjectId) await refreshBoard(task.projectId);
        setView("board");
        await openTask(taskId);
      })();
    },
    [activeProjectId, dueTasks, openTask, refreshBoard],
  );

  return (
    <main className="bb-calendar-shell flex min-h-0 flex-col bg-gray-950 text-gray-300">
      <header className="bb-neu-toolbar breadboard-flower-navbar flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <a
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-medium text-white"
          title="Back to breadboard"
        >
          <PlanIcon className="h-4 w-4" />
          Plan
        </a>

        <button
          type="button"
          onClick={() => setProjectsNavOpen((open) => !open)}
          className="neu-button-icon hidden size-8 items-center justify-center rounded-lg border text-gray-500 hover:text-white lg:flex"
          aria-controls="plan-projects-navigation"
          aria-expanded={projectsNavOpen}
          aria-label={projectsNavOpen ? "Close projects navigation" : "Open projects navigation"}
          title={projectsNavOpen ? "Close projects navigation" : "Open projects navigation"}
        >
          <ProjectsNavIcon open={projectsNavOpen} className="size-4" />
        </button>

        <div className="neu-segmented flex items-center gap-0.5 rounded-lg border">
          {(["board", "calendar"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                view === option ? "text-white" : "text-gray-500 hover:text-white"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {board && (
          <h1 className="min-w-0 truncate text-base font-medium text-white">
            {board.project.name}
          </h1>
        )}

        <div className="ml-auto flex items-center gap-3">
          {error && (
            <span className="max-w-xs truncate text-xs text-red-400" title={error}>
              {error}
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {projectsNavOpen && (
          <aside
            id="plan-projects-navigation"
            className="bb-neu-sidebar-left hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r px-3 py-4 lg:flex"
          >
            <div>
              <h2 className="mb-2 px-1 text-[11px] uppercase tracking-wider text-gray-500">
                Projects
              </h2>
              <ul className="space-y-0.5">
                {projects.map((project) => {
                  const active = project.id === activeProjectId;
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => void selectProject(project.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                          active ? "bb-neu-conversation-row-selected text-white" : "text-gray-400 hover:text-white"
                        }`}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: project.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        {project.overdueCount > 0 ? (
                          <span
                            className="shrink-0 tabular-nums"
                            style={{ color: "var(--danger)" }}
                            title={`${project.overdueCount} overdue`}
                          >
                            {project.overdueCount}
                          </span>
                        ) : (
                          project.openCount > 0 && (
                            <span className="shrink-0 tabular-nums text-gray-600">
                              {project.openCount}
                            </span>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <form onSubmit={createProject} className="mt-2 flex gap-1">
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="New project"
                  className="neu-control min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs text-white placeholder:text-gray-600"
                />
                <button
                  type="submit"
                  disabled={creatingProject || !newProjectName.trim()}
                  className="neu-button-icon rounded-lg border px-2 py-1 text-xs text-gray-400 disabled:opacity-40"
                  aria-label="Add project"
                >
                  +
                </button>
              </form>
            </div>

            {labels.length > 0 && (
              <div>
                <h2 className="mb-2 px-1 text-[11px] uppercase tracking-wider text-gray-500">
                  Labels
                </h2>
                <div className="flex flex-wrap gap-1 px-1">
                  {labels.map((label) => (
                    <span
                      key={label.id}
                      className="rounded-full px-1.5 py-px text-[10px]"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${label.color} 24%, var(--paper-raised))`,
                        color: "var(--ink)",
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-auto px-1 text-[11px] leading-5 text-gray-600">
              Cards marked <span className="text-gray-500">agent</span> or{" "}
              <span className="text-gray-500">scheduled</span> were filed by breadboard
              itself.
            </p>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {view === "board" ? (
            board ? (
              <PlanBoard
                board={board}
                today={today}
                busyTaskIds={busyTaskIds}
                selectedTaskId={detail?.task.id ?? null}
                onMoveTask={(taskId, columnId, position) =>
                  void moveTask(taskId, columnId, position)
                }
                onOpenTask={(taskId) => void openTask(taskId)}
                onCreateTask={(columnId, title) => void createTask(columnId, title)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                Add a project to start a board.
              </div>
            )
          ) : (
            <CalendarClient
              embedded
              initialCalendars={initialCalendars}
              initialToday={initialToday}
              initialView={initialCalendarView}
              initialAnchor={initialAnchor}
              dueTasks={dueByDate}
              onSelectTask={openTaskFromCalendar}
              onRangeChange={onCalendarRange}
            />
          )}
        </div>

        {detail && (
          <PlanTaskPanel
            // Remounts on a different card, which is what resets its fields.
            key={detail.task.id}
            task={detail.task}
            columns={board?.columns ?? []}
            labels={labels}
            comments={detail.comments}
            relations={detail.relations}
            saving={savingTask}
            error={null}
            onPatch={(patch) => void patchTask(patch)}
            onMove={(columnId) => void moveTask(detail.task.id, columnId, Number.MAX_SAFE_INTEGER)}
            onComment={(content) => void commentOnTask(content)}
            onDelete={() => void deleteTask()}
            onClose={() => setDetail(null)}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The board as it will look once the server agrees — used so a dragged card
 * lands where it was dropped instead of snapping back for one frame.
 */
function previewMove(
  board: PlanBoardData,
  taskId: number,
  columnId: number,
  position: number,
): PlanBoardData {
  const moving = board.columns
    .flatMap((column) => column.tasks)
    .find((task) => task.id === taskId);
  if (!moving) return board;

  return {
    ...board,
    columns: board.columns.map((column) => {
      const without = column.tasks.filter((task) => task.id !== taskId);
      if (column.id !== columnId) return { ...column, tasks: without };
      const slot = Math.min(Math.max(0, position), without.length);
      const next = [...without];
      next.splice(slot, 0, { ...moving, columnId });
      return { ...column, tasks: next };
    }),
  };
}
