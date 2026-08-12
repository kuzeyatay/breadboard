// The Plan board, addressed by an agent instead of by the drag-and-drop UI.
//
// Unlike the calendar's agent surface, this one writes: the user asked for a
// board the assistant can keep. What it can reach is still deliberately narrow.
//
//   * Every function takes the user id from the verified session, never from an
//     argument, and the store filters by it again in SQL.
//   * It can add, edit, move and annotate cards. It cannot delete a card, a
//     column or a project — undoing an agent's mistake should never require
//     recovering work it destroyed, and a card moved to the wrong column costs
//     one drag to fix.
//   * Columns are named, not numbered. A model that had to know a column id
//     would guess one; `plan_move_task` takes "done" or "In Progress" and
//     resolves it against that project's own columns.
//
// Everything returned is shaped for reading aloud: refs like "OPS-12" rather
// than row ids, dates as plain "YYYY-MM-DD", and descriptions truncated so a
// board of long notes cannot flood a turn's context.

import { PlanError, type PlanStore } from "./store.ts";
import { slugify, type PlanTask, type TaskPriority } from "./types.ts";
import { isTaskPriority } from "./types.ts";
import { parseDate, todayDate } from "../calendar/wallclock.ts";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DESCRIPTION_CHARS = 400;
/** How far ahead "what is coming up" looks when the caller says nothing. */
const DEFAULT_HORIZON_DAYS = 14;
const MAX_HORIZON_DAYS = 365;

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function optionalDate(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = text(value);
  if (!parseDate(raw)) {
    throw new PlanError(400, `"${raw}" is not a date for ${field}. Use 2026-08-14.`);
  }
  return raw.slice(0, 10);
}

/** Adding N days to a wall-clock date without leaving wall-clock time. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

interface TaskView {
  ref: string;
  title: string;
  project: string;
  column: string;
  priority: TaskPriority;
  due: string | null;
  start: string | null;
  done: boolean;
  labels: string[];
  notes: string | null;
  comments: number;
  /** Present only when breadboard filed the card rather than the user. */
  filedBy?: string;
}

/**
 * The shape every tool returns a card in. Ids are omitted on purpose: a model
 * that quotes "OPS-12" back to the user is quoting something the user can see
 * on the board, and every write tool accepts that ref.
 */
function viewTask(
  task: PlanTask,
  projectName: string,
  columnName: string,
): TaskView {
  const view: TaskView = {
    ref: task.ref,
    title: task.title,
    project: projectName,
    column: columnName,
    priority: task.priority,
    due: task.dueDate,
    start: task.startDate,
    done: task.completedAt !== null,
    labels: task.labels.map((label) => label.name),
    notes: truncate(task.description, DESCRIPTION_CHARS),
    comments: task.commentCount,
  };
  if (task.source !== "manual") view.filedBy = task.source;
  return view;
}

/** Index of project id -> name and column id -> name, built once per call. */
function directory(store: PlanStore, userId: number) {
  const projects = store.listProjects(userId, { includeArchived: true });
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const columnNames = new Map<number, string>();
  for (const project of projects) {
    for (const column of store.listColumns(userId, project.id)) {
      columnNames.set(column.id, column.name);
    }
  }
  return { projects, projectNames, columnNames };
}

function present(store: PlanStore, userId: number, tasks: readonly PlanTask[]): TaskView[] {
  const { projectNames, columnNames } = directory(store, userId);
  return tasks.map((task) =>
    viewTask(
      task,
      projectNames.get(task.projectId) ?? "Unknown project",
      columnNames.get(task.columnId) ?? "Unknown column",
    ),
  );
}

/**
 * Find the project a tool call means. Accepts the name, the slug, or nothing at
 * all — with one project a caller should not have to name it, and that is the
 * common case for a single owner.
 */
function resolveProject(store: PlanStore, userId: number, value: unknown) {
  const projects = store.listProjectsEnsuringDefault(userId);
  const wanted = text(value);
  if (!wanted) {
    if (projects.length === 1) return projects[0];
    throw new PlanError(
      400,
      `Name the project. You have: ${projects.map((project) => project.name).join(", ")}.`,
    );
  }
  const slug = slugify(wanted);
  const match =
    projects.find((project) => project.slug === slug) ??
    projects.find((project) => project.name.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new PlanError(
      404,
      `There is no project called "${wanted}". You have: ${projects
        .map((project) => project.name)
        .join(", ")}.`,
    );
  }
  return match;
}

/** Find a column of a project by name or slug — never by id. */
function resolveColumn(store: PlanStore, userId: number, projectId: number, value: unknown) {
  const columns = store.listColumns(userId, projectId);
  const wanted = text(value);
  if (!wanted) return null;
  const slug = slugify(wanted);
  const match =
    columns.find((column) => column.slug === slug) ??
    columns.find((column) => column.name.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new PlanError(
      404,
      `"${wanted}" is not a column of ${
        store.getProject(userId, projectId).name
      }. Its columns are: ${columns.map((column) => column.name).join(", ")}.`,
    );
  }
  return match;
}

