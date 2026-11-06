# Click to enlarge chat images

The shared ChatMarkdown image renderer now opens a native modal image viewer.
The viewer fits the image to the viewport, offers a further 2× zoom with scrolling,
and closes using Escape, the close button, or the empty area around the image.
Images support Enter and Space. Focus returns to the selected image on dismissal.
The modal is portalled outside transformed/virtualized transcript rows, locks
background scrolling, and respects the desktop title bar. Linked Markdown images
open the viewer without navigating. Existing eager loading and centered layout
remain intact.

Verification:

- Four focused tests passed: new desktop/mobile interaction coverage, existing
  restored-image layout/reload coverage, and two Markdown rendering checks.
- Focused ESLint and diff whitespace checks passed.
- A separate authenticated Chromium session opened the actual EC 2 chat and
  verified enlargement, further zoom, focus restoration, and persistence after
  reload. All 16 mounted images have the viewer trigger.
- The example circuit grew from 561 px to 1,418 px wide, then 2,836 px on zoom.
- Visually inspected `qa/chat-image-viewer-20260925.png`.
- The app emits an existing React hydration error with both original and updated
  bundles; baseline was checked using the backed-up original assets. The isolated
  component browser tests have no page errors. Live app verification also observed
  unrelated generic fetch failures.

Activation:

The full build was denied by the existing Windows commit-memory guard: 13,123 MB
free versus an 11,321 MB reserve plus an 11,264 MB estimate. The tested image
component was instead compiled with esbuild and installed into the existing
client/SSR image renderer slots, reusing each bundle's existing React instances.
The viewer stylesheet was added to both installed stylesheet copies. All 14 files
were backed up, syntax/parse checked, and recorded with SHA-256 hashes under
`.tmp-chat-image-viewer-20260925/activation.json`.

The running EC 2 chat has an active assistant run. Its page was not reloaded.
Already-open chat images were upgraded with the same ImageViewer source in a
separate temporary React root, plus delegated image activation. This lasts until
page reload, when the installed bundle supplies the normal component. The browser
resource cache was cleared; conversations, drafts, and stored messages were not
modified. Live modal opening and closing were verified in EC 2. All 21 mounted
chat images across the open chats were upgraded. Activation scripts, backups,
and detailed verification receipts are in `.tmp-chat-image-viewer-20260925/`.
