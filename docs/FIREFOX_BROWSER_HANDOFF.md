# Embedded Chromium browser — pivot handoff

> This filename is retained so links to the original Firefox proposal keep
> working. The Firefox docking implementation was removed after real-window
> testing exposed slow launches, duplicated chrome, and unreliable composition.

## Decision

Breadboard's desktop browser now uses Electron's built-in Chromium renderer.
This is a deliberate architecture pivot, not a browser-brand substitution.

The former design launched a native Firefox window and positioned it over a
Breadboard placeholder. That made one logical tab span two native windows and
two independent tab systems. It also introduced a Windows-only PowerShell/
Win32 sidecar, launch polling, window ownership, profile management, and a
visible handoff delay. The embedded Chromium design keeps the complete browser
tab inside the Electron window and uses Breadboard's tab model as the only
source of truth.

## Implemented architecture

A browser tab consists of two `WebContentsView`s:

1. A trusted dashboard view at `/browser`. It receives the normal preload,
   renders the shared 32px Breadboard tab strip and an 82px address/navigation
   surface with the dashboard's synchronized flowers and grass behind the
   controls.
2. A sandboxed page view placed at `y = 114`, directly below that chrome. It
   has no preload and therefore cannot call Breadboard desktop APIs.

The tab manager attaches and detaches these views as a unit. The trusted view
is revealed first using the existing first-frame handoff; the page view is
layered in only after its first DOM is ready. A blank browser tab therefore
opens immediately and focuses the large start-page search field rather than waiting for a
remote start page.

The blank state is a local, Firefox-style start surface with a prominent Google
search field. It does not load a remote search homepage; submitting either that
field or the address bar sends the value through the same validated navigation
command. The flower preference from Profile is respected, and the garden stays
visible behind the lowered controls when an external page is attached.

The window manager also projects Breadboard's effective light/dark theme into
Electron's native theme source. Sandboxed sites therefore receive the matching
`prefers-color-scheme` value before paint, and each browser view's loading
background is refreshed on live theme changes. This avoids site-specific style
injection and keeps the isolation boundary intact.

### Commands and state

The existing tabs IPC contract now carries:

- `browser` to create a browser tab, optionally with an initial URL;
- `browser-navigate` for address/search input;
- `browser-stop` for an in-flight load;
- the existing `back`, `forward`, `reload`, activate, close, move, and reopen
  commands.

Each browser tab publishes its current address, loading state, and back/forward
availability. Page titles name the Breadboard tab. `window.open` is denied in
place and translated into another Breadboard browser tab; Chromium never grows
a second tab strip.

### Address handling

Only HTTP and HTTPS pages may load. Full web URLs are normalized, hostname-like
input receives an `https://` scheme (`localhost` uses `http://`), and other
plain text becomes a Google search. Explicit non-web schemes such as `file:`,
`javascript:`, and `data:` are rejected.

### Security boundary

The page view uses:

- `sandbox: true`;
- `contextIsolation: true`;
- `nodeIntegration: false`;
- `webviewTag: false`;
- no preload script;
- the isolated persistent partition `persist:breadboard-browser`;
- default-deny permission handlers;
- an HTTP(S)-only navigation guard.

The global renderer guard continues to restrict every product page to approved
local origins. Browser contents must register their webContents id before
navigating, and registration is revoked when they are destroyed. The separate
partition prevents a website from sharing Breadboard's authenticated dashboard
session even though both are rendered by Chromium.

## Main files

| File | Responsibility |
| --- | --- |
| `desktop/src/main/tab-manager.ts` | Composite browser tabs, layout, lifecycle, navigation, popups, shortcuts, and state |
| `desktop/src/main/security.ts` | Browser-content registration and sandbox navigation/permission policy |
| `desktop/src/shared/ipc-contract.ts` | Browser commands and browser tab state |
| `desktop/src/main/app-lifecycle.ts` | Supplies the authenticated `/browser` shell URL |
| `dashboard/src/app/browser/page.tsx` | Authenticated trusted browser shell route |
| `dashboard/src/app/browser/browser-client.tsx` | Flower-backed address toolbar and Google new-tab surface |
| `dashboard/src/lib/desktop-browser-tabs.ts` | Renderer bridge types and `openBrowserInDesktop` |
| `desktop/tests/browser-tab.test.ts` | Real-Electron security, layout, history, popup, and detach coverage |
| `dashboard/tests/browser-tab.test.mjs` | Dashboard bridge, route, copy, and chrome wiring checks |

Removed components include the Firefox launcher/session/theme modules, the
Win32 window-dock client and sidecar, the `/firefox` placeholder route, and all
Firefox-specific tests and packaging steps.

## Verification

The real-Electron browser fixture proves that:

- the browser command creates one Breadboard tab;
- the trusted shell fills the window while the web page starts at `y = 114`;
- the web page has no `breadboardDesktop` bridge;
- its session is `persist:breadboard-browser`;
- address navigation and browser history work;
- `window.open` creates another Breadboard browser tab;
- closing and reopening restores the browser URL as a browser tab;
- both views detach when another Breadboard tab comes forward.

Run the focused checks with:

```powershell
cd desktop
npm run build
npm run test:build
node --test dist-tests/tests/browser-tab.test.js

cd ..\dashboard
node --test tests/browser-tab.test.mjs tests/browser-navigation-tabs.test.mjs
npx eslint src/app/browser src/app/components/browser-shortcut.tsx `
  src/app/new-tab/new-tab-client.tsx src/lib/desktop-browser-tabs.ts
```

## Follow-up boundary

Downloads, permission prompts, certificate-error UI, password management, and
custom search-engine preferences remain intentionally outside this pivot. They
should be added through trusted Breadboard chrome; no website should ever gain
the desktop preload bridge to implement them.
