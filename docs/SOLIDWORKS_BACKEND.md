# SolidWorks as a CAD backend for Hardware Blueprint

Hardware Blueprint designs circuits, and when a brief asks for something
physical — a case, a bracket, a mount — it asks the Parametric CAD agent for the
part. That part is built by a **CAD backend**. There are two:

| Backend | What it is | Where it runs |
| --- | --- | --- |
| `cadquery` | The shipped parametric engine, driven by a generated Python program | The local `cad-service` Python sidecar |
| `solidworks` | The SolidWorks desktop application, driven one modelling operation at a time | Your own Windows machine |

CadQuery remains the default. Nothing below happens unless you choose SolidWorks.

> SolidWorks is commercial software from Dassault Systèmes. It is not open
> source and Breadboard does not ship, bundle, or license it. Only this
> integration and the MCP bridge it drives are open source.

---

## What you need

* **Windows.** SolidWorks is a Windows COM application; there is no other way to
  drive it. Breadboard runs normally on macOS and Linux — the backend simply
  reports itself as unavailable there.
* **SolidWorks, installed and licensed.** Breadboard detects it under
  `Program Files/SOLIDWORKS Corp`.
* **A local clone of [SolidworksMCP-python](https://github.com/andrewbartels1/SolidworksMCP-python),
  with its Python environment installed.** Breadboard never clones or installs
  it for you:

  ```powershell
  git clone https://github.com/andrewbartels1/SolidworksMCP-python
  cd SolidworksMCP-python
  uv sync
  ```

* **The CadQuery CAD service running** (`npm run dev:cad`, or the desktop app,
  which supervises it). SolidWorks produces the geometry; the CAD service
  measures the STEP it exports. See "How a part is measured" below.

## Configuring the clone's location

A checkout beside the Breadboard repository is found automatically:

```
projects/
  breadboard/
  SolidworksMCP-python/
```

Anywhere else, set the path explicitly in the root `.env`:

```
BREADBOARD_SOLIDWORKS_MCP_PATH=D:\work\SolidworksMCP-python
```

The explicit setting always wins, and a path that is not a SolidworksMCP-python
checkout is reported as unconfigured rather than silently ignored.

## Choosing the backend

**As a standing preference** — Settings → Agents → Hardware Blueprint, the
**CAD backend** card:

* *Let the design decide* (default) — CadQuery.
* *Parametric CAD (CadQuery)*
* *SolidWorks*

The card shows the backend's current state on this machine: *Running*,
*Installed, not running*, *Not detected*, *Windows only*, or *Bridge not
configured*.

This is separate from **Printable enclosure**, and the two answer different
questions:

* **Printable enclosure** — *whether* a run designs mechanical CAD at all.
* **CAD backend** — *which engine* builds it when it does.

So "Printable enclosure: Always" + "CAD backend: SolidWorks" means every run
gets a part and SolidWorks makes it. "Printable enclosure: Only when the brief
asks" + "CAD backend: SolidWorks" means a part only when you ask for one, but
SolidWorks makes it when you do.

**For one message** — an inline flag, which never changes the saved preference:

```
/agents:hardware-blueprint Design a 100 mm × 80 mm × 10 mm mounting plate with
four 5 mm holes, each hole centre 10 mm from its two nearest edges. --cad solidworks
```

```
--cad solidworks   build the mechanical CAD in SolidWorks
--cad cadquery     build it with CadQuery
--cad auto         decide automatically for this message
```

Precedence, highest first: the `--cad` flag, a backend the structured brief
explicitly requires, your saved preference, then the default. Breadboard never
infers a backend from the prose of a brief — mentioning SolidWorks in a sentence
is not choosing it.

## How SolidWorks is started

Nothing starts when Breadboard starts. The sequence begins only when a run
resolves to the SolidWorks backend *and* the design actually needs a part:

1. Breadboard checks availability — OS, clone, Python environment, SolidWorks
   install. These are filesystem reads and a process listing; none of them
   starts anything.
2. It launches the SolidworksMCP-python process over stdio, on this machine
   only. Nothing is bound to a network interface.
3. That process attaches to a running SolidWorks if there is one, and starts
   SolidWorks if there is not.
4. The modelling operations run.

The bridge process is Breadboard's, and it is stopped when Breadboard exits, is
restarted on the next request after a crash, and is reused across runs.
**SOLIDWORKS.EXE is yours.** Breadboard never terminates it — not a session you
opened, and not one it opened itself. If SolidWorks was already running when
Breadboard attached, it is treated as your session throughout.

## What the backend can build

The bridge exposes a fixed set of verified operations, and the design is written
as an ordered operation program rather than as CadQuery source:

```json
{
  "name": "mounting-plate",
  "units": "mm",
  "operations": [
    {"op": "sketch", "plane": "Front",
     "entities": [{"kind": "rectangle", "x1": -50, "y1": -40, "x2": 50, "y2": 40}]},
    {"op": "extrude", "depth": 10},
    {"op": "sketch", "plane": "Front",
     "entities": [{"kind": "circle", "centerX": -40, "centerY": -30, "radius": 2.5}]},
    {"op": "cut", "depth": 12}
  ]
}
```

| Supported | Notes |
| --- | --- |
| New part, open, save, Save As | Native `.SLDPRT` |
| Sketch on Front / Top / Right | Millimetres throughout |
| Line, rectangle, circle, arc, polygon | Construction geometry supported |
| Sketch dimensions and relations | Reference entities by the id you give them |
| Extrude (boss) | Depth, draft, both directions, reverse, merge |
| Extruded cut | Holes are a circle plus a cut deeper than the material |
| Fillet | Needs the SolidWorks edge names it applies to |
| Feature-tree and model inspection | `list_features`, `get_model_info` |
| Mass properties | Volume and surface area, used as a cross-check |
| STEP and STL export | Plus the native part |

| Not available | Why |
| --- | --- |
| Chamfer | Implemented on the clone's COM adapter but not registered as an MCP tool |
| Hole Wizard | Not implemented upstream |
| Explicit rebuild | No MCP tool; features rebuild as they are created, and measuring forces one |
| Revolve, sweep, loft, patterns | Not part of this phase — they need entity references the bridge cannot address reliably |

Asking for one of these returns a typed `solidworks_unsupported_operation`
error naming the operation and what to do instead. It is never approximated.

## How a part is measured

SolidWorks builds the geometry; Breadboard measures it. The finished part is
saved as `.SLDPRT`, exported to STEP, and that STEP is read back through the
same conversion path an attached STEP file goes through. The bounding box,
volume, surface area, mesh and GLB preview therefore come from the identical
code that measures a CadQuery solid, and the artifact, the 3D preview, the
validation rules and the download routes all work unchanged.

SolidWorks' own mass properties are read too, but only as a cross-check: they
carry no bounding box, so trusting them alone would mean either an unmeasured
envelope or an invented one. If the two volumes disagree by more than 1%, the
build says so.

A successful build produces: the native `.SLDPRT`, STEP, STL, the GLB preview,
the operation program, the design specification and the validation report.

## Files and safety

Generated parts are written into a Breadboard-owned workspace
(`<BREADBOARD_DATA_DIR>/solidworks/workspaces`, overridable with
`BREADBOARD_SOLIDWORKS_WORKSPACE`), never over files of your own. Paths reported
by the bridge are re-checked against that workspace before anything is read.
Workspaces older than a week are removed when the next build starts.

The bridge process is given an allowlisted environment: no model API keys, no
provider credentials, no shell. The clone's optional PydanticAI agent is
therefore unreachable — SolidworksMCP-python is used strictly as a deterministic
tool bridge, and Hermes remains the only reasoning layer.

## Common errors

| Message | What to do |
| --- | --- |
| *SolidWorks runs on Windows only…* | Nothing to fix; use CadQuery on this machine. |
| *configure `BREADBOARD_SOLIDWORKS_MCP_PATH`…* | Clone SolidworksMCP-python and set the path. |
| *the environment is missing fastmcp or pywin32* | Run `uv sync` in the checkout. |
| *SolidWorks was not detected on this Windows machine.* | Install SolidWorks, or set `BREADBOARD_SOLIDWORKS_EXE`. |
| *did not finish starting in time…* | SolidWorks is usually showing a startup dialog. Bring it to the front, dismiss it, try again. |
| *SolidWorks refused create_extrusion…* | An open sketch profile is the usual cause. |
| *could not measure it: the local CAD service…* | Start the CadQuery service — `npm run dev:cad`. |

When you choose SolidWorks explicitly, an unavailable backend **fails with the
reason**. It never quietly builds the part in CadQuery instead. Only `auto` is
allowed to fall back, and it says so in the run log when it does.

## Testing connectivity

The ordinary test suite needs none of this — Windows, SolidWorks, a licence and
the clone are all irrelevant to it, because the bridge is faked. To exercise the
real thing, opt in explicitly:

```powershell
$env:BREADBOARD_RUN_SOLIDWORKS_TESTS = "1"
$env:BREADBOARD_SOLIDWORKS_MCP_PATH = "D:\work\SolidworksMCP-python"
cd dashboard
node --test --experimental-strip-types tests/solidworks-bridge-live.test.mjs
```

That starts the bridge, completes the MCP handshake, and builds the 100 × 80 ×
10 mm plate with four Ø5 holes, checking the measured envelope and volume
against the arithmetic. It will start SolidWorks if it is not already open, and
it leaves it open afterwards.

`/api/cad/health` reports both backends without starting either — the quickest
way to see what Breadboard currently thinks of your machine.
