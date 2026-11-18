import type Database from "better-sqlite3";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { durableMemoryExclusionReason, isSensitiveMemoryText } from "../conversations/memory.ts";
import { browserFacts } from "./browser.ts";
import { gardenDocumentHref } from "../chat-markdown-links.ts";
import { reviewedPatterns } from "./learning.ts";
import { contextIntent, contextPrompt, rankContext, resumesWork, type ContextFact } from "./rank.ts";

export interface PersonalQuery {
  userId: number;
  conversationId: number;
  query: string;
  gardenId?: number | null;
  surface: string;
  temporary?: boolean | number;
  personalize?: boolean;
  internal?: boolean;
  gardenOnly?: boolean;
  focus?: string;
}
type Db = Database.Database;
type StoredFact = {
  source: ContextFact["source"];
  ref: string;
  title: string;
  observed?: string;
  detail?: string;
  project?: string;
};
function rows(database: Db, sql: string, ...args: (number | string | null)[]): StoredFact[] {
  try {
    return database.prepare(sql).all(...args) as StoredFact[];
  } catch (err) {
    if (err instanceof Error && /no such table/.test(err.message)) return [];
    throw err;
  }
}
function time(value?: string) {
  if (!value) return 0;
  return Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z") || 0;
}
const safe = (s: string) => !isSensitiveMemoryText(s) && !durableMemoryExclusionReason(s);
export function permitted(input: PersonalQuery) {
  return (
    Number.isSafeInteger(input.userId) &&
    input.userId > 0 &&
    !input.temporary &&
    input.personalize !== false &&
    !input.internal &&
    (["dashboard_terminal", "garden_chat"].includes(input.surface) ||
      (input.surface === "quartz_ai" && Boolean(input.gardenId)))
  );
}

export async function contextSources(input: PersonalQuery, database: Db, root: string) {
  const user = input.userId,
    garden = input.gardenId ?? null;
  const cluster =
    garden === null
      ? null
      : (database.prepare("SELECT memory_scope FROM clusters WHERE id=? AND user_id=?").get(garden, user) as
          | { memory_scope: string }
          | undefined);
  if (garden !== null && !cluster) return [];
  const sealed =
    cluster?.memory_scope === "garden_only" ||
    (garden !== null && (input.gardenOnly === true || input.surface === "quartz_ai"));
  const allowed =
    "(g.id IS NULL OR (g.user_id=? AND (coalesce(g.memory_scope,'')<>'garden_only' OR g.id=?))) AND (?=0 OR g.id=?)";
  const scopeArgs = [user, garden, Number(sealed), garden];
  const result: StoredFact[] = [
    ...rows(
      database,
      "SELECT 'pattern' source,'memory:'||m.id ref,m.content title,'User-confirmed '||m.kind detail,coalesce(m.last_confirmed_at,m.created_at) observed,g.name project FROM durable_memories m LEFT JOIN clusters g ON m.scope='garden' AND cast(g.id AS text)=m.scope_id WHERE m.user_id=? AND m.state='confirmed' AND (m.scope IN ('global','project') OR g.id IS NOT NULL) AND " +
        allowed +
        " ORDER BY observed DESC LIMIT 120",
      user,
      ...scopeArgs,
    ),
    ...rows(
      database,
      "SELECT 'garden' source, '/gardens/'||g.slug ref,g.name title,g.name project FROM clusters g WHERE g.user_id=? AND " +
        allowed +
        " LIMIT 180",
      user,
      ...scopeArgs,
    ),
    ...rows(
      database,
      "SELECT 'file' source,CASE WHEN a.renderer_id IN ('markdown','markdown-file','pdf-file','video-file') THEN '/artifacts/'||a.id||'/'||CASE a.renderer_id WHEN 'pdf-file' THEN 'pdf' WHEN 'video-file' THEN 'video' ELSE 'markdown' END||'?conversationId='||c.public_id ELSE '/dashboard?terminalChat='||c.public_id END ref,a.title, a.updated_at observed,coalesce(g.name,c.title) project,'Version '||a.current_version detail FROM hermes_artifacts a JOIN conversations c ON c.id=a.conversation_id LEFT JOIN clusters g ON g.id=coalesce(a.cluster_id,c.default_garden_id) WHERE a.user_id=? AND c.user_id=? AND c.temporary=0 AND a.status IN ('ready','draft') AND " +
        allowed +
        " ORDER BY a.updated_at DESC LIMIT 180",
      user,
      user,
      ...scopeArgs,
    ),
    ...rows(
      database,
      "SELECT 'chat' source,'/dashboard?terminalChat='||c.public_id ref,c.title,c.updated_at observed,coalesce(g.name,c.title) project,substr(coalesce(json_extract(s.working_state,'$.decisions[#-1]'),'')||' '||coalesce(json_extract(s.working_state,'$.openQuestions[#-1]'),''),1,300) detail FROM conversations c LEFT JOIN clusters g ON g.id=c.default_garden_id LEFT JOIN conversation_memory_state s ON s.conversation_id=c.id WHERE c.user_id=? AND c.id<>? AND c.temporary=0 AND c.buzz_room_id IS NULL AND (c.surface IN ('dashboard_terminal','garden_chat') OR (c.surface='quartz_ai' AND g.id IS NOT NULL)) AND " +
        allowed +
        " ORDER BY c.updated_at DESC LIMIT 150",
      user,
      input.conversationId,
      ...scopeArgs,
    ),
  ];
  if (input.query && /\b(notes?|pages?|documents?|gardens?|worksheet|draft)\b/i.test(input.query)) {
    // Indexing a note does not establish that the user edited it.
    const notes = rows(
      database,
      "SELECT 'note' source,s.page_rel_path ref,s.page_title title,g.name project,g.slug detail FROM clusters g JOIN semantic_chunks s ON s.garden_slug=g.slug WHERE g.user_id=? AND " +
        allowed +
        " GROUP BY g.id,s.page_rel_path ORDER BY max(s.updated_at) DESC LIMIT 200",
      user,
      ...scopeArgs,
    );
    for (const note of notes) {
      const ref = gardenDocumentHref(note.detail!, note.ref);
      if (ref) result.push({ ...note, ref, detail: "Indexed Garden note" });
    }
  }
  if (!sealed) {
    result.push(
      ...rows(
        database,
        "SELECT 'task' source, '/plan?task='||t.id ref,t.title,t.updated_at observed,p.name project,'Open task'||coalesce(' due '||t.due_date,'') detail FROM plan_tasks t JOIN plan_projects p ON p.id=t.project_id AND p.user_id=t.user_id WHERE t.user_id=? AND t.completed_at IS NULL AND p.archived=0 ORDER BY t.updated_at DESC LIMIT 180",
        user,
      ),
      ...rows(
        database,
        "SELECT 'calendar' source,'/plan?view=calendar&event='||e.id ref,e.title,e.updated_at observed,c.name project, CASE WHEN l.source_url IS NULL THEN 'Starts '||e.starts_at ELSE 'Filed from '||l.source_url END detail FROM calendar_events e JOIN calendar_collections c ON c.id=e.calendar_id AND c.user_id=e.user_id LEFT JOIN calendar_source_links l ON l.event_id=e.id AND l.user_id=e.user_id WHERE e.user_id=? ORDER BY e.updated_at DESC LIMIT 200",
        user,
      ),
    );
  }
  const facts = result.map((r) => ({
    source: r.source,
    ref: r.ref,
    title: r.title,
    project: r.project,
    detail: r.detail?.trim(),
    at: time(r.observed),
  }));
  const email = !sealed && database.prepare("SELECT email FROM users WHERE id=?").pluck().get(user);
  return [
    ...facts,
    ...(!sealed && typeof email === "string" ? await browserFacts(root, user, email) : []),
  ].filter((f) => safe([f.title, f.detail, f.ref].join(" ")));
}

