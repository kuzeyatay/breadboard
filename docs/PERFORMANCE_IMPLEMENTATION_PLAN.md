**Breadboard performance implementation checklist**

Prepared 2026-09-11 from the tab-navigation, PDF-loading, and Intelligence Settings discussions and a source inspection of the current workspace.

This is an implementation backlog. Checkboxes describe work still to do. The source findings below are verified implementation behaviors; their contribution to real user latency still needs measurement. Timing budgets are proposed acceptance targets, not existing measurements or promised results.

The intended experience: selecting a loaded tab responds immediately; reopening Settings restores populated controls; opening a PDF prioritizes the requested page; service checks and background processing finish without holding up the interface.

**1. Scope and existing behavior**

Build on the mechanisms already present:

- Desktop tabs already retain their renderers. Previously painted documents skip the renderer paint probe. Optimize their activation path rather than introducing a second keep-alive mechanism.
- Settings already has a five-minute renderer-local cache, request deduplication, hover preloading, and preloading one second after the composer mounts. Improve scope, refresh behavior, scheduling, and component lifetime.
- Settings preserves visited sections while its dialog remains mounted. Its parent Intelligence menu conditionally unmounts the entire subtree when closed.
- PDF.js already runs document processing in a worker and receives a URL for ordinary loads. The source-PDF endpoint does not implement partial reads; changing a viewer option alone cannot fix that.
- PDF.js library assets already have an immutable HTTP cache header. Their URLs need versioning before relying on that policy across upgrades.
- There is an existing memory governor and memory QA tooling. Extend those mechanisms instead of creating competing memory policies.
- Hot development retains a small compiler working set. Verify its effect in the actual launcher and installed Next.js version before changing it.

Preserve normal page controls and use the existing blue progress bar for navigation. Follow [dashboard/AGENTS.md](C:/Users/20252082/breadboard/dashboard/AGENTS.md). Preserve drafts, PDF annotations, pending saves, playback, and active jobs throughout these changes.

**Progress note (2026-09-11).** Checked boxes below are implemented and covered by tests;
everything unchecked is still to do. Measured wins so far: the dashboard's per-read
filesystem work fell from 729 ms to 1 ms (garden summary freshness window plus shared
note counts), and selecting a tab fell from 9 native bounds calls to 2 in a 7-tab window.
The source-PDF endpoint now streams and serves byte ranges instead of reading whole files
synchronously: a 36 MB textbook answers a viewer's page request with 64 KB in 0.12 s rather
than 37.9 MB in 2.43 s, and an unchanged reopen is a 304. A startup that restored seven PDF
tabs was fetching 54 MB before anything was readable. Landed so far: the interaction-tracing substrate
(`dashboard/src/lib/performance/`, read through `window.__breadboardPerformance`), tab and
PDF milestones wired at their real call sites, PDF readiness split so the outline and edit
history no longer gate the readable page, the Connections panel reading each service
independently and no longer synchronizing Google Calendar on every focus, and first-publication
recovery for a Garden whose pages were never published. PDF-05 (replacing the "Opening PDF"
cover with the shared progress bar) is deliberately **not** done: it is an interface change,
and the current instruction is to change no UI.

**2. P0 — Establish a measurable baseline**

Dependencies: none. Start here and run the same representative flows after each relevant change.

- [ ] **BASE-01 — Record runtime identity.** Include source revision, development/standalone/packaged mode, Electron and Next.js versions, display scale, machine memory, tab count, and active background workloads in each report. Do not mix development compilation time with production interaction latency.
- [x] **BASE-02 — Trace an interaction end to end.** Assign an interaction ID at input and record renderer event handling, IPC receipt, native view activation, response headers, response completion, module readiness, data readiness, and visible usable content. Use durations within each process or calibrated clock offsets when correlating Electron and renderer timestamps.
- [x] **BASE-03 — Add feature milestones.** Track `tab-input-to-visible`, `settings-input-to-controls`, `settings-input-to-data`, `pdf-input-to-first-page`, `pdf-input-to-requested-page`, and `route-input-to-usable`. Record background refresh separately from initial display.
- [x] **BASE-04 — Capture contention.** Record main-process event-loop delay, renderer long tasks, request counts and duplicate requests, transferred bytes, cache hit/miss/stale outcomes, renderer count, and process memory. Avoid recording document text, tokens, or private URLs in performance logs.
- [ ] **BASE-05 — Add a reproducible user-flow harness.** Cover 5, 15, and 30 tabs; Settings close/reopen; each Settings section; a cached and uncached PDF; revisiting a garden; and the same flows during a streaming assistant response or document job.
- [x] **BASE-06 — Keep cold and warm results separate.** Use at least 50 repeated warm interactions for percentile summaries and a separately reported cold-start sample. Include failures, cancellations, and timeouts rather than dropping them from latency results.
- [ ] **BASE-07 — Audit the hot path.** Use traces to identify expensive imports, synchronous I/O, repeated authentication/config reads, database scans, renderer work, and service startup. Attribute each subsequent optimization to one or more measured spans.

