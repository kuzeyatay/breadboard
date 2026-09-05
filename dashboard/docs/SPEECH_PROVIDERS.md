# Speech providers

Settings → Voice offers Local and ChatGPT subscription (experimental). The choice is per user; local profiles and preferences survive switching. The old OpenAI Cloud selection migrates to ChatGPT subscription. API-key speech is disabled, including for stale clients. Previously stored encrypted keys are left untouched and are never read or used.

## Setup

1. Restart Breadboard after updating so ChatMock loads its new voice bridge.
2. Sign in to ChatGPT under Accounts.
3. Select ChatGPT subscription in Voice settings and preview a voice.

Requires a native Codex CLI supporting experimental realtime V3; tested with 0.153.4. The bridge finds the native CLI on PATH or the installed Windows Codex app. An administrator can set BREADBOARD_CODEX_BINARY to an explicit executable. The ChatGPT account comes from Breadboard/ChatMock's existing account selection, not from that executable's global sign-in.

This does not call the billed OpenAI Audio API, and never uses OPENAI_API_KEY or CODEX_API_KEY. It uses ChatGPT OAuth via Codex app-server with WebRTC V3. Subscription access and upstream limits still apply; no exact daily allowance is promised. This experimental native voice surface may change independently of Breadboard.

## UX and limits

Voice mode holds one connection across listening and speaking. Microphone input is sent live, and read-aloud plays from the remote audio track as it arrives. Transcripts go to Breadboard's normal selected-model chat; the voice service must not answer questions or execute tools itself. Composer dictation also streams microphone input directly and shows partial transcripts. Response actions, previews and Clicky read-aloud stream playback. Clicky's existing recording input remains a recorded-file path.

There is no new 90-second recording cap or 4,000-character total reading cap. Long readings are divided at sentence/word boundaries into transport-sized pieces. Uploaded recordings use browser media decoding and run in real time, not batch STT. Existing general file-upload/media-worker limits and browser codec support still apply. Downloads need the complete captured audio before encoding.

Stopping or closing voice stops audio and the owned connection. Authentication, owner scoping, bounded event buffers, request deadlines and abandoned-session cleanup remain enabled; these are not user speech-length limits. Speech interruptions mute playback immediately. The selected chat model's generation time is unchanged.

## Architecture and privacy

The authenticated dashboard forwards only status, create, event-read, speak and close operations to the loopback ChatMock bridge, authenticated with a private random secret in CODEX_HOME/breadboard-voice.secret. The browser receives SDP and transcript events, never account tokens. Browser origins cannot call the bridge directly.

ChatMock starts an isolated native app-server with an ephemeral thread, temporary CODEX_HOME, read-only sandbox, no approvals and client-managed handoffs. It provides existing ChatGPT OAuth tokens in memory; it does not copy the user's Codex configuration, plugins or tools. API-key variables are blank. Audio travels directly between the browser and OpenAI. Idle abandoned sessions expire; active sessions have no artificial three-minute cutoff.

## Verification

- node --test tests/cloud-speech.test.mjs tests/cloud-speech-ui.test.mjs
- ../chatmock/.venv/Scripts/python.exe -m unittest discover -s ../chatmock/tests -p test_subscription_voice.py
- Opt-in live test: node scripts/test-subscription-voice-live.mjs

The live test sends only a generated fixture phrase, not the microphone. It verifies actual audible samples, transcribes the generated audio, then tests synthetic live microphone input and a spoken reply over one connection. It uses subscription authentication with API-key variables blank.

Official integration reference: [Codex app-server](https://learn.chatgpt.com/docs/app-server). Realtime V3 details are verified against the installed generated experimental schema and local Codex source, not a stable public Audio API contract.
