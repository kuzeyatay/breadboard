# Clap and finger-snap controls

Open **Settings → Voice → Clap controls**, or the same controls in Profile.
Clap controls start **off**. The default binding is **two claps → Start dictation**.
Use the switch beside each **Clap controls** or **Finger-snap controls** heading
to start or stop listening. Microphone permission, pause, and error messages appear
below the heading when needed.
Existing explicitly saved action choices are retained, but the old implicit
localStorage enable flag is not migrated into microphone permission.

Profile also has **Finger-snap controls** with a single/double gesture choice,
sensitivity, calibration/test panel and prompt
editor.
It starts **off**, with **one snap → Play “Snap” by manifest on Spotify**
selected. The default uses the verified track URI
`spotify:track:4EsRpVBBKiqOZ67DJj0QHF` ([Spotify track](https://open.spotify.com/track/4EsRpVBBKiqOZ67DJj0QHF)),
so it does not search for an approximate match. Playback uses the existing
Spotify connection and Breadboard's player. It opens and focuses a new tab,
starts the player, waits for its device, and plays the track there. **Restore Snap by manifest** restores that binding.

Both controls can be disabled together or independently. Disabling one preserves
the other's setting and action. Turning both off releases the microphone. Their
settings and actions are separate authenticated SQLite records, so adding snaps
does not replace existing clap preferences. Both use the microphone selected in
Clap controls; enabling snaps alone still works when clap controls are off.

Each widget has a **Keep listening in parallel** switch, initially off. Turn it
on to let that gesture listen alongside recording/playback and from a background
tab or window. The switches save independently; changing one does not enable a
stopped listener or change the other gesture. Existing saved preferences retain
their values and default this new switch to off. Playback can trigger gestures
in parallel mode. Test and calibration still suppress all actions.

1. Select the microphone. An unavailable saved device shows an error and is
   never replaced silently with another device.
2. Press **Calibrate**. Stay quiet for two seconds, then make the selected
   gesture three times, with two seconds between gestures. Review the suggested
   sensitivity and test it again. Raise sensitivity if a deliberate gesture is
   missed; lower it if ordinary sounds are accepted.
3. **Test claps** shows accepted impulses and a signal explanation. Calibration
   and testing never dispatch actions and work without a speech provider.
4. Choose one action and enable listening. **Resume listening when Breadboard
   starts** is a separate preference, initially off. Listening status and Stop
   listening live in settings; there is no floating status notice. Off releases
   the owned microphone; closing settings keeps an
   explicitly enabled listener alive.

## Actions

- **Start dictation:** opens and focuses a new dashboard tab, expands its chat
  dock, waits for its composer, and starts dictation without submitting a draft.
- **Open voice conversation:** opens and focuses a new dashboard tab, waits for
  the chat dock and speech controls to mount, then opens voice and says hello.
  Greeting and replies use the selected OpenAI subscription or Voicebox provider.
  Voicebox greets before capture; OpenAI greets with input muted until playback
  finishes. An unavailable provider shows an error in the voice UI.
- **Page and music actions:** open and focus their destination in a new tab.
  Music opens the Spotify dock and uses Breadboard's device even if another
  Spotify device is active. It waits for the dock's playback lease to be ready.
- **Review a saved workflow:** selects one of the authenticated user's saved
  workflows and opens its existing editor in a new tab. A banner explains that nothing has
  run. Review the steps and required inputs, then press the normal Run control
  to confirm. The existing workflow endpoint and execution constraints apply.
- In either Profile prompt editor, **Save action** saves the request directly without
  executing it or making an interpretation request. Standalone voice, dictation,
  page and default music prompts use direct shortcuts. Other requests, including
  compound tasks, run in a new AI agent chat when the gesture is detected.
  The agent chooses its tools at execution time from the reviewed Super agent
  inventory, including `breadboard_use` and `computer_use` when applicable.
  Existing connection and filesystem permissions still apply (`yoloMode` stays
  off). The chat shows progress, results, questions and any required permissions.
  The server refuses changed or unsaved requests and deduplicates event IDs.
  Existing direct page, Spotify, voice, dictation and workflow choices remain
  supported. AI never classifies ambient microphone audio.

Speech, music and agent actions use a two-minute, account-scoped, single-use
handoff checked against the saved action after the destination loads. Reloading
or copying its URL cannot replay it. The desktop shell opens a foreground tab;
in a regular browser, a blocked popup falls back to navigating the current tab.
Successful actions do not show a floating notification.

## Lifetime, ownership and privacy

One persistent provider owns capture in an authenticated trusted tab.
Notification overlays, authentication pages, preview/embedded frames and
teaching controllers never own ambient capture. Native tab identity and window
focus decide desktop eligibility when parallel listening is off. With parallel
listening on, a background tab can own capture; foreground-presence broadcasts
give a foreground listener priority and allow fallback when it leaves. Web Locks coordinate one detector across
same-origin windows/tabs. React Strict Mode and reloads release the old lease.
Cross-window broadcasts carry control notifications, not microphone samples.
Claps and snaps share this one capture and worklet. Their independent pattern
states feed one 1.5-second action cooldown, preventing two actions from the same
sound. While either calibration/test panel is active, actions for both controls
are suppressed; only the selected test gesture is counted.

Dictation, voice, music recognition, meeting recording, voice samples, Clicky
and demonstration narration retain their own microphone constraints. Their
shared foreground lease first causes ambient capture to stop and close, then
allows foreground recording to start when parallel listening is off. A gesture
with parallel listening on instead uses a shared audio lease, allowing capture
alongside the foreground feature. Restricted gestures are disabled in the shared
detector while audio or background restrictions apply; each widget shows its own
pause reason. Speech playback, document audio/video,
and the existing Spotify players' reported playing state also hold the ambient
pause for restricted gestures. External webpages and sounds outside Breadboard are not guaranteed to be
observable. After release, there is a settling interval and a fresh ambient warm-up.
Owned tracks, ports, nodes and contexts are released on disable, ownership loss,
logout, unmount and capture failure. Late permission grants are stopped before
the ownership lock can be released. Route changes within the active tab keep
the capture alive.

Inactive/minimized windows pause gestures unless their parallel switch is on.
The detector does not operate after app exit, OS sleep or browser suspension.
No additional global throttling override or background daemon is introduced.

Ambient audio stays in bounded local memory. It is not sent to a transcription
route, recorded, attached, transcribed or logged. Only small transient diagnostics
reach the UI at 10 Hz per gesture type; no audio buffers leave the worklet. The selected action
can use its ordinarily configured speech, Spotify, or workflow services.

## Detector and packaging

The tested TypeScript core is bundled into `public/audio/clap-controls.js` by
`npm run build:clap-worklet`. Development/prebuild hooks and the standalone
desktop build run the same bundler. The worklet is a local asset with its MIT
notice; no CDN, eval, Python process, ML model or CSP relaxation is needed.

The upstream-inspired bandpass/adaptive threshold/debounce design has stateful
250 Hz high-pass and 4.2 kHz low-pass biquads (upper cutoff respects Nyquist).
Normalized Float32 PCM feeds 10 ms frames, an impulse-excluding adaptive noise
estimate, onset rise and crest-factor/band-energy checks, short duration/decay,
hysteresis and a 100 ms onset refractory interval. The core uses sample-derived
monotonic time and preserves state across arbitrary worklet blocks. Suspension,
discontinuities and device changes reset the detector and warm-up.

The explicit pattern states are idle, first onset, waiting for second, matched,
and cooldown. A pair separated by 150–650 ms emits once after the second
impulse's brief decay; further onsets are ignored for 1.5 seconds. An immediate
accepted pair cannot establish whether a third clap will follow. Diagnostic
scores are heuristics, not calibrated probabilities.

Finger-snap recognition is a Breadboard extension to the transient core. It
checks the burst's energy concentration, duration and energy above 2 kHz. A
compact, short, bright impulse is routed to the snap pattern rather than also
counting as a clap. Tests cover three sample rates, onset phase, arbitrary block
boundaries, separate enable switches and mixed-gesture cooldown. Microphones,
hands and rooms vary; sharp claps, taps and clicks can still resemble snaps.
Sensitivity changes the detection threshold, not a trained classification model.
Use the action-free test panel before enabling either action.

This is a **percussive-sound heuristic**, not proof of human hand claps. Desk
impacts, tapping, recorded claps and some music can be confused with a clap.
Calibration helps with microphone gain and the room but cannot prove rejection
of every negative sound. The deterministic suite uses synthetic PCM, not a
validated real-world accuracy corpus. No measured false-positive or missed-clap
rate is claimed. Laptop/headset microphones, typing, speech, desk taps, music,
device removal and OS sleep still require real hardware acceptance checks.

## Implementation and verification

- `src/lib/speech/clap/`: pure DSP, pattern, calibration, capture, foreground
  ownership, target registry, validated preferences, client state and SQLite.
- `src/app/components/clap-listener-provider.tsx`: single action dispatcher.
- `src/app/components/settings-clap-controls.tsx`: shared settings/test UI.
- `src/app/api/speech/clap-controls/route.ts`: authenticated durable preferences.
- `tests/clap-controls-core.test.mjs`, `clap-to-talk-ui.test.mjs`,
  `clap-profile-ui.test.mjs` and `clap-action-routes.test.mjs`: PCM, persistence,
  actual browser worklet, target selection, cleanup, account/confirmation gates.
- `tests/snap-controls-core.test.mjs`: snap signatures, mixed-gesture arbitration,
  separate persistence and exact Spotify-track dispatch. The Profile browser
  suite also verifies both switches, one shared capture and independent prompts.
- Desktop's browser integration fixture checks native page removal/restoration
  during voice and denies commands from an external page/notification surface.

The subscription voice startup check now requires a capability in ChatMock's
health response, including the Runtime V2 manifest. Legacy processes with only
`/health` no longer count as ready for a client expecting voice endpoints.

Validation performed for the snap extension:

- 80 focused dashboard Node tests, including DSP, persistence, action routes,
  speech integration, subscription transport and serial test-lane registration.
- Eight browser tests for clap/snap/profile controls and provider settings. These
  use the real worklet and synthetic microphone PCM; voice service responses
  are controlled test fixtures. They do not claim live provider availability.
- Targeted ESLint, the full desktop-dashboard TypeScript configuration and the
  production dashboard build passed.
- The packaged standalone worklet matched the generated public asset by SHA-256
  and passed the snap Profile browser test when served locally.
- Combined clap/snap Profile controls were inspected in light and mobile layouts.

Earlier clap/voice validation also passed nine desktop tests (including actual
Electron native-page removal/restoration and rejection of legacy voice-service
readiness), fourteen Python tests for subscription voice and its readiness
marker, and desktop compilation. Those unchanged native/backend paths were not
rerun for the snap extension. The earlier Profile controls were inspected in
light/dark/mobile layouts and the voice overlay after its entrance transition.

After updating, restart the desktop shell to load its native overlay command
and updated service readiness manifest. Physical clap/snap accuracy, live provider
audio and hardware interruption checks remain manual acceptance work.

## Upstream

Reference: [TzurSoffer/clapDetection](https://github.com/TzurSoffer/clapDetection),
master revision `4464865ba69dbe96462ccc678fb3c75b5515f647`, MIT, copyright 2023
Tzur Soffer. `src/lib/speech/clap/upstream/` contains the exact detector source
and LICENSE.txt for inspection. Only the algorithm is adapted; PyAudio,
NumPy/SciPy runtime, recording buffers, distributions and demos are not imported.
Breadboard's changes replace integer thresholds and batch filter resets with
streaming Float32 DSP, add transient discriminators, explicitly define the
single active gesture/cooldown policy, and remove recording/network/logging.
