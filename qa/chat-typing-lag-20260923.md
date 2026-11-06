# Chat typing lag — 23 September 2026

## Findings

The running Electron app uses a prebuilt standalone dashboard. In the large EM 1 conversation, the transcript has approximately 25,600 DOM elements.

Two independent invalidation paths ran for each character:

1. `useMetalBend(root)` uses the library's default `() => BEND` getter, a new function every render. The library includes that getter in its effect dependencies. Every input update removed and reinserted the body-level SVG displacement filter and reattached its listeners.
2. React updates a controlled textarea's `defaultValue`, changing its text node. Unbounded document-level `:has()` selectors combined with universal descendant subjects in the composer-header and Tailwind sidebar rules invalidated the full document. The textarea's autosizing read then synchronously paid for that style recalculation.

The source fix passes a stable getter to the effect, names the queue/sidebar subjects, and bounds the page-root selectors to the actual direct-child structure verified in the running dashboard, browser and notification pages. The visual effects are retained.

## Measurements

A separate headless Edge context loaded the same chat using the existing authenticated local dashboard. No message was submitted and no live chat draft was changed. The 39-character typing sequence used a deliberate 45 ms delay between characters (about 1.8 seconds total).

| Variant | Sequence wall time | CSS recalculation |
| --- | ---: | ---: |
| Original served build | 20.25 s | 12.82 s |
| Stable effect getter only | 11.06 s | 6.08 s |
| Stable getter and bounded CSS | 4.08 s | 0.39 s |

These are single diagnostic runs on a busy machine, not a statistical benchmark. Because a new standalone build was unavailable, the comparison used test-only request interception for an equivalent stable getter and CSSOM selector edits in the isolated browser. No served production bundle was modified. Separate browser tests bundle the actual changed source and compile the actual global stylesheet.

## Verification

- The new effect lifecycle test failed before the fix: the filter ID changed after typing. It passes afterward, including disabled/enabled transitions, reduced-motion changes, cleanup and remounting.
- The browser trace regression mounts a 20,000-element transcript with the complete compiled application stylesheet and asserts that typing never restyles that transcript.
- Browser checks preserve notification transparency/chrome hiding, dashboard scrollbar hiding, native browser transparency, attached-quote/queue margins and sidebar action space.
- Existing composer sizing test passed.
- Existing quote/queued steering browser test passed.
- All ten chat effects render tests passed.
- ESLint passed the send-button and queue components. The sidebar has an existing, unchanged `react-hooks/purity` error for its skeleton's `Math.random()` at line 903; this change only replaces one class in that file.

## Node processes

At the initial sample:

- PID 17904: Quartz garden publishing build, approximately 4.9 GB resident, with a 5,120 MB V8 heap limit. This job subsequently exited.
- PID 33000: Breadboard standalone dashboard server, approximately 1.2 GB, later approximately 1.5 GB.
- PID 53252: separate Graft repository indexing build, approximately 1.8 GB initially. This process subsequently exited.

A later scoped Quartz publishing job (PID 47536) was running at approximately 1.8 GB. None of these jobs was killed. The typing bottleneck is verified as renderer style work; GPU utilization was not directly measured.

## Applying the fix

The running app still serves its previous build. `node desktop/scripts/build-dashboard.mjs` refused before compilation with `BREADBOARD_RESOURCE_EXHAUSTED`: 18,819 MB free Windows commit versus the 11,321 MB reserve plus 11,264 MB build estimate. The guard was not overridden.

After enough memory is available, close Breadboard and run `npm run desktop:dev:lean:rebuild` from the repository to rebuild and relaunch with these changes.
