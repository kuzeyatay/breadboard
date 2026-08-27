# Runtime V2 parity evidence workflow

Parity status is imported only from sealed, runner-emitted evidence. Editing
`feature-parity.json` by hand does not establish post-migration parity.

## Verified package authority

Before an Electron parity run, create one package-verifier receipt for the exact
`win-unpacked` tree that will be launched. The recorder runs the checked-in
package verifier, compares exact raw package-tree snapshots from before and
after verification, and publishes the receipt only when the tree stayed stable.
The receipt binds the complete package closure, `app.asar`, Runtime V2 manifests,
packaged service/runtime binaries, `Breadboard.exe`, the packaging configuration,
and the package-verifier source closure.

```powershell
npm run qa:runtime-v2:package:record -- --executable="C:\path\to\win-unpacked\Breadboard.exe" --output=.qa-results/package-verifier/<run-id>/receipt.json
```

Changing any package file or package-verifier source after that receipt was
recorded invalidates it, even when `Breadboard.exe` is unchanged.

## Workflow observations and import

Allowlisted `qa/electron/specs/**/*.spec.ts` producers call the parity observation
recorder through one process-local package-run guard. Open the guard once before
the first real Electron workflow in each runner process, reuse the exact object
for every observation in that run, and close it when the runner is done:

```js
import {
  closeParityEvidencePackageRun,
  openParityEvidencePackageRun,
  recordParityEvidenceObservation,
} from "../../runtime-v2/parity-evidence-observation.mjs";

const packageRunContext = openParityEvidencePackageRun({
  repoRoot,
  packageVerifierReceiptPath,
  executablePath,
  runId,
});

try {
  recordParityEvidenceObservation({
    repoRoot,
    observationPath,
    producerPath,
    packageRunContext,
    runId,
    capabilityId,
    evidenceType,
    workflowIdentity,
    operationId,
    startedAt,
    finishedAt,
    claims,
    supportingArtifactPaths,
  });
} finally {
  closeParityEvidencePackageRun(packageRunContext);
}
```

The guard is an opaque in-memory capability: copied, serialized, closed, cross-run,
cross-repository, and cross-process values are rejected. Opening it performs one
fresh full package-closure validation. Recording any number of observations then
rechecks the sealed package-receipt identity and binds every observation to the
already-validated closure, executable, critical packaged artifacts, and verifier
source authority without recursively walking the package again. A runner with
multiple OS processes must open one guard per process; do not send it through IPC.

PASS and BLOCKED batches require typed Electron, service, worker, output,
cancellation, and recovery observations. A real workflow failure is retained as
non-accepting FAIL evidence.

After the run, derive the sealed batch receipt from those observations:

```powershell
npm run qa:runtime-v2:parity:record -- --observation=<path> --package-receipt=.qa-results/package-verifier/<run-id>/receipt.json --output=.qa-results/parity/<run-id>/receipt.json --executable="C:\path\to\win-unpacked\Breadboard.exe"
```

Validate without changing the inventory, then import atomically:

```powershell
npm run qa:runtime-v2:parity:import -- --receipt=.qa-results/parity/<run-id>/receipt.json --check-only
npm run qa:runtime-v2:parity:import -- --receipt=.qa-results/parity/<run-id>/receipt.json
```

Every import and normal parity run reopens the sealed chain and rehashes the
verified package closure, sources, observations, supporting artifacts, and
capability source references.

Full package scans are intentionally fixed-cost trust-boundary checks, not
per-observation work: once when each runner process opens its guard, at the start
and immediately before publication of a batch receipt, at import validation (and
again before a mutating import commits), and once per distinct receipt during
persistent `run-parity.mjs` validation. Package changes made after a guard opens
can never reach a published or imported receipt because those later boundaries
perform fresh full-closure validation.

## Pre-migration BLOCKED evidence

The current repository has no authenticated old-installed package-closure
receipt and no successful per-capability legacy blocker receipt. The existing
aborted installed-app run cannot establish either fact. Therefore BLOCKED
observations may be preserved for diagnosis, but BLOCKED imports are rejected
even if `preMigrationStatus` was manually changed. A future legacy importer must
bind the complete old installed package, an actual old-Electron workflow, and
the exact structured blocker before it may update pre-migration fields.
