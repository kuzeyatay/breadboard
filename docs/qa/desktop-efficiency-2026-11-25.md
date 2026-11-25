# Breadboard desktop efficiency on Windows

The four optimizations and their regression tests are preserved in a [reviewable implementation patch](breadboard-efficiency-candidate.patch). The active source was restored to its pre-trial state for the affected files. The candidate missed the hot-start acceptance threshold, the complete regression suites did not pass, and several matched workloads remain unverified. The measurements below use the working tree before these edits as the reference.

## Targeted measurements

| Workload | Original | Changed |
| --- | ---: | ---: |
| Native bounds reads per visibility pass with 5 / 15 / 30 recipients and three attached views | 15 / 45 / 90 | 3 / 3 / 3 |
| CPU time for 2,000 visibility passes with 5 / 15 / 30 recipients, median of five trials | 109 / 266 / 344 ms | 62 / 78 / 78 ms |
| Per-overlay delivery sets retained after retiring 100 notification sources | 100 | 0 |
| Scheduled CAD timer callbacks per second with no pointer position | 10 per preload | 0 |
| Bytes read to generate the text preview of a 16 MiB file | 16 MiB | 2 MiB |
| Median preview latency for that file | 6.3 ms | 2.3 ms |
| Two concurrent 128 MiB ZIP uploads, peak working-set growth | 258 MiB | 8 MiB |
| Same uploads, process CPU time / elapsed time | 516 / 327 ms | 375 / 195 ms |
| Two concurrent 48 MiB loopback downloads, peak working-set growth | 241 MiB | 77 MiB |
| Same downloads, process CPU time / elapsed time | 406 / 319 ms | 530 / 341 ms |

The geometry fixture compared the uncovered rectangles in 90 layouts at each tab count, including overlapping, hidden and zoomed views. An expired native sample also lost visibility during an already-started pass. The CAD timer count describes the requested schedule. A background renderer can receive fewer actual callbacks from Chromium. The active timer continues to use a 100 ms interval.

Attachment figures use fresh Node processes and disposable files. ZIP and preview figures are medians of three trials per version. Each preview trial opened the same file twelve times. The slowest changed upload took 991 ms, and the original trials ranged from 311 to 504 ms. Download figures are medians of five interleaved trials on the final code and include the local server and client. Streaming reduced peak memory and kept median elapsed time within the original range of 236–355 ms, at a cost of 124 ms of median CPU time in this test. The slowest changed download took 708 ms. Working-set growth measures resident memory above the process's starting level.

A separate Windows private-memory check held two 48 MiB downloads open and then canceled them. With filesystem workers warmed on both sides, the original process used a median of 77 MiB initially, 317 MiB while open and 317 MiB one second after canceling. The changed process used 77, 80 and 80 MiB. After explicit garbage collection, the readings were 77 and 76 MiB. Three additional trials with cold filesystem workers measured 237 versus 80 MiB while open.

## Scope of the shell comparison

The shell trials used real Electron with a fresh profile on each launch. Standalone used the existing production dashboard bundle. Its matched trials below predate a separate rebuild in the shared checkout. Hot used the development dashboard. Startup ran from Electron launch to the visible first-account form and excludes npm preparation and build time. The idle sample started four seconds later, then compared two Windows process-tree snapshots about eight seconds apart. Private memory sums the final snapshot. CPU sums user and kernel time for processes present in both snapshots.

Separate native tab journeys verified opening, switching, closing and reopening tabs. The measured warm tab reactivation took 55 and 120 ms on the original build and 61 and 102 ms on the changed build. The 1803 × 1100 first-account screenshots matched pixel for pixel in each mode.

| Mode and metric | Original median (range) | Changed median (range) |
| --- | ---: | ---: |
| Standalone startup, seconds | 10.01 (9.19–27.61) | 7.85 (7.61–9.99) |
| Standalone idle CPU, ms per second | 146 (129–179) | 149 (117–162) |
| Standalone private memory, MiB | 828 (826–1011) | 822 (818–824) |
| Hot startup, seconds | 49.70 (39.89–53.99) | 59.27 (43.60–75.69) |
| Hot idle CPU, ms per second | 221.5 (194–382) | 160 (147–333) |
| Hot private memory, MiB | 6725.5 (6544–6923) | 6630 (6566–7205) |

