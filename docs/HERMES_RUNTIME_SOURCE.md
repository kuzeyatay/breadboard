# Hermes runtime source ownership

Breadboard has two code roots: the development checkout and the staged
`desktop/build-resources/app-services` package snapshot. Development reuses
the packaged Python interpreter and dependency wheels, but must not reuse
that snapshot's Hermes source.

The recurring failure came from `breadboard-hermes.pth` permanently adding
the staged snapshot to Python's search path. Windows embedded Python ignores
cwd and PYTHONPATH, so `python -m hermes_cli.main` could select old source even
with a current checkout as its working directory. Dependency-cache checks and
HTTP liveness both passed. Fixing one parent invocation did not fix `-m`
slash workers and other descendants.

## Launch contract

- All Breadboard launch paths execute the selected app root's
  `hermes-agent/breadboard_runtime.py` by absolute filename.
- That entry point selects its own source root, pins bundled plugins, and
  verifies parent and ordinary child module origins before starting Hermes.
- Normal Python children inherit the selected PYTHONPATH. Embedded Python
  children use `breadboard-hermes.pth`, which reads the launcher's internal
  `BREADBOARD_HERMES_SOURCE_ROOT`. There is no implicit packaged fallback.
- Runtime preparation installs this hook; development preparation repairs
  stale hooks even when the interpreter and dependencies are already cached.
- Missing source or incorrect child resolution fails startup with a source
  error. It must not fall back to another Hermes installation.
- Startup logs report the verified root and source fingerprint. The
  authenticated `/api/runtime/source` endpoint reports the frozen fingerprint
  of that process. The standalone stack launcher only reuses a server with
  the same source root and fingerprint.

This is launch plumbing, not a user setting. Do not put the internal source
variable in `.env`, rewrite the hook to an absolute checkout path, or restore
bare `python -m` invocations in Breadboard launchers.

Source updates require a runtime restart; Python does not hot-reload imported
code. Fingerprints deliberately remain unchanged in an already-running
process. Restart through Breadboard's lifecycle controls after active work
finishes; do not clear conversations or Hermes state to repair source selection.

## Verification

From the repository root:

```powershell
node --test desktop/tests/hermes-source-authority.test.mjs desktop/tests/prepare-hot-dev-runtimes.test.mjs
node desktop/scripts/hermes-runtime-smoke.mjs --dev
```

The regression suite creates an isolated embedded interpreter with a stale
packaged source path, proves the child mismatch is rejected, migrates the
hook, and proves both parent and children resolve the selected source. The
smoke test checks authenticated source identity and the live weather tool
catalog without submitting a model turn or modifying user conversations.
