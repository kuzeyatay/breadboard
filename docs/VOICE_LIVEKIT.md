# LiveKit voice turn handling

Profile → Voice assistant now has a **Default voice model** for the AI that
generates spoken answers. It is a per-turn override across the standalone voice
view and voice attached to terminal, garden, PDF and side chats. It leaves the
typed-chat model and all speech-provider options intact. Voice requests use low
reasoning effort to reduce time to the first answer; selecting “Use profile
default model” follows the profile default rather than a chat-specific pick.

**Start voice on startup** defaults to on, including for existing accounts.
The persistent voice host prepares the selected service and loads the selected
installed local synthesis and transcription models, refreshing while Breadboard
is open. Missing models remain explicit downloads in Voice settings. This
preparation never opens the microphone; the existing “Always on voice assistant”
switch controls wake-word listening separately. Disabling startup preparation
also disables speculative subscription connections.

Dictation acquires the microphone before waiting on local service preparation;
partial transcription checks every second, with at most one in flight. Local
and subscription conversations use acoustic turn detection while LiveKit
initializes, preserving words captured before native detection becomes ready.
Audio requests share a brief settings cache that is invalidated across windows
when Voice settings are saved. Local status no longer waits on an unrelated
subscription service. First-time downloads, microphone permission prompts and
provider network latency can still delay usable results.

Breadboard uses LiveKit Agents 1.9.1 and its bundled local Silero inference model
to detect speech throughout a voice conversation. It runs inside the existing
Node dashboard service. No LiveKit Cloud account, room server, or new provider
key is required. This is a LiveKit turn-detection integration; audio playback
and transcription continue through Breadboard's selected provider adapters.

All four providers remain available: Local/Voicebox (including built-in and
cloned voices), ChatGPT subscription, OpenAI web, and ElevenLabs. Their saved
voice, model, language, pronunciation and other settings are unchanged. Model
responses, tools, clarifications, permissions, transcript widgets, wake words,
notifications and detached chat windows retain their existing paths.

The echo-cancelled microphone continuously supplies 16 kHz PCM to authenticated
`/api/speech/livekit` sessions in bounded, sequential batches. Confirmed speech
after 224 ms cancels current narration and pending audio, preserves microphone
pre-roll, and stops the originating chat run. It never cancels a run waiting on
a clarification answer. The composer waits for an interrupted run to stop
before submitting the next spoken turn. Pausing supplies silence to the
detector and discards microphone pre-roll. Closing releases both resources.

The detector ends speech after 650 ms of silence. This is acoustic endpointing,
not semantic prediction of whether a sentence is finished. A maximum recording
duration still bounds long utterances. If speech resumes during transcription,
the incomplete request is discarded and the clips are combined before sending
the turn to the chat. Voice recognition and model latency remain dependent on
the selected provider. Local file-based transcription is
still file-based; ChatGPT retains its isolated streaming transcription channel.

Desktop speech requests bypass Chromium's six-connection HTTP/1 pool through
an authenticated, same-origin Electron transport. This prevents long-lived
app streams from queuing dictation, synthesis and detector frames. It preserves
streamed audio, request cancellation, JSON, PCM and multipart uploads. Short
stalls may buffer up to three seconds of detector audio, drained sequentially
in the existing bounded wire batches. Longer stalls still close the detector.
File transcription times out after 25 seconds and returns to listening so a
failed recording cannot leave the UI stuck on “Catching that.” Speech also
cancels a pending greeting while native detection is still starting. Greeting
preparation and playback have separate deadlines, so audio arriving near the
preparation deadline is not immediately cut off.

Completed answer sentences are narrated during generation, with cancellation
preventing queued or late audio from playing after an interruption. ElevenLabs
conversation playback requests its streaming MP3 endpoint and uses MediaSource
when supported. Other audio formats retain blob decoding and one-passage
prefetch; downloads retain complete-file synthesis. Streaming respects the
selected ElevenLabs model, voice and pronunciation substitutions.

The LiveKit packages are server-only. Voice loads the SDK's audio modules
directly: its umbrella entry point also imports a different Sharp/libvips
version, which fails on Windows when Next has already loaded its image DLL.
The narrow loader also avoids Turbopack's external package aliases resolving
back into the checkout. Its SDK module paths are checked against the installed
version by the native tests and artifact verifier.

