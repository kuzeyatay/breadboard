# Formsmith: ShapeR integration

Formsmith is Breadboard's deliberately narrow ShapeR agent. It accepts exactly
one JPEG, PNG, or WebP picture, reconstructs a 3D object, and publishes the GLB
as a normal Breadboard artifact. There is no text prompt, document attachment,
or generic file picker in this agent mode.

```text
one picture -> validated private upload -> masks + depth -> ShapeR -> GLB artifact
```

The result opens in the shared Three.js model viewer, so it can be rotated,
zoomed, downloaded, and restored with the chat after a refresh. The source
picture is user-scoped and expires after 24 hours; the generated artifact is
durable. Uploads are capped at 20 MiB and checked by both extension and file
signature on the server.

## What the bridge does

ShapeR's main inference path expects prepared multi-view conditioning data. The
repository also contains an experimental single-view data-preparation path
using Depth Anything 3. Formsmith uses that official workaround, automatically
creates foreground and floor masks, then runs `infer_shape.py --config speed`.
Hidden geometry is inferred, so a clean picture with one centered object and a
plain background produces the most reliable result.

Only one reconstruction runs at a time. This protects consumer GPUs from two
ShapeR processes competing for VRAM. Each health probe and reconstruction is a
fresh authenticated Runtime V2 job. The native Runtime owns Python and every
CUDA descendant, while the dashboard only reconciles fenced progress and the
private GLB path. Progress, cancellation, restart recovery, and the inline
agent card keep their existing chat contract.

## Local setup

The authoritative dependency instructions are in
[`ShapeR/INSTALL.md`](../ShapeR/INSTALL.md). ShapeR currently targets a Python
3.10 CUDA environment and includes legacy CUDA extensions such as TorchSparse;
the ordinary Breadboard Node environment is not sufficient. The experimental
single-view path additionally needs the `depth_anything_3` package.

Provision that environment once, then configure the desktop runtime with:

```dotenv
SHAPER_ROOT=C:\path\to\breadboard\ShapeR
SHAPER_PYTHON=C:\path\to\the\shaper-environment\python.exe
```

Development and packaging may resolve those values from their trusted staged
roots, but a browser request cannot supply or override them. The packaged
ShapeR source is read-only. Model downloads, Hugging Face/Torch caches, compiler
caches, and temporary homes live under the Breadboard data root at
`runtime-v2/services/formsmith`; attempt inputs and GLB staging remain inside
the Runtime job's private workspace.

Agent selection submits a short Runtime-owned health probe for the checkout,
bridge, Python dependencies, and CUDA. A missing runtime is shown as an
unavailable-agent message instead of starting a doomed job. Breadboard does not
install ShapeR, discover an ambient Python executable, or fall back to a
dashboard-owned subprocess while serving a request.

The fixed runtime entry points are
[`dashboard/scripts/runtime-v2-formsmith-worker.mjs`](../dashboard/scripts/runtime-v2-formsmith-worker.mjs)
and [`scripts/shaper-bridge.py`](../scripts/shaper-bridge.py). The API accepts
only an opaque, user-scoped upload ID. Runtime seals that image as one bounded
input blob; neither the API nor the worker protocol accepts a browser-provided
filesystem path, executable, environment variable, or free-form command.

## Licensing

ShapeR is distributed primarily under CC BY-NC 4.0, with additional notices in
its checkout. Treat Formsmith output and deployment as non-commercial unless
your use is permitted by those terms. Review `ShapeR/LICENSE` and
`ShapeR/NOTICE` before distributing a build or generated assets.
