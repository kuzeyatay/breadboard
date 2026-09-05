import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const bridge = read("../src/lib/desktop-browser-tabs.ts");
const titleBar = read("../src/app/components/desktop-title-bar.tsx");
const shortcut = read("../src/app/components/browser-shortcut.tsx");
const newTab = read("../src/app/new-tab/new-tab-client.tsx");
const catalog = read("../src/lib/profile/navbar-shortcuts.ts");
const page = read("../src/app/browser/page.tsx");
const client = read("../src/app/browser/browser-client.tsx");
const widgets = read("../src/app/browser/browser-home-widgets.tsx");
const personalization = read("../src/app/browser/browser-personalization.tsx");
const terminal = read("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const inlineAgentBrowser = read("../src/app/components/hermes/inline-agent-browser-run.tsx");
const gardenWorkspace = read("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const spotifyRoute = read("../src/app/api/browser/spotify/route.ts");
const spotifyService = read("../src/lib/spotify/service.ts");
const spotifyPalette = read("../src/lib/spotify/player-palette.ts");
const inlineSpotify = read("../src/app/components/hermes/inline-spotify-player.tsx");
const weatherRoute = read("../src/app/api/browser/weather/route.ts");
const suggestionsRoute = read("../src/app/api/browser/suggestions/route.ts");
const pixabayRoute = read("../src/app/api/browser-wallpapers/pixabay/route.ts");
const globals = read("../src/app/globals.css");

test("the embedded browser is opened and controlled through the desktop tabs bridge", () => {
  assert.match(
    bridge,
    /\| \{ type: "browser"; url\?: string; replaceCurrent\?: boolean \}/,
  );
  assert.match(bridge, /\| \{ type: "browser-navigate"; input: string \}/);
  assert.match(bridge, /\| \{ type: "browser-terminal"; open: boolean; width\?: number \}/);
  assert.match(bridge, /\| \{ type: "browser-address-suggestions"; open: boolean \}/);
  assert.match(bridge, /export function openBrowserInDesktop/);
  assert.match(shortcut, /openBrowserInDesktop\(\)/);
  assert.match(newTab, /openBrowserInDesktop\(\{ replaceCurrent: true \}\)/);
  for (const source of [shortcut, newTab]) {
    assert.doesNotMatch(source, /window\.open|firefox\.exe/);
  }
});

test("browser tabs share Breadboard's strip and use a trusted address toolbar", () => {
  assert.match(bridge, /browser: \{ label: "Browser", kind: "browser" \}/);
  assert.match(titleBar, /tab\.browser \? "browser" : describeTabUrl/);
  assert.match(titleBar, /tab\.browser\?\.favicon/);
  assert.match(page, /redirect\("\/auth\/login\?callbackUrl=\/browser"\)/);
  assert.match(client, /aria-label="Address and search"/);
  assert.match(client, /type: "browser-navigate", input/);
  assert.match(client, /breadboard:focus-browser-address/);
  assert.match(client, /Search the web or enter a web address/);
  assert.match(client, /useChatGreeting\(\{ scope: "mine", temporary: false \}\)/);
  assert.match(widgets, /function BrowserQuickLinks/);
  assert.match(widgets, /function BrowserDock/);
  assert.match(client, /<DashboardAgentTerminal[\s\S]*?presentation="drawer"/);
  assert.match(client, /const TERMINAL_DEFAULT_WIDTH = 640;/);
  assert.match(client, /const TERMINAL_MAX_VIEWPORT_SHARE = 0\.5;/);
  assert.match(client, /drawerSidebarExpanded=\{terminalWidth >= TERMINAL_SIDEBAR_EXPAND_WIDTH\}/);
  assert.match(client, /aria-valuemax=\{terminalMaxWidth\(viewportWidth\)\}/);
  assert.doesNotMatch(client, /TERMINAL_MAX_WIDTH = 760/);
  assert.match(client, /storedWidthValue === null \? null : Number\(storedWidthValue\)/);
  assert.match(client, /dynamic\([\s\S]*?dashboard-agent-terminal/);
  assert.doesNotMatch(client, /import DashboardAgentTerminal from/);
  assert.match(client, /terminalLoaded \? \(/);
  assert.match(terminal, /compact=\{drawerPresentation\}/);
  assert.match(terminal, /collapsed=\{terminalRailCollapsed\}/);
  assert.match(terminal, /onToggleCollapsed=\{toggleTerminalRail\}/);
  assert.doesNotMatch(terminal, /collapsed=\{drawerPresentation \|\| rail\.collapsed\}/);
  assert.match(client, /className="browser-side-rail"/);
  assert.match(client, /className="browser-terminal-resizer"/);
  assert.match(widgets, /className=\{`browser-sketch-outline/);
  assert.match(client, /<GoogleGlyph \/>/);
  assert.doesNotMatch(client, /browser-google-wordmark|Breadboard browser/);
  assert.match(
    client,
    /className="browser-toolbar"[\s\S]*?<NavbarFlowerWind showFlowers=\{showFlowers\} \/>[\s\S]*?className="browser-navigation-controls"/,
  );
  assert.doesNotMatch(client, /browser-flower-strip/);
  assert.match(page, /showFlowers=\{getNavbarFlowers\(userId\)\}/);
  assert.match(page, /restoreOwnerKey=\{restoreOwnerKey\}/);
  assert.match(globals, /flex: 0 0 var\(--breadboard-navbar-height\)/);
  assert.match(globals, /align-items: center/);
  assert.match(
    globals,
    /\.browser-address-form\s*\{[\s\S]*?background: color-mix\(in srgb, var\(--paper-raised\) 62%, transparent\);[\s\S]*?backdrop-filter: blur\(11px\) saturate\(145%\)/,
  );
  assert.match(
    globals,
    /\.browser-side-rail\s*\{[\s\S]*?top: calc\(var\(--breadboard-navbar-height\) \+ 34px\)/,
  );
  assert.doesNotMatch(globals, /\.browser-flower-strip/);
  assert.match(globals, /\.browser-terminal-drawer\[data-open="true"\]/);
  assert.match(globals, /--browser-terminal-width, 640px/);
  assert.match(globals, /animation: bb-suggestion-sketch 8460ms/);
  assert.match(globals, /browser-navigation-progress 920ms/);
});

test("browser startup reconnects and repairs a plain shell instead of becoming a dead screen", () => {
  assert.match(bridge, /function scheduleBridgeRetry\(\)/);
  assert.match(bridge, /connectDesktopTabsBridge\(\)/);
  assert.match(bridge, /export async function refreshDesktopTabsState/);
  assert.match(client, /openBrowserInDesktop\(\{ replaceCurrent: true \}\)/);
  assert.match(client, /Starting Browser…/);
  assert.match(client, /Try again/);
  assert.match(client, /Back to dashboard/);
  assert.doesNotMatch(client, /Browser tabs are available in the Breadboard desktop app/);
});

test("browser home provides live dock data, search suggestions, and editable shortcuts", () => {
  assert.match(client, /role="combobox"/);
  assert.match(client, /role="listbox"/);
  assert.match(client, /searchSuggestions\(searchQuery, recentSearches, googleSearchSuggestions\)/);
  assert.match(client, /searchSuggestions\(addressLookupQuery, recentSearches, googleAddressSuggestions\)/);
  assert.match(client, /breadboard:browser-searches:/);
  assert.doesNotMatch(client, /rememberSearch\(browser\.address\)/);
  assert.match(client, /browser-address-suggestions/);
  assert.match(client, /onPointerDown=\{\(\) => setSearchFocused\(true\)\}/);
  assert.match(client, /onPointerDown=\{\(\) => setAddressFocused\(true\)\}/);
  assert.doesNotMatch(client, /onFocus=\{\(\) => setSearchFocused\(true\)\}/);
  assert.match(client, /GOOGLE_SUGGESTION_DEBOUNCE_MS = 60/);
  assert.match(client, /googleSuggestionCache/);
  assert.match(client, /cache: "default"/);
  assert.doesNotMatch(client, /\$\{value\} news|\$\{value\} images/);
  assert.match(suggestionsRoute, /suggestqueries\.google\.com\/complete\/search/);
  assert.match(client, /Search with Google or enter an address/);
  assert.match(client, /Search with Google/);
  assert.match(client, /BrowserSuggestionGlyph/);
  assert.match(client, /className="browser-suggestion-remove"/);
  assert.match(client, /onRemoveHistory\(suggestion\.value\)/);
  assert.match(client, /removeHistoryEntry\(value\)/);
  assert.match(globals, /\.browser-suggestion-remove\s*\{/);
  assert.doesNotMatch(client, /browser-suggestion-google|Google suggestion/);
  assert.match(client, /<AnimatedBrowserGreeting greeting=/);
  assert.match(widgets, /window\.setTimeout\(erase, 32\)/);
  assert.match(widgets, /window\.setTimeout\(\(\) => write\(index \+ 1\), 46\)/);
  assert.match(widgets, /disconnected \/>/);
  assert.match(widgets, /Add shortcut/);
  assert.match(widgets, /navigatorWithBattery\.getBattery/);
  assert.match(widgets, /className="browser-dock-network"/);
  assert.doesNotMatch(widgets, /className="browser-dock-apps"/);
  assert.match(widgets, /www\.google\.com\/s2\/favicons/);
  assert.match(widgets, /function ResilientSiteImage/);
  assert.match(widgets, /icons\.duckduckgo\.com\/ip3/);
  assert.match(widgets, /new URL\("\/favicon\.ico", page\.origin\)/);
  assert.match(widgets, /onError=\{\(\) => setSourceIndex\(\(index\) => index \+ 1\)\}/);
  assert.match(client, /pageUrl=\{browser\.address\}/);
  assert.match(client, /pageUrl=\{bookmark\.url\}/);
  assert.match(titleBar, /browserTabFaviconFallback/);
  assert.match(titleBar, /reportedFavicon \? undefined : "true"/);
  assert.match(widgets, /\/api\/browser\/weather/);
  assert.match(widgets, /\/api\/hermes\/connections\/spotify\/engine/);
  assert.match(widgets, /const \[initializing, setInitializing\] = useState\(true\)/);
  assert.match(widgets, /initializing \? "Loading Spotify…"/);
  assert.match(widgets, /data-loading=\{initializing\}/);
  assert.match(spotifyRoute, /spotifyPlaybackEngineStatus/);
  assert.match(spotifyRoute, /endpoint: "\/v1\/me\/player"/);
  assert.match(weatherRoute, /api\.open-meteo\.com/);
  assert.match(globals, /grid-template-columns: repeat\(7,/);
  assert.match(globals, /width: 40px/);
  assert.match(globals, /animation: browser-suggestions-enter 90ms ease-out;/);
  assert.match(globals, /height: clamp\(260px, calc\(100vh - 245px\), 560px\);/);
});

test("browser home has daily quotes, an image-free default, and theme-specific backgrounds", () => {
  assert.match(client, /useBrowserWallpaper\(restoreOwnerKey\)/);
  assert.match(client, /<BrowserDailyQuote ownerKey=\{restoreOwnerKey\}/);
  assert.match(client, /<BrowserWallpaperPicker/);
  assert.match(personalization, /breadboard:browser-wallpaper:\$\{ownerKey\}:\$\{theme\}/);
  assert.match(personalization, /currentTheme=|editingTheme/);
  assert.match(personalization, /"Astral" \| "Places" \| "Abstract"/);
  assert.match(personalization, /className="browser-wallpaper-trigger"/);
  assert.match(globals, /\.browser-wallpaper-trigger\s*\{[\s\S]*?right:\s*30px;[\s\S]*?bottom:\s*48px;/);
  assert.match(globals, /@media \(max-width: 620px\)\s*\{[\s\S]*?\.browser-wallpaper-trigger\s*\{[\s\S]*?bottom:\s*43px;/);
  assert.match(personalization, /className="browser-wallpaper-drawer"/);
  assert.match(personalization, /<BrowserSketchOutline targetRef=\{quoteRef\} index=\{2\} \/>/);
  assert.match(personalization, /\["Generated", "Human"\] as const/);
  assert.equal((personalization.match(/model: "GPT Image"/g) ?? []).length, 6);
  assert.match(personalization, /Generated by \{wallpaper\.model\}/);
  assert.match(personalization, /Photo by \{image\.creator\}/);
  assert.doesNotMatch(personalization, /Make it yours|"Built-in" \| "Pixabay"/);
  assert.match(personalization, /light: NO_WALLPAPER_ID,[\s\S]*?dark: NO_WALLPAPER_ID/);
  assert.match(personalization, /className="browser-wallpaper-none"/);
  assert.match(client, /data-has-wallpaper=\{personalization\.hasWallpaper\}/);
  assert.doesNotMatch(globals, /--browser-wallpaper-default/);
  const wallpaperSources = [...personalization.matchAll(/src: "(\/browser-wallpapers\/[^"]+\.webp)"/g)]
    .map((match) => match[1]);
  assert.equal(wallpaperSources.length, 6);
  for (const source of wallpaperSources) {
    assert.equal(fs.existsSync(new URL(`../public${source}`, import.meta.url)), true, source);
  }
  assert.match(globals, /\.browser-daily-quote/);
  assert.match(globals, /--browser-bottom-width: min\(1020px, calc\(100% - 170px\)\);/);
  assert.match(globals, /--browser-dock-height: 104px;/);
  assert.match(globals, /\.browser-daily-quote\s*\{[\s\S]*?bottom:\s*18px;[\s\S]*?left:\s*68px;/);
  assert.match(globals, /\.browser-daily-quote\s*\{[\s\S]*?height:\s*var\(--browser-dock-height\);[\s\S]*?justify-content:\s*center;/);
  assert.match(globals, /@media \(max-width: 1780px\)\s*\{[\s\S]*?--browser-bottom-width: min\(960px, calc\(100% - 340px\)\)/);
  assert.match(globals, /@media \(max-width: 1780px\)\s*\{[\s\S]*?\.browser-daily-quote\s*\{[\s\S]*?width: max\(150px, min\(310px, calc\(50% - 548px\)\)\)/);
  assert.match(globals, /@media \(max-width: 940px\)\s*\{[\s\S]*?\.browser-daily-quote\s*\{[\s\S]*?bottom: 136px/);
  assert.match(personalization, /browserDailyQuote\(today, ownerKey, 42\)/);
  assert.match(personalization, /browser-daily-quote-compact/);
  assert.match(globals, /\.browser-dock\s*\{[\s\S]*?width:\s*var\(--browser-bottom-width\);[\s\S]*?height:\s*var\(--browser-dock-height\);/);
  assert.match(globals, /html\[data-theme="dark"\] \.browser-dock\s*\{[\s\S]*?background:\s*rgb\(8 14 11 \/ 94%\);/);
  assert.match(globals, /html\[data-theme="dark"\] \.browser-dock\s*\{[\s\S]*?color:\s*#f7f4ec;/);
  assert.doesNotMatch(globals, /\.browser-dock\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--ink-heading\)/);
  assert.match(globals, /\.browser-wallpaper-drawer\[data-open="true"\]/);
  assert.match(globals, /\.browser-wallpaper-categories\s*\{[\s\S]*?min-height:\s*30px;[\s\S]*?flex:\s*none;/);
});

test("Pixabay wallpaper search remains server-side, cached, safe, and attributed", () => {
  assert.match(personalization, /\/api\/browser-wallpapers\/pixabay\?q=/);
  assert.match(personalization, /Photos from Pixabay/);
  assert.match(personalization, /pixabay:\$\{image\.id\}/);
  assert.match(pixabayRoute, /process\.env\.PIXABAY_API_KEY/);
  assert.match(pixabayRoute, /readFile\(candidate, "utf8"\)/);
  assert.match(pixabayRoute, /next: \{ revalidate: SEARCH_CACHE_SECONDS \}/);
  assert.match(pixabayRoute, /safesearch: "true"/);
  assert.match(pixabayRoute, /orientation: "horizontal"/);
  assert.match(pixabayRoute, /min_width: "1280"/);
  assert.match(pixabayRoute, /selectedImage\(imageId\)/);
  assert.doesNotMatch(personalization, /PIXABAY_API_KEY/);
  assert.doesNotMatch(client, /PIXABAY_API_KEY/);
});

test("browser bookmarks persist in desktop storage per profile and occupy trusted chrome", () => {
  assert.match(client, /breadboard:browser-bookmarks:/);
  assert.match(client, /useBrowserSavedItems\([\s\S]*?restoreOwnerKey,[\s\S]*?browserBookmarksControl,/);
  assert.match(read("../src/app/browser/browser-saved-items.ts"), /One-time migration from the former port-scoped renderer store/);
  assert.match(bridge, /getBrowserBookmarks\?: \(ownerKey: string\)/);
  assert.match(bridge, /setBrowserBookmarks\?:/);
  assert.match(client, /className="browser-bookmark-toggle"/);
  assert.match(client, /className="browser-extensions-toggle"/);
  assert.match(client, /aria-label="Extensions"/);
  assert.match(client, /className="browser-extensions-menu"/);
  assert.match(client, /Load unpacked/);
  assert.match(client, /type: "browser-extension-load"/);
  assert.match(client, /type: "browser-extension-reload", id/);
  assert.match(client, /type: "browser-extension-remove", id/);
  assert.match(globals, /\.browser-extensions-menu\s*\{/);
  assert.match(globals, /\.browser-address-actions\s*\{/);
  assert.match(client, /aria-pressed=\{currentBookmarked\}/);
  assert.match(client, /className="browser-bookmarks-bar"/);
  assert.match(client, /<BrowserSiteIcon src=\{bookmark\.iconUrl\}/);
  assert.match(client, /navigate\(bookmark\.url\)/);
  assert.match(client, /removeBookmark\(bookmark\.url\)/);
  assert.match(globals, /\.browser-bookmarks-bar\s*\{[\s\S]*?flex: 0 0 34px/);
  assert.match(globals, /\.browser-bookmarks-bar\s*\{[\s\S]*?padding: 3px 10px 3px 14px/);
  assert.match(globals, /top: calc\(var\(--breadboard-navbar-height\) \+ 34px\)/);
});

test("the trusted rail opens resizable Terminal, Recent searches, and Starred panels", () => {
  assert.match(client, /type BrowserToolPanel = "terminal" \| "history" \| "starred"/);
  assert.match(client, /toggleToolPanel\("terminal"\)/);
  assert.match(client, /toggleToolPanel\("history"\)/);
  assert.match(client, /toggleToolPanel\("starred"\)/);
  assert.match(client, /aria-label="Recent searches"/);
  assert.match(client, /aria-label="Starred pages"/);
  assert.match(client, /visibleHistory\.map/);
  assert.match(client, /removeHistoryEntry\(entry\)/);
  assert.match(client, /removeBookmark\(bookmark\.url\)/);
  assert.match(client, /aria-label="Resize browser panel"/);
  assert.match(globals, /\.browser-tool-panel\[data-active="true"\]/);
  assert.match(globals, /\.browser-library-panel\[data-active="true"\]/);
  assert.match(globals, /\.browser-rail-actions/);
});

test("browser Spotify opens a CarPlay-style searchable player and uses the Breadboard engine", () => {
  assert.match(widgets, /className="browser-spotify-popover"/);
  assert.match(widgets, /role="dialog"/);
  assert.match(widgets, /role="tablist"/);
  assert.match(widgets, /aria-label="Spotify player and library"/);
  assert.match(widgets, /url\.searchParams\.set\("view", "search"\)/);
  assert.match(widgets, /url\.searchParams\.set\("view", "playlists"\)/);
  assert.match(widgets, /control\("play-track"/);
  assert.match(widgets, /control\("play-playlist"/);
  assert.doesNotMatch(widgets, /onClick=\{spotify\?\.connected \? undefined/);
  assert.match(spotifyRoute, /"play-track"/);
  assert.match(spotifyRoute, /"play-playlist"/);
  assert.match(spotifyRoute, /body: \{ uris: queueUris \}/);
  assert.match(spotifyRoute, /body: \{ context_uri: playlistUri \}/);
  assert.match(spotifyService, /endpoint: "\/v1\/me\/playlists"/);
  assert.match(spotifyService, /endpoint: `\/v1\/playlists\/\$\{playlistId\}\/items`/);
  assert.match(spotifyService, /"playlist-read-private"/);
  assert.match(inlineSpotify, /@\/lib\/spotify\/player-palette/);
  assert.match(widgets, /@\/lib\/spotify\/player-palette/);
  assert.match(spotifyPalette, /export function paletteFromCover/);
  assert.match(globals, /\.browser-spotify-popover\[data-open="true"\]/);
  assert.match(globals, /@media \(prefers-reduced-transparency: reduce\)/);
});

test("browser Spotify keeps the library legible and recovers playlist permissions", () => {
  assert.doesNotMatch(widgets, /className="browser-spotify-eyebrow"/);
  assert.doesNotMatch(widgets, /className="browser-spotify-logo-dot"/);
  assert.match(widgets, /SPOTIFY_HISTORY_KEY/);
  assert.match(widgets, /Recently played/);
  assert.match(widgets, /Reconnect Spotify to show your playlists\./);
  assert.match(widgets, />Reconnect Spotify</);
  assert.match(spotifyService, /spotify_playlist_permission_required/);
  assert.match(spotifyService, /playlist\.ownerId === currentUserId \|\| playlist\.collaborative/);
  assert.match(globals, /\.browser-spotify-result:not\(:last-child\)::after/);
  assert.match(globals, /\.browser-spotify-result small\s*\{\s*color: rgb\(255 255 255 \/ 72%\)/);
});

test("browser home orbits counter-rotate and retain a reduced-motion shade drift", () => {
  assert.match(
    globals,
    /\.browser-start-page::before\s*\{[\s\S]*?browser-orbit-clockwise 33840ms linear infinite[\s\S]*?browser-orbit-shade 16920ms cubic-bezier\(0\.77, 0, 0\.175, 1\)/,
  );
  assert.match(
    globals,
    /\.browser-start-page::after\s*\{[\s\S]*?browser-orbit-counterclockwise 25380ms linear infinite[\s\S]*?browser-orbit-shade 16920ms cubic-bezier\(0\.77, 0, 0\.175, 1\) -8460ms/,
  );
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.browser-start-page::before\s*\{\s*animation: browser-orbit-shade/,
  );
});

test("browser entry points are desktop-only and use product-neutral copy", () => {
  assert.match(shortcut, /if \(!tabs\?\.enabled\) return null;/);
  assert.match(newTab, /function BrowserShortcut\([\s\S]*?if \(!tabs\?\.enabled\) return null;/);
  assert.match(newTab, /<BrowserShortcut query=\{needle\} \/>/);
  assert.match(catalog, /key: "browser",\s*label: "Browser",\s*description:/);
  for (const source of [bridge, titleBar, shortcut, newTab, catalog, page, client]) {
    assert.doesNotMatch(source, /Firefox/);
  }
});

test("desktop Agent Browser runs open once and a closed tab stays closed", () => {
  assert.match(bridge, /type: "browser-agent"; runId: string; url\?: string/);
  assert.match(bridge, /export function openBrowserAgentRunInDesktop/);
  for (const source of [terminal, gardenWorkspace]) {
    assert.match(source, /browserMode: usesDesktopBrowser \? "desktop" : "external"/);
    assert.match(source, /await openBrowserAgentRunInDesktop\(String\(data\.run\.runId\)\)/);
  }
  assert.match(
    inlineAgentBrowser,
    /async function startSignIn\(\): Promise<SignInStartResult>[\s\S]*?openBrowserAgentRunInDesktop\(runId, authRequired!\.url\)/,
    "an explicit sign-in handoff may reopen the live tab",
  );
  assert.doesNotMatch(
    inlineAgentBrowser,
    /useEffect\(\(\) => \{[\s\S]*?openBrowserAgentRunInDesktop\(runId\)[\s\S]*?\}, \[persistedOutcome, runId, usesDesktopBrowser\]\)/,
    "mounting or remounting a run card must not reopen a tab the user closed",
  );
});