export async function resolvePersonalContext(
  input: PersonalQuery,
  options: {
    database?: Db;
    root?: string;
    followup?: boolean;
    now?: number;
    learn?: boolean;
    expand?: (input: PersonalQuery) => Promise<ContextFact[]>;
  } = {},
) {
  const query = input.query.trim().slice(0, 2000);
  const focus = input.focus?.trim().slice(0, 180);
  if (
    !permitted(input) ||
    !query ||
    (!options.followup && !focus && !contextIntent(query)) ||
    isSensitiveMemoryText(query) ||
    durableMemoryExclusionReason(query) === "user_opt_out" ||
    (focus && !safe(focus))
  )
    return [];
  const database = options.database ?? db;
  const facts = await contextSources(input, database, options.root ?? dashboardDataDir());
  const patterns =
    options.learn === false ? [] : reviewedPatterns(database, input.userId, input.gardenId ?? 0, facts);
  const pool: ContextFact[] = [
    ...facts,
    ...patterns
      .filter((p) => !p.refs[0].startsWith("memory:"))
      .map((p) => ({
        source: "pattern" as const,
        title: p.title,
        ref: p.refs[0].startsWith("http") ? p.refs[0] : "pattern:" + p.key,
        detail: p.detail,
        at: p.at,
        project: p.title,
      })),
  ];
  const lookup = focus ? query + " " + focus : query;
  let matches = rankContext(lookup, pool, options.now);
  const needsMore =
    options.followup || !matches.length || (resumesWork(query) && !matches.some((f) => f.source === "file"));
  if (options.expand && !input.gardenId && needsMore) {
    const extra = await options.expand(input).catch(() => []);
    matches = rankContext(
      lookup,
      [...pool, ...extra.filter((f) => safe(f.title + " " + (f.detail ?? "")))],
      options.now,
    );
  }
  return matches;
}

export async function personalTurnPrompt(input: PersonalQuery) {
  if (!permitted(input) || (!input.focus && !contextIntent(input.query))) return "";
  try {
    const { getHermesUserSettings } = await import("../hermes/runtime-store.ts");
    if (getHermesUserSettings(input.userId).composerSwitches.personalize === false) return "";
    const matches = await resolvePersonalContext(input, {
      expand: async (q) => (await import("./secondary.ts")).secondaryContext(q),
    });
    return getHermesUserSettings(input.userId).composerSwitches.personalize === false
      ? ""
      : contextPrompt(matches);
  } catch (error) {
    console.warn("[personal-context] lookup unavailable", error instanceof Error ? error.name : "unknown");
    return "";
  }
}
