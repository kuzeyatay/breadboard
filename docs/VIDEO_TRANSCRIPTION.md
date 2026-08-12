# Video transcription (Scriberr integration)

Breadboard's Garden Chat can turn videos into faithful, timestamped Markdown
sources. A user either uploads a local video file or pastes a YouTube URL; the
video is transcribed by the locally running [Scriberr](https://scriberr.app)
service, converted deterministically to Markdown, written into the garden's
existing `sources/` folder, and pushed through the normal source ingestion,
indexing, source-tree, knowledge-graph, and Quartz refresh flow.

No LLM ever rewrites, summarizes, or "repairs" the transcript. ChatMock only
builds the surrounding knowledge scaffolding (topics/summary), exactly as it
does for PDFs and URL imports, with a deterministic fallback when it is down.

## Architecture

```text
Garden Chat (Videos panel, workspace-client.tsx)
  └─ POST /api/gardens/:gardenId/video-transcriptions   ← file OR YouTube URL, 202 + job
       └─ VideoTranscriptionRunner (background, SQLite-checkpointed)
            ├─ upload:  ffprobe validation → Scriberr upload-video
            ├─ youtube: URL validation + yt-dlp metadata → Scriberr /youtube
            │            (Scriberr's own safe yt-dlp downloads exactly one video)
            ├─ Scriberr /transcription/:id/start → poll /status → /transcript
            ├─ deterministic transcript → Markdown (+ completeness proof)
            └─ writeDocumentKnowledge → sources/<slug>.md + indexing + Quartz
```

Key server modules (all under `dashboard/src/lib/scriberr/`):

| Module | Responsibility |
| --- | --- |
| `config.ts` | one-time env parsing/validation |
| `client.ts` | typed HTTP adapter for Scriberr's API |
| `youtube.ts` | YouTube URL allowlist/canonicalization (playlists rejected) |
| `ytdlp.ts` | yt-dlp `--dump-single-json` metadata previews |
| `ffprobe.ts` | real media validation (audio stream, duration) |
| `transcript-normalizer.ts` | deterministic normalized transcript model |
| `transcript-markdown.ts` | deterministic Markdown + full-transcript proof |
| `job-store.ts` | SQLite job persistence (`video_transcription_jobs`) |
| `job-runner.ts` | async pipeline, queue, resume, cancel, retry, cleanup |
| `route-core.ts` | route logic (auth, validation, dedup, limits) |
| `instance.ts` | real wiring (db, runner singleton) used by routes |

Scriberr endpoints used: `GET /health`, `POST /api/v1/auth/login`,
`POST /api/v1/transcription/upload-video`, `POST /api/v1/transcription/youtube`,
`POST /api/v1/transcription/:id/start`, `GET /api/v1/transcription/:id/status`,
`GET /api/v1/transcription/:id/transcript`, `POST /api/v1/transcription/:id/kill`,
`DELETE /api/v1/transcription/:id`.

## Local setup

### Scriberr clone location

Scriberr is vendored at the repo root as `./scriberr` (plain tracked files, not
a git submodule — the same arrangement as `./hermes` and `./reader`). Do
not re-add it as a submodule and do not commit a nested `.git` directory.

### Running Scriberr

Scriberr's prebuilt binaries in the checkout are macOS/arm64; on Windows run it
with Docker Desktop:

```bash
npm run dev:scriberr     # wraps: docker compose -f scriberr/docker-compose.yml up
```

The launcher (`scripts/start-scriberr.mjs`):

- exits quietly if `SCRIBERR_BASE_URL/health` is already healthy;
- remaps the container port to `SCRIBERR_PORT` (default **8091**, because the
  local Jina Reader occupies Scriberr's default 8080) through a generated
  compose override in `.runtime/` (requires Docker Compose ≥ 2.24 for the
  `!override` tag; older versions: edit `scriberr/docker-compose.yml` port
  mapping manually);
- prints guidance instead of crashing when Docker is unavailable.

`start.bat` opens a Scriberr window automatically; `npm run dev` starts it
alongside the rest of the stack unless `SCRIBERR_AUTOSTART=false`.

First run: Scriberr downloads several GB of transcription models into its
Docker volume and can take many minutes before `/health` responds. CPU
transcription works everywhere; CUDA images exist for NVIDIA GPUs
(`scriberr/docker-compose.cuda.yml`).

### Scriberr credentials

1. Open Scriberr (e.g. http://127.0.0.1:8091), register the first account.
2. Create an API key (Settings → API Keys) and put it in `SCRIBERR_API_TOKEN`,
   **or** set `SCRIBERR_USERNAME`/`SCRIBERR_PASSWORD` for JWT login.
3. Credentials stay server-side; they are never sent to the browser.

### External tools

- **yt-dlp** — used by Breadboard only for machine-readable metadata previews
  (`--dump-single-json --no-playlist`). The actual YouTube download happens
  inside Scriberr's container through its own yt-dlp. Install locally for
  previews: `winget install yt-dlp.yt-dlp` (or `pip install yt-dlp`).
- **FFmpeg/ffprobe** — ffprobe validates uploads server-side (container,
  codecs, duration, audio stream presence). `winget install Gyan.FFmpeg`.
- **JavaScript runtime** — yt-dlp's YouTube extractor needs a JS runtime;
  Node.js (already required by Breadboard) satisfies this. Deno also works.

Set `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH` if the tools are not on PATH.

### Environment variables

See `dashboard/.env.example` (copy into `dashboard/.env.local`) for the full
annotated list: `VIDEO_TRANSCRIPTION_ENABLED`, `SCRIBERR_BASE_URL`,
`SCRIBERR_API_TOKEN`, `SCRIBERR_USERNAME`/`SCRIBERR_PASSWORD`,
`SCRIBERR_REQUEST_TIMEOUT_MS`, `SCRIBERR_TRANSCRIPTION_TIMEOUT_MS`,
`SCRIBERR_POLL_INTERVAL_MS`, `SCRIBERR_MODEL_FAMILY`, `SCRIBERR_MODEL`,
`SCRIBERR_LANGUAGE`, `SCRIBERR_DIARIZATION`,
`VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB`, `VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS`,
`VIDEO_TRANSCRIPTION_TEMP_DIR`, `VIDEO_TRANSCRIPTION_KEEP_MEDIA`,
`VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS`, `VIDEO_TRANSCRIPTION_MAX_CONCURRENT`,
`VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN`,
`VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS`, `YTDLP_PATH`, `FFMPEG_PATH`,
`FFPROBE_PATH`, `YTDLP_DOWNLOAD_TIMEOUT_MS`. Root `.env.example` adds
`SCRIBERR_PORT` and `SCRIBERR_AUTOSTART` for the launchers.

## Behavior and guarantees

- **Garden folder contract preserved** — the transcript is a single Markdown
  file under the garden's existing `sources/` folder (written by the same
  `writeDocumentKnowledge` pipeline as every other source). No `videos/`,
  `transcripts/`, or media binaries ever enter Quartz content.
- **Async jobs** — creation returns `202` immediately; state persists in the
  `video_transcription_jobs` SQLite table. Jobs survive page refreshes and dev
  server restarts: on the next poll the runner re-attaches to the Scriberr job
  or resumes from the stored transcript checkpoint.
- **Fidelity** — Markdown generation is deterministic and verified: the
  rendered transcript must contain every normalized segment exactly once and
  in order (whitespace-insensitive comparison), or the job fails with
  `transcript_incomplete` instead of writing a lossy file.
- **Dedup** — YouTube videos dedup by canonical video ID; uploads by SHA-256 of
  the media; the generated Markdown's content hash is stored in frontmatter.
  Re-submitting returns the existing source (`duplicate: true`) unless
  `retranscribe: true` is sent.
- **Recoverable indexing** — if the Markdown was written but indexing failed,
  the job fails with `indexing_failed` and Retry re-runs only indexing
  (`refreshClusterIndex` + Quartz publish); it never re-transcribes.
- **Cleanup** — uploads live in job-scoped random directories under the
  transcription temp root, are deleted after Scriberr has its own copy (or on
  failure/cancel), and a retention sweep removes abandoned directories after
  `VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS`. Deletions are containment-checked
  and retried with bounded backoff for transient Windows/OneDrive locks.
- **Limits** — max upload size, max duration, one active transcription at a
  time by default, and a per-garden queue cap; excess submissions get `429`.
- **Windows** — all paths use Node path utilities; subprocesses run via
  `spawn` with `shell: false`; reserved device names and non-ASCII filenames
  are handled; nothing is written under `.next/`.

### YouTube cookies (private/age-restricted videos)

Not supported out of the box and no cookies are stored in the repository. If
you need them, configure cookies inside the Scriberr container (server-side,
environment-managed, git-ignored). Public videos need no cookies.

## Health verification

- `GET /api/gardens/<garden>/video-transcriptions/health` (as the garden owner)
  reports Scriberr, yt-dlp, FFmpeg, ffprobe, the JS runtime, and writable
  temp/sources directories individually. The Videos panel shows the same
  information as specific warnings.
- Scriberr liveness directly: `curl http://127.0.0.1:8091/health`.

## Running the tests

```bash
cd dashboard
npm test                                  # full suite
node --test --experimental-strip-types \
  tests/scriberr-*.test.mjs \
  tests/video-transcription-*.test.mjs \
  tests/garden-videos-ui.test.mjs         # feature tests only
```

Tests use an in-memory SQLite database, a fake in-process Scriberr HTTP
server, and stubbed yt-dlp/ffprobe — no network access and no real tools are
required.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Scriberr unavailable | Service not running or wrong `SCRIBERR_BASE_URL`. Run `npm run dev:scriberr`; first boot downloads models for several minutes. Check the port remap (8091 vs 8080). |
| yt-dlp not found | Install yt-dlp or set `YTDLP_PATH`. Only metadata previews degrade; Scriberr still downloads via its own yt-dlp. |
| FFmpeg not found | Install FFmpeg or set `FFMPEG_PATH` (Scriberr's container ships its own for transcription). |
| JavaScript runtime not found | yt-dlp needs Node or Deno for YouTube extraction; Breadboard's Node install qualifies — ensure `node` is on PATH for yt-dlp. |
| YouTube asks for sign-in | The video is private/age-restricted. Cookie support is intentionally not bundled; configure cookies in the Scriberr container if required. |
| Video has no audio | The upload was rejected by ffprobe validation (`media_no_audio`) — there is nothing to transcribe. |
| Unsupported codec | `media_unsupported` from ffprobe, or Scriberr's own ffmpeg failed. Re-encode to H.264/AAC MP4: `ffmpeg -i in -c:v libx264 -c:a aac out.mp4`. |
| Transcription appears stuck | Check the Scriberr window/logs; large models on CPU are slow. The job times out after `SCRIBERR_TRANSCRIPTION_TIMEOUT_MS` and becomes retryable. |
| Markdown created but indexing failed | Job state `failed`/`indexing_failed`. Press Retry — it resumes indexing only and never re-transcribes. |
| Temporary file cannot be deleted on Windows | OneDrive/antivirus lock. Deletion retries with backoff and the retention sweep removes leftovers after `VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS`. |

## Example output

A transcribed YouTube lecture in garden `test-2` becomes, for example:

```text
quartz/content/test-2/sources/example-video-title.md
```

with frontmatter (`source_type: youtube`, `youtube_video_id`, `channel`,
`duration_seconds`, `transcription_engine: scriberr`, `content_hash`, …) and a
`## Transcript` section grouped into five-minute windows whose timestamps link
back to the exact YouTube position.
