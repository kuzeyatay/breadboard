# Profile voice assistant

Profile has two independent, account-scoped switches. Both default off and are stored in SQLite, so they survive a desktop restart or a change of dashboard port.

- **Read aloud notifications** queues new chat, Learn, app, and website notifications using the currently selected Voicebox or OpenAI provider. Existing inbox items are not replayed when the switch is enabled. Playback waits for foreground audio and voice conversations; switching it off cancels playback and clears the queue.
- **Always on voice assistant** listens for the whole phrase **Hey Bread** while Breadboard is running, including when it is in the background or an external browser tab is selected. Voicebox transcribes short speech segments locally. OpenAI uses the existing subscription transcription connection. Foreground microphone features and audio playback suspend wake capture; closing voice resumes it. Profile reports microphone and provider failures.

The clap or snap **Open voice conversation** action and Hey Bread open the same voice companion. It is a 400 × 240 floating widget with rounded corners, a draggable header, and no native title bar. It stays above other windows and keeps its fixed rectangular proportions. Repeated activation focuses the current window. Close or Escape ends microphone capture for that conversation and hides the window; the background listener remains available if enabled. Quitting Breadboard stops it.

**Voice** is available in the new-tab screen’s Places list. Profile → Navbar also has **Show Voice in the navbar**, off by default and saved independently for each account. Both shortcuts open the same widget.

The compact view reuses the existing terracotta voice ring, without a chat composer, transcript toggle, or response captions. Conversations use the normal assistant runtime, selected chat model, and permissions. They are durable terminal-history entries with the independent **Voice** origin label, displayed as **Voice: chat name**. Renaming the chat preserves its origin.

In a browser, one page owns the listener through Web Locks. Voice opens in a 400 × 240 popup; if the browser blocks it, it opens on the current page.

Verification: `voice-assistant.test.mjs`, `voice-assistant-ui.test.mjs`, `gesture-action-launch-ui.test.mjs`, and the desktop `voice-companion.test.ts`. Microphone/provider UI tests use controlled audio and provider responses; the desktop test exercises the real sandboxed preload and native window lifecycle.
