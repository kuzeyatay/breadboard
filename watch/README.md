# Watch

Watch is a self-contained agent skill for analyzing video URLs and local video
files. It collects native captions when available, can fall back to Groq or
OpenAI Whisper, extracts timestamped representative frames with `ffmpeg`, and
gives the active agent grounded audio and visual evidence.

The skill is compatible with Breadboard's ChatMock-backed Terminal through the
guarded `watch_run` tool. Breadboard sends the transcript and at most 24 evenly
sampled frames through its local ChatMock gateway, so Hermes receives
timestamped visual evidence. It also keeps a relative-path
Python fallback for Codex, Claude Code, Cursor, Gemini CLI, and other Agent
Skills hosts.

## Use

```text
/watch https://youtu.be/example summarize the main argument and visuals
/watch demo.mp4 when does the interface fail?
/watch lecture.webm explain 04:10 to 05:00
```

Detail modes:

- `transcript`: captions or Whisper only;
- `efficient`: fast keyframe overview, up to 50 frames;
- `balanced`: scene-aware default, up to 100 frames;
- `token-burner`: uncapped scene coverage for explicitly high-detail work.

## Requirements

- Python 3.10+
- `ffmpeg` and `ffprobe`
- `yt-dlp`
- optional `GROQ_API_KEY` or `OPENAI_API_KEY` for videos without captions

Run the preflight from any checkout:

```text
python skills/watch/scripts/setup.py --json
```

On Windows use `python`; on macOS/Linux use `python3` if that is the installed
command. Provider keys may be stored in `~/.config/watch/.env`. The skill works
without a key when captions or visual frames are sufficient.

## Layout

The distributable skill is `skills/watch/`. It contains `SKILL.md`, product
metadata under `agents/`, and the complete Python runtime under `scripts/`.
Breadboard mirrors this directory into `hermes-skills/prebuilt/watch` so it
appears in the Prebuilt skills page.

This project originated from
[bradautomates/claude-video](https://github.com/bradautomates/claude-video) and
retains its MIT license and attribution.
