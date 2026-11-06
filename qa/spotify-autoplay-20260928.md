# Spotify follow-on playback — 2026-09-28

Implemented in dashboard source; activation awaits the previously requested dashboard rebuild/restart. No live account playback was changed for verification.

- Authenticated audio-engine registrations schedule empty-queue replenishment after their HTTP response. This continues without an open Spotify popover and adds no wait to transport controls or engine heartbeats.
- Keep existing playlist, manual queue, and Spotify radio items. Append one next song only, explicitly targeting the Breadboard device. Spotify advances to it through its normal queue playback.
- Prefer Spotify recommendations. If its API is denied (403/404/410), use playable catalog songs by the seed artist; cache the unavailable capability per connection for an hour. This fallback is not Spotify's personalized radio. Prefer tracks not recently heard.
- Recheck queue, active device, track, playing state, and repeat mode after discovery. Pending work is cancelled by dock controls, local pause/state changes, and disconnects. Never issue play, resume, transfer, or skip from autoplay.
- Deduplicate per user and track, bound retained state, back off on provider failures/rate limits, and do not repeat ambiguous queue writes.

Validation: 116 tests passed across Spotify autoplay, library/provider behavior, dock routes, local bridge controls, dock progress UI, engine registration/events, and Runtime ownership. ESLint and TypeScript diagnostics passed for all changed TS files; git diff whitespace checks passed.

Tests use mocked Spotify provider/SDK boundaries. The engine-route test exercises authenticated registration, deferred work, queue population, and subsequent-song replenishment. Live audio continuation and personalized Spotify availability remain unverified until activation.

References: https://developer.spotify.com/documentation/web-api/reference/add-to-queue and https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

## Follow-up: SDK queue evidence

The runtime player now includes `track_window.next_tracks` availability and
`repeat_mode` in its authenticated engine samples. Empty SDK queue evidence
avoids dependence on stale or incomplete cloud queue snapshots; upcoming SDK
tracks and repeat prevent replenishment and cancel pending discovery. The
active cloud device, track and playing state are still checked before appending.
Older player samples retain the cloud queue fallback, which now tolerates a
missing `currently_playing` item only when the active-player check confirms it.

Added tests cover unavailable cloud queues, upcoming tracks/repeat arriving
during discovery, malformed hints, and the real runtime bridge publishing hints.
The focused autoplay/event tests pass. Live continuation remains unverified:
automatic approval review blocked the proposed live track-start/queue test with
no specific reason supplied. These latest changes still require activation.

SDK reference: https://developer.spotify.com/documentation/web-playback-sdk/reference
