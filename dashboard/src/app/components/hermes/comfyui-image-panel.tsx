"use client";

// The Advanced way to make a picture: the local ComfyUI, with its own knobs.
//
// The other two modes ask a hosted model for something good and take what comes
// back. This one is for when that is not the answer — when the picture has to
// come off this machine, or has to be reproducible, or has to be made with a
// specific checkpoint. So the controls here are ComfyUI's own vocabulary
// (checkpoint, sampler, scheduler, steps, CFG, seed) rather than a friendlier
// invention, because a person who wants this tab already thinks in them and a
// renamed knob would only make their settings unportable.
//
// It is also the only image mode with a *state machine* in front of it: ComfyUI
// may be missing, installing, installed-but-stopped, running-without-models or
// ready, and each of those needs a different sentence and a different button.
// That is decided on the server (see lib/comfyui/service.ts) and this panel
// renders the answer rather than trying to work it out from parts.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComfyUiStatus } from "@/lib/comfyui/status";
import { COMFYUI_DEFAULT_NEGATIVE, COMFYUI_LIMITS } from "@/lib/comfyui/workflow";

export interface ComfyUiRenderRequest {
  checkpoint: string;
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  width: number;
  height: number;
  seed: number | null;
}

interface Props {
  /** What the post is about; the opening positive prompt. */
  seedPrompt: string;
  /** Rebuilds that opening prompt from the copy as it stands now. */
  onRebuildPrompt: () => string;
  /** False when there is no chat to file the artwork in. */
  canCreateImages: boolean;
  /** True while any part of the studio is busy. */
  busy: boolean;
  /** True while this panel's own render is in flight. */
  rendering: boolean;
  onRender: (request: ComfyUiRenderRequest) => Promise<void>;
  /** Told once, so the studio can drop the Advanced tab when it is switched off. */
  onDisabled?: () => void;
}

const fieldClass =
  "w-full rounded-[13px] border border-[color-mix(in_srgb,var(--line)_70%,transparent)] bg-[var(--paper-surface)] px-3 py-2 text-[13px] leading-[1.618] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--line-strong)]";
const buttonClass =
  "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "neu-button neu-button-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "block text-xs font-medium text-[var(--ink-heading)]";

/** Sizes worth one tap. Anything else is still reachable through the numbers. */
const SIZE_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: "Square", width: 1024, height: 1024 },
  { label: "Portrait", width: 832, height: 1216 },
  { label: "Landscape", width: 1216, height: 832 },
];

