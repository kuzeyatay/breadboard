---
title: "Test Benches and Stimulus Generation"
date: "2026-04-19T16:43:52.573Z"
source: "Full notes for the class computer architecture"
knowledge_type: "knowledge-topic"
source_document: "computer-architecture-2"
source_file: "Computer Architecture-2.pdf"
locations: ["Page 40", "Page 41", "Page 56"]
related: ["verilog-as-a-hardware-description-language", "procedural-blocks-sensitivity-lists-and-combinational-always-blocks", "rtl-modeling-for-finite-state-machines"]
tags: ["test-benches", "stimuli", "waveform", "initial", "always", "uut", "dut", "finish"]
source_images: ["/computer-architecture/assets/computer-architecture-2-page-040.png", "/computer-architecture/assets/computer-architecture-2-page-041-2.png"]
---

## Test Benches and Stimulus Generation

Source: [[computer-architecture-2|Computer Architecture-2]]

Locations: Page 40, Page 41, Page 56

A test bench is presented as a Verilog module whose purpose is to test another module, often called the unit under test (UUT) or device under test (DUT). The test bench supplies input stimuli and allows the simulator to generate waveforms so the designer can verify whether outputs behave correctly. In the half-adder example, input signals are declared as `reg` because the test bench drives them procedurally, while outputs from the UUT are declared as `wire` because they are driven by the design under test. The UUT is instantiated with these signals connected to its ports. The notes then show `initial` and `always` blocks to initialize values and to toggle inputs periodically with delays such as `#100` and `#50`. A further `initial` block can call `$finish` to stop simulation after a chosen time. This topic teaches reusable simulation structure rather than a one-off example.

### Source snapshots

![Computer Architecture-2 Page 40](/computer-architecture/assets/computer-architecture-2-page-040.png)

![Computer Architecture-2 Page 41](/computer-architecture/assets/computer-architecture-2-page-041-2.png)

### Page-grounded details

#### Page 40

are schedule to be written at the end of the time step, after
all statements in the block have been evaluated. As a result,
if a variable is assigned with a nonblocking assignment
near the top of the block, any later statements in the
same block that reads that variable will still
see its old value, not the newly computed one.

|This matters because consider real flip flops in hardware
On a rising clock edge, all flip flops update at the same time;
no flip flop sees the updated value of another flip flop
during that same clock edge [unclear]

=> Test benches
. A test bench is a verilog module whose only job is to test
another module. It supplies input signals (called stimuli) to the
unit under test and it generates a waveform so you can check whether
the module behaves correctly

Name    Value
Sum     0
carry   0
a       0
b       0

[Diagram: timing waveform to the right of the table, with four traces corresponding top-to-bottom to `Sum`, `carry`, `a`, `b`. The traces show square-wave transitions over time, with two dashed vertical markers indicating time instants.]

module half_adder_test bench

reg in1    { reg because we will use
            assign
reg in2

wire out1  } wire be

[Truncated for analysis]

#### Page 41

initial begin
    in1 = 0
    in2 = 0
end
                              } initialize is another procedural block

always #100  in1 = ~ in1
always # 50  in2 = ~ in2
                              } means run every x nanosecond forever. In here
                                we invert in1 every 100ns and in2 every
                                50ns

endmodule

if you want the testbench to stop instead of runing forever

    initial begin
            #400 $ finish;    // Stops simulation after 400ns
    end

Lecture 2 week 2

=> Sequential Circuits

- In contrast to combinational logic, A sequential circuit has "state"
  meaning the circuit contains one or more storage elements that hold
  bits from the past, and those stored bits influence what the circuit
  does next. Compactly ; Sequential logic = combinational logic + state
  elements, and a clock is used to regulate when the state elements
  sample and update

- A Clock is a periodic digital signal, ideally alternating between 0 and 1
    - Clock Period: The time for one full cycle, in second's
    - Clock Frequency: The number of cycles per second (Hz)  f = 1/T

[Diagram: a square-wave clock signal drawn left to right. The fir

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

- A test bench is a Verilog module used only to test another module.
- It provides stimuli to the unit under test and observes output waveforms.
- Inputs driven by the test bench are declared as `reg`.
- Outputs coming from the DUT are declared as `wire`.
- The DUT is instantiated inside the test bench as the UUT.
- `initial` blocks set starting values.
- `always #time signal = ~signal` creates repeated toggling stimuli.
- `$finish` stops a simulation after a chosen delay.

### Related topics

- [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- [[procedural-blocks-sensitivity-lists-and-combinational-always-blocks|Procedural Blocks, Sensitivity Lists, and Combinational Always Blocks]]
- [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]

### Relationships

- applies-to: [[verilog-as-a-hardware-description-language|Verilog as a Hardware Description Language]]
- applies-to: [[rtl-modeling-for-finite-state-machines|RTL Modeling for Finite State Machines]]
