# Firefox in Breadboard: implementation plan

> **Superseded.** The native Firefox/window-docking approach was retired after
> integration testing. Do not implement this plan. The accepted embedded
> Chromium architecture and current verification record live in
> [`FIREFOX_BROWSER_HANDOFF.md`](./FIREFOX_BROWSER_HANDOFF.md).

Goal: a browser reachable from two places and nowhere else, a card on the
"Where to?" page (`/new-tab`) and a seat in the top navbar. The browser is
Firefox, restyled in Breadboard's own palette. No other UI changes.

## The one constraint that shapes everything

Electron cannot host Firefox's engine. Mozilla dropped desktop embedding years
ago (GeckoView exists only for Android, XULRunner is gone), so there is no way
to put a Gecko page inside a Breadboard window the way the existing tabs put
Chromium pages there. Every "browser inside an Electron app" that exists is
Chromium, because that is what Electron is.

That leaves two honest shapes:

- **A. Real Firefox, launched and owned by Breadboard.** Breadboard starts the
  installed Firefox with its own private profile, supervises it, and restyles
  its chrome from Breadboard's tokens. It is genuinely Firefox. It runs in its
  own OS window next to Breadboard's, not inside it.
- **B. A Breadboard-native browser on Electron's Chromium.** A new tab kind in
  the existing tab manager that may navigate anywhere, with a Breadboard-styled
  toolbar. It sits inside the window, in the same tab strip. It is not Firefox.

This plan builds **A**, because the request says Firefox by name and A is the
only shape that delivers it. Stage 1 (the two entry points and the shell
bridge) is identical for both, so the decision can still flip after Stage 1
with nothing wasted. B is outlined at the end for comparison.

## Decisions taken up front

1. **Use the Firefox already installed, do not bundle one.** Mozilla publishes
   no zip for Windows, only `Firefox Setup 155.0.exe` (87 MB, a 7-Zip
   self-extractor) and an `.msi`. Extracting at build time would add a 7z
   dependency to `prepare-runtimes.mjs` and ~250 MB to the installer on a
   machine that is chronically near-full. Firefox 155 is installed on this
   machine at `C:\Program Files\Mozilla Firefox\firefox.exe` and is
   discoverable from the registry. A missing Firefox is a reported state, not
   a crash. Bundling can be a later stage if the prompt turns out to matter.
2. **Separate OS window, no docking.** Reparenting Firefox's HWND into the
   Electron window with Win32 `SetParent` is possible from the Rust runtime
   but is the kind of hack that breaks focus, DPI, popups, IME and GPU
   compositing in ways no test catches. Out of scope; noted as a future spike.
3. **A Breadboard-owned profile** under `<Data>/firefox/profile`. The person's
   own Firefox profiles are never read or written. All theming and prefs live
   in that profile, so uninstalling Breadboard leaves their Firefox untouched.
4. **Restyle with `userChrome.css` and `userContent.css`, not a theme
   extension.** Release Firefox refuses unsigned extensions, so a bundled
   WebExtension theme would have to go through addons.mozilla.org signing.
   The stylesheet route needs one pref and works today.
