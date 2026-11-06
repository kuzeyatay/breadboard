# Veo subscription video

`/veo` is a Featured Breadboard skill for Garden chat and the dashboard terminal.
It attaches the `google-flow` connection, discovers available Veo models, tracks
one generation by job ID, and imports its downloaded video into the chat.
It uses the Google account signed into Breadboard's browser and Flow credits.
No Gemini API key or CLIProxy video endpoint is involved.

## Setup

For a source checkout, run `node scripts/setup-veo.mjs`. Rebuild the desktop and
dashboard after integration changes; a running production app does not hot reload.

1. Sign in to Google in Breadboard's browser if needed.
2. Open **Settings → Connections → Google Flow · Veo**.
3. Click **Connect in background**. Breadboard verifies actual Flow workspace access.
4. Use `/veo` with a video prompt.

Connection checks and generation use a dedicated hidden page in Breadboard's
browser partition. It does not appear in the tab strip, take focus, or launch an
external browser. Google sign-in is shared with ordinary Breadboard browser tabs;
no cookies are exported or copied. Authentication needing human input is reported
as `login_required`; generation never silently opens a visible login window.
No video is generated during setup or connection checks.

## Runtime

The unmodified `google-flow-mcp` source is pinned to
`miyakejima/google-flow-mcp@6826452a4a2e93bf7313d1be1626a9034fd7dc27`
(0.2.3, MIT). `scripts/google-flow-upstream.json` records source hashes. Setup
verifies them and runs the upstream tests.

The supervised MCP broker starts the absolute upstream `dist/index.js` with a
Breadboard preload. Job/account metadata is isolated at
`<Breadboard data>/runtime-v2/services/google-flow/users/<user ID>`.
`scripts/google-flow-browser.mjs` adapts its browser manager to the authenticated
Breadboard bridge's `flow_tab` action. The shell chooses the exact hidden target;
MCP callers cannot choose a CDP URL, a visible tab, or an external executable.
Each operation checks the desktop account and obtains the current target again,
so app restarts do not depend on a stale saved debugging port. The adapter accepts
both Google's current `flow.google.com` and its older Labs Flow URLs while keeping
upstream workspace validation, generation, and exact asset tracking.

Settings invokes a fixed local verifier (`connect-google-flow.mjs`) using the
upstream `attach_cdp` connection path. The extension handoff is not used.
Disabling the MCP retains the user's normal Breadboard Google sign-in.

The MCP timeout is 120 seconds; Hermes allows 145 seconds for broker overhead.
The skill polls short intervals and never resubmits after an ambiguous generation.
It chooses an available Veo model explicitly, defaults to one clip with no upscale,
and imports only the files belonging to the returned job ID. Google UI changes
can require a reviewed adapter update. End-to-end readiness requires verification
against the user's signed-in Flow workspace, beyond passing fixture tests.
