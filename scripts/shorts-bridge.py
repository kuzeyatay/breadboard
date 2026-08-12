"""Cut one video into shorts and report progress as NDJSON.

Breadboard drives the cloned AI-Youtube-Shorts-Generator the same way its own
CLI does — download, transcribe, rank highlights, cut and reframe each one —
using the clone's own functions for every step. Nothing about the pipeline is
reimplemented here.

Why a bridge and not `main.py`: the CLI runs the whole thing behind one call
(`generate_shorts`) and prints a report at the end, so there is no way to show a
download that is still running or a clip that has just landed. This runs the
clone's four local-mode stages in the clone's own order and writes an event per
transition, so the chat card can show where a run actually is.

It also runs the clone in `--mode local` only. API mode routes every stage
through MuAPI, which is a paid third-party account; local mode uses yt-dlp,
faster-whisper, ffmpeg and an OpenAI-compatible endpoint, and Breadboard already
has one of those in ChatMock. The clone reads `OPENAI_BASE_URL` through the
OpenAI SDK, so pointing it at ChatMock needs no change to the checkout.

Protocol: the job is one JSON object on stdin; every event is one JSON object on
stdout. The clone's own prints are redirected to stderr so stdout stays NDJSON.
Event types:

    started    {source, clipCount, aspectRatio, model}
    stage      {stage, status, label}          per pipeline transition
    source     {path, cached}                  the downloaded (or given) file
    transcript {segments, durationSec}
    highlights {found, kept, items}            ranked candidates
    clip       {index, total, status, ...}     one short, started or finished
    completed  {clips, elapsedSec}
    failed     {error, detail}
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

# The clone is the package root; the bridge lives outside it so the checkout
# stays an untouched `git pull`-able tree.
CLONE_ROOT = Path(os.environ.get("SHORTS_CLONE_ROOT", "")).resolve()
if CLONE_ROOT and str(CLONE_ROOT) not in sys.path:
    sys.path.insert(0, str(CLONE_ROOT))

# Events go to the real stdout, captured before anything can redirect it. The
# clone prints progress lines of its own ("[download/local] …"); those are
# useful in a log and fatal in an NDJSON stream, so they are sent to stderr.
_EVENTS = sys.stdout
if hasattr(_EVENTS, "reconfigure"):
    _EVENTS.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def emit(event_type: str, **payload) -> None:
    """Write one event. Flushed per line so the reader sees progress live."""
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str)
    _EVENTS.write(line + "\n")
    _EVENTS.flush()


def stage(name: str, status: str, label: str) -> None:
    emit("stage", stage=name, status=status, label=label)


def read_job() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("no job was provided on stdin")
    job = json.loads(raw)
    if not isinstance(job, dict):
        raise ValueError("the job must be a JSON object")
    return job


def main() -> int:
    started_at = time.monotonic()
    try:
        job = read_job()
    except Exception as error:  # noqa: BLE001 — the job is the only input
        emit("failed", error=f"The request could not be read: {error}", detail="")
        return 1

    source = str(job.get("source") or "").strip()
    clip_count = max(1, min(int(job.get("clipCount") or 3), 10))
    aspect_ratio = str(job.get("aspectRatio") or "9:16")
    resolution = str(job.get("resolution") or "720")
    language = str(job.get("language") or "").strip() or None
    clip_dir = Path(str(job.get("clipDir") or "")).resolve()
    model = str(job.get("model") or "")

    if not source:
        emit("failed", error="No video was given.", detail="")
        return 1
    clip_dir.mkdir(parents=True, exist_ok=True)

    emit(
        "started",
        source=source,
        clipCount=clip_count,
        aspectRatio=aspect_ratio,
        model=model,
    )

    try:
        # Imported here, not at module scope: an import error is a setup problem
        # worth reporting as a failed run rather than a traceback on stderr.
        from shorts_generator.highlights import get_highlights
        from shorts_generator.local.clipper import crop_clip_local
        from shorts_generator.local.downloader import download_youtube_local
        from shorts_generator.local.llm import call_local_llm
        from shorts_generator.local.transcriber import transcribe_local
    except Exception as error:  # noqa: BLE001
        emit(
            "failed",
            error=(
                "The shorts generator could not be loaded. Build its environment "
                f"from its settings first. ({error})"
            ),
            detail=traceback.format_exc()[-2000:],
        )
        return 1

    # Everything the clone prints goes to stderr for the rest of the run.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            stage("download", "running", "Fetching the video")
            source_path = download_youtube_local(source, fmt=resolution)
            emit(
                "source",
                path=source_path,
                sizeBytes=_size_of(source_path),
            )
            stage("download", "completed", "Fetching the video")

            stage("transcribe", "running", "Transcribing the audio")
            transcript = transcribe_local(source_path, language=language)
            segments = transcript.get("segments") or []
            if not segments:
                raise RuntimeError(
                    "Whisper found no speech in this video, so there is nothing to "
                    "rank. A video with no talking cannot be cut into shorts."
                )
            emit(
                "transcript",
                segments=len(segments),
                durationSec=float(transcript.get("duration") or 0.0),
            )
            stage("transcribe", "completed", "Transcribing the audio")

            stage("highlights", "running", "Ranking the highlights")
            found = get_highlights(
                transcript, num_clips=clip_count, llm_fn=call_local_llm
            ).get("highlights", [])
            if not found:
                raise RuntimeError(
                    "The highlight ranker returned nothing it considered clippable."
                )
            top = sorted(found, key=lambda h: int(h.get("score", 0)), reverse=True)[
                :clip_count
            ]
            emit(
                "highlights",
                found=len(found),
                kept=len(top),
                items=[_highlight(h) for h in top],
            )
            stage("highlights", "completed", "Ranking the highlights")

            stage("clip", "running", "Cutting and reframing")
            clips = []
            for index, highlight in enumerate(top, start=1):
                title = str(highlight.get("title") or f"Short {index}")
                emit(
                    "clip",
                    index=index,
                    total=len(top),
                    status="started",
                    title=title,
                )
                out_path = clip_dir / f"short_{index:02d}.mp4"
                try:
                    crop_clip_local(
                        source_path,
                        float(highlight["start_time"]),
                        float(highlight["end_time"]),
                        aspect_ratio,
                        str(out_path),
                    )
                except Exception as error:  # noqa: BLE001
                    # One clip that will not encode does not cost the others.
                    emit(
                        "clip",
                        index=index,
                        total=len(top),
                        status="failed",
                        title=title,
                        error=str(error)[:600],
                    )
                    continue
                clip = {
                    **_highlight(highlight),
                    "index": index,
                    "path": str(out_path),
                    "sizeBytes": _size_of(str(out_path)),
                }
                clips.append(clip)
                emit("clip", total=len(top), status="completed", **clip)

            if not clips:
                raise RuntimeError(
                    "Every clip failed to encode. ffmpeg is the usual reason — check "
                    "that it is available to this machine."
                )
            stage("clip", "completed", "Cutting and reframing")

            emit(
                "completed",
                clips=clips,
                elapsedSec=round(time.monotonic() - started_at, 2),
            )
            return 0
        except Exception as error:  # noqa: BLE001
            emit(
                "failed",
                error=str(error)[:1200] or "The run failed.",
                detail=traceback.format_exc()[-2000:],
            )
            return 1


def _highlight(highlight: dict) -> dict:
    """One ranked highlight, in the shape the card and the artifacts read."""
    start = float(highlight.get("start_time") or 0.0)
    end = float(highlight.get("end_time") or 0.0)
    return {
        "title": str(highlight.get("title") or "Untitled"),
        "startSec": start,
        "endSec": end,
        "durationSec": max(0.0, end - start),
        "score": int(highlight.get("score") or 0),
        "hook": str(highlight.get("hook_sentence") or ""),
        "reason": str(highlight.get("virality_reason") or ""),
    }


def _size_of(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