/** Resolve a card from the ref the board shows ("OPS-12"). */
function resolveTask(store: PlanStore, userId: number, value: unknown): PlanTask {
  const wanted = text(value).toUpperCase();
  if (!wanted) throw new PlanError(400, "Which card? Give its ref, like OPS-12.");
  const match = /^([A-Z0-9-]+)-(\d+)$/.exec(wanted);
  if (!match) {
    throw new PlanError(400, `"${wanted}" is not a card ref. They look like OPS-12.`);
  }
  const [, projectSlug, number] = match;
  const projects = store.listProjects(userId, { includeArchived: true });
  const project = projects.find(
    (candidate) => candidate.slug.toUpperCase() === projectSlug,
  );
  if (!project) throw new PlanError(404, `There is no card ${wanted}.`);

  // The whole project, because a ref names a card by its number and that number
  // may belong to a card in any column, done or not.
  const found = store
    .queryTasks(
      userId,
      { projectId: project.id, includeDone: true, limit: 20_000 },
      { cap: 20_000 },
    )
    .find((task) => task.number === Number(number));
  if (!found) throw new PlanError(404, `There is no card ${wanted}.`);
  return found;
}

// --- reads ------------------------------------------------------------------

export function listProjects(store: PlanStore, userId: number) {
  const projects = store.listProjectsEnsuringDefault(userId);
  return {
    projects: projects.map((project) => ({
      name: project.name,
      ref: project.slug.toUpperCase(),
      description: truncate(project.description, DESCRIPTION_CHARS),
      open: project.openCount,
      overdue: project.overdueCount,
      total: project.taskCount,
      columns: store.listColumns(userId, project.id).map((column) => column.name),
    })),
  };
}

export function board(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const project = resolveProject(store, userId, args.project);
  const data = store.getBoard(userId, project.id);
  const includeDone = args.includeDone === true;
  return {
    project: project.name,
    columns: data.columns.map((column) => ({
      name: column.name,
      final: column.isFinal,
      cards: column.tasks
        .filter((task) => includeDone || task.completedAt === null)
        .map((task) => viewTask(task, project.name, column.name)),
    })),
  };
}

export function searchTasks(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const limit = numberOption(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const projectName = text(args.project);
  const project = projectName ? resolveProject(store, userId, projectName) : null;

  const tasks = store.queryTasks(userId, {
    projectId: project?.id,
    text: text(args.text) || undefined,
    priority: isTaskPriority(args.priority) ? args.priority : undefined,
    dueFrom: optionalDate(args.dueFrom, "dueFrom") ?? undefined,
    dueTo: optionalDate(args.dueTo, "dueTo") ?? undefined,
    includeDone: args.includeDone === true,
    limit,
  });
  return { count: tasks.length, tasks: present(store, userId, tasks) };
}

/**
 * "What is due soon" — the question a board is actually asked. Overdue work is
 * separated from upcoming work because the two need different answers.
 */
export function upcoming(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const days = numberOption(args.days, DEFAULT_HORIZON_DAYS, 1, MAX_HORIZON_DAYS);
  const today = todayDate();
  const horizon = addDays(today, days);

  const overdue = store.queryTasks(userId, { dueTo: addDays(today, -1), limit: MAX_LIMIT });
  const soon = store.queryTasks(userId, {
    dueFrom: today,
    dueTo: horizon,
    limit: MAX_LIMIT,
  });
  return {
    today,
    through: horizon,
    overdue: present(store, userId, overdue),
    upcoming: present(store, userId, soon),
  };
}

export function getTask(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const task = resolveTask(store, userId, args.ref);
  const [view] = present(store, userId, [task]);
  return {
    task: { ...view, notes: truncate(task.description, 4_000) },
    comments: store.listComments(userId, task.id).map((comment) => ({
      author: comment.author,
      content: truncate(comment.content, 1_000),
      at: comment.createdAt,
    })),
    links: store.listRelations(userId, task.id).map((relation) => ({
      type: relation.relationType,
      ref: relation.relatedRef,
      title: relation.relatedTitle,
    })),
  };
}

// --- writes -----------------------------------------------------------------

export function createTask(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const project = resolveProject(store, userId, args.project);
  const column = resolveColumn(store, userId, project.id, args.column);
  const title = text(args.title);
  if (!title) throw new PlanError(400, "A card needs a title.");

  const task = store.createTask(userId, {
    projectId: project.id,
    columnId: column?.id ?? null,
    title,
    description: text(args.notes) || null,
    priority: isTaskPriority(args.priority) ? args.priority : undefined,
    dueDate: optionalDate(args.due, "due") ?? null,
    startDate: optionalDate(args.start, "start") ?? null,
    // Marked so the board can show what the assistant added, and so the user
    // can tell their own list from the machine's at a glance.
    source: "assistant",
  });
  const [view] = present(store, userId, [task]);
  return { created: view };
}

export function updateTask(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const existing = resolveTask(store, userId, args.ref);
  const task = store.updateTask(userId, existing.id, {
    title: text(args.title) || undefined,
    description: args.notes === undefined ? undefined : text(args.notes) || null,
    priority: isTaskPriority(args.priority) ? args.priority : undefined,
    dueDate: optionalDate(args.due, "due"),
    startDate: optionalDate(args.start, "start"),
  });
  const [view] = present(store, userId, [task]);
  return { updated: view };
}

export function moveTask(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const existing = resolveTask(store, userId, args.ref);
  const column = resolveColumn(store, userId, existing.projectId, args.column);
  if (!column) throw new PlanError(400, "Which column should it move to?");
  const task = store.moveTask(userId, existing.id, { columnId: column.id });
  const [view] = present(store, userId, [task]);
  return { moved: view };
}

/** The assistant's own note on a card, always attributed to the assistant. */
export function commentTask(store: PlanStore, userId: number, args: Record<string, unknown>) {
  const task = resolveTask(store, userId, args.ref);
  const content = text(args.content);
  if (!content) throw new PlanError(400, "The note is empty.");
  const comment = store.addComment(userId, task.id, content, "assistant");
  return { ref: task.ref, added: { author: comment.author, at: comment.createdAt } };
}