Next standalone tracing includes the installed production dependency closure,
including nested versions, both CJS and ESM files, and native platform bindings.
Build-only TypeScript peers are omitted; compiler workers retain their separate
reviewed staging. Package patterns exclude nested `node_modules`, whose runtime
packages are included individually, so unused nested build dependencies cannot
leak into the voice route. Including only the native
packages left the desktop build missing server SDK and JOSE files even though
source-tree tests passed. The desktop build now verifies imports and real
native inference from its output before marking it complete. That check rejects
resolution outside the artifact, so checkout dependencies cannot hide missing
packaged files. Sessions are owner-scoped, limited to two per account
and sixteen per process, and expire after twenty seconds without input. Audio
sequence validation prevents replay or reordered batches. No microphone audio
is persisted by the detector. If native inference is unavailable, voice shows a
message and retains the previous manual-interruption controls and provider.

Validation:

```sh
node --experimental-strip-types --test tests/livekit-voice.test.mjs tests/livekit-voice-ui.test.mjs tests/voice-conversation.test.mjs tests/voice-playback.test.mjs tests/cloud-speech.test.mjs
```

Run the command in `dashboard`. Native tests exercise real LiveKit inference,
session ownership, sequence validation and noise rejection. Browser tests use
controlled microphone/provider fixtures to exercise speech interruptions,
greeting interruptions, stale playback cancellation and microphone cleanup.
The startup/model checks are in `voice-startup.test.mjs`,
`voice-startup-ui.test.mjs` and `voice-question-ui.test.mjs`. They exercise saved
model selection, migration and account scoping, startup without a microphone,
dictation while preparation is deliberately held pending, and model forwarding.
The interruption browser test also delays native detection and verifies capture
continues, old words survive the handoff, and late initialization is cleaned up
after closing.

For native speech detection with a non-private 16 kHz mono PCM16 WAV, run
`node scripts/test-livekit-voice-audio.mjs path/to/speech.wav`. For the opt-in
ChatGPT subscription acceptance test, set `BREADBOARD_VOICE_TEST_PRELOAD=1` and
run `node scripts/test-subscription-voice-live.mjs`. It uses the selected account
and generated audio, without opening a physical microphone or using an API key.

Check an existing desktop artifact with
`node ../desktop/scripts/verify-livekit-runtime.mjs .next-desktop/standalone`
from `dashboard`. Dependency closure and isolation regressions are covered by
`node --test tests/livekit-packaging.test.mjs`. The build runs the artifact check
automatically after staging runtime dependencies.

Regression checks for startup failures and stalled voice requests:

```sh
node --test tests/livekit-voice.test.mjs tests/livekit-packaging.test.mjs tests/livekit-client.test.mjs tests/voice-narration-ui.test.mjs tests/speech-integration.test.mjs
```

Run from `dashboard`. The native test loads Next's Sharp first to reproduce
the Windows DLL conflict. From `desktop`, `npm run test:build` followed by
`node --test dist-tests/tests/voice-transport.test.js dist-tests/tests/app-assets.test.js`
checks real Electron with all six normal connections held open.

Measured on this Windows machine on 2026-10-07:

| Check | Result |
| --- | --- |
| Browser dictation, simulated mic/provider, preparation held pending | Recording in 13.5 ms; first partial in 997 ms |
| Browser playback cancellation after simulated LiveKit speech-start | 0.2–0.3 ms |
| Real native LiveKit, Windows-generated spoken fixture | Speech start detected after 271 ms; end after 726 ms |
| Real ChatGPT subscription, background preparation | 5.35 s cold; warm conversation and reader handoff under 1 ms |
| Real ChatGPT subscription, consecutive readings | First audio in 1.03 s and 1.17 s; supplied words preserved |
| Real ChatGPT subscription, generated audio transcription | Exact fixture transcription; live finalization in 51 ms |
| Running desktop voice API, generated speech after packaging repair | Native setup 850 ms cold, 7 ms warm; HTTP audio-frame p95 9 ms |
| Running desktop voice API, generated speech after packaging repair | Speech start after 271 ms; end after 726 ms; 7.49 s of audio processed in 734 ms |
| Running desktop voice window, silent test microphone | Listening in 544 ms; native detector HTTP 200; no error message |
| Electron speech transport with six occupied HTTP connections | Voice response in 45 ms; JSON, PCM, multipart, streaming and cancellation passed |
| Narrow audio loader inside the running dashboard with its image library already loaded | Native inference processed 1,024 samples successfully |

These are individual acceptance measurements, not latency guarantees. Model
answer generation, real-room echo and subjective conversational quality still
need a listening test with the user's microphone and chosen answering model.

The full desktop conversation test on 2026-10-07 exposed the Windows DLL
conflict and an OpenAI web greeting taking 24.8 seconds, reaching the previous
combined preparation/playback deadline. The source fixes, TypeScript check,
browser recovery tests and native inference checks pass. The final rebuild
and complete spoken question → model answer → playback test are deferred at
the user's request to keep an active Learn job running. The fast startup
measurement above checks microphone readiness, not completion of a greeting
or an answer. OpenAI web synthesis latency remains provider-dependent.
