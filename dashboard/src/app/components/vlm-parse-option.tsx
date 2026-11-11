"use client";

// The "Parse using VLM" upload option, shared by the garden workspace and the
// dashboard upload modals so the two stay in step.
//
// Availability is probed rather than assumed: the option reads pages with a
// local HunyuanOCR GGUF through llama.cpp, and when that is not installed the
// checkbox says so instead of failing at upload time.

import { useCallback, useEffect, useState } from "react";

export interface VlmOcrAvailability {
  enabled: boolean;
  available: boolean;
  running: boolean;
  autoStart: boolean;
  managed: boolean;
  /** Runtime service state; "installation-unavailable" means the weights are not installed yet. */
  serviceState?: string | null;
  baseUrl: string;
  source: string;
  detail?: string;
}

const UNKNOWN: VlmOcrAvailability = {
  enabled: false,
  available: false,
  running: false,
  autoStart: false,
  managed: false,
  baseUrl: "",
  source: "",
};

/** Files the VLM can read: it works on rendered pages, not on file formats. */
export const VLM_PARSE_FILE_RE = /\.(pdf|jpg|jpeg|png|webp)$/i;

export function useVlmOcrAvailability(active: boolean): {
  status: VlmOcrAvailability;
  loading: boolean;
  refresh: () => void;
} {
  // The result carries the request it answered, so "in flight" is derived
  // rather than stored — no setState in the effect body, and a refresh flips
  // back to loading on its own.
  const [result, setResult] = useState<{
    request: number;
    status: VlmOcrAvailability;
  } | null>(null);
  const [request, setRequest] = useState(0);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let canceled = false;

    const settle = (status: VlmOcrAvailability) => {
      if (!canceled) setResult({ request, status });
    };

    fetch("/api/vlm-ocr/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: VlmOcrAvailability | null) => settle(data ?? UNKNOWN))
      .catch(() => settle(UNKNOWN));

    return () => {
      canceled = true;
    };
  }, [active, request]);

  return {
    status: result?.status ?? UNKNOWN,
    loading: active && result?.request !== request,
    refresh,
  };
}

export function vlmOcrNeedsInstall(status: VlmOcrAvailability): boolean {
  return status.enabled && status.managed && status.serviceState === "installation-unavailable";
}

export function vlmUnavailableReason(status: VlmOcrAvailability): string {
  if (!status.enabled) {
    return "Local OCR is turned off in this Breadboard's settings.";
  }
  if (vlmOcrNeedsInstall(status)) {
    return "The local OCR model is not installed yet (1.3 GB download).";
  }
  return (
    "Local OCR is not available right now" +
    (status.detail ? ` (${status.detail})` : "") +
    "."
  );
}

export function VlmParseOption({
  checked,
  onChange,
  disabled,
  status,
  loading,
  onInstalled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  status: VlmOcrAvailability;
  loading: boolean;
  /** Called once an install the user started here has finished, so the probe can run again. */
  onInstalled?: () => void;
}) {
  const usable = status.available && !loading;
  const install = useOptionalComponentInstall("vlm-ocr", onInstalled);

  return (
    <label
      className={`flex items-start gap-2.5 select-none ${
        usable ? "cursor-pointer" : "cursor-not-allowed"
      }`}
    >
      <input
        type="checkbox"
        checked={checked && usable}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled || !usable}
        className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
      />
      <span>
        <span className="block text-sm text-gray-400">Parse using VLM</span>
        <span className="block text-[11px] text-gray-600 mt-0.5">
          Uses a local OCR model to read each page and turn it into structured
          notes, preserving headings, tables, formulas, and figures.
        </span>
        {!usable && (
          <span className="block text-[11px] text-gray-600 mt-0.5">
            {loading ? "Checking for the local OCR model…" : vlmUnavailableReason(status)}
          </span>
        )}
        {!usable && !loading && vlmOcrNeedsInstall(status) && (
          <span className="mt-1 flex items-center gap-2">
            <button
              type="button"
              disabled={install.busy}
              onClick={(event) => {
                event.preventDefault();
                void install.start();
              }}
              className="rounded border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
            >
              {install.busy ? "Installing…" : "Install local OCR"}
            </button>
            {install.message && (
              <span className={`text-[11px] ${install.failed ? "text-red-400" : "text-gray-500"}`}>{install.message}</span>
            )}
          </span>
        )}
      </span>
    </label>
  );
}

/** Start one optional-component install and follow its Runtime job to the end. */
function useOptionalComponentInstall(id: string, onInstalled?: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage("Downloading… this can take a while.");
    try {
      const started = await fetch("/api/optional-components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "install" }),
      });
      const submitted = (await started.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!started.ok || !submitted.ok || !submitted.jobId) throw new Error(submitted.error ?? `HTTP ${started.status}`);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const polled = await fetch(`/api/optional-components?job=${encodeURIComponent(submitted.jobId)}`);
        const data = (await polled.json()) as { ok: boolean; job?: { done: boolean; ok: boolean | null; message: string }; error?: string };
        if (!polled.ok || !data.ok || !data.job) throw new Error(data.error ?? `HTTP ${polled.status}`);
        if (!data.job.done) continue;
        setMessage(data.job.message);
        setFailed(data.job.ok !== true);
        if (data.job.ok) onInstalled?.();
        break;
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, id, onInstalled]);
  return { start, busy, message, failed };
}
