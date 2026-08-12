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

export function vlmUnavailableReason(status: VlmOcrAvailability): string {
  if (!status.enabled) {
    return "Turned off — set VLM_OCR_ENABLED=true to use it.";
  }
  return (
    `No OCR model server at ${status.baseUrl || "the configured address"}` +
    (status.detail ? ` (${status.detail})` : "") +
    ", and auto-start is off."
  );
}

export function VlmParseOption({
  checked,
  onChange,
  disabled,
  status,
  loading,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  status: VlmOcrAvailability;
  loading: boolean;
}) {
  const usable = status.available && !loading;

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
          {loading
            ? "Checking for the local OCR model…"
            : usable
              ? `Reads every page with HunyuanOCR (${status.source || "local GGUF"}) and writes structured Markdown — headings, tables, formulas, and figures cropped out of the page. Runs locally, so it uses no ChatMock quota.${
                  status.running
                    ? ""
                    : " The model server starts on first use, which downloads the weights once."
                }`
              : vlmUnavailableReason(status)}
        </span>
      </span>
    </label>
  );
}
