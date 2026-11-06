# Long EC 2 answer rendering — 15 October 2026

## Cause

The affected conversation was “IC amplifiers from slide 5 onward” (`chat=1020`).
Its mounted answer contained 56,071 descendants across 816 top-level blocks and
was about 41,187 CSS pixels tall. Message virtualization could not reduce the
work inside that one answer. Most of its equation DOM was far outside the viewport.

## Change

`chat-markdown-containment.ts` measures the natural heights of long replies'
paragraphs, headings and display equations before enabling `content-visibility:
auto` with those exact intrinsic block sizes. All content stays in the DOM.
Images, lists and disclosures retain their existing layout behavior. Width and
font changes refresh measurements, and edits/unmounting release the observers
and restore styles. `ChatMarkdown` owns this lifecycle in an effect.

## Verification

- Browser regression: offscreen style work fell from 1,485 ms to 276 ms (81%)
  across 24 repeated color invalidations while scrolling a long KaTeX reply.
  This is a controlled rendering test, not an end-to-end chat latency claim.
- Natural reply height, full-answer selection, browser text lookup, explicit
  navigation, disclosures, narrow-width wrapping and cleanup passed.
- Actual React component tests cover StrictMode, edits and replacement by a
  short reply. Existing disclosure tests and the virtualized scrolling browser
  regression passed.
- Scoped TypeScript checking, ESLint and whitespace checks passed.

## Running app

The same helper was bundled and applied to the open affected chat via its local
debugging connection, with a temporary observer for message replacement. It
enabled containment on 809 blocks. Before/after scrollTop stayed 43,498,
scrollHeight stayed 47,839, and answer height stayed 41,187. No messages or drafts
were changed.

This live patch lasts for that loaded page; it is not an installed build.
The permanent source fix needs the normal dashboard rebuild. The attempted
build was refused by the Windows memory guard: 14,049 MB free commit versus an
11,321 MB reserve plus an 11,264 MB build estimate. The guard was not overridden
and no unrelated processes were stopped. Once enough memory is free, the normal
repository command is `npm run desktop:dev:lean:rebuild`.
