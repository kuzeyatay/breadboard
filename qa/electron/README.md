# Electron QA

The Playwright suites in this directory drive Breadboard through Electron. The
`critical` and `exploratory` projects use the development Electron entry point;
the `packaged` project is a deliberately smaller probe for an executable that
has already been installed or extracted.

## Packaged executable probe

The packaged project is opt-in. It does not search common installation paths,
run an installer, or fall back to development Electron. Without an explicit
absolute executable path, Playwright reports a `TEST_ENVIRONMENT` skip and does
not create a QA profile or launch a process.

From PowerShell:

```powershell
$env:BREADBOARD_QA_PACKAGED_EXE = "$env:LOCALAPPDATA\Programs\Breadboard\Breadboard.exe"
npm run qa:electron:packaged
```

The packaged command intentionally skips the development desktop build: the
supplied executable is the immutable artifact under test.

The probe passes only a fresh `--breadboard-user-data-dir` to that executable.
It explicitly clears the environment half of Breadboard's QA double gate, so
the packaged app runs its production service profile and security behavior.
The disposable profile is never the normal `%APPDATA%` profile.

It verifies:

- Electron reports `app.isPackaged === true`;
- the browser window retains sandboxing, context isolation, disabled Node
  integration, and a narrowly exposed preload bridge;
- the packaged loading/welcome flow reaches the real sign-in page;
- startup does not attempt to escape to an external browser;
- published service endpoints are loopback-only and owned by the launched app;
- a normal close exits the owned Electron process tree and releases every
  observed owned service port.

The test inventories process identities and TCP ownership read-only; it never
kills an unrelated process. PID creation times prevent a recycled PID from
being mistaken for an owned child or orphan. A graceful-close timeout may send
`SIGTERM` only to the exact Electron process launched by Playwright, records the
close as a failure, and still checks the captured child identities and ports.
Diagnostics, a Playwright trace, and a machine-readable packaged receipt are
written below `.qa-results/packaged/<run-id>/`. Failed runs preserve their
isolated runtime; set `BREADBOARD_QA_PRESERVE_RUNTIME=1` to preserve successful
runs as well.

## Relationship to the installed desktop smoke

This probe complements, and does not replace,
`npm run desktop:smoke:installed`. The installed smoke owns the release-level
NSIS lifecycle: install/uninstall behavior, packaged asset completeness,
authenticated data creation and ingestion, durable state across restart, and
restoration of a pre-existing per-user installation. The Playwright packaged
project starts one explicitly supplied executable and adds renderer-level
evidence for startup, preload/security boundaries, welcome navigation, and
clean process/port shutdown. Use the installed smoke as the release packaging
gate and this project when detailed Electron UI/security evidence is needed for
a particular installed or unpacked executable.
