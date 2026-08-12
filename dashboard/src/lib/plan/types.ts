// Shared Plan types — the Kaneo model as Breadboard holds it.
//
// Imported by the SQLite store, the route handlers and the browser views alike,
// so nothing here may reach for node or next APIs.
//
// What was kept from Kaneo: workspace -> project -> column -> task, the
// per-project task number that gives a card a stable name, priorities, labels,
// comments and task relations. What was dropped: workspaces themselves (a
// Breadboard user is their own workspace, so a project hangs off `users`
// directly), and everything the multi-tenant product needs but a single owner
// does not — teams, roles, invitations, billing, notification preferences.

/** Dates are wall-clock date strings ("YYYY-MM-DD"), matching the calendar. */
export type PlanDate = string;

export type TaskPriority = "urgent" | "high" | "medium" | "low";

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  );
}

/**
 * Where a card came from. `manual` is a card the user typed. The rest are filed
 * by Breadboard itself so long-running work leaves durable state behind: an
 * `/agents:*` run, a scheduled chat, or a task the assistant created in a
 * conversation. The board renders the last three with their origin visible so
 * the user can tell their own list from the machine's.
 */
export type TaskSource = "manual" | "agent_run" | "schedule" | "assistant";

export const TASK_SOURCES: readonly TaskSource[] = [
  "manual",
  "agent_run",
  "schedule",
  "assistant",
];

export function isTaskSource(value: unknown): value is TaskSource {
  return (
    typeof value === "string" && (TASK_SOURCES as readonly string[]).includes(value)
  );
}

export type TaskRelationType = "blocks" | "blocked_by" | "relates_to" | "duplicates";

export const TASK_RELATION_TYPES: readonly TaskRelationType[] = [
  "blocks",
  "blocked_by",
  "relates_to",
  "duplicates",
];

export function isTaskRelationType(value: unknown): value is TaskRelationType {
  return (
    typeof value === "string" &&
    (TASK_RELATION_TYPES as readonly string[]).includes(value)
  );
}

export interface PlanProject {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  archived: boolean;
  sortOrder: number;
  /** High-water mark for per-project task numbers; never reused after a delete. */
  lastTaskNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanColumn {
  id: number;
  projectId: number;
  name: string;
  slug: string;
  position: number;
  color: string;
  /** Kaneo's `isFinal`: landing here marks the task done and stamps completedAt. */
  isFinal: boolean;
}

export interface PlanLabel {
  id: number;
  name: string;
  color: string;
}

export interface PlanComment {
  id: number;
  taskId: number;
  /** Who wrote it. `assistant` comments are what the agent leaves on a card. */
  author: "user" | "assistant";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTaskRelation {
  id: number;
  taskId: number;
  relatedTaskId: number;
  relationType: TaskRelationType;
  /** Denormalized for rendering, so a relation list needs no second query. */
  relatedTitle: string;
  relatedRef: string;
}

export interface PlanTask {
  id: number;
  projectId: number;
  columnId: number;
  /** Per-project counter. `ref` renders it as "OPS-12". */
  number: number;
  ref: string;
  position: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  startDate: PlanDate | null;
  dueDate: PlanDate | null;
  completedAt: string | null;
  source: TaskSource;
  /** Opaque origin id — an agent run id, a schedule id — for de-duplication. */
  sourceRef: string | null;
  /** Where to go to see the thing this card is tracking. */
  sourceUrl: string | null;
  labels: PlanLabel[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A project with its columns and their cards, in board order. */
export interface PlanBoard {
  project: PlanProject;
  columns: Array<PlanColumn & { tasks: PlanTask[] }>;
}

export interface PlanProjectSummary extends PlanProject {
  taskCount: number;
  openCount: number;
  /** Open tasks whose due date is today or already past. */
  overdueCount: number;
}

export interface CreateTaskInput {
  projectId: number;
  columnId?: number | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  startDate?: PlanDate | null;
  dueDate?: PlanDate | null;
  labelIds?: number[];
  source?: TaskSource;
  sourceRef?: string | null;
  sourceUrl?: string | null;
  /** Insert at the top of the column rather than the bottom. */
  prepend?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  startDate?: PlanDate | null;
  dueDate?: PlanDate | null;
  columnId?: number;
  labelIds?: number[];
}

export interface MoveTaskInput {
  columnId: number;
  /** 0-based slot within the destination column. Clamped to its length. */
  position?: number;
}

export interface TaskQuery {
  projectId?: number;
  columnSlug?: string;
  priority?: TaskPriority;
  labelId?: number;
  /** Substring match over title and description. */
  text?: string;
  /** Only tasks due on or after this date. */
  dueFrom?: PlanDate;
  /** Only tasks due on or before this date. */
  dueTo?: PlanDate;
  includeDone?: boolean;
  limit?: number;
}

/**
 * The default board. Kaneo's four columns, with `Done` final — kept so a board
 * built here reads the same as one built in Kaneo, and so an export to a real
 * Kaneo instance later maps column-for-column.
 */
export const DEFAULT_PROJECT_COLUMNS: ReadonlyArray<{
  name: string;
  slug: string;
  position: number;
  isFinal: boolean;
  color: string;
}> = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false, color: "#7b97aa" },
  {
    name: "In Progress",
    slug: "in-progress",
    position: 1,
    isFinal: false,
    color: "#9a7b2e",
  },
  {
    name: "In Review",
    slug: "in-review",
    position: 2,
    isFinal: false,
    color: "#8a7ba0",
  },
  { name: "Done", slug: "done", position: 3, isFinal: true, color: "#4f6f68" },
];

/** Kaneo puts every new project's cards in the first column. */
export const DEFAULT_COLUMN_SLUG = "to-do";

export function taskRef(projectSlug: string, number: number): string {
  return `${projectSlug.toUpperCase()}-${number}`;
}

/**
 * Slugify a name the way Kaneo does: lowercase, non-alphanumerics collapsed to
 * single hyphens, trimmed. Used for both project and column slugs.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
