# Tab selection no longer waits for loading

## Reproduction

In the running desktop app, native mouse events reached the bundled shell and
changed selection in roughly 6–12 ms. Selecting loaded local tabs 6 and 7 left
`presentedId` at tab 5. The selected document was complete, but its parked
animation-frame probe did not run. Subsequent clicks selected another pending
tab without displaying it. The original selection was restored after inspection.

## Change

- Persistent-shell selection attaches and raises the chosen native page at its
  final bounds synchronously. A cold page loads in that surface; another tab's
  document is never the fallback for the requested selection.
- Paint checks observe readiness after selection. Failure/retry only affects
  presentation status and the existing green top progress bar; it does not move
  the page away, cancel its navigation, or block another selection.
- A committed local HTML response can become presented before DOMContentLoaded
  or EOF. External browser content does not wait for the shared home renderer.
- An ordinary pointer press holds focus without enlarging the native shell.
  Only a real drag expands the shell for split/reorder previews. Removed
  redundant native stacking operations on resident selections.
- Existing native documents, session data, shared browser chrome, and the
  adaptive 128 MiB additional-surface cache remain in use. No duplicate renderer
  or screenshot cache was added. Memory pressure can still detach inactive
  surfaces without destroying documents or drafts.
- Legacy windows without the persistent shell keep the existing handoff, since
  their controls belong to the outgoing document.

## Verification

Built with `npm --prefix desktop run build`. Runtime: Electron **33.4.11**,
Chromium **130.0.6723.191**. Tests use isolated temporary profiles.

The native shell fixture now clicks three deferred tabs whose HTTP responses
never arrive, checks that each request starts on selection, selects another
working tab, and repeatedly closes the waiting tabs. Re-selecting a loading tab
does not restart its request. It also checks shell bounds while mouse-down is
held, and clicks a working control in a local document whose HTML response
remains open. Existing coverage includes rejected frame probes, slow images,
browser streaming, stale IPC, 40 open/close cycles, stalled renderers, native
Windows occlusion, 2x DPI, resizing, and memory pressure. Split drag, both pane
inputs, resize, eviction, ungroup, and session restore also pass.

The built-shell browser test checks original group/tab alignment, the green
4 px progress bar at y=0, usable close controls while it runs, and browser
navigation ending at y=135. Its cleanup now closes test-server connections so
keep-alive connections cannot strand the runner.

## Physical mouse and visible pixels

`candidate.json` records 40 OS mouse switches at each population, between two
resident pages in a mix of local/PDF-shaped and browser documents. A native
screen-pixel probe measures the active-tab marker, the actual destination body,
then a second mouse click that changes the destination's body color. These
measurements include Windows input/composition/readback latency; they do not
substitute an `activeId` event for visible presentation. Pages are fixtures,
not the user's full garden/PDF workloads.

| Tabs | Controls p50/p95/p99 (ms) | Visible p50/p95/p99 (ms) | Working control p50/p95/p99 (ms) |
| --- | --- | --- | --- |
| 5 | 83.6 / 134.1 / 150.4 | 83.4 / 117.9 / 134.7 | 134.5 / 184.2 / 185.1 |
| 15 | 83.3 / 100.6 / 133.5 | 67.0 / 99.6 / 100.4 | 134.1 / 167.0 / 167.9 |
| 30 | 83.9 / 101.5 / 151.3 | 83.7 / 100.6 / 100.9 | 150.4 / 167.9 / 184.2 |

No unexpected body-pixel colors were sampled across these 120 switches.
`evicted.json` repeats the protocol with critical memory pressure and zero
additional-surface cache; no sample in that run qualifies as resident.

The **50 ms controls target is not met** by the recorded physical test, and
visible p95 is slightly over 100 ms at 30 tabs (and higher at 5). These results
support removing the indefinite loading gate, not a claim that every real page
is instant. Cold response times still depend on the server.

## Memory and comparison limits

`legacy-comparison.json` uses the current fixture in legacy mode with a toolbar
per browser tab and surfaces evicted. It is a reconstructed architecture
comparison, not an untouched copy of the previous application build.

At 30 tabs, summed process working sets were 4716 MiB for the shared-shell
candidate versus 6809 MiB for legacy mode (about 31% lower); idle CPU samples
were 0.064% versus 0.265%. These are short samples on a machine with other
applications running. Summed working sets include shared pages and are not a
measurement of unique/private memory. The 128 MiB budget covers additional
owned surfaces, not all live documents or total Chromium memory.

The user's running desktop process was not restarted; it still needs a restart
to load the rebuilt main process. Its live documents and jobs were not closed.
