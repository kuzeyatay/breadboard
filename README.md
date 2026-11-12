# Breadboard

<p align="center">
  <strong>A local-first AI workbench for Windows: research deeply, learn from any source, build with specialized agents, and turn ideas into versioned, publishable work.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows_10%2F11_x64-0078d4" alt="Platform: Windows 10 and 11, x64">
  <img src="https://img.shields.io/badge/license-MIT-3f7d5c" alt="License: MIT">
  <img src="https://img.shields.io/badge/runtime-local--first-3f7d5c" alt="Local-first runtime">
</p>

Breadboard keeps a topic's source files, generated learning material,
conversations, notes, artifacts and knowledge graph together in a **Garden**.
From the same workspace you can:

- ingest PDFs, Office files, images, archives, audio, video and Markdown;
- turn source material into structured, cited learning paths;
- chat with a Garden, or use the general-purpose AI Terminal;
- delegate work to research, coding, media, office and CAD agents;
- create and revise versioned documents, presentations, spreadsheets, PDFs,
  HTML pages, visualizations and media;
- browse or publish the result as a Quartz digital garden.

Everything runs on your machine and your data stays in a folder you own. Only
the model providers, connected apps and web tools you choose to connect see the
content you send them.

## Install

1. Download `Breadboard-Setup-<version>-x64.exe` from the
   [Releases page](https://github.com/kuzeyatay/breadboard/releases).
2. Run it. The installer is not yet code-signed, so Windows SmartScreen shows a
   warning on first run; choose **More info**, then **Run anyway**.
3. Open Breadboard from the Start menu or the desktop shortcut.

The first launch creates your local account automatically; there is nothing
to register. Your workspace lives under `%APPDATA%\breadboard-desktop\Data`
and survives reinstalling or updating the app.

**Requirements:** Windows 10 or 11, 64-bit. The installed app takes roughly 10 GB of
disk; optional local models and runtimes download several more gigabytes each,
only when you turn them on.

## First run

**Connect a model.** A new chat shows *No model is connected yet* with a
**Connect a model** button that opens Settings. Pick one:

- **Sign in with ChatGPT**, or with a Claude Pro/Max, Gemini, Kimi or Grok
  subscription. Nothing is billed per token.
- **Add an API key**: Google AI Studio is offered first; Anthropic, OpenAI,
  OpenRouter, Groq, DeepSeek, xAI, Mistral and Together also work.
- **Use a local model** through a custom OpenAI-compatible endpoint, for
  example Ollama at `http://127.0.0.1:11434/v1`.

See [docs/MODEL_PROVIDERS.md](docs/MODEL_PROVIDERS.md) for the details.

**Create a Garden.** Give it a topic, drop in sources (PDFs, documents, links,
audio, video), then either build a learning structure from them or start
asking questions in Garden Chat. Generated artifacts open in the workspace,
keep every earlier version, and can be revised by asking.

**Use the Terminal** for work that spans Gardens, connected repositories and
agents.

## What is included, and what needs setup

Most of Breadboard works right after installation. Some capabilities download
their runtime the first time you turn them on, and a few depend on software or
accounts Breadboard cannot provide. The app shows each state in its settings, and the Settings page has an
“Optional components” section where the large downloads can be installed or
removed ahead of time.

| Capability | State in an installed Breadboard |
| --- | --- |
| Gardens, Learn, Garden Chat, Terminal, artifacts, in-app browser, Quartz publishing | Included |
| Transcription of audio and video | Included |
| Local OCR (“Parse using VLM”) | OCR model (1.3 GB) downloads on first use |
| Coding agents (Codex, Claude Code, OpenCode) | OpenCode included; Codex (148 MB) and Claude Code (338 MB) download on first use; each uses its own sign-in |
| Speech (read aloud, dictation, voice profiles) | Speech server (675 MB) and speech models download on first use |
| Recall (screen and audio memory) | Capture engine downloads from npm on first use |
| Music, video, research and finance agents | Their Python runtimes download on first use |
| ComfyUI image generation | Environment downloads on first use; you supply the model checkpoints |
| Socials Manager (Postiz), Inbox Zero | Need Docker Desktop or Podman |
| Spotify playback | Needs Microsoft Edge and a Spotify Premium account |
| SolidWorks agent | Needs a licensed SolidWorks on this PC |
| Bambu printer | Needs a Bambu LAN printer in Developer Mode |
| ColPali visual document retrieval | Python environment (1.4 GB) and model download on first use |
| Natural rewriting (Humanizer) | Python environment (1.3 GB) and model download on first use |
| Parametric CAD (CadQuery) | Python environment (700 MB) downloads on first use |

## Known limitations

- **Windows only.** macOS and Linux desktop builds are not supported.
  Ubuntu self-hosting of the web dashboard is documented separately in
  [DEPLOYMENT-UBUNTU.md](DEPLOYMENT-UBUNTU.md).
- **Unsigned installer.** Expect the SmartScreen warning until a signing
  certificate is in place.
- **No automatic updates.** Install a newer release over the old one; your
  data folder is kept. An older Breadboard refuses to open data that a newer
  one has already migrated, so do not downgrade.
- **Memory.** Long sessions with several local models running at once need a
  machine with plenty of RAM; Breadboard pauses services it cannot afford to
  start and says so.
- Keep backups of anything irreplaceable. The data folder is ordinary files
  and SQLite databases you can copy while the app is closed.

## Getting help

Open **Profile** and press **Export diagnostics**. Breadboard saves a zip of
its redacted logs, recent crash dumps and runtime state wherever you choose.
Attach it to a [bug report](https://github.com/kuzeyatay/breadboard/issues/new/choose).
If the app does not start, the startup screen's **Copy diagnostics** button
gives the same information as text.

## Privacy

- All services bind to the local loopback interface with per-install
  credentials.
- Local-first does not mean offline-only: model providers, OAuth-connected
  apps, web research and publishing integrations transmit the content you ask
  them to handle.
- Tool calls and connected-app operations pass through authenticated,
  scope-aware routes. See [docs/DESKTOP_SECURITY.md](docs/DESKTOP_SECURITY.md).

## Developing Breadboard

The repository is a monorepo: an Electron shell (`desktop/`), a Next.js
dashboard (`dashboard/`), a Rust runtime supervisor (`native/`), the Hermes
agent runtime, Quartz, and pinned source snapshots of the upstream projects
Breadboard integrates. Setup, run modes, tests and installer builds are in
[docs/DESKTOP_DEVELOPMENT.md](docs/DESKTOP_DEVELOPMENT.md).

| Topic | Guide |
| --- | --- |
| Desktop architecture | [docs/DESKTOP_ARCHITECTURE.md](docs/DESKTOP_ARCHITECTURE.md) |
| Desktop development | [docs/DESKTOP_DEVELOPMENT.md](docs/DESKTOP_DEVELOPMENT.md) |
| Packaging and releases | [docs/DESKTOP_PACKAGING.md](docs/DESKTOP_PACKAGING.md) and [docs/DESKTOP_RELEASE_CHECKLIST.md](docs/DESKTOP_RELEASE_CHECKLIST.md) |
| Runtime V2 | [docs/RUNTIME_V2_ARCHITECTURE.md](docs/RUNTIME_V2_ARCHITECTURE.md) |
| Hermes runtime | [docs/HERMES_RUNTIME.md](docs/HERMES_RUNTIME.md) |
| Model providers | [docs/MODEL_PROVIDERS.md](docs/MODEL_PROVIDERS.md) |
| Memory architecture | [docs/MEMORY_ARCHITECTURE.md](docs/MEMORY_ARCHITECTURE.md) |
| Knowledge map | [docs/BRAIN_MAP.md](docs/BRAIN_MAP.md) |
| Interactive visualizations | [docs/INTERACTIVE_VISUALIZER.md](docs/INTERACTIVE_VISUALIZER.md) |
| Adding an agent | [docs/ADDING_AN_AGENT.md](docs/ADDING_AN_AGENT.md) |
| API Anything and browser fallback | [docs/API_ANYTHING.md](docs/API_ANYTHING.md) |
| Integrated source snapshots | [docs/VENDORED_REPOSITORIES.md](docs/VENDORED_REPOSITORIES.md) |
| Ubuntu deployment | [DEPLOYMENT-UBUNTU.md](DEPLOYMENT-UBUNTU.md) |

Specialized integrations have their own guides in [`docs/`](docs/), including
Codex, Deep Research, GBrain, GenOffice, UI-TARS, CAD, audio analysis, video
editing, transcription and connected communication tools.

## License

Breadboard is released under the [MIT License](LICENSE). The upstream projects
it bundles keep their own licenses; the installer ships them under
`resources/licenses`, and [docs/VENDORED_REPOSITORIES.md](docs/VENDORED_REPOSITORIES.md)
lists every snapshot with its revision and license.

## Why "Breadboard"?

A physical breadboard is where ideas are assembled, tested, rearranged and
turned into working systems. This project applies the same idea to knowledge:
bring the raw material together, connect it, experiment with it, and keep the
result open to revision.