Proposed budgets for the designated production reference machine:

| Interaction | Initial target | Measurement boundary |
|---|---|---|
| Already loaded tab | p95 under 100 ms | Input to correct visible, interactive content |
| Cached Settings reopen | p95 under 100 ms | Input to populated previously selected section |
| Cold Settings shell | p95 under 200 ms | Input to usable section navigation; service status may arrive later |
| Prewarmed New Tab | p95 under 150 ms | Input to usable page and input focus |
| Representative local PDF, up to 10 MB | p95 under 1 second | Input to first useful requested page, in an already running app |
| Cached ordinary page revisit | p95 under 200 ms | Input to useful cached content |

- [ ] **BASE-08 — Ratify the PDF and memory budgets after baseline.** Report scanned, image-heavy, long, and larger PDFs separately. Set numeric limits for added cache memory, spare renderers, background CPU, and acceptable long-session drift before enabling new retention by default.

Primary targets: [tab manager](C:/Users/20252082/breadboard/desktop/src/main/tab-manager.ts), [Electron QA](C:/Users/20252082/breadboard/qa/electron/run-qa.mjs), [memory QA](C:/Users/20252082/breadboard/qa/memory/run-memory-qa.mjs), and [compiler benchmark](C:/Users/20252082/breadboard/qa/memory/run-dashboard-compiler-benchmark.mjs).

**3. P0 — Reveal PDFs as soon as they are useful**

Dependencies: baseline instrumentation. Can ship before shared caching or the tab-shell work.

- [x] **PDF-01 — Split readiness state.** Represent document opening, first/requested page readiness, outline loading, history loading, and tool readiness separately. A slow optional feature must not keep the entire viewer in a loading state.
- [x] **PDF-02 — Remove outline and history from the display dependency.** Start them independently after document initialization; give each cancellation and isolated error handling. Enable history-specific undo only when its state is known.
- [x] **PDF-03 — Reveal on the correct page-render milestone.** Release the loading cover when the current document's requested visible page has rendered. A document from a cancelled load or a late event from a replaced document must not dismiss the next document's progress.
- [ ] **PDF-04 — Restore reading position early.** Apply the saved page, zoom, and scroll position before scheduling unrelated pages. Opening at page 150 should prioritize page 150.
- [ ] **PDF-05 — Keep useful controls visible.** Replace the full-area "Opening PDF" cover with the existing progress treatment. Disable only controls that require unavailable document data; expose actual failures inline with retry.
- [ ] **PDF-06 — Preserve save precedence.** Keep the existing pending-bytes/save-queue path authoritative over server or HTTP cache data. Never load an older cached version over an unsaved local annotation or a failed save awaiting retry.

Acceptance: delayed or failed outline/history responses do not delay the readable page; rapid document changes cannot reveal the wrong document; annotations, undo, retry, and page restoration still work.

Primary targets: [PDF viewer](C:/Users/20252082/breadboard/dashboard/src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx), [save queue](C:/Users/20252082/breadboard/dashboard/src/lib/pdf-save-client.ts), and existing PDF save/interaction tests in [dashboard tests](C:/Users/20252082/breadboard/dashboard/tests).

**4. P0 — Make Intelligence Settings immediately reusable**

Dependencies: baseline instrumentation. Use the current cache initially; integrate the shared cache in section 5.

- [ ] **SET-01 — Fix the dialog lifetime.** Move Settings ownership outside the conditional Intelligence popover subtree, or lift its section state and data into a persistent owner. Closing Intelligence must preserve the selected section, scroll position, and unsaved form edits.
- [ ] **SET-02 — Preserve accessibility while hidden.** Closed panels must be absent from focus navigation and accessibility interaction. Keep Escape, outside-click behavior, focus return, and viewport positioning correct without unmounting useful state.
- [x] **SET-03 — Render each service independently.** Replace the Connections all-results dependency with separately published catalog, connected-app, and Spotify results. One slow or failed service must not hide successful sections.
- [x] **SET-04 — Remove calendar sync from the Settings read path.** Move it to the existing calendar synchronization lifecycle after authorization or to the explicit refresh action. Reading Connections must not trigger and await a calendar update each time the panel regains focus.
- [ ] **SET-05 — Separate configuration from live status.** Render stored account/provider configuration immediately. Refresh availability, model catalogs, runtime state, and login reconciliation independently. Distinguish last-known status from a newly verified status.
- [ ] **SET-06 — Initialize from snapshots.** Let components synchronously read already available cached state instead of starting empty and waiting for an effect plus JSON parsing. Retain the previous successful content while refreshing.
- [x] **SET-07 — Correct degraded endpoint semantics.** Do not cache an upstream failure represented as a successful empty account list. Distinguish an authenticated empty result from an unavailable service, and retain valid previous data for the latter.
- [ ] **SET-08 — Coordinate existing preloads.** Replace per-composer one-second preload bursts with one deduplicated, low-priority warmup per relevant account/session. Add keyboard-focus intent alongside pointer hover. Do not start every service or load every section on startup.
- [ ] **SET-09 — Pause hidden work.** Give visited Settings sections an explicit active/open signal. Stop optional polling while hidden; maintain necessary in-progress authorization or installation tracking through a shared owner.
- [ ] **SET-10 — Split read deadlines from action deadlines.** Bound background status reads and keep the interface usable when they time out. Do not shorten login, save, or installation actions merely to make read requests finish faster.

