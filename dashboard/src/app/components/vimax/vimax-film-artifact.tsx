"use client";

// The ViMax film artifact.
//
// Everything here renders from the stored production — no request is made and
// no model runs, so reopening a film is instant and always shows the cut as it
// was produced.
//
// The Film tab plays the production as an animatic: each shot holds the screen
// for the duration the storyboard artist gave it, its drawn first frame drifts
// slowly in the direction the shot's motion describes, and the dialogue for
// that shot sits under it. That is what makes this a film rather than a
// document — upstream ViMax animates the same first frame with a video model,
// which needs a paid video API; the shot list, the timings and the prompts are
// identical either way, which is why each shot keeps the exact prompt a video
// model would render it from.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ReclaimingVideo } from "@/app/components/reclaiming-media";
import { productionDuration } from "@/lib/vimax/types.ts";
import type {
  VimaxCharacter,
  VimaxProduction,
  VimaxShot,
} from "@/lib/vimax/types";

const SECTIONS = ["Film", "Storyboard", "Screenplay", "Cast", "Production"] as const;
type Section = (typeof SECTIONS)[number];

/** Playback speeds, so a long film can be reviewed quickly. */
const SPEEDS = [0.5, 1, 2] as const;

function frameUrl(artifactId: string, conversationId: string): string {
  const query = new URLSearchParams({ conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifactId)}/preview?${query}`;
}

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Where the camera drifts during a shot. ViMax grades every shot's internal
 * change as large, medium or small; the animatic borrows that grade for how far
 * the frame travels, so a transition shot reads differently from a reaction.
 */
function driftForShot(shot: VimaxShot): { from: string; to: string } {
  const motion = shot.motion.toLowerCase();
  const scale = shot.variation === "large" ? 1.18 : shot.variation === "medium" ? 1.1 : 1.05;
  const pushIn = /push[- ]?in|dolly in|zoom in|closer|move in/.test(motion);
  const pullOut = /pull[- ]?out|dolly out|zoom out|pull back|wider/.test(motion);
  const panLeft = /pan(?:s|ning)? left|tracks? left|moves? left/.test(motion);
  const panRight = /pan(?:s|ning)? right|tracks? right|moves? right/.test(motion);
  const tiltUp = /tilts? up|cranes? up|rises?/.test(motion);
  const tiltDown = /tilts? down|cranes? down|descends?/.test(motion);

  const shift = shot.variation === "large" ? 4 : 2.5;
  const x = panLeft ? shift : panRight ? -shift : 0;
  const y = tiltUp ? shift : tiltDown ? -shift : 0;

  if (pullOut) {
    return { from: `scale(${scale}) translate(0%, 0%)`, to: `scale(1) translate(${x}%, ${y}%)` };
  }
  if (pushIn) {
    return { from: "scale(1) translate(0%, 0%)", to: `scale(${scale}) translate(${x}%, ${y}%)` };
  }
  // No explicit camera move: a slow, almost imperceptible push keeps a still
  // frame from reading as a stalled video.
  return {
    from: "scale(1.02) translate(0%, 0%)",
    to: `scale(${scale}) translate(${x}%, ${y}%)`,
  };
}

function captionFor(shot: VimaxShot): { speaker: string; line: string }[] {
  const lines = shot.dialogue
    .filter((entry) => entry.line.trim())
    .map((entry) => ({
      speaker: entry.speaker.trim(),
      line: entry.emotion.trim()
        ? `(${entry.emotion.trim()}) ${entry.line.trim()}`
        : entry.line.trim(),
    }));
  if (shot.narration?.trim()) {
    lines.unshift({ speaker: "Narration", line: shot.narration.trim() });
  }
  return lines;
}

function VariationBadge({ shot }: { shot: VimaxShot }) {
  const tone =
    shot.variation === "large"
      ? "text-[#9a4438] dark:text-[#efb4aa]"
      : shot.variation === "medium"
        ? "text-[#9a6b16] dark:text-[#e0b464]"
        : "text-[var(--ink-muted)]";
  return (
    <span className={`text-[10px] uppercase tracking-wide ${tone}`} title={shot.variationReason}>
      {shot.variation} change
    </span>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-[var(--ink-heading)]">{value}</p>
    </div>
  );
}

/**
 * A shot with no drawn frame still has to hold the screen for its duration, so
 * it plays as a title card built from its own first-frame description.
 *
 * The description is a paragraph — a storyboard artist writes 400 to 900
 * characters per frame — and a paragraph does not fit in a 16:9 box the size of
 * a thumbnail. It is clamped to the lines the box can hold and the full text
 * stays a hover away, because the alternative is text pouring out of every card
 * on the page.
 */
function FrameCard({
  shot,
  sceneHeading,
  size,
}: {
  shot: VimaxShot;
  sceneHeading: string;
  /** "stage" is the player's own frame; "thumb" is a card in the grid. */
  size: "stage" | "thumb";
}) {
  const text = shot.firstFrame.description || shot.visualDescription;
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[var(--paper-strong)] text-center ${
        size === "stage" ? "gap-2 px-[8%] py-6" : "gap-1 px-3 py-2"
      }`}
      title={text}
    >
      <p
        className={`shrink-0 uppercase tracking-[0.2em] text-[var(--ink-muted)] ${
          size === "stage" ? "text-[10px]" : "text-[8px]"
        }`}
      >
        {sceneHeading || `Shot ${shot.idx + 1}`}
      </p>
      <p
        className={`overflow-hidden text-[var(--ink)] ${
          size === "stage"
            ? "line-clamp-6 text-sm leading-6 md:line-clamp-[8] md:text-base"
            : "line-clamp-4 text-[11px] leading-4"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

export default function VimaxFilmArtifact({
  production,
  conversationId,
}: {
  production: VimaxProduction;
  conversationId: string;
}) {
  const [section, setSection] = useState<Section>("Film");
  const [shotIndex, setShotIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  // 0..1 through the current shot, driven by rAF so the drift and the progress
  // bar stay on the same clock.
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startedAt = useRef<number>(0);

  const shots = production.shots;
  /** The encoded film, when the run managed to make one. */
  const film = production.renderPlan.video ?? null;
  const shot = shots[Math.min(shotIndex, shots.length - 1)] ?? null;
  const runtime = useMemo(() => productionDuration(production), [production]);
  const elapsedBefore = useMemo(() => {
    const totals: number[] = [];
    let running = 0;
    for (const entry of shots) {
      totals.push(running);
      running += entry.durationSeconds;
    }
    return totals;
  }, [shots]);

  const goTo = useCallback((index: number) => {
    setShotIndex(index);
    setProgress(0);
    startedAt.current = 0;
  }, []);

  useEffect(() => {
    if (!playing || !shot) return;
    let cancelled = false;
    startedAt.current = performance.now();
    const durationMs = (shot.durationSeconds * 1_000) / speed;

    const step = (now: number) => {
      if (cancelled) return;
      const ratio = Math.min(1, (now - startedAt.current) / durationMs);
      setProgress(ratio);
      if (ratio >= 1) {
        if (shotIndex + 1 < shots.length) {
          setShotIndex(shotIndex + 1);
          setProgress(0);
        } else {
          setPlaying(false);
        }
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, shot, shotIndex, shots.length, speed]);

  const scene = shot ? production.scenes[shot.sceneIdx] : null;
  const drift = shot ? driftForShot(shot) : null;
  const captions = shot ? captionFor(shot) : [];
  const elapsed = shot ? elapsedBefore[shotIndex] + shot.durationSeconds * progress : 0;

  const tab = (name: Section) =>
    `rounded-lg px-3 py-1.5 text-xs transition ${
      section === name
        ? "bg-[var(--paper-raised)] font-semibold text-[var(--ink-heading)] shadow-sm"
        : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
    }`;
  const buttonClass =
    "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-heading)]";

  const aspectClass =
    production.aspectRatio === "9:16"
      ? "aspect-[9/16] max-h-[58vh]"
      : production.aspectRatio === "1:1"
        ? "aspect-square max-h-[58vh]"
        : "aspect-video";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--ink-heading)]">
            {production.title}
          </h2>
          {production.logline ? (
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">{production.logline}</p>
          ) : null}
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          {production.style} · {production.scenes.length} scene
          {production.scenes.length === 1 ? "" : "s"} · {shots.length} shot
          {shots.length === 1 ? "" : "s"} · {formatSeconds(runtime)}
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1">
        {SECTIONS.map((name) => (
          <button key={name} type="button" className={tab(name)} onClick={() => setSection(name)}>
            {name}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "Film" && film ? (
          // An encoded film is the film. The animatic below it is how the same
          // production is reviewed shot by shot, which the video cannot do.
          <div className="flex flex-col gap-3">
            <ReclaimingVideo
              className="w-full rounded-2xl border border-[var(--line)] bg-black"
              src={frameUrl(film.artifactId, conversationId)}
              controls
              playsInline
              preload="metadata"
            />
            <div className="flex flex-wrap items-center gap-2">
              <a
                className={buttonClass}
                href={`${frameUrl(film.artifactId, conversationId)}&download=1`}
                download={film.filename}
              >
                Download {film.filename}
              </a>
              <p className="text-xs text-[var(--ink-muted)]">
                {film.width}×{film.height} · {formatSeconds(film.durationSeconds)} ·{" "}
                {film.shotCount} shot{film.shotCount === 1 ? "" : "s"} · dialogue as subtitles
              </p>
            </div>
            <button
              type="button"
              className={`${buttonClass} self-start`}
              onClick={() => setSection("Storyboard")}
            >
              Review shot by shot
            </button>
          </div>
        ) : null}

        {section === "Film" && !film && shot ? (
          <div className="flex flex-col gap-3">
            <div
              className={`relative w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-black ${aspectClass}`}
            >
              {shot.firstFrame.image ? (
                <img
                  // Keyed on the shot so the drift animation restarts from that
                  // shot's own opening composition. Pausing only pauses it, so a
                  // paused shot holds the frame it had reached.
                  key={shot.idx}
                  src={frameUrl(shot.firstFrame.image.artifactId, conversationId)}
                  alt={shot.firstFrame.description.slice(0, 200)}
                  className="vimax-shot-drift h-full w-full object-cover"
                  style={
                    {
                      "--vimax-drift-from": drift?.from,
                      "--vimax-drift-to": drift?.to,
                      animationDuration: `${shot.durationSeconds / speed}s`,
                      animationPlayState: playing ? "running" : "paused",
                    } as CSSProperties
                  }
                />
              ) : (
                <FrameCard shot={shot} sceneHeading={scene?.heading ?? ""} size="stage" />
              )}

              {captions.length ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-[6%] pb-5 pt-12">
                  {captions.map((caption, index) => (
                    <p key={index} className="text-center text-sm leading-6 text-white md:text-base">
                      {caption.speaker ? (
                        <span className="font-semibold uppercase tracking-wide">
                          {caption.speaker}:{" "}
                        </span>
                      ) : null}
                      {caption.line}
                    </p>
                  ))}
                </div>
              ) : null}

              <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 font-mono text-[10px] text-white/85">
                {scene?.heading ?? ""} · shot {shot.idx + 1}/{shots.length} · cam {shot.camIdx}
              </p>
            </div>

            {/* One tick per shot: the film's spine, and how you jump around it. */}
            <div className="flex gap-[2px]">
              {shots.map((entry, index) => (
                <button
                  key={entry.idx}
                  type="button"
                  title={`Shot ${index + 1} — ${entry.firstFrame.description.slice(0, 120)}`}
                  onClick={() => goTo(index)}
                  className="group relative h-2 rounded-full bg-[var(--paper-raised)]"
                  style={{ flexGrow: entry.durationSeconds, flexBasis: 0 }}
                  aria-label={`Go to shot ${index + 1}`}
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-[var(--ink-heading)]"
                    style={{
                      width:
                        index < shotIndex ? "100%" : index === shotIndex ? `${progress * 100}%` : "0%",
                      opacity: index === shotIndex ? 1 : index < shotIndex ? 0.45 : 0,
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => goTo(Math.max(0, shotIndex - 1))}
                disabled={shotIndex === 0}
              >
                ‹ Previous
              </button>
              <button
                type="button"
                className={`${buttonClass} font-semibold`}
                onClick={() => {
                  if (!playing && shotIndex === shots.length - 1 && progress >= 1) goTo(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : progress > 0 || shotIndex > 0 ? "Play" : "Play film"}
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => goTo(Math.min(shots.length - 1, shotIndex + 1))}
                disabled={shotIndex >= shots.length - 1}
              >
                Next ›
              </button>
              <div className="flex items-center gap-1">
                {SPEEDS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${buttonClass} ${speed === option ? "font-semibold" : "opacity-70"}`}
                    onClick={() => setSpeed(option)}
                  >
                    {option}×
                  </button>
                ))}
              </div>
              <p className="ml-auto font-mono text-xs text-[var(--ink-muted)]">
                {formatSeconds(elapsed)} / {formatSeconds(runtime)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-heading)]">
                  Shot {shot.idx + 1}
                </p>
                <VariationBadge shot={shot} />
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{shot.visualDescription}</p>
              {shot.motion ? (
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                  <span className="uppercase tracking-wide">Motion </span>
                  {shot.motion}
                </p>
              ) : null}
              {shot.audioDescription ? (
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                  <span className="uppercase tracking-wide">Audio </span>
                  {shot.audioDescription}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {section === "Storyboard" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shots.map((entry) => {
              const entryScene = production.scenes[entry.sceneIdx];
              return (
                <article
                  key={entry.idx}
                  className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]"
                >
                  <div className="aspect-video w-full bg-black/80">
                    {entry.firstFrame.image ? (
                      <img
                        src={frameUrl(entry.firstFrame.image.artifactId, conversationId)}
                        alt={`Shot ${entry.idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FrameCard shot={entry} sceneHeading={entryScene?.heading ?? ""} size="thumb" />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono text-xs font-semibold text-[var(--ink-heading)]">
                        {entry.idx + 1}. cam {entry.camIdx} · {Math.round(entry.durationSeconds)}s
                      </p>
                      <VariationBadge shot={entry} />
                    </div>
                    <p
                      className="mt-1 line-clamp-4 text-xs leading-5 text-[var(--ink)]"
                      title={entry.firstFrame.description}
                    >
                      {entry.firstFrame.description}
                    </p>
                    {entry.motion ? (
                      <p
                        className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]"
                        title={entry.motion}
                      >
                        → {entry.motion}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="mt-2 text-[11px] text-[var(--ink-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink-heading)]"
                      onClick={() => {
                        void navigator.clipboard?.writeText(entry.videoPrompt);
                      }}
                    >
                      Copy render prompt
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {section === "Screenplay" ? (
          <div className="flex flex-col gap-4">
            {production.story ? (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-heading)]">
                  Story
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                  {production.story}
                </p>
              </section>
            ) : null}
            {production.scenes.map((entry) => (
              <section
                key={entry.idx}
                className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-4"
              >
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-[var(--ink-heading)]">
                  {entry.heading}
                </h3>
                {entry.atmosphere ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{entry.atmosphere}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">
                  {entry.script}
                </p>
              </section>
            ))}
          </div>
        ) : null}

        {section === "Cast" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {production.characters.map((character: VimaxCharacter) => (
              <article
                key={character.idx}
                className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]"
              >
                {character.portrait ? (
                  <img
                    src={frameUrl(character.portrait.artifactId, conversationId)}
                    alt={character.identifier}
                    className="aspect-[3/4] w-full object-cover"
                  />
                ) : null}
                <div className="p-3">
                  <p className="text-sm font-semibold text-[var(--ink-heading)]">
                    {character.identifier}
                    {character.isVisible ? null : (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                        never seen
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink)]">
                    {character.staticFeatures}
                  </p>
                  {character.dynamicFeatures ? (
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                      {character.dynamicFeatures}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {section === "Production" ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Chip label="Pipeline" value={production.mode} />
              <Chip label="Style" value={production.style} />
              <Chip label="Frame" value={production.aspectRatio} />
              <Chip label="Runtime" value={formatSeconds(runtime)} />
              <Chip label="Scenes" value={String(production.scenes.length)} />
              <Chip label="Shots" value={String(shots.length)} />
              <Chip label="Cast" value={String(production.characters.length)} />
              <Chip
                label="Frames drawn"
                value={`${production.renderPlan.drawnFrameCount}/${shots.length}`}
              />
            </div>
            <Note title="How this was rendered">
              {[
                production.renderPlan.imageBackendReason,
                production.renderPlan.videoBackendReason,
              ]
                .filter(Boolean)
                .join("\n\n") || "Drawn and encoded from the storyboard."}
            </Note>
            {production.userRequirement ? (
              <Note title="Creative requirements">{production.userRequirement}</Note>
            ) : null}
            <Note title="Brief">{production.revisions.join("\n\n→ ")}</Note>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-heading)]">
        {title}
      </h3>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">{children}</p>
    </section>
  );
}
