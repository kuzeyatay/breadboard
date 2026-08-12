// SQLite-backed Plan persistence — Kaneo's board model over Breadboard's own
// database.
//
// A plain class over an injected database handle (matching
// src/lib/calendar/store.ts) so it can be unit tested against an in-memory
// database. It owns every write to the `plan_*` tables and is the only place
// that understands column ordering, the per-project task counter, and what it
// means for a card to land in a final column.
//
// Every public method takes the user id as its first argument and filters by it
// in SQL, so a request that names another user's project id gets a "not found"
// rather than their data. That is the same rule the calendar store follows.

import type DatabaseType from "better-sqlite3";

import { ensurePlanSchema } from "./schema.ts";
import { normalizeCalendarColor } from "../calendar/palette.ts";
import { parseDate, todayDate } from "../calendar/wallclock.ts";
import {
  DEFAULT_COLUMN_SLUG,
  DEFAULT_PROJECT_COLUMNS,
  isTaskPriority,
  slugify,
  taskRef,
  type CreateTaskInput,
  type MoveTaskInput,
  type PlanBoard,
  type PlanColumn,
  type PlanComment,
  type PlanLabel,
  type PlanProject,
  type PlanProjectSummary,
  type PlanTask,
  type PlanTaskRelation,
  type TaskPriority,
  type TaskQuery,
  type TaskRelationType,
  type TaskSource,
  type UpdateTaskInput,
} from "./types.ts";

type Db = DatabaseType.Database;

export const MAX_PROJECTS_PER_USER = 60;
export const MAX_COLUMNS_PER_PROJECT = 12;
export const MAX_TASKS_PER_USER = 20_000;
export const MAX_LABELS_PER_USER = 80;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_COMMENT_LENGTH = 10_000;
export const MAX_QUERY_LIMIT = 200;
export const DEFAULT_QUERY_LIMIT = 50;

export const DEFAULT_PROJECT_NAME = "Personal";

export class PlanError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PlanError";
    this.status = status;
  }
}

interface ProjectRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  archived: number;
  sort_order: number;
  last_task_number: number;
  created_at: string;
  updated_at: string;
}

interface ColumnRow {
  id: number;
  project_id: number;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_final: number;
}

interface TaskRow {
  id: number;
  user_id: number;
  project_id: number;
  column_id: number;
  number: number;
  position: number;
  title: string;
  description: string | null;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  source: string;
  source_ref: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  /** Joined in by the task queries so a card knows its own name. */
  project_slug: string;
}

interface LabelRow {
  id: number;
  name: string;
  color: string;
}

interface CommentRow {
  id: number;
  task_id: number;
  author: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function trimmed(value: unknown, max: number, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new PlanError(400, `${field} is required.`);
  if (text.length > max) {
    throw new PlanError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) {
    throw new PlanError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseDate(value);
  if (!parsed) {
    throw new PlanError(400, `${field} must be a date like 2026-08-14.`);
  }
  return String(value).slice(0, 10);
}

export class PlanStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    ensurePlanSchema(db);
  }

  // --- projects -------------------------------------------------------------

  /**
   * Every board view calls this first. A user with no projects gets Kaneo's
   * starting shape — one project with the four default columns — rather than an
   * empty screen with a form on it.
   */
  listProjectsEnsuringDefault(userId: number): PlanProjectSummary[] {
    const existing = this.listProjects(userId, { includeArchived: true });
    if (existing.length > 0) {
      return existing.filter((project) => !project.archived);
    }
    this.createProject(userId, { name: DEFAULT_PROJECT_NAME });
    return this.listProjects(userId, { includeArchived: false });
  }

