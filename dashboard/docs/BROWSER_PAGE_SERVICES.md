# Browser notifications and page translation

Restart the Breadboard desktop app after building these changes so its browser
preload and main process are updated.

## Website notifications

Pages can request permission with the web `Notification` API. Breadboard asks
whether to allow, block, or defer the request, and remembers the choice for that
exact origin in the browser profile. HTTPS pages and loopback development pages
can request permission.

Allowed page notifications use Breadboard's existing notification overlay. Each
card identifies its source origin. Opening a card focuses its source tab and
delivers the page's click callback; dismissal delivers its close callback.
Notifications with the same origin and tag replace the earlier card. Visible
cards are bounded to five per origin and fifty overall.

Open **Browser settings → Website notifications** to pause all website
notifications or change a site's choice to Allow, Block, or Ask again. Pausing
keeps the saved site choices and also pauses permission requests. Changes apply
to open pages immediately.

The integrated path covers main-document `new Notification(...)` calls while a
tab is open. Service-worker notifications are not routed through this overlay,
and this change does not add a background Web Push service. Notification images,
action buttons, vibration, and sounds are not rendered. This is not a claim of
full Firefox notification compatibility.

## Translate the current page

Use the language icon beside the browser address, or **Translate** in the browser
menu. Choose the remembered target language or another of the 135 language
options. Source languages are detected by the configured AI provider. Translation
requires that provider to be connected; language quality depends on the provider.
The menu discloses that page text is sent to it.

Translation changes text in the existing document. It retains the URL, DOM
elements, links, images, event handlers, and form values. It also handles text in
HTTP(S) frames, open shadow roots, newly inserted content, and human-facing
attributes such as alternative text and placeholders. Longer translated text
can naturally wrap differently within the original layout.

**Original** restores translated text while preserving subsequent site edits.
Navigating to a new document resets translation. Failures appear beside the
translation control with Retry; the existing top progress bar reflects work.

Code, editable fields, passwords, `translate="no"` content, and closed shadow
roots are excluded. Text drawn into images, canvas, video, or PDF viewers is not
translated. Individual text nodes over 12,000 characters are skipped, and a
translation session stops after 500,000 source characters. A request carries
only bounded page text and nearby textual context, with no agent tools or chat
history. Page content is treated as untrusted input.

## Verification

- 36 targeted dashboard tests passed for translation, browser wiring, and
  notification behavior.
- 14 targeted desktop tests passed, including a real sandboxed Chromium fixture
  covering permissions, callbacks, settings, translation, cross-origin frames,
  shadow roots, dynamic edits, restoration, failures, and cancellation.
- Desktop source and test TypeScript checks, a focused dashboard TypeScript
  check, and ESLint on the new dashboard components and translation endpoint
  passed. A full dashboard TypeScript check exceeded the default 4 GB heap.
- A live request through the configured AI provider translated a Spanish
  sentence into English successfully. Language quality across all 135 options
  has not been independently evaluated.
- The Electron fixture writes a success receipt only after its assertions pass;
  its parent then terminates the isolated test application. Graceful native
  Chromium shutdown is outside that functional test and remains unverified.

The integration entry point is
`desktop/tests/browser-page-services-integration.test.ts`. Build the desktop
source and test output before running it. Set
`BREADBOARD_BROWSER_SERVICES_QA_DIR` to capture the actual rendered notification,
settings, translation toolbar, and translated fixture page.
