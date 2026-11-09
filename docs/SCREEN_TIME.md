# Screen Time

The Terminal's quick tools include **Screen Time**, immediately after Gestures in both Terminal layouts. `/screen-time` shows day, week and month views, with focused applications, named Breadboard tabs, websites visited in Breadboard, activity categories and a recent timeline. Charts can be drilled into by hour or day. Categories describe the kind of activity, not its value or productivity.

## Data and lifecycle

This is an independent implementation inspired by [Screeny](https://github.com/ArnoGevorkyan/Screeny), particularly its foreground-window intervals and five-minute idle threshold. It does not install Screeny or import its database, and does not manufacture historical screen-time totals from sparse Recall frames.

The packaged `windows-screen-time.exe` is built by the existing desktop static-asset step using the Windows .NET Framework compiler. Electron owns one fixed, hidden, read-only helper after account authentication. It samples foreground process, window title and idle age every two seconds. The main process adds the actual foreground Breadboard tab's title and URL. Background tabs, automated browser tabs and private Breadboard tabs are excluded. Other operating systems display an unavailable state.

The helper does not capture screenshots, keys, audio or accessibility text. URL credentials, query strings and fragments are omitted. It exits when Electron exits, and Electron stops it on pause, sign-out and normal shutdown. Gaps over six seconds, such as suspend/resume, are never counted as active time. Changes to tracking and exclusion preferences reach the sampler within five seconds.

Usage checkpoints and settings live under `BREADBOARD_DATA_DIR/screen-time/<authenticated-user-id>/`. Files are isolated by account. Checkpoints are clipped and deduplicated before aggregation; tab and website time is a breakdown of the Breadboard total, not additional time. Checkpoints crossing midnight are read correctly. Local calendar boundaries, including daylight-saving days, come from the viewer's timezone. History older than 180 days is pruned daily while the app runs.

Screen Time must be running to collect time; existing app histories are not backfilled. The web page displays existing local data but cannot track OS apps without the Windows desktop helper. It reports offline, paused and error states without inserting example usage. Screenshots in the isolated QA packet use clearly synthetic test fixtures and are not the user's activity.

## Recall and suggestions

Selecting a usage row or timeline moment queries the existing authenticated Recall service for the matching time and app/window. Recall's feature switch, exclusions, result cap and text bounds continue to apply. Empty results explain that Recall must have been recording at that time. Saved Breadboard routes and websites can be reopened; a focus-timer link and a copyable activity summary connect the page to other workflows.

When **Use activity in Breadboard suggestions**, personalization and Recall agent access are enabled, the existing recommendation pipeline can use the five most-used named tabs from the preceding 24 hours. It receives names, visit counts and foreground durations; this evidence explicitly does not establish completion, unfinished work or productivity. It does not add captured screen text. Turning the setting off or editing exclusions invalidates recommendation caches. The settings UI explains that this optional evidence can be sent to the chosen AI provider.

Screen Time exclusions prevent subsequent matching samples and also filter prior history. Recall exclusions additionally filter history as it is read on the page. Private browsing in other applications is best-effort by visible private-window names; explicit app exclusions remain available.

## Verification

- Dashboard model tests cover overlap/deduplication, range clipping, bucket drilldowns independent of timeline limits, tab/app totals, invalid rows and Amsterdam daylight-saving transitions.
- Desktop policy tests cover idle/suspend gaps, private and automated tab context, excluded windows, signed-out accounts and URL sanitization.
- Isolated service checks cover account isolation, route authentication/validation, settings, exclusions and suggestion revocation.
- Isolated browser checks cover populated and empty states, day/week/month, search, chart drilldowns, Recall, settings, pause/resume, responsive layouts, reduced motion, error recovery and account changes.

The isolated patch has not restarted or changed the running Breadboard installation. Installed lifecycle and end-to-end recording remain part of the coordinated desktop build's acceptance checks.