The standalone samples include three original and three changed launches. Hot includes four original and five changed launches. Two additional original hot launches failed before readiness. One recorded a competing Next development-server lock. The development server uses its shared project compiler cache. On the final instrumented hot trials the transition from the ready welcome screen to the first-account screen took 65 ms in the original trial and 128 and 165 ms in the changed trials. Most of the startup time elapsed before the welcome screen became ready. The changed median for end-to-end hot startup exceeded the range of successful baseline launches.

## Regression coverage

- The desktop build, compiled desktop tests, Electron QA type check and scoped dashboard attachment-route type check passed. All 32 focused tests passed, including real browser CAD interaction, a dialog appearing over a stationary pointer, notification deduplication across reloads, partial native coverage, file validation and ownership, byte preservation, cancellation and descriptor cleanup. Another 67 attachment, inbox, notification history, overlay, preview and sound tests passed.
- The cancellation check covers clients disconnecting before opening the file, during the open and after a response exists. All 100 canceled response streams closed their file handles. A ZIP one byte above the 128 MiB limit returned the expected 413 and left the upload directory empty.
- The native recovery test passed after it waited for the deliberately failed request to finish before counting teardown retries. The Windows physical-pixel occlusion test and both website reconnection tests passed. An opacity-zero overlay mute assertion failed on both the original and changed shells.
- A separate native Electron soak opened and closed 50 notification renderers across ten windows per build. Five windows closed with their notification renderer still attached. Both builds completed with zero renderer crashes and zero live notification sources. The original retained 50 per-overlay delivery sets and the changed build retained zero. Sampled private memory peaked at 237 MiB for each build and settled at 152 and 151 MiB, respectively, after closing the windows.
- The current shell reached local auth in both dashboard modes. The broader critical suite stopped on a startup-window lookup and a separate serial journey stopped on its preload-key assertion. The original and changed preloads exposed the same 63 keys and two matched that assertion on each build.
- The first desktop suite attempt exhausted virtual memory. A one-file-at-a-time retry reached the end of its 208-file ordinary lane with 827 passes, 36 failures and five skips. The runner stopped before its screen lane. The original shell reproduced failures in browser-home loading, prepared-tab keyboard focus, the outgoing tab during simulated renderer recovery, notification-navigation fixture bundling, the native focus probe and tab-session restoration at the same assertions or errors. The remaining failures have not all been classified.
- The standard dashboard regression runner exceeded the Windows command-line length with 1,448 ordinary test files. A serial, 25-file batch completed 192 tests with 179 passes and 13 failures. A full retry using batches started with 13,299 MiB of available Windows commit and the repository's resource observer stopped it before the first batch finished. All 18 tracked process identities had exited on a subsequent check.

## Outstanding acceptance checks

Breadboard's full workload requires 17,465 MiB of free Windows commit on this machine. When free commit briefly reached 22,149 MiB, a standalone run using the original shell and an intermediate cached dashboard completed two concurrent 32 MiB ZIP uploads in 1,861 ms and downloaded both in 274 ms. It opened a 16 MiB text file's preview in 664 ms. Sampled process-tree private memory peaked at 1,823 MiB during transfers and was 1,648 MiB after closing the files. These figures supply one standalone observation. The first tab workload used a rejected tab-strip command. The corrected workload used the regular New Tab action, but subsequent launches were denied at 15,798 and 12,197 MiB of free commit.

Full 5-, 15- and 30-tab application trials, matched in-app concurrent transfer measurements in both modes, and end-to-end parity with a fresh build of the final dashboard remain unverified.

## Local build status

After restoring the affected source files, the desktop build and desktop test compilation passed again. The four generated JavaScript modules for notifications, tabs and the preload matched the saved pre-trial modules byte for byte. Git also verified that the full patch applies cleanly to the restored source.

A separate build refreshed the shared standalone dashboard cache at 18:12 UTC during the trials. Its compiled download handler contains the intermediate streaming implementation, which can raise an unhandled abort error if a client disconnects as its file opens. The patch includes the correction and regression tests. The source restored after the trials uses the original download handler.

The guarded production build initially declined to start with 8,304 MiB of available commit. A retry with the supported 4 GiB heap cleared the 18,489 MiB reserve, then Windows prevented the build from rotating the locked output directory. At the final check the disk had 1.4 GiB free and the existing bundle occupied 2.6 GiB. Rebuild the standalone dashboard from the restored source after the lock clears and space is available, before packaging or distributing this local cache.
