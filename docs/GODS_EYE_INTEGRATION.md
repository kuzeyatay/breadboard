# God's Eye — the gods-eye-view live globe as a runtime agent

`/agents:gods-eye` (id `gods-eye`, name "God's Eye") aims the cloned
[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
globe — a photorealistic 3D Earth with live aircraft, ships, satellites,
earthquakes, fires and public cameras — at whatever the message asks to see,
and answers with that view framed in the chat. Clone at `gods-eye-view/`
beside the dashboard; lib in `dashboard/src/lib/gods-eye/`.

## Shape

**Wrapped runtime, whole app.** The clone's Vite dev server is also its
backend: the globe, the share-link restore, and the fifteen proxy middlewares
feeding the live layers are all `vite dev`. So the runtime is the checkout with
`npm install` run in place (no build, no Breadboard-owned copy), supervised as
one lazily started long-lived local service (`service.ts`, modeled on
Classroom's). It stays up after the run so framed views keep working.

The run itself is small and executes in-process (`run-manager.ts`):

1. `ensureService()` — boot the dev server if it is down.
2. One ChatMock `chat/completions` call turns the task (plus the launching
   chat's context) into a **view**: `{label, lat, lon, altM, headingDeg,
   pitchDeg, style}` plus a summary sentence. `normalizeGodsEyeView` clamps
   everything; off-planet coordinates refuse the run.
3. The terminal summary carries the view invisibly as an HTML-comment marker
   (`GODS_EYE_VIEW:` in `view.ts`, the openGym pattern), so a reloaded card
   re-frames the globe with no server-side memory.

## The frame

`inline-gods-eye-run.tsx` renders the view as an iframe of
`/api/gods-eye/open?lat=…&lon=…&alt=…` — Breadboard's route, never the dev
server's port, which changes per boot. The route validates the query, rebuilds
the clone's share-link hash (`#lat=…&alt=…&style=…&hud=tactical&hv=1&map=photoreal`,
`sharelink.js` dialect, asserted against the clone by
`tests/gods-eye-agent.test.mjs`) and 302-redirects into the running server with
`?welcome=0` so the first-run mission card stays out of the frame.

The frame chrome uses the clone's own design language (near-black, glass
borders, cyan `#00d4ff` accent, mono readouts) and is deliberately identical
in light and dark. It is as wide as the message text column. A **live**
completion mounts the feed at once; a **restored** card parks it behind one
"REACQUIRE FEED" click, so scrolling old chats neither boots the dev server nor
spins up Cesium.

## Super Agent mode

A delegated God's Eye is a *self-presenting delegation*, like openGym: the
worker row stays visible, the card renders in `quiet` mode (no
`bb-agent-run-card` chrome — meta line, the summary, the framed globe), and no
synthesis continuation is queued (`GODS_EYE_AGENT_ID` joins openGym's guard in
both surfaces' `onLaunched`). `super-agent.ts` carries a routing rule; the
selection brief lives in `runtime-agent-briefs.ts`.

## Setup and keys

Settings dialog (`gods-eye-settings-dialog.tsx`, opened from the command hub):
`npm install` in the checkout (user-pressed button only; `setup.ts` runs npm's
`npm-cli.js` next to this Node), and the one required key. `GOOGLE_MAPS_API_KEY`
is stored one-way in `.runtime/gods-eye/credentials.json` (or exported in the
environment, which wins) and reaches the clone through the child's env — Vite's
`loadEnv` lets `process.env` beat the clone's own `.env`. The clone's README is
explicit that this key is client-exposed by design; restrict it in Google
Cloud. Health reports whether the key is set, never its value.

## Files

- `dashboard/src/lib/gods-eye/` — identity, view, runtime, credentials,
  service, setup, run-manager
- `dashboard/src/app/api/gods-eye/` — runs, events (SSE), abort, health,
  setup, open (the redirect the iframe loads)
- `dashboard/src/app/components/hermes/inline-gods-eye-run.tsx`,
  `gods-eye-settings-dialog.tsx`
- Registry/wiring: `external-agent-runs.ts` (`gods_eye` → `godsEyeRun`),
  `external-agent-cancel.ts`, `super-agent-activity.ts`,
  `capability-combinations.ts`, `runtime-agent-briefs.ts`, `super-agent.ts`,
  both chat surfaces, composer, command hub
- `dashboard/tests/gods-eye-agent.test.mjs`
