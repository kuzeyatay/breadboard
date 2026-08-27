// The full catalogue/tool loop runs only inside a fresh Runtime V2 worker.
// Public controls at the bottom are durable Next compatibility facades.

import { randomUUID } from "node:crypto";
import { promptWithContext } from "../conversations/agent-context.ts";
import {
  loadOpenGymCatalog,
  searchOpenGymCatalog,
  type OpenGymCatalogMatch,
  type OpenGymExercise,
} from "./catalog.ts";
import { isExerciseTechniqueRequest, isWorkoutProgramRequest } from "./identity.ts";
import { attachOpenGymAnimations } from "./result.ts";
import {
  mergeOpenGymProfile,
  readOpenGymState,
  recordOpenGymRun,
  saveOpenGymProgram,
  type OpenGymProfile,
  type OpenGymState,
} from "./state.ts";
import { publishOpenGymProgram } from "./artifact.ts";

export interface OpenGymEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  status: RunStatus;
  sequence: number;
  events: OpenGymEvent[];
  aborted: boolean;
  controller: AbortController;
  exercises: Map<string, OpenGymExercise>;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardOpenGymRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardOpenGymRuns ?? new Map<string, RunState>();
globalRuns.__breadboardOpenGymRuns = runs;

const RETENTION_MS = 30 * 60 * 1_000;
const MAX_EVENTS = 2_000;
const MODEL_TIMEOUT_MS = 300_000;

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_exercises",
      description: "Search openGym's registered exercise catalogue. Call this before naming or prescribing exercises.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Movement, muscle, body part, or goal to search." },
          equipment: { type: "string", description: "Optional equipment constraint." },
          bodyPart: { type: "string", description: "Optional body-part constraint." },
          limit: { type: "number", description: "1-12 results." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_training_state",
      description: "Read the user's persistent openGym profile, saved programs, and recent run history.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_training_profile",
      description: "Persist useful training preferences the user explicitly provided so future openGym runs remember them.",
      parameters: {
        type: "object",
        properties: {
          goals: { type: "array", items: { type: "string" } },
          experience: { type: "string" },
          equipment: { type: "array", items: { type: "string" } },
          daysPerWeek: { type: "number" },
          sessionMinutes: { type: "number" },
          constraints: { type: "array", items: { type: "string" } },
          preferences: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
] as const;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function splitReasoning(content: string): { thinking: string; answer: string } {
  const thinking: string[] = [];
  const answer = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, body: string) => {
    thinking.push(body.trim());
    return "";
  }).replace(/<think>[\s\S]*$/i, (match) => {
    thinking.push(match.slice(7).trim());
    return "";
  }).trim();
  return { thinking: thinking.join("\n"), answer };
}

function systemPrompt(catalogCount: number, state: OpenGymState): string {
  const persistentContext = JSON.stringify({
    profile: state.profile,
    programs: state.programs.map((program) => ({
      id: program.id,
      title: program.title,
      exerciseIds: program.exerciseIds,
      updatedAt: program.updatedAt,
    })),
    recentRuns: state.recentRuns.slice(-10),
  });
  return `You are openGym, Breadboard's persistent training-program and exercise-technique agent.

You work from the cloned openGym catalogue of ${catalogCount.toLocaleString()} registered exercises. Always call search_exercises before naming or prescribing an exercise. Use the exact exercise name returned by the tool; animations are attached from those results. Call get_training_state before making or revising a program. Save explicit stable preferences with save_training_profile. Do not invent an exercise that is absent from the catalogue.

For a program, give a usable Markdown plan: assumptions, weekly schedule, warm-up, exact exercises with sets/reps or time, rest, effort guidance, progression, and substitutions for stated equipment. Keep it proportional to the user's experience and time. Say what information is still missing instead of pretending it was supplied.

You provide general fitness education, not medical diagnosis, injury rehabilitation, or emergency advice. If the user reports sharp pain, injury, fainting, chest pain, or a medical limitation, tell them to stop the affected activity and seek an appropriate qualified clinician. Never promise a medical outcome. Be concise, practical, and honest.

Persistent openGym context already loaded for this user (treat it as background, not as a new request):
${persistentContext}`;
}