Acceptance: close and reopen the entire Intelligence menu and return to the same populated Settings section; expire cached status while one service is unavailable and confirm the panel stays usable; reconnect/sign out/update settings and verify immediate coherent updates.

Primary targets: [composer](C:/Users/20252082/breadboard/dashboard/src/app/components/assistant-composer.tsx), [Settings dialog](C:/Users/20252082/breadboard/dashboard/src/app/components/settings-dialog.tsx), [Connections](C:/Users/20252082/breadboard/dashboard/src/app/components/settings-connections.tsx), [Accounts](C:/Users/20252082/breadboard/dashboard/src/app/components/settings-accounts.tsx), [Providers](C:/Users/20252082/breadboard/dashboard/src/app/components/settings-providers.tsx), [proxy status](C:/Users/20252082/breadboard/dashboard/src/lib/cliproxy/management.ts), and [account endpoint](C:/Users/20252082/breadboard/dashboard/src/app/api/chatmock/accounts/route.ts).

**5. P1 — Introduce a shared cache with background refresh**

Dependencies: baseline. Integrate Settings first, then navigation data and document metadata.

- [ ] **CACHE-01 — Define one cache contract.** Entries need an account/resource key, data, resource revision, fetch timestamp, freshness deadline, stale-use deadline, in-flight request, error state, and size/eviction metadata. Expose synchronous reads, subscriptions, refresh, and invalidation.
- [ ] **CACHE-02 — Use background refresh after freshness expires.** Return the last successful usable result immediately and refresh once in the background. Enforce a separate maximum stale age per resource; show unavailable state when no acceptable result exists.
- [ ] **CACHE-03 — Choose the shared owner explicitly.** Use the authenticated local dashboard service for canonical Settings/navigation snapshots across Electron renderers, with renderer-local mirrors for immediate rendering. Keep the same data contract usable in ordinary browser mode. Adapt the owner only if baseline evidence favors an existing equivalent service.
- [ ] **CACHE-04 — Deduplicate across renderers.** Multiple tabs requesting the same resource should join one upstream read. Cancelling one subscriber must not cancel work still needed by another.
- [ ] **CACHE-05 — Make invalidation revision-aware.** Tag reads with a resource generation; discard results started before a later mutation or invalidation. Patch successful mutation results into local state immediately and announce affected resource revisions to other tabs.
- [ ] **CACHE-06 — Scope lifetime correctly.** Include user, workspace/garden, and resource identity as needed. Clear account-specific mirrors on logout or identity change; reauthorize service reads. Respect private browsing and avoid storing authentication secrets in the cache.
- [ ] **CACHE-07 — Preserve durable preferences separately.** Keep unsaved drafts and user choices in their existing durable/state stores. Evicting a response cache must never erase a draft or reset a preference.
- [ ] **CACHE-08 — Integrate existing caches.** Migrate Settings, assistant bootstrap/preferences, model health/catalog, navigation summaries, and document metadata incrementally. Retire superseded preload timers and duplicate request maps as each feature moves.
- [ ] **CACHE-09 — Put bounds on retention.** Cap entry count and bytes, use least-recently-used eviction for disposable entries, and react to the existing memory governor. A failed refresh must not extend a stale result indefinitely or overwrite it with a transient empty value.
- [ ] **CACHE-10 — Add diagnostics.** Expose cache hit rate, age, refresh latency, deduplicated request counts, evictions, and bytes through development diagnostics, without adding technical controls to normal product flows.

Initial policy matrix; validate durations with the observed mutation rate:

| Resource | Retention and refresh policy | Invalidate when |
|---|---|---|
| User preferences | Existing durable store plus immediate local mirror | Successful edit, logout, account change |
| Account/provider configuration | Shared in-memory snapshot; moderate freshness window | Sign-in/out, account switch, provider edit |
| Live runtime/connection status | Short freshness window; show last-known state during bounded refresh | Service event, auth event, explicit refresh |
| Garden lists and counts | Shared summary snapshot; refresh after relevant mutations | Import, create/delete, visibility/access change, publication completion |
| Document metadata and outline | Key by document revision; bounded retention | Save, restore, replacement, access change |
| PDF bytes | Authorized versioned HTTP cache and bounded optional local retention | Document revision or account/access change |
| PDF rendered pages | Small disposable memory cache by revision/page/scale | Edit, revision change, eviction, renderer teardown |
| Build assets | Immutable cache at versioned URLs | New build/version |

