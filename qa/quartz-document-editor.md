# Quartz document editing — implementation and verification

Implemented Read/Edit controls for owned notes in both individual-garden and library readers. The editor is loaded on demand and stays mounted in Read mode during the same visit. Markdown remains the saved format; existing notes require no migration.

## Implementation

- The editor uses the installed Tiptap ProseMirror packages. It supports continuous selection, formatting, lists, checklists, tables, editable title/tags, keyboard shortcuts, formatted paste, IME input, and undoable advanced source editing.
- The remark codec retains untouched source fragments, references, comments and unknown syntax. Metadata updates target individual YAML values, preserving unrelated fields and line endings.
- An object registry and scoped widget lifecycle integrate images, media, source figures, visualization/artifact previews, equations, Mermaid, transclusions and PenEcho. Upload placeholders follow edits; cancelled insertions stay removed, and redo can restore a completed upload. Removing a reference never deletes its underlying file or board.
- Saves use opaque content revisions checked under the existing mutation lease. Autosave waits 750 ms after typing, with a five-second maximum interval. Requests are serialized; conflict comparison and account/document-scoped IndexedDB recovery preserve displaced drafts. Existing publication runs separately after saving.
- Both readers share an origin/source/session/request-validated dashboard bridge. Canonical refreshes cannot replace an active editor. In-page navigation and mode changes flush pending work.
- Personal annotations use editor decorations and retain their IDs, notes and answers. Detached annotations remain accessible through Annotations. Assistant selection requests include the draft's current text and context.
- PenEcho acknowledges persistence before a board is moved, removed, reconfigured, replaced by source editing, or left through editor navigation. Its drawing history stays separate from document history.

## Verification

The focused suite passes **59 tests**, covering the codec, actual document API/mutation lease, editor browser interactions, both garden hosts, artifact workflows and the real PenEcho persistence handshake code. The broader regression run passed **98 of 99 tests**. Its one failure is outside these changes: `quartz-reader-index.test.mjs` expects metadata without the existing `wordCount` and `readingTimeMs` fields. That test and emitter were left unchanged.

Quartz TypeScript and a strict, unused-local-checked typecheck of the editor/metadata code pass. Editor assets, the canonical renderer and the PenEcho client bundle were rebuilt. Browser verification used headless Microsoft Edge. The IME check uses Chromium's composition protocol; this is not a physical-device or Safari test.

Run the focused suite from `dashboard`:

```powershell
node --test tests/quartz-document-codec.test.mjs tests/quartz-document-editor-browser.test.mjs tests/quartz-document-api.test.mjs tests/quartz-whiteboard-flush.test.mjs tests/garden-markdown-refresh.test.mjs tests/garden-markdown-artifacts.test.mjs
```

## Large documents

The optional benchmark uses the existing Maxwell full-website import and the 1.45 MB engineering electromagnetics body. Raw results are in `quartz-document-editor-benchmark.json`. One local run measured editor activation at about **0.75 s / 4.34 s**, respectively. Ten-character typing sequences took **0.55 s / 2.49 s**, including browser automation and initial widget work. Individual key events in that run ranged from about **3–120 ms / 20–221 ms**. These are measurements, not guaranteed latency targets; the textbook still has noticeable initial work.

Offscreen blocks use browser deferred layout, widget rendering is intersection-triggered, and object toolbars are created only when selected. The textbook editor had about 32,000 DOM elements, down from 80,000 before lazy toolbars. Typing performed **zero full-article text walks**. Full parsing is limited to activation, source replacement and inserted snippets; serialization runs after inactivity or an explicit flush. Text remains in the document for selection and browser find.

```powershell
$env:QUARTZ_EDITOR_BENCHMARK='1'
node --test --test-name-pattern='benchmark' tests/quartz-document-editor-browser.test.mjs
```

## Activation and limits

The source and generated editor assets are updated. Existing published Quartz HTML gets the new Read/Edit controls when its Quartz assets/pages are rebuilt and published. This work did not restart the running application, replace a live publication, or migrate user notes. Unknown extensions use protected source controls when rich editing is unavailable. Simultaneous collaboration and pagination are outside this implementation.