const POLL_WHILE_INSTALLING_MS = 3_000;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} kB`;
}

/** `sd_xl_base_1.0.safetensors` reads better as `sd_xl_base_1.0`. */
function modelLabel(name: string): string {
  return name.replace(/\.(safetensors|ckpt|sft|pt)$/i, "");
}

export default function ComfyUiImagePanel({
  seedPrompt,
  onRebuildPrompt,
  canCreateImages,
  busy,
  rendering,
  onRender,
  onDisabled,
}: Props) {
  const [status, setStatus] = useState<ComfyUiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<null | "setup" | "start">(null);

  const [prompt, setPrompt] = useState(seedPrompt);
  const [negativePrompt, setNegativePrompt] = useState(COMFYUI_DEFAULT_NEGATIVE);
  const [checkpoint, setCheckpoint] = useState("");
  const [samplerName, setSamplerName] = useState("");
  const [scheduler, setScheduler] = useState("");
  const [steps, setSteps] = useState<number>(COMFYUI_LIMITS.steps.default);
  const [cfg, setCfg] = useState<number>(COMFYUI_LIMITS.cfg.default);
  const [width, setWidth] = useState<number>(COMFYUI_LIMITS.size.default);
  const [height, setHeight] = useState<number>(COMFYUI_LIMITS.size.default);
  const [lockSeed, setLockSeed] = useState(false);
  const [seed, setSeed] = useState(0);
  const [showAdvancedNumbers, setShowAdvancedNumbers] = useState(false);
  const disabledReported = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/comfyui", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        comfyui?: ComfyUiStatus;
        error?: string;
      };
      if (!response.ok || !data.comfyui) {
        throw new Error(data.error ?? "ComfyUI could not be reached.");
      }
      setStatus(data.comfyui);
      setError(null);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "ComfyUI could not be reached.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // An install runs for minutes in another process, so the only way this panel
  // learns it finished is by asking again.
  useEffect(() => {
    if (status?.state !== "installing") return;
    const timer = setInterval(() => void refresh(), POLL_WHILE_INSTALLING_MS);
    return () => clearInterval(timer);
  }, [refresh, status?.state]);

  useEffect(() => {
    if (status?.state === "disabled" && !disabledReported.current) {
      disabledReported.current = true;
      onDisabled?.();
    }
  }, [onDisabled, status?.state]);

  // Keep the pickers on options the server actually offers: a checkpoint the
  // user removed between two openings of this tab must not stay selected.
  useEffect(() => {
    const capabilities = status?.capabilities;
    if (!capabilities) return;
    setCheckpoint((current) =>
      current && capabilities.checkpoints.includes(current)
        ? current
        : (capabilities.checkpoints[0] ?? ""),
    );
    setSamplerName((current) =>
      current && capabilities.samplers.includes(current) ? current : (capabilities.samplers[0] ?? ""),
    );
    setScheduler((current) =>
      current && capabilities.schedulers.includes(current)
        ? current
        : (capabilities.schedulers[0] ?? ""),
    );
  }, [status?.capabilities]);

  async function act(action: "setup" | "start") {
    setActing(action);
    setError(null);
    try {
      const response = await fetch("/api/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        comfyui?: ComfyUiStatus;
        error?: string;
      };
      if (data.comfyui) setStatus(data.comfyui);
      if (!response.ok) throw new Error(data.error ?? "That did not work.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setActing(null);
    }
  }

  function render() {
    void onRender({
      checkpoint,
      prompt,
      negativePrompt,
      steps,
      cfg,
      samplerName,
      scheduler,
      width,
      height,
      seed: lockSeed ? seed : null,
    });
  }

  if (loading && !status) {
    return <p className="text-xs text-[var(--ink-muted)]">Looking for ComfyUI…</p>;
  }

  const state = status?.state ?? "unavailable";

  if (state !== "ready" && state !== "no_models") {
    const setup = status?.setup;
    return (
      <div className="space-y-3">
        <p className="text-xs leading-[1.618] text-[var(--ink)]">
          {status?.message ?? error ?? "ComfyUI could not be reached."}
        </p>

        {state === "installing" && setup ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
            <p className="text-xs text-[var(--ink-heading)]">
              {setup.step && setup.totalSteps
                ? `Step ${setup.step} of ${setup.totalSteps}`
                : "Working"}
            </p>
            {setup.detail ? (
              <p className="mt-1 truncate text-[11px] text-[var(--ink-muted)]">{setup.detail}</p>
            ) : null}
            {setup.progress ? (
              <>
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--neu-surface-pressed)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={setup.progress.totalBytes}
                  aria-valuenow={setup.progress.receivedBytes}
                >
                  <div
                    className="h-full rounded-full bg-[var(--botanical)]"
                    style={{
                      width: `${Math.round(
                        (setup.progress.receivedBytes / setup.progress.totalBytes) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] tabular-nums text-[var(--ink-muted)]">
                  {formatBytes(setup.progress.receivedBytes)} of{" "}
                  {formatBytes(setup.progress.totalBytes)}
                </p>
              </>
            ) : null}
            {setup.stalled ? (
              <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">
                The installer stopped reporting. Start it again to pick up where it left off.
              </p>
            ) : null}
          </div>
        ) : null}

        {state === "not_installed" && status?.managed ? (
          <>
            <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
              Setting up downloads PyTorch and the ComfyUI dependencies — several gigabytes, and
              several minutes. It runs in the background; you can keep working. Model files are not
              downloaded: put your own in <code>comfyui/models/checkpoints</code>.
            </p>
            <button
              type="button"
              className={`${primaryButtonClass} w-full`}
              disabled={acting !== null}
              onClick={() => void act("setup")}
            >
              {acting === "setup" ? "Starting the install…" : "Set up ComfyUI"}
            </button>
          </>
        ) : null}

        {state === "stopped" ? (
          <button
            type="button"
            className={`${primaryButtonClass} w-full`}
            disabled={acting !== null}
            onClick={() => void act("start")}
          >
            {acting === "start" ? "Starting…" : "Start ComfyUI"}
          </button>
        ) : null}

        {state === "unavailable" ? (
          <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
            Breadboard looks for ComfyUI at <code>{status?.baseUrl}</code>. Point{" "}
            <code>COMFYUI_URL</code> somewhere else if yours runs on another port.
          </p>
        ) : null}

        <button type="button" className={`${buttonClass} w-full`} onClick={() => void refresh()}>
          Check again
        </button>

        {error ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const capabilities = status?.capabilities;
  const noModels = state === "no_models";

  return (
    <div className="space-y-3">
      {noModels ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs leading-[1.618] text-[var(--ink)]">{status?.message}</p>
          <button
            type="button"
            className={`${buttonClass} mt-2 w-full`}
            onClick={() => void refresh()}
          >
            Look again
          </button>
        </div>
      ) : null}

      <label className={labelClass}>
        Model
        <select
          className={`${fieldClass} mt-1.5`}
          value={checkpoint}
          disabled={noModels}
          onChange={(event) => setCheckpoint(event.target.value)}
        >
          {(capabilities?.checkpoints ?? []).map((name) => (
            <option key={name} value={name}>
              {modelLabel(name)}
            </option>
          ))}
          {noModels ? <option value="">No models installed</option> : null}
        </select>
      </label>

      <label className={labelClass}>
        Describe the image
        <textarea
          className={`${fieldClass} mt-1.5 min-h-32 resize-y`}
          value={prompt}
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <label className={labelClass}>
        Keep out of the image
        <textarea
          className={`${fieldClass} mt-1.5 min-h-16 resize-y`}
          value={negativePrompt}
          maxLength={4000}
          onChange={(event) => setNegativePrompt(event.target.value)}
        />
      </label>

      <div>
        <span className={labelClass}>Shape</span>
        <div className="mt-1.5 flex gap-2">
          {SIZE_PRESETS.map((preset) => {
            const active = preset.width === width && preset.height === height;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-[var(--botanical)] bg-[var(--paper-raised)] text-[var(--ink-heading)]"
                    : "border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
                }`}
                onClick={() => {
                  setWidth(preset.width);
                  setHeight(preset.height);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className={labelClass}>
        Steps: <span className="tabular-nums">{steps}</span>
        <input
          type="range"
          className="mt-1.5 w-full accent-[var(--botanical)]"
          min={COMFYUI_LIMITS.steps.min}
          max={60}
          value={steps}
          onChange={(event) => setSteps(Number(event.target.value))}
        />
      </label>

      <label className={labelClass}>
        Prompt adherence (CFG): <span className="tabular-nums">{cfg.toFixed(1)}</span>
        <input
          type="range"
          className="mt-1.5 w-full accent-[var(--botanical)]"
          min={1}
          max={20}
          step={0.5}
          value={cfg}
          onChange={(event) => setCfg(Number(event.target.value))}
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-[var(--ink-heading)]">
          <input
            type="checkbox"
            className="accent-[var(--botanical)]"
            checked={lockSeed}
            onChange={(event) => setLockSeed(event.target.checked)}
          />
          Reuse a seed
        </label>
        <input
          className={`${fieldClass} w-40`}
          type="number"
          min={0}
          value={seed}
          disabled={!lockSeed}
          aria-label="Seed"
          onChange={(event) => setSeed(Math.max(0, Number(event.target.value) || 0))}
        />
      </div>
      <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
        The same seed with the same settings makes the same picture. Leave it off to get a new one
        each time.
      </p>

      <button
        type="button"
        className={`${buttonClass} w-full`}
        aria-expanded={showAdvancedNumbers}
        onClick={() => setShowAdvancedNumbers((open) => !open)}
      >
        {showAdvancedNumbers ? "Hide sampler and size" : "Sampler and exact size"}
      </button>

      {showAdvancedNumbers ? (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <label className={labelClass}>
            Sampler
            <select
              className={`${fieldClass} mt-1.5`}
              value={samplerName}
              onChange={(event) => setSamplerName(event.target.value)}
            >
              {(capabilities?.samplers ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Scheduler
            <select
              className={`${fieldClass} mt-1.5`}
              value={scheduler}
              onChange={(event) => setScheduler(event.target.value)}
            >
              {(capabilities?.schedulers ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className={`${labelClass} flex-1`}>
              Width
              <input
                className={`${fieldClass} mt-1.5`}
                type="number"
                min={COMFYUI_LIMITS.size.min}
                max={COMFYUI_LIMITS.size.max}
                step={COMFYUI_LIMITS.size.step}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              Height
              <input
                className={`${fieldClass} mt-1.5`}
                type="number"
                min={COMFYUI_LIMITS.size.min}
                max={COMFYUI_LIMITS.size.max}
                step={COMFYUI_LIMITS.size.step}
                value={height}
                onChange={(event) => setHeight(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`${primaryButtonClass} w-full`}
        disabled={busy || noModels || !prompt.trim() || !checkpoint || !canCreateImages}
        onClick={render}
      >
        {rendering ? "Rendering…" : "Render with ComfyUI"}
      </button>
      <button
        type="button"
        className={`${buttonClass} w-full`}
        disabled={busy}
        onClick={() => setPrompt(onRebuildPrompt())}
      >
        Rebuild the prompt from the current copy
      </button>

      <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
        Rendered on this machine
        {capabilities?.device ? ` (${capabilities.device})` : ""}. The picture is filed in your
        archive like any other, with these settings kept alongside it.
      </p>

      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
