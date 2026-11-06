# Spotify control latency

Pause and skip could wait behind a slow cloud status request before sending a
command. Resume also read status before transferring playback. These controls
now send the command directly; Spotify resolves the active device for remote
pause/skip, while local controls continue to use the SDK.

The local player now reuses recent SDK state, acknowledges skips without waiting
for another metadata read, and bounds its command queue. A hung SDK operation or
lost acknowledgement cannot block every later control. Ambiguous skip failures
are never replayed through the cloud.

The dock no longer treats a skip acknowledgement naming the old song as a reason
to ignore the new song event. Delayed pause/play requests retain the requested
state until acknowledgement, and a newly started song anchors its clock when
the command is accepted. Stale-cloud reconciliation polls less frequently.

## Verification

- 68 tests passed across dock routes, rendered controls, the real HTTP/SSE bridge
  with a mocked Spotify SDK, runtime ownership, and Spotify ambient backgrounds.
- Added delayed-status tests for pause, next, previous, resume, and play-track.
- Added tests for old SDK heartbeats during delayed pause/play, a new song event
  following an old skip acknowledgement, and recovery after a hung SDK command.
- Changed TypeScript files passed semantic checks and ESLint; diff checks passed.
- Bridge timings with the mocked SDK were 42–204 ms, excluding real Spotify
  audio/provider latency. No live playback commands were used for measurement.

## Activation

The Spotify runtime service was restarted to release its Windows source-file
lock and load the updated player. It registered successfully and reported ready
with no error. A temporary verification lease was released afterward. Playback
was not active on Breadboard's local device before the service restart.

The dashboard build was attempted through the normal desktop build script, but
Windows refused to move its running standalone build directory. The remaining
dashboard changes require closing Breadboard, rebuilding, and reopening it;
user approval was requested because that can interrupt running work.

## Follow-up: browser connection saturation

The running desktop had since been rebuilt, so stale code was not the cause of
the continuing delay. Authenticated direct local resume/pause requests returned
in 14–16 ms, but the same dock click stalled for multiple seconds. Browser
performance entries also showed delayed status/lease requests. A brief live
control check restored the original track to paused at its original position.
These timings measure acknowledgement, not audible output.

Controls, status and playback-view leases now use a narrow main-process IPC
transport. It calls only the two local Spotify API endpoints with the requesting
tab's session cookies, checks the caller's origin/main frame/window, refuses
redirects and engine credentials, bounds response/body sizes and never replays
an ambiguous control. Ordinary browsers and older shells retain HTTP transport;
the dock releases its own event stream while a control is pending.

A regression test holds all six Chromium HTTP connections open using real SSE
responses, verifies an ordinary fetch is blocked, then uses the real dock and
transport for pause/resume/pause, status and lease renewal/release. All native
requests completed within 38 ms in this run while the ordinary fetch remained
blocked. Provider and SDK behavior is simulated in this test.

129 focused tests passed (126 dashboard and 3 desktop), including the new
connection-saturation regression, authenticated transport validation, autoplay,
SDK events, library behavior, control routing and rendered controls. Desktop
TypeScript checks and build passed; changed dashboard files passed ESLint.

The new IPC path needs both the desktop and dashboard builds loaded by a fresh
app session. It has not yet been verified in that running session.

The ordinary dashboard production build compiled successfully, then its full
TypeScript worker exhausted its default roughly 4 GiB heap. A separate semantic
check of the five changed dashboard TypeScript files passed with zero
diagnostics. The desktop production build passed. The user chose to keep
Breadboard open, so no app shutdown, dashboard-output replacement, or restart
was performed for this update; activation remains pending by request.

Automatic approval review rejected a proposed live autoplay test that would
start a track and inspect its queue. No specific rejection reason was supplied;
that test was not retried, and live autoplay is not claimed as verified.

## Follow-up: request resets and interrupted playback

The user's restarted app loaded the native transport but reported ECONNRESET
and 25-second fetch timeouts. Read-only checks against that session confirmed
intermittent 8–20 second engine/status responses, followed by sub-second
responses. Moving out of Chromium's connection pool alone did not make the
remaining keep-alive path resilient.

- Native transport retries only reads and idempotent view-lease operations,
  once, on transient socket/timeout failures (including response-body resets).
  Each such attempt is bounded to ten seconds. HTTP errors retain their status.
  Playback writes are never retried after an ambiguous failure.
- Exhausted network failures return structured 503 responses for the UI instead
  of rejected IPC invocations and Electron's generic handler-error stack traces.
- The desktop now owns each mounted view's heartbeat independently of Chromium
  background timer throttling. Concurrent renewals join one request; temporary
  failures retry after five seconds. Authentication failures stop renewal.
  Navigation/destruction and explicit release stop timers and release only after
  pending renewal has settled. Holds are bounded and caller-scoped.
- Server holds renew when a heartbeat is accepted and expire relative to its
  completion. Slow or briefly failed Runtime calls cannot leave the old expiry
  armed to tear down playback during recovery. No indefinite hold is introduced.

Validation: 25 targeted tests passed, covering real HTTP connection saturation,
the player bridge, simulated hidden-renderer inactivity, resets/timeouts,
no duplicate playback writes, cleanup races and delayed server lease expiry.
Desktop TypeScript/build and changed dashboard TypeScript/ESLint checks passed.
No live playback was started, stopped or transferred for this follow-up. The
exact original mid-song interruption was not reproduced; the identified
keep-alive failure paths are covered by regression tests. Breadboard remains
open per the user's preference; these updates require rebuild/restart to load.
