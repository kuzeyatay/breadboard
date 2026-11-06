# Spotify native Next / Autoplay

The old dock generated a queue from Recommendations or artist-catalog search,
and engine heartbeats appended those tracks whenever the SDK queue was empty.
That behavior has been removed. Next continues to use Spotify's own SDK command
or the active device's Spotify Web API command.

Search results retain Spotify's album URI and start with `context_uri` plus an
offset for the selected song. This preserves a native context instead of sending
a finite one-song `uris` list. Playlist song selection similarly retains its
playlist and offset. Explicit Liked Songs/top-song lists keep their selected
order. Valid album metadata survives saved recent-song history. Older records
without album metadata remain playable but cannot supply that native context.

Album playback can continue through the remaining album before Spotify Autoplay;
this is not a request for the phone app's exact personalized radio seed. No
unsupported station URI or replacement recommendation algorithm is used.

## Live verification

The user explicitly requested opening a song and clicking Next in a test
environment. Used the real dock UI, modified server route, real player bridge,
and live Spotify SDK/API in an isolated, muted Edge profile. The test used the
connected account's authorized token in memory; its database and engine
registrations were isolated. Breadboard was kept open and its build untouched.
No playback was active before the final test. The temporary test device was
paused and its browser closed afterward. Automatic approval review blocked the
temporary profile cleanup command with only the reason "blocked by policy";
the closed test profile remains under dashboard/.tmp-spotify-native-next-qa/.

- Initial finite-track test: Ocean Drive played; Next stopped at an empty queue.
- Final context-preserving test: Ocean Drive played for over 2.5 seconds, with
  Hymn for the Weekend already present as Spotify's next track.
- Clicked the actual Next button: Hymn for the Weekend played; position advanced
  to 5.856 seconds and Spotify supplied Disparate Youth as the next track.
- Clicked Next again: Disparate Youth played; position advanced to 5.713 seconds
  and Spotify supplied Think next.
- Both resulting track URIs exactly matched the preceding SDK `next_tracks[0]`.
- Zero Spotify SDK playback/authentication/initialization errors in the final run.
- During the two-Next sequence, the only server-side Web API write was the
  initial play-with-context request; Next traveled directly through the SDK.
  No Recommendations calls, catalog fallback, or queue insertions. Cleanup
  paused the test device afterward.

Earlier disposable browser contexts had protected-audio license failures; those
runs were not accepted as clean playback verification. A separate persistent
test profile with normal component updates resolved the test-browser issue.
The final player was muted: playback was verified through actual SDK state and
advancing position, not by listening to audio output.

Results: [live JSON](./spotify-native-next-20260929.json).
Screenshot: [second Next](../dashboard/.tmp-spotify-native-next-qa/native-next-result.png).

94 focused checks passed across route/service, authenticated engine updates,
native SDK controls, history metadata, rendered search, and browser contracts.
Changed TypeScript files passed semantic checks and ESLint; diff whitespace check
passed. Activation in the running app still requires rebuild/restart, which the
user previously deferred.

References:
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback
- https://developer.spotify.com/documentation/web-playback-sdk/reference
- https://support.spotify.com/us/article/autoplay/
