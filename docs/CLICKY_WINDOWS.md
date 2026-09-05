# Clicky on Windows

Clicky runs as a floating, always-on-top companion inside Breadboard on Windows.
Launch it from the Clicky navbar button, Intelligence settings, or by typing
`launch Clicky` in a chat. No separate installation or Xcode build is required.

Type a question or click **Speak**, then **Stop & send**. While the companion is
open, **Ctrl + Alt + Space** also starts and stops recording. Recording stops
automatically after one minute. **Cancel** stops microphone capture, pending
requests, and playback. Closing the window releases its shortcut and microphone.

**Include screen snapshots** sends a fresh snapshot of up to four connected
displays with each question, using Breadboard's configured model connection.
Nothing is captured merely by opening Clicky. Turn it off for text-only questions.
Clicky can point at a location on a captured display; it does not click or type.
Screen images remain in memory and are not retained in the conversation history.

Speech uses Breadboard's existing local Voicebox service and the voice selected in
Intelligence → Settings → Speech. Enable and configure speech there, and allow
desktop microphone access in Windows Settings. Text questions work without
speech enabled. The first spoken request may prepare the local speech model.

The native macOS app remains the Swift app in `clicky/`; Breadboard still discovers
and launches its app bundle or opens its Xcode project when it has not been built.

## Development

Run `npm --prefix desktop run build` and restart the desktop shell after changes
to the main process or preload. The Windows UI is served by the dashboard at
`/clicky`; the authenticated `/api/clicky/chat` route uses the existing model gateway.
The desktop build copies the pointer asset automatically, and compiled main and
preload files ship with the existing desktop package.

The companion has a dedicated sandboxed preload. Capture and pointing IPC accept
only its main frame at the exact companion URL. Pointing is restricted to current
captured display IDs and coordinates between 0 and 1000; pointer windows do not
take focus or intercept mouse input.