async function complete(
  input: OpenGymRuntimeWorkerRunInput,
  run: RunState,
  messages: ChatMessage[],
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  run.controller.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        reasoning_effort: input.reasoningEffort,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ChatMock returned ${response.status}`);
    const data = await response.json() as {
      choices?: Array<{ message?: ChatMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("ChatMock returned no message");
    return {
      message,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
    run.controller.signal.removeEventListener("abort", abort);
  }
}

function techniqueResponse(matches: OpenGymCatalogMatch[]): string {
  const selected = matches.slice(0, matches[0] && matches[1] && matches[0].score - matches[1].score < 80 ? 3 : 1);
  const sections = selected.map((exercise) => [
    `## ${exercise.n}`,
    "",
    [exercise.bp, exercise.tg, exercise.eq].filter(Boolean).join(" · "),
    "",
    "### How to do it",
    "",
    ...(exercise.st.length
      ? exercise.st.map((step, index) => `${index + 1}. ${step}`)
      : ["1. Follow the animated demonstration with a controlled range of motion."]),
  ].join("\n"));
  return attachOpenGymAnimations(
    `${sections.join("\n\n")}\n\nUse a load and range you can control. Stop if the movement causes sharp pain; an animation cannot assess an injury or replace an in-person coach.`,
    selected,
  );
}

function profilePatch(args: Record<string, unknown>): Partial<OpenGymProfile> {
  const list = (key: string) => Array.isArray(args[key])
    ? (args[key] as unknown[]).filter((item): item is string => typeof item === "string")
    : undefined;
  const number = (key: string) => typeof args[key] === "number" ? args[key] as number : undefined;
  return Object.fromEntries(Object.entries({
    goals: list("goals"),
    experience: typeof args.experience === "string" ? args.experience : undefined,
    equipment: list("equipment"),
    daysPerWeek: number("daysPerWeek"),
    sessionMinutes: number("sessionMinutes"),
    constraints: list("constraints"),
    preferences: list("preferences"),
  }).filter(([, value]) => value !== undefined)) as Partial<OpenGymProfile>;
}

async function runTool(run: RunState, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "get_training_state") {
    emit(run, "state.reading", {});
    const state = await readOpenGymState(run.userId);
    emit(run, "state.loaded", { programs: state.programs.length, recentRuns: state.recentRuns.length });
    return JSON.stringify(state);
  }
  if (name === "save_training_profile") {
    const state = await mergeOpenGymProfile(run.userId, profilePatch(args));
    emit(run, "state.saved", { kind: "profile" });
    return JSON.stringify({ ok: true, profile: state.profile });
  }
  if (name === "search_exercises") {
    const query = typeof args.query === "string" ? args.query : "";
    const matches = await searchOpenGymCatalog(query, {
      equipment: typeof args.equipment === "string" ? args.equipment : undefined,
      bodyPart: typeof args.bodyPart === "string" ? args.bodyPart : undefined,
      limit: typeof args.limit === "number" ? args.limit : 8,
    });
    for (const match of matches) run.exercises.set(match.id, match);
    emit(run, "catalog.searched", { query, matches: matches.length });
    return JSON.stringify(matches.map((exercise) => ({
      id: exercise.id,
      n: exercise.n,
      bp: exercise.bp,
      eq: exercise.eq,
      tg: exercise.tg,
      mg: exercise.mg,
      sm: exercise.sm,
      st: exercise.st,
      img: exercise.img,
      gif: exercise.gif,
    })));
  }
  return `Unknown tool ${name}.`;
}

function programTitle(answer: string): string {
  const heading = /^#\s+(.+)$/m.exec(answer)?.[1]?.trim();
  return (heading || "openGym training program").slice(0, 240);
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext?: string;
  conversationPublicId?: string | null;
  maxSteps?: number;
}

export interface OpenGymRuntimeWorkerRunInput extends StartRunInput {
  runtimeJobId?: string;
  apiKey: string;
}

