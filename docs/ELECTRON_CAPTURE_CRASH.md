# Electron screenshot crash investigation

Investigated on 2026-09-06. The retained Windows crashes were in Breadboard's
Electron 33.4.11 main process, during screenshot completion.

## Evidence

Windows Application Error events on 2026-09-03 at 07:06:18 and 08:29:54 local
time identify `electron.exe`, exception `0xC0000005`, offset `0x40bfa45`.
The corresponding local dumps are `electron.exe.50584.dmp` and
`electron.exe.40884.dmp` in `%LOCALAPPDATA%/CrashDumps`.
Both record a read from address `0xcc`, consistent with a null object access.

The matching official Electron 33.4.11 x64 Breakpad symbols have module ID
`62B1119A08EFD1994C4C44205044422E1`. Unwinding both exception threads using
their stack memory and the symbols' CFI gives the same relevant frames:

| Frame | Function | Electron relative address |
| --- | --- | --- |
| 0 | `ui::PropertyHandler::GetPropertyInternal` | `0x40bfa45` |
| 1 | `aura::client::GetFocusChangeObserver` | `0x1d93182` |
| 2 | `wm::FocusController::SetFocusedWindow` | `0x25a2998` |
| 3 | `aura::Window::NotifyWindowVisibilityChangedAtReceiver` | `0x1d8ee53` |
| 4 | `aura::Window::NotifyWindowVisibilityChangedDown` | `0x1d8ec74` |
| 5 | `aura::Window::SetVisibleInternal` | `0x1d8b3f5` |
| 6 | `content::RenderWidgetHostViewAura::Hide` | `0x14888f4` |
| 7 | `content::WebContentsImpl::UpdateVisibilityAndNotifyPageAndView` | `0x15136d0` |
| 8 | `content::WebContentsImpl::DecrementCapturerCount` | `0x5e13755` |
| 9 | `base::ScopedClosureRunner::RunAndReset` | `0x1a2ac85` |
| 10 | `electron::api::OnCapturePageDone` | `0x2c74fc` |

The desktop log already reports `gpu_compositing=disabled_software` and both
hardware adapters inactive for the launches preceding these crashes. Disabling
GPU acceleration therefore did not prevent this failure. A GPU-state warning
alone cannot identify the underlying fault, and its original stderr line was
not present in the retained application logs.

## Repair

`capturePagePreservingVisibility` passes `stayHidden: true` to Electron's
`capturePage` API. Both application screenshot entry points use it: Browser
Terminal (including its empty-frame retries) and Breadboard use. Unavailable
renderers are rejected before calling the native API. Existing request timeouts,
image-size limits, and checks for navigation or a changed target remain in place.

This avoids acquiring a visible capturer merely to take a screenshot. The
ordinary API temporarily shows hidden contents, then restores their visibility
when the copy completes; that restoration reaches the failing native focus
path. Tab activation remains the responsibility of the tab manager. A detached
tab without a retained surface can return the existing unavailable-image error.

The native regression test requests a screenshot through the actual Browser
Terminal transport after switching away from its target. It checks that the
hidden page receives no visibility or focus changes. The visible screenshot
tests also check that real image data is returned by both bridges.

Validation passed: desktop build, test compilation, three capture-policy tests,
both native screenshot integrations, and native renderer recovery (six tests).
Restoring the old capture semantics in the generated helper makes the native
regression assertion fail: its visibility events are `["visible", "hidden"]`
instead of `[]`. The control then hung during Electron exit; it did not produce
a new `0xC0000005` dump. The exact crash diagnosis comes from the two retained
dumps above. The fixture uses the repository's existing assertion-receipt runner
to distinguish screenshot verification from Electron shutdown hangs.

The fix is built into `desktop/dist` and takes effect when Electron next starts.
It does not replace Electron's native implementation for external callers that
invoke raw `capturePage()` themselves; such callers should also specify
`stayHidden: true` when capturing existing tabs.

## References

- [Electron 33.4.11 official symbols](https://github.com/electron/electron/releases/tag/v33.4.11)
- [Electron capture implementation](https://github.com/electron/electron/blob/v33.4.11/shell/browser/api/electron_api_web_contents.cc)
- [Electron capture options](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts)
- [Chromium 130 focus controller](https://github.com/chromium/chromium/blob/130.0.6723.191/ui/wm/core/focus_controller.cc)
