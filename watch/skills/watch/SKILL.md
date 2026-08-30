---
name: watch
description: Analyze a video URL or local video with timestamped captions, optional Whisper transcription, and representative frames so answers are grounded in what was said and shown.
license: MIT
allowed-tools:
  - watch_run
  - terminal_execute_command
  - read
metadata:
  openclaw:
    requires:
      bins:
        - python
        - ffmpeg
        - ffprobe
        - yt-dlp
---

# Watch

Use this skill when the user supplies a video URL or local video and wants a
summary, explanation, comparison, timestamp, visual inspection, or diagnosis.
The runtime prefers native captions, falls back to a configured Whisper
provider when needed, and extracts representative JPEG frames. Combine both
evidence streams; do not claim to have seen content that neither stream shows.

breadboard:
  category: prebuilt
  surfaces: [dashboard_terminal]
  requiredTools:
    - watch_run
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Breadboard and ChatMock workflow

Breadboard's Terminal is powered through ChatMock. When `watch_run` is
available, use it instead of invoking the bundled Python files directly. Pass:

- `source`: the URL or local path exactly as the user supplied it;
- `question`: the user's question, or a concise request to summarize when no
  question was supplied;
- `detail`: `transcript`, `efficient`, `balanced`, or `token-burner`;
- optional `start` and `end` timestamps for a focused question;
- optional `timestamps` for exact moments that need a frame;
- optional `maxFrames` and `resolution` only when the request justifies them;
- `noWhisper: true` only when the user declines remote transcription.

The tool runs the checked-in runtime outside the model's command surface,
keeps local paths inside the authorized workspace, and returns a Markdown
report containing frame paths and a timestamped transcript. It also sends an
evenly sampled, bounded set of frames plus the report through Breadboard's local
ChatMock gateway and returns `chatmockAnalysis`. Use that analysis on runtimes
without an image reader. When an image-capable file reader is available, inspect
all relevant returned frames directly before making fine-grained visual claims.
Do not paste image bytes or invent descriptions from filenames.

## Other compatible skill hosts

When `watch_run` is not available, resolve `SKILL_DIR` to the absolute directory
containing this `SKILL.md`, verify that `SKILL_DIR/scripts/watch.py` exists, and
run the bundled script. Use `python` on Windows and `python3` on macOS/Linux:

```text
python "<SKILL_DIR>/scripts/setup.py" --json
python "<SKILL_DIR>/scripts/watch.py" "<source>"
```

The setup result is structured. Continue when `can_proceed` is true. If
dependencies are missing, explain the exact installer command returned by
`setup.py`; do not install software silently. A Whisper key is optional because
captioned videos and frame-only analysis still work.

## Choose the smallest useful run

- Use `transcript` for spoken-content questions where visuals do not matter.
- Use `efficient` for a fast visual overview, capped at 50 keyframes.
- Use `balanced` by default for scene-aware coverage, capped at 100 frames.
- Use `token-burner` only when maximum visual fidelity is explicitly useful;
  it can consume a large context window.
- For a named moment or range, pass `start` and `end` rather than scanning the
  entire video.
- For long videos, ask for or infer a relevant section when the user's request
  is narrow. A sparse full-video pass is less reliable than a focused pass.
- Keep the default 512-pixel frame width. Increase resolution only to read
  small on-screen text.

## Interpret the report

1. Read the report header for source, duration, detail mode, frame coverage,
   and transcript source.
2. Inspect all returned frames that are relevant to the question. Frame paths
   are chronological and include absolute timestamps.
3. Align visual events with nearby transcript segments. Treat captions as
   imperfect speech recognition, especially for names and technical terms.
4. Answer the user's actual question first. Use timestamps for key claims.
5. If no question was supplied, give a concise structured summary covering the
   video's purpose, progression, important spoken points, and notable visuals.
6. Describe limitations plainly: missing captions, unavailable Whisper,
   download restrictions, sparse coverage, or unread frames.

Do not paste the full transcript unless the user asks for it. For a follow-up
about the same processed video, reuse the existing report and frames instead of
downloading or extracting them again.

## Useful options for the bundled script

```text
--detail transcript|efficient|balanced|token-burner
--start SS|MM:SS|HH:MM:SS
--end SS|MM:SS|HH:MM:SS
--timestamps T1,T2,...
--max-frames N
--resolution W
--fps F
--whisper groq|openai
--no-whisper
--no-dedup
--out-dir DIR
```

Native captions are free and preferred. If captions are absent, the optional
Whisper fallback extracts mono audio and sends only that audio to the selected
Groq or OpenAI transcription endpoint. Credentials are read from environment
variables or `~/.config/watch/.env`; never print them or place them in a prompt.
For Breadboard runs, the report and at most 24 evenly sampled frames are sent
through the local ChatMock gateway to the active configured model for evidence
analysis. Downloaded media, audio, and frames remain in the reported work
directory.

## Failure handling

- Missing `ffmpeg`, `ffprobe`, or `yt-dlp`: report the dependency and the setup
  command; do not pretend the video was processed.
- Restricted or region-locked URL: report the downloader error once and stop.
- No transcript: continue with frames when possible and label the answer as
  visual-only.
- No frames: answer from the transcript when possible and label it text-only.
- Whisper failure: retain any native captions or frames and report which
  fallback failed; never expose provider secrets.
- Long or dense video: mention the coverage limit and offer a focused rerun.

Bundled runtime files are under `scripts/`: `watch.py` orchestrates download,
frame extraction, captions, and Whisper; the remaining modules are internal
helpers and should not be invoked unless diagnosing the skill itself.
