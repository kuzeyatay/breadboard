# multisim-mcp → Breadboard architecture mapping

Inspected repository: https://github.com/yxy050208/multisim-mcp

Pinned commit: `33ec7f42bf2885084a459a702a83ea3d87f95f9d` (inspected 2026-09-21).
The source reports `1.3.0rc1`; it is ahead of the stable 1.2.0 documentation.
An AST inventory of this commit's server finds **107 decorated tools, five
prompts and 20 resource templates**. The README's smaller counts refer to
earlier surfaces; the inventory, not those counts, is the integration baseline.
See [UPSTREAM.json](../vendor/UPSTREAM.json) for exact names and file hashes.

## Repository and server design

- `mcp_server/multisim_mcp`: Python implementation, CLI and MCP stdio server.
- `mcp_server/tests`: COM-free contract/unit tests, native component experiments,
  real ngspice tests and modern/legacy MCP stdio tests.
- `skills/multisim-workflow/SKILL.md`: install/doctor, requirements, validated netlist,
  design/approval handoffs, simulation, verification and report workflow.
- `harness_skills`: five packaged workflow skills for the host model.
- `tools`: local component-template bootstrap, release checks and compatibility tools.
- `examples`, `docs`, `compatibility`: examples, implementation contracts, native
  acceptance evidence and a versioned component compatibility matrix.
- `integrations/deepseek-harness`: optional model-host integration. Breadboard already
  owns model selection and conversation state, so it uses its existing Hermes agent.

`server.py` separates tools that need serialized COM execution from independent
operations. Stateful NI calls cross `com_worker_client.py` into `com_worker.py`,
running under a compatible 32-bit Python interpreter. The front end may be 64-bit.
The worker protocol has method allowlists, deadlines, cancellation and recovery.
Native `.ms14` encoding/template generation is a separate concern from the SPICE
simulation path. Proprietary template data is not part of the MIT code grant.

## Mapping and implementation status

| Upstream component/workflow | Breadboard equivalent | Treatment |
| --- | --- | --- |
| `server.py`, MCP tool decorators | `breadboard_multisim.tools.Tools`, `server.create_server` | Native typed tool schemas; same operations behind MCP, CLI and Hermes dispatcher |
| MCP host / DeepSeek harness | Existing Breadboard Hermes conversation runtime | Host performs requirements/topology/revision reasoning; no second LLM provider stack |
| `skills/multisim-workflow`, harness skills | `skills/multisim-agent`, published to `hermes-skills/prebuilt/multisim-agent` | Rewritten for native tools and progressive workflow references |
| Five bilingual prompts | Five native MCP workflow prompts | Design, simulate, debug, optimize, report; original prompts remain in compatibility server |
| `eda_core.CircuitDesign`, `circuit_ir` | Versioned `Circuit`, `Component`, `Model` Pydantic IR | User-facing component IDs and pin connections; source revisions persist; original IR retained upstream |
| `spice_adapter`, `schematic_builder` | Deterministic native IR compiler; upstream source adapter retained | Native compiler covers required device families and explicit IC pin counts |
| `safety.py` | Upstream netlist/analysis validators plus typed native inputs | Reused unchanged; noise command generated solely from validated fields |
| `eda_backend.EdaBackend`, `eda_service` | `SimulatorBackend` ABC and `CircuitService` | Transport-independent simulation interface; lazy optional NI backend |
| `ngspice_backend` | Native `NgspiceBackend` | Reuses upstream executable probing, validation and raw format; extends to noise, full-resolution measurements and controlled cancellation |
| `multisim_backend`, COM client/worker | Native `MultisimBackend` → retained upstream execution/worker | Optional licensed Windows installation; noise intentionally uses ngspice |
| `run_circuit_experiment` pipeline | `CircuitService.run_snapshot` | Circuit/analysis snapshot → simulator → raw/CSV → measurements → verification → plots/report/manifest |
| `spice_raw` | Same vendored parser and CSV writer | Strict raw-file parsing, complex real/imaginary preservation; no downsampling before measurement |
| `design_verification`, virtual instruments | `measurements.py`, six requested measurements plus noise | Unit-aware measured/unverified outputs; time-weighted transient statistics; explicit loop-gain requirement |
| `design_diagnosis`, patch workflows | Diagnostic hypotheses + revision-checked edits | Evidence retained; recommendations do not assert untested causes |
| Parameter/tolerance/Monte Carlo sweeps | `optimization.parameter_sweep`, `monte_carlo_analysis` | Real per-candidate runs, seeded tolerances, persisted study records and comparison exports |
| Global optimization/autonomous correction | `optimize_values` + skill's host-agent correction loop | Bounded exploration/refinement with constraints and independent final run; no claim of guaranteed global optimum |
| Design patch transactions | Immutable study baseline, `apply_optimized_values(expected_revision)` | Optimized values cannot overwrite a newer design revision |
| Native schematic image export | Pin-labelled schematic SVG/PNG from circuit IR | No NI needed; explicit net labels, ordered terminals; native .ms14 remains optional upstream capability |
| CSV/SVG/formal reports/manifests | Native CSV, SVG, PNG, Markdown, SHA-256 manifest | Upstream bilingual HTML/PDF reporting remains in compatibility mode |
| Experiment resource templates | Native run-summary URI; get_run, inspect_artifacts, artifact paths | Original 20 templates retained on compatibility server |
| `job_engine`, output leases, retry/cancel APIs | Native bounded runs/studies with progress/cancel; original durable job engine retained | Native studies persist partial progress, but do not auto-resume after process death; upstream compatibility jobs preserve their original restart/retry semantics |
| Runtime doctor | native runtime_status / CLI doctor | Probes ngspice; optional COM readiness is separate |
| Standalone tool authorization | Breadboard capability token, active turn decision, conversation ownership, workspace key | Native calls go through `/api/hermes/tools/multisim`; no model-supplied host path or command |

