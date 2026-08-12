# Codex coding-agent integration

Codex is an optional repository coding agent in Breadboard's Agents palette. It
does not replace Hermes or any conversational runtime. Selecting
`/agents:codex` routes only that coding task to a new non-interactive Codex
process working inside the Git repository connected to the current Garden.

```text
Hermes chat / Garden chat
          |
    Agents palette
          |
   /agents:codex task
          |
authenticated Codex run API
          |
codex exec --json (repository working directory)
          |
 ChatMock /v1/responses
```

## Setup

Breadboard resolves the Codex executable in this order:

1. `CODEX_BIN`
2. `codex/codex-rs/target/release/codex` (then `target/debug`)
3. `codex` from `PATH`

Set `CODEX_BIN` if the clone has not been built yet:

```env
CODEX_BIN=C:\path\to\codex.exe
```

Desktop packaging stages the resolved executable in `resources/bin`. The
dashboard receives its path through `CODEX_BIN`; Codex is not registered as a
background service and opens no app-server port.

## Using it

Connect a local Git repository to a Garden, open Terminal or that Garden's chat,
open the slash palette, choose **Agents**, then select `/agents:codex`. The next
message becomes the coding task. Images attached to the message are passed to
Codex as temporary read-only inputs.

The result is stored as a durable external-agent turn and rendered inline with
reasoning summaries, commands, file changes, token usage, completion state,
retry, and stop controls. OpenCode remains available independently through
`/agents:opencode`.

## Provider and permissions

Every run pins a custom `chatmock` model provider using ChatMock's local
Responses endpoint. User-level Codex provider configuration is ignored for the
run, so selecting Codex cannot silently bypass ChatMock.

Codex no longer supports the older Chat Completions wire API, while subscription
models such as `cliproxy/claude-opus-5` expose only that API. ChatMock therefore
adapts Codex Responses requests to a complete chat-completions model step and
translates messages, function calls, tool results, token usage, and completion
events back to Responses format. The exact model selected in Breadboard remains
the model sent upstream.

Codex runs with non-interactive approval policy `never`. On Unix, Breadboard
uses Codex's `workspace-write` sandbox. The current native Windows CLI exposes
that mode as read-only unless its elevated sandbox has been installed, so the
Windows integration uses `danger-full-access` and launches from the connected
repository. In that mode Codex is not OS-confined to the repository; select the
agent only for repositories and tasks you trust.

Breadboard requires the user to select the coding agent and resolves coding
skills through its scoped implementation gate before starting the process.
