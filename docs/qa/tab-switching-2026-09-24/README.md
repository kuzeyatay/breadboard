# Tab switching validation — 24 September 2026

This change separates window controls from the Next.js pages and keeps a bounded set of native surfaces available for immediate selection. The requested selection (`activeId`) and native presentation (`presentedId`, revision, status) are distinct. Native presentation telemetry alone is not a physical latency measurement.

## Implementation

- One locally bundled, sandboxed window shell renders the existing tab strip and browser navigation. It has a restricted IPC bridge. Page commands carry tab identity, document generation and presentation revision.
- The dashboard is a content view over a neutral window root. Loaded resident views switch through native stacking at unchanged bounds, without page probes, screenshots, network completion or session serialization.
- New, replaced and evicted surfaces use bounded first-frame checks. Navigation, cancellation, document replacement and failed probes supersede or settle their generation. Failed probes retry automatically. Streaming HTML and slow subresources no longer block a valid document frame.
- Session writes and unrelated page updates are coalesced. Flushing a session also delivers the queued page updates; it cannot silently cancel them. Shared-renderer replacement cancels old paint checks and restarts readiness for its current generation.
- Each window has an LRU surface cache. All windows share a 128 MiB reservation allowance, reduced to 32 MiB under constrained pressure and zero under critical/emergency pressure. Reservations use physical dimensions and conservative triple buffering. Active/presented/pending resources are necessary display resources, excluded from the additional cache allowance.
- Surface eviction retains the existing documents, form state and history. Shared browser home/panel content replaces per-browser-tab toolbar renderers. Hidden home widgets retain drafts and playback leases while optional status streams, weather/calendar polls, clocks and CSS animation pause. Background saves, service jobs, playback and downloads continue.
- The pressure observer reuses the existing MemoryGovernor thresholds, cadence and hysteresis with Electron physical-memory headroom. It is a physical-memory fallback, not a subscription to Runtime V2's Rust service-admission state. Reservations are estimates, not exact GPU allocation measurements or a limit on total application memory.

## Functional verification

The built Electron implementation was exercised with actual WebContentsViews and the bundled production controls:

- Rejected frame checks recover without another selection; an open HTML response and a stalled image both present usable content before network completion.
- Resident switching performs no readiness probes or viewport mutations, preserves drafts, and supports rapid keyboard and mouse selection.
- Repeated close clicks, close during loading, 40 open/close cycles per DPI run, and a busy website renderer preserve working window controls and release closed website renderers.
- Shared-shell, website, workspace and primary-window renderer crashes recover after native teardown; stale commands and probes cannot act on replacement documents.
- Groups, anchors, moving a dashboard with an unsaved draft between windows, private browsing cleanup, account changes, session close/restart, runtime port reconnect, reader links, fullscreen and multiple window sizes pass their targeted regressions.
- Native runs at 125% and forced 200% scaling verify layout and cache reservations. They do not simulate dragging a live window between physical monitors with different DPI.
- A browser UI test mounts the real shared BrowserClient and home widgets (heavy terminal/settings panels are stubbed). It checks shortcut drafts, pending outgoing-home visibility, disabled hidden status polling, and continued Spotify lease renewal.

The larger native regression run passed 19 checks before the new global-cache assertion was built. The rebuilt cache/group/shell follow-up passed all 5 checks, including the two DPI cases. Together the 21 selected native regression cases have passing results. See `final-regressions.log`, `recovery-followup.log` and `cache-followup.log`; the earlier failed cache assertions are retained in the log for traceability.

Desktop compilation and test compilation pass. Scoped browser/toolbar TypeScript checking and lint pass. The browser UI, shared-home and foreground-stream tests pass. This is not a clean full-repository test run: the broad dashboard typecheck traverses vendored OpenMAIC/toolchain code with existing errors, the Node-only window-options mock suite encounters Electron session APIs outside Electron, and older fixtures still assume the dashboard is BrowserWindow.webContents. The packaged installer and the user's running desktop process were not replaced or restarted.

## Physical measurement method

`desktop/scripts/benchmark-tab-switching.mjs` compiles the test-only C# probe and launches the built Electron tab manager. Windows SendInput supplies real mouse down/up input. BitBlt/GdiFlush samples displayed screen pixels for the selected tab marker and the expected content color. After visibility, a second native click must change the page button's displayed result. An activeId update is never accepted as proof of display or input usability.

Each 5/15/30-tab run contains a mixture of local documents and native websites, with 40 measured switches between a warmed two-tab working set. All measured candidate targets are resident. This measures increasing total tab count, not uniformly random switching through all 30 documents. Cold and evicted loads are tested separately for correctness; no cold-load percentile is claimed.

