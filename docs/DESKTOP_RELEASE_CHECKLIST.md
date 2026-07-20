# Breadboard Desktop Release Checklist

## Per release

1. Bump `desktop/package.json` version (drives installer name, workspace
   provisioning version, About info).
2. `npm run desktop:build:dashboard` — clean standalone build.
3. `npm run desktop:prepare` — runtimes + staged resources (records versions
   in `build-resources/runtimes/runtimes-manifest.json`).
4. `npm run desktop:test` — full desktop suite green.
5. `npm run desktop:verify` — staged-resource guard green.
6. `npm run desktop:dist:win` — NSIS installer.
7. `npm run desktop:verify` again — now also validates `release/win-unpacked`.
8. Installed smoke test on a machine/profile without the repo checkout
   (checklist in DESKTOP_PACKAGING.md / final report): install → launch from
   shortcut → register/login → create cluster → ingest a small file →
   `sources/` visible in Quartz → Garden Chat + terminal reach OpenHarness →
   restart persists DB/files → quit leaves no `bun.exe`/`python.exe`/service
   `node.exe` → uninstall keeps `%APPDATA%/breadboard-desktop`.

## Signing status — **currently unsigned**

There are no code-signing credentials in this repository.
`electron-builder.yml` sets `signAndEditExecutable: false`. Consequences:

- SmartScreen will warn on first run; users must choose "Run anyway".
- Do not distribute externally in this state.

To enable signing: obtain an EV/OV certificate (or Azure Trusted Signing),
configure `win.signtoolOptions`/`WIN_CSC_*` env vars, remove
`signAndEditExecutable: false`, and verify the signed artifact.

## Update status — **auto-update disabled by design**

`publish: null` in `electron-builder.yml`; the app performs no update checks
and never downloads code. Rationale: an unsigned auto-update path is an RCE
vector. Enabling updates later requires: signed artifacts, an HTTPS release
feed (electron-updater generic/GitHub provider), staged rollout with explicit
user confirmation, and keeping user data (`Data/`) untouched — the current
data layout already survives reinstall/update because nothing mutable lives
in the install directory.

Version reporting already exists (`breadboard:get-versions` IPC, shown on the
startup screen), so an update indicator can be added without new plumbing.
