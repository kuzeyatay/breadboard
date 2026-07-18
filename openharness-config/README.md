# Breadboard OpenHarness runtime config

This directory is Breadboard's OpenHarness (OpenCode fork) configuration. It is
loaded by pointing OpenHarness at it with `OPENCODE_CONFIG_DIR` (see the startup
scripts and `docs/OPENHARNESS_INTEGRATION.md`). It is intentionally kept OUTSIDE
the `openharness/` fork so future upstream merges stay clean and the fork's own
`.opencode` dev config is untouched.

Contents:

- `opencode.json` — environment-driven ChatMock provider wiring, default agent,
  and conservative permission defaults.
- `agent/breadboard-workbench.md` — the common capable primary agent used by
  terminal, Garden, and Quartz. Surface context is additive; risky mutations
  remain permissioned.
- `agent/{planner,repo-explorer,web-researcher,file-analyst,file-operator,
  code-implementer,test-runner,document-analyst,garden-specialist,
  memory-specialist,verifier,capability-scout}.md` — bounded specialist
  subagents. Specialists cannot recursively delegate.
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

- Garden and Quartz data remains protected by short-lived, server-validated
  capability tokens even though the workbench can also use general tools.
- Mutating filesystem and shell actions remain behind OpenCode permissions.
- `find-skills` discovery does not install; promotion remains a separate,
  audited human approval step.
