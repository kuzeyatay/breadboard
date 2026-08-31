"""Transcribe one demonstration's narration, then exit.

This is deliberately a one-shot process rather than a service. Breadboard
already runs several resident local subsystems, and a Whisper model held in
memory between teaching sessions would be the largest of them for the least
reason: narration is transcribed once per demonstration, and the result is
persisted so re-analysis never needs the audio again.

faster-whisper decodes the browser's WebM/Opus recording through its bundled
PyAV, so no ffmpeg has to be present on the machine.

Input:  a JSON request on argv[1] (a file path).
Output: one JSON object on stdout. Nothing else is ever printed there --
        the transcript is the caller's, not the log's.
"""

from __future__ import annotations

import json
import os
import sys


def fail(message: str, code: str = "transcription_failed") -> None:
    json.dump({"ok": False, "code": code, "error": message}, sys.stdout)
    sys.stdout.flush()
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) < 2:
        fail("A request file is required.", "bad_request")

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as handle:
            request = json.load(handle)
    except (OSError, ValueError) as error:
        fail("The transcription request could not be read: %s" % error, "bad_request")

    audio_path = request.get("audioPath")
    if not audio_path or not os.path.isfile(audio_path):
        fail("The narration audio file is missing.", "audio_missing")

    model_size = request.get("model") or "base"
    language = request.get("language") or None
    download_root = request.get("downloadRoot") or None
    compute_type = request.get("computeType") or "int8"
    want_words = bool(request.get("wordTimestamps", True))

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        fail("faster-whisper is not installed: %s" % error, "engine_missing")

    try:
        model = WhisperModel(
            model_size,
            device="cpu",
            compute_type=compute_type,
            download_root=download_root,
        )
    except Exception as error:  # noqa: BLE001 - any failure here is "no model"
        fail("The speech model could not be loaded: %s" % error, "model_unavailable")

    try:
        segments, info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=want_words,
            # Narration is short and full of pauses while the user works. VAD
            # keeps those pauses out of the segment boundaries, which is what
            # makes a segment line up with the action it describes.
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            beam_size=1,
        )

        emitted_segments = []
        emitted_words = []
        for segment in segments:
            text = (segment.text or "").strip()
            if not text:
                continue
            entry = {
                "startMs": int(round(segment.start * 1000)),
                "endMs": int(round(segment.end * 1000)),
                "text": text,
            }
            probability = getattr(segment, "avg_logprob", None)
            if probability is not None:
                entry["confidence"] = float(probability)
            emitted_segments.append(entry)

            for word in getattr(segment, "words", None) or []:
                word_text = (getattr(word, "word", "") or "").strip()
                if not word_text:
                    continue
                emitted_words.append(
                    {
                        "startMs": int(round(word.start * 1000)),
                        "endMs": int(round(word.end * 1000)),
                        "text": word_text,
                    }
                )
    except Exception as error:  # noqa: BLE001
        fail("The narration could not be transcribed: %s" % error)

    payload = {
        "ok": True,
        "segments": emitted_segments,
        "words": emitted_words if want_words else [],
        "language": getattr(info, "language", None),
        "durationMs": int(round((getattr(info, "duration", 0.0) or 0.0) * 1000)),
        "model": model_size,
    }
    json.dump(payload, sys.stdout)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
