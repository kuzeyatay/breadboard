import { randomUUID } from "node:crypto";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import {
  BoltSlidesAuthorError,
  authorDeck,
  planDeck,
  repairDeck,
  type BoltSlidesTarget,
} from "./author.ts";
import { applyDeckSource } from "./apply.ts";
import { buildDeck, type BuildHandle } from "./build.ts";
import { describeBoltSlidesDeck, type BoltSlidesRequest } from "./identity.ts";
import { boltSlidesAvailability } from "./runtime.ts";
import type { DeckPlan, DeckSource } from "./schemas.ts";
import {
  closeBoltSlidesArtifactContext,
  openBoltSlidesArtifactContext,
  saveDeckArtifact,
  type BoltSlidesArtifactContext,
} from "./artifact.ts";
import {
  createWorkspace,
  deckIsBuilt,
  scanArtifacts,
  type BoltSlidesArtifact,
} from "./workspace.ts";

export interface BoltSlidesEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface BoltSlidesTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  request: BoltSlidesRequest;
  conversationPublicId: string;
  status: RunStatus;
  sequence: number;
  events: BoltSlidesEvent[];
  /** Aborts the model calls; the build is stopped through `build`. */
  authoring: AbortController;
  build: BuildHandle | null;
  plan: DeckPlan | null;
  startedAt: number;
  artifacts: BoltSlidesArtifact[];
  error: string;
  terminalResult?: BoltSlidesTerminalResult;
  terminalHandler?: (result: BoltSlidesTerminalResult) => void;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardBoltSlidesRuns?: Map<string, RunState>;
};
const runs = stateGlobal.__breadboardBoltSlidesRuns ?? new Map<string, RunState>();
stateGlobal.__breadboardBoltSlidesRuns = runs;

/**
 * Long enough to outlast a tab switch during a deck that takes minutes.
 *
 * Dropping a run from this map does not take the deck with it: the workspace
 * stays on disk and the deck route reads ownership from it, so an old link
 * still opens the presentation.
 */
const RETENTION_MS = 6 * 60 * 60_000;
/** Two build attempts either side of a repair generation, with room to spare. */
const RUN_TIMEOUT_MS = 60 * 60_000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > 2_000) run.events.splice(0, run.events.length - 2_000);
}

function publish(run: RunState, result: BoltSlidesTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // Transcript persistence stays retryable; the run itself is finished.
  }
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/**
 * Whether the person has stopped this run.
 *
 * A free function rather than an inline comparison: the pipeline below assigns
 * `status` before it awaits, so control-flow analysis inside that closure would
 * narrow the property to the value it was last given and call every later check
 * unreachable — while `abortRun`, which is what actually changes it, runs from a
 * different call entirely.
 */
function isAborted(run: RunState): boolean {
  return run.status === "aborted";
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function refreshArtifacts(run: RunState): void {
  const next = scanArtifacts(run.runId);
  const current = new Map(run.artifacts.map((item) => [item.id, item.modifiedAt]));
  if (
    next.length === run.artifacts.length &&
    next.every((item) => current.get(item.id) === item.modifiedAt)
  ) {
    return;
  }
  run.artifacts = next;
  emit(run, "artifacts.updated", { artifacts: next });
}

function fail(run: RunState, error: string): void {
  if (isAborted(run) || run.terminalResult) return;
  run.status = "failed";
  run.error = error;
  refreshArtifacts(run);
  emit(run, "run.failed", { error, artifacts: run.artifacts });
  publish(run, { outcome: "failed", content: error });
}

/** Where the built deck is served from, for the card and for a new tab. */
export function deckUrl(runId: string): string {
  return `/api/bolt-slides/runs/${runId}/deck/`;
}

/**
 * The message the turn saves.
 *
 * The deck itself is a link and an artifact, so the text does the one thing
 * neither of those does: says what was decided. The model's own summary leads,
 * the slide list follows so a reader can see the arc without opening anything,
 * and the link closes it.
 */
function completionMessage(input: {
  runId: string;
  plan: DeckPlan;
  summary: string;
  rebuilt: boolean;
  artifactSaved: boolean;
}): string {
  const lines = [input.summary.trim(), ""];
  lines.push(`**${input.plan.title}** — ${input.plan.slides.length} slides, ${input.plan.themeFamily} theme.`);
  lines.push("");
  input.plan.slides.forEach((slide, index) => {
    lines.push(`${index + 1}. **${slide.nav}** — ${slide.headline}`);
  });
  lines.push("");
  lines.push(`[Open the deck](${deckUrl(input.runId)})`);
  lines.push("");
  lines.push(
    "Arrow keys or space advance it — builds first, then slides. `S` is the thumbnail rail, "
      + "`G` the grid, `A` annotate, `P` presenter, `F` fullscreen.",
  );
  if (input.rebuilt) {
    lines.push("");
    lines.push("_The first build failed and the deck was repaired once before it compiled._");
  }
  if (!input.artifactSaved) {
    lines.push("");
    lines.push(
      "_The deck could not be filed as an artifact for this chat, so it lives only at the link above._",
    );
  }
  return lines.join("\n");
}

async function runPipeline(
  run: RunState,
  target: BoltSlidesTarget,
  conversationContext: string | undefined,
): Promise<void> {
  emit(run, "stage.changed", { stage: "planning" });
  const plan = await planDeck({ target, request: run.request, conversationContext });
  if (isAborted(run)) return;
  run.plan = plan;
  emit(run, "deck.planned", {
    title: plan.title,
    subtitle: plan.subtitle,
    theme: plan.themeFamily,
    themeRationale: plan.themeRationale,
    arc: plan.arc,
    slides: plan.slides.map((slide) => ({
      nav: slide.nav,
      component: slide.component,
      headline: slide.headline,
    })),
  });

  emit(run, "stage.changed", { stage: "authoring" });
  const authored = await authorDeck({
    target,
    request: run.request,
    plan,
    conversationContext,
  });
  if (isAborted(run)) return;

  let deck: DeckSource = authored.deck;
  let rebuilt = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const written = applyDeckSource(run.runId, deck);
    refreshArtifacts(run);
    emit(run, "deck.authored", {
      files: written.written,
      components: deck.components.map((component) => component.name),
      attempt: attempt + 1,
    });
    if (isAborted(run)) return;

    emit(run, "stage.changed", { stage: "building" });
    const handle = buildDeck(run.runId, (line) => emit(run, "log", { text: line }));
    run.build = handle;
    const result = await handle.promise;
    run.build = null;
    if (isAborted(run)) return;
    if (result.ok && deckIsBuilt(run.runId)) {
      emit(run, "deck.built", { durationMs: result.durationMs, url: deckUrl(run.runId) });
      finish(run, { plan, summary: deck.summary, rebuilt });
      return;
    }
    if (attempt === 1) {
      fail(
        run,
        `The deck did not build. ${result.failure || "Vite reported no cause."}`.trim(),
      );
      return;
    }
    emit(run, "stage.changed", { stage: "repairing" });
    emit(run, "build.failed", { failure: result.failure });
    deck = await repairDeck({
      target,
      previous: authored.messages,
      failure: result.failure,
      log: result.log,
    });
    rebuilt = true;
    if (isAborted(run)) return;
  }
}