The comparison reconstructs the previous per-tab chrome and detached-surface architecture using the current code and controls. It is not an untouched historical build. Each mode uses an isolated temporary profile. Working set and idle CPU are summed across Electron's process family; separate application services are outside this fixture. Idle CPU is a short sample rather than a sustained workload study.

Screen readback adds observer overhead and samples at a finite rate. Zero unexpected sampled pixels is evidence against flashes at the observed points, not proof that every pixel of every frame was inspected. The usable-control metric includes a second mouse input and repaint after the content was observed, so it is not a single switch-to-frame measurement.

## Reproduce

From the repository root on Windows:

```powershell
npm --prefix desktop run build
npm --prefix desktop run test:build
node desktop/scripts/benchmark-tab-switching.mjs docs/qa/tab-switching-local
node --test --test-concurrency=1 desktop/dist-tests/tests/tab-shell-integration.test.js desktop/dist-tests/tests/tab-frame-readiness.test.js desktop/dist-tests/tests/renderer-crash-recovery-integration.test.js
node --test dashboard/tests/browser-shared-home.test.mjs dashboard/tests/foreground-event-source.test.mjs dashboard/tests/desktop-tabs-recovery-ui.test.mjs
```

Keep the foreground fixture unobstructed during the physical benchmark and avoid other builds or interactive input. Restart the development desktop process to load the new main-process shell implementation; this work does not update an installed package automatically.


## Recorded results

Runtime: **Electron 33.4.11**, Chromium 130.0.6723.191; Windows display scale 125%. The production shell JavaScript bundle is approximately 282 KB before compression.

| Tabs | Controls p50/p95/p99 ms | Visible p50/p95/p99 ms | Second-click usable p50/p95/p99 ms |
|---:|---:|---:|---:|
| 5 | 82.9 / 99.7 / 131.5 | 67.4 / 99.7 / 100.6 | 151.9 / 169.1 / 184.3 |
| 15 | 82.0 / 99.2 / 115.9 | 65.1 / 99.2 / 115.9 | 148.6 / 168.6 / 200.9 |
| 30 | 82.4 / 100.9 / 102.3 | 66.2 / 100.9 / 102.3 | 150.7 / 184.7 / 202.4 |

Legacy architecture comparison:

| Tabs | Controls p50/p95/p99 ms | Visible p50/p95/p99 ms | Second-click usable p50/p95/p99 ms |
|---:|---:|---:|---:|
| 5 | 67.3 / 84.6 / 132.9 | 100.6 / 135.3 / 166.9 | 169.1 / 204.0 / 232.2 |
| 15 | 66.7 / 100.8 / 102.4 | 100.2 / 134.0 / 170.4 | 183.0 / 203.4 / 219.8 |
| 30 | 67.8 / 100.8 / 102.0 | 100.9 / 135.2 / 151.3 | 183.4 / 204.4 / 222.6 |

Process-family working set and idle CPU:

| Tabs | Candidate MiB | Comparison MiB | Reduction | Candidate CPU % | Comparison CPU % |
|---:|---:|---:|---:|---:|---:|
| 5 | 1753 | 1888 | 7.1% | 1.061 | 1.071 |
| 15 | 3077 | 4097 | 24.9% | 0.898 | 1.283 |
| 30 | 5039 | 7473 | 32.6% | 0.048 | 0.469 |

All 120 candidate switches reached visible content and a working page control. There were 0 unexpected sampled body pixels. Raw samples: [candidate.json](candidate.json), [legacy-comparison.json](legacy-comparison.json).

## Acceptance limits

- The 50 ms control-response target is **not met** by the physical measurement. Visible p95 is approximately 99–101 ms in this run, with the 30-tab case slightly above the 100 ms target. Earlier runs varied; this is not a demonstrated strict p95 guarantee.
- The second-click usability measurements include another input/paint cycle. They confirm functional controls but do not establish the proposed 100 ms switch-to-usable acceptance threshold.
- The baseline is a reconstruction, idle CPU is a short sample, and only a warmed two-tab working set was benchmarked at each total tab count. Cold-network latency and uniformly random 30-tab switching need separate performance measurements.
- Cache reservations bound additional retained surfaces, not total renderer memory. Total memory remains several GiB when preserving all 30 documents. No unsaved document is automatically discarded.
- The built Electron manager and production shell were validated. A packaged installer smoke test, a live mixed-DPI monitor move, and complete legacy-fixture migration remain outside the completed checks.
