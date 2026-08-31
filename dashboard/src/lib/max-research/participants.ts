// One surface over six agents that were never built to be interchangeable.
//
// Five of them own a run: they take a task, return a run id, emit events, and
// eventually settle. Their signatures already agree closely enough that a thin
// adapter is honest rather than a pretence — `startRun`, `getEventsSince`,
// `isTerminal`, `abortRun`, in that shape, in every one of them.
//
// ARIS is the exception and stays one. It is not a runtime that fetches
// anything; it is the cloned harness's own research methodology, which shapes
// how the question is approached and how the results are reconciled. Modelling
// it as a sixth fetcher would mean inventing a run for it and reporting an
// empty result as a failure, so it resolves immediately with guidance instead.
//
// Nothing here reaches a service at module load: every runtime is imported at
// call time, so an unavailable participant does not load a runtime it cannot use.

import { DEFAULT_RESULT_LIMIT } from "../get-doc/identity.ts";
import type { MaxResearchParticipant } from "./plan.ts";

export interface ParticipantResult {
  participant: MaxResearchParticipant;
  status: "completed" | "failed" | "unavailable" | "aborted";
  /** What this participant found, in its own words. Empty when it failed. */
  output: string;
  /** Its own run id, for the evidence trail and for aborting. */
  runId?: string;
  /** Why it produced nothing, when it produced nothing. */
  reason?: string;
  /** Pages it read, where the runtime can say. */
  websites?: Array<{ url: string; title?: string; domain?: string }>;
  /** Artifacts it saved — Get Doc's full texts, OpenScience's workspace files. */
  artifacts?: Array<{ name: string; path?: string; url?: string }>;
  /**
   * Parts of this participant's reach that were closed while it worked.
   *
   * Agent Reach can read the open web but not a platform behind a login, and
   * which is which changes with the machine's setup. Without this the answer
   * silently omits whatever it could not get to, and the reader has no way to
   * tell a subject nobody discusses from a forum the agent simply could not
   * open.
   */
  limitations?: Array<{ name: string; detail: string }>;
}

export interface ParticipantContext {
  userId: number;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext?: string;
  /** Sealed by the Max Research facade; never inferred inside the worker. */
  praxistTaskPath?: string;
  /** Aborts every participant when the orchestrating run is stopped. */
  signal?: AbortSignal;
}

/** How long any one participant may hold the whole run up. */
export const PARTICIPANT_TIMEOUT_MS = 45 * 60_000;

/**
 * What a participant is asked, in the pieces it actually needs.
 *
 * Flattened to one string before, which suited the three that take a task and
 * broke the one that takes a search query: Get Doc's `query` is documented as
 * the user's own words, and a question with guidance appended became catalog
 * queries that arXiv and Crossref answered with HTTP 400.
 */
export interface ParticipantBrief {
  /** The question, exactly as asked. */
  question: string;
  /** How to approach it. Never part of a search query. */
  guidance: string;
  /** Both together, for participants that take a task. */
  brief: string;
}

export interface ParticipantRuntime {
  /** Whether this participant can run at all right now, and why not. */
  available(context?: ParticipantContext): Promise<{ available: boolean; reason?: string }>;
  /** Run it to completion. Never throws: a failure is a returned result. */
  run(
    brief: ParticipantBrief,
    context: ParticipantContext,
  ): Promise<ParticipantResult>;
}

function unavailable(
  participant: MaxResearchParticipant,
  reason: string,
): ParticipantResult {
  return { participant, status: "unavailable", output: "", reason };
}

function failed(
  participant: MaxResearchParticipant,
  error: unknown,
  runId?: string,
): ParticipantResult {
  return {
    participant,
    status: "failed",
    output: "",
    ...(runId ? { runId } : {}),
    reason:
      error instanceof Error ? error.message : "The run failed without a reason.",
  };
}

/**
 * Drive one of the five run-owning agents to completion.
 *
 * Polling rather than subscribing, because that is the interface all four
 * actually expose: an event log and a terminal predicate. The interval is
 * deliberately unhurried — these runs are measured in minutes, and a tight loop
 * would spend the orchestrator's time watching rather than working.
 */
