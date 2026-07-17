# OpenHarness — Breadboard integration

OpenHarness is Breadboard's fork of [OpenCode](https://github.com/anomalyco/opencode).
It is the **interactive AI agent runtime** behind Breadboard's three interactive
surfaces:

1. Dashboard AI terminal
2. Garden chat
3. Quartz page AI

It is **not** Breadboard's learning-content generation engine — document
ingestion, source extraction, garden/topic/spine/section generation, council and
critic loops, deterministic repair, semantic auditing, finalization, Quartz
publication, and embeddings all remain on the existing ChatMock / OpenAI-compatible
pipeline. OpenHarness is only the interactive agent harness.

## Trust boundary

The browser never talks to OpenHarness. Breadboard's dashboard is the application
authorization boundary:

```
Browser UI → Breadboard dashboard backend (auth, authz, session records,
             agent/workspace selection, tool filtering, event normalization)
           → OpenHarness server (agent execution, tools, model access)
```

OpenHarness binds to `127.0.0.1:4096` and is protected with a server password
(`OPENCODE_SERVER_PASSWORD`). Credentials, provider keys, filesystem paths, and
the raw event stream never reach the browser.

## Intentional divergences from upstream OpenCode

Kept deliberately small so upstream merges stay feasible:

- **`bin`**: added an `openharness` alias alongside `opencode` in
  `packages/opencode/package.json`. Both point at the same entrypoint; no internal
  symbols were renamed.
- Everything else Breadboard needs is provided as **external configuration**, not
  fork edits: agents, scoped tools, and provider wiring live in Breadboard's
  `openharness-config/` directory (loaded via `OPENCODE_CONFIG_DIR`), and skills
  live in Breadboard's `.agents/skills/`. This keeps the fork close to upstream.

## Configuration Breadboard supplies (outside this repo)

- `breadboard/openharness-config/opencode.json` — provider (ChatMock,
  OpenAI-compatible at `127.0.0.1:8765/v1`), default agent, permission defaults.
- `breadboard/openharness-config/agent/*.md` — `breadboard-terminal`,
  `breadboard-garden`, `breadboard-quartz`, `breadboard-capability-scout`.
- `breadboard/openharness-config/tool/garden.ts` — the scoped `garden_*` tools
  the garden/quartz agents use to reach Breadboard content via a capability token.
- `breadboard/.agents/skills/*` — first-party Breadboard skills + `find-skills`
  (find-skills is restricted to the terminal and capability scout).

## Running as Breadboard's runtime

```sh
OPENCODE_SERVER_PASSWORD=... \
OPENCODE_CONFIG_DIR=<abs path>/breadboard/openharness-config \
openharness serve --port 4096 --hostname 127.0.0.1
```

See `breadboard/docs/OPENHARNESS_INTEGRATION.md` for the full picture, startup
scripts, and the agent/permission/tool model.

## Build note

OpenHarness is a Bun + Effect monorepo (`bun@1.3.14`). Building/running it requires
`bun install` in this directory. On machines without Bun, the Breadboard dashboard
detects OpenHarness is unavailable and falls back to its prior behavior — no
interactive surface breaks.
