# openGym agent integration

Breadboard exposes the cloned `openGym` project as `/agents:open-gym`. The
agent is available in Terminal and Garden Chat, can be selected by Super Agent,
and starts as part of the Dashboard process. It does not require openGym's
Docker Compose stack or a second port.

## What is integrated

- The clone's `frontend/src/lib/exercises-data.js` is the source of truth for
  all 1,324 registered exercises, instructions, equipment, muscles, images, and
  animation filenames.
- Exercise technique requests are resolved deterministically against that
  catalogue. The response displays the registered instructions and autoplays
  the corresponding GIF in the inline openGym card.
- Broader coaching and full-program requests run a bounded ChatMock tool loop.
  It must search the openGym catalogue before naming exercises and reads the
  user's saved training state before writing a program.
- Stable preferences, the most recent run history, and up to 20 saved programs
  are persisted per Breadboard user. Writes are atomic and survive Dashboard
  and desktop restarts.
- Full programs are also rendered as Markdown artifacts scoped to the exact
  conversation that launched the run. If a launch has no artifact-capable
  conversation, the answer says so and the program remains available in the
  persistent openGym state.

The integration gives general fitness education. It explicitly does not
diagnose injuries, prescribe rehabilitation, or replace a qualified clinician.

## Animation delivery

The authenticated animation route accepts an exercise id, looks that id up in
the catalogue, and never accepts a filename from the request. It checks, in
order:

1. `openGym/media/gif` (useful when the upstream media archive was installed),
2. Breadboard's private media cache,
3. the exercise dataset at its pinned upstream revision on jsDelivr.

Downloaded files have a size ceiling and must carry a GIF signature before
they are written atomically to the cache. The saved assistant result contains a
small hidden list of catalogue ids, not image bytes or URLs; this is why a
reloaded transcript reconstructs the same animation card safely.
When the operating system requests reduced motion, the card waits for an
explicit **Play animation** click instead of starting the GIF automatically.

## Paths and packaging

In development the clone is discovered at `./openGym`. Set `OPEN_GYM_ROOT` only
when it lives elsewhere. State defaults to
`<BREADBOARD_DATA_DIR>/open-gym-agent/state` in packaged installs and to the
ignored `./.runtime/open-gym-agent/state` directory in development.
`OPEN_GYM_AGENT_DATA_DIR` and
`OPEN_GYM_MEDIA_CACHE_DIR` can override those locations.

Desktop packaging stages the catalogue plus the upstream license and notices
under `app-services/openGym`. It intentionally does not bundle the roughly
140 MB animation archive: animations remain lazy, cacheable assets, while the
agent and its catalogue are ready immediately at startup.

## Verification

From `dashboard/`:

```sh
node --test --experimental-strip-types tests/open-gym-agent.test.mjs
node --test --experimental-strip-types tests/capability-combinations.test.mjs tests/runtime-agent-briefs.test.mjs tests/external-agent-persistence.test.mjs
npx tsc --noEmit
```

For a live smoke test, start Breadboard and try:

```text
/agents:open-gym show me how to do a barbell bench press
/agents:open-gym build a three-day beginner strength program for 45-minute sessions with dumbbells
```
