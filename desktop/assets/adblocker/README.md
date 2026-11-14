# Built-in ad blocker

Breadboard bundles EasyList and EasyPrivacy by The EasyList authors
(https://easylist.to/) for native
network and cosmetic filtering, using the MPL-2.0 @ghostery/adblocker engine. Source lists are
unmodified; their headers record the upstream version, commit and license.
The lists are dual licensed GPL-3.0-or-later / CC-BY-SA-3.0; distributed here
under CC-BY-SA-3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
The unmodified engine's source is https://github.com/ghostery/adblocker/tree/v2.20.1
and its MPL license is included in MPL-2.0.txt.

The desktop build compiles these lists into dist/main/adblocker.bin and bundles
the engine, including its license comments. Both ship inside the app; source
lists and this attribution ship in assets/adblocker. There is no runtime list
download or telemetry. To refresh rules for a release, replace easylist.txt and
easyprivacy.txt with the upstream files and rebuild/test the desktop.

The uBlock Origin authors' filtering, privacy, badware, resource-abuse, unbreak,
and quick-fix lists (including annual lists through 2026) and scriptlet/redirect
resources are bundled from Ghostery's compatible distribution. These assets
are licensed under GPL-3.0; see GPL-3.0.txt and the notices in each list. The
unmodified asset URLs, source revision, and SHA-256 checksums are recorded in
upstream.json. The scriptlet/redirect resources come from
https://github.com/ghostery/adblocker/tree/6f0610bf5eec1f31c4975ce0e707cdf47023e5b5/packages/adblocker/assets/ublock-origin
and the lists from https://github.com/uBlockOrigin/uAssets/tree/c9008387b70f543d4ba87209c438b7f48693196b/filters
(Ghostery's mirror of the lists lags by weeks).
Original projects: https://github.com/uBlockOrigin/uAssets and
https://github.com/gorhill/uBlock. Engine/content/selector helpers are unmodified
MPL-2.0 packages at 2.20.1; see MPL-2.0.txt. Their license comments and source
maps are retained in the bundled JavaScript.

Refresh these assets explicitly with
`node scripts/update-adblocker.mjs <ghostery/adblocker SHA> <uBlockOrigin/uAssets SHA>`
from desktop/. Video-site rules go stale within weeks, so refresh for every release. The build checks every pinned
asset checksum and compiles the lists/resources offline. Review upstream changes
and rerun both ad blocker tests before releasing an updated snapshot.

The blocker filters network requests including subframes, serves replacement
ad SDKs from an in-memory protocol, applies supported query-removal rules to
GET subrequests, hides static/dynamic ad elements, and runs bundled scriptlets
at document start in a single private scope. The engine's shared native-function
snapshot prevents YouTube's stacked JSON/fetch/XHR scriptlets from recursively
calling earlier wrappers. Extended selectors support text/ancestor matching. Browser
CSP is preserved; it can still refuse a replacement resource. No downloaded
code is executed at runtime and no product bridge is exposed to websites.

On YouTube, an ad that starts despite the rules is ended by seeking to its
last frame and pressing its skip button (browser-adblocker-preload.ts).

YouTube player-response and Prime Video JSON/DASH rules are enabled, alongside
the lists' other streaming-site rules. This is best-effort filtering: services
change their players; unsupported rule syntax, region/account experiments,
server-stitched ads, or DRM/player restrictions can limit results. The blocker
does not add Widevine support or guarantee ad-free playback on every service.
Deterministic Electron fixtures exercise YouTube inline startup and fetch/XHR responses, Prime
JSON and DASH ad periods, preserved video/subtitle/DRM data, scriptlet timing,
replacement SDKs, CSP, dynamic cosmetics, site/global pauses, and linear work
for stacked player-request edits (including settings refreshes). They do not
constitute live subscriber playback verification.

Top-level navigations and Breadboard's app session are unaffected. Site
exceptions apply to the exact hostname and all requests beneath that page.
Changes affect new requests and cosmetic styles immediately. Reload to clear
already-installed scriptlet patches or recover content previously removed.
Normal settings persist in browser-adblocker.json. Private sessions inherit a
copy of those settings and keep subsequent changes only in memory. Request
counts are per document, reset on navigation, and are never written to disk.