function finish(
  run: RunState,
  input: { plan: DeckPlan; summary: string; rebuilt: boolean },
): void {
  if (isAborted(run) || run.terminalResult) return;
  let context: BoltSlidesArtifactContext | null = null;
  let artifactSaved = false;
  if (run.conversationPublicId) {
    context = openBoltSlidesArtifactContext({
      userId: run.userId,
      conversationPublicId: run.conversationPublicId,
      label: input.plan.title,
      agentRunId: run.runId,
    });
    if (context) {
      try {
        const artifact = saveDeckArtifact({
          context,
          runId: run.runId,
          plan: input.plan,
          brief: run.brief,
        });
        artifactSaved = true;
        emit(run, "artifact.saved", { artifactId: artifact.id, title: artifact.title });
      } catch (error) {
        emit(run, "artifact.failed", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      } finally {
        closeBoltSlidesArtifactContext(context, artifactSaved ? "completed" : "failed");
      }
    }
  }
  refreshArtifacts(run);
  const content = completionMessage({
    runId: run.runId,
    plan: input.plan,
    summary: input.summary,
    rebuilt: input.rebuilt,
    artifactSaved,
  });
  run.status = "completed";
  emit(run, "run.completed", {
    title: input.plan.title,
    url: deckUrl(run.runId),
    slides: input.plan.slides.length,
    report: content,
    elapsedSec: (Date.now() - run.startedAt) / 1_000,
    artifacts: run.artifacts,
  });
  publish(run, { outcome: "completed", content });
}

export function startRun(input: {
  userId: number;
  brief: string;
  request: BoltSlidesRequest;
  /** The model the person has selected in chat: it plans and writes the deck. */
  model: string;
  reasoningEffort?: string;
  baseUrl: string;
  /** The chat this was launched from, so the deck's artifact belongs to it. */
  conversationPublicId?: string;
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const runtime = boltSlidesAvailability();
  if (!runtime.available) throw new Error(runtime.reason ?? "Bolt Slides is unavailable.");
  if (!input.request.brief) throw new Error("empty_brief");

  const runId = `bsrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    request: input.request,
    conversationPublicId: input.conversationPublicId ?? "",
    status: "queued",
    sequence: 0,
    events: [],
    authoring: new AbortController(),
    build: null,
    plan: null,
    startedAt: Date.now(),
    artifacts: [],
    error: "",
  };
  runs.set(runId, run);
  createWorkspace({
    runId,
    userId: input.userId,
    brief: input.brief.slice(0, 20_000),
    createdAt: new Date().toISOString(),
  });

  run.status = "running";
  emit(run, "run.queued", { deck: describeBoltSlidesDeck(input.request) });

  const timer = setTimeout(() => {
    if (!run.terminalResult) {
      run.authoring.abort();
      run.build?.kill();
      fail(run, "The deck ran past its time limit and was stopped.");
    }
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  void runPipeline(
    run,
    {
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      signal: run.authoring.signal,
    },
    input.conversationContext,
  )
    .catch((error: unknown) => {
      if (isAborted(run)) return;
      fail(
        run,
        error instanceof BoltSlidesAuthorError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The deck could not be built.",
      );
    })
    .finally(() => clearTimeout(timer));

  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): BoltSlidesEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function liveArtifacts(userId: number, runId: string): BoltSlidesArtifact[] | null {
  const run = runs.get(runId);
  return run?.userId === userId ? run.artifacts : null;
}

export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: BoltSlidesTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  run.authoring.abort();
  run.build?.kill();
  run.build = null;
  refreshArtifacts(run);
  const summary = "The deck was stopped.";
  emit(run, "run.aborted", { summary, artifacts: run.artifacts });
  publish(run, { outcome: "aborted", content: summary });
  return true;
}
