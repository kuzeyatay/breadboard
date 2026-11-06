# Design a circuit

Translate the request into numeric constraints with units and operating conditions.
For coursework, first read the original lab/assignment and cite its exact source.
Do not substitute an earlier generated lab note for the assignment. Record source
requirements, user additions and engineering assumptions separately. If minimal
op-amps/potentiometers are an objective, compare viable topologies and report the
actual counts before selecting stages; adding a buffer to every block is not an
optimization. Distinguish design, simulation, real-device qualification, physical
build, measurements and submission tasks; leave unevidenced stages incomplete.
Distinguish required limits from preferences. Resolve contradictions before running
an optimization. For underspecified details, make reasonable recorded assumptions;
ask only when the missing detail changes topology or makes the requested claim
impossible to verify.

Choose topology from the electrical task, not from a fixed catalog: source/load
impedance, bias, headroom, gain-bandwidth, noise and device limits matter. The five
examples are regression fixtures, not the set of allowed circuits. Arbitrary
interconnections, inline semiconductor models and multi-pin IC subcircuits work.

Create one circuit IR with `create_circuit`. Build incrementally with add_component,
connect_components and add_model, or submit complete `circuit` JSON. Use one source
of connectivity per component: ordered `nodes`, or pairs such as
`["R1.1","vin"]`, `["R1.2","vout"]` in `connections`. Ground aliases normalize to 0.
Conflicting named nets are rejected. Removing a component removes its pin edges.
Use disconnect_components for explicit connections, or modify_component(nodes=...)
for components with ordered nodes. Edits create revisions and retain prior states.

Pin order is SPICE order:

| Type | ID prefix | Pins |
| --- | --- | --- |
| resistor/capacitor/inductor | R/C/L | 1, 2 |
| voltage/current source | V/I | positive, negative |
| diode | D | anode, cathode |
| bjt | Q | collector, base, emitter |
| mosfet | M | drain, gate, source, bulk |
| opamp | X | non-inverting, inverting, positive supply, negative supply, output |
| ic | X | declared `pin_count`, in model declaration order |

Values use SI numbers or SPICE suffixes: 10k, 1u, 100n, 1meg. **M means milli**;
use meg for mega. Sources accept value (DC), ac, ac_phase and numeric PULSE, SIN
or PWL waveforms. MOS geometry and subcircuit overrides use parameters, e.g.
`{"W":"10u","L":"1u"}`. Component tolerance is a fraction, e.g. 0.01.

Diode/BJT/MOS/IC components require named inline models. Add each model as
`{"name":"NPN1","definition":".model NPN1 NPN(IS=1e-14 BF=150)","provenance":"educational model"}`.
Vendor ICs use an inline .subckt with provenance stating the source/version and
applicability. Supply all nested dependencies in the definitions. Local file
includes and arbitrary control commands are intentionally outside the tool input.
Do not redistribute proprietary NI templates or restricted vendor models.

The built-in BB_OPAMP has A0=100000 and GBW=10 MHz by default, a dominant pole,
and rail limiting. It does not model input noise, bias currents, slew, supply
current or finite output drive. Custom op amps use a five-pin vendor subcircuit;
other pinouts use type=ic. Characterize model behavior before trusting optimization.

Run export_netlist to check complete connectivity and model references. Review
the netlist and `export_circuit_project` connected wires, review warnings and component
counts. Inspect at least the feedback loop, ground/supply rails, limiter connections
and the path through every user control to the load. A disconnected wiper is a
design defect unless explicitly intentional. Run OP before small-signal analyses.

## Feedback oscillators

A sine oscillator needs sustained feedback, a startup disturbance, and amplitude
regulation. An independent SIN source is a test stimulus, not a self-oscillator.
An injected voltage impulse through a resistor still loads the bridge after the
source returns to zero. Use sufficiently high injection resistance or a finite
current-source impulse whose zero-current state adds no shunt conductance.
For an equal-R/equal-C Wien bridge, f0 = 1/(2*pi*R*C) and bridge transmission at
f0 is 1/3. The non-inverting amplifier therefore needs a small-signal gain
1 + Rfeedback/Rground slightly ABOVE 3 to start; finite op-amp bandwidth and
bridge loading require additional margin. Reducing Rfeedback below twice
Rground stops oscillation. Never try to cure distortion with a gain below this
threshold. Control delivered output power in a separate buffered output stage.

For diode stabilization, put Rfixed and Rvariable in series from amplifier output
to its inverting input, and antiparallel diodes across Rvariable. Choose
Rfixed < 2*Rground < Rfixed+Rvariable: diodes progressively reduce gain as amplitude
grows. Both ends of each diode must connect to the actual feedback branch.
Diodes connected only to isolated resistor stubs cannot regulate that gain.
Check startup and settled amplitude before adding output stages. If a revision
stops oscillating, inspect/revert the feedback change first, retaining that failed run.

Diode regulation introduces harmonics. Buffer the oscillator so output filtering
and level controls do not load its frequency-setting bridge. If passive filtering
cannot meet distortion and amplitude together, consider an active higher-order
low-pass. A fourth-order Butterworth comprises two second-order sections with
Q = 0.541196 and 1.306563. For a unity-gain Sallen-Key section with equal resistors,
source -> R1 -> n1 -> R2 -> n2, capacitor Cf from n1 to section output, capacitor
Cg from n2 to ground, and a unity follower driven by n2, Q = sqrt(Cf/Cg)/2 and
fc = 1/(2*pi*R*sqrt(Cf*Cg)). Select fc from the wanted fundamental and rejected
harmonics, then verify the actual loaded AC response and transient THD.

A level potentiometer before a final unity buffer provides a predictable control
law: output voltage scales with wiper fraction, power with its square. Measure
at the real load. Include a grounded mute endpoint when zero output is required.
Positive-resistance approximations to an endpoint must disclose their residual.
Keep the wiper wired into the delivered circuit at every setting. Sweep its model
parameter in that same topology; changing the buffer's input wire between runs
does not demonstrate a user-operated control. If mute/bypass needs a switch,
include the switch or jumper in the circuit and document its positions. Verify
the final exported revision, including actual loading, rather than a different
temporary testbench; separately identify fault-injection testbenches.
An overload clamp needs series impedance; diodes directly across an ideal voltage
source draw current but do not establish a physically valid voltage/current limit.
Verify positive and negative overdrive and recovery in a separate testbench.

Engineering references: TI's [Sine-Wave Oscillators](https://www.ti.com/lit/an/sloa060/sloa060.pdf)
and [Active Low-Pass Filter Design](https://www.ti.com/lit/an/sloa049d/sloa049d.pdf).