## Startup regression fixed — 22 September 2026

The published page bundle exposed a gap in the original fixture tests: Quartz's server build uses esbuild `keepNames`, so serializing the editor installer with `Function.toString()` included references to a server-only `__name` helper. Every page aborted before the final navigation event, leaving the explorer empty and graphs uninitialized, including folder pages without editor controls.

`MarkdownActions` now uses a normal `.inline.ts` browser entry. Quartz bundles the installer and its complete closure before the server build receives it as script text. The regression test in `quartz/quartz/components/MarkdownActions.test.ts` exercises both compilation stages and executes the emitted script in a fresh browser-like context without server helpers. It passes alongside the two existing inline compiler tests; Quartz's full TypeScript check also passes.

A fresh CLI build produced the repaired `postscript.js`. The existing live bundle was backed up and replaced, and the corresponding three source files were synchronized into the runtime Quartz workspace. No note files were changed and Breadboard was not restarted. Only the three broken Quartz frames were refreshed. Real published EC 2, Telecom M2 v2, and EM Learning v1 pages render their folder navigation and graph again. Browser verification also followed a Telecom lesson link and opened search, with no page errors. Screenshot: `qa/quartz-startup-live-lesson.png`.

## Editor timeout and trash control fixed — 22 September 2026

The dashboard bridge spread API data after its correlation fields. The actual
document API returns a Markdown basename as `slug`, replacing the full Quartz
path expected by the editor. Valid reads and saves were therefore ignored until
they timed out. Response payloads now precede the authoritative type, document,
session and request fields. Browser fixtures return the real basename shape for
reads, saves and deletion, including nested notes with punctuation and spaces.

The Delete text button is now a red trash icon with an accessible **Delete page**
label, focus styling, a hover state, and the existing confirmation. The loader
upgrades already-published HTML as well as new pages. Reader refresh cleanup now
removes the old mode-switch and delete handlers, avoiding stale reply listeners.
Failed editor activation releases its transport, and an initial read timeout asks
the user to retry Edit instead of claiming there is already a retained draft.

Verification: four garden-host browser tests pass (including confirmed/cancelled
deletion after a canonical refresh), all 13 editor browser tests pass, all three
Quartz compiler/startup tests pass, and Quartz type-checks. Live Telecom testing
opened the editor with 39 editable paragraphs, a formatting toolbar and the red
icon, then returned to Read mode with no document writes or browser errors.

The running standalone dashboard's two copies of its bridge chunk received the
same small, syntax-checked correction with backup files. Editor assets and Quartz
assets were rebuilt and copied to their runtime locations with backups. Only idle
garden views were refreshed; neither Breadboard nor the dashboard server was
restarted. The source fix remains in the shared React bridge for subsequent builds.

## Garden connection recovery — 22 September 2026

The live Telecom reader's request history showed two `429` view-registration
responses before recovery. Full dashboard reloads did not run React's unmount
cleanup, leaving old registrations alive until their 70-second expiry and briefly
exhausting the eight-view limit. The client now releases its registration with a
keepalive request on `pagehide`, reacquires it after a back/forward-cache restore,
and retries failed registration with bounded backoff. Renewals do not overlap;
failed background renewals keep an already visible reader mounted.

All three garden reader components now show **Garden did not respond** with an
inline **Retry** button. The separate-window link and fullscreen failure overlay
are removed. Retry renews the registration and reloads the embedded garden.
Canonical document refresh waits for a ready connection and retransmits the same
idempotent update until the frame acknowledges it, avoiding a second saved-page
error when startup is delayed.

All 19 focused tests passed: eight garden browser tests, four library publication
checks, and seven service lease tests. Browser coverage includes manual recovery
in both garden views, automatic recovery after two refusals, a delayed reader
bridge, editing after recovery, actual page reloads with a server-observed release
request, and retaining the reader after a failed renewal. The release test uses a
real HTTP endpoint because browser keepalive requests outlive page interception.
The two changed hooks also pass a strict TypeScript check.