Acceptance: concurrent reads from several tabs produce one upstream request; expiry does not blank the interface; late stale responses cannot undo a mutation; account switching never reuses another account's snapshot; memory remains inside the ratified budget.

Primary targets: [Settings cache](C:/Users/20252082/breadboard/dashboard/src/lib/settings-client-cache.ts), [assistant bootstrap](C:/Users/20252082/breadboard/dashboard/src/lib/assistant-bootstrap-client.ts), [model catalog client](C:/Users/20252082/breadboard/dashboard/src/lib/assistant-model-catalog-client.ts), and [memory governor](C:/Users/20252082/breadboard/desktop/src/main/memory-governor.ts).

**6. P1 — Stream and cache PDF data correctly**

Dependencies: BASE; align document revisions with CACHE. Ship transport independently of any rendered-page cache.

- [ ] **IO-01 — Cover all PDF sources.** Apply equivalent behavior to garden source PDFs, chat attachments, and artifact previews. Reuse the existing streaming/range mechanisms where suitable, after checking whether their current MIME branches actually include PDFs.
- [x] **IO-02 — Add HTTP byte-range behavior.** Support valid single ranges, open-ended and suffix ranges, `206`, `Content-Range`, `Accept-Ranges`, and unsatisfiable `416` responses. Define standards-compatible handling for malformed or multiple ranges and test it.
- [x] **IO-03 — Avoid full-file reads before response headers.** Stream file-backed documents with cancellation and backpressure. For PDFs stored as SQLite blobs, choose and document bounded-range access or an atomically maintained versioned file representation; do not read the whole blob just to return a small slice.
- [x] **IO-04 — Add validators and conditional requests.** Derive a stable validator from an authoritative document revision or a precomputed content hash. Support conditional revalidation and range/version consistency, including `If-Range`; do not hash an entire large file on every read.
- [ ] **IO-05 — Separate mutable and immutable URLs.** Revalidate the current document URL; cache explicitly versioned document representations according to their access policy. Serve correct content lengths and validators for the bytes actually selected.
- [ ] **IO-06 — Version PDF.js assets.** Include the library/build version in module, viewer, worker, CSS, and image asset URLs before retaining their immutable cache policy across releases. Keep worker and main library versions compatible.
- [ ] **IO-07 — Prewarm runtime assets selectively.** Fetch likely PDF runtime assets on intent or idle with a bounded budget. Respect the viewer module's dependency on PDF.js initialization; preloading assets does not justify executing dependent modules in the wrong order.
- [ ] **IO-08 — Bound worker and rendered-page retention.** Retain a worker/document while its view or pending save needs it. Release workers, loading tasks, blob URLs, listeners, canvases, and page buffers after eviction. Start with PDF.js's existing visible-page rendering behavior before adding another page cache.
- [ ] **IO-09 — Prevent mixed document versions.** Pin range reads to one revision, invalidate affected rendered pages after edits, and preserve pending save bytes. Reopening a PDF must show the latest acknowledged version or the newer unsaved local version.

Acceptance: a large PDF can request partial data without a preceding complete-file read; an unchanged reopen uses validation/cache reuse; edits and restores select a new version; aborted opens release resources; all three PDF entry points retain their existing access checks.

Primary targets: [garden PDF endpoint](C:/Users/20252082/breadboard/dashboard/src/app/api/documents/[slug]/source-pdf/route.ts), [attachment endpoint](C:/Users/20252082/breadboard/dashboard/src/app/api/chat-attachments/documents/[blobId]/route.ts), [artifact preview](C:/Users/20252082/breadboard/dashboard/src/app/api/hermes/artifacts/[artifactId]/preview/route.ts), [PDF.js asset endpoint](C:/Users/20252082/breadboard/dashboard/src/app/api/pdfjs/[...path]/route.ts), and [viewer](C:/Users/20252082/breadboard/dashboard/src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx).

**7. P1 — Reduce JavaScript and service work needed to open a feature**

Dependencies: BASE. Coordinate with SET and PDF so splitting code does not recreate a loading gap.