async function driveRun(input: {
  participant: MaxResearchParticipant;
  start: () => { runId: string } | Promise<{ runId: string }>;
  isTerminal: (runId: string) => boolean | Promise<boolean>;
  collect: (runId: string) => ParticipantResult | Promise<ParticipantResult>;
  abort: (runId: string) => void | Promise<void>;
  signal?: AbortSignal;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<ParticipantResult> {
  let runId: string;
  try {
    runId = (await input.start()).runId;
  } catch (error) {
    return failed(input.participant, error);
  }

  const pollMs = input.pollMs ?? 4_000;
  const deadline = Date.now() + (input.timeoutMs ?? PARTICIPANT_TIMEOUT_MS);
  while (!(await input.isTerminal(runId))) {
    if (input.signal?.aborted) {
      await Promise.resolve(input.abort(runId)).catch(() => undefined);
      return { participant: input.participant, status: "aborted", output: "", runId };
    }
    if (Date.now() > deadline) {
      await input.abort(runId);
      // Keep whatever it had reached. A participant cut off at the budget has
      // usually done real work — Agent Reach runs up to sixteen steps and holds
      // its answer-so-far — and discarding it means the orchestration paid for
      // forty-five minutes and carried none of it into the answer. Reported as
      // partial rather than completed, so nothing reads it as a finished pass.
      let partial = "";
      try {
        partial = (await input.collect(runId)).output;
      } catch {
        // A runtime that has already dropped the run has nothing to give back.
      }
      return {
        participant: input.participant,
        status: partial ? "completed" : "failed",
        output: partial,
        runId,
        reason: partial
          ? "Cut off at the time this orchestration allows, so this is what it had reached rather than a finished pass."
          : "The run exceeded the time this orchestration allows it.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  try {
    return withRealFindings(await input.collect(runId));
  } catch (error) {
    return failed(input.participant, error, runId);
  }
}

/**
 * The shortest output that can be a finding rather than the absence of one.
 *
 * Set from what a failing run actually returns. A live drive had Agent Reach
 * settle "completed" with 70 characters and OpenScience settle "completed" with
 * *one*, and both were counted as findings — so the synthesis believed it had
 * four participants' evidence when it had two, and wrote an answer the audit
 * layer then buried under "the run could not trace..." because most of it was
 * traceable to nothing. A genuine finding from any of these runs to hundreds or
 * thousands of characters; nothing legitimate lands near this line.
 */
const MINIMUM_USEFUL_OUTPUT = 200;

/** How long to wait for a slot when the Deep Research service is at its limit. */
const BUSY_SERVICE_GRACE_MS = 5 * 60_000;

/** How long to let a Deep Research service that is starting finish starting. */
const SERVICE_START_GRACE_MS = 45_000;

/**
 * Turn a commissioned research brief into the query handed to literature
 * catalogs.
 *
 * A Super Agent may expand a short user request into several thousand
 * characters of scope and evidence instructions before launching Max
 * Research. That full brief belongs with the research agents, but it is not a
 * catalog query: Get Doc's sealed Runtime contract allows 4,000 UTF-8 bytes,
 * and the upstream catalogs work best with the topic rather than the rubric.
 * Keep the opening question, which is where commissioned briefs state their
 * subject, and bound it by UTF-16 code units so it is also at most 2,048 UTF-8
 * bytes even when every character needs four bytes.
 */
const MAX_LITERATURE_QUERY_CHARS = 512;

export function maxResearchLiteratureQuery(question: string): string {
  const original = question.trim();
  const withoutDirective = original.replace(
    /^(?:please\s+)?(?:do|run|conduct|perform|use)\s+(?:a\s+)?max\s+research(?:\s+on|\s*:)?\s*/iu,
    "",
  );
  const subject = withoutDirective || original;
  const openingParagraph = subject.split(/\r?\n\s*\r?\n/u, 1)[0]?.trim() || subject;
  if (openingParagraph.length <= MAX_LITERATURE_QUERY_CHARS) {
    return openingParagraph;
  }

  const bounded = openingParagraph.slice(0, MAX_LITERATURE_QUERY_CHARS);
  const sentenceEnd = [...bounded.matchAll(/[.!?](?=\s|$)/gu)].at(-1)?.index;
  return sentenceEnd !== undefined && sentenceEnd >= 40
    ? bounded.slice(0, sentenceEnd + 1).trim()
    : bounded.trim();
}

/**
 * Demote a run that stopped without finding anything.
 *
 * `completed` from a run manager means the process ended, not that it produced
 * evidence — the same gap that has bitten this orchestration before. Saying so
 * matters more than it looks: a participant recorded as completed-but-empty is
 * invisible to the reader, while one recorded as failed appears in the answer's
 * own account of what it could not reach.
 */
function withRealFindings(result: ParticipantResult): ParticipantResult {
  if (result.status !== "completed") return result;
  // ARIS contributes method rather than retrieval, and its guidance is
  // deliberately short. It is not measured against a findings threshold.
  if (result.participant === "aris") return result;
  const output = result.output.trim();
  if (output.length >= MINIMUM_USEFUL_OUTPUT) return result;
  return {
    ...result,
    status: "failed",
    output: "",
    reason: output
      ? `The run ended without findings — it returned ${output.length} characters, which is too little to be evidence: ${output.slice(0, 120)}`
      : "The run ended without returning anything.",
  };
}

/**
 * The runtimes, resolved lazily.
 *
 * Exported as a factory rather than a constant so a test can substitute one
 * without a service, and so importing the plan never drags six runtimes and
 * their databases in behind it.
 */
export function participantRuntime(
  participant: MaxResearchParticipant,
): ParticipantRuntime {
  switch (participant) {
    case "deep_research":
      return deepResearchRuntime();
    case "agent_reach":
      return runManagerRuntime(participant, {
        load: () => import("../agent-reach/run-manager.ts"),
        health: async () =>
          (await import("../agent-reach/runtime.ts")).runtimeAvailability(),
      });
    case "get_doc":
      return getDocRuntime();
    case "openscience":
      return openscienceRuntime();
    case "praxist":
      return praxistRuntime();
    case "aris":
      return arisRuntime();
  }
}

function praxistRuntime(): ParticipantRuntime {
  return {
    async available(context) {
      try {
        const runtime = await import("../praxist/runtime.ts");
        const readiness = runtime.runtimeReadiness();
        if (!readiness.available) {
          return { available: false, reason: readiness.reason ?? "Praxist is unavailable." };
        }
        if (!context?.praxistTaskPath) {
          return {
            available: false,
            reason: "Set PRAXIST_MAX_RESEARCH_TASK_PATH to an existing Praxist task project before including it in Max Research.",
          };
        }
        return { available: true };
      } catch (error) {
        return {
          available: false,
          reason: error instanceof Error ? error.message : "Praxist is unavailable.",
        };
      }
    },
    async run(_brief, context) {
      const taskPath = context.praxistTaskPath;
      if (!taskPath) {
        return unavailable(
          "praxist",
          "PRAXIST_MAX_RESEARCH_TASK_PATH does not name a valid Praxist task project.",
        );
      }
      const manager = await import("../praxist/run-manager.ts");
      return driveRun({
        participant: "praxist",
        start: () => manager.startRun({
          userId: context.userId,
          taskPath,
          model: context.model,
          baseUrl: context.baseUrl,
        }),
        isTerminal: (runId) => manager.isTerminal(context.userId, runId),
        abort: async (runId) => { await manager.abortRun(context.userId, runId); },
        collect: async (runId) => {
          const events = await manager.getEventsSince(context.userId, runId, 0);
          const status = terminalStatusFromEvents(events);
          const output = summarizeEvents(events);
          const artifacts = collectArtifacts(events);
          return {
            participant: "praxist",
            status,
            output: status === "completed" ? output : "",
            runId,
            ...(artifacts?.length ? { artifacts } : {}),
            ...(status === "completed"
              ? {}
              : { reason: output || "The run ended without accepted findings." }),
          };
        },
        ...(context.signal ? { signal: context.signal } : {}),
      });
    },
  };
}

/* ------------------------------------------------------------------ */

/**
 * OpenScience, which does not take the shape every other run manager takes.
 *
 * The generic adapter hands each runtime a flat `{ userId, task, model,
 * reasoningEffort, baseUrl }`. OpenScience's `startRun` also requires an
 * `apiKey` and an `options` object naming its harness, and it reads
 * `run.options.harness` while emitting `run.started` — so the omission did not
 * surface as a validation error but as `Cannot read properties of undefined
 * (reading 'harness')`, a TypeError thrown before the run began. A live Max
 * Research run recorded exactly that and reported the participant as failed
 * with a message no reader could act on.
 *
 * `research` rather than `plan`: Max Research commissions this participant to
 * do the work, not to describe what it would do. `deliverFiles` is on because
 * the scripts and figures a run leaves behind are the evidence for what it
 * claims to have observed.
 */
/**
 * One OpenScience run at a time, per process.
 *
 * Its session store writes each record to a temp file carrying a pid and a
 * uuid and then renames it into place. Two runs overlapping made that rename
 * fail on Windows with `EPERM: operation not permitted`, and the participant
 * reported a path nobody could act on. The store is the vendored server's, so
 * the thing Breadboard controls is whether it is ever asked to do two at once.
 *
 * Queueing costs the second run its wait; colliding costs it the participant
 * entirely, in a run already measured in tens of minutes. A chained promise
 * rather than a counter, so a run that throws still releases the next one.
 */
let openscienceQueue: Promise<unknown> = Promise.resolve();

function queueOpenscience<T>(work: () => Promise<T>): Promise<T> {
  const next = openscienceQueue.then(work, work);
  // Swallowed on the queue only — the caller still sees the real result.
  openscienceQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function openscienceRuntime(): ParticipantRuntime {
  return {
    async available() {
      try {
        await import("../openscience/run-manager.ts");
        const { runtimeAvailability } = await import("../openscience/runtime.ts");
        const state = await runtimeAvailability();
        return state.available
          ? { available: true }
          : { available: false, reason: state.reason ?? "The runtime is unavailable." };
      } catch (error) {
        return {
          available: false,
          reason: error instanceof Error ? error.message : "The runtime is unavailable.",
        };
      }
    },
    async run(brief, context) {
      let runManager: typeof import("../openscience/run-manager.ts");
      let apiKey: string;
      try {
        runManager = await import("../openscience/run-manager.ts");
        apiKey = (await import("../agent-browser/provider.ts")).chatmockApiKeyValue();
      } catch (error) {
        return failed("openscience", error);
      }
      // OpenScience streams its answer as `assistant.delta` events and never
      // emits a terminal content event, so `summarizeEvents` — which reads the
      // run.completed payload and falls back to scanning for content keys —
      // found nothing and returned one or two stray characters. Two live drives
      // recorded exactly that: 750 seconds of work, 63% of the whole run, and
      // "**" as the finding. `onTerminal` is the runtime's own accessor for the
      // assembled answer, so it is what this reads.
      let terminal: { outcome: string; content: string } | null = null;
      return queueOpenscience(() =>
        driveRun({
        participant: "openscience",
        start: () => {
          const summary = runManager.startRun({
            userId: context.userId,
            task: brief.brief,
            model: context.model,
            reasoningEffort: context.reasoningEffort,
            baseUrl: context.baseUrl,
            apiKey,
            options: { harness: "research", deliverFiles: true },
            ...(context.conversationContext
              ? { conversationContext: context.conversationContext }
              : {}),
          });
          runManager.onTerminal(context.userId, summary.runId, (result) => {
            terminal = result;
          });
          return summary;
        },
        isTerminal: (runId) => runManager.isTerminal(context.userId, runId),
        abort: (runId) => void runManager.abortRun?.(context.userId, runId),
        collect: async (runId) => {
          const events = runManager.getEventsSince(context.userId, runId, 0);
          const settled = terminal as { outcome: string; content: string } | null;
          const output = (settled?.content ?? "").trim();
          const status =
            settled?.outcome === "completed"
              ? ("completed" as const)
              : settled?.outcome === "aborted"
                ? ("aborted" as const)
                : settled
                  ? ("failed" as const)
                  : terminalStatusFromEvents(events);
          const limitations = collectLimitations(events);
          const artifacts = collectArtifacts(events);
          return {
            participant: "openscience" as const,
            status,
            output: status === "completed" ? output : "",
            runId,
            ...(limitations?.length ? { limitations } : {}),
            ...(artifacts?.length ? { artifacts } : {}),
            ...(status === "completed" || !output ? {} : { reason: output.slice(0, 400) }),
          };
        },
        signal: context.signal,
        }),
      );
    },
  };
}

function deepResearchRuntime(): ParticipantRuntime {
  return {
    async available() {
      // The mode alone is not availability. A run with the service enabled but
      // its shared secret unset fails with `service_misconfigured` the instant
      // it starts — which is what a live run did, after this reported the
      // participant available and the plan committed to it as the required one.
      // The service already answers this properly; ask it.
      const { health } = await import("../deep-research/service.ts");
      const { resolveDeepResearchConfig } = await import(
        "../deep-research/config.ts"
      );
      // Checked separately from `health()`, which reports the service's own
      // state and not whether this process can talk to it: a live run found the
      // service healthy, the mode enabled, and the shared secret unset, which
      // is `service_misconfigured` at the first call. Availability has to mean
      // what `requireEnabled` means, or the plan commits to a participant that
      // cannot start.
      if (!resolveDeepResearchConfig().secret.trim()) {
        return {
          available: false,
          reason: "The Deep Research shared secret is not configured.",
        };
      }
      try {
        // `health()` is observational: it never acquires a lease. A service
        // already starting for another real request gets a short grace window;
        // a stopped on-demand service is still reported as available because
        // this participant's actual run will acquire it.
        //
        // Waiting is affordable precisely here. This orchestration is about to
        // spend ten minutes or more, and Deep Research is the participant that
        // supplies the broad web evidence; losing it costs far more than the
        // half minute spent letting it finish starting.
        let state = await health();
        const deadline = Date.now() + SERVICE_START_GRACE_MS;
        while (state.runtimeState === "unavailable" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          state = await health();
        }
        if (state.runtimeState === "available") return { available: true };
        return {
          available: false,
          reason:
            state.runtimeState === "misconfigured"
              ? "The Deep Research service is running but not configured to answer."
              : "The Deep Research service did not become reachable in time.",
        };
      } catch (error) {
        return {
          available: false,
          reason:
            error instanceof Error
              ? error.message
              : "The Deep Research service could not be reached.",
        };
      }
    },
    async run(brief, context) {
      const service = await import("../deep-research/service.ts");
      let runId: string;
      // The service caps how many runs it will hold at once and answers a
      // request over that cap with `too_many_runs`. Treating that as a failure
      // drops the participant that contributes the most evidence over a queue
      // that clears in minutes — which is what happened the moment three
      // orchestrations overlapped. A full service is a reason to wait, not a
      // reason to give up: this run is going to take twenty minutes anyway.
      const startDeadline = Date.now() + BUSY_SERVICE_GRACE_MS;
      for (;;) {
        try {
          const summary = await service.startRun(context.userId, {
            query: brief.brief,
            output: "report",
            ...(context.conversationContext
              ? { conversationPublicId: undefined }
              : {}),
          });
          runId = summary.runId;
          break;
        } catch (error) {
          // `too_many_runs` is the cap; `service_unavailable` is the same
          // service under the same pressure answering a different way. Three
          // overlapping orchestrations produced one of each, and only the first
          // was being waited out.
          const busy =
            error instanceof Error &&
            /too_many_runs|service_unavailable|429|503/.test(error.message);
          if (!busy || Date.now() >= startDeadline || context.signal?.aborted) {
            return busy
              ? {
                  participant: "deep_research",
                  status: "failed",
                  output: "",
                  reason:
                    "The Deep Research service stayed busy for the whole time this orchestration waited for a slot.",
                }
              : failed("deep_research", error);
          }
          await new Promise((resolve) => setTimeout(resolve, 15_000));
        }
      }

      const deadline = Date.now() + PARTICIPANT_TIMEOUT_MS;
      for (;;) {
        if (context.signal?.aborted) {
          await service.abortRun(context.userId, runId).catch(() => undefined);
          return { participant: "deep_research", status: "aborted", output: "", runId };
        }
        let summary;
        try {
          summary = await service.getRun(context.userId, runId);
        } catch (error) {
          return failed("deep_research", error, runId);
        }
        if (summary.status !== "running") {
          if (summary.status !== "completed" || !summary.result) {
            return {
              participant: "deep_research",
              status: summary.status === "aborted" ? "aborted" : "failed",
              output: "",
              runId,
              reason: summary.failure?.message ?? "The run produced no report.",
            };
          }
          const websites = await service
            .runWebsites(context.userId, runId)
            .catch(() => []);
          return {
            participant: "deep_research",
            status: "completed",
            output: summary.result,
            runId,
            ...(websites.length ? { websites } : {}),
          };
        }
        if (Date.now() > deadline) {
          await service.abortRun(context.userId, runId).catch(() => undefined);
          return {
            participant: "deep_research",
            status: "failed",
            output: "",
            runId,
            reason: "The run exceeded the time this orchestration allows it.",
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
    },
  };
}

/** Agent Reach and OpenScience, which share the in-process run-manager shape. */
function runManagerRuntime(
  participant: MaxResearchParticipant,
  runtime: {
    load: () => Promise<Record<string, unknown>>;
    /**
     * The runtime's own health, not merely whether its module imports.
     *
     * Importing a run manager proves nothing: both of these throw from
     * `startRun` when their clone is missing or their launcher is absent, so an
     * import-only check reported "available" at plan time and then failed as a
     * participant — which is precisely the ordering the pre-plan check exists
     * to avoid.
     */
    health: () => Promise<{ available: boolean; reason?: string | null }>;
  },
): ParticipantRuntime {
  const load = runtime.load;
  return {
    async available() {
      try {
        await load();
        const state = await runtime.health();
        return state.available
          ? { available: true }
          : { available: false, reason: state.reason ?? "The runtime is unavailable." };
      } catch (error) {
        return {
          available: false,
          reason:
            error instanceof Error ? error.message : "The runtime is unavailable.",
        };
      }
    },
    async run(brief, context) {
      let runManager: Record<string, unknown>;
      try {
        runManager = await load();
      } catch (error) {
        return failed(participant, error);
      }
      const startRun = runManager.startRun as
        | ((input: Record<string, unknown>) => { runId: string } | Promise<{ runId: string }>)
        | undefined;
      const isTerminal = runManager.isTerminal as
        | ((userId: number, runId: string) => boolean | Promise<boolean>)
        | undefined;
      const abortRun = runManager.abortRun as
        | ((userId: number, runId: string) => unknown | Promise<unknown>)
        | undefined;
      const getEventsSince = runManager.getEventsSince as
        | ((userId: number, runId: string, since?: number) => unknown[] | Promise<unknown[]>)
        | undefined;
      if (!startRun || !isTerminal || !getEventsSince) {
        return unavailable(participant, "The runtime does not expose a run.");
      }

      return driveRun({
        participant,
        start: () =>
          startRun({
            userId: context.userId,
            task: brief.brief,
            model: context.model,
            reasoningEffort: context.reasoningEffort,
            baseUrl: context.baseUrl,
            ...(context.conversationContext
              ? { conversationContext: context.conversationContext }
              : {}),
          }),
        isTerminal: (runId) => isTerminal(context.userId, runId),
        abort: async (runId) => { await abortRun?.(context.userId, runId); },
        collect: async (runId) => {
          const events = await getEventsSince(context.userId, runId, 0);
          const status = terminalStatusFromEvents(events);
          const output = summarizeEvents(events);
          const limitations = collectLimitations(events);
          return {
            participant,
            status,
            output: status === "completed" ? output : "",
            runId,
            ...(limitations?.length ? { limitations } : {}),
            ...(status === "completed"
              ? {}
              : { reason: output || "The run ended without an answer." }),
          };
        },
        ...(context.signal ? { signal: context.signal } : {}),
      });
    },
  };
}

function getDocRuntime(): ParticipantRuntime {
  return {
    async available() {
      const { sourceAvailability } = await import("../get-doc/runtime-run-manager.ts");
      const ready = sourceAvailability();
      return ready.ready.length
        ? { available: true }
        : { available: false, reason: "No document source is configured." };
    },
    async run(brief, context) {
      const manager = await import("../get-doc/runtime-run-manager.ts");
      return driveRun({
        participant: "get_doc",
        start: () =>
          manager.startRun({
            userId: context.userId,
            // A complete request, not a partial one behind a cast.
            //
            // This was `{ query } as never`, and the cast hid exactly what it
            // was covering: every other field was missing, so `limit` was
            // undefined, OpenAlex's `per-page` became `limit * 2` — NaN — and
            // every catalog answered HTTP 400. A live run reported "no
            // documents matched" for a question with a substantial literature,
            // and that reached the answer as "the literature has nothing".
            //
            // The bare question is the query, because the planner turns it into
            // catalog terms; guidance goes to the context it reads as
            // background rather than as words to search for.
            request: {
              query: maxResearchLiteratureQuery(brief.question),
              limit: DEFAULT_RESULT_LIMIT,
              openAccessOnly: false,
              yearFrom: null,
              yearTo: null,
              sources: null,
            },
            model: context.model,
            reasoningEffort: context.reasoningEffort,
            baseUrl: context.baseUrl,
            conversationContext: [context.conversationContext, brief.guidance]
              .filter(Boolean)
              .join("\n\n"),
          }),
        isTerminal: (runId) => manager.isTerminal(context.userId, runId),
        abort: async (runId) => { await manager.abortRun(context.userId, runId); },
        collect: async (runId) => {
          const events = await manager.getEventsSince(context.userId, runId, 0);
          const status = terminalStatusFromEvents(events);
          const output = summarizeEvents(events);
          return {
            participant: "get_doc",
            status,
            output: status === "completed" ? output : "",
            runId,
            ...(status === "completed"
              ? { artifacts: collectArtifacts(events) }
              : { reason: output || "The run ended without an answer." }),
          };
        },
        ...(context.signal ? { signal: context.signal } : {}),
      });
    },
  };
}

/**
 * ARIS: methodology, not retrieval.
 *
 * It resolves at once with the cloned harness's own research guidance for this
 * question. That guidance is what the synthesis is written under, which is the
 * whole of its contribution — and reporting "unavailable" when the clone is
 * absent is the truthful outcome rather than a failed fetch.
 */
function arisRuntime(): ParticipantRuntime {
  return {
    async available() {
      const { arisAvailability } = await import("../aris/agent.ts");
      const state = arisAvailability();
      return state.available
        ? { available: true }
        : { available: false, reason: state.reason ?? "ARIS is not installed." };
    },
    async run(brief) {
      const { arisAvailability, renderArisTurnGuidance } = await import(
        "../aris/agent.ts"
      );
      const state = arisAvailability();
      if (!state.available) {
        return unavailable("aris", state.reason ?? "ARIS is not installed.");
      }
      const guidance = renderArisTurnGuidance(brief.question);
      return guidance
        ? { participant: "aris", status: "completed", output: guidance }
        : unavailable("aris", "ARIS matched no workflow to this question.");
    },
  };
}

/* ------------------------------------------------------------------ */

/**
 * How a run actually ended, read from its own terminal event.
 *
 * The predicate these runtimes expose is `isTerminal`, which says a run has
 * stopped and nothing about whether it succeeded. Assuming success from it —
 * which this did — hands the synthesis a failure message as though it were a
 * finding: a live run reported Agent Reach "completed" with the thirty-one
 * characters of its own "finished without an answer" notice, which would then
 * have been reconciled as evidence.
 */
export function terminalStatusFromEvents(
  events: readonly unknown[],
): "completed" | "failed" | "aborted" {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as { type?: unknown })?.type;
    if (typeof type !== "string") continue;
    if (type.endsWith("run.failed")) return "failed";
    if (type.endsWith("run.aborted")) return "aborted";
    if (type.endsWith("run.completed")) return "completed";
  }
  // No terminal event at all: the log cannot say it worked, so it does not.
  return "failed";
}

/** Bound on how much of one participant's log is carried into synthesis. */
const MAX_PARTICIPANT_OUTPUT = 40_000;

/** One event's payload, or the event itself when it carries no envelope. */
function payloadOf(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== "object") return null;
  const payload = (event as { payload?: unknown }).payload ?? event;
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : null;
}

/**
 * A run's event log, reduced to what it actually concluded.
 *
 * The terminal event carries the result in every one of these runtimes, but not
 * under a single field name, so the likely ones are tried in order of how
 * specific they are. Falling back to the whole log is deliberate: a run that
 * finished without a tidy summary still found things, and dropping it entirely
 * would be worse than handing the synthesis something untidy.
 */
export function summarizeEvents(events: readonly unknown[]): string {
  const payloads = events
    .map((event) =>
      event && typeof event === "object"
        ? ((event as { payload?: unknown }).payload ?? event)
        : event,
    )
    .filter((payload): payload is Record<string, unknown> =>
      Boolean(payload && typeof payload === "object"),
    );

  const KEYS = ["report", "result", "summary", "answer", "output", "text"];

  // The terminal event first, and on its own.
  //
  // These runtimes reuse one field for two jobs: Agent Reach puts a progress
  // note and its final answer both under `summary`, so a scan of the whole log
  // can return "Choosing a platform and backend" — a step-zero status line — as
  // though it were the finding. A live run did exactly that. What the run
  // concluded is in the event that ended it, so that event is asked first and
  // the rest of the log is only a fallback.
  const terminalIndex = events.findLastIndex((event) => {
    const type = (event as { type?: unknown })?.type;
    return (
      typeof type === "string" &&
      (type.endsWith("run.completed") ||
        type.endsWith("run.failed") ||
        type.endsWith("run.aborted"))
    );
  });
  if (terminalIndex >= 0) {
    const terminal = payloadOf(events[terminalIndex]);
    const type = String((events[terminalIndex] as { type?: unknown })?.type ?? "");
    // A run that failed says why under `error`, not under a content key. Asking
    // only for content made the reducer fall through to the log and report the
    // last progress line — "Reviewing what came back" — as the reason a run
    // failed, which hid the actual error from everything downstream.
    const keys = type.endsWith("run.completed")
      ? KEYS
      : ["error", "message", "reason", ...KEYS];
    for (const key of keys) {
      const value = terminal?.[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim().slice(0, MAX_PARTICIPANT_OUTPUT);
      }
    }
  }

  for (const key of KEYS) {
    for (let index = payloads.length - 1; index >= 0; index -= 1) {
      const value = payloads[index][key];
      if (typeof value === "string" && value.trim()) {
        return value.trim().slice(0, MAX_PARTICIPANT_OUTPUT);
      }
    }
  }

  const lines = payloads
    .map((payload) => {
      const message = payload.message ?? payload.claim ?? payload.title;
      return typeof message === "string" ? message.trim() : "";
    })
    .filter(Boolean);
  return lines.join("\n").slice(0, MAX_PARTICIPANT_OUTPUT);
}

/** Files a run saved, where its events name them. */
/**
 * Channels a run reported as unusable, from its own diagnostic event.
 *
 * Agent Reach opens by running its doctor and emitting the result, so the run
 * itself already knows which platforms were closed to it. This lifts that into
 * the result so the answer can say so rather than quietly leaving those
 * sources out.
 */
export function collectLimitations(
  events: readonly unknown[],
): ParticipantResult["limitations"] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = payloadOf(events[index]);
    const channels = payload?.channels;
    if (!Array.isArray(channels)) continue;
    const closed = channels
      .filter(
        (channel): channel is Record<string, unknown> =>
          Boolean(channel && typeof channel === "object") &&
          (channel as Record<string, unknown>).status !== "ok",
      )
      .map((channel) => ({
        name: String(channel.channel ?? channel.name ?? "unknown"),
        detail: String(channel.status ?? "unavailable"),
      }));
    return closed.length ? closed : undefined;
  }
  return undefined;
}

export function collectArtifacts(
  events: readonly unknown[],
): ParticipantResult["artifacts"] {
  const artifacts: NonNullable<ParticipantResult["artifacts"]> = [];
  for (const event of events) {
    const payload =
      event && typeof event === "object"
        ? ((event as { payload?: unknown }).payload as
            | Record<string, unknown>
            | undefined)
        : undefined;
    const saved = payload?.document ?? payload?.artifact ?? payload?.file;
    if (!saved || typeof saved !== "object") continue;
    const record = saved as Record<string, unknown>;
    const name = record.title ?? record.name ?? record.filename;
    if (typeof name !== "string" || !name.trim()) continue;
    artifacts.push({
      name: name.trim(),
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(typeof record.url === "string" ? { url: record.url } : {}),
    });
  }
  return artifacts.length ? artifacts : undefined;
}
