# Agent Reach integration

Agent Reach (`agent-reach/`, [Panniantong/agent-reach](https://github.com/Panniantong/agent-reach))
gives an agent read access to ~15 internet platforms — Twitter/X, Reddit,
YouTube, GitHub, Bilibili, XiaoHongShu, LinkedIn, V2EX, Xueqiu, Xiaoyuzhou, RSS,
Facebook, Instagram, Exa web search, and any web page.

In Breadboard it is a runtime agent: pick it in the capability palette's **Agents**
tab (or type `/agents:agent-reach`), then ask a question in chat. The answer
arrives as a live run card showing which channels are reachable, every fetch it
made, and a sourced answer.

## What the upstream project actually is

Agent Reach is deliberately **not** a wrapper. Quoting its own `CLAUDE.md`:

> Positioning: installer + doctor + config tool. NOT a wrapper — after install,
> agents call upstream tools directly.

There is no `agent-reach read <url>` command. The Python package installs and
health-checks upstream tools; the agent then runs those tools itself, guided by
the routing table in `agent_reach/skill/SKILL_en.md`.

That shapes the integration:

- **Breadboard is the agent.** The Next.js server drives the loop.
- **`agent-reach doctor --json` is the only thing the package is asked for.** It
  reports, per channel, whether it works and which backend is serving it.
- **The routing knowledge is never restated in TypeScript.** `SKILL_en.md` and the
  matching `references/*.md` are read out of the clone and injected into the
  system prompt, so upgrading the clone upgrades what Breadboard knows.

## Architecture

```
chat surface ──► POST /api/agent-reach/runs ──► run-manager
                                                 │
                                    ┌────────────┴────────────┐
                                    │                         │
                          agent-reach doctor --json     ChatMock tool loop
                          (which channels are live)     (/v1/chat/completions)
                                                              │
                                                    parseCommand (allowlist)
                                                              │
                                                     spawn(argv) — no shell
                                                 curl · yt-dlp · gh · mcporter
                                                 twitter · bili · opencli · rdt
```

| File | Role |
| --- | --- |
| `dashboard/src/lib/agent-reach/identity.ts` | `/agents:agent-reach` command and task parsing |
| `dashboard/src/lib/agent-reach/runtime.ts` | Locates the clone + venv, runs and caches `doctor --json` |
| `dashboard/src/lib/agent-reach/commands.ts` | The command policy (see below) |
| `dashboard/src/lib/agent-reach/skill-prompt.ts` | Builds the system prompt from the clone's skill files + live doctor report |
| `dashboard/src/lib/agent-reach/run-manager.ts` | ChatMock tool loop, command execution, SSE events |
| `dashboard/src/lib/agent-reach/spawn-plan.ts` | Resolving an executable and wrapping Windows `.cmd` shims without a shell |
| `dashboard/src/lib/agent-reach/setup.ts` | User-initiated installs and credentials (the settings panel's actions) |
| `dashboard/src/app/api/agent-reach/*` | `health`, `runs`, `runs/[runId]/events`, `runs/[runId]/abort`, `setup` |
| `dashboard/src/app/components/hermes/inline-agent-reach-run.tsx` | The run card in the transcript |
| `dashboard/src/app/components/hermes/agent-reach-settings-dialog.tsx` | The settings panel behind the gear |

The model gets two tools: `agent_reach` (run one upstream command) and
`read_output_file` (read a file that command wrote — there is no `cat`).

## Command policy

This is the security boundary. `commands.ts` enforces it before any process starts.

1. **No shell, ever.** Commands are tokenized into an argv array and spawned
   directly. Chaining (`&&`, `;`, `|`), redirection, and `$(…)` are refused.
   `&` *inside* an argument (a URL query string) is fine — it is data, not an
   operator, because nothing is handed to a shell. On Windows, `.cmd` shims are
   launched through `cmd.exe` with arguments quoted by us and
   `windowsVerbatimArguments` on; `shell: true` is never used, since that would
   re-expose shell parsing.
2. **Executables are allowlisted** with a read-only verb policy each. Agent Reach
   is an internet *reader*: `gh issue create`, `twitter post`, `rdt login`,
   `mcporter config add`, and `agent-reach configure/install/uninstall` are all
   refused even though the underlying CLIs support them. `curl` is restricted to
   GETs; `yt-dlp` must run in a metadata/subtitle mode and may not use `--exec`.
3. **File paths are confined to the run's workspace.** The published recipes write
   to `/tmp/...`; those are rewritten into the workspace rather than refused,
   which is also what makes them work on Windows. A path already inside the
   workspace is honored as-is.

Refusals are returned to the model as the tool result with the reason, so it can
correct itself instead of retrying blindly. `tests/agent-reach-command.test.mjs`
covers the policy.

### Two trust contexts

`commands.ts` and `setup.ts` both end in a spawn, and the difference between them
is who is asking.

- **`commands.ts` — a model is asking**, mid-chat-turn. Read-only, allowlisted,
  and it explicitly refuses `agent-reach configure`, `agent-reach install`, and
  every package manager.
- **`setup.ts` — the user is asking**, from the settings panel. Those actions are
  available, but only as fixed argv the module owns: a request names an id from a
  table and at most supplies a secret, which is passed as one argv element.
  Secrets are write-only — they go to Agent Reach's own config on disk and are
  redacted out of any response.

Neither uses a shell. On Windows both go through `spawn-plan.ts`, which matters
more than it looks: Node ≥18.20 refuses to spawn a `.cmd` file without a shell
(CVE-2024-27980), and npm-installed tools (`npm`, `mcporter`, `opencli`) are
exactly that. `shell: true` would hand the *joined* argv back to `cmd.exe` with
no escaping, so an `&` in a URL query string would become a command separator.
Instead the executable is resolved to a concrete file, and shims are run as
`cmd.exe /d /s /c "<our own per-argument quoting>"` with
`windowsVerbatimArguments`.

## The settings panel

The gear beside Agent Reach in the Agents tab opens the channel setup panel
(`/api/agent-reach/setup`). It shows every platform's live doctor state and
offers three things:

- **Install tools** — one button per tool, running fixed recipes: `venv_pip` into
  `agent-reach/.venv`, `npm install -g`, `mcporter config add`, `config_line`
  (append a setting to a tool's own config), or `portable_archive` (download a
  release archive and lift the executables into `agent-reach/.tools/bin`).
  Both `.venv/bin` and `.tools/bin` are first on `PATH` for every Agent Reach
  spawn, so installing there needs neither a global install nor admin rights.

  `portable_archive` exists because **`winget` reliably hangs when it has no
  interactive console** — it sits at 0% CPU and never returns, even with
  `--silent --accept-source-agreements`. Three details it depends on:

  - Extraction names `%SystemRoot%\System32\tar.exe` explicitly. A PATH lookup
    finds Git Bash's MSYS tar first, and that one reads `C:\...` as a remote host
    and fails with "Cannot connect to C: resolve failed".
  - Downloads carry an `AbortSignal.timeout`. Without one a stalled mirror hangs
    the button forever — which is exactly what gyan.dev's ffmpeg endpoint does:
    it answers `HEAD` with a 200 and then never sends a body. ffmpeg therefore
    comes from BtbN's GitHub releases instead.
  - Prefer GitHub releases generally: they are the one source that has been
    reliable here, and `/releases/latest` redirects to the tag without needing a
    token or a rate-limited API call.
- **Logins and keys** — the credential keys `agent-reach configure` accepts
  (`groq-key`, `openai-key`, `github-token`, `twitter-cookies`, `xhs-cookies`,
  `youtube-cookies`, `proxy`).
- **Import cookies from a browser** — `agent-reach configure --from-browser
  <browser> --platform <platform>`, for one platform and one browser the user
  names. Nothing is read until the button is pressed.

Facebook, Instagram, and XiaoHongShu are deliberately absent from the automated
paths: they read through OpenCLI, which reuses a Chrome session the user is
already signed in to. Agent Reach's own boundary is that it never signs in for
the user or reads browser cookies unprompted, and Breadboard keeps that.

## Setup

The clone needs a Python environment. One time:

```bash
python -m venv agent-reach/.venv
agent-reach/.venv/bin/pip install -e agent-reach     # Scripts/ on Windows
```

`runtime.ts` finds `agent-reach/.venv` automatically and puts its `bin`/`Scripts`
directory first on `PATH` for every spawn — that is what makes `yt-dlp` (a declared
dependency of the package) work without a second global installation.

Optional overrides, both documented in `dashboard/.env.example`:

- `AGENT_REACH_ROOT` — path to the clone, when it is not a sibling of `dashboard/`
- `AGENT_REACH_BIN` — an explicit `agent-reach` executable

Everything else is done from the settings panel described above.

## Channel states

| Doctor says | Meaning | Behavior in a run |
| --- | --- | --- |
| `ok` | Working, with a named backend | Used freely |
| `warn` | Installed, may still need a login or key | One attempt; reports honestly if refused |
| `off` / `error` | Nothing installed | Not attempted |

`warn` is deliberately treated as usable. Doctor is conservative by design — Exa,
for example, reports `warn` with no backend once configured, because it refuses
to claim a remote service works without calling it, yet the search succeeds. The
run card colors these amber and the prompt tells the model to try once and report
rather than retry.

Zero-config channels (web via Jina Reader, RSS, V2EX) work as soon as the venv
exists. Everything else is one button in the settings panel, plus a login where
the platform requires one.

### What each remaining channel is waiting for

Once every tool is installed, the blockers are all credentials, and all of them
are the user's to supply — by design, since Agent Reach's own boundary is that it
never signs in on someone's behalf.

| Channel | Blocker |
| --- | --- |
| GitHub | `gh auth login`, or a token in **Logins and keys** |
| Twitter/X | Cookie-Editor export from x.com, pasted into the panel |
| Reddit, Facebook, Instagram, XiaoHongShu | The OpenCLI Chrome extension, plus being signed in to each site in that Chrome profile |
| Xueqiu | **Import cookies from a browser** |
| Xiaoyuzhou | A free Groq key (ffmpeg and the transcription script are installed by the panel) |
| LinkedIn | `linkedin-scraper-mcp` run as a separate MCP server. Not offered as a button: it defaults to port 3000, which collides with the dashboard. Public pages still read through Jina Reader. |

Two channels hide a *second* blocker behind the obvious one, so treat the first
green light with suspicion:

- **YouTube** — yt-dlp installs, reports itself present, and still cannot fetch,
  because YouTube serves JS challenges. It needs `--js-runtimes node` in
  `~/.config/yt-dlp/config`; the `yt-dlp` target writes that as a second step.
- **Xiaoyuzhou** — installing ffmpeg only moves the complaint to the transcription
  script, which lives in the package and must be copied to
  `~/.agent-reach/tools/xiaoyuzhou/`. The `ffmpeg` target does both.