- [ ] **LOAD-01 — Audit the production bundle graph.** Measure parse/evaluation and hydration cost for Dashboard, PDF, New Tab, and Settings. Establish which optional imports actually contribute to each initial bundle.
- [ ] **LOAD-02 — Split Settings sections.** Keep the dialog shell and section navigation lightweight. Load a section's code on first use, prewarm the probable next section on pointer or keyboard intent, and retain useful state afterward.
- [ ] **LOAD-03 — Split PDF extras.** Defer optional editing tools, signature UI, Fast Read, and assistant panels. Keep the reader, selection, and existing save behavior functional. If the assistant is already visible by user preference, schedule it after the document's critical initialization.
- [ ] **LOAD-04 — Audit composer dependencies.** Avoid making every page with a composer load every tool's settings dialog, agent UI, and editor dependencies. Use explicit dynamic import boundaries for optional features shown by the bundle analysis.
- [ ] **LOAD-05 — Preload intentionally.** Combine code and data prefetch for likely destinations; deduplicate work and allow foreground input to take priority. A lazy import on click alone is not a complete latency fix.
- [ ] **LOAD-06 — Keep work off the UI thread.** Move measured CPU-heavy transformations to existing supervised workers or appropriate Web Workers. Keep one shared owner for expensive service/status discovery instead of repeating it per component or tab.

Acceptance: initial script/evaluation cost falls in the relevant bundle report; the first use of a deferred feature remains inside its budget; background jobs and saves retain their existing ownership and recovery behavior.

Primary targets: [Settings dialog](C:/Users/20252082/breadboard/dashboard/src/app/components/settings-dialog.tsx), [PDF tools](C:/Users/20252082/breadboard/dashboard/src/app/components/pdf-tools-panel.tsx), [PDF assistant](C:/Users/20252082/breadboard/dashboard/src/app/components/pdf-assistant.tsx), [composer](C:/Users/20252082/breadboard/dashboard/src/app/components/assistant-composer.tsx), and [command hub](C:/Users/20252082/breadboard/dashboard/src/app/components/hermes/command-hub.tsx).

**8. P1 — Make loaded-tab activation cheap**

Dependencies: BASE. Preserve existing paint/readiness protections for genuinely cold documents.

- [x] **TAB-01 — Update only affected views.** On selection, adjust the incoming/outgoing tab and relevant browser/overlay surfaces. Resize all necessary views only for actual window, scale, or layout changes; skip native bounds calls when bounds are unchanged.
- [ ] **TAB-02 — Coalesce state delivery.** Remove duplicate full-state broadcasts from one activation. Prioritize the visible chrome and affected pages; coalesce background updates while retaining every state transition needed for correctness.
- [ ] **TAB-03 — Narrow renderer subscriptions.** Add selectors for active state, enabled state, loading, and per-tab properties so unrelated title/favicon/group changes do not rerender every consumer. Preserve the existing shared bridge subscription and revision ordering.
- [ ] **TAB-04 — Keep warm selection free of readiness waits.** Preserve the existing painted-document fast path. Profile native attachment/compositing separately from the command completing; optimize only where the trace shows a remaining delay.
- [ ] **TAB-05 — Reduce pointer-path work.** Measure the tab strip's synchronous bounds/style reads during pointer-down. Cache geometry or defer drag-only calculations until the drag threshold is crossed where behavior permits. Preserve click, drag, grouping, and keyboard semantics.
- [ ] **TAB-06 — Move session persistence out of interaction work.** Session writes are already delayed by 200 ms. Avoid rebuilding an unchanged session snapshot on unrelated transient updates; use serialized asynchronous atomic writes where appropriate, with explicit shutdown flushing and protection against out-of-order writes.
- [ ] **TAB-07 — Exercise reveal races.** Cover A-to-B-to-C switching while B is cold, closing the pending tab, restoring the base tab, resizing during reveal, renderer failure, browser fullscreen, and a slow incoming page.

Acceptance: loaded-tab p95 meets the agreed budget at 5/15/30 tabs; activation work no longer performs redundant bounds updates across all hidden tabs; the correct page is visibly presented with draft and scroll state intact.

Primary targets: [tab manager](C:/Users/20252082/breadboard/desktop/src/main/tab-manager.ts), [desktop title bar](C:/Users/20252082/breadboard/dashboard/src/app/components/desktop-title-bar.tsx), [tab bridge/store](C:/Users/20252082/breadboard/dashboard/src/lib/desktop-browser-tabs.ts), [tab hooks](C:/Users/20252082/breadboard/dashboard/src/app/components/use-desktop-tabs.ts), and [tab session](C:/Users/20252082/breadboard/desktop/src/main/tab-session.ts).

**9. P1 — Coordinate background work and memory**

Dependencies: BASE and cache ownership. Integrate with the existing governor before enabling additional renderer retention.

