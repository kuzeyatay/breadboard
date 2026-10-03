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

Preserve the user's actual question in `question`. Do not rewrite a general
question about an idea or experiment into a claim that it occurs at the URL's
playback timestamp. Always retain the full available transcript. In every
host, `start` and `end` focus frames only; no opt-in flag is needed to keep
spoken context.

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
- For a question about an idea, claim, or experiment, start with the full
  transcript. A URL's `t=`, `start=`, or timestamp fragment is a playback cue,
  not a request to restrict the evidence. Locate the relevant passage, then
  focus frames there if visuals matter.
- Use `start` and `end` for visual inspection of a named moment or range.
  The complete available transcript remains in the report.
- For long videos, inspect or search the available transcript before choosing
  a visual range. A sparse full-video frame pass is less reliable than focused
  frames, but an arbitrary excerpt cannot establish what the whole video says.
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

Before contradicting the user's description, find the relevant passage in the
full available transcript, including related terms rather than only the exact
word the user used. Verify the underlying idea even when their terminology is
imprecise. If only an excerpt was inspected, say
"I did not find that in this excerpt" and retrieve wider context; do not say
"the video does not say that." Do not wait for the user to catch a missing passage.

Separate what the video reports, what the experiment measured, and what you
infer about the user's proposed application. Do not generalize a measured
result to different tasks, outcomes, or populations without supporting evidence.
Attribute an unverified mechanism to the video and verify research separately
before presenting it as established. `chatmockAnalysis` is a synthesis of the
same evidence, not an independent source; check its claims against the transcript.

Do not paste the full transcript unless the user asks for it. For a follow-up
about the same processed video, reuse the existing report and frames when they
cover the question. If the prior report is partial, retrieve the missing context.

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
