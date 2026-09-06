import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { acquireServiceLease, releaseSupervisorLease, type SupervisorLease } from "../supervisor-control.ts";
import { discoverModels, fetchAudio, queryMusic, submitMusic } from "../acestep/client.ts";
import { type AceStepConfig } from "../acestep/config.ts";
import { ACESTEP_REVISION } from "../acestep/capabilities.ts";
import { parseAnalysisOptions, runAudioAnalysis } from "../audio-analyzer/service.ts";
import { finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import { finishRuntimeRun } from "../hermes/run-store.ts";
import type { OuterAgentEvent } from "../runtime-v2/outer-agent-run.ts";
import { assertMusicCollectible, musicArtifactContext, publishMusic } from "./artifacts.ts";
import { planMusic } from "./planning.ts";
import { musicSources, resolveMusicSource, sourceMusicRequest } from "./sources.ts";
import { musicLaunch, updateMusicLaunch } from "./store.ts";
import { inspectWav, spliceWav } from "./wav.ts";
import { musicRequestSchema, type MusicRequest } from "./request.ts";
import { preparedAceStep } from "../acestep/prepared.ts";
import { musicError } from "./errors.ts";
import { renderArrangement } from "./resonant.ts";
import { RESONANT_REVISION } from "./resonant-contract.ts";
export interface MusicWorkerRequest {
  launchId: string;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationPublicId: string;
  conversationContext: string;
  defaults: {
    duration: number;
    vocalMode: "instrumental" | "vocal";
  };
  explicit: Partial<MusicRequest>;
}
/** Runs only inside a registered disposable worker. update writes the native checkpoint. */
export async function executeMusicWorker(input: MusicWorkerRequest & {
  userId: number;
  workspace: string;
  signal: AbortSignal;
  update: (events: OuterAgentEvent[]) => void;
}, dependencies = { acquireServiceLease, releaseSupervisorLease, runAudioAnalysis }) {
  let sequence = 0, lease: SupervisorLease | null = null;
  let context: ReturnType<typeof musicArtifactContext> | null = null;
  const event = (type: string, payload: Record<string, unknown>) => input.update([{ sequenceNumber: ++sequence, type, payload, at: new Date().toISOString() }]);
  const stage = (message: string) => event("music.stage", { message });
  const check = () => { input.signal.throwIfAborted(); assertMusicCollectible(input.userId, input.launchId); };
  let submitted = false, collected = false;
  const generated = path.join(input.workspace, "generated.wav"), spliced = path.join(input.workspace, "repaint.wav");
  let gate: string | null = null;
  try {
    check();
    const bound = musicLaunch(input.userId, input.launchId).context_json;
    context = bound ? JSON.parse(bound) as ReturnType<typeof musicArtifactContext> : musicArtifactContext(input.userId, input.launchId);
    const launch = musicLaunch(input.userId, input.launchId);
    if (["submitting", "uncertain", "draining", "arranging"].includes(launch.provider_state) && !launch.provider_receipt)
      throw new Error("uncertain: submission may have succeeded; do not automatically retry.");
    if (launch.collection_state === "completed" && launch.artifact_id) {
      collected = true;
      event("run.completed", { summary: launch.summary, artifactId: launch.artifact_id, version: launch.artifact_version });
      return { status: "completed" };
    }
    stage("Planning one music draft");
    const request = launch.request_json ? musicRequestSchema.parse(JSON.parse(launch.request_json)) : await planMusic({
      ...input,
      sources: musicSources(input.userId, input.conversationPublicId),
      resolveSourceRequest: source => sourceMusicRequest(input.userId, input.conversationPublicId, source),
      resolveSourceDuration: source => inspectWav(resolveMusicSource(input.userId, input.conversationPublicId, source)).duration,
    }, input.signal);
    check();
    updateMusicLaunch(input.userId, input.launchId, { request_json: JSON.stringify(request), collection_state: "running" });
    event("music.plan", { request });
    const source = request.source ? resolveMusicSource(input.userId, input.conversationPublicId, request.source) : null;
    if (source)
      inspectWav(source); // The initial source contract is decodable PCM/float WAV only.
    if (request.operation === "repaint" && source) {
      const info = inspectWav(source);
      if (request.interval!.end > info.duration || Math.abs(info.duration - request.duration) > 0.05)
        throw new Error("Repaint duration must match the selected WAV source.");
    }
    const config = JSON.parse(launch.provider_json) as AceStepConfig;
    if (!config.baseUrl || !config.model)
      throw new Error("Missing launch-time provider identity.");
    let receipt = launch.provider_receipt, resolvedSeed: number | null = null;
    let arrangement: Awaited<ReturnType<typeof renderArrangement>> | null = null;
    if (request.operation === "arrange") {
      if (!config.resonantSlug || !config.resonantDigest)
        throw new Error("Resonant is not connected to an approved workspace. Configure it in Music Producer settings, or use ACE-Step generation.");
      updateMusicLaunch(input.userId, input.launchId, { provider_state: "arranging" });
      arrangement = await renderArrangement({ ...input, slug: config.resonantSlug, digest: config.resonantDigest, request, source, destination: generated, check, stage });
      updateMusicLaunch(input.userId, input.launchId, { provider_state: "succeeded" });
    }
    else {
      if (config.managed) {
        if (!preparedAceStep(config.directory))
          throw new Error("Missing models. Prepare ACE-Step explicitly in settings.");
        stage("Waiting for resources and loading the model");
        lease = await dependencies.acquireServiceLease("acestep", "music-generation");
        if (!lease)
          throw new Error("Managed ACE-Step requires Runtime service ownership.");
        // Persistent gate survives an interrupted worker and prevents overlapping GPU tasks.
        gate = path.join(config.directory, "generation-receipt.json");
        if (fs.existsSync(gate)) {
          const previous = JSON.parse(fs.readFileSync(gate, "utf8")) as {
            taskId?: string;
            launchId?: string;
          };
          if (!previous.taskId)
            throw new Error("uncertain: a previous submission has no receipt. Restart the managed service before explicitly clearing its gate.");
          const state = await queryMusic(config, previous.taskId, input.signal);
          if (state.state === "running" && previous.taskId !== launch.provider_receipt)
            throw new Error("ACE-Step is draining a previous generation. Retry after it finishes.");
          fs.unlinkSync(gate);
        }
      }
      check();
      if (!(await discoverModels(config)).includes(config.model))
        throw new Error("The selected ACE-Step model is not loaded.");
      const persistGate = (taskId: string | null) => {
        if (!gate)
          return;
        const temp = `${gate}.${input.launchId}.tmp`;
        const fd = fs.openSync(temp, "wx", 0o600);
        try {
          fs.writeFileSync(fd, JSON.stringify({ taskId, launchId: input.launchId }));
          fs.fsyncSync(fd);
        }
        finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temp, gate);
      };
      if (!receipt) {
        check();
        updateMusicLaunch(input.userId, input.launchId, { provider_state: "submitting" });
        persistGate(null);
        submitted = true;
        receipt = await submitMusic(config, request, source, input.signal);
        updateMusicLaunch(input.userId, input.launchId, { provider_receipt: receipt, provider_state: "running" });
        persistGate(receipt);
      }
      else {
        submitted = true;
        persistGate(receipt);
      }
      event("music.receipt", { taskId: receipt, provider: "acestep", model: config.model });
      stage("Generating music");
      const deadline = Date.now() + 20 * 60000;
      let polled;
      for (; ;) {
        check();
        if (Date.now() > deadline)
          throw new Error("Generation timed out. Provider computation may continue; collection has stopped.");
        polled = await queryMusic(config, receipt, input.signal);
        if (polled.state !== "running")
          break;
        await delay(1500, undefined, { signal: input.signal });
      }
      updateMusicLaunch(input.userId, input.launchId, { provider_state: polled.state });
      if (gate) {
        fs.rmSync(gate, { force: true });
        gate = null;
      }
      if (polled.state === "failed")
        throw new Error(polled.code ?? "ACE-Step failed to generate audio. Check the provider log for memory or model errors.");
      stage("Retrieving and checking audio");
      await fetchAudio(config, polled.file, generated, input.signal);
      resolvedSeed = polled.seed;
    }
    check();
    let measured = inspectWav(generated), output = generated;
    if (request.preserveOutsideInterval && source && request.interval) {
      measured = spliceWav(source, generated, spliced, request.interval);
      output = spliced;
    }
    let analysis = "Optional LUFS, tempo, and key analysis unavailable.";
    try {
      const result = await dependencies.runAudioAnalysis({
        path: output, options: parseAnalysisOptions({ analysis: "full" }),
        scope: { userId: input.userId, gardenId: context.clusterId === null ? null : String(context.clusterId), conversationId: input.conversationPublicId },
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
      });
      analysis = result.report.slice(0, 6000);
    }
    catch {
      check();
    }
    stage("Saving audio to this conversation");
    check();
    const saved = await publishMusic({
      userId: input.userId, id: input.launchId, context, request, sourceFile: output, authorizedRoot: input.workspace,
      signal: input.signal, metadata: {
        provider: arrangement ? "resonant" : "acestep", providerRevision: arrangement ? RESONANT_REVISION : ACESTEP_REVISION, model: arrangement ? "resonant-dsp" : config.model, resolvedSeed, ...(arrangement ? { arrangement } : {}),
        actualDuration: measured.duration, measurements: measured, analysis, providerReceipt: receipt, outsideIntervalPreserved: request.preserveOutsideInterval
      }
    });
    collected = true;
    const params = `conversationId=${encodeURIComponent(input.conversationPublicId)}&version=${saved.version}`;
    const url = `/api/hermes/artifacts/${saved.artifact.id}/preview?${params}`;
    const summary = `[Music · version ${saved.version}](${url})\n\nRequested ${request.duration}s; measured ${measured.duration.toFixed(2)}s. ${request.operation === "variation" ? "Full regeneration." : request.operation === "repaint" ? request.preserveOutsideInterval ? "Samples outside the selected interval were preserved by a bounded splice." : "Interval-conditioned repaint; unchanged audio outside the interval is not guaranteed." : ""}\n\nPeak: ${measured.peakDbfs?.toFixed(1) ?? "silent"} dBFS; clipped samples: ${measured.clippedSamples}.\n\n${analysis}\n\nBPM/key estimates and conditioning do not guarantee exact performance or lyric accuracy. No listening-based quality judgment was performed.`;
    const resultSummary = summary + (saved.lyricsId ? `\n\n[Lyrics](/api/hermes/artifacts/${saved.lyricsId}/download?conversationId=${encodeURIComponent(input.conversationPublicId)}&version=1)` : "");
    updateMusicLaunch(input.userId, input.launchId, { artifact_id: saved.artifact.id, artifact_version: saved.version, collection_state: "completed", summary: resultSummary });
    finishExternalAgentTurn({ conversationId: context.conversationId, clientMessageId: launch.client_message_id, outcome: "completed", content: resultSummary });
    event("run.completed", { summary: resultSummary, artifactId: saved.artifact.id, version: saved.version, duration: measured.duration });
    return { status: "completed" };
  }
  catch (error) {
    const launch = musicLaunch(input.userId, input.launchId);
    const aborted = input.signal.aborted || ["cancelling", "aborted"].includes(launch.collection_state);
    const ambiguous = (submitted || ["submitting", "uncertain", "draining", "arranging"].includes(launch.provider_state)) && !launch.provider_receipt;
    const providerState = ambiguous ? "uncertain" : submitted && !["succeeded", "failed"].includes(launch.provider_state) ? "draining" : launch.provider_state;
    let summary = collected || launch.artifact_id ? "A valid audio artifact was saved before collection stopped. It remains available in this conversation’s artifacts." : aborted
      ? `Collection stopped. ${submitted || ambiguous ? "Provider computation may continue; GPU interruption is not confirmed." : "No generation was submitted."}`
      : `${musicError(error).message}${providerState === "uncertain" ? " Submission is uncertain; retry requires an explicit new request." : ""}`;
    if (launch.provider_receipt && !launch.artifact_id && providerState !== "failed")
      summary += `\n\nTo collect this existing receipt without submitting another track, send /agents:music-producer --resume ${input.launchId} in this conversation. The provider must still retain its result.`;
    updateMusicLaunch(input.userId, input.launchId, { collection_state: aborted ? "aborted" : ambiguous ? "uncertain" : "failed", provider_state: providerState, summary });
    if (context) {
      try {
        finishExternalAgentTurn({ conversationId: context.conversationId, clientMessageId: launch.client_message_id, outcome: aborted ? "aborted" : "failed", content: summary });
      }
      catch { /* The owning conversation may have been deleted. */ }
    }
    event(aborted ? "run.aborted" : "run.failed", { summary, error: summary, code: musicError(error).code, providerCancellation: providerState });
    return { status: aborted ? "aborted" : "failed" };
  }
  finally {
    await dependencies.releaseSupervisorLease(lease).catch(() => undefined);
    if (context) {
      try {
        finishRuntimeRun(context.runId, collected ? "completed" : "error");
      }
      catch { /* A deleted chat may have removed the binding. */ }
    }
    for (const file of [generated, spliced])
      fs.rmSync(file, { force: true });
  }
}