- [ ] **BG-01 — Publish explicit activity state.** Distinguish selected, visible, background, closing, and suspended surfaces using the desktop tab owner. Use document visibility as a browser fallback, not the sole desktop activity signal.
- [ ] **BG-02 — Prioritize foreground work.** Order user input/current page data and visible PDF pages ahead of status refreshes, preloads, indexing, and speculative renders. Add bounded concurrency to shared background queues; do not attempt to prioritize arbitrary browser JavaScript through a server queue.
- [ ] **BG-03 — Centralize repeated polling.** Consolidate model health, provider usage, service availability, and shared Settings reads. Use service events where already available, backoff when unchanged, and refresh stale state when a relevant surface becomes active.
- [ ] **BG-04 — Suspend optional hidden UI work.** Pause background animations, unnecessary timers, offscreen page rendering, and hidden panel polling. Preserve playback, recording, authorization, save retries, and job execution through explicit exemptions or independent owners.
- [ ] **BG-05 — Correct timer assumptions.** Timers should derive displayed elapsed time from timestamps after resume. Review the existing `backgroundThrottling: false` settings carefully; do not flip them globally without verifying startup paint, media, and timer behavior on the shipped Electron version.
- [ ] **BG-06 — Add cache pressure responses.** On soft pressure, stop speculative warmups and discard disposable cached pages/data. On stronger pressure, retire spare renderers and only consider restorable inactive views whose state has been safely preserved.
- [ ] **BG-07 — Respect existing process budgets.** Integrate cache/spare-view limits with the memory governor and its hysteresis. Account for renderer, canvas/GPU, Node, worker, and compiler memory; renderer count alone is not a sufficient budget.
- [ ] **BG-08 — Verify cleanup over repeated use.** Open/close PDFs, Settings, and tabs repeatedly; check that intervals, IPC listeners, subscriptions, workers, streams, and canvases plateau rather than accumulate.

Acceptance: foreground latency stays within the agreed loaded-work budget; idle polling/request counts fall; cache growth is bounded; no active task, recording, playback, or unsaved work is lost under pressure.

Primary targets: [renderer preferences](C:/Users/20252082/breadboard/desktop/src/main/window-options.ts), [memory policy](C:/Users/20252082/breadboard/desktop/src/main/memory-policy.ts), [memory governor](C:/Users/20252082/breadboard/desktop/src/main/memory-governor.ts), [assistant intelligence](C:/Users/20252082/breadboard/dashboard/src/app/components/use-assistant-intelligence.ts), and [provider usage](C:/Users/20252082/breadboard/dashboard/src/app/new-tab/use-provider-usage.ts).

**10. P2 — Move the tab strip into a persistent window shell**

Dependencies: TAB and BG. This is a larger architectural change; ship after the immediate loading fixes.

- [ ] **SHELL-01 — Create a lightweight trusted chrome surface.** Own one tab strip per BrowserWindow, independently of each page renderer and its hydration. Define its IPC contract using the existing main-process tab authority.
- [ ] **SHELL-02 — Keep shell startup small.** Do not import the full dashboard, composer, Settings, or agent stack into the chrome renderer. The tab strip should become interactive without waiting for document data or backend services.
- [ ] **SHELL-03 — Migrate interactions completely.** Preserve tab groups, anchors, close/reopen, context menus, keyboard shortcuts, drag/reorder, tear-out where supported, private tabs, and focus behavior.
- [ ] **SHELL-04 — Reconcile native layout.** Adjust title-bar offsets, browser toolbar/content bounds, notifications, find, menus, fullscreen, DPI, and window resizing. Remove duplicate per-page tab strips only after the shell covers each desktop case; retain appropriate web fallback behavior.
- [ ] **SHELL-05 — Remove page-specific chrome waits.** Once the shell is ready independently, stop making cold tab reveal wait for a newly hydrated page tab strip. Keep document readiness checks that prevent blank or wrong-content flashes.
- [ ] **SHELL-06 — Add a recoverable rollout.** Make shell selection configurable during development and QA. Verify rollback restores the existing tab presentation without changing saved sessions or losing tabs.

Acceptance: a busy or failed page renderer cannot block selecting or closing another tab through the shell; new-tab chrome responds immediately; native caption buttons, groups, keyboard navigation, and browser embedding retain their behavior.

Primary targets: [tab manager](C:/Users/20252082/breadboard/desktop/src/main/tab-manager.ts), [tab chrome readiness](C:/Users/20252082/breadboard/desktop/src/main/tab-chrome.ts), [root layout](C:/Users/20252082/breadboard/dashboard/src/app/layout.tsx), [desktop title bar](C:/Users/20252082/breadboard/dashboard/src/app/components/desktop-title-bar.tsx), and [IPC contract](C:/Users/20252082/breadboard/desktop/src/shared/ipc-contract.ts).

**11. P2 — Make new tabs and likely destinations warm**

Dependencies: CACHE and BG; coordinate renderer promotion with SHELL.

