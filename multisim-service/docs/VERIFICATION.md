# Local verification

## Live integration repair — 2026-09-22

The September 21 tests did not establish live conversational acceptance. The
subsequent real Super Agent request exposed two transport defects those tests
missed: the Python callback wrapped Multisim as `action` instead of `tool`, and
the worker used Node's ordinary `realpathSync` on Runtime V2's Windows extended
paths. These produced `Unknown circuit tool` and `EISDIR ... lstat 'C:'`,
respectively, before ngspice could run. The plugin wrapper now matches the route,
and workspace resolution uses Breadboard's existing portable filesystem adapter.

The callback regression now executes the actual registered Python plugin through
HTTP into the route with a real Super Agent turn grant, Python worker and ngspice.
It also forces Hermes's real deferred-tool assembly and resolves the nested
`tool_call(name="multisim", arguments={action, arguments})` wrapper. The skill and
Super Agent instructions cover that wrapper explicitly: a missing bridge name is
an invocation error, not loss of simulator availability.
The workspace test also passes a Windows namespaced path. A separate live failure
revealed that the word `simulate` selected the interactive HTML visualizer and
made its artifact mandatory. Simulation alone no longer selects that skill;
explicit interactive visualization and dynamic explanation requests still do.

The local ngspice installation also lacked the startup script and XSPICE code
models required by manufacturer polynomial sources. The complete matching
distribution is now installed locally. The backend locates installation-local
`spinit` while honoring `SPICE_SCRIPTS`. A real polynomial-source regression
guards this capability.

Frequency and THD are now native tools, measured from
settled transient evidence. Their tests cover adaptive time samples, known
harmonics, and refusal of flat, short, coarse, growing or out-of-range windows.
`read_reference` adds chat access to the four workflows and five examples that
`skill_open` alone cannot read. All nine references ship in the wheel, match both
skill catalogs, and reject arbitrary paths. The native contract now has 40 tools.

Concurrent event-stream connection and first-message startup also revealed a
duplicate conversation-runtime insertion. Registration now resolves one identity
inside an immediate SQLite transaction, retains its workspace, checks ownership,
and disposes the losing provisional session. Canonical and inline runtimes remain
separate. This startup fix is covered by the real SQLite registration tests and
was loaded in the rebuilt desktop after the circuit acceptance run.

| Check | Result |
| --- | --- |
| Python suite with real ngspice | 72 passed |
| Multisim service, actual plugin callback, Super Agent and capability broker tests | 47 passed |
| Conversation memory, workspace persistence and runtime registration tests | 64 passed |
| Visualizer intent regression tests | 4 passed |
| Hermes event normalization, including compaction lifecycle | 25 passed |
| Geographic grounding, including artifact/API endpoint references and genuine directions | 23 passed |
| Browser thinking-row test, including immediate compaction label and completion | Passed |
| Ruff, native Python source and tests | Passed |
| Production dashboard build including TypeScript | Passed with transport, startup, routing, compaction status and workspace recovery fixes; compilation 39.6 s, TypeScript 46 s |
| Wheel reference access | Design workflow and divider read from the built wheel; all 40 tools enumerated |

`plot_results` now honors the selected transient nodes and time window and exports
every selected sample to a compact CSV. AC exports preserve real and imaginary
parts. Derived files leave original raw data and manifests untouched. Reports
include measurements used only in constraints as well as standalone measurements.
These fixes address actual unreadable traces and oversized chat exports from the
oscillator test. Regression tests exercise native dispatch, selected samples,
invalid windows, missing nodes, complex exports and constraint-only reports.

An accidental desktop shutdown interrupted the later presentation-only turn.
Restoring the conversation exposed a separate workspace defect: rehydration
appended a timestamp to the workspace identity, stranding previous circuit/run
IDs in the earlier directory. Creation and rehydration now derive the same
conversation file identity, with distinct stable identities for inline questions.
Model session IDs can change while circuit files and authorized artifact imports
remain in the owning conversation's original workspace. No raw results were
rewritten to repair this.

After loading that fix in the desktop, Super Agent turn
`06647bd1-75b6-433d-a5d4-7af80c5a8df1` reported the original workspace through
`runtime_status` and successfully reopened the accepted normal, overload and AC
runs using `get_run`. Each retained its passing verification. The EC 2 chat also
restored the completed engineering answer and its ten imported artifact cards.

The thinking row now displays **Compacting conversation** for the gateway's
compaction lifecycle, immediately even at turn startup, and resets when it ends.
It adds no answer text or agent card. Ordinary status and failure messages remain
visible. This was requested after the live test exposed the old suppression rule.

