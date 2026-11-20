// /agents:paper-orchestra — the vendored google-research/paper-orchestra
// pipeline (outline → literature → [plots] → sections → review/compile), run
// as-is by scripts/paper-orchestra-bridge.py on the model chosen in chat,
// through ChatMock. The bridge reports NDJSON stages; this module turns them
// into the shared run-card events and files the PDF and LaTeX as artifacts of
// the chat that started the run.

import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
// Runtime paths stay out of Next's build trace (see claude-code-agent/run-manager.ts).
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeSpawn as spawn } from "../external-runtime-process.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { discoverImageModels } from "../vimax/image-backend.ts";
import { searchDocuments } from "../get-doc/search.ts";
import { closeGetDocArtifactContext, openGetDocArtifactContext } from "../get-doc/artifact.ts";
import { createImportedArtifact } from "../hermes/artifact-store.ts";
import { PAPER_ORCHESTRA_AGENT_NAME, type PaperOrchestraRequest } from "./identity.ts";

export interface PaperOrchestraEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "running" | "completed" | "failed" | "aborted";

export interface PaperOrchestraTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
}

interface RunState {
  runId: string;
  userId: number;
  status: RunStatus;
  sequence: number;
  events: PaperOrchestraEvent[];
  child: ChildProcess | null;
  stderr: string;
  startedAt: number;
  terminalResult?: PaperOrchestraTerminalResult;
  terminalHandler?: (result: PaperOrchestraTerminalResult) => void;
}

const store = globalThis as typeof globalThis & { __breadboardPaperOrchestraRuns?: Map<string, RunState> };
const runs = store.__breadboardPaperOrchestraRuns ?? new Map<string, RunState>();
store.__breadboardPaperOrchestraRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 60 * 60 * 1000;
// Outline, a parallel literature search, section writing and three
// review/compile rounds: an hour is normal, so allow three.
const RUN_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** Setup output: `node scripts/setup-paper-orchestra.mjs` writes here. */
export function paperOrchestraHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.PAPER_ORCHESTRA_HOME?.trim() || path.join(os.homedir(), ".breadboard", "paper-orchestra"));
}

function paths() {
  const home = paperOrchestraHome();
  const win = process.platform === "win32";
  return {
    home,
    root: path.join(repositoryRoot(), "paper-orchestra"),
    bridge: path.join(repositoryRoot(), "scripts", "paper-orchestra-bridge.py"),
    python: path.join(home, "venv", win ? "Scripts/python.exe" : "bin/python"),
    tectonic: path.join(home, "tectonic", win ? "tectonic.exe" : "tectonic"),
  };
}

export function availability(): { available: boolean; reason?: string } {
  const p = paths();
  if (!fs.existsSync(path.join(p.root, "methods", "paper_writer.py"))) {
    return { available: false, reason: "The paper-orchestra clone is missing from the Breadboard folder." };
  }
  if (!fs.existsSync(p.bridge)) return { available: false, reason: "Breadboard's PaperOrchestra bridge script is missing." };
  if (!fs.existsSync(p.python) || !fs.existsSync(p.tectonic)) {
    return {
      available: false,
      reason: "PaperOrchestra is not set up on this computer yet. Run `node scripts/setup-paper-orchestra.mjs` in the Breadboard folder once.",
    };
  }
  return { available: true };
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
  if (run.events.length > MAX_EVENTS) run.events.shift();
}

function elapsedSec(run: RunState): number {
  return Math.max(0, (Date.now() - run.startedAt) / 1_000);
}

function finish(run: RunState, status: Exclude<RunStatus, "running">, content: string, extra: Record<string, unknown> = {}): void {
  if (run.terminalResult) return;
  run.status = status;
  const type = status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed";
  emit(run, type, status === "failed" ? { error: content, elapsedSec: elapsedSec(run), ...extra } : { summary: content, elapsedSec: elapsedSec(run), ...extra });
  run.terminalResult = { outcome: status, content };
  try { run.terminalHandler?.(run.terminalResult); } catch { /* the stream still replays the result */ }
  setTimeout(() => runs.delete(run.runId), RETENTION_MS).unref?.();
}

