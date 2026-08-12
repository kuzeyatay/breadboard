# Breadboard Hermes runtime config

This directory configures Hermes as Breadboard's knowledge-work runtime. It
is loaded through `OPENCODE_CONFIG_DIR` and intentionally lives outside the
`hermes/` fork so upstream updates remain small.

`agent/breadboard-assistant.md` is the canonical identity: the assistant is
named Bread, while Hermes remains the runtime. New sessions begin in
`knowledge` mode: repository file tools, arbitrary shell, Git writes, package
installation, builds, tests, and deployment are denied by default. In the
authenticated Terminal, commands outside the automatic read/verification set
can still run after the user approves the exact command. The Breadboard server
may attach a temporary `technical_read` or writable `scoped_implementation`
policy to the same identity; that policy enables only the file tools and roots
required by the task. A conceptual technical question never activates coding.

`agent/breadboard-terminal.md` and `agent/breadboard-workbench.md` are restricted
compatibility aliases for stored sessions. They do not restore historical broad
permissions. Garden, Quartz, and document profiles remain knowledge-only and
proposal/artifact oriented. Public Quartz never receives private connections,
conditional coding skills, repository access, or code-writing tools.

System instructions are composed from `system/assistant.md`, one surface prompt
(`main-assistant.md`, `garden-assistant.md`, `quartz-assistant.md`, or
`document-assistant.md`), a server-authored capability decision, and—only while
approved—`system/scoped-implementation.md`.

The important configuration areas are:

- `opencode.json`: provider wiring and conservative global defaults.
- `agent/`: canonical and surface-specific agents plus bounded specialists.
- `system/`: knowledge-first behavior and conditional implementation policy.
- `tool/garden.ts`: short-lived, garden-scoped read/proposal callbacks.
- `tool/capability.ts`: structured capability-gap and catalog-search callbacks.
- `tool/agent_loop.ts`: bounded Agent Loop Engineering Kit commands that design,
  validate and dry-run a loop contract inside the session's own workspace. It
  never executes a loop and never creates scheduled automation.
- `skill/find-skills/SKILL.md`: discovery instructions; discovery never installs
  or executes a result.

Security boundaries are enforced outside prompt text as well: the dashboard
owns the mode decision, authorized roots, runtime permission rules, command
registry, skill classification, MCP intersection, audit record, expiry, and
revocation. Skills and connections can only reduce the effective tool set; they
cannot widen it. General skills promote to the approved store. Reviewed coding
skills promote to `hermes-skills/conditional/` and load only for a relevant,
authenticated `scoped_implementation` task.

MCP connections require explicit user configuration. Remote connections prefer
OAuth; local execution requires approval and keeps credential values outside
stored/public metadata. A configured connection cannot bypass the active mode.

GBrain is not treated as integrated because code happens to exist locally. The
assistant may claim memory only after a configured adapter returns a healthy,
durable result.

See `docs/HERMES_INTEGRATION.md` for the runtime flow, migrations, palette,
skill lifecycle, and environment variables.