  listProjects(
    userId: number,
    options: { includeArchived?: boolean } = {},
  ): PlanProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM plan_projects
          WHERE user_id = ?
            ${options.includeArchived ? "" : "AND archived = 0"}
          ORDER BY sort_order, id`,
      )
      .all(userId) as ProjectRow[];

    const today = todayDate();
    return rows.map((row) => {
      const counts = this.db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN t.completed_at IS NULL
                       AND t.due_date IS NOT NULL
                       AND t.due_date <= ? THEN 1 ELSE 0 END) AS overdue
           FROM plan_tasks t
          WHERE t.project_id = ?`,
        )
        .get(today, row.id) as {
        total: number | null;
        open: number | null;
        overdue: number | null;
      };
      return {
        ...this.mapProject(row),
        taskCount: counts.total ?? 0,
        openCount: counts.open ?? 0,
        overdueCount: counts.overdue ?? 0,
      };
    });
  }

  getProject(userId: number, projectId: number): PlanProject {
    const row = this.db
      .prepare("SELECT * FROM plan_projects WHERE id = ? AND user_id = ?")
      .get(projectId, userId) as ProjectRow | undefined;
    if (!row) throw new PlanError(404, "That project does not exist.");
    return this.mapProject(row);
  }

  createProject(
    userId: number,
    input: { name: string; description?: string | null; color?: string },
  ): PlanProject {
    const name = trimmed(input.name, MAX_NAME_LENGTH, "The project name");
    const description = optionalText(
      input.description,
      MAX_DESCRIPTION_LENGTH,
      "The description",
    );
    const color = normalizeCalendarColor(input.color);

    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM plan_projects WHERE user_id = ?")
      .get(userId) as { n: number };
    if (count.n >= MAX_PROJECTS_PER_USER) {
      throw new PlanError(
        400,
        `You already have ${MAX_PROJECTS_PER_USER} projects. Archive one first.`,
      );
    }

    const slug = this.uniqueProjectSlug(userId, slugify(name) || "project");
    const nextOrder = this.db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM plan_projects WHERE user_id = ?",
      )
      .get(userId) as { next: number };

    const create = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO plan_projects (user_id, name, slug, description, color, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, name, slug, description, color, nextOrder.next);
      const projectId = Number(result.lastInsertRowid);
      const insertColumn = this.db.prepare(
        `INSERT INTO plan_columns (project_id, name, slug, position, color, is_final)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const column of DEFAULT_PROJECT_COLUMNS) {
        insertColumn.run(
          projectId,
          column.name,
          column.slug,
          column.position,
          column.color,
          column.isFinal ? 1 : 0,
        );
      }
      return projectId;
    });

    return this.getProject(userId, create());
  }

  updateProject(
    userId: number,
    projectId: number,
    patch: {
      name?: string;
      description?: string | null;
      color?: string;
      archived?: boolean;
    },
  ): PlanProject {
    const project = this.getProject(userId, projectId);
    const name =
      patch.name === undefined
        ? project.name
        : trimmed(patch.name, MAX_NAME_LENGTH, "The project name");
    const description =
      patch.description === undefined
        ? project.description
        : optionalText(patch.description, MAX_DESCRIPTION_LENGTH, "The description");
    const color =
      patch.color === undefined ? project.color : normalizeCalendarColor(patch.color);
    const archived =
      patch.archived === undefined ? project.archived : Boolean(patch.archived);

    this.db
      .prepare(
        `UPDATE plan_projects
            SET name = ?, description = ?, color = ?, archived = ?,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(name, description, color, archived ? 1 : 0, projectId, userId);
    return this.getProject(userId, projectId);
  }

  deleteProject(userId: number, projectId: number): void {
    const result = this.db
      .prepare("DELETE FROM plan_projects WHERE id = ? AND user_id = ?")
      .run(projectId, userId);
    if (result.changes === 0) throw new PlanError(404, "That project does not exist.");
  }

  // --- columns --------------------------------------------------------------

  listColumns(userId: number, projectId: number): PlanColumn[] {
    this.getProject(userId, projectId);
    const rows = this.db
      .prepare("SELECT * FROM plan_columns WHERE project_id = ? ORDER BY position, id")
      .all(projectId) as ColumnRow[];
    return rows.map(mapColumn);
  }

  createColumn(
    userId: number,
    projectId: number,
    input: { name: string; color?: string; isFinal?: boolean },
  ): PlanColumn {
    this.getProject(userId, projectId);
    const name = trimmed(input.name, MAX_NAME_LENGTH, "The column name");
    const existing = this.listColumns(userId, projectId);
    if (existing.length >= MAX_COLUMNS_PER_PROJECT) {
      throw new PlanError(
        400,
        `A project may have at most ${MAX_COLUMNS_PER_PROJECT} columns.`,
      );
    }
    const taken = new Set(existing.map((column) => column.slug));
    let slug = slugify(name) || "column";
    let suffix = 2;
    while (taken.has(slug)) slug = `${slugify(name) || "column"}-${suffix++}`;

    const position = existing.length;
    const result = this.db
      .prepare(
        `INSERT INTO plan_columns (project_id, name, slug, position, color, is_final)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        name,
        slug,
        position,
        normalizeCalendarColor(input.color ?? "#7b97aa"),
        input.isFinal ? 1 : 0,
      );
    const row = this.db
      .prepare("SELECT * FROM plan_columns WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as ColumnRow;
    return mapColumn(row);
  }

  updateColumn(
    userId: number,
    columnId: number,
    patch: { name?: string; color?: string; isFinal?: boolean },
  ): PlanColumn {
    const column = this.requireColumn(userId, columnId);
    const name =
      patch.name === undefined
        ? column.name
        : trimmed(patch.name, MAX_NAME_LENGTH, "The column name");
    const color =
      patch.color === undefined ? column.color : normalizeCalendarColor(patch.color);
    const isFinal = patch.isFinal === undefined ? column.isFinal : Boolean(patch.isFinal);

    this.db
      .prepare(
        `UPDATE plan_columns
            SET name = ?, color = ?, is_final = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(name, color, isFinal ? 1 : 0, columnId);

    // Making a column final retroactively completes what is already sitting in
    // it, and un-marking it reopens those cards, so the two never disagree.
    if (isFinal !== column.isFinal) {
      this.db
        .prepare(
          `UPDATE plan_tasks
              SET completed_at = ${isFinal ? "datetime('now')" : "NULL"},
                  updated_at = datetime('now')
            WHERE column_id = ?`,
        )
        .run(columnId);
    }
    return this.requireColumn(userId, columnId);
  }

  /**
   * Deleting a column moves its cards to the first remaining column rather than
   * deleting them: a board rearrangement must never lose work.
   */
  deleteColumn(userId: number, columnId: number): void {
    const column = this.requireColumn(userId, columnId);
    const siblings = this.listColumns(userId, column.projectId).filter(
      (candidate) => candidate.id !== columnId,
    );
    if (siblings.length === 0) {
      throw new PlanError(400, "A project needs at least one column.");
    }
    const fallback = siblings[0];
    const run = this.db.transaction(() => {
      const offset = this.db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM plan_tasks WHERE column_id = ?",
        )
        .get(fallback.id) as { next: number };
      this.db
        .prepare(
          `UPDATE plan_tasks
              SET column_id = ?,
                  position = position + ?,
                  completed_at = ${fallback.isFinal ? "datetime('now')" : "NULL"},
                  updated_at = datetime('now')
            WHERE column_id = ?`,
        )
        .run(fallback.id, offset.next, columnId);
      this.db.prepare("DELETE FROM plan_columns WHERE id = ?").run(columnId);
      this.resequence(fallback.id);
      for (const [index, sibling] of siblings.entries()) {
        this.db
          .prepare("UPDATE plan_columns SET position = ? WHERE id = ?")
          .run(index, sibling.id);
      }
    });
    run();
  }

  // --- board ----------------------------------------------------------------

  getBoard(userId: number, projectId: number): PlanBoard {
    const project = this.getProject(userId, projectId);
    const columns = this.listColumns(userId, projectId);
    const tasks = this.queryTasks(
      userId,
      { projectId, includeDone: true, limit: MAX_TASKS_PER_USER },
      { cap: MAX_TASKS_PER_USER },
    );
    const byColumn = new Map<number, PlanTask[]>();
    for (const task of tasks) {
      const bucket = byColumn.get(task.columnId);
      if (bucket) bucket.push(task);
      else byColumn.set(task.columnId, [task]);
    }
    return {
      project,
      columns: columns.map((column) => ({
        ...column,
        tasks: (byColumn.get(column.id) ?? []).sort(
          (a, b) => a.position - b.position || a.id - b.id,
        ),
      })),
    };
  }

  // --- tasks ----------------------------------------------------------------

  createTask(userId: number, input: CreateTaskInput): PlanTask {
    const project = this.getProject(userId, input.projectId);
    const title = trimmed(input.title, MAX_TITLE_LENGTH, "The task title");
    const description = optionalText(
      input.description,
      MAX_DESCRIPTION_LENGTH,
      "The description",
    );
    const priority: TaskPriority = isTaskPriority(input.priority)
      ? input.priority
      : "medium";
    const startDate = optionalDate(input.startDate, "The start date");
    const dueDate = optionalDate(input.dueDate, "The due date");
    if (startDate && dueDate && startDate > dueDate) {
      throw new PlanError(400, "The start date is after the due date.");
    }

    const total = this.db
      .prepare("SELECT COUNT(*) AS n FROM plan_tasks WHERE user_id = ?")
      .get(userId) as { n: number };
    if (total.n >= MAX_TASKS_PER_USER) {
      throw new PlanError(400, "You have reached the maximum number of tasks.");
    }

    const column = input.columnId
      ? this.requireColumnInProject(userId, project.id, input.columnId)
      : this.defaultColumn(userId, project.id);

    const create = this.db.transaction(() => {
      // Read-then-write rather than UPDATE ... RETURNING: this runs inside the
      // enclosing transaction, so the counter cannot be handed out twice, and
      // it keeps the statement to the SQL subset the rest of the repo uses.
      const current = this.db
        .prepare("SELECT last_task_number AS n FROM plan_projects WHERE id = ? AND user_id = ?")
        .get(project.id, userId) as { n: number };
      const number = current.n + 1;
      this.db
        .prepare(
          `UPDATE plan_projects
              SET last_task_number = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
        )
        .run(number, project.id, userId);

      let position: number;
      if (input.prepend) {
        this.db
          .prepare(
            "UPDATE plan_tasks SET position = position + 1 WHERE column_id = ?",
          )
          .run(column.id);
        position = 0;
      } else {
        const next = this.db
          .prepare(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM plan_tasks WHERE column_id = ?",
          )
          .get(column.id) as { next: number };
        position = next.next;
      }

      const result = this.db
        .prepare(
          `INSERT INTO plan_tasks
             (user_id, project_id, column_id, number, position, title, description,
              priority, start_date, due_date, completed_at, source, source_ref, source_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          project.id,
          column.id,
          number,
          position,
          title,
          description,
          priority,
          startDate,
          dueDate,
          column.isFinal ? new Date().toISOString() : null,
          input.source ?? "manual",
          input.sourceRef ?? null,
          input.sourceUrl ?? null,
        );
      const taskId = Number(result.lastInsertRowid);
      if (input.labelIds?.length) this.setTaskLabels(userId, taskId, input.labelIds);
      return taskId;
    });

    return this.getTask(userId, create());
  }

  getTask(userId: number, taskId: number): PlanTask {
    const row = this.db
      .prepare(
        `SELECT t.*, p.slug AS project_slug
           FROM plan_tasks t
           JOIN plan_projects p ON p.id = t.project_id
          WHERE t.id = ? AND t.user_id = ?`,
      )
      .get(taskId, userId) as TaskRow | undefined;
    if (!row) throw new PlanError(404, "That task does not exist.");
    return this.mapTask(row);
  }

  updateTask(userId: number, taskId: number, patch: UpdateTaskInput): PlanTask {
    const task = this.getTask(userId, taskId);
    const title =
      patch.title === undefined
        ? task.title
        : trimmed(patch.title, MAX_TITLE_LENGTH, "The task title");
    const description =
      patch.description === undefined
        ? task.description
        : optionalText(patch.description, MAX_DESCRIPTION_LENGTH, "The description");
    const priority = isTaskPriority(patch.priority) ? patch.priority : task.priority;
    const startDate =
      patch.startDate === undefined
        ? task.startDate
        : optionalDate(patch.startDate, "The start date");
    const dueDate =
      patch.dueDate === undefined
        ? task.dueDate
        : optionalDate(patch.dueDate, "The due date");
    if (startDate && dueDate && startDate > dueDate) {
      throw new PlanError(400, "The start date is after the due date.");
    }

    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE plan_tasks
              SET title = ?, description = ?, priority = ?, start_date = ?, due_date = ?,
                  updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
        )
        .run(title, description, priority, startDate, dueDate, taskId, userId);
      if (patch.labelIds !== undefined) this.setTaskLabels(userId, taskId, patch.labelIds);
      // A column change through this path is a move to the end of the target,
      // so both entry points share one set of ordering rules.
      if (patch.columnId !== undefined && patch.columnId !== task.columnId) {
        this.applyMove(userId, taskId, { columnId: patch.columnId });
      }
    });
    run();
    return this.getTask(userId, taskId);
  }

  /** Drag-and-drop and `plan_move_task` both land here. */
  moveTask(userId: number, taskId: number, input: MoveTaskInput): PlanTask {
    const run = this.db.transaction(() => this.applyMove(userId, taskId, input));
    run();
    return this.getTask(userId, taskId);
  }

  deleteTask(userId: number, taskId: number): void {
    const task = this.getTask(userId, taskId);
    const run = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM plan_tasks WHERE id = ? AND user_id = ?")
        .run(taskId, userId);
      this.resequence(task.columnId);
    });
    run();
  }

  /**
   * `cap` is the ceiling the caller is allowed to ask for. Requests from a
   * route or a tool leave it at MAX_QUERY_LIMIT; the board passes its own,
   * higher one because it must render every card in the project or the columns
   * would silently lose their tails.
   */
  queryTasks(
    userId: number,
    query: TaskQuery = {},
    options: { cap?: number } = {},
  ): PlanTask[] {
    const clauses = ["t.user_id = ?"];
    const params: unknown[] = [userId];

    if (query.projectId !== undefined) {
      clauses.push("t.project_id = ?");
      params.push(query.projectId);
    }
    if (query.columnSlug) {
      clauses.push("c.slug = ?");
      params.push(query.columnSlug);
    }
    if (query.priority) {
      clauses.push("t.priority = ?");
      params.push(query.priority);
    }
    if (query.text) {
      // `%` and `_` are wildcards in LIKE, and SQLite only honours a backslash
      // escape when the pattern says so — without the ESCAPE clause a search for
      // "100%" would match everything.
      clauses.push(
        "(t.title LIKE ? ESCAPE '\\' OR IFNULL(t.description, '') LIKE ? ESCAPE '\\')",
      );
      const pattern = `%${query.text.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      params.push(pattern, pattern);
    }
    if (query.dueFrom) {
      clauses.push("t.due_date IS NOT NULL AND t.due_date >= ?");
      params.push(query.dueFrom);
    }
    if (query.dueTo) {
      clauses.push("t.due_date IS NOT NULL AND t.due_date <= ?");
      params.push(query.dueTo);
    }
    if (!query.includeDone) clauses.push("t.completed_at IS NULL");
    if (query.labelId !== undefined) {
      clauses.push(
        "EXISTS (SELECT 1 FROM plan_task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)",
      );
      params.push(query.labelId);
    }

    const cap = Math.max(1, Math.floor(options.cap ?? MAX_QUERY_LIMIT));
    const limit = Math.min(
      Math.max(1, Math.floor(query.limit ?? DEFAULT_QUERY_LIMIT)),
      cap,
    );

    const rows = this.db
      .prepare(
        `SELECT t.*, p.slug AS project_slug
           FROM plan_tasks t
           JOIN plan_projects p ON p.id = t.project_id
           JOIN plan_columns c ON c.id = t.column_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY c.position, t.position, t.id
          LIMIT ?`,
      )
      .all(...params, limit) as TaskRow[];
    return rows.map((row) => this.mapTask(row));
  }

  /**
   * Cards Breadboard files for itself — an agent run, a scheduled chat. Keyed by
   * `(source, sourceRef)` so a run that reports progress twice updates one card
   * instead of stacking duplicates on the board.
   */
  upsertSourceTask(
    userId: number,
    input: CreateTaskInput & { source: TaskSource; sourceRef: string },
  ): PlanTask {
    const existing = this.db
      .prepare(
        `SELECT t.*, p.slug AS project_slug
           FROM plan_tasks t
           JOIN plan_projects p ON p.id = t.project_id
          WHERE t.user_id = ? AND t.source = ? AND t.source_ref = ?`,
      )
      .get(userId, input.source, input.sourceRef) as TaskRow | undefined;

    if (!existing) return this.createTask(userId, input);

    const title = input.title?.trim()
      ? trimmed(input.title, MAX_TITLE_LENGTH, "The task title")
      : existing.title;
    const description =
      input.description === undefined
        ? existing.description
        : optionalText(input.description, MAX_DESCRIPTION_LENGTH, "The description");
    this.db
      .prepare(
        `UPDATE plan_tasks
            SET title = ?, description = ?, source_url = COALESCE(?, source_url),
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(title, description, input.sourceUrl ?? null, existing.id);
    if (input.columnId && input.columnId !== existing.column_id) {
      this.moveTask(userId, existing.id, { columnId: input.columnId });
    }
    return this.getTask(userId, existing.id);
  }

  /** Find the column a source card should sit in, by slug, creating nothing. */
  findColumnBySlug(userId: number, projectId: number, slug: string): PlanColumn | null {
    const row = this.db
      .prepare(
        `SELECT c.* FROM plan_columns c
           JOIN plan_projects p ON p.id = c.project_id
          WHERE c.project_id = ? AND c.slug = ? AND p.user_id = ?`,
      )
      .get(projectId, slug, userId) as ColumnRow | undefined;
    return row ? mapColumn(row) : null;
  }

  // --- labels ---------------------------------------------------------------

  listLabels(userId: number): PlanLabel[] {
    const rows = this.db
      .prepare("SELECT id, name, color FROM plan_labels WHERE user_id = ? ORDER BY name")
      .all(userId) as LabelRow[];
    return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }));
  }

  createLabel(userId: number, input: { name: string; color?: string }): PlanLabel {
    const name = trimmed(input.name, 40, "The label name");
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM plan_labels WHERE user_id = ?")
      .get(userId) as { n: number };
    if (count.n >= MAX_LABELS_PER_USER) {
      throw new PlanError(400, `You already have ${MAX_LABELS_PER_USER} labels.`);
    }
    const existing = this.db
      .prepare("SELECT id, name, color FROM plan_labels WHERE user_id = ? AND name = ?")
      .get(userId, name) as LabelRow | undefined;
    if (existing) {
      return { id: existing.id, name: existing.name, color: existing.color };
    }
    const color = normalizeCalendarColor(input.color ?? "#6e8f87");
    const result = this.db
      .prepare("INSERT INTO plan_labels (user_id, name, color) VALUES (?, ?, ?)")
      .run(userId, name, color);
    return { id: Number(result.lastInsertRowid), name, color };
  }

  deleteLabel(userId: number, labelId: number): void {
    const result = this.db
      .prepare("DELETE FROM plan_labels WHERE id = ? AND user_id = ?")
      .run(labelId, userId);
    if (result.changes === 0) throw new PlanError(404, "That label does not exist.");
  }

  setTaskLabels(userId: number, taskId: number, labelIds: readonly number[]): void {
    this.db
      .prepare(
        `DELETE FROM plan_task_labels
          WHERE task_id = (SELECT id FROM plan_tasks WHERE id = ? AND user_id = ?)`,
      )
      .run(taskId, userId);
    if (!labelIds.length) return;
    const owned = new Set(this.listLabels(userId).map((label) => label.id));
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO plan_task_labels (task_id, label_id) VALUES (?, ?)",
    );
    for (const labelId of labelIds) {
      if (owned.has(labelId)) insert.run(taskId, labelId);
    }
  }

  // --- comments -------------------------------------------------------------

  listComments(userId: number, taskId: number): PlanComment[] {
    this.getTask(userId, taskId);
    const rows = this.db
      .prepare(
        `SELECT id, task_id, author, content, created_at, updated_at
           FROM plan_task_comments WHERE task_id = ? ORDER BY id`,
      )
      .all(taskId) as CommentRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      author: row.author === "assistant" ? "assistant" : "user",
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  addComment(
    userId: number,
    taskId: number,
    content: string,
    author: "user" | "assistant" = "user",
  ): PlanComment {
    this.getTask(userId, taskId);
    const text = trimmed(content, MAX_COMMENT_LENGTH, "The comment");
    const result = this.db
      .prepare(
        "INSERT INTO plan_task_comments (task_id, user_id, author, content) VALUES (?, ?, ?, ?)",
      )
      .run(taskId, userId, author, text);
    const row = this.db
      .prepare(
        `SELECT id, task_id, author, content, created_at, updated_at
           FROM plan_task_comments WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid)) as CommentRow;
    return {
      id: row.id,
      taskId: row.task_id,
      author: row.author === "assistant" ? "assistant" : "user",
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteComment(userId: number, commentId: number): void {
    const result = this.db
      .prepare("DELETE FROM plan_task_comments WHERE id = ? AND user_id = ?")
      .run(commentId, userId);
    if (result.changes === 0) throw new PlanError(404, "That comment does not exist.");
  }

  // --- relations ------------------------------------------------------------

  listRelations(userId: number, taskId: number): PlanTaskRelation[] {
    this.getTask(userId, taskId);
    const rows = this.db
      .prepare(
        `SELECT r.id, r.task_id, r.related_task_id, r.relation_type,
                t.title AS related_title, t.number AS related_number,
                p.slug AS related_project_slug
           FROM plan_task_relations r
           JOIN plan_tasks t ON t.id = r.related_task_id
           JOIN plan_projects p ON p.id = t.project_id
          WHERE r.task_id = ? AND t.user_id = ?
          ORDER BY r.id`,
      )
      .all(taskId, userId) as Array<{
      id: number;
      task_id: number;
      related_task_id: number;
      relation_type: string;
      related_title: string;
      related_number: number;
      related_project_slug: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      relatedTaskId: row.related_task_id,
      relationType: row.relation_type as TaskRelationType,
      relatedTitle: row.related_title,
      relatedRef: taskRef(row.related_project_slug, row.related_number),
    }));
  }

  addRelation(
    userId: number,
    taskId: number,
    relatedTaskId: number,
    relationType: TaskRelationType,
  ): void {
    if (taskId === relatedTaskId) {
      throw new PlanError(400, "A task cannot relate to itself.");
    }
    this.getTask(userId, taskId);
    this.getTask(userId, relatedTaskId);
    const mirrored: Record<TaskRelationType, TaskRelationType> = {
      blocks: "blocked_by",
      blocked_by: "blocks",
      relates_to: "relates_to",
      duplicates: "duplicates",
    };
    const run = this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO plan_task_relations (task_id, related_task_id, relation_type)
         VALUES (?, ?, ?)`,
      );
      insert.run(taskId, relatedTaskId, relationType);
      // Kaneo stores one row per direction; keeping both in step means either
      // card shows the link without a second query.
      insert.run(relatedTaskId, taskId, mirrored[relationType]);
    });
    run();
  }

  deleteRelation(userId: number, relationId: number): void {
    const row = this.db
      .prepare(
        `SELECT r.* FROM plan_task_relations r
           JOIN plan_tasks t ON t.id = r.task_id
          WHERE r.id = ? AND t.user_id = ?`,
      )
      .get(relationId, userId) as
      | { id: number; task_id: number; related_task_id: number; relation_type: string }
      | undefined;
    if (!row) throw new PlanError(404, "That link does not exist.");
    const run = this.db.transaction(() => {
      this.db.prepare("DELETE FROM plan_task_relations WHERE id = ?").run(row.id);
      this.db
        .prepare(
          "DELETE FROM plan_task_relations WHERE task_id = ? AND related_task_id = ?",
        )
        .run(row.related_task_id, row.task_id);
    });
    run();
  }

  // --- internals ------------------------------------------------------------

  private applyMove(userId: number, taskId: number, input: MoveTaskInput): void {
    const task = this.getTask(userId, taskId);
    const target = this.requireColumnInProject(userId, task.projectId, input.columnId);

    const siblings = (
      this.db
        .prepare(
          "SELECT id FROM plan_tasks WHERE column_id = ? AND id != ? ORDER BY position, id",
        )
        .all(target.id, taskId) as { id: number }[]
    ).map((row) => row.id);

    const requested = input.position === undefined ? siblings.length : input.position;
    const slot = Math.min(Math.max(0, Math.floor(requested)), siblings.length);
    siblings.splice(slot, 0, taskId);

    const update = this.db.prepare(
      "UPDATE plan_tasks SET position = ?, column_id = ?, updated_at = datetime('now') WHERE id = ?",
    );
    for (const [index, id] of siblings.entries()) update.run(index, target.id, id);

    // Landing in a final column is what "done" means here, exactly as in Kaneo:
    // there is no separate status field to fall out of step with the board.
    if (target.isFinal && !task.completedAt) {
      this.db
        .prepare("UPDATE plan_tasks SET completed_at = ? WHERE id = ?")
        .run(new Date().toISOString(), taskId);
    } else if (!target.isFinal && task.completedAt) {
      this.db.prepare("UPDATE plan_tasks SET completed_at = NULL WHERE id = ?").run(taskId);
    }

    if (task.columnId !== target.id) this.resequence(task.columnId);
  }

  /** Close the gaps a move or delete left behind, so positions stay 0..n-1. */
  private resequence(columnId: number): void {
    const rows = this.db
      .prepare("SELECT id FROM plan_tasks WHERE column_id = ? ORDER BY position, id")
      .all(columnId) as { id: number }[];
    const update = this.db.prepare("UPDATE plan_tasks SET position = ? WHERE id = ?");
    for (const [index, row] of rows.entries()) update.run(index, row.id);
  }

  private defaultColumn(userId: number, projectId: number): PlanColumn {
    const columns = this.listColumns(userId, projectId);
    if (!columns.length) throw new PlanError(400, "That project has no columns.");
    return columns.find((column) => column.slug === DEFAULT_COLUMN_SLUG) ?? columns[0];
  }

  private requireColumn(userId: number, columnId: number): PlanColumn {
    const row = this.db
      .prepare(
        `SELECT c.* FROM plan_columns c
           JOIN plan_projects p ON p.id = c.project_id
          WHERE c.id = ? AND p.user_id = ?`,
      )
      .get(columnId, userId) as ColumnRow | undefined;
    if (!row) throw new PlanError(404, "That column does not exist.");
    return mapColumn(row);
  }

  private requireColumnInProject(
    userId: number,
    projectId: number,
    columnId: number,
  ): PlanColumn {
    const column = this.requireColumn(userId, columnId);
    if (column.projectId !== projectId) {
      throw new PlanError(400, "That column belongs to a different project.");
    }
    return column;
  }

  private uniqueProjectSlug(userId: number, base: string): string {
    const taken = new Set(
      (
        this.db
          .prepare("SELECT slug FROM plan_projects WHERE user_id = ?")
          .all(userId) as { slug: string }[]
      ).map((row) => row.slug),
    );
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private mapProject(row: ProjectRow): PlanProject {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      color: row.color,
      archived: row.archived === 1,
      sortOrder: row.sort_order,
      lastTaskNumber: row.last_task_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTask(row: TaskRow): PlanTask {
    const labels = this.db
      .prepare(
        `SELECT l.id, l.name, l.color
           FROM plan_task_labels tl
           JOIN plan_labels l ON l.id = tl.label_id
          WHERE tl.task_id = ?
          ORDER BY l.name`,
      )
      .all(row.id) as LabelRow[];
    const comments = this.db
      .prepare("SELECT COUNT(*) AS n FROM plan_task_comments WHERE task_id = ?")
      .get(row.id) as { n: number };
    return {
      id: row.id,
      projectId: row.project_id,
      columnId: row.column_id,
      number: row.number,
      ref: taskRef(row.project_slug, row.number),
      position: row.position,
      title: row.title,
      description: row.description,
      priority: (isTaskPriority(row.priority) ? row.priority : "medium") as TaskPriority,
      startDate: row.start_date,
      dueDate: row.due_date,
      completedAt: row.completed_at,
      source: row.source as TaskSource,
      sourceRef: row.source_ref,
      sourceUrl: row.source_url,
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      commentCount: comments.n,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function mapColumn(row: ColumnRow): PlanColumn {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    color: row.color,
    isFinal: row.is_final === 1,
  };
}
