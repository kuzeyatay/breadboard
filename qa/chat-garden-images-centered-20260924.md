# Restored and centered chat images

The restarted standalone app includes the Garden image route added yesterday.
Authenticated requests return the correct PNGs from the dashboard origin. The
three image elements initially had zero natural dimensions and approximately
1.6 px boxes; they were still configured for native lazy loading. They subsequently
decoded without rewriting their source URLs.

Chat Markdown now requests mounted images eagerly with asynchronous decoding.
The transcript already virtualizes messages, so images in unmounted messages
are not requested. The shared image style uses block layout, automatic horizontal
margins, a maximum width of 100%, and automatic height to center images while
preserving their proportions.

Verification:

- 14 focused route, Markdown, and source-figure tests pass.
- The additional Chromium test verifies images load in a hidden restored chat,
  remain centered at 1280 px and 390 px viewport widths, keep their aspect ratio,
  and load again after a full page reload.
- Focused component ESLint and diff whitespace checks pass.
- A separate authenticated browser loaded the actual EM 1 chat and reloaded it.
  All three images decoded in both cases, used `loading=eager`, and were centered
  to within one CSS pixel. Their natural sizes are 870 × 368, 1244 × 991, and
  510 × 444. Screenshot: `qa/chat-garden-images-centered-20260924.png`.

Activation:

The full build preflight still lacked Windows commit headroom (18,055 MB free
versus an 11,321 MB reserve plus an 11,264 MB estimate). Instead, the exact tested
component-property and stylesheet changes were applied to the existing build's
client and SSR bundles and standalone copies. Every JavaScript replacement was
unique and syntax-checked; CSS was parsed before writing. Backups and SHA-256
receipts are in `.tmp-chat-images-20260924/backup` and `activation.json`.

The live server was checked to serve those updated files. Its browser resource
cache was cleared without removing cookies, local storage, or drafts. The mounted
images also received the updated presentation without reloading the active chat.
The source changes remain in place for subsequent builds; the installed bundle
changes survive app reopening. No conversations, Markdown, or image bytes changed.
The desktop and its active assistant run were not restarted for verification.

## Follow-up: previously mounted EC 2 chat

The first live activation only migrated the image elements in EM 1. EC 2 still
used the already-loaded component bundle, without `chat-markdown-image`, so its
images stayed left-aligned. The stylesheet now also selects `.chat-markdown img`.
It therefore covers existing elements and future messages without requiring a
component migration or reload.

The updated CSS was installed in both built stylesheet copies, with another
backup in `.tmp-chat-images-20260924/alignment-v2/backup`. Applied that rule to all
27 open dashboard pages and cleared the browser resource cache. Live measurements
verified all 20 mounted chat images are centered, including all 16 EC 2 image
elements, to within one CSS pixel. The verification receipt is
`.tmp-chat-images-20260924/alignment-v2/verification.json`.

The browser regression now removes the new class from existing images and adds
another image using the old markup. Both cases pass at desktop/mobile widths
and across reloads. Live EC 2 screenshot capture timed out; the live alignment
checks use actual DOM bounds. No active pages or runs were restarted.
