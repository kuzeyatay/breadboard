// The heartbeat that keeps memory current without anyone asking it to.
//
// Scheduled chats already run on a tick, but their target is a conversation:
// something gets said, and if nobody reads it, nothing has changed. This one
// writes into memory instead, so the context is there before the question is
// asked rather than assembled after it.
//
// What it derives is deliberately small and deliberately literal. Every fact
// here is something countable in the user's own local data — a meeting that
// actually recurs, a project that actually has work in it, a person who
// actually appears on the calendar every week. Nothing is inferred, nothing is
// characterised, and nothing is written that the user could not verify by
// looking at the same screen the number came from. An automatic writer that
// editorialises is one you have to audit; one that only counts is one you can
// trust and ignore.
//
// Everything lands as a candidate at low confidence, into the same curation
// surface as any other memory, keyed so the next pass updates the row rather
// than adding a second copy of a changed number.

import type Database from "better-sqlite3";

import db from "../db.ts";
import { saveDurableMemory } from "../conversations/memory.ts";
import { ensureFreshTree } from "./maintain.ts";

/** How often the heartbeat runs, matching OpenHuman's twenty-minute cadence. */
export const AUTOFETCH_INTERVAL_MS = 20 * 60_000;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AutofetchResult {
  userId: number;
  written: number;
  facts: string[];
}

interface DerivedFact {
  key: string;
  content: string;
}

function weeklyMeetings(userId: number, database: Database.Database): DerivedFact[] {
  const rows = database
    .prepare(
      `SELECT title, starts_at, recurrence FROM calendar_events
       WHERE user_id = ? AND recurrence = 'weekly' AND parent_event_id IS NULL
       ORDER BY starts_at DESC LIMIT 12`,
    )
    .all(userId) as Array<{ title: string; starts_at: string; recurrence: string }>;

  return rows.flatMap((row) => {
    const when = new Date(row.starts_at);
    if (Number.isNaN(when.getTime())) return [];
    const title = row.title.trim();
    if (!title) return [];
    const time = row.starts_at.slice(11, 16);
    return [
      {
        key: `autofetch:calendar:weekly:${title.toLowerCase()}`,
        content: `"${title}" is a weekly commitment, on ${DAYS[when.getDay()]}${
          time ? ` at ${time}` : ""
        }.`,
      },
    ];
  });
}

function frequentPeople(userId: number, database: Database.Database): DerivedFact[] {
  const rows = database
    .prepare(
      `SELECT a.name AS name, a.email AS email, COUNT(*) AS n
       FROM calendar_event_attendees a
       JOIN calendar_events e ON e.id = a.event_id
       WHERE e.user_id = ? AND e.starts_at >= datetime('now', '-90 days')
       GROUP BY COALESCE(NULLIF(a.name, ''), a.email)
       HAVING n >= 4
       ORDER BY n DESC LIMIT 8`,
    )
    .all(userId) as Array<{ name: string | null; email: string | null; n: number }>;

  return rows.flatMap((row) => {
    const who = (row.name || row.email || "").trim();
    if (!who) return [];
    return [
      {
        key: `autofetch:calendar:person:${who.toLowerCase()}`,
        content: `${who} has been in ${row.n} of the user's meetings in the last 90 days.`,
      },
    ];
  });
}

function activeProjects(userId: number, database: Database.Database): DerivedFact[] {
  const rows = database
    .prepare(
      `SELECT p.name AS name,
              COUNT(t.id) AS open_tasks,
              SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now')
                       THEN 1 ELSE 0 END) AS overdue
       FROM plan_projects p
       LEFT JOIN plan_tasks t
         ON t.project_id = p.id AND t.completed_at IS NULL
       WHERE p.user_id = ? AND p.archived = 0
       GROUP BY p.id
       HAVING open_tasks > 0
       ORDER BY open_tasks DESC LIMIT 8`,
    )
    .all(userId) as Array<{ name: string; open_tasks: number; overdue: number }>;

  return rows.flatMap((row) => {
    const name = row.name.trim();
    if (!name) return [];
    const overdue = Number(row.overdue ?? 0);
    return [
      {
        key: `autofetch:plan:project:${name.toLowerCase()}`,
        content:
          `The "${name}" project has ${row.open_tasks} open task${row.open_tasks === 1 ? "" : "s"}` +
          (overdue > 0 ? `, ${overdue} of them past due.` : "."),
      },
    ];
  });
}