A later export-only prompt used the phrase "artifact download route". The map
classifier misread that as travel directions and attached an unrelated map
verification warning. Its source now excludes explicit HTTP/API/artifact route
references while retaining separate geographic requests; 23 map regressions pass.
This additional classifier patch is **not loaded in the running desktop build**:
Breadboard was kept running after the completed engineering test. It will load
on the next normal rebuild. The compaction and workspace fixes above are loaded.

### Breadboard Super Agent acceptance

The actual Breadboard conversation is `conv_zj0F5EwODfSGQD3VApMwyZoX`, EC 2 chat
885, titled **10 kHz oscillator simulation** in the Garden sidebar. It began with
an ordinary circuit-design prompt, with Super Agent enabled. Native Multisim
tools were discovered without a slash command. Initial Luna turns exposed the
transport, schema-guidance and deferred-call defects and produced failed circuit
revisions. Those failures remain in the conversation and workspace. The completed
engineering turn used Breadboard's GPT-6 Astra option at high reasoning with
corrective guidance; this is not a claim that every model succeeds unaided.

Breadboard itself created circuit `7703721e307045099c13bc08ffe508df`, revision 16,
and invoked ngspice through its native plugin, authenticated callback and Python
worker. There is no separate Multisim runtime agent or agent card. The topology
is a diode-stabilized Wien oscillator, buffered high-pass and four low-pass
stages, gain calibration, buffered clamp references and potentiometer output.

| Acceptance measurement | Breadboard simulation result |
| --- | --- |
| Frequency, target 9.9–10.1 kHz | 10,012.935 Hz |
| Output THD, harmonics 2–20, below 1% | 0.559675% |
| Full-scale power into 10 kΩ, acceptance 0.99–1.00 mW | 0.998741 mW |
| Grounded mute | 0 mW |
| 25%, 50%, 75% voltage control | 0.06247, 0.24988, 0.56224 mW |
| Startup | One impulse ends at 2 µs; oscillation persists afterward |
| Positive/negative overdrive through 1 kΩ | Approximately ±5.870 V clamp; recovery checks pass |
| High-pass and low-pass | AC rejection/attenuation constraints pass |
| Nine acceptance run manifests | All file hashes verified |

Final settled run: `9771c89559fe4d23a541ea78941e3f1c`. The fresh complete transient
after fault tests is `7adbc235b147492b8d37bd7ec46aa7e3`. Circuit, analysis, result,
report and the original manifest are copied verbatim in
[the acceptance record](verification/2026-09-22/acceptance.json). That directory
contains a small evidence subset; the complete raw/CSV files covered by the
original manifests remain in Breadboard's conversation workspace and artifacts.
The app imported circuit JSON, netlist, both schematic sheets, waveform, CSV,
report, AC evidence, overload evidence and the control sweep. It saved and read
back the EC 2 lab note `10khz-sine-oscillator-1790063466230`.

The presentation follow-up generated four readable selected plots and full-sample
CSVs through native `plot_results`, then imported all eight into this same chat.
Authenticated download checks returned 200 with matching hashes for all eight,
both before and after a further desktop restart. All 51 original files in the
three plotted runs still match their original manifests. The final linked reply
is persisted without a runtime error; its nine artifact links and corrected lab
reader URL are retained in [the presentation receipt](verification/2026-09-22/presentation.json).
The lab move had timed out at the callback, but a subsequent native read confirmed
the completed move; no duplicate note was created. The optional composed shell
CSV inspection was never executed. Direct artifact and result checks supplied
the verification evidence instead.
The visible EC 2 chat was reloaded after completion: the measured results,
four-row export table and corrected lab link were present. Breadboard's Electron
process remained running and responsive at the end of the check.

These are nominal educational model results. BB_OPAMP includes finite gain,
bandwidth and rail limiting; it does not validate real-device noise, slew rate,
output-current capability, component tolerances or physical protection ratings.
The overload clamp does not establish a 1 mW ceiling during faults. The NI COM
backend and remote Linux CI remain separate, unexecuted acceptance boundaries.

## Original verification — 2026-09-21

Environment: Windows, Python 3.12.13, ngspice 42 console, MCP SDK 2.2.0.
NI Multisim was not used or emulated. The solver executable and environment live
under the ignored `.runtime` directory; source distribution does not bundle them.

