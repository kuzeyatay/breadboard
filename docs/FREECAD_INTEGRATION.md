# FreeCAD

Breadboard creates native FreeCAD documents through
[neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp), pinned at
`5014bd9d538b8d09e11201e219cfe291ebca7b4e` (0.1.31, MIT). The unmodified MCP
server and its dependency lock are retained in `freecad-service/vendor/freecad-mcp`.

## Setup and use

Install FreeCAD (tested with 1.1.4) and [uv](https://docs.astral.sh/uv/), then run:

```powershell
npm run setup:freecad
```

The command creates a separate Python 3.13 environment under
`%LOCALAPPDATA%\Breadboard\freecad\venv` and installs the pinned MCP server with
`uv sync --frozen`. FreeCAD is detected from PATH, Program Files, or the user's
Programs directory. For a portable installation, set `BREADBOARD_FREECAD_CMD` to
the absolute `FreeCADCmd.exe` path. `BREADBOARD_FREECAD_HOME` changes the bridge's
data directory; `BREADBOARD_FREECAD_PYTHON` selects an already provisioned MCP
Python interpreter. These settings belong to the host environment, never a chat request.
Packaged desktop resources also include `scripts/setup-freecad.mjs`; run it with
Node's `--experimental-strip-types` flag when setting up from those resources.

The existing CAD measurement service must also be available. In a development
checkout, provision it with `npm run setup:cad` if needed; the desktop Runtime
starts it for CAD runs.

In chat:

```text
/agents:parametric-cad --cad freecad Create a 40 mm washer with a 10 mm hole, 5 mm thick.
```

Or ask to create a part in FreeCAD. Select **FreeCAD** under **Parametric CAD →
CAD backend** to use it as a saved preference. Hardware Blueprint also accepts
`--cad freecad` and has the same backend option for enclosures.

The artifact offers `.FCStd`, STEP, STL, GLB, 3MF (when enabled), FreeCAD Python
source, the design specification and the validation report. Download `.FCStd`
and open it in FreeCAD to edit its native objects. Features and sketches authored
by the model are preserved. Numeric parameter edits in Breadboard create a new
FreeCAD revision. Failed builds keep the previous valid revision.

## Execution

The finite Runtime CAD worker opens a stdio MCP connection, calls upstream's
`execute_code_headless`, and closes the connection after the build. This uses
`FreeCADCmd` in a fresh process. The GUI addon and an open FreeCAD window are
not required. Breadboard does not attach to or change open user documents.

Generated Python defines `DEFAULT_PARAMS` and `build_model(doc, params)`, returning
named document objects containing one valid solid each. Native FreeCAD, Part and
Sketcher APIs are available. A trusted wrapper checks the source, supplies a fresh
document, validates recomputation, and saves FCStd and STEP to a unique application
workspace. The existing CAD service reads the STEP back for independent volume,
surface area, bounding box, solid validity and mesh checks. Solid counts and volumes
must agree with the native document. It also checks the design's declared body count,
dimensions and printer bed using the shared CAD validator. Only then can the artifact pipeline
publish a revision.

Source admission rejects filesystem, network, process and dynamic Python access,
including FreeCAD's document-open/save APIs. This is admission control, not a
security sandbox for adversarial Python. The native Runtime owns the process tree;
Windows cancellation also explicitly terminates only that build's MCP process and
its FreeCAD child. Build workspaces are removed after their exports are stored.
Setup is explicit; a CAD build never downloads packages. Health reads are passive.

## Verification

```powershell
python -m unittest discover -s freecad-service/tests -v
cd dashboard
node --experimental-strip-types --test tests/freecad-backend.test.mjs
$env:BREADBOARD_TEST_FREECAD='1'
node --experimental-strip-types --test tests/freecad-live.test.mjs
```

The live test runs the actual pinned MCP server and FreeCAD, creates a native
Sketcher/PartDesign washer, measures all exchange exports, reopens the FCStd to
check its feature tree, performs a parameter-panel rebuild, rejects prohibited
source and oversized geometry without replacing the valid revision, and cancels
an active child process.
