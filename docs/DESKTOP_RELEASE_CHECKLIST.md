# Breadboard Desktop Release Checklist

## Per release

1. Bump `desktop/package.json` version (drives installer name, workspace
   provisioning version, About info).
2. `npm ci --prefix dashboard`, `npm ci --prefix quartz`, and
   `npm ci --prefix desktop` — validate lockfiles and install dependencies.
3. `npm audit --prefix quartz --omit=dev` — no known production dependency
   advisories in the shipped Quartz runtime.
4. `npm run desktop:build:dashboard` — clean standalone build.
5. `npm run desktop:prepare` — runtimes + staged resources (records versions
   in `build-resources/runtimes/runtimes-manifest.json`).
6. `npm run desktop:test` — full desktop suite green.
7. `npm run desktop:verify` — staged-resource guard green.
8. `npm run desktop:dist:win` — NSIS installer.
9. `npm run desktop:verify` again — now also validates `release/win-unpacked`.
10. `npm run desktop:smoke:installed -- "<release>\Breadboard-Setup-<version>-x64.exe"`
   — installs the actual NSIS artifact, launches the installed entry point
   outside the checkout, verifies window/assets/services/auth/garden creation/
   ingestion, restarts to verify DB and file persistence, checks process-tree
   cleanup and fatal logs, then uninstalls and confirms user data remains.
11. Inspect `installed-smoke-summary.json`, `app-smoke-results.json`, and
   `app-smoke.log` in the evidence directory. Every check must pass.

## Signing status — **currently unsigned**

There are no code-signing credentials in this repository. Windows resource
editing is still enabled so `Breadboard.exe` embeds the Breadboard icon and
product metadata. Consequences of the missing certificate:

- SmartScreen will warn on first run; users must choose "Run anyway".
- Do not distribute externally in this state.

To enable signing: obtain an EV/OV certificate (or Azure Trusted Signing),
configure `win.signtoolOptions` and the provider credentials (`WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` for certificate-based signing), and verify the signed
artifact.

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
