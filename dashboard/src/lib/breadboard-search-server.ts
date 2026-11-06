import type Database from "better-sqlite3";
import { listRoomsForUser, searchMessages } from "./buzz/store.ts";
import { refreshSearchGarden, searchIndexedPages } from "./breadboard-search-index.ts";
import { searchPlaces, searchScore, searchSnippet, searchTerms, sortSearchResults,
  type BreadboardSearchResponse, type SearchType } from "./breadboard-search.ts";

const PER_TYPE = 60;
type Db = Database.Database;
interface Garden { id: number; slug: string; name: string; description: string; user_id: number }
interface Candidate { id: string | number; title: string; body: string; context: string }

// SQL fragments below are static application code; only values are supplied by
// the caller. Escape LIKE metacharacters so '%' never turns into "everything".
function pattern(value: string) { return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`; }
function matching(expression: string, terms: string[]) {
  return terms.map(() => `${expression} LIKE ? ESCAPE '\\'`).join(" AND ");
}

export async function searchBreadboard(db: Db, userId: number, rawQuery: string,
  options: { contentPath?: string; now?: number } = {}): Promise<BreadboardSearchResponse> {
  const query = rawQuery.trim().slice(0, 200);
  const response: BreadboardSearchResponse = { query, results: [], limited: [], unavailable: [] };
  if (!query) return response;
  const terms = searchTerms(query);
  const values = (terms.length ? terms : [query]).map(pattern);
  const sqlTerms = terms.length ? terms : [query];
  const results = response.results;
  const add = (type: SearchType, row: Candidate, href: string, minimumScore = 0) => {
    const score = Math.max(minimumScore, searchScore(row.title, `${row.body} ${row.context}`, query));
    if (score > 0) results.push({ id: `${type}:${row.id}`, type, title: row.title, href,
      context: row.context, snippet: searchSnippet(row.body, query), score });
  };
  const limit = <T,>(type: SearchType, rows: T[]) => {
    if (rows.length > PER_TYPE && !response.limited.includes(type)) response.limited.push(type);
    return rows.slice(0, PER_TYPE);
  };
  const source = (types: SearchType[], read: () => void) => {
    try { read(); } catch (error) {
      console.error(`[breadboard-search] ${types.join(",")} unavailable`, error);
      response.unavailable.push(...types);
    }
  };

  // Apply access rules before touching a garden's files or its cached index.
  const gardens = db.prepare(`SELECT c.id, c.slug, c.name, COALESCE(c.description, '') AS description, c.user_id
    FROM clusters c WHERE c.user_id = ? OR c.visibility = 'public' OR
      (c.visibility = 'organization' AND EXISTS (SELECT 1 FROM organization_members m
        WHERE m.organization_id = c.organization_id AND m.user_id = ?))
  `).all(userId, userId) as Garden[];
  const gardenNames = new Map(gardens.map(garden => [garden.slug, garden.name]));
  for (const garden of gardens) add("garden", { id: garden.slug, title: garden.name,
    body: garden.description, context: garden.user_id === userId ? "Your gardens" : "Shared gardens" },
    `/${garden.user_id === userId ? "gardens" : "garden"}/${encodeURIComponent(garden.slug)}`);
  results.push(...searchPlaces(query));

  source(["chat"], () => {
    const rows = db.prepare(`SELECT c.id, c.public_id, c.title, c.surface, c.legacy_chat_session_id,
      g.slug, COALESCE(g.name, 'Dashboard') AS context,
      COALESCE((SELECT m.content FROM conversation_messages m WHERE m.conversation_id = c.id
        AND m.status <> 'pending' AND ${matching("(c.title || ' ' || m.content)", sqlTerms)}
        ORDER BY m.order_index DESC LIMIT 1), '') AS body
      FROM conversations c LEFT JOIN clusters g ON g.id = c.default_garden_id
      WHERE c.user_id = ? AND c.temporary = 0 AND
        (c.surface = 'dashboard_terminal' OR (c.surface = 'garden_chat' AND g.user_id = ? AND c.legacy_chat_session_id IS NOT NULL))
        AND (${matching("c.title", sqlTerms)} OR EXISTS (SELECT 1 FROM conversation_messages m
          WHERE m.conversation_id = c.id AND m.status <> 'pending' AND ${matching("(c.title || ' ' || m.content)", sqlTerms)}))
      ORDER BY CASE WHEN c.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT ?
    `).all(...values, userId, userId, ...values, ...values, pattern(query), PER_TYPE + 1) as
      (Candidate & { public_id: string; surface: string; slug: string; legacy_chat_session_id: number })[];
    for (const row of limit("chat", rows)) add("chat", row, row.surface === "garden_chat"
      ? `/gardens/${encodeURIComponent(row.slug)}?chat=${row.legacy_chat_session_id}`
      : `/dashboard?terminalChat=${encodeURIComponent(row.public_id)}`);
  });

  source(["task"], () => {
    const rows = db.prepare(`SELECT t.id, t.title, COALESCE(t.description, '') AS body,
      p.name AS context, t.project_id FROM plan_tasks t JOIN plan_projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND p.user_id = ? AND ${matching("(t.title || ' ' || COALESCE(t.description, '') || ' ' || p.name)", sqlTerms)}
      ORDER BY CASE WHEN t.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT ?
    `).all(userId, userId, ...values, pattern(query), PER_TYPE + 1) as (Candidate & { project_id: number })[];
    for (const row of limit("task", rows)) add("task", row, `/plan?project=${row.project_id}&task=${row.id}`);
  });

  source(["event"], () => {
    const rows = db.prepare(`SELECT e.id, e.title, COALESCE(e.description, '') || ' ' || COALESCE(e.location, '') AS body,
      c.name || ' · ' || substr(e.starts_at, 1, 10) AS context, e.starts_at
      FROM calendar_events e JOIN calendar_collections c ON c.id = e.calendar_id
      WHERE e.user_id = ? AND c.user_id = ? AND ${matching("(e.title || ' ' || COALESCE(e.description, '') || ' ' || COALESCE(e.location, ''))", sqlTerms)}
      ORDER BY CASE WHEN e.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, e.starts_at DESC LIMIT ?
    `).all(userId, userId, ...values, pattern(query), PER_TYPE + 1) as (Candidate & { starts_at: string })[];
    for (const row of limit("event", rows)) add("event", row,
      `/plan?view=calendar&calendarView=day&date=${encodeURIComponent(row.starts_at.slice(0, 10))}&event=${row.id}`);
  });

  source(["file"], () => {
    const rows = db.prepare(`SELECT a.id, a.title, a.filename AS body, c.title AS context,
      a.kind, a.renderer_id, a.current_version, c.public_id, c.surface, c.legacy_chat_session_id, g.slug
      FROM hermes_artifacts a JOIN conversations c ON c.id = a.conversation_id
      LEFT JOIN clusters g ON g.id = c.default_garden_id
      WHERE a.user_id = ? AND c.user_id = ? AND c.temporary = 0 AND a.status IN ('ready', 'draft', 'archived')
        AND ${matching("(a.title || ' ' || a.filename)", sqlTerms)}
      ORDER BY CASE WHEN a.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, a.updated_at DESC LIMIT ?
    `).all(userId, userId, ...values, pattern(query), PER_TYPE + 1) as (Candidate & {
      kind: string; renderer_id: string; current_version: number; public_id: string; surface: string;
      legacy_chat_session_id: number | null; slug: string | null;
    })[];
    for (const row of limit("file", rows)) {
      const viewer = row.renderer_id === "pdf-file" ? "pdf" : row.renderer_id === "video-file" ? "video" :
        ["markdown", "markdown-file"].includes(row.renderer_id) ? "markdown" : null;
      const href = viewer ? `/artifacts/${encodeURIComponent(String(row.id))}/${viewer}?conversationId=${encodeURIComponent(row.public_id)}&version=${row.current_version}` :
        row.surface === "garden_chat" && row.slug && row.legacy_chat_session_id !== null
          ? `/gardens/${encodeURIComponent(row.slug)}?chat=${row.legacy_chat_session_id}`
          : `/dashboard?terminalChat=${encodeURIComponent(row.public_id)}`;
      add("file", row, href);
    }
  });

  source(["room"], () => {
    for (const room of listRoomsForUser(db, userId, { includeArchived: true })) {
      add("room", { id: room.publicId, title: room.name, body: room.topic, context: "Organization" },
        `/buzz?room=${encodeURIComponent(room.publicId)}`);
    }
    const messages = searchMessages(db, userId, query, PER_TYPE + 1);
    for (const hit of limit("room", messages)) add("room", { id: `message:${hit.message.id}`,
      title: hit.roomName, body: hit.message.body, context: "Room message" },
      `/buzz?room=${encodeURIComponent(hit.roomPublicId)}&thread=${hit.message.parentId ?? hit.message.id}`);
  });

  const root = options.contentPath ?? process.env.QUARTZ_CONTENT_PATH;
  if (root && gardens.length && terms.length) {
    const ready: string[] = [];
    // Keep disk concurrency bounded even for accounts with many gardens.
    for (let index = 0; index < gardens.length; index += 2) {
      await Promise.all(gardens.slice(index, index + 2).map(async garden => {
        try { await refreshSearchGarden(db, root, garden.slug, options.now, `${garden.id}:${garden.user_id}`); ready.push(garden.slug); }
        catch (error) {
          console.error("[breadboard-search] Garden index unavailable", garden.id, error);
          for (const type of ["note", "file"] as const) if (!response.unavailable.includes(type)) response.unavailable.push(type);
        }
      }));
    }
    for (const kind of ["note", "file"] as const) {
      source([kind], () => {
        for (const row of limit(kind, searchIndexedPages(db, root, ready, terms, kind, PER_TYPE + 1))) {
          add(kind, { id: `${row.garden}/${row.path}`, title: row.title, body: row.excerpt,
            context: `${gardenNames.get(row.garden)} · ${row.path.replace(/\.md$/i, "")}` },
          `/garden/${encodeURIComponent(row.garden)}?note=${encodeURIComponent(row.path.replace(/\.md$/i, ""))}`, 5);
        }
      });
    }
  } else if (!root && gardens.length) response.unavailable.push("note", "file");
  response.unavailable = [...new Set(response.unavailable)];
  response.results = sortSearchResults(results);
  return response;
}
