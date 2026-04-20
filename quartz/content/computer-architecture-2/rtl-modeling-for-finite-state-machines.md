---
title: "RTL Modeling for Finite State Machines"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 55", "Page 56"]
related: ["reg-variables-and-blocking-vs-nonblocking-assignment", "moore-parity-checker-fsm", "test-benches-and-stimulus-generation", "logic-synthesis-and-physical-design-flow"]
tags: ["rtl", "verilog", "current-state", "next-state", "reset", "posedge", "always", "synthesis"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-055-2.png", "/computer-architecture/assets/computer-architecture-2-page-056-2.png"]
---

## RTL Modeling for Finite State Machines

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 55, Page 56

The notes explain RTL, or register-transfer level, as a synthesis-friendly subset of behavioral Verilog in which designers explicitly separate clocked registers from combinational logic. In the FSM context, RTL means describing state registers that update on a clock edge and combinational logic that computes both the next state and outputs. The parity-checker example is implemented using `reg current_state; reg next_state;`, a clocked `always @(posedge clock)` block that loads `current_state <= next_state`, a combinational `always @(*)` block computing `next_state = current_state ^ i`, and a continuous assignment `assign O = current_state`. The notes also show that while an `initial` assignment can make simulation waveforms start in a known state, this does not match real hardware behavior. Therefore a reset signal is added, and the clocked block becomes `if (reset) current_state <= 0; else current_state <= next_state;`. A truth table with reset is included to show how reset forces state and output to zero.

### Source snapshots

![Computer Architecture-2 Page 55](/computer-architecture/assets/computer-architecture-2-page-055-2.png)

![Computer Architecture-2 Page 56](/computer-architecture/assets/computer-architecture-2-page-056-2.png)

### Page-grounded details

#### Page 55

From the truth table we can directly infer the
boolean expression and the actual gate level implementation

D = i ⊕ Q
o = Q

[Diagram: an XOR gate takes inputs `Q` (feedback from the flip-flop output) and `i`; its output feeds `D` of a D flip-flop. The flip-flop output is labeled `Q` and goes to `o`. A feedback wire from `Q` loops back to the XOR input. Labels under the drawing: `Next state` under the XOR/`D` input side, `clk` under the clock input arrow to the flip-flop, and `current state` near the `Q` output/feedback side.]

In verilog, we most often describe hardware in RTL (register-
transfer level) meaning we describe the hardware as:

1. Registers (state elements) that update on a clock edge, and

2. Combinational logic that computes                            (Next state)
   - The next value to load into those registers, and
   - the outputs

RTL is a subset of behavioral verilog that can be automatically
translated (synthesized) to a gate level description

[Flow diagram, vertical boxes with downward arrows:]
RTL behavioral
Verilog description
down
RTL Synthesis
Tool
down
gate-level
verilog description
down
Place & Route
Tool
down
GDS2 text
file

module Moore FSM (
    inp

[Truncated for analysis]

#### Page 56

downAnd the test bench looks like:

    module moore_parity_checker1_tb;
        reg clock;
        reg i;
        wire O;

        moore_parity_checker1 uut (clock, i, O)

        initial begin
            clock = 1'b0;    (is a verilog literal that means
            i     = 1'b0;     1 = number of bits (width)
        end                  'b = the base is binary
                             0 = the value

        always #50 clock = ~clock    //invert clock every 50ns, clock period is 100ns
        always #200 i = ~i           //invert i every 200ns on negative clock edge

    endmodule

↳ However in a real hardware, the state register does not
power up as 0 or 1. Writing "initial current state=0" may
"fix" the waveform in simulation, but it does not correspond to
real hardware behaviour

down Therefore a "reset" signal is added to the machine:

    module moore_FSM(
        input clock
        input reset   //added
        input i
        output o
    );

    reg current_state
    reg next_state

                                     always @(posedge clock) begin
                                         if (reset) current_state <= 0
                                         else

[Truncated for analysis]

### Key points

- RTL describes hardware as registers plus combinational logic.
- State registers update on a clock edge in a sequential block.
- Next-state and output logic are written as combinational logic.
- RTL is synthesizable into gate-level descriptions.
- An `initial` value may help simulation but does not represent real hardware power-up behavior.
- A reset signal is added so hardware starts in a known state.
- Synchronous reset forces the state register to zero on a clock edge.

### Related topics

- [[reg-variables-and-blocking-vs-nonblocking-assignment|Reg Variables and Blocking vs Nonblocking Assignment]]
- [[moore-parity-checker-fsm|Moore Parity Checker FSM]]
- [[test-benches-and-stimulus-generation|Test Benches and Stimulus Generation]]
- [[logic-synthesis-and-physical-design-flow|Logic Synthesis and Physical Design Flow]]

### Relationships

- depends-on: [[reg-variables-and-blocking-vs-nonblocking-assignment|Reg Variables and Blocking vs Nonblocking Assignment]]
- derives-from: [[logic-synthesis-and-physical-design-flow|Logic Synthesis and Physical Design Flow]]
