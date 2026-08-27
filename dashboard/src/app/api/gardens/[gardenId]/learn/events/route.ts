import { NextResponse } from "next/server";
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { getRuntimeV2LearnEventCompatibility } from "@/lib/learn-operation-runtime-v2";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

interface GardenEvent {
  type?: string;
  at?: string;
  timestamp?: string;
  jobId?: string;
  [key: string]: unknown;
}

const MAX_EVENTS = 400;
const MAX_REASONING_CHARS = 8000;
const MAX_OUTPUT_CHARS = 4000;

/** The council ledger lives at <repo>/.breadboard/council-runs (or
 * $COUNCIL_LEDGER_DIR). QUARTZ_CONTENT_PATH is <repo>/quartz/content. */
function councilRunsDir(contentPath: string): string {
  const configured = (process.env.COUNCIL_LEDGER_DIR ?? "").trim();
  if (configured) return configured;
  const repoRoot = path.dirname(path.dirname(path.resolve(contentPath)));
  return path.join(repoRoot, ".breadboard", "council-runs");
}

function clip(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}

interface CouncilRunDetail {
  councilMode?: string;
  taskType?: string;
  reasoning?: string;
  output?: string;
  candidateReasonings?: string[];
  error?: string;
}

/** Read one council run's produced content + reasoning ("thinking") trace. */
function readCouncilRun(dir: string, runId: string): CouncilRunDetail | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, `${runId}.json`), "utf-8");
  } catch {
    return null;
  }
  let run: Record<string, unknown>;
  try {
    run = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const candidates = Array.isArray(run.candidates) ? (run.candidates as Array<Record<string, unknown>>) : [];
  const reasonings: string[] = [];
  for (const candidate of candidates) {
    const metadata = candidate.metadata as Record<string, unknown> | undefined;
    const reasoning = metadata && typeof metadata.reasoning === "string" ? metadata.reasoning : "";
    if (reasoning.trim()) reasonings.push(reasoning.trim());
  }
  const diagnostics = run.diagnostics as Record<string, unknown> | undefined;
  return {
    councilMode: typeof run.councilMode === "string" ? run.councilMode : undefined,
    taskType: typeof run.taskType === "string" ? run.taskType : undefined,
    reasoning: reasonings.length > 0 ? clip(reasonings.join("\n\n— next council seat —\n\n"), MAX_REASONING_CHARS) : undefined,
    output: clip(run.finalAnswer ?? candidates[0]?.content, MAX_OUTPUT_CHARS) || undefined,
    candidateReasonings: reasonings.length > 1 ? reasonings.map((r) => clip(r, MAX_REASONING_CHARS)) : undefined,
    error: diagnostics && typeof diagnostics.error === "string" ? diagnostics.error : undefined,
  };
}

/** Human-readable one-liner for a raw garden event. Unknown event types fall
 * back to "type — compact details" so nothing internal is hidden. */
function eventLine(event: GardenEvent): string {
  const type = String(event.type ?? "event");
  const details: string[] = [];
  for (const key of [
    "taskType",
    "councilMode",
    "pageId",
    "visualId",
    "figureId",
    "learningMapId",
    "textbookVersionId",
    "unitCount",
    "assignmentCount",
    "pageCount",
    "councilRunId",
    "reason",
    "error",
  ]) {
    const value = event[key];
    if (value === undefined || value === null || value === "") continue;
    details.push(`${key}=${String(value)}`);
  }
  const labels: Record<string, string> = {
    learn_planning_started: "Planning started",
    learn_regeneration_source_map_cleared: "Previous source map cleared",
    learn_source_map_created: "Council finished the source map",
    learn_source_map_fallback: "Source map fell back to deterministic planning",
    learn_scope_contract_created: "Council finished the scope contract",
    learn_scope_contract_fallback: "Scope contract fell back to deterministic planning",
    learn_planning_transport_ambiguous: "Planning transport ended with an ambiguous outcome",
    learn_learning_unit_contract_created: "Council finished the Learning Unit Contract",
    learn_learning_map_created: "Learning map created",
    learn_learning_spine_fallback: "Learning spine fell back to deterministic planning",
    learn_learning_spine_retry_fallback: "Learning spine retry timed out",
    learn_awaiting_confirmation: "Awaiting learning-map confirmation",
    learn_learning_map_confirmed: "Learning map confirmed",
    learn_generation_started: "Lesson generation started",
    learn_page_started: "Writing lesson page",
    learn_page_written: "Lesson page written",
    learn_visual_created: "Interactive visual created",
    learn_visual_skipped: "Interactive visual skipped",
    learn_source_figure_linked: "Source figure linked to a visual",
    learn_visual_index_pruned: "Stale visual index entries pruned",
    learn_export_finalized: "Export finalized and validated",
    learn_humanizer_completed: "Finished lesson prose rewrite",
    learn_generation_completed: "Lesson generation completed",
    learn_failed: "Learn failed",
    learn_cancelled: "Learn cancelled",
  };
  const label = labels[type] ?? type;
  return details.length > 0 ? `${label} (${details.join(", ")})` : label;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId")?.trim() || "";
    const runtimeCompatibility = await getRuntimeV2LearnEventCompatibility({
      userId,
      gardenId: cluster.slug,
      contentPath,
      ...(jobId ? { requestedJobId: jobId } : {}),
    });
    if (runtimeCompatibility && runtimeCompatibility.legacyJobId === null) {
      return NextResponse.json({ events: runtimeCompatibility.events.slice(-MAX_EVENTS) });
    }
    const legacyJobId = jobId
      ? runtimeCompatibility?.legacyJobId ?? jobId
      : "";

    const eventsPath = path.join(contentPath, cluster.slug, ".breadboard", "events.jsonl");
    let raw = "";
    try {
      raw = fs.readFileSync(eventsPath, "utf-8");
    } catch {
      return NextResponse.json({ events: [] });
    }

    const includeThinking = url.searchParams.get("thinking") !== "0";
    const runsDir = councilRunsDir(contentPath);

    const lines = raw.split(/\r?\n/).filter(Boolean);
    const events: Array<{
      at: string;
      type: string;
      line: string;
      jobId?: string;
      councilRunId?: string;
      detail?: CouncilRunDetail | null;
    }> = [];
    // Newest lines matter; parse from the tail.
    for (const line of lines.slice(-2000)) {
      let parsed: GardenEvent;
      try {
        parsed = JSON.parse(line) as GardenEvent;
      } catch {
        continue;
      }
      const type = String(parsed.type ?? "");
      if (!type.startsWith("learn_")) continue;
      if (legacyJobId && String(parsed.jobId ?? "") !== legacyJobId) continue;
      const councilRunId = typeof parsed.councilRunId === "string" ? parsed.councilRunId : undefined;
      events.push({
        at: String(parsed.at ?? parsed.timestamp ?? ""),
        type,
        line: eventLine(parsed),
        jobId: typeof parsed.jobId === "string" ? parsed.jobId : undefined,
        councilRunId,
      });
    }

    const recent = events.slice(-MAX_EVENTS);
    // Attach the council thinking/output only for the most recent runs with an
    // id, so a long log stays cheap to serve.
    if (includeThinking) {
      const withRun = recent.filter((event) => event.councilRunId);
      for (const event of withRun.slice(-12)) {
        event.detail = readCouncilRun(runsDir, event.councilRunId as string);
      }
    }

    return NextResponse.json({ events: recent });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