- [ ] **WARM-01 — Maintain at most one spare New Tab view initially.** Prepare it only when the app is idle and memory permits. Promote it on the next New Tab action and refill the spare afterward.
- [ ] **WARM-02 — Make promotion a real lifecycle transition.** Handle tab IDs, event ownership, focus, bounds, theme, account state, cancellation, crash, and session recording correctly. A spare must not appear in the visible or saved tab list before promotion.
- [ ] **WARM-03 — Give spare views a passive mode.** Suppress assistant polling, duplicate service startup, location refresh, notifications, and other active-page effects until promotion. Close them on logout or relevant session changes; do not share normal/private state.
- [ ] **WARM-04 — Add bounded intent prefetch.** Warm code and data for likely destinations on hover/focus and cancel queued low-value work when intent changes. Keep a small queue and never pre-render every garden or PDF.
- [ ] **WARM-05 — Match the navigation mechanism.** Use Next.js route prefetch for navigation inside the same renderer. For a new desktop renderer, use shared service/data caches, cached assets, or an actual prepared view; do not assume another renderer's Router Cache transfers.
- [ ] **WARM-06 — Preserve navigation choices.** Keep explicit new-tab, background-tab, and window semantics. Any future "focus existing destination" behavior should be a separate product change rather than a side effect of caching.

Acceptance: a prepared New Tab meets its budget; no preparation stampede occurs during repeated opens; account/theme changes invalidate or update the spare correctly; memory pressure safely disables warming.

Primary targets: [tab manager](C:/Users/20252082/breadboard/desktop/src/main/tab-manager.ts), [New Tab page](C:/Users/20252082/breadboard/dashboard/src/app/new-tab/page.tsx), [navigation links](C:/Users/20252082/breadboard/dashboard/src/app/components/navigation-link.tsx), and [desktop navigation bridge](C:/Users/20252082/breadboard/dashboard/src/lib/desktop-browser-tabs.ts).

**12. P1/P2 — Remove expensive work from ordinary page reads**

Dependencies: BASE and CACHE. Prioritize the endpoints shown to affect the slowest user journeys.

- [x] **DATA-01 — Cache garden summaries.** Avoid counting notes and rescanning the filesystem for every Dashboard/New Tab read. Maintain counts and compact navigation summaries after imports, edits, deletion, and publication; provide a bounded reconciliation path for external changes.
- [x] **DATA-02 — Inspect serial loaders accurately.** Parallelize genuinely independent asynchronous reads. The current cluster helpers use synchronous SQLite/filesystem work despite being declared async; wrapping them in `Promise.all` alone does not make that work concurrent.
- [ ] **DATA-03 — Move publication ahead of navigation.** Schedule Quartz index publication after relevant mutations and prepare common destinations during idle time. Serve the last valid authorized published revision while an update runs where that preserves semantics.
- [x] **DATA-04 — Handle first publication explicitly.** If no valid revision exists, keep normal navigation controls available and show progress until the requested artifact exists. Never replace a blocking build with a temporary 404 or another user's cached view.
- [ ] **DATA-05 — Separate service startup from view display.** Show saved configuration and normal controls without waiting for every optional runtime to start. Start a service when its functionality is requested, or through bounded existing startup policy; status checks must not accidentally start the entire tool suite.
- [ ] **DATA-06 — Remove measured synchronous bottlenecks.** Cache stable config reads, stream large files, and move expensive processing to existing workers. Add query indexes only when query plans and timings identify a need.
- [ ] **DATA-07 — Restore page state on revisits.** Retain scroll, selected sidebar section, filters, and drafts independently of refreshes. Update changed data without replacing the entire page with a loading screen.

Acceptance: common revisits do not rescan content or rebuild Quartz; a publication refresh leaves a valid page usable; first publication still resolves correctly; cold optional services cannot hold the navigation shell hostage.

Primary targets: [cluster actions](C:/Users/20252082/breadboard/dashboard/src/app/actions/clusters.ts), [dashboard page shell](C:/Users/20252082/breadboard/dashboard/src/app/dashboard/dashboard-page-shell.tsx), [garden page](C:/Users/20252082/breadboard/dashboard/src/app/garden/page.tsx), and [Quartz publication](C:/Users/20252082/breadboard/dashboard/src/lib/quartz-publish.ts).

**13. P1 — Tune development separately from the shipped application**

Dependencies: BASE. These changes improve developer use but do not substitute for production loading fixes.

- [ ] **DEV-01 — Confirm the running launcher.** Determine whether the observed slow app uses hot Next development, the existing lean standalone path, or an installed package; include that fact in benchmark reports.
- [ ] **DEV-02 — Benchmark route retention.** Compare the current 30-second/one-page setting with a bounded larger working set, initially testing 5–10 retained routes and 5–10 minutes where the installed bundler honors those settings. Select values from compile latency and memory evidence.
- [ ] **DEV-03 — Reevaluate persistent compiler caching carefully.** Test existing cache settings and invalidation behavior with the actual supervised bundler. Preserve fixes for stale aliases, native modules, trace boundaries, and memory pressure.
- [ ] **DEV-04 — Precompile only frequent routes when appropriate.** Warm a small set after the initial interactive page, with cancellation and memory checks. Avoid compiling the whole application at startup.
- [ ] **DEV-05 — Use the existing lean/production path for daily-use comparisons.** Document launch choices and verify that production results have no on-demand compilation in the interaction path. Do not silently change the user's default development workflow.

