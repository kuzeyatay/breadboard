"use client";

// Teach Workflow: the whole flow from "show me" to a saved workflow.
//
// Four screens, one per state the session can actually be in — setup, recording,
// processing, review. Nothing is captured before the person presses Start
// teaching, and the recording state says plainly what is being captured while it
// is happening.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DemonstratedProcedure,
  TeachSessionSummary,
  WorkflowInput,
  WorkflowStep,
} from "@/lib/teach/types";
import {
  controlTeachSession,
  desktopShell,
  formatElapsed,
  listMicrophones,
  loadTeachAvailability,
  loadTeachSession,
  saveTeachSession,
  startNarrationRecorder,
  startTeachSession,
  uploadNarration,
  TEACH_CHANNEL,
  type MicrophoneDevice,
  type NarrationRecorder,
  type TeachAvailabilityView,
  type TeachChannelMessage,
  type TeachSessionView,
} from "./teach-client";

const POLL_MS = 1_200;

type Phase = "setup" | "recording" | "processing" | "review" | "failed";

export interface TeachWorkflowProps {
  /** Set when a second demonstration is correcting an existing workflow. */
  reteachWorkflowId?: string | null;
  reteachName?: string;
  onSaved: (workflowId: string) => void;
  onClose: () => void;
}

export default function TeachWorkflow({
  reteachWorkflowId = null,
  reteachName,
  onSaved,
  onClose,
}: TeachWorkflowProps) {
  const [availability, setAvailability] = useState<TeachAvailabilityView | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(reteachName ?? "");
  const [objective, setObjective] = useState("");
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [microphoneId, setMicrophoneId] = useState<string>("");
  const [micGranted, setMicGranted] = useState(false);
  const [busy, setBusy] = useState(false);

  const [session, setSession] = useState<TeachSessionSummary | null>(null);
  const [view, setView] = useState<TeachSessionView | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<NarrationRecorder | null>(null);
  const startedAtRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadTeachAvailability(controller.signal)
      .then(setAvailability)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError((cause as Error).message);
      });
    return () => controller.abort();
  }, []);

  /* ---------------- microphone ---------------- */

  const requestMicrophone = useCallback(async () => {
    try {
      // Opening the stream is what makes the device labels readable, so the
      // picker is only worth showing after permission has been granted.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of probe.getTracks()) track.stop();
      setMicGranted(true);
      const devices = await listMicrophones();
      setMicrophones(devices);
      if (devices.length > 0 && !microphoneId) setMicrophoneId(devices[0].deviceId);
    } catch (cause) {
      setError(
        (cause as Error).name === "NotAllowedError"
          ? "Breadboard needs permission to use the microphone before it can hear your narration."
          : (cause as Error).message,
      );
    }
  }, [microphoneId]);

  /* ---------------- start ---------------- */

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let recorder: NarrationRecorder | null = null;
    try {
      // The microphone is opened first: if it is going to be refused, it should
      // be refused before anything is captured, not after.
      recorder = await startNarrationRecorder(microphoneId || undefined);
      const started = await startTeachSession({
        name: name.trim() || undefined,
        objective: objective.trim() || undefined,
        reteachWorkflowId,
      });
      recorderRef.current = recorder;
      startedAtRef.current = started.startedAtEpochMs;
      setSession(started.session);
      setPhase("recording");
      void desktopShell()?.openTeachController(started.session.id).catch(() => undefined);
    } catch (cause) {
      recorder?.discard();
      recorderRef.current = null;
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, microphoneId, name, objective, reteachWorkflowId]);

  /* ---------------- controls ---------------- */

  const pause = useCallback(async () => {
    if (!session) return;
    recorderRef.current?.pause();
    setSession(await controlTeachSession(session.id, "pause"));
  }, [session]);

  const resume = useCallback(async () => {
    if (!session) return;
    recorderRef.current?.resume();
    setSession(await controlTeachSession(session.id, "resume"));
  }, [session]);

  const finish = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        const audio = await recorder.stop();
        // Narration is uploaded before the session is finished, because
        // finishing is what starts the analysis and the analysis reads it.
        await uploadNarration(session.id, audio, recorder.startedAtEpochMs - startedAtRef.current);
      }
      setSession(await controlTeachSession(session.id, "finish"));
      setPhase("processing");
      void desktopShell()?.closeTeachController().catch(() => undefined);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, session]);

  const cancel = useCallback(async () => {
    if (!session) {
      onClose();
      return;
    }
    recorderRef.current?.discard();
    recorderRef.current = null;
    void desktopShell()?.closeTeachController().catch(() => undefined);
    await controlTeachSession(session.id, "cancel").catch(() => undefined);
    onClose();
  }, [onClose, session]);

  /* ---------------- the floating controller ---------------- */

  useEffect(() => {
    if (!session || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TEACH_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<TeachChannelMessage>) => {
      const message = event.data;
      if (!message || message.sessionId !== session.id || !message.request) return;
      // The floating window is a control surface, not a second owner: the tab
      // holding the microphone is the one that can stop it properly, so the
      // request comes here and this is where it is carried out.
      if (message.request === "pause") void pause();
      else if (message.request === "resume") void resume();
      else if (message.request === "finish") void finish();
      else if (message.request === "cancel") void cancel();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [cancel, finish, pause, resume, session]);

  /* ---------------- ticking ---------------- */

  useEffect(() => {
    if (phase !== "recording" || !session) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const meter = recorderRef.current?.level() ?? 0;
      setElapsedMs(elapsed);
      setLevel(meter);
      channelRef.current?.postMessage({
        sessionId: session.id,
        state: session.state,
        elapsedMs: elapsed,
        level: meter,
      } satisfies TeachChannelMessage);
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase, session]);

  /* ---------------- polling while analysing ---------------- */

  useEffect(() => {
    if (phase !== "processing" || !session) return;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const next = await loadTeachSession(session.id, controller.signal);
        if (cancelled) return;
        setView(next);
        setSession(next.session);
        if (next.session.state === "review") setPhase("review");
        else if (next.session.state === "failed") {
          setError(next.session.error ?? "The demonstration could not be analysed.");
          setPhase("failed");
        }
      } catch {
        // A missed poll is not a failed analysis; the next tick asks again.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phase, session]);

  useEffect(
    () => () => {
      // A component unmounted mid-recording must not leave the microphone open.
      recorderRef.current?.discard();
      recorderRef.current = null;
    },
    [],
  );

  /* ---------------- render ---------------- */

  if (phase === "setup") {
    return (
      <SetupScreen
        availability={availability}
        error={error}
        name={name}
        onName={setName}
        objective={objective}
        onObjective={setObjective}
        microphones={microphones}
        microphoneId={microphoneId}
        onMicrophone={setMicrophoneId}
        micGranted={micGranted}
        onRequestMicrophone={() => void requestMicrophone()}
        onStart={() => void start()}
        onCancel={onClose}
        busy={busy}
        reteachName={reteachWorkflowId ? reteachName : undefined}
      />
    );
  }

  if (phase === "recording") {
    return (
      <RecordingScreen
        elapsedMs={elapsedMs}
        level={level}
        paused={session?.state === "paused"}
        busy={busy}
        error={error}
        onPause={() => void pause()}
        onResume={() => void resume()}
        onFinish={() => void finish()}
        onCancel={() => void cancel()}
      />
    );
  }

  if (phase === "processing") {
    return <ProcessingScreen processing={view?.processing ?? null} onCancel={() => void cancel()} />;
  }

  if (phase === "failed") {
    return (
      <div className="neu-inset rounded-2xl border border-[var(--line)] p-6 text-center">
        <h3 className="text-base font-semibold text-[var(--ink-heading)]">
          This demonstration could not be turned into a workflow
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="neu-button mt-5 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Back to workflows
        </button>
      </div>
    );
  }

  if (!view?.draft) {
    return (
      <div className="neu-inset rounded-2xl border border-[var(--line)] p-8 text-center text-sm text-[var(--ink-muted)]">
        Loading what Breadboard learned…
      </div>
    );
  }

  return (
    <ReviewScreen
      // Keyed on the session so the editable copy is initialised once, when the
      // draft arrives, rather than being synchronised back from props on every
      // render -- which would throw away the user's edits.
      key={session?.id ?? "draft"}
      draft={view.draft}
      view={view}
      error={error}
      onDiscard={() => void cancel()}
      onSave={async (procedure, answers, retainRecording) => {
        if (!session) return;
        setBusy(true);
        setError(null);
        try {
          const saved = await saveTeachSession({
            sessionId: session.id,
            procedure,
            answers,
            retainRecording,
          });
          onSaved(saved.workflowId);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      busy={busy}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

function SetupScreen(props: {
  availability: TeachAvailabilityView | null;
  error: string | null;
  name: string;
  onName: (value: string) => void;
  objective: string;
  onObjective: (value: string) => void;
  microphones: MicrophoneDevice[];
  microphoneId: string;
  onMicrophone: (value: string) => void;
  micGranted: boolean;
  onRequestMicrophone: () => void;
  onStart: () => void;
  onCancel: () => void;
  busy: boolean;
  reteachName?: string;
}) {
  const blocked = props.availability !== null && !props.availability.available;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-5">
        <h2 className="text-base font-semibold text-[var(--ink-heading)]">
          {props.reteachName ? `Re-teach "${props.reteachName}"` : "Teach a workflow"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Perform the task once while describing important decisions aloud. Breadboard will turn the
          demonstration into a reusable workflow.
        </p>
        {props.reteachName ? (
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
            This demonstration becomes a new version. The version running today is kept.
          </p>
        ) : null}
      </div>

      {blocked ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-4 text-xs leading-5 text-[var(--danger)]">
          {props.availability?.reason}
        </div>
      ) : null}

      <div className="neu-inset space-y-4 rounded-2xl border border-[var(--line)] p-5">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
            Name (optional)
          </span>
          <input
            value={props.name}
            onChange={(event) => props.onName(event.target.value)}
            placeholder="File the weekly expense report"
            className="neu-input mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
            What are you about to do? (optional)
          </span>
          <textarea
            value={props.objective}
            onChange={(event) => props.onObjective(event.target.value)}
            rows={2}
            placeholder="A sentence here helps Breadboard tell the task from the incidental clicks."
            className="neu-input mt-1.5 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm"
          />
        </label>

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
            Microphone
          </span>
          {props.micGranted ? (
            <select
              value={props.microphoneId}
              onChange={(event) => props.onMicrophone(event.target.value)}
              className="neu-input mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm"
            >
              {props.microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={props.onRequestMicrophone}
              className="neu-button mt-1.5 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            >
              Choose a microphone
            </button>
          )}
        </div>
      </div>

      <div className="neu-inset rounded-2xl border border-[var(--line)] p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
          While you demonstrate, Breadboard captures
        </h3>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-body)]">
          <li>· your microphone, so it can hear why you are doing each thing</li>
          <li>· the clicks, typing and shortcuts you perform</li>
          <li>· which application and window each action happened in</li>
          <li>· screenshots of the moments around each action</li>
        </ul>
        <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
          Capture starts only when you press Start teaching and stops when you press Finish. Text you
          type into a password or secret field is detected and left out. The recording stays on this
          machine, and is deleted once the workflow has been built from it unless you keep it.
        </p>
      </div>

      {props.error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {props.error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className="neu-button rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onStart}
          disabled={props.busy || blocked || !props.micGranted}
          className="neu-button-primary rounded-xl border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          Start teaching
        </button>
      </div>
      {!props.micGranted && !blocked ? (
        <p className="text-right text-[11px] text-[var(--ink-muted)]">
          Choose a microphone first — narration is what tells Breadboard why, not just what.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

export function RecordingControls(props: {
  elapsedMs: number;
  level: number;
  paused: boolean;
  busy: boolean;
  compact?: boolean;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 ${props.compact ? "" : "flex-wrap"}`}>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-3 w-3 rounded-full ${props.paused ? "bg-[var(--ink-muted)]" : "animate-pulse bg-red-500"}`}
        />
        <span className="font-mono text-sm tabular-nums text-[var(--ink-heading)]">
          {formatElapsed(props.elapsedMs)}
        </span>
      </span>

      <span
        className="relative h-2 w-20 overflow-hidden rounded-full bg-[var(--paper-strong)]"
        role="meter"
        aria-label="Microphone level"
        aria-valuenow={Math.round(props.level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--botanical)] transition-[width] duration-100"
          style={{ width: `${Math.round(props.level * 100)}%` }}
        />
      </span>

      <button
        type="button"
        onClick={props.paused ? props.onResume : props.onPause}
        className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs"
      >
        {props.paused ? "Resume" : "Pause"}
      </button>
      <button
        type="button"
        onClick={props.onFinish}
        disabled={props.busy}
        className="neu-button-primary rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      >
        Finish
      </button>
      <button
        type="button"
        onClick={props.onCancel}
        className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--danger)]"
      >
        Cancel
      </button>
    </div>
  );
}

function RecordingScreen(props: {
  elapsedMs: number;
  level: number;
  paused: boolean;
  busy: boolean;
  error: string | null;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const floating = desktopShell() !== null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-5">
        <h2 className="text-base font-semibold text-[var(--ink-heading)]">
          {props.paused ? "Paused" : "Recording your demonstration"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Switch to the application you want to teach and do the task once, describing the decisions
          out loud as you go. Say which values change each time, what you check before committing to
          something, and anything Breadboard should ask you about rather than do on its own.
        </p>
        <div className="mt-4">
          <RecordingControls {...props} />
        </div>
      </div>

      <div className="neu-inset rounded-2xl border border-[var(--line)] p-4 text-xs leading-5 text-[var(--ink-muted)]">
        {floating
          ? "A small recorder window is floating above your other applications, so you can finish without coming back here."
          : "Leave this tab open while you work — it is holding the microphone. Come back to it to finish."}
      </div>

      {props.error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

function ProcessingScreen(props: {
  processing: { stage: string; detail?: string } | null;
  onCancel: () => void;
}) {
  const label = (() => {
    switch (props.processing?.stage) {
      case "installing-speech":
        return props.processing.detail ?? "Preparing the local speech engine…";
      case "transcribing":
        return "Listening back to your narration…";
      case "analysing":
        return "Working out what the workflow actually is…";
      default:
        return "Reading the demonstration…";
    }
  })();

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 text-center">
      <div className="neu-inset rounded-2xl border border-[var(--line)] p-8">
        <p className="text-sm font-medium text-[var(--ink-heading)]">{label}</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-[var(--ink-muted)]">
          The first demonstration on a machine also installs the speech engine, which takes a few
          minutes. After that it is seconds.
        </p>
      </div>
      <button
        type="button"
        onClick={props.onCancel}
        className="neu-button rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
      >
        Discard this demonstration
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Review
 * ------------------------------------------------------------------ */

function ReviewScreen(props: {
  draft: DemonstratedProcedure;
  view: TeachSessionView | null;
  error: string | null;
  busy: boolean;
  onDiscard: () => void;
  onSave: (
    procedure: DemonstratedProcedure,
    answers: Record<string, string>,
    retainRecording: boolean,
  ) => void;
}) {
  const [procedure, setProcedure] = useState<DemonstratedProcedure>(props.draft);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [retain, setRetain] = useState(false);

  const unanswered = useMemo(
    () => procedure.ambiguities.filter((question) => !answers[question.id]),
    [answers, procedure],
  );

  const patch = (change: Partial<DemonstratedProcedure>): void =>
    setProcedure((current) => ({ ...current, ...change }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-8">
      <div className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-5">
        <h2 className="text-base font-semibold text-[var(--ink-heading)]">Here&apos;s what I learned</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Nothing is saved yet. Change anything that is wrong, answer the questions below, and this
          becomes a workflow in your list.
        </p>
        {props.view?.diff ? (
          <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] p-3 text-xs leading-5 text-[var(--ink-body)]">
            Compared with the version running now: {props.view.diff.summary}
          </p>
        ) : null}
      </div>

      <Section title="Name">
        <input
          value={procedure.name}
          onChange={(event) => patch({ name: event.target.value })}
          className="neu-input w-full rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm"
        />
      </Section>

      <Section title="Goal">
        <textarea
          value={procedure.goal}
          onChange={(event) => patch({ goal: event.target.value })}
          rows={2}
          className="neu-input w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm"
        />
      </Section>

      <Section
        title="Inputs"
        hint="Values you supply each time you run it. Everything else is treated as fixed."
      >
        {procedure.inputs.length === 0 ? (
          <p className="text-xs text-[var(--ink-muted)]">
            This workflow takes no inputs — it does the same thing every time.
          </p>
        ) : (
          <ul className="space-y-2">
            {procedure.inputs.map((input, index) => (
              <InputRow
                key={input.name}
                input={input}
                onChange={(next) =>
                  patch({
                    inputs: procedure.inputs.map((entry, position) =>
                      position === index ? next : entry,
                    ),
                  })
                }
                onRemove={() =>
                  patch({ inputs: procedure.inputs.filter((_, position) => position !== index) })
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Steps">
        <ol className="space-y-2">
          {procedure.steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              onChange={(next) =>
                patch({
                  steps: procedure.steps.map((entry, position) => (position === index ? next : entry)),
                })
              }
              onRemove={() =>
                patch({ steps: procedure.steps.filter((_, position) => position !== index) })
              }
            />
          ))}
        </ol>
      </Section>

      {procedure.constraints.length > 0 ? (
        <Section title="Rules">
          <ul className="space-y-2">
            {procedure.constraints.map((constraint, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="mt-2 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                  {constraint.kind}
                </span>
                <input
                  value={constraint.text}
                  onChange={(event) =>
                    patch({
                      constraints: procedure.constraints.map((entry, position) =>
                        position === index ? { ...entry, text: event.target.value } : entry,
                      ),
                    })
                  }
                  className="neu-input flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-1.5 text-sm"
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title="Approvals"
        hint="Breadboard will stop and ask before each of these, every time it runs."
      >
        {procedure.approvals.length === 0 ? (
          <p className="text-xs text-[var(--ink-muted)]">
            Nothing in this workflow needs asking about.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {procedure.approvals.map((approval) => {
              const step = procedure.steps.find((entry) => entry.id === approval.stepId);
              return (
                <li key={approval.stepId} className="text-sm leading-6 text-[var(--ink-body)]">
                  <span className="font-medium">{step?.instruction ?? approval.stepId}</span>
                  <span className="text-[var(--ink-muted)]"> — {approval.reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Success condition">
        <ul className="space-y-2">
          {procedure.successCriteria.map((criterion, index) => (
            <li key={index}>
              <input
                value={criterion.text}
                onChange={(event) =>
                  patch({
                    successCriteria: procedure.successCriteria.map((entry, position) =>
                      position === index ? { text: event.target.value } : entry,
                    ),
                  })
                }
                className="neu-input w-full rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-1.5 text-sm"
              />
            </li>
          ))}
          {procedure.successCriteria.length === 0 ? (
            <li className="text-xs text-[var(--ink-muted)]">
              Breadboard could not tell what “finished” means for this task. Add it here so a run can
              be checked.
            </li>
          ) : null}
        </ul>
      </Section>

      {procedure.ambiguities.length > 0 ? (
        <Section
          title="Questions"
          hint="The demonstration did not settle these, so Breadboard is asking rather than guessing."
        >
          <div className="space-y-4">
            {procedure.ambiguities.map((question) => (
              <fieldset key={question.id} className="space-y-2">
                <legend className="text-sm leading-6 text-[var(--ink-body)]">{question.question}</legend>
                {question.options.map((option) => (
                  <label key={option.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={question.id}
                      value={option.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
                      className="mt-1"
                    />
                    <span className="text-[var(--ink-body)]">
                      {option.label}
                      {option.recommended ? (
                        <span className="ml-2 text-[11px] text-[var(--ink-muted)]">
                          (what the demonstration suggests)
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </Section>
      ) : null}

      <label className="flex items-center gap-2 px-1 text-xs text-[var(--ink-muted)]">
        <input type="checkbox" checked={retain} onChange={(event) => setRetain(event.target.checked)} />
        Keep the recording so I can watch this demonstration later
      </label>

      {props.error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {props.error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {unanswered.length > 0 ? (
          <span className="mr-auto text-[11px] text-[var(--ink-muted)]">
            {unanswered.length} question{unanswered.length === 1 ? "" : "s"} still unanswered — saving
            now leaves them as noted uncertainty.
          </span>
        ) : null}
        <button
          type="button"
          onClick={props.onDiscard}
          className="neu-button rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--danger)]"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => props.onSave(procedure, answers, retain)}
          disabled={props.busy}
          className="neu-button-primary rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          Save workflow
        </button>
      </div>
    </div>
  );
}

function Section(props: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="neu-inset rounded-2xl border border-[var(--line)] p-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {props.title}
      </h3>
      {props.hint ? (
        <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">{props.hint}</p>
      ) : null}
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function InputRow(props: {
  input: WorkflowInput;
  onChange: (next: WorkflowInput) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <input
        value={props.input.label}
        onChange={(event) => props.onChange({ ...props.input, label: event.target.value })}
        className="neu-input flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-1.5 text-sm"
      />
      <code className="mt-1.5 shrink-0 text-[11px] text-[var(--ink-muted)]">
        {`{{${props.input.name}}}`}
      </code>
      <button
        type="button"
        onClick={props.onRemove}
        aria-label={`Remove the ${props.input.label} input`}
        className="neu-button-icon mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)]"
      >
        ×
      </button>
    </li>
  );
}

function StepRow(props: {
  step: WorkflowStep;
  index: number;
  onChange: (next: WorkflowStep) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 w-5 shrink-0 text-center text-xs text-[var(--ink-muted)]">
          {props.index + 1}
        </span>
        <input
          value={props.step.instruction}
          onChange={(event) => props.onChange({ ...props.step, instruction: event.target.value })}
          className="neu-input flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={props.onRemove}
          aria-label={`Remove step ${props.index + 1}`}
          className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)]"
        >
          ×
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-[11px] text-[var(--ink-muted)]">
        <span>{props.step.action}</span>
        {props.step.target ? <span>· {props.step.target}</span> : null}
        {props.step.expectation ? <span>· expects {props.step.expectation}</span> : null}
        {props.step.uncertain ? <span className="text-[var(--danger)]">· unclear</span> : null}
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={props.step.approvalRequired === true}
            onChange={(event) =>
              props.onChange({ ...props.step, approvalRequired: event.target.checked })
            }
          />
          Ask me first
        </label>
      </div>
    </li>
  );
}
