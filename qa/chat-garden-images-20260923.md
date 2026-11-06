# Garden images in chat

The broken spherical-element image is a real 510 × 444 PNG. All 14 image
references in the saved coordinate-systems lesson exist. In EM 1 chat 892,
three mounted Markdown images requested `/electromagnetism-1/assets/...`
from the dashboard origin, which had no handler for these Garden asset URLs.
The same URLs returned PNG bytes from the live Quartz service.

Added a dashboard GET/HEAD route for `/<garden>/assets/<image path>`. It reads
canonical images, including nested source-visuals crops, after checking Garden
read access. It does not depend on a publication build or a desktop service
port. Non-image files, missing/empty images, hidden paths, traversal, and
junctions escaping the authorized Garden remain unavailable. Responses retain
MIME types, private revalidation, and a restrictive policy for SVG documents.

Validation: 14 focused tests pass across the image route, Markdown rendering,
and figure retrieval. Focused ESLint and diff whitespace checks pass.

Live display: updated only the three mounted image elements in chat 892 to
the verified live Quartz image URLs. Chromium decoded all three successfully:
870 × 368, 1244 × 991, and 510 × 444. Visually checked
`qa/chat-garden-images-20260923.png`. No stored conversations or Markdown were
changed, and no running work or service was restarted.

Activation is pending: `node desktop/scripts/build-dashboard.mjs` was denied
by the existing Windows commit-memory guard (16,135 MB free; 11,321 MB reserve
plus an 11,264 MB build estimate required). The mounted-image repair lasts
for those DOM elements; it is not the durable route fix. A successful build
and dashboard restart are required for subsequent reloads and other chats.
