# Breadboard OpenHarness runtime config

This directory is Breadboard's OpenHarness (OpenCode fork) configuration. It is
loaded by pointing OpenHarness at it with `OPENCODE_CONFIG_DIR` (see the startup
scripts and `docs/OPENHARNESS_INTEGRATION.md`). It is intentionally kept OUTSIDE
the `openharness/` fork so future upstream merges stay clean and the fork's own
`.opencode` dev config is untouched.

Contents:

- `opencode.json` — environment-driven ChatMock provider wiring, default agent,
  and conservative permission defaults.
- `agent/breadboard-terminal.md` — the multipurpose dashboard terminal agent
  (permissioned edit/shell/git/tests).
- `agent/breadboard-garden.md` — garden chat agent, restricted to the curated
  `garden_*` tools only (no shell/file/git/web/task/skill).
- `agent/breadboard-quartz.md` — Quartz page agent, read-only-by-default,
  proposal-only writes, same tool restrictions as garden.
- `agent/breadboard-capability-scout.md` — subagent that can ONLY run
  `find-skills`; it cannot install or escalate.
- `agent/breadboard-document.md` — repository-free document analyst with no
  shell, edit, web, task, or skill capabilities.
- `tool/garden.ts` — the scoped `garden_*` tool adapters. Each reads the
  per-session capability token from the session workspace and calls back to
  Breadboard's internal tool endpoint. Tool `X` is exposed as `garden_X`.
- `tool/capability.ts` — narrow `capability_gap` and `capability_search`
  adapters for terminal/scout capability discovery.
- `skill/find-skills/SKILL.md` — discovery-only instructions backed by the
  official Skills CLI; it never installs or executes a result.

Security notes:

- The garden/quartz agents disable every generic tool (`"*": false`) and only
  enable the curated `garden_*` tools, plus `permission` denies edit/bash/web/
  task/skill. This is defense in depth alongside Breadboard's capability tokens
  and process/workspace isolation.
- `find-skills` is available only to the terminal and capability scout.
- The capability scout is a subagent that cannot be reached by the garden or
  quartz agents (they have `task: deny`), so it cannot become an escalation path.
