"use client";

// Video Use setup: what the editor can already do, and what widens it.
//
// There is no environment to build here — the clone's renderer is Python
// standard library and the toolchain is the ffmpeg this repository already
// ships, so an edit works out of the box. The only thing worth checking is
// speech, and both engines that provide it run on this machine: Scriberr, the
// transcription service Breadboard already supervises, and a fallback Whisper
// venv for when it is not up. With neither, the editor plans from the silence
// map — trimming, pacing, framing and look all work; cutting on what was said
// and burning captions do not.
//
// Nothing on this panel is a credential. No key, no account, no upload.

import { useCallback, useEffect, useState } from "react";

interface SubtitleHealth {
  available: boolean;
  cloned: boolean;
  uvAvailable: boolean;
  models: string[];
  reason: string | null;
}

interface ScriberrHealth {
  ready: boolean;
  url: string;
  reason: string | null;
}

interface Health {
  available: boolean;
  cloned: boolean;
  transcriptionReady: boolean;
  transcriptionProvider: string | null;
  visualQcReady: boolean;
  scriberr: ScriberrHealth;
  subtitles: SubtitleHealth;
  root: string | null;
  ffmpeg: string | null;
  python: string | null;
  reason: string | null;
}

const EMPTY_SUBTITLES: SubtitleHealth = {
  available: false,
  cloned: false,
  uvAvailable: false,
  models: [],
  reason: null,
};

const EMPTY_SCRIBERR: ScriberrHealth = { ready: false, url: "", reason: null };

const EMPTY: Health = {
  available: false,
  cloned: false,
  transcriptionReady: false,
  transcriptionProvider: null,
  visualQcReady: false,
  scriberr: EMPTY_SCRIBERR,
  subtitles: EMPTY_SUBTITLES,
  root: null,
  ffmpeg: null,
  python: null,
  reason: null,
};

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.available) return { label: "Missing a tool", ready: false };
  return {
    label: health.transcriptionReady ? "Ready" : "Ready (no speech)",
    ready: true,
  };
}

export default function VideoUseSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/video-use/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as { health?: Partial<Health>; error?: string };
      if (!response.ok || !payload.health) throw new Error("Video Use status is unavailable.");
      const value = payload.health;
      setHealth({
        ...EMPTY,
        available: value.available === true,
        cloned: value.cloned === true,
        transcriptionReady: value.transcriptionReady === true,
        transcriptionProvider:
          typeof value.transcriptionProvider === "string" ? value.transcriptionProvider : null,
        visualQcReady: value.visualQcReady === true,
        scriberr: {
          ...EMPTY_SCRIBERR,
          ...(value.scriberr && typeof value.scriberr === "object"
            ? (value.scriberr as ScriberrHealth)
            : {}),
        },
        subtitles: {
          ...EMPTY_SUBTITLES,
          ...(value.subtitles && typeof value.subtitles === "object"
            ? (value.subtitles as SubtitleHealth)
            : {}),
        },
        root: typeof value.root === "string" ? value.root : null,
        ffmpeg: typeof value.ffmpeg === "string" ? value.ffmpeg : null,
        python: typeof value.python === "string" ? value.python : null,
        reason: typeof value.reason === "string" ? value.reason : null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        ...EMPTY,
        reason: error instanceof Error ? error.message : "Video Use status is unavailable.",
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- health is fetched; every setState inside `load` happens after an await */
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function submit(
    action: "recheck_speech" | "build_subtitles" | "remove_subtitles",
  ) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/video-use/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: { ok?: boolean; message?: string; detail?: string };
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "That did not work.");
      setNotice(payload.result?.message ?? "Done.");
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const status = statusOf(health);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] ${
            status.ready
              ? "bg-[var(--paper-strong)] text-[var(--botanical)]"
              : "bg-[#f5e8df] text-[#9a4e43] dark:bg-[#4c302c] dark:text-[#efb4aa]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.ready ? "bg-[var(--botanical)]" : "bg-current"}`}
          />
          {status.label}
        </span>
        <span className="text-[11px] text-[var(--ink-muted)]">Cloned video-use</span>
      </div>

      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Edits</span> a video you already
        have. Attach one in chat and say what to change, or open any video artifact and use its
        studio. Every pass replays the whole edit against the untouched original, so revisions never
        stack up as re-encodes and any earlier version can be restored.
      </p>

      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Clone</span> {health.root}
        </p>
      ) : null}

      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}

      <section className="space-y-2">
        <h4 className="text-[11px] font-semibold text-[var(--ink-heading)]">
          Speech {health?.scriberr.ready ? "— Scriberr is up" : "— Scriberr is not answering"}
        </h4>
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          {health?.scriberr.ready
            ? "Edits can cut on what was said — filler words, false starts, a specific sentence — and burn in captions. Scriberr transcribes on this machine, so nothing is uploaded and no key is needed. Transcripts are made once per video and cached."
            : "Speech is transcribed by Scriberr, the local service Breadboard already runs for garden video transcription. While it is down the editor plans from the silence map: trims, pacing, framing, speed and look all work; filler-word cuts and burned captions do not."}
        </p>
        {health?.scriberr.reason && !health.scriberr.ready ? (
          <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">
            {health.scriberr.reason}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("recheck_speech")}
            className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
          >
            {busy ? "Checking…" : "Recheck"}
          </button>
          {health?.scriberr.url ? (
            <span className="truncate text-[10px] text-[var(--ink-muted)]">
              {health.scriberr.url}
            </span>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-[11px] font-semibold text-[var(--ink-heading)]">
          Fallback engine {health?.subtitles.available ? "— ready" : "— optional"}
        </h4>
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          {health?.subtitles.available
            ? "subsai stands in when Scriberr is down: Whisper runs in its own venv here, so speech-aware cuts keep working. The first run of each model size downloads its weights."
            : "subsai runs Whisper in a venv of its own, as a stand-in for the times Scriberr is not up. It costs around a gigabyte and several minutes to build, so it is built only when you ask."}
        </p>
        {health?.subtitles.cloned ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !health.subtitles.uvAvailable}
              onClick={() => void submit("build_subtitles")}
              title={
                health.subtitles.uvAvailable
                  ? "Creates subsai/.venv with Python 3.11, CPU torch and faster-whisper."
                  : "uv is needed to build this environment."
              }
              className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
            >
              {busy
                ? "Working…"
                : health.subtitles.available
                  ? "Rebuild environment"
                  : "Build environment"}
            </button>
            {health.subtitles.available ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit("remove_subtitles")}
                className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
              >
                Remove environment
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">
            The subsai clone was not found next to the dashboard.
          </p>
        )}
        {health?.subtitles.reason && !health.subtitles.available ? (
          <p className="text-[11px] leading-5 text-[var(--ink-muted)]">{health.subtitles.reason}</p>
        ) : null}
      </section>

      {notice ? (
        <p className="text-[11px] leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
