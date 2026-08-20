"use client";

// The Vox Director production artifact.
//
// Everything here renders from the stored production — no request is made and
// no model runs, so reopening a finished film is instant and always shows the
// cut as it was produced.
//
// The film itself is an ordinary video artifact, played here by id and equally
// playable anywhere else in Breadboard. This page is the production around it:
// the beat map, each poster with the prompt that drew it and the pieces that
// were animated, the look and why it was chosen, and an honest account of which
// backend produced each part.

import { useMemo, useState } from "react";
import { productionDuration } from "@/lib/vox-director/types.ts";
import type { VoxBeat, VoxProduction, VoxShot } from "@/lib/vox-director/types";

const SECTIONS = ["Film", "Beats", "Posters", "Look", "Production"] as const;
type Section = (typeof SECTIONS)[number];

function artifactUrl(artifactId: string, conversationId: string): string {
  const query = new URLSearchParams({ conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifactId)}/preview?${query}`;
}

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const buttonClass =
  "rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--surface-2)]";

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--line)] py-2 last:border-b-0">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function ShotCard({
  beat,
  shot,
  conversationId,
}: {
  beat: VoxBeat;
  shot: VoxShot;
  conversationId: string;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const poster = shot.poster;
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] p-3">
      {poster?.artifactId ? (
        // eslint-disable-next-line @next/next/no-img-element -- an auth-scoped artifact blob from our own API, not a next/image source
        <img
          className="w-full rounded-xl border border-[var(--line)] object-cover"
          src={artifactUrl(poster.artifactId, conversationId)}
          alt={`Poster for beat ${beat.id}, shot ${shot.id}`}
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-[var(--line)] text-xs text-[var(--ink-muted)]">
          The poster file is in the run workspace, not in the archive.
        </div>
      )}
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold text-[var(--ink-heading)]">{shot.key}</span>
        <span className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
          {shot.shotSize} · {shot.cameraMove} · {shot.duration.toFixed(1)}s
        </span>
        {shot.clipBackend ? (
          <span className="text-[11px] text-[var(--ink-muted)]">rendered: {shot.clipBackend}</span>
        ) : null}
      </header>
      <p className="text-sm text-[var(--ink)]">{shot.scene}</p>
      {shot.elementMotion ? (
        <p className="text-xs text-[var(--ink-muted)]">Motion: {shot.elementMotion}</p>
      ) : null}
      {shot.motionPlan?.elements.length ? (
        <p className="text-xs text-[var(--ink-muted)]">
          Pieces: {shot.motionPlan.elements.map((element) => `${element.name} (${element.entrance})`).join(", ")}
        </p>
      ) : null}
      {shot.clipNote ? (
        <p className="text-xs text-[var(--ink-muted)]">Note: {shot.clipNote}</p>
      ) : null}
      {shot.imagePrompt ? (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setShowPrompt((current) => !current)}
            >
              {showPrompt ? "Hide" : "Show"} poster prompt
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                void navigator.clipboard?.writeText(shot.imagePrompt);
              }}
            >
              Copy
            </button>
          </div>
          {showPrompt ? (
            <p className="whitespace-pre-wrap rounded-xl bg-[var(--surface-2)] p-2 text-xs text-[var(--ink-muted)]">
              {shot.imagePrompt}
            </p>
          ) : null}
        </div>
      ) : null}
      {poster?.render ? (
        <p className="text-[11px] text-[var(--ink-muted)]">
          {poster.render.checkpoint} · seed {poster.render.seed} · {poster.render.steps} steps ·
          cfg {poster.render.cfg} · {poster.render.samplerName}/{poster.render.scheduler} ·{" "}
          {poster.render.width}×{poster.render.height}
        </p>
      ) : null}
    </article>
  );
}

export default function VoxProductionArtifact({
  production,
  conversationId,
}: {
  production: VoxProduction;
  conversationId: string;
}) {
  const [section, setSection] = useState<Section>("Film");
  const film = production.renderPlan.video ?? null;
  const runtime = useMemo(() => productionDuration(production), [production]);
  const shots = useMemo(
    () => production.beats.flatMap((beat) => beat.shots.map((shot) => ({ beat, shot }))),
    [production],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <nav className="flex flex-wrap gap-1">
        {SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              section === name
                ? "bg-[var(--ink)] text-[var(--surface)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
            }`}
            onClick={() => setSection(name)}
          >
            {name}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "Film" ? (
          film?.artifactId ? (
            <div className="flex flex-col gap-3">
              <video
                className="w-full rounded-2xl border border-[var(--line)] bg-black"
                src={artifactUrl(film.artifactId, conversationId)}
                controls
                playsInline
                preload="metadata"
              />
              <div className="flex flex-wrap items-center gap-2">
                <a
                  className={buttonClass}
                  href={`${artifactUrl(film.artifactId, conversationId)}&download=1`}
                  download={film.filename}
                >
                  Download {film.filename}
                </a>
                <p className="text-xs text-[var(--ink-muted)]">
                  {film.width}×{film.height} · {formatSeconds(film.durationSeconds)} ·{" "}
                  {film.shotCount} shot{film.shotCount === 1 ? "" : "s"} ·{" "}
                  {(film.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <p className="text-sm text-[var(--ink-muted)]">{production.logline}</p>
            </div>
          ) : (
            <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--ink-muted)]">
              {production.renderPlan.videoReason ||
                "This production has no stored video file. Its beat map, posters and prompts are below."}
            </p>
          )
        ) : null}

        {section === "Beats" ? (
          <ol className="flex flex-col gap-3">
            {production.beats.map((beat) => (
              <li key={beat.id} className="rounded-2xl border border-[var(--line)] p-3">
                <header className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-[var(--ink-heading)]">
                    {beat.id}. {beat.title}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                    {beat.background}
                    {beat.feel ? ` · ${beat.feel}` : ""}
                    {beat.hook ? ` · ${beat.hook}` : ""}
                  </span>
                </header>
                <p className="mt-1 text-sm text-[var(--ink)]">{beat.narration}</p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {beat.shots.length} shot{beat.shots.length === 1 ? "" : "s"}
                  {beat.narrationSeconds
                    ? ` · narration ${beat.narrationSeconds.toFixed(1)}s`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        ) : null}

        {section === "Posters" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shots.map(({ beat, shot }) => (
              <ShotCard
                key={shot.key}
                beat={beat}
                shot={shot}
                conversationId={conversationId}
              />
            ))}
          </div>
        ) : null}

        {section === "Look" ? (
          <dl className="rounded-2xl border border-[var(--line)] px-3">
            <Row label="Theme" value={production.style.theme} />
            <Row label="Idiom" value={production.style.idiom} />
            <Row label="Palette" value={production.style.palette} />
            <Row label="Typography" value={production.style.typeStyle} />
            <Row label="Print finish" value={production.style.finish} />
            <Row label="Mood" value={production.style.mood} />
            <Row label="Motion amplitude" value={production.style.motionStyle} />
            <Row label="Captions" value={production.style.captionStyle} />
            <Row label="Why this look" value={production.style.rationale} />
          </dl>
        ) : null}

        {section === "Production" ? (
          <dl className="rounded-2xl border border-[var(--line)] px-3">
            <Row label="Brief" value={production.brief} />
            <Row label="Arc" value={`${production.arc} · ending ${production.ending}`} />
            <Row
              label="Shape"
              value={`${production.beats.length} beats · ${shots.length} shots · about ${Math.round(runtime)}s · ${production.aspectRatio}`}
            />
            <Row
              label="Posters"
              value={`${production.renderPlan.posterCount} drawn by ${production.renderPlan.imageBackend}${
                production.seed === null ? "" : ` · seed ${production.seed}`
              }`}
            />
            <Row label="Poster notes" value={production.renderPlan.imageBackendReason} />
            <Row label="Motion" value={production.renderPlan.motionBackend} />
            <Row label="Motion notes" value={production.renderPlan.motionBackendReason} />
            <Row
              label="Narration"
              value={`${production.renderPlan.narrationVoice} · ${production.renderPlan.narrationBackend}`}
            />
            <Row
              label="Music"
              value={`${production.renderPlan.musicSource}${
                production.renderPlan.musicReason ? ` — ${production.renderPlan.musicReason}` : ""
              }`}
            />
            <Row label="Render notes" value={production.renderPlan.videoReason} />
            <Row label="Run" value={production.runId} />
            <Row label="Made" value={production.createdAt} />
            {production.revisions.length ? (
              <div className="border-b border-[var(--line)] py-2 last:border-b-0">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                  Earlier briefs in this chat
                </dt>
                <dd>
                  <ol className="list-decimal pl-4 text-sm text-[var(--ink)]">
                    {production.revisions.map((revision, index) => (
                      <li key={`${index}-${revision.slice(0, 24)}`}>{revision}</li>
                    ))}
                  </ol>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
