# Graft Code Index

[graft](https://github.com/nanonets/graft) turns a repository into a graph of
symbols, spans and call edges. A coding agent that has it answers *"where does X
live"*, *"what is this file's API"* and *"what breaks if I change Y"* in one
call, with exact `file:line`, instead of paying for a grep-and-read sweep on
every task.

Breadboard builds that graph for the repository a Garden is connected to and
hands it to every coding agent as an MCP server. **On by default, for every
Garden**; `clusters.graft_enabled` is the per-Garden opt-out.

This document describes the implementation as built.

## Shape

```text
Garden with a connected repository (clusters.repo_path)
          |
          +-- clusters.graft_enabled          default 1, toggled in Edit garden
          |
          v
dashboard/src/lib/code-index/
  launcher.ts        finds @nanonets/graft's dist/cli.js, runs it with this Node
  index-service.ts   graph directory, background build, MCP server, instruction
  garden.ts          the per-Garden setting + graftRunContext() for the routes
          |
          v  graft --dir <graph> mcp <repository>
   +------+----------------+------------------+
   |                       |                  |
 Codex                 OpenCode             Ruflo
 -c mcp_servers.graft  config clone: mcp    per-run ruflo.mcp.json
```

Each run also gets a short prompt block naming the tools (`graft_find_code`,
`graft_find_all`, `graft_trace_calls`, `graft_file_api`, `graft_repo_map`) and
the CLI fallback. Tools nobody mentions go unused.

## Two decisions worth knowing

**The graph lives outside the connected repository.** graft's normal layout is
an in-repo `graft/`, which also writes `.gitignore` and `.ignore` into the
working tree. Those files would land in the run's undo snapshot and in the diff
Breadboard shows for the run, so Breadboard passes `--dir` and keeps the graph
under `.runtime/graft/<repository>-<hash>/` (override with
`BREADBOARD_GRAFT_HOME`). A connected repository is the user's: a run leaves
exactly the edits it made, and nothing else.

**The build never blocks a run.** A cold graph on a large repository takes
minutes. It is started when the repository is connected, and again by the first
run that finds none — that run proceeds without graft, and every run after it
has the graph. graft refreshes the graph itself before answering, so staleness
needs no handling on Breadboard's side.

The module directory is `code-index/`, not `graft/`, on purpose: this repository's
own `.gitignore` carries graft's auto-added `graft/` rule, which is unanchored
and would silently ignore any source directory of that name — and `graft build`
re-appends the rule whenever it is missing, so anchoring it is not a durable fix.

## Requirements

`npm install -g @nanonets/graft`. The launcher looks in the npm prefix, in
`%APPDATA%\npm`, and beside every `PATH` entry (the npm bin directory keeps its
packages in a sibling `node_modules`, which is what makes version managers
resolvable). `BREADBOARD_GRAFT_CLI` points at a `dist/cli.js` directly. With no
CLI installed, `graftRunContext` returns null and every agent runs exactly as it
did before.

## Wiring per runtime

| Runtime | How the server is registered |
| --- | --- |
| Codex | `-c mcp_servers.graft.*` overrides — the run uses `--ignore-user-config`, so a config file would not be read |
| OpenCode | the per-run config clone (`runConfigPath`), which also names graft ahead of codebase-memory in the `breadboard` agent's prompt |
| Ruflo | the per-run `ruflo.mcp.json`, beside the `ruflo` server — one index shared by every worker in the swarm |

OpenCode reaches graft through MCP rather than its shell tool on purpose: the
`breadboard` agent denies `external_directory` and asks before every bash
command.

## Tests

`dashboard/tests/graft-code-index.test.mjs` — CLI resolution, the graph staying
outside the repository, the MCP server's arguments, the instruction, both config
transforms, and the promise that every route resolving a connected repository
hands its run a graft context.