| Check | Result |
| --- | --- |
| `npm run test:multisim -- -q` | 42 passed; real ngspice required, no skipped engineering regressions |
| Node tests: `multisim-service.test.mjs`, `multisim-route.test.mjs`, `multisim-super-agent.test.mjs` | 16 passed; natural prompt discovery, normal tool events without agent cards, real dispatch grants, callback authorization, real Python worker and workspace boundary tests |
| Existing `hermes-capability-broker.test.mjs` regressions | 31 passed alongside the 16 Multisim tests |
| Existing Super Agent activity label regression | Passed; Multisim uses ordinary thinking activity |
| Ruff on native Python source/tests | Passed |
| Skill creator's `quick_validate.py`, UTF-8 mode | Passed |
| Source distribution and wheel build with `uv build` | Passed |
| Wheel installed in a separate, non-editable environment | Real divider measured 2.5 V; artifact hashes verified; native 37-tool and original 107-tool MCP servers enumerated over stdio |
| Visual inspection | RC Bode gain/phase plot, net-labelled schematic and paginated 64-pin IC labels reviewed |
| Vendored upstream source | 128 source/resource files, pinned commit and individual SHA-256 hashes retained |

Engineering regressions check divider bias/DC/current/power; RC cutoff, transient
time constant and resistor thermal noise; BJT bias and inverting gain; op amp
20 dB gain and approximately 1 MHz closed-loop cutoff; and MOSFET switching.
Study regressions check real sweep values, reproducible Monte Carlo samples,
improved objective loss, a fresh final candidate run and stale-revision rejection.
Contract tests also cover corrupt raw output, missing backends, input validation,
unverified measurements and retained failure records.

Super Agent follow-up caught and fixed a missing entry in the per-turn capability
broker. The initial callback tests had supplied a handcrafted allowed-tool list,
which concealed the integration gap. They now use `prepareTurn(superAgent: true)`.
New tests load the shipped skill into Super Agent's real inventory on both private
surfaces, check the persisted grant, and call the callback with that grant to
create, simulate and measure a real 2.5 V divider. Public, anonymous and isolated
turns remain denied.

Plain-language amplifier, RC filter, voltage divider and MOSFET requests also
rank the skill first in a 49-skill test catalog on both private surfaces. Multisim
remains absent from the runtime-agent roster. Success and failure tool events
pass through the real event normalizer and launch parser without producing an
agent launch or generated UI card; result and failure evidence are retained.
The shipped skill and Super Agent directive explicitly require direct tool calls
and results in the current reply. This verifies dispatch and presentation event
contracts, not a live model's choice of tools for every possible prompt.

The separate existing `garden-super-agent-dispatch.test.mjs` fails before dispatch:
its source extractor expects a direct `/api/chat` fetch in the Garden workspace
component, which the current checkout no longer contains. That unrelated test
was not rewritten as part of this integration fix. The Multisim inventory and
dispatch tests exercise the production functions directly.

The repository-wide dashboard TypeScript check required an 8 GiB Node heap and
then reported existing errors in other parts of the checkout, including the
OpenMAIC runtime toolchain. It reported no errors for the new Multisim modules
or the modified skill/tool-scope/agent-adapter files. This is not a claim that the
entire dashboard typecheck passes.

Remaining acceptance boundaries: licensed NI COM execution; Linux CI execution
(the workflow is added, but has not run remotely in this task); live conversational
agent acceptance in the UI; signed desktop-installer provisioning; and commercial
device-model/hardware qualification. Unit and circuit regression evidence does
not establish these separate claims.

## Native EDA export checks — 2026-10-06

The local circuit suite passes 105 tests with both exporter runtimes and ngspice
required; this includes 25 native-export checks. The three dashboard Multisim
integration suites pass all 16 tests. Ruff and Node syntax checks pass.

LTspice 24.1.10 generated native netlists from all five exported example circuits
after their ZIP bundles were moved to paths containing spaces. Tests compare
component inventories, ordered pins, passive values, AC source values, models and
instance parameters. Custom 2/4/5/16/64-pin symbols were read by LTspice with their
expected pin order. These checks establish native file reading, not simulation.

Multisim exports pass binary encode/decode equality, geometric layout checks and
independent XML component/pin/node reference checks. A corrupted pin fixture is
rejected. The op-amp model expands into finite-bandwidth, rail-limited primitives.
Unsupported temperature/instance fields and failed exports are rejected without
changing the source circuit or publishing partial files. Bundle hashes and
portable companion files are verified. The Python wheel includes all nine
exporter runtime files and excludes installed Node dependencies and NI templates.

The local NI automation connection returned Access is denied. Direct application
testing was stopped, and the user confirmed there is no Multisim license. The
configured sample-derived project shell and generated `.ms14` files therefore
remain unverified in Multisim; no native opening or simulation success is claimed.