## Tool families

Native creation/editing: create_circuit, load_circuit, add_component,
remove_component, connect_components, disconnect_components, modify_component,
add_model and export_netlist.

Native simulation: run_operating_point, run_dc_sweep, run_ac_analysis,
run_transient_analysis, run_noise_analysis and run_circuit_experiment.

Native measurement: measure_voltage, measure_current, measure_power, measure_gain,
measure_bandwidth, measure_phase_margin, measure_noise, measure_frequency and
measure_distortion. The latter two use a settled transient window and reject
short, undersampled or nonstationary waveforms instead of assuming the target
oscillation frequency.

Native studies: parameter_sweep, monte_carlo_analysis, optimize_values,
verify_constraints, apply_optimized_values, get_study and cancel_study.

Artifacts/runtime: runtime_status, describe_tool, read_reference, render_schematic, plot_results,
get_run, list_runs, cancel_run and inspect_artifacts. `breadboard-multisim tools`
is the authoritative generated schema catalog.

The requested APIs are a native Breadboard facade, **not a name-for-name copy of
all 107 upstream functions**. For source-compatible tooling, run
`breadboard-multisim upstream`: it exposes the original server, including native
component database operations, .ms14 open/save/codec, input waveform injection,
digital instruments, planning approvals, durable jobs and report variants.
Those retain their original dependencies and acceptance boundaries. They are not
all re-registered in Breadboard's default model prompt. The native dispatcher
keeps the ordinary prompt small and exposes per-operation schemas on demand.

## Data and workflow invariants

One persisted circuit revision is the source of each experiment. All netlist,
raw, report and manifest artifacts refer to that snapshot even if the agent later
edits the circuit. There is no silent analytical solver or synthetic success path.
Simulation errors retain logs and terminate the run as failed. A successful solver
run does not imply constraints passed. Missing model evidence, signals, frequency
coverage or crossings return unverified.

Upstream's original approval workflows remain unmodified in compatibility mode.
The native skill uses Breadboard's existing user authorization and revision checks
for reversible local design work instead of copying a redundant sequence of
upstream-specific approval tokens into the host conversation.

## Testing strategy

Upstream separates deterministic COM-free unit/contract tests from real native
acceptance and ngspice execution. Its CI also tests installed wheels, license/data
contents and both MCP protocol generations. This integration follows that separation:

- IR validation, suffix semantics, revision rollback, command rejection, path
  containment, measurement edge cases and operation budgets run without NI.
- Real ngspice regressions cover divider OP/DC/power, RC AC/transient/thermal noise,
  BJT bias/inverting gain, finite-GBW op amp and MOS switching.
- Sweeps/optimization compare numerical evidence, preserve the baseline, rerun the
  selected candidate and reject stale application. Seeded Monte Carlo repeats exactly.
- MCP tests launch actual subprocesses for both native protocol modes and the
  retained compatibility server; failures are MCP tool errors.
- Breadboard broker-worker tests execute real circuit calls in separate conversation
  workspaces and check that IDs from one workspace cannot access the other.
- NI COM hardware/software execution requires a licensed Windows installation and
  is not represented by ngspice tests. No native NI acceptance claim is made here.

## Upstream updates and attribution

`tools/vendor_upstream.py` copies only Python, JSON and Markdown from the inspected
commit. It rejects an unexpected revision. To update, inspect a fresh clone, review
changes, update the pin, regenerate hashes and rerun compatibility and native tests.
The original MIT license is retained in `vendor/LICENSE.multisim-mcp` and included
in the wheel. No NI XML template, proprietary schematic or local experiment data
is vendored. All 128 upstream source/resource files remain byte-identical to the pin.

Native EDA exports add a separate pinned Weave adapter and the ISC-licensed
Electronics Workbench encoder. Their versions, cloned source revisions and
adaptations are recorded in `src/breadboard_multisim/export_runtime/UPSTREAM.json`.
Two bootstrap helpers from the multisim-mcp clone are in `vendor/multisim_tools`;
the bootstrap helper adds an explicit sample-shell option. These helpers are
outside the unchanged upstream package inventory. NI XML packs remain local.
