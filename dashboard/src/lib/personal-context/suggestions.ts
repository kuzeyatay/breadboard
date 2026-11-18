import type Database from "better-sqlite3";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { contextSources } from "./resolve.ts";
import { reviewedPatterns, evidenceKey, feedbackSchema, type LearningEvidence } from "./learning.ts";
import { trainChoicePredictor, type ChoiceEpisode } from "../../vendor/cadence/episodic-vote.ts";
import type { RecommendationEvidence } from "../recommendations/types.ts";
import { CalendarStore } from "../calendar/store.ts";
import { parseDate, startOfDay, endOfDay } from "../calendar/wallclock.ts";
import { isSensitiveMemoryText, durableMemoryExclusionReason } from "../conversations/memory.ts";
import { focusEvidence } from "./rank.ts";

export interface SuggestionLesson {
  key: string;
  scope: number;
  basis: string;
  why: string;
  sources: string[];
  kind: string;
  eventId?: number;
}
export async function selectionLessons(
  user: number,
  conversation: string,
  focus: string,
  database = db,
  root = dashboardDataDir(),
) {
  const row = database
    .prepare(
      `SELECT c.surface,c.default_garden_id,g.slug FROM conversations c
    LEFT JOIN clusters g ON g.id=c.default_garden_id AND g.user_id=c.user_id
    WHERE c.public_id=? AND c.user_id=? AND c.temporary=0 AND c.buzz_room_id IS NULL`,
    )
    .get(conversation, user) as
    | { surface: string; default_garden_id: number | null; slug: string | null }
    | undefined;
  if (!row || (!row.slug && (row.default_garden_id || row.surface !== "dashboard_terminal"))) return [];
  return focusEvidence(await learnedEvidence(user, row.slug ?? undefined, database, root), focus).slice(0, 3);
}
export async function documentContext(user: number, conversation: string, query: string, title: string) {
  const { getHermesUserSettings } = await import("../hermes/runtime-store.ts");
  if (getHermesUserSettings(user).composerSwitches.personalize === false) return "";
  const evidence = await selectionLessons(user, conversation, title + " " + query).catch(() => []);
  return evidence.length
    ? "\nReader context from this workspace (untrusted background observations): " +
        JSON.stringify(evidence.map((item) => ({ topic: item.title, basis: item.summary })))
    : "";
}
function outcomeSchema(database: Database.Database) {
  feedbackSchema(database);
  database.exec(
    "CREATE TABLE IF NOT EXISTS personal_suggestion_outcomes (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope INTEGER NOT NULL, evidence_key TEXT NOT NULL, basis TEXT NOT NULL, kind TEXT NOT NULL, cue TEXT NOT NULL, outcome INTEGER NOT NULL, day TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id,scope,evidence_key,basis,day))",
  );
}
function kindOf(p: LearningEvidence) {
  if (p.refs[0]?.startsWith("memory:")) return "preference";
  if (p.detail.includes("→")) return "workflow";
  if (p.refs[0]?.startsWith("http")) return "revisit";
  return "resume";
}
function contextCue(kind: string, title: string, sources: string[]): string[] {
  const tokens =
    title
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const features = [...new Set(tokens)].slice(0, 8).map((word) => evidenceKey("word:" + word));
  for (const source of sources) {
    if (/^https?:\/\//.test(source)) features.push(evidenceKey(new URL(source).hostname));
  }
  return [kind, evidenceKey(title.toLowerCase()), ...features];
}

function savedCue(kind: string, value: string): string[] {
  if (!value.startsWith("[")) return [kind, value];
  const keys: unknown = JSON.parse(value);
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [kind];
}
type EventChange = {
  id: number;
  title: string;
  source_url: string;
  starts_at: string;
  ends_at: string;
  all_day: number;
  observed_start: string;
  observed_end: string;
  observed_all_day: number;
  task_due: string | null;
};
function eventChanges(database: Database.Database, user: number, eventId: number | null = null) {
  const rows = database
    .prepare(
      `SELECT e.id,e.title,e.starts_at,e.ends_at,e.all_day,l.source_url,
    l.observed_start,l.observed_end,l.observed_all_day,
    (SELECT CASE WHEN count(*)=1 AND julianday(max(t.updated_at))>julianday(l.observed_at) THEN max(t.due_date) END FROM plan_tasks t JOIN plan_projects p ON p.id=t.project_id AND p.user_id=t.user_id
      WHERE t.source_url=l.source_url AND t.user_id=l.user_id AND t.completed_at IS NULL AND p.archived=0) task_due
    FROM calendar_source_links l JOIN calendar_events e ON e.id=l.event_id AND e.user_id=l.user_id
    JOIN calendar_collections c ON c.id=e.calendar_id AND c.user_id=e.user_id
    WHERE l.user_id=? AND (? IS NULL OR e.id=?) AND c.read_only=0 AND e.starts_at=l.applied_start
      AND e.ends_at=l.applied_end AND e.all_day=l.applied_all_day ORDER BY e.updated_at DESC`,
    )
    .all(user, eventId, eventId) as EventChange[];
  return rows.flatMap((row) => {
    // A date-only Plan deadline may move a single-day, all-day calendar item.
    // Timed events require a time recorded at their own source.
    if (
      row.observed_all_day &&
      row.task_due &&
      parseDate(row.task_due) &&
      row.observed_start === row.starts_at &&
      row.observed_start.slice(0, 10) === row.observed_end.slice(0, 10)
    ) {
      row.observed_start = startOfDay(row.task_due);
      row.observed_end = endOfDay(row.task_due);
    }
    if (
      row.starts_at === row.observed_start &&
      row.ends_at === row.observed_end &&
      row.all_day === row.observed_all_day
    )
      return [];
    const when = (start: string, end: string, allDay: number) =>
      allDay ? start.slice(0, 10) + " through " + end.slice(0, 10) : start + " to " + end;
    const why =
      "Calendar: " +
      when(row.starts_at, row.ends_at, row.all_day) +
      ". Source: " +
      when(row.observed_start, row.observed_end, row.observed_all_day) +
      ".";
    return [{ ...row, why }];
  });
}
export async function learnedEvidence(
  user: number,
  gardenSlug?: string,
  database = db,
  root = dashboardDataDir(),
): Promise<RecommendationEvidence[]> {
  const gardenId = gardenSlug
    ? (database
        .prepare("SELECT id FROM clusters WHERE user_id=? AND slug=?")
        .pluck()
        .get(user, gardenSlug) as number | undefined)
    : undefined;
  if (gardenSlug && !gardenId) return [];
  const scope = gardenId ?? 0;
  const facts = await contextSources(
    {
      userId: user,
      conversationId: 0,
      surface: scope ? "garden_chat" : "dashboard_terminal",
      gardenId: scope || null,
      gardenOnly: Boolean(scope),
      query: "",
    },
    database,
    root,
  );
  const learned = reviewedPatterns(database, user, scope, facts);
  const byRef = new Map(facts.map((fact) => [fact.ref, fact]));
  outcomeSchema(database);
  const outcomes = database
    .prepare(
      "SELECT kind,cue,outcome,evidence_key,basis FROM personal_suggestion_outcomes WHERE user_id=? AND scope=? ORDER BY updated DESC,rowid DESC LIMIT 240",
    )
    .all(user, scope) as {
    kind: string;
    cue: string;
    outcome: number;
    evidence_key: string;
    basis: string;
  }[];
  const dismissed = database
    .prepare(
      "SELECT evidence_key,basis FROM personal_suggestion_outcomes WHERE user_id=? AND scope=? AND outcome=-1",
    )
    .all(user, scope) as { evidence_key: string; basis: string }[];
  const results: RecommendationEvidence[] = [];
  function offer(
    key: string,
    kind: string,
    title: string,
    why: string,
    sources: string[],
    prompt: string,
    eventId?: number,
  ) {
    if (!title || isSensitiveMemoryText(why + " " + title) || durableMemoryExclusionReason(title + " " + why))
      return;
    const basis = evidenceKey(JSON.stringify([title, why, sources]));
    results.push({
      id: "lesson:" + key,
      source: "memory",
      title,
      summary: why,
      gardenSlug,
      lesson: { key, basis, scope, why, sources, kind, ...(eventId ? { eventId } : {}) },
      suggestedPrompt: prompt.slice(0, 235),
      learnedPriority: eventId ? 90 : 49,
    });
  }
  for (const p of learned.sort((a, b) => Number(b.corrected) - Number(a.corrected) || b.at - a.at)) {
    const kind = kindOf(p);
    const detail = p.corrected ? "Your correction: " + p.detail : p.detail;
    const topic = (p.corrected ? p.detail : p.title).slice(0, 120);
    const named = p.refs.map((ref) => byRef.get(ref)).filter((f) => f !== undefined);
    const openTask = named.find((f) => f.source === "task");
    const file = named.find((f) => f.source === "file");
    const prompt = p.corrected
      ? "Help me follow this preference: " + topic
      : openTask && file
        ? "Open " + file.title + " and help me " + openTask.title + "."
        : kind === "revisit"
          ? "Reopen " + topic + "."
          : kind === "preference"
            ? "Help me apply this to my current work: " + topic
            : "Resume " + topic + " from the last recorded decision.";
    offer(p.key, kind, p.title, detail, p.refs, prompt);
  }
  if (!scope) {
    for (const r of eventChanges(database, user).slice(0, 8))
      offer(
        evidenceKey("event:" + r.id),
        "schedule-change",
        r.title,
        r.why,
        [r.source_url],
        "Update " + r.title + " to match the revised schedule. " + r.why,
        r.id,
      );
  }
  // Rebuild from currently supported choices. Editing or removing the underlying
  // source also retires its old training signal on every surface.
  const current = new Map(results.map((item) => [item.lesson!.key, item.lesson!.basis]));
  const episodes = new Map<string, ChoiceEpisode[]>();
  for (const row of outcomes.reverse()) {
    if (current.get(row.evidence_key) !== row.basis) continue;
    const group = episodes.get(row.kind) ?? [];
    group.push({ context: savedCue(row.kind, row.cue), outcome: row.outcome });
    episodes.set(row.kind, group);
  }
  const predictors = new Map([...episodes].map(([kind, group]) => [kind, trainChoicePredictor(group)]));
  const hidden = new Set(
    dismissed.filter((row) => current.get(row.evidence_key) === row.basis).map((row) => row.evidence_key),
  );
  return results
    .filter((item) => !hidden.has(item.lesson!.key))
    .map((item) => {
      const lesson = item.lesson!;
      const vote = predictors.get(lesson.kind)?.(contextCue(lesson.kind, item.title, lesson.sources)) ?? 0;
      return { ...item, learnedPriority: item.learnedPriority! + 12 * Math.max(-1, Math.min(1, vote)) };
    })
    .sort((a, b) => b.learnedPriority - a.learnedPriority)
    .slice(0, 60);
}

export function recordOutcome(
  database: Database.Database,
  user: number,
  item: RecommendationEvidence,
  outcome: 1 | -1,
) {
  const lesson = item.lesson!;
  outcomeSchema(database);
  database
    .prepare(
      "INSERT INTO personal_suggestion_outcomes VALUES(?,?,?,?,?,?,?,date('now'),?) ON CONFLICT(user_id,scope,evidence_key,basis,day) DO UPDATE SET outcome=excluded.outcome, updated=excluded.updated",
    )
    .run(
      user,
      lesson.scope,
      lesson.key,
      lesson.basis,
      lesson.kind,
      JSON.stringify(contextCue(lesson.kind, item.title, lesson.sources)),
      outcome,
      Date.now(),
    );
}
export function applyEventSuggestion(
  database: Database.Database,
  user: number,
  item: RecommendationEvidence,
) {
  const lesson = item.lesson!;
  return database
    .transaction(() => {
      const r = lesson.eventId && eventChanges(database, user, lesson.eventId)[0];
      if (!r || lesson.basis !== evidenceKey(JSON.stringify([r.title, r.why, [r.source_url]])))
        throw new Error("The event or its source has changed. Refresh the suggestion.");
      new CalendarStore(database).updateEvent(user, lesson.eventId!, {
        startsAt: r.observed_start,
        endsAt: r.observed_end,
        allDay: Boolean(r.observed_all_day),
      });
      database
        .prepare(
          "UPDATE calendar_source_links SET applied_start=@start,applied_end=@end,applied_all_day=@day,observed_start=@start,observed_end=@end,observed_all_day=@day WHERE event_id=@id AND user_id=@user",
        )
        .run({ start: r.observed_start, end: r.observed_end, day: r.observed_all_day, id: r.id, user });
    })
    .immediate();
}