/** Fixed worker-local entrypoint. Next routes must call durable `startRun`. */
export function startRuntimeWorkerRun(
  input: OpenGymRuntimeWorkerRunInput,
): { runId: string; status: RunStatus } {
  const runId = input.runtimeJobId ?? `ogrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    controller: new AbortController(),
    exercises: new Map(),
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch(async (error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    const summary = error instanceof Error ? error.message : "openGym could not complete this run.";
    emit(run, "run.failed", { summary, elapsedSec: (Date.now() - run.createdAt) / 1_000 });
    await recordOpenGymRun({ userId: run.userId, runId, task: run.task, outcome: "failed" }).catch(() => undefined);
    scheduleCleanup(run);
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: OpenGymRuntimeWorkerRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", { task: run.task, model: input.model });
  const catalog = await loadOpenGymCatalog();
  emit(run, "catalog.loaded", { exerciseCount: catalog.length });
  const persisted = await readOpenGymState(run.userId);
  emit(run, "state.loaded", { programs: persisted.programs.length, recentRuns: persisted.recentRuns.length });

  if (/\b(chest pain|faint(?:ed|ing)?|sharp pain|acute injury|fractur(?:e|ed)|torn? (?:muscle|tendon|ligament))\b/i.test(run.task)) {
    await completeRun(
      run,
      "Stop the affected exercise. openGym cannot assess an injury or safely prescribe around these symptoms; seek an appropriate qualified clinician, and use urgent care for severe or emergency symptoms.",
    );
    return;
  }

  if (isExerciseTechniqueRequest(run.task)) {
    const matches = await searchOpenGymCatalog(run.task, { limit: 8 });
    if (matches.length && matches[0].score >= 70) {
      for (const match of matches) run.exercises.set(match.id, match);
      emit(run, "catalog.searched", { query: run.task, matches: matches.length });
      await completeRun(run, techniqueResponse(matches));
      return;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(catalog.length, persisted) },
    { role: "user", content: promptWithContext(run.task, input.conversationContext) },
  ];
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let finalText = "";
  const maxSteps = Math.min(Math.max(input.maxSteps ?? 16, 1), 40);
  for (let step = 0; step < maxSteps; step += 1) {
    if (run.aborted) return;
    emit(run, "agent.thinking", { step: step + 1, summary: step ? "Shaping the plan from the catalogue" : "Reading your training context" });
    const completion = await complete(input, run, messages);
    if (run.aborted) return;
    usage.calls += 1;
    usage.inputTokens += completion.usage.inputTokens;
    usage.outputTokens += completion.usage.outputTokens;
    emit(run, "agent.usage", usage);
    const { thinking, answer } = splitReasoning(completion.message.content ?? "");
    if (thinking) emit(run, "agent.thinking", { step: step + 1, summary: thinking.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 200) ?? "" });
    if (answer) finalText = answer;
    messages.push(completion.message);
    const calls = completion.message.tool_calls ?? [];
    if (!calls.length) break;
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch { /* tool receives empty args */ }
      const result = await runTool(run, call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  if (!finalText) finalText = "openGym reached its step limit before it could produce a useful answer.";
  // Tool searches often return substitutions the final answer never chose.
  // Animate only the exact registered names that actually reached the answer.
  const answerNames = finalText.toLowerCase();
  const selected = [...run.exercises.values()]
    .filter((exercise) => answerNames.includes(exercise.n.toLowerCase()))
    .slice(0, 12);
  let summary = attachOpenGymAnimations(finalText, selected);
  if (isWorkoutProgramRequest(run.task)) {
    const title = programTitle(finalText);
    const saved = await saveOpenGymProgram({
      userId: run.userId,
      title,
      markdown: finalText,
      exerciseIds: selected.map((exercise) => exercise.id),
    });
    emit(run, "state.saved", { kind: "program", programId: saved.id, title });
    let artifactCreated = false;
    if (input.conversationPublicId) {
      artifactCreated = Boolean(await publishOpenGymProgram({
        userId: run.userId,
        conversationPublicId: input.conversationPublicId,
        agentRunId: run.runId,
        task: run.task,
        programId: saved.id,
        title,
        markdown: finalText,
        exerciseIds: selected.map((exercise) => exercise.id),
      }));
    }
    emit(run, "artifact.published", { created: artifactCreated, title });
    if (!artifactCreated) summary += "\n\n_This program is saved in openGym's persistent state; this launch had no artifact-capable conversation context._";
  }
  await completeRun(run, summary, usage);
}

async function completeRun(
  run: RunState,
  summary: string,
  usage: Record<string, unknown> = {},
): Promise<void> {
  if (run.aborted) return;
  await recordOpenGymRun({ userId: run.userId, runId: run.runId, task: run.task, outcome: "completed" });
  run.status = "completed";
  emit(run, "run.completed", {
    summary,
    exerciseCount: run.exercises.size,
    ...usage,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): OpenGymEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort();
  const summary = "openGym stopped.";
  emit(run, "run.aborted", { summary, elapsedSec: (Date.now() - run.createdAt) / 1_000 });
  void recordOpenGymRun({ userId, runId, task: run.task, outcome: "aborted" });
  scheduleCleanup(run);
  return true;
}

/** Public durable facade. Runtime V2 owns the catalogue and model turn memory. */
export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: RunStatus }> {
  const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return startOuterAgentRun({
    kind: "open-gym",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
      conversationPublicId: input.conversationPublicId ?? null,
      maxSteps: input.maxSteps ?? 16,
    },
  }) as Promise<{ runId: string; status: RunStatus }>;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<OpenGymEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  const view = await readOuterAgentRunView("open-gym", userId, runId, since);
  return view.events as OpenGymEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("open-gym", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("open-gym", userId, runId);
}
