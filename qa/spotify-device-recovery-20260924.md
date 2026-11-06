# Spotify device recovery

The artist player could report ready while Spotify rejected its cached device
ID. The SDK's `not_ready` callback refreshed that ID instead of withdrawing it,
and the dashboard returned the rejection without reconnecting.

Changes:

- Offline registrations invalidate only the matching user's current device.
- The protected player reconnects after `not_ready`, shares concurrent reconnects,
  and ignores disconnect events for a replaced device.
- A scoped runtime reconnect command returns the SDK's newly ready device ID.
- Dock play, resume, and transfer commands recover from explicit
  `spotify_device_unavailable` responses. Retries preserve the requested music,
  are bounded, and stop on rate limits or ambiguous provider failures.

Validation: 80 tests passed across dock playback, engine registration, runtime
ownership, inline playback, playback events, and the real HTTP/SSE browser bridge
with a mocked Spotify SDK. ESLint passed for the changed TypeScript files.
The bridge test covers offline registration, reconnect, and a delayed disconnect
for the old device. Live audio delivery was not tested: Spotify was playing on
the user's iPhone, so playback was left undisturbed.

Activation: the Spotify service was restarted to release its Windows script
lock and load the updated service. Through the existing authenticated desktop
session, a temporary player view lease was acquired; the engine subsequently
reported `ready: true`, `status: ready`, and no error. The temporary lease was
released. The running dashboard is a compiled standalone build and still needs
to be rebuilt/restarted for its route and engine-registration changes to apply.
The normal build preflight refused the rebuild: 15,551 MB free Windows commit,
versus an 11,321 MB reserve plus an 11,264 MB build estimate. No admission limit
was changed and the desktop was not restarted.
