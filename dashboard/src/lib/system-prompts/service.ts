import { AsyncLocalStorage } from "node:async_hooks";
import db from "../db.ts";
import { systemPromptDefinitions } from "./catalog.ts";
import { SystemPromptStore } from "./store.ts";
import type { SystemPromptEdit } from "./types.ts";

let store: SystemPromptStore | undefined;
function promptStore(): SystemPromptStore {
  return store ??= new SystemPromptStore(db);
}

export function systemPromptText(id: string, userId?: number | null): string {
  if (userId === undefined) {
    const scoped = systemPromptContext.getStore()?.prompts.get(id);
    if (scoped !== undefined) return scoped;
  }
  const definition = systemPromptDefinitions().find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown system prompt: ${id}`);
  return userId || definition.scope === "installation" ? promptStore().content(userId, id, definition.defaultContent, definition.scope) : definition.defaultContent;
}

export function listSystemPrompts(userId: number) {
  return systemPromptDefinitions().map((definition) => promptStore().view(userId, definition));
}

export function updateSystemPrompt(userId: number, edit: SystemPromptEdit) {
  return promptStore().update(userId, edit, systemPromptDefinitions());
}

/** Substitute runtime data once; values containing template syntax stay literal. */
export function renderSystemPrompt(
  id: string,
  userId: number | null | undefined,
  parameters: Record<string, string> = {},
): string {
  return systemPromptText(id, userId).replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (token, name: string) =>
    Object.hasOwn(parameters, name) ? parameters[name] : token);
}

/** Include this revision in feature caches so an edit invalidates old model results. */
export function systemPromptRevision(id: string, userId?: number | null): number {
  if (userId === undefined) {
    const revision = systemPromptContext.getStore()?.revisions.get(id);
    if (revision !== undefined) return revision;
  }
  const definition = systemPromptDefinitions().find(item => item.id === id);
  if (!definition) throw new Error("Unknown system prompt: " + id);
  if (!userId && definition.scope !== "installation") return 0;
  return promptStore().view(userId ?? 0, definition).revision;
}

/** Replace built-in instruction sections in one pass, retaining runtime context. */
export function applySystemPromptSections(text: string, userId: number | null | undefined, ids: readonly string[]): string {
  if (!userId) return text;
  const replacements = new Map<string, string>();
  for (const id of ids) {
    const definition = systemPromptDefinitions().find(item => item.id === id);
    if (!definition) throw new Error("Unknown system prompt: " + id);
    if (!definition.defaultContent || !text.includes(definition.defaultContent)) continue;
    const prompt = promptStore().view(userId, definition);
    if (prompt.customized) replacements.set(definition.defaultContent, prompt.content);
  }
  if (!replacements.size) return text;
  const escaped = [...replacements.keys()].sort((a, b) => b.length - a.length)
    .map(value => Array.from(value, char => "^$.*+?()[]{}|".includes(char) || char.charCodeAt(0) === 92
      ? String.fromCharCode(92) + char : char).join(""));
  return text.replace(new RegExp(escaped.join("|"), "g"), original => replacements.get(original)!);
}

type SystemPromptContext = { gardenId?: string; userId: number | null; prompts: Map<string, string>; revisions: Map<string, number> };
const systemPromptContext = new AsyncLocalStorage<SystemPromptContext>();

/** A feature run keeps one instruction snapshot, including its cache receipts. */
export function withSystemPromptContext<T>(userId: number | null | undefined, work: () => T, gardenId?: string): T {
  const current = systemPromptContext.getStore();
  if (current && current.userId === (userId ?? null) && (!gardenId || current.gardenId === gardenId)) return work();
  const views = userId ? listSystemPrompts(userId) : systemPromptDefinitions().map(item => item.scope === "installation"
    ? promptStore().view(0, item) : { id: item.id, content: item.defaultContent, revision: 0 });
  const prompts = new Map(views.map(item => [item.id, item.content]));
  const revisions = new Map(views.map(item => [item.id, item.revision]));
  return systemPromptContext.run({ userId: userId ?? null, gardenId, prompts, revisions }, work);
}

/** Internal job boundary: Garden slugs come from already authorized job records. */
export function withGardenSystemPromptContext<T>(gardenId: string, work: () => T, userId?: number | null): T {
  const current = systemPromptContext.getStore();
  if (current?.gardenId === gardenId && (userId == null || current.userId === userId)) return work();
  const owner = userId ?? (db.prepare("SELECT user_id FROM clusters WHERE slug = ?").get(gardenId) as { user_id: number } | undefined)?.user_id;
  return withSystemPromptContext(owner, work, gardenId);
}

/** Resolve inside a feature snapshot; standalone callers retain built-in defaults. */
export function scopedSystemPromptText(id: string): string {
  return systemPromptContext.getStore()?.prompts.get(id) ?? systemPromptText(id);
}

/** Installed personas may appear between catalog refreshes; preserve their current default. */
export function systemPromptTextOrDefault(id: string, userId: number | null | undefined, fallback: string): string {
  if (userId === undefined) {
    const context = systemPromptContext.getStore();
    if (context) return context.prompts.get(id) ?? fallback;
  }
  return userId ? promptStore().content(userId, id, fallback) : fallback;
}