function organisations(userId: number, database: Database.Database): DerivedFact[] {
  const rows = database
    .prepare(
      `SELECT organization AS org, COUNT(*) AS n FROM contacts
       WHERE user_id = ? AND organization IS NOT NULL AND TRIM(organization) <> ''
       GROUP BY lower(organization) HAVING n >= 3
       ORDER BY n DESC LIMIT 5`,
    )
    .all(userId) as Array<{ org: string; n: number }>;

  return rows.flatMap((row) => {
    const org = row.org.trim();
    if (!org) return [];
    return [
      {
        key: `autofetch:contacts:org:${org.toLowerCase()}`,
        content: `The user knows ${row.n} people at ${org}.`,
      },
    ];
  });
}

/** Every derivation, each isolated so one broken source cannot stop the rest. */
const SOURCES: Array<{
  name: string;
  derive: (userId: number, database: Database.Database) => DerivedFact[];
}> = [
  { name: "calendar.weekly", derive: weeklyMeetings },
  { name: "calendar.people", derive: frequentPeople },
  { name: "plan.projects", derive: activeProjects },
  { name: "contacts.organisations", derive: organisations },
];

/**
 * Derive and store what the local sources currently say, for one user.
 *
 * Facts land as candidates rather than confirmed: they are the machine's
 * reading of the user's data, not the user's own word, and the difference
 * should be visible in the curation panel. A key per fact means a changed
 * count updates its row instead of leaving both numbers in memory.
 */
export function autofetchForUser(
  userId: number,
  database: Database.Database = db,
): AutofetchResult {
  const facts: DerivedFact[] = [];
  for (const source of SOURCES) {
    try {
      facts.push(...source.derive(userId, database));
    } catch {
      // A source that is not installed, or whose table has moved on, is not a
      // reason to skip the ones that still work.
    }
  }

  let written = 0;
  for (const fact of facts) {
    try {
      const saved = saveDurableMemory(
        {
          userId,
          content: fact.content,
          kind: "project_fact",
          scope: "global",
          scopeId: null,
          memoryKey: fact.key,
          state: "candidate",
          // Low enough that a derived count never outranks something the user
          // actually said, high enough to surface when nothing else matches.
          confidence: 0.45,
          salience: 0.4,
          // A changed number is a new reading of the same fact, not a new
          // fact: rewrite the row rather than retiring it. Superseding here
          // produced one dead row per tick — fifteen copies of a task count
          // in a week — and every one of them a line in the curation panel.
          onKeyConflict: "replace",
        },
        database,
      );
      if (saved) written += 1;
    } catch {
      // One rejected fact (an exclusion rule, a length cap) is not a failed pass.
    }
  }

  // The churn from before in-place updates, and anything a future path leaves
  // behind. Only rows this heartbeat wrote: the prefix is its provenance, and
  // a superseded row the user stated is history that belongs to them.
  const purged = purgeSupersededAutofetchRows(userId, database);

  if (written > 0 || purged > 0) ensureFreshTree(userId, database);
  return { userId, written, facts: facts.map((fact) => fact.content) };
}

/** Delete retired rows that only this heartbeat could have written. */
export function purgeSupersededAutofetchRows(
  userId: number,
  database: Database.Database = db,
): number {
  try {
    return database
      .prepare(
        `DELETE FROM durable_memories
         WHERE user_id = ? AND state = 'superseded' AND memory_key LIKE 'autofetch:%'`,
      )
      .run(userId).changes;
  } catch {
    return 0;
  }
}

/** Run one pass for every account that has memory to keep current. */
export function runMemoryAutofetch(database: Database.Database = db): AutofetchResult[] {
  try {
    const users = database
      .prepare(`SELECT id FROM users ORDER BY id`)
      .all() as Array<{ id: number }>;
    return users.map((user) => autofetchForUser(user.id, database));
  } catch {
    return [];
  }
}