5. **The navbar seat goes through the existing shortcut catalog.** The catalog
   in `navbar-shortcuts.ts` is the single list the navbar reads and the Profile
   page renders, on purpose ("a shortcut cannot be offered in settings without
   a navbar honouring it, or the reverse"). Adding a `browser` seat there
   therefore makes one extra toggle row appear on the Profile page's shortcuts
   card automatically. That is the only incidental UI consequence; if it is
   unwanted, the seat can be hard-wired on instead and skip the catalog.
6. **Firefox outlives Breadboard.** Closing Breadboard does not kill the
   browser; Firefox's own session restore brings its tabs back. Breadboard only
   needs to know how to reach the running instance, and Firefox's per-profile
   remoting gives that for free: a second launch with the same `--profile`
   hands the URL to the instance already open.
7. **Desktop only.** In a plain web browser there is no shell bridge, so the
   card and the seat do not render. That mirrors `DesktopTitleBar` and the
   `BrowserNavigationPanel` card.

## Stage 0: half-day spike

Before writing product code, confirm four behaviours against Firefox 155 by
hand, from a scratch profile directory:

- `firefox.exe --profile <dir> -new-tab <url>` opens a new instance the first
  time and hands the URL to that instance the second time, without touching
  the default profile.
- `toolkit.legacyUserProfileCustomizations.stylesheets=true` in `user.js`
  still makes `chrome/userChrome.css` apply (it has for years, but verify on
  155 rather than assume).
- `browser.startup.homepage=about:home` plus the Activity Stream prefs below
  gives an empty start page that `userContent.css` can paint.
- `browser.theme.toolbar-theme` / `browser.theme.content-theme` (0 dark,
  1 light, 2 system) flip Firefox's own chrome on the next launch.

## Stage 1: entry points and the shell bridge

**Shell IPC.** Add `openBrowser` to `desktop/src/shared/ipc-contract.ts`
(`breadboard:open-browser`, payload `{ url?: string }`, reply
`{ ok: true } | { ok: false; reason: "not-installed" | "launch-failed" }`),
expose it from `desktop/src/preload/preload.ts` beside `getBrowserNavigation`,
and handle it in `app-lifecycle.ts` by calling the launcher from Stage 2. The
handler must reject any sender whose URL is not one of the allowed origins,
the same check every other privileged channel does.

**Dashboard bridge.** New `dashboard/src/lib/desktop-browser.ts`: a
`desktopBrowserBridge()` accessor shaped like `desktopTabsBridge()`, plus
`openDesktopBrowser(url?)` returning the reply. Nothing here imports the
database.

**Where to? card.** In `new-tab-client.tsx`, add a "Browser" entry rendered
after the fixed `PLACES` grid. Unlike the other places it is a button, not a
link: it calls `openDesktopBrowser()` and does not navigate the tab. Because
bridge presence is only known on the client, gate it the way `DesktopTitleBar`
does (read `document.documentElement.dataset.breadboardDesktop` after mount,
or `useSyncExternalStore` with a server snapshot of false) so the server and
first client render agree. Copy: label "Browser", detail "Firefox, in
Breadboard's colours." When the reply is `not-installed`, the card swaps its
detail line for "Firefox is not installed" with a "Get Firefox" link that goes
through `shell.openExternal` via the existing external-link path. Right-click
does nothing extra; `LinkContextMenu` is for places that can be tabs.

**Navbar seat.** New `dashboard/src/app/components/browser-shortcut.tsx`, a
client button styled exactly like the Plan seat (same classes, a small
window-with-globe glyph), calling `openDesktopBrowser()`. It renders `null`
when the bridge is absent. `navbar.tsx` renders it when `shortcuts.browser`
is on, placed between Work timer and Plan.

**Seat storage.** In `navbar-shortcuts.ts`: add `browser: boolean` to
`NavbarShortcuts`, a catalog entry (`key: "browser"`, label "Browser",
description "Firefox in a Breadboard-owned profile, restyled to match.",
no `href`), default `true`, and a `browser INTEGER NOT NULL DEFAULT 1` column
added through the same `PRAGMA table_info` / `ALTER TABLE` pattern the `plan`
column uses so existing rows get the default. Extend `readNavbarShortcuts`
and `writeNavbarShortcuts` for the new column. The API route and the Profile
page pick the seat up from the catalog without edits.

## Stage 2: the launcher in the shell

New `desktop/src/main/firefox-launcher.ts`, deliberately not a supervised
service definition (the same reasoning `recall.ts` documents: it must not start
at app launch, and it belongs to a signed-in person's action).

- `resolveFirefoxExecutable(config)`: `firefoxExecutable` from
  `desktop-config.json` if set, else the registry
  (`HKCU` then `HKLM` `SOFTWARE\Mozilla\Mozilla Firefox\CurrentVersion` ->
  `<version>\Main\PathToExe`, read with `reg query` through `execFile`, never a
  shell), else `%ProgramFiles%\Mozilla Firefox\firefox.exe`. Returns null when
  none exists on disk.
- `firefoxProfileDir(paths)`: `<Data>/firefox/profile`, created on first use.
- `prepareProfile(dir, theme)`: writes `user.js` and `chrome/userChrome.css` +
  `chrome/userContent.css` from Stage 3 on every launch (cheap, keeps the
  theme in step, and `user.js` is only read at Firefox startup anyway).
- `launchFirefox({ url, theme })`: `spawn(exe, ["--profile", dir, "-new-tab",
  url ?? "about:home"], { detached: true, stdio: "ignore" }).unref()`. Errors
  from `spawn` map to `launch-failed`; a null executable maps to
  `not-installed`. Log one line per launch through `log-manager`.
- No pid file. Per-profile remoting is the "focus the existing window"
  mechanism, and Firefox is not killed on exit (decision 6).

`user.js` contents, the prefs that make a fresh profile quiet and ours:

```
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref("browser.startup.homepage", "about:home");
user_pref("browser.startup.page", 3);                 // restore last session
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.toolbars.bookmarks.visibility", "never");
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);
user_pref("browser.newtabpage.activity-stream.showWeather", false);
user_pref("browser.theme.toolbar-theme", <0|1>);       // from Breadboard theme
user_pref("browser.theme.content-theme", <0|1>);
user_pref("layout.css.prefers-color-scheme.content-override", <0|1>);
```

The theme values come from `theme-state.ts`, which the shell already keeps
current for the title bar.

## Stage 3: the restyle

New `desktop/src/main/firefox-theme.ts` holds one palette per theme and
renders the two stylesheets. The shell cannot import the dashboard's CSS, so
the tokens are copied here beside the title-bar constants that already live in
`window-options.ts`, with a comment naming their source lines in
`dashboard/src/app/globals.css`:

| Token | Light | Dark |
| --- | --- | --- |
| paper (`--paper-bg`) | `#e6f0e6` | `#0b0c0a` |
| caption strip (title bar) | `#faf7ef` | `#171916` |
| ink (`--ink`) | `#13201b` | `#ccd2c9` |
| heading (`--ink-heading`) | `#0f1a16` | `#e2e7de` |
| muted (`--ink-muted`) | `#50615a` | `#8d968b` |
| strong line (`--line-strong`) | `#9cb7a7` | `#454f48` |
| botanical accent (`--botanical`) | `#4f6f68` | `#91b7a1` |

`userChrome.css` restyles, in this order of visibility: the tab strip
(`#TabsToolbar`, `.tabbrowser-tab`, `.tab-background`, selected tab raised on
the paper tone with a 3 px botanical underline, the same shape as
`.bb-tab[data-active]` in Breadboard's own strip), the navigation bar and URL
bar (`#nav-bar`, `#urlbar-background`, inset field on the caption tone, botanical
focus ring), toolbar buttons (ink at 70 %, full ink on hover), menus and
popups (`menupopup`, `panel`, `.panel-arrowcontent`), the sidebar, and the
findbar. Both palettes are emitted, selected by
`@media (prefers-color-scheme: dark)`, so a system-theme profile follows the
OS while Breadboard's explicit theme is applied through the prefs above.
Typography stays Firefox's; the fonts Breadboard uses are web fonts the
profile does not have.

`userContent.css` paints `about:home`, `about:newtab`, `about:blank`,
`about:preferences` and `about:addons` in the paper tone with ink text, and
hides the remaining Activity Stream chrome (`.top-sites`, `.wallpaper-*`,
logo wordmark) so the start page is a quiet Breadboard-coloured sheet with the
search field. Nothing is injected into ordinary websites.

Both generators are pure functions of `(theme) -> string` so they can be
snapshot-tested without Firefox.

## Stage 4: tests and verification

- `desktop/tests/firefox-launcher.test.ts`: executable resolution from faked
  `reg query` output and a fake filesystem, argument construction, the
  `not-installed` and `launch-failed` replies, and that `prepareProfile`
  writes `user.js` with the theme's numbers and a `chrome/` directory.
- `desktop/tests/firefox-theme.test.ts`: each generated stylesheet contains
  every token of its palette and parses (a bracket-balance check is enough;
  there is no CSS parser in the shell's dependencies).
- `desktop/tests/desktop-api.test.ts`: the preload exposes `openBrowser` and
  the channel is in the contract.
- `dashboard/tests/navbar-shortcuts.test.mjs`: the new column is added to a
  table created without it, the default is on, a patch flips it, unknown keys
  are still ignored.
- Manual, never against the live dev app: start a throwaway desktop instance
  on a scratch data directory, click the Where to? card, see a Firefox window
  in Breadboard's colours open on a quiet start page; click the navbar seat,
  see a new tab arrive in that same window rather than a second window; quit
  Breadboard, see Firefox stay; open `about:profiles` in the person's own
  Firefox and confirm nothing there changed; switch Breadboard to dark, relaunch
  Firefox, see the dark palette.

## Files touched

| File | Change |
| --- | --- |
| `desktop/src/shared/ipc-contract.ts` | `openBrowser` channel and reply type |
| `desktop/src/preload/preload.ts` | expose `openBrowser` |
| `desktop/src/main/app-lifecycle.ts` | IPC handler, sender origin check, wiring to the launcher |
| `desktop/src/main/firefox-launcher.ts` | new: resolve, prepare profile, spawn |
| `desktop/src/main/firefox-theme.ts` | new: palettes, `userChrome.css` / `userContent.css` generators |
| `desktop/src/main/runtime-config.ts` | optional `firefoxExecutable` field |
| `dashboard/src/lib/desktop-browser.ts` | new: bridge accessor and `openDesktopBrowser` |
| `dashboard/src/app/new-tab/new-tab-client.tsx` | the Browser card |
| `dashboard/src/app/components/browser-shortcut.tsx` | new: the navbar seat |
| `dashboard/src/app/components/navbar.tsx` | render the seat when on |
| `dashboard/src/lib/profile/navbar-shortcuts.ts` | `browser` key, catalog entry, column, default on |
| `docs/DESKTOP_ARCHITECTURE.md` | one paragraph on the launcher beside Recall |
| tests listed in Stage 4 | |

Untouched on purpose: `tab-manager.ts`, `tab-model.ts`, `security.ts`,
`desktop-title-bar.tsx`, `desktop-browser-tabs.ts`, the Profile page. The tab
strip, the navigation lockdown and the shortcuts all stay exactly as they are,
because Firefox is a separate process and never a page inside the shell.

## Deferred

- Docking the Firefox window inside Breadboard's (Win32 `SetParent` from the
  Rust runtime). A spike, not a commitment.
- Bundling Firefox in the installer (7z-extract the SFX in
  `prepare-runtimes.mjs`, pinned SHA-256, staged under
  `build-resources/runtimes/firefox`).
- A signed WebExtension theme, which would survive a Mozilla removal of the
  `userChrome.css` pref.
- Live theme sync into an already-running Firefox (needs an extension with a
  local socket; the per-launch rewrite covers the common case).

## Alternative B, for comparison

If "inside the window" matters more than "actually Firefox", the shape is: a
`browser` tab kind in `tab-manager.ts` whose content `WebContentsView` uses a
separate `persist:breadboard-browser` session and is not passed through
`hardenWebContents`; a thin chrome `WebContentsView` above it loading a new
`/browser` route (URL bar, back, forward, reload in Breadboard's classes);
`security.ts` split into "Breadboard pages" and "browser content" policies,
with permission prompts surfaced instead of denied; `describeTabUrl` given a
`browser` kind and glyph; the same two entry points opening a tab with
`{ type: "open", url: "/browser" }`. Roughly three times the work of A, all of
it in the most security-sensitive part of the shell, and the result is the
same Chromium the app already runs.
