// Turning a JSON request body into store input.
//
// Framework-free on purpose (the same split the calendar uses in ./payload.ts):
// the route handlers stay thin, and these readers are unit-testable without
// next/server. Only fields the body actually carries are returned, so a PATCH
// that names one field leaves the others alone.

import { PlanError } from "./store.ts";
import {
  isTaskPriority,
  isTaskRelationType,
  type CreateTaskInput,
  type MoveTaskInput,
  type TaskQuery,
  type TaskRelationType,
  type UpdateTaskInput,
} from "./types.ts";

type Body = Record<string, unknown>;

export function readId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PlanError(400, `That ${field} is not valid.`);
  }
  return id;
}

function readOptionalId(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return readId(value, field);
}

function readLabelIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new PlanError(400, "Labels must be a list of ids.");
  return value.map((entry) => readId(entry, "label id"));
}

/**
 * `null` and `""` both mean "clear this field", and an absent key means "leave
 * it". Distinguishing the three is the whole job of this helper.
 */
function readNullableText(body: Body, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new PlanError(400, `${key} must be text.`);
  return value;
}

export function readTaskCreate(body: Body): CreateTaskInput {
  const title = typeof body.title === "string" ? body.title : "";
  return {
    projectId: readId(body.projectId, "project id"),
    columnId: readOptionalId(body.columnId, "column id") ?? null,
    title,
    description: readNullableText(body, "description"),
    priority: isTaskPriority(body.priority) ? body.priority : undefined,
    startDate: readNullableText(body, "startDate"),
    dueDate: readNullableText(body, "dueDate"),
    labelIds: readLabelIds(body.labelIds),
    prepend: body.prepend === true,
  };
}

export function readTaskPatch(body: Body): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  if (typeof body.title === "string") patch.title = body.title;
  const description = readNullableText(body, "description");
  if (description !== undefined) patch.description = description;
  if (isTaskPriority(body.priority)) patch.priority = body.priority;
  const startDate = readNullableText(body, "startDate");
  if (startDate !== undefined) patch.startDate = startDate;
  const dueDate = readNullableText(body, "dueDate");
  if (dueDate !== undefined) patch.dueDate = dueDate;
  const columnId = readOptionalId(body.columnId, "column id");
  if (columnId !== undefined) patch.columnId = columnId;
  const labelIds = readLabelIds(body.labelIds);
  if (labelIds !== undefined) patch.labelIds = labelIds;
  return patch;
}

export function readTaskMove(body: Body): MoveTaskInput {
  const move: MoveTaskInput = { columnId: readId(body.columnId, "column id") };
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 0) {
      throw new PlanError(400, "That position is not valid.");
    }
    move.position = position;
  }
  return move;
}

export function readRelationType(value: unknown): TaskRelationType {
  return isTaskRelationType(value) ? value : "relates_to";
}

/** Query-string filters for GET /api/plan/tasks. */
export function readTaskQuery(params: URLSearchParams): TaskQuery {
  const query: TaskQuery = {};
  const projectId = params.get("projectId");
  if (projectId) query.projectId = readId(projectId, "project id");
  const columnSlug = params.get("columnSlug");
  if (columnSlug) query.columnSlug = columnSlug;
  const priority = params.get("priority");
  if (isTaskPriority(priority)) query.priority = priority;
  const labelId = params.get("labelId");
  if (labelId) query.labelId = readId(labelId, "label id");
  const text = params.get("text");
  if (text) query.text = text;
  const dueFrom = params.get("dueFrom");
  if (dueFrom) query.dueFrom = dueFrom;
  const dueTo = params.get("dueTo");
  if (dueTo) query.dueTo = dueTo;
  if (params.get("includeDone") === "true") query.includeDone = true;
  const limit = params.get("limit");
  if (limit) {
    const parsed = Number(limit);
    if (Number.isFinite(parsed) && parsed > 0) query.limit = Math.floor(parsed);
  }
  return query;
}