Acceptance: hot-route revisits improve under the memory budget; actual code changes still invalidate correctly; standalone and packaged behavior is benchmarked independently.

Primary targets: [Next configuration](C:/Users/20252082/breadboard/dashboard/next.config.ts), [lean launcher](C:/Users/20252082/breadboard/desktop/scripts/dev-fast.mjs), [desktop launcher](C:/Users/20252082/breadboard/desktop/scripts/dev.mjs), and [compiler benchmark](C:/Users/20252082/breadboard/qa/memory/run-dashboard-compiler-benchmark.mjs).

**14. Verification, delivery order, and completion criteria**

Use the existing behavioral tests and Electron fixtures. Add tests for cache correctness, asynchronous races, partial reads, state preservation, and measured user interactions; avoid source-text tests that merely mirror the new implementation.

- [ ] **QA-01 — Cache behavior:** fresh hit, stale hit plus background refresh, concurrent callers, shared reads across tabs, resource invalidation, mutation/read races, expired maximum stale age, upstream failure, logout/account switch, and eviction.
- [ ] **QA-02 — Settings behavior:** full Intelligence close/reopen, section revisit, keyboard focus, retained drafts, independently delayed services, calendar-sync separation, authorization completion, and hidden polling.
- [ ] **QA-03 — PDF behavior:** first/requested page visibility with delayed history/outline, range responses, validators, edited/unsaved versions, concurrent save/open, corrupted or unavailable documents, cancelled loads, large scanned PDFs, and cleanup.
- [ ] **QA-04 — Tab behavior:** warm/cold switching, rapid selection, close-during-reveal, base-tab retirement, groups/anchors, keyboard and drag interactions, renderer failure, browser fullscreen, window resizing, and DPI changes.
- [ ] **QA-05 — Production performance:** measure from actual input through usable visible content. Existing tests that only check native view selection under 250 ms are useful correctness checks, but do not establish the proposed end-to-end budget.
- [ ] **QA-06 — Workload and memory:** repeat the 5/15/30-tab matrix with agent activity; exercise at least 100 open/close/revisit cycles and a 30-minute representative session. Require cache/worker/listener counts to stabilize and memory to remain inside the agreed thresholds.
- [ ] **QA-07 — Package parity:** verify local assets, versioned PDF.js workers, preload paths, private/normal sessions, and streamed PDF routes in the Windows package as well as standalone mode.
- [ ] **QA-08 — Publish results:** attach before/after p50/p95, worst observed latency, failures, transferred bytes, request counts, cache outcomes, and memory for the same fixtures. Record any target still unmet and its remaining bottleneck.

Suggested change sequence; each row is a reviewable delivery group and may need multiple small changes:

| Order | Delivery group | Depends on | Exit evidence |
|---|---|---|---|
| 1 | Instrumentation and baseline | None | Reproducible cold/warm reports |
| 2 | PDF readiness and loading feedback | 1 | Readable page independent of outline/history |
| 3 | Settings lifetime and independent service reads | 1 | Fast reopen; slow-service behavior verified |
| 4 | Shared cache, revisions, and Settings migration | 1, 3 | Cross-tab deduplication and invalidation checks |
| 5 | PDF streaming, validators, and asset versioning | 1, 2; align with 4 | Partial reads and coherent edited versions |
| 6 | Bundle splitting and intent warmup | 2, 3 | Smaller critical bundles without first-use regressions |
| 7 | Cheap tab activation and narrow subscriptions | 1 | Warm-switch latency at 5/15/30 tabs |
| 8 | Background scheduling and memory integration | 4, 7 | Bounded background work and retention |
| 9 | Garden summaries and publication scheduling | 4, 8 | Revisit avoids repeated scans/builds |
| 10 | Persistent window tab strip | 7, 8 | Chrome independent of page readiness |
| 11 | Spare New Tab and desktop-aware prefetch | 4, 8, 10 | Fast promotion within memory budget |
| 12 | Development compiler tuning | 1 | Compile/memory comparison for hot mode |
| 13 | Production/package verification and rollout | Relevant groups above | End-to-end targets and state preservation |

Implementation is complete when the agreed user-visible budgets pass on the production reference setup, cache and background memory remain bounded, and the functional scenarios above pass. A cache hit, a completed IPC command, or a hidden loading indicator alone is not sufficient evidence.

Reference material already consulted: [Next.js prefetching](https://nextjs.org/docs/app/guides/prefetching), [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading), [PDF.js loading FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions), and [Electron background throttling](https://www.electronjs.org/docs/latest/api/web-contents#contentssetbackgroundthrottlingallowed). Read the matching guides bundled with the installed Next.js before changing framework code.