/** Raw materials in the layout upstream expects: idea, experimental log, figures. */
export function writeMaterials(directory: string, request: PaperOrchestraRequest, prompt: string, images: readonly string[]): void {
  fs.mkdirSync(path.join(directory, "figures"), { recursive: true });
  fs.writeFileSync(path.join(directory, "idea.md"), `# Research idea\n\n${prompt}\n`);
  // Upstream wants results in a separate log. The person gave one brief, so the
  // log is that brief with an explicit rule against inventing numbers.
  fs.writeFileSync(
    path.join(directory, "experimental_log.md"),
    "# Experimental log\n\nEverything the author reported is below. Use only numbers, datasets and results stated here; " +
      "where none are given, describe the method and the planned evaluation without inventing results.\n\n" +
      `${request.brief}\n`,
  );
  const figures: Array<{ name: string; caption: string }> = [];
  images.forEach((dataUrl, index) => {
    const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/s.exec(dataUrl);
    if (!match) return;
    const name = `figure_${index + 1}.${match[1] === "png" ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(directory, "figures", name), Buffer.from(match[2], "base64"));
    figures.push({ name, caption: `Figure ${index + 1}, provided by the author.` });
  });
  fs.writeFileSync(path.join(directory, "figures", "info.json"), JSON.stringify(figures, null, 2));
}

export interface StartPaperOrchestraRunInput {
  userId: number;
  request: PaperOrchestraRequest;
  /** The brief with the chat's earlier context in front of it. */
  prompt: string;
  /** Image data URLs from the chat; they become the paper's figures. */
  images?: readonly string[];
  model: string;
  baseUrl: string;
  conversationPublicId: string;
}

export function startRun(input: StartPaperOrchestraRunInput): { runId: string; status: RunStatus } {
  const ready = availability();
  if (!ready.available) throw new Error(ready.reason);
  const p = paths();
  const runId = `porun_${randomUUID().replaceAll("-", "")}`;
  const workDirectory = path.join(p.home, "runs", runId);
  const materials = path.join(workDirectory, "raw_materials");
  writeMaterials(materials, input.request, input.prompt, input.images ?? []);

  const run: RunState = { runId, userId: input.userId, status: "running", sequence: 0, events: [], child: null, stderr: "", startedAt: Date.now() };
  runs.set(runId, run);
  emit(run, "run.started", { model: input.model, template: input.request.template, plotting: input.request.plotting });
  void drive(run, input, p, workDirectory).catch((error: unknown) => {
    finish(run, "failed", error instanceof Error ? error.message : "PaperOrchestra could not start.");
  });
  return { runId, status: run.status };
}

async function drive(run: RunState, input: StartPaperOrchestraRunInput, p: ReturnType<typeof paths>, workDirectory: string): Promise<void> {
  const imageModel = input.request.plotting ? (await discoverImageModels(input.baseUrl))[0] ?? null : null;
  if (run.status !== "running") return;
  const job = {
    root: p.root,
    outputDir: workDirectory,
    templateDir: path.join(p.root, "templates", input.request.template),
    model: input.model,
    imageModel,
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    apiKey: chatmockApiKeyValue(),
    plotting: input.request.plotting,
    tectonic: p.tectonic,
    cutoff: new Date().toISOString().slice(0, 7),
  };
  // Upstream copies raw_materials from wherever it is told; it is already in place.
  const child = spawn(p.python, ["-I", p.bridge], {
    cwd: p.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", MPLBACKEND: "Agg" },
  });
  run.child = child;
  // A reply to a bridge that already exited must not become an uncaught EPIPE.
  child.stdin?.on("error", () => {});
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* already gone */ }
    finish(run, "failed", "PaperOrchestra ran past its three-hour limit and was stopped.");
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  let buffer = "";
  let completed: { pdf: string; latexDir: string } | null = null;
  let failure = "";
  const onLine = (line: string) => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (event.type === "search") {
      void answerSearch(run, child, event);
      return;
    }
    if (event.type === "stage") {
      if (event.status === "started") {
        emit(run, "reasoning.completed", { text: `${String(event.label)}…` });
        return;
      }
      emit(run, "tool.completed", {
        tool: String(event.stage),
        title: String(event.label),
        status: event.status === "failed" ? "failed" : "completed",
        summary: event.status === "failed" ? String(event.error ?? "") : `${Number(event.seconds) || 0}s`,
      });
    } else if (event.type === "completed") {
      completed = { pdf: String(event.pdf), latexDir: String(event.latexDir) };
    } else if (event.type === "failed") {
      failure = String(event.error ?? "");
    }
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  });
  child.stderr?.on("data", (chunk: string) => { run.stderr = `${run.stderr}${chunk}`.slice(-16_000); });
  child.on("error", (error) => {
    clearTimeout(timer);
    finish(run, "failed", `PaperOrchestra could not start: ${error.message}`);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    run.child = null;
    onLine(buffer);
    if (run.status !== "running") return;
    if (code === 0 && completed) {
      void publish(run, input, workDirectory, completed);
      return;
    }
    const tail = run.stderr.trim().split(/\r?\n/).slice(-1)[0] ?? "";
    finish(run, "failed", failure || tail || `${PAPER_ORCHESTRA_AGENT_NAME} exited with code ${code ?? "unknown"}.`);
  });
  // stdin stays open: the bridge's catalog searches are answered on it.
  child.stdin?.write(`${JSON.stringify(job)}\n`);
}

// Unpaywall lookups only find PDFs, which a bibliography does not need, and
// they run one by one; without a contact address searchDocuments skips them.
const CATALOG_ENV = { ...process.env, GET_DOC_CONTACT_EMAIL: "", OPENALEX_MAILTO: "", UNPAYWALL_EMAIL: "" };

/** Literature discovery: the bridge's queries run through Get Doc's catalog search. */
export async function catalogSearch(queries: string[], yearTo: number | null, limit: number) {
  const documents = new Map<string, Record<string, unknown>>();
  for (const query of queries.slice(0, 4)) {
    const outcome = await searchDocuments({
      query: { query, limit, openAccessOnly: false, yearFrom: null, yearTo },
      sources: null,
      env: CATALOG_ENV,
    }).catch(() => null);
    for (const doc of outcome?.documents ?? []) {
      const key = doc.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key || documents.has(key)) continue;
      documents.set(key, {
        title: doc.title, authors: doc.authors, year: doc.year, venue: doc.venue, doi: doc.doi,
        abstract: doc.abstract, citationCount: doc.citationCount,
      });
    }
  }
  return [...documents.values()];
}

async function answerSearch(run: RunState, child: ChildProcess, event: Record<string, unknown>): Promise<void> {
  const queries = Array.isArray(event.queries) ? event.queries.filter((q): q is string => typeof q === "string" && q.trim() !== "") : [];
  const yearTo = typeof event.yearTo === "number" ? event.yearTo : null;
  const limit = Math.min(Math.max(Number(event.limit) || 15, 1), 30);
  const documents = queries.length ? await catalogSearch(queries, yearTo, limit) : [];
  if (run.status === "running") {
    emit(run, "tool.completed", {
      tool: "catalog_search",
      title: queries.join("; ").slice(0, 300),
      status: documents.length ? "completed" : "failed",
      summary: `${documents.length} papers from OpenAlex, arXiv, Europe PMC, Semantic Scholar and Crossref`,
    });
  }
  try {
    child.stdin?.write(`${JSON.stringify({ id: event.id, documents })}\n`);
  } catch { /* the bridge has exited */ }
}

async function publish(run: RunState, input: StartPaperOrchestraRunInput, workDirectory: string, output: { pdf: string; latexDir: string }): Promise<void> {
  const title = paperTitle(output.latexDir) ?? input.request.brief.slice(0, 120);
  const context = openGetDocArtifactContext({ userId: input.userId, conversationPublicId: input.conversationPublicId, label: `${PAPER_ORCHESTRA_AGENT_NAME}: ${title}`, agentRunId: run.runId });
  const saved: string[] = [];
  let note = "";
  if (!context) {
    note = `\n\nThe chat this run belongs to could not be found, so the files were not attached. They are in ${workDirectory}.`;
  } else {
    const base = { userId: context.userId, runtimeSessionId: context.runtimeSessionId, hermesSessionId: context.hermesSessionId, conversationId: context.conversationId, clusterId: context.clusterId, runId: context.runId, assistantMessageId: context.assistantMessageId, surface: context.surface, authorizedRoot: workDirectory, sourceHermesTool: "paper_orchestra" };
    try {
      await createImportedArtifact({ ...base, kind: "pdf", title, filename: "paper.pdf", filePath: output.pdf, metadata: { paperOrchestra: true, template: input.request.template } });
      saved.push("the compiled PDF");
    } catch (error) {
      note += `\n\nThe PDF could not be attached (${error instanceof Error ? error.message : "unknown error"}); it is at ${output.pdf}.`;
    }
    try {
      await createImportedArtifact({ ...base, kind: "folder", title: `${title} (LaTeX source)`, filename: "latex", filePath: output.latexDir, metadata: { paperOrchestra: true } });
      saved.push("its LaTeX source");
    } catch (error) {
      note += `\n\nThe LaTeX source could not be attached (${error instanceof Error ? error.message : "unknown error"}); it is in ${output.latexDir}.`;
    }
    closeGetDocArtifactContext(context, saved.length ? "completed" : "failed");
  }
  const minutes = Math.round(elapsedSec(run) / 60);
  const summary = `**${title}**\n\nPaperOrchestra wrote this ${input.request.template.replace("2025", "").toUpperCase()}-format paper in ${minutes} min` +
    (saved.length ? `; ${saved.join(" and ")} are attached below.` : ".") +
    " Every citation comes from a real catalog record (OpenAlex, arXiv, Europe PMC, Semantic Scholar, Crossref); still check the claims before submitting." + note;
  finish(run, "completed", summary);
}

function paperTitle(latexDirectory: string): string | null {
  try {
    const tex = fs.readFileSync(path.join(latexDirectory, "final_refined_paper.tex"), "utf8");
    const match = /\\title\{((?:[^{}]|\{[^{}]*\})+)\}/.exec(tex);
    return match ? match[1].replace(/\\thanks\{[^}]*\}|\\\\|\\[a-zA-Z]+\*?|[{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || null : null;
  } catch {
    return null;
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

export async function readRunView(userId: number, runId: string, since = 0) {
  const run = requireRun(userId, runId);
  return { events: run.events.filter((event) => event.sequenceNumber > since), terminal: run.status !== "running", status: null };
}

export function getEventsSince(userId: number, runId: string, since = 0): PaperOrchestraEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function setRunTerminalHandler(userId: number, runId: string, handler: (result: PaperOrchestraTerminalResult) => void): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const run = requireRun(userId, runId);
  if (run.status !== "running") return false;
  try { run.child?.kill(); } catch { /* already gone */ }
  finish(run, "aborted", `${PAPER_ORCHESTRA_AGENT_NAME} stopped before the paper was finished.`);
  return true;
}
