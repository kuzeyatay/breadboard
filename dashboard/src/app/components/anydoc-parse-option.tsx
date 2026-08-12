"use client";

// The "Parse with anydoc" upload option, shared by the garden workspace and the
// dashboard upload modals so the two stay in step.
//
// Availability is probed rather than assumed: the option runs a native module,
// and when its binary is missing the checkbox says so instead of failing at
// upload time.

import { useCallback, useEffect, useState } from "react";

export interface AnydocAvailability {
  enabled: boolean;
  available: boolean;
  version: string;
  detail?: string;
}

const UNKNOWN: AnydocAvailability = {
  enabled: false,
  available: false,
  version: "",
};

export { ANYDOC_PARSE_FILE_RE } from "@/lib/anydoc/formats";

export function useAnydocAvailability(active: boolean): {
  status: AnydocAvailability;
  loading: boolean;
  refresh: () => void;
} {
  // The result carries the request it answered, so "in flight" is derived
  // rather than stored — no setState in the effect body, and a refresh flips
  // back to loading on its own.
  const [result, setResult] = useState<{
    request: number;
    status: AnydocAvailability;
  } | null>(null);
  const [request, setRequest] = useState(0);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let canceled = false;

    const settle = (status: AnydocAvailability) => {
      if (!canceled) setResult({ request, status });
    };

    fetch("/api/anydoc/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AnydocAvailability | null) => settle(data ?? UNKNOWN))
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

export function anydocUnavailableReason(status: AnydocAvailability): string {
  if (!status.enabled) {
    return "Turned off — set ANYDOC_ENABLED=true to use it.";
  }
  return (
    "The anydoc converter is not installed" +
    (status.detail ? ` (${status.detail})` : "") +
    " — run `npm install @firecrawl/anydoc` in dashboard/."
  );
}

export function AnydocParseOption({
  checked,
  onChange,
  disabled,
  status,
  loading,
  overriddenByVlm,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  status: AnydocAvailability;
  loading: boolean;
  /** True when Parse using VLM is on and would claim the same PDFs. */
  overriddenByVlm?: boolean;
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
        <span className="block text-sm text-gray-400">Parse with anydoc</span>
        <span className="block text-[11px] text-gray-600 mt-0.5">
          {loading
            ? "Checking for the anydoc converter…"
            : usable
              ? `Converts Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV and text PDFs to clean Markdown${
                  status.version ? ` with anydoc ${status.version}` : ""
                } — headings, tables, lists and links survive instead of being flattened to raw text. Runs locally in milliseconds, so it uses no ChatMock quota.${
                  overriddenByVlm
                    ? " Parse using VLM still takes the PDFs and images while both are on."
                    : ""
                }`
              : anydocUnavailableReason(status)}
        </span>
      </span>
    </label>
  );
}
